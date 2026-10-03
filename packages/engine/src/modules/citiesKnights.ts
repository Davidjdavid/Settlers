/*
 * Cities & Knights, as specified in docs/rules/cities-and-knights.md. Plugs into the base rules
 * (and Seafarers) through the hooks in api.ts. Progress cards are in ckProgress.ts.
 */

import { checkWin, cleanCounts, continueRoll, gain, isInt, pay, stealRandom, transfer, updateLongest } from '../ops'; // prettier-ignore
import {
  geo, has, legalRoads, robberAwake, robberHexOK, robberVictims, roadOK, supplyOf, total, vertexOK,
} from '../queries'; // prettier-ignore
import { nextInt, shuffle } from '../rng';
import {
  COMS, PROGRESS, PROGRESS_VP, RES, TRACKS, TRACK_COM, isCommodity, isLand, trackOf, type Card, type Cards,
  type Action, type CKState, type Commodity, type GameEvent, type GameState, type Knight, type Owe, type Progress,
  type Resource, type Seat, type Track,
} from '../types'; // prettier-ignore
import { mods, type Ctx, type RuleModule } from './api';
import { legalProgress, playProgress } from './ckProgress';

/** Commodities are unlimited; the bank starts with this many so the count stays conserved. */
export const CK_BANK = 10000;
export const KNIGHT_COST = { sheep: 1, ore: 1 };
export const PROMOTE_COST = { sheep: 1, ore: 1 };
export const ACTIVATE_COST = { wheat: 1 };
export const WALL_COST = { brick: 2 };
/** Knights of each strength per player. */
export const KNIGHTS_EACH = 2;
export const WALLS = 3;
export const PROGRESS_LIMIT = 4;
export const DEFENDERS = 6;
/** The barbarians attack on reaching this step. */
export const BARB_STEPS = 7;
/** Event die faces. */
export const EVENT_FACES = ['ship', 'ship', 'ship', 'trade', 'politics', 'science'] as const;
/** The commodity a city gets on each terrain, besides one resource. */
export const COM_OF: Partial<Record<Resource, Commodity>> = { wood: 'paper', sheep: 'cloth', ore: 'coin' };

export const ck = (s: GameState): CKState => s.ck!;

/* ---------- Small queries ---------- */

export const cityVerts = (s: GameState, p: Seat): number[] =>
  s.verts.flatMap((b, v) => (b && b[0] === p && b[1] === 2 ? [v] : []));

export const metroAt = (s: GameState, v: number): Track | null =>
  TRACKS.find((t) => ck(s).metro[t] === v) ?? null;

export const metroOwner = (s: GameState, t: Track): Seat | null => {
  const v = ck(s).metro[t];
  return v == null ? null : (s.verts[v]?.[0] ?? null);
};

/** Cities without a metropolis. */
export const plainCities = (s: GameState, p: Seat): number[] =>
  cityVerts(s, p).filter((v) => metroAt(s, v) == null);

export const wallsOf = (s: GameState, p: Seat): number =>
  ck(s).walls.filter((v) => s.verts[v]?.[0] === p).length;

/** Total strength of p's active knights. */
export const activeStrength = (s: GameState, p: Seat): number =>
  ck(s).knights.reduce((a, k) => a + (k && k.p === p && k.on ? k.lvl : 0), 0);

/** p's knights of strength lvl in play (on the board, or displaced and waiting to be placed). */
export function knightsOf(s: GameState, p: Seat, lvl: number): number {
  const c = ck(s);
  let n = c.knights.filter((k) => k && k.p === p && k.lvl === lvl).length;
  for (const o of c.owe) if (o.k === 'relocate' && o.p === p && o.lvl === lvl) n++;
  return n;
}

export const eventDieOn = (s: GameState): boolean =>
  s.turnN > (s.config.houseRules?.barbarianDelay ?? 0) * s.players.length;

/** May p place a knight on v (empty land corner touching p's road, or ship with Seafarers)? */
export function knightSpotOK(s: GameState, p: Seat, v: number): boolean {
  if (!isInt(v) || v < 0 || v >= s.verts.length) return false;
  if (s.verts[v] || ck(s).knights[v] || !vertexOK(s, v)) return false;
  return geo(s).verts[v]!.edges.some((e) => s.edges[e] === p || s.sea?.ships[e] === p);
}

export function knightSpots(s: GameState, p: Seat): number[] {
  const out: number[] = [];
  for (let v = 0; v < s.verts.length; v++) if (knightSpotOK(s, p, v)) out.push(v);
  return out;
}

/** Can the knight at v be promoted now (ignoring cost)? */
export function canPromote(s: GameState, p: Seat, v: number): boolean {
  const k = isInt(v) ? ck(s).knights[v] : null;
  if (!k || k.p !== p || k.up || k.lvl >= 3) return false;
  if (k.lvl === 2 && ck(s).lvl[p]!.politics < 3) return false;
  return knightsOf(s, p, k.lvl + 1) < KNIGHTS_EACH;
}

/** Can the knight at v take an action now? */
export function canAct(s: GameState, p: Seat, v: number): boolean {
  const k = isInt(v) ? ck(s).knights[v] : null;
  return !!k && k.p === p && k.on && !k.fresh;
}

/**
 * Where the knight at `from` can move: corners reached along p's own roads, passing only
 * through corners without other players' pieces. Empty corners, or a weaker opponent knight.
 */
export function knightMoves(s: GameState, p: Seat, from: number): number[] {
  const g = geo(s);
  const c = ck(s);
  const me = c.knights[from];
  if (!me) return [];
  const out: number[] = [];
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const v = stack.pop()!;
    for (const e of g.verts[v]!.edges) {
      if (s.edges[e] !== p) continue;
      const E = g.edges[e]!;
      const w = E.a === v ? E.b : E.a;
      if (seen.has(w)) continue;
      seen.add(w);
      const b = s.verts[w];
      const k = c.knights[w];
      if (!b && !k) {
        out.push(w);
        stack.push(w);
      } else if (k && k.p !== p) {
        if (k.lvl < me.lvl) out.push(w);
      } else if ((b && b[0] === p) || (k && k.p === p)) {
        stack.push(w); // pass through your own pieces
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** A road with an end touching none of its owner's other roads, ships or buildings. */
export function isOpenRoad(s: GameState, e: number): boolean {
  const o = isInt(e) ? s.edges[e] : null;
  if (o == null) return false;
  const g = geo(s);
  const E = g.edges[e]!;
  return [E.a, E.b].some((v) => {
    const b = s.verts[v];
    if (b && b[0] === o) return false;
    return !g.verts[v]!.edges.some((f) => f !== e && (s.edges[f] === o || s.sea?.ships[f] === o));
  });
}

/** Progress cards each player holds, by colour (public). */
export function progressColors(s: GameState, p: Seat): Record<Track, number> {
  const out = { trade: 0, politics: 0, science: 0 };
  for (const c of ck(s).hands[p]!) out[trackOf(c)]++;
  return out;
}

/* ---------- Owed choices ---------- */

/** Start (or extend) the owed-choices stage. */
export function owe(s: GameState, list: Owe[], events: GameEvent[]) {
  if (!list.length) return;
  const c = ck(s);
  if (s.stage !== 'ck') {
    c.back = s.stage;
    s.stage = 'ck';
  }
  c.owe.push(...list);
  events.push({ k: 'owe', owe: JSON.parse(JSON.stringify(list)) });
}

/** When nothing more is owed, go back (or finish the roll). */
export function settle(x: Ctx) {
  const { s } = x;
  const c = ck(s);
  if (s.stage !== 'ck' || c.owe.length) return;
  const then = c.then;
  const back = c.back;
  c.then = null;
  c.back = null;
  if (then === 'produce') continueRoll(x);
  else s.stage = back ?? 'main';
}

export const firstOwe = (s: GameState, p: Seat): Owe | null =>
  s.stage === 'ck' ? (ck(s).owe.find((o) => o.p === p) ?? null) : null;

/* ---------- Pieces and cards ---------- */

/** A displaced (or intrigued) knight: place it, remove it, or ask its owner where. */
export function displace(x: Ctx, owner: Seat, k: Knight, not: number) {
  const { s, events } = x;
  const spots = knightSpots(s, owner).filter((v) => v !== not);
  if (!spots.length) {
    events.push({ k: 'relocate', p: owner, to: null });
  } else if (spots.length === 1) {
    ck(s).knights[spots[0]!] = { p: owner, lvl: k.lvl, on: k.on };
    events.push({ k: 'relocate', p: owner, to: spots[0]! });
  } else {
    owe(s, [{ k: 'relocate', p: owner, lvl: k.lvl, on: k.on, not }], events);
  }
}

/** Draw the top card of a deck. */
export function drawProgress(s: GameState, p: Seat, t: Track, events: GameEvent[]) {
  const c = ck(s);
  const card = c.decks[t].shift();
  if (!card) return;
  if (PROGRESS_VP.includes(card)) {
    c.shown[p]!.push(card);
    events.push({ k: 'draw', p, track: t, card });
    return;
  }
  c.hands[p]!.push(card);
  events.push({ k: 'draw', p, track: t, card });
  if (c.hands[p]!.length > PROGRESS_LIMIT && p !== s.turn) owe(s, [{ k: 'overflow', p }], events);
}

/** Put a progress card from p's hand under its deck. */
export function returnProgress(s: GameState, p: Seat, card: Progress) {
  const c = ck(s);
  const i = c.hands[p]!.indexOf(card);
  c.hands[p]!.splice(i, 1);
  c.decks[trackOf(card)].push(card);
}

export function reduceCity(s: GameState, p: Seat, v: number, events: GameEvent[]) {
  s.verts[v] = [p, 1];
  s.players[p]!.pieces.city++;
  s.players[p]!.pieces.settlement--;
  ck(s).walls = ck(s).walls.filter((w) => w !== v);
  events.push({ k: 'cityLost', p, v });
}

/* ---------- The barbarians ---------- */

function attack(x: Ctx) {
  const { s, events } = x;
  const c = ck(s);
  const n = s.players.length;
  const strength = s.verts.filter((b) => b && b[1] === 2).length;
  const str = s.players.map((_, p) => activeStrength(s, p));
  const defense = str.reduce((a, b) => a + b, 0);
  const owed: Owe[] = [];
  let losers: Seat[] = [];
  let defender: Seat | null = null;
  let tied: Seat[] = [];
  const order = Array.from({ length: n }, (_, i) => (s.turn + i) % n);
  if (strength > defense) {
    const atRisk = order.filter((p) => plainCities(s, p).length > 0);
    if (atRisk.length) {
      const low = Math.min(...atRisk.map((p) => str[p]!));
      losers = atRisk.filter((p) => str[p] === low);
    }
  } else {
    const best = Math.max(...str);
    if (best > 0) {
      const top = order.filter((p) => str[p] === best);
      if (top.length === 1 && c.defender.reduce((a, b) => a + b, 0) < DEFENDERS) defender = top[0]!;
      else tied = top;
    }
  }
  events.push({ k: 'attack', strength, defense, losers, defender, tied });
  for (const p of losers) {
    const cities = plainCities(s, p);
    if (cities.length === 1) reduceCity(s, p, cities[0]!, events);
    else owed.push({ k: 'loseCity', p });
  }
  if (defender != null) c.defender[defender]!++;
  if (TRACKS.some((t) => c.decks[t].length)) for (const p of tied) owed.push({ k: 'defenderDraw', p });
  for (const k of c.knights) {
    if (!k) continue;
    k.on = false;
    delete k.fresh;
  }
  c.barb = 0;
  c.attacks++;
  owe(s, owed, events);
}

/* ---------- The module ---------- */

const PLACEHOLDER: Record<Track, Progress> = { trade: 'merchant', politics: 'spy', science: 'crane' };

export const citiesKnights: RuleModule = {
  id: 'citiesKnights',
  players: [3, 4],
  cards: COMS,
  noDevCards: true,
  looseBuildings: true,

  init(s) {
    const deck = (t: Track) =>
      shuffle(
        Object.entries(PROGRESS[t]).flatMap(([k, n]) => new Array<Progress>(n).fill(k as Progress)),
        s.rng,
      );
    s.ck = {
      lvl: s.players.map(() => ({ trade: 0, politics: 0, science: 0 })),
      metro: { trade: null, politics: null, science: null },
      walls: [],
      knights: new Array(s.verts.length).fill(null),
      barb: 0,
      attacks: 0,
      decks: { trade: deck('trade'), politics: deck('politics'), science: deck('science') },
      hands: s.players.map(() => []),
      shown: s.players.map(() => []),
      defender: s.players.map(() => 0),
      merchant: null,
      fleet: [],
      crane: 0,
      alchemy: null,
      event: null,
      owe: [],
      back: null,
      then: null,
    };
    for (const pl of s.players) for (const c of COMS) pl.res[c] = 0;
    for (const c of COMS) s.bank[c] = supplyOf(s, c);
  },

  vertexTaken: (s, v) => ck(s).knights[v] != null,
  blocks: (s, p, v) => {
    const k = ck(s).knights[v];
    return !!k && k.p !== p;
  },
  setupCity: (_s, second) => second,
  yieldOf: (_s, t, size) => (size === 2 && (t === 'brick' || t === 'wheat') ? 2 : 1),
  rate(s, p, card) {
    const c = ck(s);
    let r: number | undefined;
    if (isCommodity(card) && c.lvl[p]!.trade >= 3) r = 2;
    if (c.merchant?.p === p && s.board.hexes[c.merchant.h]!.t === card) r = 2;
    if (s.turn === p && c.fleet.includes(card)) r = 2;
    return r;
  },
  handLimit(s, p) {
    if (s.config.houseRules?.noDiscardBeforeAttack && ck(s).attacks === 0) return Infinity;
    return 7 + 2 * wallsOf(s, p);
  },
  robberAsleep: (s) => ck(s).attacks === 0,
  vpParts(s, p) {
    const c = ck(s);
    const metros = TRACKS.filter((t) => metroOwner(s, t) === p).length;
    return [
      { k: 'metropolis', n: metros, vp: 2 * metros },
      { k: 'defender', n: c.defender[p]!, vp: c.defender[p]! },
      { k: 'merchant', n: c.merchant?.p === p ? 1 : 0, vp: c.merchant?.p === p ? 1 : 0 },
      { k: 'progress', n: c.shown[p]!.length, vp: c.shown[p]!.length },
    ];
  },
  piecesLeft: (s, p) => ({
    knight1: KNIGHTS_EACH - knightsOf(s, p, 1),
    knight2: KNIGHTS_EACH - knightsOf(s, p, 2),
    knight3: KNIGHTS_EACH - knightsOf(s, p, 3),
    wall: WALLS - wallsOf(s, p),
  }),
  extraVP(s, p) {
    const c = ck(s);
    let vp = c.defender[p]! + c.shown[p]!.length + (c.merchant?.p === p ? 1 : 0);
    for (const t of TRACKS) if (metroOwner(s, t) === p) vp += 2;
    return vp;
  },

  fixedDice: (s) => ck(s).alchemy,
  rerollSeven: (s) => !!s.config.houseRules?.rerollBeforeAttack && ck(s).attacks === 0,

  afterRoll(x) {
    const { s, events } = x;
    const c = ck(s);
    c.alchemy = null;
    if (!eventDieOn(s)) {
      c.event = null;
      return false;
    }
    const face = EVENT_FACES[x.die('event') - 1]!;
    c.event = face;
    events.push({ k: 'eventDie', face });
    if (face === 'ship') {
      c.barb++;
      events.push({ k: 'barbarians', at: c.barb });
      if (c.barb >= BARB_STEPS) attack(x);
    } else {
      const red = s.dice![1];
      const n = s.players.length;
      for (let i = 0; i < n; i++) {
        const p = (s.turn + i) % n;
        const L = c.lvl[p]![face];
        if (L >= 1 && red <= L + 1) drawProgress(s, p, face, events);
      }
    }
    if (s.stage === 'ck') {
      c.then = 'produce';
      return true;
    }
    return false;
  },

  afterProduce(x, roll) {
    const { s, events } = x;
    const c = ck(s);
    const g = geo(s);
    const gains: Record<number, Cards> = {};
    s.board.hexes.forEach((h, hi) => {
      const com = COM_OF[h.t as Resource];
      if (h.n !== roll || hi === s.board.robber || !com) return;
      for (const v of g.hexVerts[hi]!) {
        const b = s.verts[v];
        if (!b || b[1] !== 2) continue;
        const gp = (gains[b[0]] ??= {});
        gp[com] = (gp[com] ?? 0) + 1;
      }
    });
    // A limited bank (SPEC 8.1, our ruling for commodities): if it can't pay everyone owed a
    // commodity, nobody gets it, unless only one player is owed it (they get what's left).
    const short: Commodity[] = [];
    for (const com of COMS) {
      const who = Object.keys(gains).filter((p) => gains[Number(p)]![com]);
      const need = who.reduce((a, p) => a + gains[Number(p)]![com]!, 0);
      if (!need || need <= s.bank[com]!) continue;
      short.push(com);
      if (who.length === 1 && s.bank[com]! > 0) gains[Number(who[0])]![com] = s.bank[com]!;
      else for (const p of who) delete gains[Number(p)]![com];
    }
    for (const [p, cards] of Object.entries(gains)) {
      for (const [com, n] of Object.entries(cards) as [Card, number][]) gain(s, Number(p), com, n);
      if (!Object.keys(cards).length) delete gains[Number(p)];
    }
    if (Object.keys(gains).length || short.length)
      events.push({ k: 'commodities', gains, ...(short.length ? { short } : {}) });
    // Aqueduct: a roll that gave you nothing at all gives you a resource of your choice.
    const got = new Set<number>(Object.keys(gains).map(Number));
    for (const e of events) {
      if (e.k === 'produce') for (const p of Object.keys(e.gains)) got.add(Number(p));
      if (e.k === 'goldOwed') for (const p of Object.keys(e.owed)) got.add(Number(p));
    }
    if (!RES.some((r) => s.bank[r] > 0)) return;
    const owed: Owe[] = [];
    s.players.forEach((_, p) => {
      if (c.lvl[p]!.science >= 3 && !got.has(p)) owed.push({ k: 'aqueduct', p });
    });
    owe(s, owed, events);
  },

  onTurnEnd(s) {
    const c = ck(s);
    for (const k of c.knights) {
      if (!k) continue;
      delete k.fresh;
      delete k.up;
    }
    c.fleet = [];
    c.crane = 0;
  },

  endTurnBlock: (s, p) =>
    ck(s).hands[p]!.length > PROGRESS_LIMIT ? 'You can keep 4 progress cards: play or put one back' : null,

  waitingOn(s) {
    if (s.stage !== 'ck') return undefined;
    return [...new Set(ck(s).owe.map((o) => o.p))];
  },

  reduce(x, a) {
    const r = reduceCK(x, a);
    // Knights can break roads (and so move Longest Road), so any action may decide the game.
    if (r === null) checkWin(x.s, x.events);
    return r;
  },

  legal(s, p, out) {
    const c = ck(s);
    if (s.stage === 'ck') {
      const o = firstOwe(s, p);
      if (o) legalChoices(s, o, out);
      return;
    }
    if (s.turn !== p) return;
    const me = s.players[p]!;
    if (s.stage === 'main') {
      if (cityVerts(s, p).length) {
        for (const t of TRACKS) {
          const L = c.lvl[p]![t];
          if (L >= 5) continue;
          const cost = Math.max(0, L + 1 - (c.crane > 0 ? 1 : 0));
          if (me.res[TRACK_COM[t]]! < cost) continue;
          const holder = metroOwner(s, t);
          const wins = L + 1 >= 4 && (holder == null || (holder !== p && L + 1 > c.lvl[holder]![t]));
          if (!wins) out.push({ type: 'improve', track: t });
          else for (const v of plainCities(s, p)) out.push({ type: 'improve', track: t, v });
        }
      }
      if (has(me.res, WALL_COST) && wallsOf(s, p) < WALLS) {
        for (const v of cityVerts(s, p)) if (!c.walls.includes(v)) out.push({ type: 'wall', v });
      }
      if (has(me.res, KNIGHT_COST) && knightsOf(s, p, 1) < KNIGHTS_EACH) {
        for (const v of knightSpots(s, p)) out.push({ type: 'knight', v });
      }
      c.knights.forEach((k, v) => {
        if (!k || k.p !== p) return;
        if (has(me.res, PROMOTE_COST) && canPromote(s, p, v)) out.push({ type: 'promote', v });
        if (!k.on && has(me.res, ACTIVATE_COST)) out.push({ type: 'activate', v });
        if (!canAct(s, p, v)) return;
        for (const to of knightMoves(s, p, v)) out.push({ type: 'moveKnight', from: v, to });
        if (robberAwake(s) && s.board.robber >= 0 && geo(s).hexVerts[s.board.robber]!.includes(v)) {
          for (let h = 0; h < s.board.hexes.length; h++) {
            if (h === s.board.robber || !robberHexOK(s, h)) continue;
            const victims = robberVictims(s, p, h);
            if (!victims.length) out.push({ type: 'chase', v, hex: h });
            for (const victim of victims) out.push({ type: 'chase', v, hex: h, victim });
          }
        }
      });
      if (c.hands[p]!.length > PROGRESS_LIMIT) {
        for (const card of new Set(c.hands[p])) out.push({ type: 'dropProgress', card });
      }
    }
    legalProgress(s, p, out);
  },

  invariants(s) {
    const bad: string[] = [];
    const c = s.ck;
    if (!c) return ['cities & knights state missing'];
    const n = s.players.length;
    // Commodities are conserved (the bank is a large running count) and never negative.
    for (const k of COMS) {
      const held = s.players.reduce((a, pl) => a + (pl.res[k] ?? NaN), 0);
      if (held + (s.bank[k] ?? NaN) !== supplyOf(s, k))
        bad.push(`${k}: bank ${s.bank[k]} + hands ${held} != ${supplyOf(s, k)}`);
      s.players.forEach((pl, p) => (pl.res[k] ?? 0) < 0 && bad.push(`player ${p} ${k} negative`));
    }
    // Progress cards: each deck's cards are all somewhere, exactly once.
    for (const t of TRACKS) {
      const count: Record<string, number> = {};
      for (const card of c.decks[t]) count[card] = (count[card] ?? 0) + 1;
      for (let p = 0; p < n; p++) {
        for (const card of [...c.hands[p]!, ...c.shown[p]!])
          if (trackOf(card) === t) count[card] = (count[card] ?? 0) + 1;
      }
      for (const card of c.decks[t]) if (trackOf(card) !== t) bad.push(`${card} in the ${t} deck`);
      const want = PROGRESS[t] as Record<string, number>;
      for (const k of new Set([...Object.keys(want), ...Object.keys(count)])) {
        if ((count[k] ?? 0) !== (want[k] ?? 0))
          bad.push(`progress ${t} ${k}: ${count[k] ?? 0} != ${want[k] ?? 0}`);
      }
    }
    for (let p = 0; p < n; p++) {
      const h = c.hands[p]!.length;
      const overflowing = c.owe.some((o) => o.k === 'overflow' && o.p === p);
      // On your own turn you may hold one over the limit until you put one back; each treasure
      // that gave a progress card, on a spot or in the fog, can add one more (treasures.md 4.4, D9).
      const extra = s.tr ? [...s.tr.found, ...(s.tr.fogFound ?? [])].filter((f) => f.k === 'dev').length : 0;
      if (h > PROGRESS_LIMIT + 1 + extra) bad.push(`player ${p} holds ${h} progress cards`);
      if (h > PROGRESS_LIMIT && p !== s.turn && !overflowing)
        bad.push(`player ${p} holds ${h} progress cards off-turn`);
      if (c.hands[p]!.some((x) => PROGRESS_VP.includes(x))) bad.push(`player ${p} holds a VP progress card`);
      if (c.shown[p]!.some((x) => !PROGRESS_VP.includes(x))) bad.push(`player ${p} shows a non-VP card`);
    }
    // The barbarians.
    if (!(c.barb >= 0 && c.barb < BARB_STEPS)) bad.push(`barbarians at ${c.barb}`);
    if (!(c.attacks >= 0)) bad.push(`attacks ${c.attacks}`);
    // Knights.
    const g = geo(s);
    for (let p = 0; p < n; p++) {
      for (const lvl of [1, 2, 3]) {
        if (knightsOf(s, p, lvl) > KNIGHTS_EACH)
          bad.push(`player ${p} has ${knightsOf(s, p, lvl)} knights of strength ${lvl}`);
      }
      if (knightsOf(s, p, 3) > 0 && c.lvl[p]!.politics < 3)
        bad.push(`player ${p} has a mighty knight without a fortress`);
    }
    c.knights.forEach((k, v) => {
      if (!k) return;
      if (s.verts[v]) bad.push(`knight and building at ${v}`);
      if (!g.verts[v]!.hexes.some((h) => isLand(s.board.hexes[h]!.t))) bad.push(`knight at sea corner ${v}`);
      if (![1, 2, 3].includes(k.lvl)) bad.push(`knight at ${v} has strength ${k.lvl}`);
      if ((k.fresh || k.up) && k.p !== s.turn) bad.push(`knight at ${v} has turn flags off-turn`);
      if (k.fresh && !k.on) bad.push(`knight at ${v} is fresh but inactive`);
    });
    // Improvements and metropolises.
    for (let p = 0; p < n; p++) {
      for (const t of TRACKS) {
        const L = c.lvl[p]![t];
        if (!(L >= 0 && L <= 5 && Number.isInteger(L))) bad.push(`player ${p} ${t} level ${L}`);
      }
    }
    const metroVerts = new Set<number>();
    for (const t of TRACKS) {
      const v = c.metro[t];
      const top = Math.max(...c.lvl.map((l) => l[t]));
      if (v == null) {
        if (top >= 4) bad.push(`nobody holds the ${t} metropolis but someone has level ${top}`);
        continue;
      }
      const b = s.verts[v];
      if (!b || b[1] !== 2) bad.push(`${t} metropolis at ${v} is not on a city`);
      else if (c.lvl[b[0]]![t] < 4 || c.lvl[b[0]]![t] < top)
        bad.push(`${t} metropolis holder ${b[0]} has level ${c.lvl[b[0]]![t]}`);
      if (metroVerts.has(v)) bad.push(`two metropolises at ${v}`);
      metroVerts.add(v);
    }
    // Walls.
    if (new Set(c.walls).size !== c.walls.length) bad.push('two walls on one city');
    for (const v of c.walls) if (s.verts[v]?.[1] !== 2) bad.push(`wall at ${v} without a city`);
    for (let p = 0; p < n; p++) if (wallsOf(s, p) > WALLS) bad.push(`player ${p} has ${wallsOf(s, p)} walls`);
    // Defender of Catan, merchant.
    if (c.defender.reduce((a, b) => a + b, 0) > DEFENDERS) bad.push(`defender cards ${c.defender}`);
    if (c.merchant && !(c.merchant.h >= 0 && isLand(s.board.hexes[c.merchant.h]!.t)))
      bad.push('merchant off the land');
    // Stages.
    if (s.phase === 'play' && (s.stage === 'ck') !== c.owe.length > 0)
      bad.push(`stage ${s.stage} with ${c.owe.length} owed`);
    if (s.stage !== 'ck' && (c.back != null || c.then != null))
      bad.push(`ck back ${c.back} then ${c.then} outside the ck stage`);
    if (c.alchemy && s.stage !== 'preroll') bad.push('alchemy outside the roll');
    // No development cards.
    if (
      s.players.some(
        (pl) =>
          pl.vpCards ||
          pl.knights ||
          Object.values(pl.dev).some(Boolean) ||
          Object.values(pl.fresh).some(Boolean),
      )
    )
      bad.push('a player has development cards');
    // A sleeping robber hasn't moved (pirate too).
    if (c.attacks === 0 && s.stage === 'robber') bad.push('robber stage while the robber sleeps');
    return bad;
  },

  transition(prev, next) {
    const bad: string[] = [];
    const a = prev.ck!;
    const b = next.ck!;
    if (
      a.attacks === 0 &&
      (prev.board.robber !== next.board.robber || prev.board.pirate !== next.board.pirate)
    )
      bad.push('the robber moved while asleep');
    if (b.attacks === a.attacks) {
      if (!(b.barb === a.barb || b.barb === a.barb + 1)) bad.push(`barbarians ${a.barb} -> ${b.barb}`);
    } else if (b.attacks !== a.attacks + 1 || b.barb !== 0 || a.barb !== BARB_STEPS - 1) {
      bad.push(`attack ${a.attacks} -> ${b.attacks} with barbarians ${a.barb} -> ${b.barb}`);
    } else if (b.knights.some((k) => k?.on)) {
      bad.push('a knight is still active after the attack');
    }
    if (b.barb !== a.barb && !(eventDieOn(prev) && prev.stage === 'preroll'))
      bad.push('barbarians moved outside a roll');
    for (let p = 0; p < next.players.length; p++) {
      for (const t of TRACKS) if (b.lvl[p]![t] < a.lvl[p]![t]) bad.push(`player ${p} ${t} level went down`);
    }
    // New knight positions touch their owner's roads (or ships).
    const g = geo(next);
    b.knights.forEach((k, v) => {
      if (!k) return;
      const old = a.knights[v];
      if (old && old.p === k.p) return;
      if (!g.verts[v]!.edges.some((e) => next.edges[e] === k.p || next.sea?.ships[e] === k.p))
        bad.push(`knight placed at ${v} away from its owner's roads`);
    });
    // A knight acts (moves or chases) at most once per turn and never the turn it was activated.
    if (prev.turn === next.turn) {
      a.knights.forEach((k, v) => {
        if (!k || !k.fresh) return;
        const now = b.knights[v];
        if (!now || now.p !== k.p || !now.on) bad.push(`fresh knight at ${v} acted`);
      });
    }
    const defA = a.defender.reduce((x, y) => x + y, 0);
    const defB = b.defender.reduce((x, y) => x + y, 0);
    if (defB !== defA && (defB !== defA + 1 || b.attacks !== a.attacks + 1))
      bad.push('defender card given outside an attack');
    return bad;
  },

  view(s, seat, v) {
    const c = ck(s);
    const o = seat != null ? firstOwe(s, seat) : null;
    let reveal: CKView['reveal'] = null;
    if (o?.k === 'spy') reveal = { from: o.from, progress: c.hands[o.from]!.slice() };
    if (o?.k === 'take') reveal = { from: o.from, hand: { ...s.players[o.from]!.res } };
    v.ck = JSON.parse(
      JSON.stringify({
        lvl: c.lvl,
        metro: c.metro,
        walls: c.walls,
        knights: c.knights,
        barb: c.barb,
        attacks: c.attacks,
        decks: {
          trade: c.decks.trade.length,
          politics: c.decks.politics.length,
          science: c.decks.science.length,
        },
        colors: s.players.map((_, p) => progressColors(s, p)),
        hand: seat != null ? c.hands[seat]!.slice() : null,
        shown: c.shown,
        defender: c.defender,
        merchant: c.merchant,
        fleet: c.fleet,
        crane: c.crane,
        alchemy: c.alchemy,
        event: c.event,
        owe: c.owe,
        back: c.back,
        then: c.then,
        reveal,
      } satisfies CKView),
    );
  },

  fromView(v, s) {
    const cv = v.ck!;
    const fill = (t: Track, n: number) => new Array<Progress>(n).fill(PLACEHOLDER[t]);
    const hands = s.players.map((_, p) => {
      if (p === v.me && cv.hand) return cv.hand.slice();
      if (cv.reveal?.from === p && cv.reveal.progress) return cv.reveal.progress.slice();
      const col = cv.colors[p]!;
      return TRACKS.flatMap((t) => fill(t, col[t]));
    });
    s.ck = {
      lvl: JSON.parse(JSON.stringify(cv.lvl)),
      metro: { ...cv.metro },
      walls: cv.walls.slice(),
      knights: JSON.parse(JSON.stringify(cv.knights)),
      barb: cv.barb,
      attacks: cv.attacks,
      decks: {
        trade: fill('trade', cv.decks.trade),
        politics: fill('politics', cv.decks.politics),
        science: fill('science', cv.decks.science),
      },
      hands,
      shown: JSON.parse(JSON.stringify(cv.shown)),
      defender: cv.defender.slice(),
      merchant: cv.merchant ? { ...cv.merchant } : null,
      fleet: cv.fleet.slice(),
      crane: cv.crane,
      alchemy: cv.alchemy ? [cv.alchemy[0], cv.alchemy[1]] : null,
      event: cv.event,
      owe: JSON.parse(JSON.stringify(cv.owe)),
      back: cv.back,
      then: cv.then,
    };
    s.players.forEach((pl, p) => {
      for (const k of COMS) if (pl.res[k] == null) pl.res[k] = 0;
      if (cv.reveal?.from === p && cv.reveal.hand) pl.res = { ...cv.reveal.hand };
    });
  },
};

/** The Cities & Knights part of a player's view. */
export interface CKView {
  lvl: Record<Track, number>[];
  metro: Record<Track, number | null>;
  walls: number[];
  knights: (Knight | null)[];
  barb: number;
  attacks: number;
  /** Cards left in each deck. */
  decks: Record<Track, number>;
  /** Progress cards each player holds, by colour. */
  colors: Record<Track, number>[];
  /** The viewer's progress cards. */
  hand: Progress[] | null;
  shown: Progress[][];
  defender: number[];
  merchant: { h: number; p: Seat } | null;
  fleet: Card[];
  crane: number;
  alchemy: [number, number] | null;
  event: 'ship' | Track | null;
  owe: Owe[];
  back: GameState['stage'] | null;
  then: 'produce' | null;
  /** What the viewer may see while choosing: Spy (progress cards) or Master Merchant (hand). */
  reveal: { from: Seat; progress?: Progress[]; hand?: GameState['players'][number]['res'] } | null;
}

function reduceCK(x: Ctx, a: Action): string | null | undefined {
  const { s, p, me, myTurn, events } = x;
  const c = ck(s);
  const notMain = () =>
    !myTurn
      ? 'Wait for your turn'
      : s.stage === 'preroll'
        ? 'Roll the dice first'
        : s.stage !== 'main'
          ? 'Finish what you’re doing first'
          : null;
  switch (a.type) {
    case 'improve': {
      const no = notMain();
      if (no) return no;
      const t = a.track;
      if (!TRACKS.includes(t)) return 'Pick an improvement';
      const L = c.lvl[p]![t];
      if (L >= 5) return 'That improvement is complete';
      if (!cityVerts(s, p).length) return 'You need a city to build improvements';
      const com = TRACK_COM[t];
      const cost = Math.max(0, L + 1 - (c.crane > 0 ? 1 : 0));
      if (me.res[com]! < cost) return `Level ${L + 1} costs ${cost} ${com}`;
      const holder = metroOwner(s, t);
      const wins = L + 1 >= 4 && (holder == null || (holder !== p && L + 1 > c.lvl[holder]![t]));
      if (wins) {
        const spots = plainCities(s, p);
        if (!spots.length) return 'You need a city without a metropolis for this level';
        if (a.v == null || !spots.includes(a.v)) return 'Choose a city for the metropolis';
      } else if (a.v != null) return 'There’s no metropolis to place';
      pay(s, p, { [com]: cost });
      if (c.crane > 0) c.crane--;
      c.lvl[p]![t] = L + 1;
      events.push({ k: 'improve', p, track: t, lvl: L + 1 });
      if (wins) {
        c.metro[t] = a.v!;
        events.push({ k: 'metropolis', p, track: t, v: a.v!, from: holder });
      }
      return null;
    }
    case 'wall': {
      const no = notMain();
      if (no) return no;
      const b = isInt(a.v) ? s.verts[a.v] : null;
      if (!b || b[0] !== p || b[1] !== 2) return 'Walls go under one of your cities';
      if (c.walls.includes(a.v)) return 'That city already has a wall';
      if (wallsOf(s, p) >= WALLS) return 'You have no walls left';
      if (!has(me.res, WALL_COST)) return 'A city wall costs 2 brick';
      pay(s, p, WALL_COST);
      c.walls.push(a.v);
      events.push({ k: 'wall', p, v: a.v });
      return null;
    }
    case 'knight': {
      const no = notMain();
      if (no) return no;
      if (!has(me.res, KNIGHT_COST)) return 'A knight costs 1 sheep and 1 ore';
      if (knightsOf(s, p, 1) >= KNIGHTS_EACH) return 'You have no basic knights left';
      if (!knightSpotOK(s, p, a.v)) return 'Knights go on an empty corner next to your road';
      pay(s, p, KNIGHT_COST);
      c.knights[a.v] = { p, lvl: 1, on: false };
      events.push({ k: 'knight', p, v: a.v });
      updateLongest(s, events);
      return null;
    }
    case 'promote': {
      const no = notMain();
      if (no) return no;
      if (!has(me.res, PROMOTE_COST)) return 'Promoting costs 1 sheep and 1 ore';
      if (!canPromote(s, p, a.v)) return promoteWhy(s, p, a.v);
      pay(s, p, PROMOTE_COST);
      const k = c.knights[a.v]!;
      k.lvl = (k.lvl + 1) as 2 | 3;
      k.up = true;
      events.push({ k: 'promote', p, v: a.v, lvl: k.lvl });
      return null;
    }
    case 'activate': {
      const no = notMain();
      if (no) return no;
      const k = isInt(a.v) ? c.knights[a.v] : null;
      if (!k || k.p !== p) return 'That isn’t your knight';
      if (k.on) return 'That knight is already active';
      if (!has(me.res, ACTIVATE_COST)) return 'Activating a knight costs 1 wheat';
      pay(s, p, ACTIVATE_COST);
      k.on = true;
      k.fresh = true;
      events.push({ k: 'activate', p, v: a.v });
      return null;
    }
    case 'moveKnight': {
      const no = notMain();
      if (no) return no;
      const { from, to } = a;
      if (!canAct(s, p, from)) return actWhy(s, p, from);
      if (!isInt(to) || !knightMoves(s, p, from).includes(to)) return 'The knight can’t go there';
      const k = c.knights[from]!;
      const other = c.knights[to];
      c.knights[from] = null;
      k.on = false;
      c.knights[to] = k;
      events.push({ k: 'moveKnight', p, from, to, displaced: other ? other.p : null });
      if (other) displace(x, other.p, other, to);
      updateLongest(s, events);
      return null;
    }
    case 'chase': {
      const no = notMain();
      if (no) return no;
      const { v, hex } = a;
      if (!canAct(s, p, v)) return actWhy(s, p, v);
      if (!robberAwake(s)) return 'The robber stays put until the barbarians attack';
      if (s.board.robber < 0 || !geo(s).hexVerts[s.board.robber]!.includes(v))
        return 'The knight must be next to the robber';
      if (!isInt(hex) || hex === s.board.robber || !robberHexOK(s, hex))
        return 'Move the robber to another tile';
      const victims = robberVictims(s, p, hex);
      let victim: Seat | null = null;
      if (victims.length) {
        victim = victims.length === 1 && a.victim == null ? victims[0]! : (a.victim ?? -1);
        if (!victims.includes(victim)) return 'Choose who to steal from';
      }
      c.knights[v]!.on = false;
      s.board.robber = hex;
      events.push({ k: 'chase', p, v });
      events.push({ k: 'robber', p, h: hex, victim });
      if (victim != null) events.push({ k: 'steal', p, from: victim, r: stealRandom(s, victim, p) });
      return null;
    }
    case 'dropProgress': {
      if (!myTurn || s.stage !== 'main') return 'You can’t do that now';
      if (c.hands[p]!.length <= PROGRESS_LIMIT) return 'You can keep all your progress cards';
      if (!c.hands[p]!.includes(a.card)) return 'You don’t have that card';
      returnProgress(s, p, a.card);
      events.push({ k: 'progressBack', p, track: trackOf(a.card) });
      return null;
    }
    case 'progress': {
      const err = playProgress(x, a);
      if (err) return err;
      return null;
    }
    case 'choose': {
      const err = choose(x, a);
      if (err) return err;
      return null;
    }
    default:
      return undefined;
  }
}

function promoteWhy(s: GameState, p: Seat, v: number): string {
  const k = isInt(v) ? ck(s).knights[v] : null;
  if (!k || k.p !== p) return 'That isn’t your knight';
  if (k.up) return 'A knight can be promoted once per turn';
  if (k.lvl >= 3) return 'That knight is already mighty';
  if (k.lvl === 2 && ck(s).lvl[p]!.politics < 3) return 'Mighty knights need a fortress (politics level 3)';
  return 'You have no stronger knights left';
}

function actWhy(s: GameState, p: Seat, v: number): string {
  const k = isInt(v) ? ck(s).knights[v] : null;
  if (!k || k.p !== p) return 'That isn’t your knight';
  if (!k.on) return 'Activate the knight first';
  return 'A knight can’t act the turn it was activated';
}

/* ---------- Answering owed choices ---------- */

const cardsIn = (s: GameState, p: Seat): Card[] =>
  [...RES, ...COMS].filter((k) => (s.players[p]!.res[k] ?? 0) > 0);

/** All ways to pick n cards from a hand (n is 1 or 2). */
function pickCombos(s: GameState, p: Seat, n: number): Cards[] {
  const kinds = cardsIn(s, p);
  const res = s.players[p]!.res;
  const out: Cards[] = [];
  if (n === 1) for (const k of kinds) out.push({ [k]: 1 });
  if (n === 2) {
    for (let i = 0; i < kinds.length; i++) {
      for (let j = i; j < kinds.length; j++) {
        const a = kinds[i]!;
        const b = kinds[j]!;
        if (a === b ? (res[a] ?? 0) >= 2 : true) out.push(a === b ? { [a]: 2 } : { [a]: 1, [b]: 1 });
      }
    }
  }
  return out;
}

function legalChoices(s: GameState, o: Owe, out: Action[]) {
  const c = ck(s);
  const p = o.p;
  switch (o.k) {
    case 'loseCity':
      for (const v of plainCities(s, p)) out.push({ type: 'choose', v });
      return;
    case 'defenderDraw':
      for (const t of TRACKS) if (c.decks[t].length) out.push({ type: 'choose', track: t });
      return;
    case 'overflow':
      for (const card of new Set(c.hands[p])) out.push({ type: 'choose', card });
      return;
    case 'aqueduct':
      for (const r of RES) if (s.bank[r] > 0) out.push({ type: 'choose', r });
      return;
    case 'relocate':
      for (const v of knightSpots(s, p)) if (v !== o.not) out.push({ type: 'choose', v });
      return;
    case 'desert':
      c.knights.forEach((k, v) => k && k.p === p && out.push({ type: 'choose', v }));
      return;
    case 'deserterPlace':
      out.push({ type: 'choose', skip: true });
      for (const v of knightSpots(s, p)) out.push({ type: 'choose', v });
      return;
    case 'give':
      for (const cards of pickCombos(s, p, o.n)) out.push({ type: 'choose', cards });
      return;
    case 'discard':
      return; // free-form, like the 7 discard
    case 'harbor':
      for (const to of o.left) {
        // Everyone in `left` had a commodity when the card was played, and still does.
        out.push({ type: 'choose', to, skip: true });
        for (const r of RES) if (s.players[p]!.res[r] > 0) out.push({ type: 'choose', to, r });
      }
      return;
    case 'harborGive':
      for (const k of COMS) if ((s.players[p]!.res[k] ?? 0) > 0) out.push({ type: 'choose', r: k });
      return;
    case 'take':
      for (const cards of pickCombos(s, o.from, o.n)) out.push({ type: 'choose', cards });
      return;
    case 'spy':
      for (const card of new Set(c.hands[o.from])) out.push({ type: 'choose', card });
      return;
    case 'rebuild':
      out.push({ type: 'choose', skip: true });
      if (s.players[p]!.pieces.road > 0) for (const e of legalRoads(s, p)) out.push({ type: 'choose', e });
      return;
  }
}

/** Cards a player must discard for Saboteur right now (0 if none). */
export function ckDiscardDue(s: GameState, p: Seat): number {
  const o = firstOwe(s, p);
  return o?.k === 'discard' ? o.n : 0;
}

function choose(x: Ctx, a: Extract<Action, { type: 'choose' }>): string | null {
  const { s, p, me, events } = x;
  const c = ck(s);
  const o = firstOwe(s, p);
  if (!o) return 'You have nothing to choose';
  const done = () => {
    c.owe.splice(c.owe.indexOf(o), 1);
  };
  switch (o.k) {
    case 'loseCity': {
      if (!isInt(a.v) || !plainCities(s, p).includes(a.v))
        return 'Choose one of your cities (not a metropolis)';
      reduceCity(s, p, a.v, events);
      done();
      break;
    }
    case 'defenderDraw': {
      if (!a.track || !TRACKS.includes(a.track) || !c.decks[a.track].length)
        return 'Choose a deck with cards left';
      done();
      drawProgress(s, p, a.track, events);
      break;
    }
    case 'overflow': {
      if (!a.card || !c.hands[p]!.includes(a.card)) return 'Choose one of your progress cards';
      returnProgress(s, p, a.card);
      events.push({ k: 'progressBack', p, track: trackOf(a.card) });
      done();
      break;
    }
    case 'aqueduct': {
      const r = a.r;
      if (!r || !(RES as readonly string[]).includes(r) || s.bank[r as Resource] < 1)
        return 'Pick a resource the bank has';
      gain(s, p, r, 1);
      events.push({ k: 'aqueduct', p, r: r as Resource });
      done();
      break;
    }
    case 'relocate': {
      if (!isInt(a.v) || a.v === o.not || !knightSpotOK(s, p, a.v))
        return 'Pick an empty corner next to your road';
      c.knights[a.v] = { p, lvl: o.lvl, on: o.on };
      events.push({ k: 'relocate', p, to: a.v });
      done();
      updateLongest(s, events);
      break;
    }
    case 'desert': {
      const k = isInt(a.v) ? c.knights[a.v] : null;
      if (!k || k.p !== p) return 'Choose one of your knights';
      c.knights[a.v!] = null;
      events.push({ k: 'knightRemoved', p, v: a.v! });
      done();
      deserterFollowUp(x, o.by, k);
      updateLongest(s, events);
      break;
    }
    case 'deserterPlace': {
      if (a.skip) {
        done();
        break;
      }
      if (!isInt(a.v) || !knightSpotOK(s, p, a.v)) return 'Pick an empty corner next to your road';
      c.knights[a.v] = o.on ? { p, lvl: o.lvl, on: true, fresh: true } : { p, lvl: o.lvl, on: false };
      events.push({ k: 'relocate', p, to: a.v });
      done();
      updateLongest(s, events);
      break;
    }
    case 'give':
    case 'take': {
      const from = o.k === 'give' ? p : o.from;
      const to = o.k === 'give' ? o.to : p;
      const cards = cleanCounts(a.cards, [...RES, ...COMS]);
      if (!cards || total(cards) !== o.n) return `Choose exactly ${o.n} cards`;
      if (!has(s.players[from]!.res, cards)) return 'Those cards aren’t there';
      transfer(s, from, to, cards);
      events.push({ k: 'give', from, to, n: o.n, cards: compact(cards) });
      done();
      break;
    }
    case 'discard': {
      const cards = cleanCounts(a.cards, [...RES, ...COMS]);
      if (!cards || total(cards) !== o.n) return `Choose exactly ${o.n} cards to discard`;
      if (!has(me.res, cards)) return 'You don’t have those cards';
      pay(s, p, cards);
      events.push({ k: 'discard', p, c: cards });
      done();
      break;
    }
    case 'harbor': {
      const to = a.to;
      if (!isInt(to) || !o.left.includes(to)) return 'Choose a player to offer a resource to';
      if (!a.skip) {
        const r = a.r;
        if (!r || !(RES as readonly string[]).includes(r) || me.res[r as Resource] < 1)
          return 'Offer one of your resources';
        if (!COMS.some((k) => (s.players[to]!.res[k] ?? 0) > 0)) return 'They have no commodities';
        transfer(s, p, to, { [r]: 1 });
        events.push({ k: 'give', from: p, to, n: 1, cards: { [r]: 1 } });
        owe(s, [{ k: 'harborGive', p: to, to: p, r: r as Resource }], events);
      }
      o.left = o.left.filter((x) => x !== to);
      if (!o.left.length) done();
      break;
    }
    case 'harborGive': {
      const r = a.r;
      if (!r || !isCommodity(r) || (me.res[r] ?? 0) < 1) return 'Give one of your commodities';
      transfer(s, p, o.to, { [r]: 1 });
      events.push({ k: 'give', from: p, to: o.to, n: 1, cards: { [r]: 1 } });
      done();
      break;
    }
    case 'spy': {
      const card = a.card;
      if (!card || !c.hands[o.from]!.includes(card)) return 'Choose one of their cards';
      c.hands[o.from]!.splice(c.hands[o.from]!.indexOf(card), 1);
      c.hands[p]!.push(card);
      events.push({ k: 'spy', p, from: o.from, track: trackOf(card), card });
      done();
      break;
    }
    case 'rebuild': {
      if (a.skip) {
        done();
        break;
      }
      if (me.pieces.road <= 0 || !isInt(a.e) || !roadOK(s, p, a.e))
        return 'Roads must connect to your own roads or buildings';
      done();
      settle(x);
      s.edges[a.e] = p;
      me.pieces.road--;
      events.push({ k: 'build', p, what: 'road', at: a.e, free: true });
      updateLongest(s, events);
      for (const m of mods(s)) m.afterRoad?.(x, a.e);
      return null;
    }
  }
  settle(x);
  return null;
}

/** After Deserter removes a knight, the player who played it may place one like it. */
export function deserterFollowUp(x: Ctx, by: Seat, k: Knight) {
  const { s, events } = x;
  const fortressOK = k.lvl < 3 || ck(s).lvl[by]!.politics >= 3;
  if (fortressOK && knightsOf(s, by, k.lvl) < KNIGHTS_EACH && knightSpots(s, by).length)
    owe(s, [{ k: 'deserterPlace', p: by, lvl: k.lvl, on: k.on }], events);
}

export const compact = (c: Cards): Cards =>
  Object.fromEntries(Object.entries(c).filter(([, n]) => n)) as Cards;
