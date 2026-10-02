/*
 * The Medium and Hard CPUs, and custom ones built on them (docs/bot-medium-hard.md). One brain,
 * steered by a Persona: Medium scores its options with simple rules (§2); Hard adds counting
 * cards, planning by how many turns each build takes, and timing (§3).
 *
 * It decides from its own view only. Its memory (CpuMemo) is built from that view and the events
 * redacted for its seat. Each call returns one move, or null when it has nothing to do (waiting
 * for answers to its offer, say).
 */

import { TABLE_TALK, legalActions, mustDiscard } from '../legal';
import {
  ACTIVATE_COST, COM_OF, KNIGHT_COST, PROMOTE_COST, WALL_COST, activeStrength, ckDiscardDue, firstOwe,
  plainCities,
} from '../modules/citiesKnights'; // prettier-ignore
import { SHIP_COST, goldDue, islandOf, shipKindOK, shipOK } from '../modules/seafarers';
import { treasureDue } from '../modules/treasures';
import {
  COST, blockedAt, cardKinds, devCardsOn, geo, handLimit, has, legalCities, legalSettlements, rateFor,
  roadEdgeOK, roadOK, routeLen, total, vertFree, vertexOK,
} from '../queries'; // prettier-ignore
import { nextInt, type RngState } from '../rng';
import {
  COMS, RES, TRACKS, TRACK_COM, isResource, type Action, type Card, type Cards, type GameState, type Progress,
  type Resource, type Seat, type Track,
} from '../types'; // prettier-ignore
import { cloneJson } from '../clone';
import { stateFromView, type PlayerView } from '../view';
import { cpuEasyRobber, cpuOwedChoice, type CpuMemo } from '../cpu';
import type { CpuOptions, Persona } from './persona';
import { hiddenKnights, hiddenVP, newGuess, reconcile, type Guess } from './track';
import type { Geometry } from '../geometry';

type Act<T extends Action['type']> = Extract<Action, { type: T }>;

/** Pips on a number token: the chance of rolling it, in 36ths. */
export const pips = (n: number) => (n >= 2 && n <= 12 && n !== 7 ? 6 - Math.abs(7 - n) : 0);

interface Ctx {
  v: PlayerView;
  s: GameState;
  me: Seat;
  pr: Persona;
  hard: boolean;
  rng: RngState;
  memo: CpuMemo;
  opts: CpuOptions;
  g: Geometry;
  kinds: readonly Card[];
  hand: Cards;
  /** Resources that are rare on this board are worth more. */
  scarce: Record<string, number>;
  /** My production, in pips per card kind. */
  prod: Record<string, number>;
  /** Hard's guess at every hand (its own exactly). */
  guess: Guess | null;
  /** Value of each spot for a settlement, before personal touches (cached). */
  base: number[];
}

/* ---------------- Reading the board ---------------- */

/** What a hex gives: its resource (or gold), and pips; nothing for the robber's hex. */
function hexGives(s: GameState, h: number, robbed = true): { r: Resource | 'gold'; p: number } | null {
  const hx = s.board.hexes[h]!;
  if (robbed && h === s.board.robber) return null;
  if (hx.t === 'gold') return { r: 'gold', p: pips(hx.n) };
  if (!isResource(hx.t)) return null;
  return { r: hx.t, p: pips(hx.n) };
}

/** Pips per card kind that a building on v would give (a city doubles, or adds a commodity). */
function yieldAt(s: GameState, g: Geometry, v: number, city: boolean, robbed = true): Record<string, number> {
  const out: Record<string, number> = {};
  const ck = !!s.ck;
  for (const h of g.verts[v]!.hexes) {
    const x = hexGives(s, h, robbed);
    if (!x || !x.p) continue;
    out[x.r] = (out[x.r] ?? 0) + x.p;
    if (city) {
      const com = ck && x.r !== 'gold' ? COM_OF[x.r] : undefined;
      if (com) out[com] = (out[com] ?? 0) + x.p;
      else out[x.r] = (out[x.r] ?? 0) + x.p;
    }
  }
  return out;
}

/** Everything a player's buildings produce, in pips per card kind. */
function prodOf(s: GameState, g: Geometry, q: Seat): Record<string, number> {
  const out: Record<string, number> = {};
  s.verts.forEach((b, v) => {
    if (!b || b[0] !== q) return;
    for (const [k, n] of Object.entries(yieldAt(s, g, v, b[1] === 2))) out[k] = (out[k] ?? 0) + n;
  });
  return out;
}

const sumOf = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

function scarcity(s: GameState): Record<string, number> {
  const tot: Record<string, number> = {};
  for (let h = 0; h < s.board.hexes.length; h++) {
    const x = hexGives(s, h, false);
    if (x && x.r !== 'gold') tot[x.r] = (tot[x.r] ?? 0) + x.p;
  }
  const avg = RES.reduce((a, r) => a + (tot[r] ?? 0), 0) / RES.length || 1;
  const out: Record<string, number> = { gold: 1.3 };
  for (const r of RES) out[r] = Math.min(1.5, Math.max(0.75, Math.sqrt(avg / Math.max(1, tot[r] ?? 0))));
  for (const c of COMS) out[c] = 0.9;
  return out;
}

/** Harbor at a corner, if any. */
function harborAt(s: GameState, g: Geometry, v: number): string | null {
  for (const pt of s.board.ports) {
    const e = g.edges[pt.e]!;
    if (e.a === v || e.b === v) return pt.t;
  }
  return null;
}

/** Islands (as a key) where a player has a building (Seafarers). */
function islandKey(s: GameState, g: Geometry, v: number): string | null {
  const land = g.verts[v]!.hexes.find((h) => {
    const t = s.board.hexes[h]!.t;
    return t !== 'sea' && t !== 'fog';
  });
  if (land == null) return null;
  return String(Math.min(...islandOf(s, land)));
}

/** The settlement value of a corner, the same for everyone (cached per state). */
function baseValue(c: Ctx, v: number): number {
  const cached = c.base[v];
  if (cached != null) return cached;
  const { s, g } = c;
  const y = yieldAt(s, g, v, false, false);
  let val = 0;
  let kinds = 0;
  for (const [k, n] of Object.entries(y)) {
    val += n * (c.scarce[k] ?? 1);
    kinds++;
  }
  val += 0.8 * kinds;
  const hb = harborAt(s, g, v);
  if (hb === 'any') val += 0.8;
  else if (hb) val += Math.min(2, 0.25 * (y[hb] ?? 0) + 0.3);
  if (s.ck) for (const r of ['wood', 'sheep', 'ore']) val += 0.15 * (y[r] ?? 0);
  if (s.sea && g.verts[v]!.hexes.some((h) => s.board.hexes[h]!.t === 'sea')) val += 0.3;
  c.base[v] = val;
  return val;
}

/** A corner's value to me: the base value, with more for what I lack and for a new island. */
function spotValue(c: Ctx, v: number, mine: Record<string, number> = c.prod, pick = -1): number {
  const { s, g } = c;
  let val = baseValue(c, v);
  const y = yieldAt(s, g, v, false, false);
  for (const [k, n] of Object.entries(y)) {
    const have = mine[k] ?? 0;
    const lack = have === 0 ? 0.35 : have < 4 ? 0.12 : 0;
    let phase = 0;
    if (pick === 0 && (k === 'wood' || k === 'brick')) phase = 0.15;
    if (pick === 1 && (k === 'ore' || k === 'wheat')) phase = 0.15;
    if (pick < 0 && c.pr.style === 'cities' && (k === 'ore' || k === 'wheat')) phase = 0.1;
    val += n * (c.scarce[k] ?? 1) * (lack + phase);
  }
  return val;
}

/** Seafarers: the points for a first settlement on a new island (0 elsewhere). */
function islandBonus(c: Ctx, v: number): number {
  const { s, g } = c;
  if (!s.sea || !c.v.rules.newIslandVP || s.stage === 'setup') return 0;
  const key = islandKey(s, g, v);
  if (!key) return 0;
  const home = s.verts.some((b, u) => b && b[0] === c.me && islandKey(s, g, u) === key);
  return home ? 0 : c.v.rules.newIslandVP;
}

/* ---------------- Who's winning ---------------- */

function threat(c: Ctx, q: Seat, real: boolean): number {
  const p = c.v.players[q]!;
  let t = p.publicVP;
  if (real) t += hiddenVP(c.v, q) + sumOf(prodOf(c.s, c.g, q)) / 30;
  return t;
}

/**
 * The player to hold back. Public: whoever is ahead on public points (ties: more cards).
 * Real (Hard): its own estimate, hidden victory points and production included.
 */
function leader(c: Ctx, real: boolean): Seat | null {
  let best: Seat | null = null;
  let bestT = -Infinity;
  c.v.players.forEach((p, q) => {
    if (q === c.me) return;
    const t = threat(c, q, real) + p.resCount / 100;
    if (t > bestT) {
      bestT = t;
      best = q;
    }
  });
  return best;
}

/** Is anyone within `n` points of winning, on public points? */
const someoneClose = (c: Ctx, n: number) => c.v.players.some((p) => p.publicVP >= c.v.winVP - n);

/* ---------------- Cards ---------------- */

const reserveOf = (hand: Cards, cost: Cards): Cards => {
  const out: Cards = {};
  for (const [k, n] of Object.entries(cost) as [Card, number][]) out[k] = Math.min(hand[k] ?? 0, n);
  return out;
};
const minus = (a: Cards, b: Cards): Cards => {
  const out: Cards = { ...a };
  for (const [k, n] of Object.entries(b) as [Card, number][]) out[k] = (out[k] ?? 0) - n;
  return out;
};
const missingOf = (hand: Cards, cost: Cards): Cards => {
  const out: Cards = {};
  for (const [k, n] of Object.entries(cost) as [Card, number][])
    if ((hand[k] ?? 0) < n) out[k] = n - (hand[k] ?? 0);
  return out;
};

/** Bank trades that complete `cost` (at my rates, with what the bank has), or null. */
function bankPlan(c: Ctx, cost: Cards, hand: Cards = c.hand): [Card, Card][] | null {
  const h: Cards = { ...hand };
  const bank: Cards = { ...c.s.bank };
  const out: [Card, Card][] = [];
  for (let guard = 0; guard < 12; guard++) {
    const miss = (Object.keys(cost) as Card[]).find((k) => (h[k] ?? 0) < (cost[k] ?? 0));
    if (!miss) return out;
    if (isResource(miss) && (bank[miss] ?? 0) < 1) return null;
    const spare = (k: Card) => (h[k] ?? 0) - (cost[k] ?? 0);
    const give = c.kinds
      .filter((k) => k !== miss && spare(k) >= rateFor(c.s, c.me, k))
      .sort(
        (a, b) =>
          spare(b) / rateFor(c.s, c.me, b) - spare(a) / rateFor(c.s, c.me, a) ||
          cardVal(c, a) - cardVal(c, b),
      )[0];
    if (!give) return null;
    h[give] = (h[give] ?? 0) - rateFor(c.s, c.me, give);
    h[miss] = (h[miss] ?? 0) + 1;
    if (isResource(miss)) bank[miss] = (bank[miss] ?? 0) - 1;
    out.push([give, miss]);
  }
  return null;
}

/** How much a card is worth to me right now (scarcity, plus what my next build needs). */
function cardVal(c: Ctx, k: Card, need: Cards = {}): number {
  let val = c.scarce[k] ?? 1;
  if ((need[k] ?? 0) > (c.hand[k] ?? 0)) val += 0.6;
  // Plenty of it already: each more is worth less.
  if ((c.hand[k] ?? 0) >= 4) val -= 0.3;
  return val;
}

/** Give up n cards: never what the goal needs if avoidable, otherwise what's least worth. */
function shedSmart(c: Ctx, n: number, keep: Cards): Cards {
  const left: Cards = { ...c.hand };
  const out: Cards = {};
  for (let i = 0; i < n; i++) {
    const k = c.kinds
      .filter((x) => (left[x] ?? 0) > 0)
      .sort((a, b) => {
        const ea = (left[a] ?? 0) - (keep[a] ?? 0);
        const eb = (left[b] ?? 0) - (keep[b] ?? 0);
        if (ea > 0 !== eb > 0) return ea > 0 ? -1 : 1;
        return cardVal(c, a, keep) - cardVal(c, b, keep) || (left[b] ?? 0) - (left[a] ?? 0);
      })[0]!;
    left[k] = (left[k] ?? 0) - 1;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/* ---------------- Getting places ---------------- */

/** Can a road or ship ever go on edge e (ignoring what it connects to)? */
function edgeOpen(c: Ctx, e: number): boolean {
  const { s } = c;
  if (s.edges[e] != null || s.sea?.ships[e] != null) return false;
  return roadEdgeOK(s, e) || (!!s.sea && shipKindOK(s, e));
}

/**
 * For every corner, how many roads or ships it takes to reach it from my network, and the
 * first edge to build on the way (BFS through open edges; others' buildings block).
 */
function reach(c: Ctx, maxD = 4): { dist: number[]; first: number[] } {
  const { s, g, me } = c;
  const n = g.verts.length;
  const dist = new Array<number>(n).fill(Infinity);
  const first = new Array<number>(n).fill(-1);
  const q: number[] = [];
  for (let v = 0; v < n; v++) {
    const b = s.verts[v];
    const mine =
      (b && b[0] === me) ||
      (!b && g.verts[v]!.edges.some((e) => s.edges[e] === me || s.sea?.ships[e] === me));
    if (mine && !blockedAt(s, me, v)) {
      dist[v] = 0;
      q.push(v);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const v = q[i]!;
    if (dist[v]! >= maxD) continue;
    const b = s.verts[v];
    if (dist[v]! > 0 && ((b && b[0] !== me) || blockedAt(s, me, v))) continue;
    for (const e of g.verts[v]!.edges) {
      if (!edgeOpen(c, e)) continue;
      const E = g.edges[e]!;
      const u = E.a === v ? E.b : E.a;
      if (dist[u] !== Infinity) continue;
      dist[u] = dist[v]! + 1;
      first[u] = dist[v] === 0 ? e : first[v]!;
      q.push(u);
    }
  }
  return { dist, first };
}

/** A legal road or ship on edge e for me, if one could be built there now (cost aside). */
function pieceOn(c: Ctx, e: number): Act<'road'> | Act<'ship'> | null {
  if (c.s.players[c.me]!.pieces.road > 0 && roadOK(c.s, c.me, e)) return { type: 'road', e };
  if (c.s.sea && (c.s.players[c.me]!.pieces.ship ?? 0) > 0 && shipOK(c.s, c.me, e))
    return { type: 'ship', e };
  return null;
}

const costOf = (a: Action): Cards =>
  a.type === 'ship' ? SHIP_COST : a.type === 'road' ? COST.road : a.type === 'settlement' ? COST.settlement : a.type === 'city' ? COST.city : a.type === 'buyDev' ? COST.dev : {}; // prettier-ignore

/** Longest road (or trade route) if I also had edge e. */
function routeWith(c: Ctx, a: Act<'road'> | Act<'ship'>): number {
  const s = c.s;
  if (a.type === 'road') {
    const edges = s.edges.slice();
    edges[a.e] = c.me;
    return routeLen({ ...s, edges }, c.me);
  }
  const ships = s.sea!.ships.slice();
  ships[a.e] = c.me;
  return routeLen({ ...s, sea: { ...s.sea!, ships } }, c.me);
}

/** The longest route that takes the title, and mine. */
function routeRace(c: Ctx): { mine: number; need: number } {
  const mine = c.v.players[c.me]!.roadLen;
  const others = Math.max(0, ...c.v.players.filter((_, q) => q !== c.me).map((p) => p.roadLen));
  const need = c.v.longest === c.me ? Infinity : Math.max(5, others + 1);
  return { mine, need };
}

/* ---------------- Goals ---------------- */

interface Goal {
  kind: 'city' | 'settlement' | 'road' | 'dev';
  /** The move that builds it (legal once affordable). */
  act: Action;
  cost: Cards;
  /** Worth, in rough victory points. */
  value: number;
}

function goals(c: Ctx): Goal[] {
  const { s, me } = c;
  const pl = s.players[me]!;
  const out: Goal[] = [];
  const P = 0.075; // a pip of production is worth this many points over the rest of a game
  if (pl.pieces.city > 0) {
    let best: Goal | null = null;
    for (const v of legalCities(s, me)) {
      const y = sumOf(yieldAt(s, c.g, v, false));
      // Cities & Knights: a city also makes commodities, and opens improvements and metropolises.
      const val = 1 + P * y * 1.1 + (s.ck ? 0.8 : 0);
      if (!best || val > best.value)
        best = { kind: 'city', act: { type: 'city', v }, cost: COST.city, value: val };
    }
    if (best) out.push(best);
  }
  // Hard looks further across the water for islands.
  const far = c.hard && s.sea ? 6 : 4;
  const { dist, first } = reach(c, far);
  if (pl.pieces.settlement > 0) {
    let best: Goal | null = null;
    for (const v of legalSettlements(s, me)) {
      const val = 1 + islandBonus(c, v) + P * spotValue(c, v);
      if (!best || val > best.value)
        best = { kind: 'settlement', act: { type: 'settlement', v }, cost: COST.settlement, value: val };
    }
    if (best) out.push(best);
    // A road or ship toward the best spot within reach.
    let bestR: Goal | null = null;
    for (let v = 0; v < s.verts.length; v++) {
      const d = dist[v]!;
      if (d < 1 || d > far || first[v]! < 0 || !vertFree(s, v) || !vertexOK(s, v)) continue;
      const a = pieceOn(c, first[v]!);
      if (!a) continue;
      const val = ((1 + islandBonus(c, v) + P * spotValue(c, v)) * 0.55) / d;
      if (!bestR || val > bestR.value) bestR = { kind: 'road', act: a, cost: costOf(a), value: val };
    }
    if (bestR) out.push(bestR);
  }
  // A road for Longest Road (or trade route) when the title is close.
  if (c.pr.focus !== 'ignore') {
    const race = routeRace(c);
    if (race.need !== Infinity && race.mine >= race.need - (c.pr.focus === 'chase' ? 3 : 2)) {
      let bestL: Goal | null = null;
      for (const e of s.edges.keys()) {
        if (!edgeOpen(c, e)) continue;
        const a = pieceOn(c, e);
        if (!a) continue;
        const len = routeWith(c, a);
        if (len <= race.mine) continue;
        const val =
          (len >= race.need ? 2 : 0.6) * (c.pr.focus === 'chase' ? 1.3 : 1) - (race.need - len) * 0.3;
        if (!bestL || val > bestL.value) bestL = { kind: 'road', act: a, cost: costOf(a), value: val };
      }
      if (bestL && bestL.value > 0) out.push(bestL);
    }
  }
  if (devCardsOn(s) && c.v.deckCount > 0) {
    let val = 0.5;
    if (c.pr.focus === 'chase') val += 0.15;
    if (c.pr.style === 'cards') val += 0.3;
    out.push({ kind: 'dev', act: { type: 'buyDev' }, cost: COST.dev, value: val });
  }
  return out;
}

const STYLE_ORDER: Record<Persona['style'], Goal['kind'][]> = {
  balanced: ['city', 'settlement', 'road', 'dev'],
  cities: ['city', 'dev', 'settlement', 'road'],
  settlements: ['settlement', 'road', 'city', 'dev'],
  cards: ['dev', 'city', 'settlement', 'road'],
};

/** Production per round (everyone rolls once), per card kind. */
function perRound(c: Ctx): Record<string, number> {
  const n = c.v.players.length;
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(c.prod)) out[k] = (p * n) / 36;
  return out;
}

/** Rounds until I can pay `cost`, trading surplus with the bank (Hard's planning). */
function eta(c: Ctx, cost: Cards): number {
  const rate = perRound(c);
  const gold = rate.gold ?? 0;
  for (let t = 0; t <= 12; t++) {
    const h: Cards = {};
    for (const k of c.kinds) h[k] = (c.hand[k] ?? 0) + t * (rate[k] ?? 0);
    let miss = 0;
    let spare = gold * t;
    for (const k of c.kinds) {
      const d = (h[k] ?? 0) - (cost[k] ?? 0);
      if (d < 0) miss -= d;
      else spare += Math.floor(d / rateFor(c.s, c.me, k));
    }
    if (spare >= miss - 1e-9) return t;
  }
  return 13;
}

/** The goal to work toward: Medium by its order of preference, Hard by worth per round of waiting. */
function pickGoal(c: Ctx, gs: Goal[]): Goal | null {
  if (!gs.length) return null;
  if (!c.hard) {
    const order = STYLE_ORDER[c.pr.style];
    // Longest Road chasing outranks plain roads only when it would take the title.
    return [...gs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.value - a.value)[0]!;
  }
  const styleW = (k: Goal['kind']) => {
    const st = c.pr.style;
    if (st === 'cities' && k === 'city') return 1.2;
    if (st === 'settlements' && (k === 'settlement' || k === 'road')) return 1.2;
    if (st === 'cards' && k === 'dev') return 1.4;
    return 1;
  };
  return [...gs].sort(
    (a, b) =>
      (b.value * styleW(b.kind)) / (1 + eta(c, b.cost)) - (a.value * styleW(a.kind)) / (1 + eta(c, a.cost)),
  )[0]!;
}

/** Find the legal move equal to `a`. */
function legal<T extends Action>(acts: Action[], a: T): T | null {
  const key = JSON.stringify(a);
  return (acts.find((x) => JSON.stringify(x) === key) as T | undefined) ?? null;
}

/* ---------------- The robber and the pirate ---------------- */

/** How much a robber on hex h hurts `target` (and others, a little), minus what it costs me. */
function robberScore(c: Ctx, h: number, target: Seat | null): number {
  const { s, g, me } = c;
  const x = hexGives(s, h, false);
  const p = x ? x.p : 0;
  let score = 0;
  for (const v of g.hexVerts[h]!) {
    const b = s.verts[v];
    if (!b) continue;
    const w = p * b[1];
    if (b[0] === me) score -= 2 * w + 3;
    else if (b[0] === target) score += 1.5 * w + 2;
    else score += 0.3 * w;
  }
  return score;
}

type RobberAct = Act<'robber'> | Act<'pirate'>;

/** Where the robber (or pirate) goes and whom it robs (docs/bot-medium-hard.md §2.4, §3.5). */
function robberChoice(c: Ctx, moves: RobberAct[]): RobberAct | null {
  if (!moves.length) return null;
  const pr = c.pr.robber;
  const attack = pr === 'leader' || (pr === 'late' && someoneClose(c, 3));
  if (!attack) return cpuEasyRobber(c.s, c.me, moves, c.rng) as RobberAct | null;
  const target = leader(c, c.hard);
  let best: RobberAct[] = [];
  let bestS = -Infinity;
  for (const a of moves) {
    let sc =
      a.type === 'robber'
        ? robberScore(c, a.hex, target)
        : // The pirate: a steal from the leader's ships, worth less than a good robber spot.
          a.victim === target && target != null
          ? 3
          : -1;
    if (a.victim != null)
      sc += a.victim === target ? 2 + victimWorth(c, a.victim) : victimWorth(c, a.victim) * 0.5;
    if (sc > bestS + 1e-9) {
      bestS = sc;
      best = [a];
    } else if (Math.abs(sc - bestS) <= 1e-9) best.push(a);
  }
  return best[nextInt(c.rng, best.length)] ?? null;
}

/** How good a steal from q is: more cards, and (Hard) more of what I need. */
function victimWorth(c: Ctx, q: Seat): number {
  const n = c.v.players[q]!.resCount;
  if (!n) return -5;
  if (!c.guess) return Math.min(n, 8) * 0.1;
  const h = c.guess[q]!;
  let w = 0;
  for (const k of c.kinds) w += ((h[k] ?? 0) / n) * cardVal(c, k);
  return Math.min(n, 8) * 0.1 + w * 0.5;
}

/* ---------------- Trading with people ---------------- */

const tradingOn = (c: Ctx) => c.opts.trading && c.pr.trading !== 'never';

/** Would I trade with q at all? Never with someone about to win, and (shrewd) never with the leader. */
function partnerOK(c: Ctx, q: Seat): boolean {
  if (!tradingOn(c)) return false;
  if (c.v.players[q]!.publicVP + (c.hard ? hiddenVP(c.v, q) : 0) >= c.v.winVP - 2) return false;
  return !(
    c.pr.trading === 'shrewd' &&
    leader(c, true) === q &&
    c.v.players[q]!.publicVP >= c.v.players[c.me]!.publicVP
  );
}

/** Should I take this offer (cards `get` for cards `give`) from q? */
function wantTrade(c: Ctx, q: Seat, get: Cards, give: Cards): boolean {
  if (!partnerOK(c, q) || !has(c.hand, give)) return false;
  const goal = pickGoal(c, goals(c));
  const need = goal ? goal.cost : {};
  const after = minus({ ...c.hand }, give);
  for (const [k, n] of Object.entries(get) as [Card, number][]) after[k] = (after[k] ?? 0) + n;
  const missBefore = total(missingOf(c.hand, need));
  const missAfter = total(missingOf(after, need));
  const nGet = total(get);
  const nGive = total(give);
  switch (c.pr.trading) {
    case 'fair':
      return missAfter < missBefore && nGive <= nGet;
    case 'generous':
      return missAfter < missBefore && nGive <= nGet + 1;
    case 'shrewd': {
      let worth = 0;
      for (const [k, n] of Object.entries(get) as [Card, number][]) worth += n * cardVal(c, k, need);
      for (const [k, n] of Object.entries(give) as [Card, number][]) worth -= n * cardVal(c, k, need);
      return missAfter <= missBefore && worth >= 0.4;
    }
    default:
      return false;
  }
}

/** Answer offers waiting on me (docs/bot-medium-hard.md §2.6, §3.6). */
function answerOffers(c: Ctx): Action | null {
  const { v, me, memo } = c;
  const seen = (memo.seen ??= {});
  for (const o of v.offers) {
    if (o.from === me || o.resp[me] != null) continue;
    if (seen[o.id] == null) seen[o.id] = memo.moves ?? 0;
    if (o.from === v.turn) {
      const yes = wantTrade(c, o.from, o.give as Cards, o.want as Cards);
      return { type: 'respond', id: o.id, yes };
    }
    if (v.turn === me) {
      // An offer to me on my turn trades at once. Take it only if nothing I did since could have
      // changed their hand (on my turn, only my own moves can).
      const fresh = seen[o.id] === (memo.moves ?? 0);
      const yes = fresh && wantTrade(c, o.from, o.give as Cards, o.want as Cards);
      return { type: 'respond', id: o.id, yes };
    }
  }
  return null;
}

/** My own open offer: take the best answer, withdraw it, or wait. */
function manageOffer(c: Ctx, o: PlayerView['offers'][number]): Action | null {
  const others = c.v.players.map((_, q) => q).filter((q) => q !== c.me);
  const yes = others.filter((q) => o.resp[q] === 1 && partnerOK(c, q) && has(c.hand, o.give as Cards));
  const answered = others.every((q) => o.resp[q] != null);
  if (yes.length) {
    yes.sort((a, b) => threat(c, a, c.hard) - threat(c, b, c.hard));
    return { type: 'confirm', id: o.id, with: yes[0]! };
  }
  if (answered || c.opts.offerTimeout) return { type: 'cancel', id: o.id };
  return null;
}

/** An offer to everyone for what my goal still needs (at most one per turn unless allowed more). */
function makeOffer(c: Ctx, goal: Goal | null): Act<'offer'> | null {
  if (!goal || !tradingOn(c)) return null;
  const made = (c.memo.offers ??= []);
  if (made.length >= (c.opts.oneOffer ? 1 : 3)) return null;
  const miss = missingOf(c.hand, goal.cost);
  if (!total(miss) || total(miss) > 2) return null;
  const spare = minus(c.hand, goal.cost);
  const want = (Object.keys(miss) as Card[]).filter(isResource).sort((a, b) => cardVal(c, b) - cardVal(c, a));
  if (!want.length) return null;
  const r = want[0]!;
  // Hard asks only for what someone other than the leader probably has.
  if (c.guess) {
    const lead = leader(c, true);
    if (!c.v.players.some((_, q) => q !== c.me && q !== lead && (c.guess![q]![r] ?? 0) >= 0.7)) return null;
  }
  const extra = c.kinds
    .filter((k) => isResource(k) && k !== r && (spare[k] ?? 0) > 0)
    .sort((a, b) => (spare[b] ?? 0) - (spare[a] ?? 0) || cardVal(c, a) - cardVal(c, b));
  if (!extra.length) return null;
  const k = extra[0]!;
  const n = (spare[k] ?? 0) >= 3 && (c.pr.trading === 'fair' || c.pr.trading === 'generous') ? 2 : 1;
  const offer: Act<'offer'> = { type: 'offer', give: { [k]: n }, want: { [r]: 1 } };
  const key = JSON.stringify([offer.give, offer.want]);
  if (made.includes(key)) return null;
  made.push(key);
  return offer;
}

/* ---------------- Cards to play ---------------- */

/** Expected take from a Monopoly on r (Hard counts cards; Medium guesses from production). */
function monoTake(c: Ctx, r: Card): number {
  let n = 0;
  c.v.players.forEach((p, q) => {
    if (q === c.me) return;
    if (c.guess) n += c.guess[q]![r] ?? 0;
    else {
      const pr = prodOf(c.s, c.g, q);
      const tot = sumOf(pr);
      n += tot ? (p.resCount * (pr[r] ?? 0)) / tot : p.resCount / 5;
    }
  });
  return n;
}

/** Does my hand complete a city or settlement with two extra cards? Returns the two to take. */
function plentyPick(c: Ctx, goal: Goal | null): [Resource, Resource] | null {
  const targets = [goal?.cost, COST.city, COST.settlement].filter(Boolean) as Cards[];
  for (const cost of targets) {
    const miss = missingOf(c.hand, cost);
    const list = (Object.entries(miss) as [Card, number][]).flatMap(([k, n]) => new Array<Card>(n).fill(k));
    if (!list.length || list.length > 2 || !list.every(isResource)) continue;
    const res = list as Resource[];
    if (res.length === 1) res.push(RES.slice().sort((a, b) => cardVal(c, b) - cardVal(c, a))[0]!);
    if (res.every((x) => c.s.bank[x] > 0)) return [res[0]!, res[1]!];
  }
  return null;
}

function devPlay(c: Ctx, acts: Action[], goal: Goal | null): Action | null {
  const { v, me } = c;
  const hold = c.pr.timing === 'hold';
  const knight = acts.find((a) => a.type === 'playKnight');
  if (knight) {
    const mine = v.players[me]!.knights;
    const top = Math.max(0, ...v.players.filter((_, q) => q !== me).map((p) => p.knights));
    const takes = v.largest !== me && mine + 1 >= 3 && mine + 1 > top && c.pr.focus !== 'ignore';
    const robbed = robberScore(c, c.s.board.robber, null) < -4;
    if (takes || robbed) return knight;
    if (c.pr.focus === 'chase' && !hold) return knight;
  }
  const roads = acts.find((a) => a.type === 'playRoads');
  if (roads) {
    const { dist } = reach(c, 2);
    const spot = c.s.verts.some(
      (_, u) => dist[u]! >= 1 && dist[u]! <= 2 && vertFree(c.s, u) && vertexOK(c.s, u),
    );
    const race = routeRace(c);
    const title = race.need !== Infinity && race.mine + 2 >= race.need;
    if (spot || title || (!hold && legalSettlements(c.s, me).length === 0)) return roads;
  }
  const plenty = acts.filter((a): a is Act<'playPlenty'> => a.type === 'playPlenty');
  if (plenty.length) {
    const pick = plentyPick(c, goal);
    if (pick) {
      const a =
        legal(plenty, { type: 'playPlenty', r1: pick[0], r2: pick[1] }) ??
        legal(plenty, { type: 'playPlenty', r1: pick[1], r2: pick[0] });
      if (a) return a;
    }
  }
  const mono = acts.filter((a): a is Act<'playMono'> => a.type === 'playMono');
  if (mono.length) {
    const best = mono
      .map((a) => ({ a, n: monoTake(c, a.r) * cardVal(c, a.r, goal?.cost ?? {}) }))
      .sort((x, y) => y.n - x.n)[0]!;
    if (best.n >= (hold ? 4.5 : 4)) return best.a;
  }
  return null;
}

/* ---------------- Cities & Knights ---------------- */

/** Barbarians: will they win, and would I lose a city? */
function barbarianRisk(c: Ctx): { close: boolean; atRisk: boolean; strength: number; defense: number } {
  const ck = c.v.ck!;
  const s = c.s;
  const strength = s.verts.filter((b) => b && b[1] === 2).length;
  let defense = 0;
  const str: number[] = c.v.players.map((_, q) => activeStrength(s, q));
  for (const x of str) defense += x;
  const losers = c.v.players.map((_, q) => q).filter((q) => plainCities(s, q).length > 0);
  const low = losers.length ? Math.min(...losers.map((q) => str[q]!)) : 0;
  const atRisk = strength > defense && plainCities(s, c.me).length > 0 && str[c.me]! <= low;
  return { close: ck.barb >= 3, atRisk, strength, defense };
}

/** The commodity track I make most of (my metropolis plan). */
function focusTrack(c: Ctx): Track {
  return [...TRACKS].sort((a, b) => {
    const pa =
      (c.prod[TRACK_COM[a]] ?? 0) * 2 + (c.hand[TRACK_COM[a]] ?? 0) + (c.v.ck!.lvl[c.me]![a] ?? 0) * 3;
    const pb =
      (c.prod[TRACK_COM[b]] ?? 0) * 2 + (c.hand[TRACK_COM[b]] ?? 0) + (c.v.ck!.lvl[c.me]![b] ?? 0) * 3;
    return pb - pa;
  })[0]!;
}

function ckMain(c: Ctx, acts: Action[], goal: Goal | null): Action | null {
  const of = <T extends Action['type']>(t: T) => acts.filter((a) => a.type === t) as Act<T>[];
  const risk = barbarianRisk(c);
  const spare = minus(c.hand, goal ? reserveOf(c.hand, goal.cost) : {});
  const urgent = risk.atRisk && (risk.close || c.hard);
  // Knights against the barbarians.
  if (urgent || (c.hard && risk.strength > risk.defense && c.v.ck!.barb >= 4)) {
    const act = of('activate')[0];
    if (act) return act;
    const kn = knightSpot(c, of('knight'));
    if (kn) return kn;
    const pro = of('promote')[0];
    if (pro) return pro;
  }
  // Chase the robber off my own hexes.
  const chase = of('chase');
  if (chase.length && robberScore(c, c.s.board.robber, null) < -2) {
    const target = leader(c, c.hard);
    const best = chase
      .map((a) => ({ a, sc: robberScore(c, a.hex, target) + (a.victim === target ? 2 : 0) }))
      .sort((x, y) => y.sc - x.sc)[0]!;
    if (best.sc > 0) return best.a;
  }
  // Progress cards that pay off now.
  const prog = progressPlay(c, of('progress'), goal);
  if (prog) return prog;
  // Hard: a level that wins a metropolis (2 points) is worth trading for.
  if (c.hard) {
    const t = focusTrack(c);
    const ckv = c.v.ck!;
    const L = ckv.lvl[c.me]![t];
    const at = ckv.metro[t];
    const holder = at != null ? (c.s.verts[at]?.[0] ?? null) : null;
    const wins = L + 1 >= 4 && L < 5 && (holder == null || (holder !== c.me && L + 1 > ckv.lvl[holder]![t]));
    if (wins && plainCities(c.s, c.me).length) {
      const a = of('improve').filter((x) => x.track === t);
      if (a.length) return metroSpot(c, a);
      const com = TRACK_COM[t];
      const plan = bankPlan(c, { [com]: Math.max(0, L + 1 - (ckv.crane > 0 ? 1 : 0)) });
      if (plan && plan.length && plan.length <= 2) {
        const b = legal(acts, { type: 'bank', give: plan[0]![0], get: plan[0]![1] } as Act<'bank'>);
        if (b) return b;
      }
    }
  }
  // Improvements toward a metropolis (commodities never compete with building).
  const imp = of('improve');
  if (imp.length) {
    const t = focusTrack(c);
    const mine = imp.filter((a) => a.track === t);
    const pick = mine.length
      ? mine
      : imp.filter((a) => c.v.ck!.lvl[c.me]![a.track] < 3 && (c.hand[TRACK_COM[a.track]] ?? 0) >= 4);
    if (pick.length) return metroSpot(c, pick);
  }
  // Knights for the barbarians, a little ahead of need.
  if (has(spare, KNIGHT_COST) && risk.strength >= risk.defense && c.v.ck!.barb >= 2) {
    const kn = knightSpot(c, of('knight'));
    if (kn) return kn;
  }
  if (has(spare, ACTIVATE_COST)) {
    const act = of('activate')[0];
    if (act && (risk.close || c.hard)) return act;
  }
  if (has(spare, PROMOTE_COST) && c.v.ck!.lvl[c.me]!.politics >= 3) {
    const pro = of('promote')[0];
    if (pro) return pro;
  }
  // A wall when it keeps holding lots of cards.
  if ((c.memo.big ?? 0) >= 2 && has(spare, WALL_COST)) {
    const w = of('wall')[0];
    if (w) return w;
  }
  return null;
}

/** The improvement move, picking the city with the most production for a metropolis. */
function metroSpot(c: Ctx, opts: Act<'improve'>[]): Action {
  return [...opts].sort(
    (a, b) =>
      (b.v != null ? sumOf(yieldAt(c.s, c.g, b.v, true)) : 0) -
      (a.v != null ? sumOf(yieldAt(c.s, c.g, a.v, true)) : 0),
  )[0]!;
}

/** Where a new knight goes: next to the robber's hex if I could chase it, else beside my cities. */
function knightSpot(c: Ctx, opts: Act<'knight'>[]): Action | null {
  if (!opts.length) return null;
  const { g, s } = c;
  const score = (v: number) => {
    let sc = 0;
    if (s.board.robber >= 0 && g.hexVerts[s.board.robber]!.includes(v)) sc += 3;
    for (const u of g.verts[v]!.adj) {
      const b = s.verts[u];
      if (b && b[0] === c.me) sc += b[1];
    }
    return sc;
  };
  return [...opts].sort((a, b) => score(b.v) - score(a.v))[0]!;
}

/** A progress card worth playing now, if any. */
function progressPlay(c: Ctx, plays: Act<'progress'>[], goal: Goal | null): Action | null {
  if (!plays.length) return null;
  const { s, me, v } = c;
  const target = leader(c, c.hard);
  const ckv = v.ck!;
  let best: { a: Action; sc: number } | null = null;
  const consider = (a: Action, sc: number) => {
    if (sc > 0 && (!best || sc > best.sc)) best = { a, sc };
  };
  for (const a of plays) {
    switch (a.card as Progress) {
      case 'crane': {
        const t = focusTrack(c);
        const L = ckv.lvl[me]![t];
        const com = c.hand[TRACK_COM[t]] ?? 0;
        if (L < 5 && com === L) consider(a, 3);
        break;
      }
      case 'engineer':
        consider(a, 2);
        break;
      case 'irrigation':
      case 'mining': {
        const r = a.card === 'irrigation' ? 'wheat' : 'ore';
        const hexes = new Set<number>();
        s.verts.forEach((b, u) => {
          if (b && b[0] === me)
            for (const h of c.g.verts[u]!.hexes) if (s.board.hexes[h]!.t === r) hexes.add(h);
        });
        if (hexes.size >= 2) consider(a, hexes.size);
        break;
      }
      case 'medicine':
        if (!has(c.hand, COST.city)) consider(a, 4);
        break;
      case 'roadBuilding': {
        const { dist } = reach(c, 2);
        if (s.verts.some((_, u) => dist[u]! >= 1 && dist[u]! <= 2 && vertFree(s, u) && vertexOK(s, u)))
          consider(a, 3);
        break;
      }
      case 'smith':
        consider(a, (a.vs?.length ?? 0) * 1.5);
        break;
      case 'warlord':
        consider(a, ckv.knights.filter((k) => k && k.p === me && !k.on).length);
        break;
      case 'merchant': {
        if (a.h == null) break;
        let mine = 0;
        for (const u of c.g.hexVerts[a.h]!) {
          const b = s.verts[u];
          if (b && b[0] === me) mine += b[1];
        }
        consider(a, 1 + mine * 0.5);
        break;
      }
      case 'merchantFleet':
        if (a.r && (c.hand[a.r] ?? 0) >= 4) consider(a, (c.hand[a.r] ?? 0) / 2);
        break;
      case 'resourceMonopoly':
        if (a.r) {
          let n = 0;
          v.players.forEach(
            (p, q) => q !== me && (n += Math.min(2, c.guess ? (c.guess[q]![a.r!] ?? 0) : p.resCount / 5)),
          );
          if (n >= 3) consider(a, n);
        }
        break;
      case 'tradeMonopoly':
        if (a.r) {
          let n = 0;
          v.players.forEach(
            (p, q) => q !== me && (n += Math.min(1, c.guess ? (c.guess[q]![a.r!] ?? 0) : 0.4)),
          );
          if (n >= 2) consider(a, n);
        }
        break;
      case 'masterMerchant':
      case 'spy':
      case 'deserter':
        if (a.to === target) consider(a, 2);
        break;
      case 'wedding':
      case 'saboteur':
        consider(a, 2);
        break;
      case 'bishop':
        if (a.h != null && robberScore(c, a.h, target) > 3) consider(a, 1.5);
        break;
      case 'diplomat':
        if (a.e != null && s.edges[a.e] === target && v.longest === target) consider(a, 1.5);
        break;
      case 'intrigue':
        if (a.v != null && ckv.knights[a.v]?.p === target) consider(a, 1);
        break;
      default:
        break;
    }
  }
  return (best as { a: Action; sc: number } | null)?.a ?? null;
}

/* ---------------- Setup ---------------- */

function setupMove(c: Ctx, acts: Act<'setup'>[]): Action | null {
  if (!acts.length) return null;
  const { s, g, me, v } = c;
  const placed = s.verts.filter((b) => b && b[0] === me).length;
  const verts = [...new Set(acts.map((a) => a.v))];
  const n = v.players.length;
  const score = new Map<number, number>();
  for (const u of verts) {
    let sc = spotValue(c, u, c.prod, placed);
    // Cities & Knights: the second piece is a city, so production counts twice.
    if (s.ck && placed === 1) sc += 0.5 * sumOf(yieldAt(s, g, u, false, false));
    if (c.hard && placed === 0) sc += 0.5 * secondBest(c, u, verts, 2 * (n - 1 - Math.min(n - 1, s.setupI)));
    score.set(u, sc);
  }
  const top = Math.max(...score.values());
  const near = verts.filter((u) => score.get(u)! >= top - (c.hard ? 0.01 : 0.6));
  const at = near[nextInt(c.rng, near.length)]!;
  // The road or ship: toward the best spot two steps away.
  const mine = acts.filter((a) => a.v === at);
  const edgeScore = (a: Act<'setup'>) => {
    const E = g.edges[a.e]!;
    const u = E.a === at ? E.b : E.a;
    let best = 0;
    for (const w of g.verts[u]!.adj) {
      if (w === at || s.verts[w] || g.verts[w]!.adj.some((x) => s.verts[x] || x === at)) continue;
      best = Math.max(best, baseValue(c, w));
    }
    return best;
  };
  return [...mine].sort((a, b) => edgeScore(b) - edgeScore(a))[0]!;
}

/** Hard: how good my second spot would be after the others' picks in between. */
function secondBest(c: Ctx, first: number, verts: number[], between: number): number {
  const { g } = c;
  const taken = new Set<number>([first, ...g.verts[first]!.adj]);
  const order = verts.filter((u) => !taken.has(u)).sort((a, b) => baseValue(c, b) - baseValue(c, a));
  let k = between;
  for (const u of order) {
    if (!k) break;
    if (taken.has(u)) continue;
    taken.add(u);
    for (const w of g.verts[u]!.adj) taken.add(w);
    k--;
  }
  const y = yieldAt(c.s, g, first, false, false);
  let best = 0;
  for (const u of verts) if (!taken.has(u)) best = Math.max(best, spotValue(c, u, y, 1));
  return best;
}

/* ---------------- The move ---------------- */

export function smartMove(
  v: PlayerView,
  rng: RngState,
  memo: CpuMemo,
  pr: Persona,
  opts: CpuOptions,
): Action | null {
  const me = v.me;
  if (me == null || v.phase !== 'play' || !v.hand) return null;
  const s = stateFromView(v);
  const g = geo(s);
  const kinds = cardKinds(s);
  const hard = pr.base === 'hard';
  const c: Ctx = {
    v, s, me, pr, hard, rng, memo, opts, g, kinds,
    hand: { ...s.players[me]!.res },
    scarce: scarcity(s),
    prod: prodOf(s, g, me),
    guess: hard ? reconcile(cloneJson(memo.guess ?? newGuess(v)), v) : null,
    base: [],
  }; // prettier-ignore
  if (s.stage !== 'setup' && memo.turnN !== s.turnN) {
    memo.turnN = s.turnN;
    memo.offers = [];
    memo.moves = 0;
    memo.seen = {};
  }

  // Owed right away: discards, gold, Cities & Knights choices.
  const goal0 = () => pickGoal(c, goals(c));
  const need = mustDiscard(s, me);
  if (need) {
    const g0 = goal0();
    return { type: 'discard', cards: shedSmart(c, need, g0 ? g0.cost : {}) };
  }
  const gold = goldDue(s, me);
  if (gold) return { type: 'chooseGold', cards: goldPick(c, gold, goal0()) };
  if (s.stage === 'ck') {
    const due = ckDiscardDue(s, me);
    if (due) {
      const g0 = goal0();
      return { type: 'choose', cards: shedSmart(c, due, g0 ? g0.cost : {}) };
    }
    const o = firstOwe(s, me);
    if (o?.k === 'give') return { type: 'choose', cards: shedSmart(c, o.n, goal0()?.cost ?? {}) };
    return cpuOwedChoice(s, me, rng);
  }
  if (s.stage === 'gold') return null;
  if (s.stage === 'treasure') {
    const due = treasureDue(s, me);
    if (!due) return null;
    if (due.k === 'pick')
      return {
        type: 'treasurePick',
        cards: goldPick(c, due.n, goal0()) as Partial<Record<(typeof RES)[number], number>>,
      };
    const decks = legalActions(s, me);
    return decks[nextInt(rng, decks.length)] ?? null;
  }

  const answer = answerOffers(c);
  if (answer) return answer;
  if (s.turn !== me) return null;
  if (s.back?.asked) return { type: 'handBack' };

  const acts = legalActions(s, me).filter(
    (a) =>
      a.type !== 'respond' && a.type !== 'confirm' && a.type !== 'cancel' && !TABLE_TALK.includes(a.type),
  );
  memo.moves = (memo.moves ?? 0) + 1;
  const of = <T extends Action['type']>(t: T) => acts.filter((a) => a.type === t) as Act<T>[];
  switch (s.stage) {
    case 'setup':
      return setupMove(c, of('setup'));
    case 'robber':
      return robberChoice(
        c,
        acts.filter((a): a is RobberAct => a.type === 'robber' || a.type === 'pirate'),
      );
    case 'roads': {
      const pieces = acts.filter(
        (a): a is Act<'freeRoad'> | Act<'freeShip'> => a.type === 'freeRoad' || a.type === 'freeShip',
      );
      return freePiece(c, pieces) ?? of('skipRoads')[0] ?? null;
    }
    case 'preroll':
      return prerollMove(c, acts);
    case 'main':
      return mainMove(c, acts);
    default:
      return null;
  }
}

function goldPick(c: Ctx, n: number, goal: Goal | null): Cards {
  const out: Cards = {};
  const bank: Cards = { ...c.s.bank };
  const hand: Cards = { ...c.hand };
  for (let i = 0; i < n; i++) {
    const miss = goal
      ? (Object.keys(missingOf(hand, goal.cost)) as Card[]).filter((k) => isResource(k) && (bank[k] ?? 0) > 0)
      : [];
    const r = (miss[0] ??
      RES.filter((x) => (bank[x] ?? 0) > 0).sort(
        (a, b) => (hand[a] ?? 0) - (hand[b] ?? 0) || cardVal(c, b) - cardVal(c, a),
      )[0]) as Resource;
    bank[r] = (bank[r] ?? 0) - 1;
    hand[r] = (hand[r] ?? 0) + 1;
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}

/** A free road or ship (Road Building): toward the best spot, else the longest route. */
function freePiece(c: Ctx, pieces: (Act<'freeRoad'> | Act<'freeShip'>)[]): Action | null {
  if (!pieces.length) return null;
  const { dist, first } = reach(c);
  let best: { a: Action; sc: number } | null = null;
  for (let u = 0; u < c.s.verts.length; u++) {
    const d = dist[u]!;
    if (d < 1 || d > 4 || !vertFree(c.s, u) || !vertexOK(c.s, u)) continue;
    const a = pieces.find((x) => x.e === first[u]);
    if (!a) continue;
    const sc = spotValue(c, u) / d;
    if (!best || sc > best.sc) best = { a, sc };
  }
  if (best) return best.a;
  const longest = [...pieces].sort(
    (a, b) =>
      routeWith(c, { type: a.type === 'freeRoad' ? 'road' : 'ship', e: b.e } as Act<'road'>) -
      routeWith(c, { type: a.type === 'freeRoad' ? 'road' : 'ship', e: a.e } as Act<'road'>),
  );
  return longest[0]!;
}

function prerollMove(c: Ctx, acts: Action[]): Action | null {
  const knight = acts.find((a) => a.type === 'playKnight');
  if (knight) {
    const robbed = robberScore(c, c.s.board.robber, null) < -4;
    const mine = c.v.players[c.me]!.knights;
    const top = Math.max(0, ...c.v.players.filter((_, q) => q !== c.me).map((p) => p.knights));
    const takes = c.v.largest !== c.me && mine + 1 >= 3 && mine + 1 > top && c.pr.focus !== 'ignore';
    // Hard keeps up in the race for Largest Army, a knight at a time.
    const race = c.hard && c.pr.focus !== 'ignore' && mine + 1 >= top;
    if (robbed || takes || race) return knight;
  }
  // Hard: an Alchemist when a chosen roll pays well.
  if (c.hard) {
    const alch = acts.filter(
      (a): a is Act<'progress'> => a.type === 'progress' && a.card === 'alchemist' && !!a.d,
    );
    if (alch.length) {
      const pay = (d: [number, number]) => {
        const sum = d[0] + d[1];
        let n = 0;
        c.s.verts.forEach((b, u) => {
          if (!b) return;
          for (const h of c.g.verts[u]!.hexes) {
            const hx = c.s.board.hexes[h]!;
            if (hx.n === sum && h !== c.s.board.robber && (isResource(hx.t) || hx.t === 'gold'))
              n += (b[0] === c.me ? 1 : -0.4) * b[1];
          }
        });
        return n;
      };
      const best = alch.map((a) => ({ a, n: pay(a.d!) })).sort((x, y) => y.n - x.n)[0]!;
      if (best.n >= 3) return best.a;
    }
  }
  return acts.find((a) => a.type === 'roll') ?? null;
}

function mainMove(c: Ctx, acts: Action[]): Action | null {
  const { v, me, memo } = c;
  const end = acts.find((a) => a.type === 'end') ?? null;
  // A safety net: never more than this many moves in one turn.
  if ((memo.moves ?? 0) > 150) return end;

  const open = v.offers.find((o) => o.from === me);
  if (open) return manageOffer(c, open);

  const gs = goals(c);
  const goal = pickGoal(c, gs);

  const dev = devPlay(c, acts, goal);
  if (dev) return dev;
  if (c.s.ck) {
    const ckm = ckMain(c, acts, goal);
    if (ckm) return ckm;
  }

  // Build the goal, or trade with the bank to complete it this turn.
  if (goal) {
    if (has(c.hand, goal.cost)) {
      const a = legal(acts, goal.act);
      if (a) return a;
    } else {
      const plan = bankPlan(c, goal.cost);
      if (plan && plan.length) {
        const a = legal(acts, { type: 'bank', give: plan[0]![0], get: plan[0]![1] } as Act<'bank'>);
        if (a) return a;
      }
      const offer = makeOffer(c, goal);
      if (offer) return offer;
    }
  }
  // Anything else worth building with cards the goal doesn't need.
  const spare = minus(c.hand, goal ? reserveOf(c.hand, goal.cost) : {});
  const rest = gs.filter((x) => x !== goal).sort((a, b) => b.value - a.value);
  for (const x of rest) {
    if (!has(spare, x.cost)) continue;
    if (
      x.kind === 'dev' &&
      goal &&
      goal.kind !== 'dev' &&
      c.pr.style !== 'cards' &&
      !c.hard &&
      total(spare) < 5
    )
      continue;
    const a = legal(acts, x.act);
    if (a) return a;
  }

  // End of turn: don't sit on too many cards for a 7.
  const pl = c.s.players[me]!;
  if (total(pl.res) > handLimit(c.s, me)) {
    for (const x of [goal, ...rest]) {
      if (!x || !has(c.hand, x.cost)) continue;
      const a = legal(acts, x.act);
      if (a) return a;
    }
    const banks = acts.filter((a): a is Act<'bank'> => a.type === 'bank');
    const keep = goal ? goal.cost : {};
    const surplus = (k: Card) => (c.hand[k] ?? 0) - (keep[k] ?? 0) - rateFor(c.s, me, k);
    const trade = banks
      .filter((a) => surplus(a.give) >= 0 && (isResource(a.get) || !c.s.ck))
      .sort(
        (a, b) => surplus(b.give) - surplus(a.give) || cardVal(c, b.get, keep) - cardVal(c, a.get, keep),
      )[0];
    if (trade) return trade;
    // Nothing spare: still trade down rather than sit on the cards for a 7.
    const any = [...banks].sort(
      (a, b) =>
        (c.hand[b.give] ?? 0) - (c.hand[a.give] ?? 0) || cardVal(c, b.get, keep) - cardVal(c, a.get, keep),
    )[0];
    if (any) return any;
    memo.big = (memo.big ?? 0) + 1;
  }
  const drops = acts.filter((a): a is Act<'dropProgress'> => a.type === 'dropProgress');
  if (drops.length) return drops[nextInt(c.rng, drops.length)]!;
  return end;
}
