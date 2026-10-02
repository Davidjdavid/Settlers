/*
 * Small state-changing helpers shared by the base rules and expansion modules.
 * They only ever run on the clone made by applyAction.
 */

import { nextInt } from './rng';
import { mods, type Ctx } from './modules/api';
import {
  BANK_EACH, canPlaceFreePiece, cardKinds, geo, handLimit, robberAwake, routeLen, total, totalVP, zeroRes,
} from './queries'; // prettier-ignore
import {
  RES,
  isResource,
  type Card,
  type Cards,
  type GameEvent,
  type GameState,
  type Hand,
  type PartialRes,
  type Resource,
  type Seat,
} from './types';

export const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
export const isRes = (x: unknown): x is Resource =>
  typeof x === 'string' && (RES as readonly string[]).includes(x);

/** Validate card counts from the network (resources, or the given kinds). Null if malformed. */
export function cleanCounts(obj: unknown, kinds: readonly Card[] = RES): Hand | null {
  const out = zeroRes() as Hand;
  for (const k of kinds) out[k] = 0;
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(kinds as readonly string[]).includes(k)) return null;
    const n = o[k];
    if (n === undefined || n === 0) continue;
    if (!isInt(n) || n < 0 || n > BANK_EACH * 5) return null;
    out[k as Card] = n;
  }
  return out;
}

export function gain(s: GameState, p: Seat, r: Card, n: number) {
  s.players[p]!.res[r]! += n;
  s.bank[r]! -= n;
}

export function pay(s: GameState, p: Seat, cost: Cards) {
  for (const k in cost) {
    const r = k as Card;
    const n = cost[r] || 0;
    s.players[p]!.res[r]! -= n;
    s.bank[r]! += n;
  }
}

/** Move cards from one player to another. */
export function transfer(s: GameState, from: Seat, to: Seat, cards: Cards) {
  for (const k in cards) {
    const r = k as Card;
    const n = cards[r] || 0;
    s.players[from]!.res[r]! -= n;
    s.players[to]!.res[r]! += n;
  }
}

export function stealRandom(s: GameState, from: Seat, to: Seat): Card | null {
  const pool: Card[] = [];
  for (const r of cardKinds(s)) for (let i = 0; i < (s.players[from]!.res[r] ?? 0); i++) pool.push(r);
  if (!pool.length) return null;
  const r = pool[nextInt(s.rng, pool.length)]!;
  s.players[from]!.res[r]!--;
  s.players[to]!.res[r]!++;
  return r;
}

/** Recompute route lengths and who holds longest road / trade route. */
export function updateLongest(s: GameState, events: GameEvent[]) {
  const lens = s.players.map((_, p) => routeLen(s, p));
  s.roadLens = lens;
  const max = Math.max(...lens);
  const prev = s.longest;
  let holder: Seat | null;
  if (max < 5) holder = null;
  else if (prev != null && lens[prev] === max) holder = prev;
  else {
    const top = lens.flatMap((l, p) => (l === max ? [p] : []));
    holder = top.length === 1 ? top[0]! : null;
  }
  if (holder !== prev) {
    s.longest = holder;
    events.push({ k: 'longest', p: holder, n: holder != null ? lens[holder]! : 0, from: prev });
  }
}

export function updateLargest(s: GameState, p: Seat, events: GameEvent[]) {
  const k = s.players[p]!.knights;
  if (k < 3 || s.largest === p) return;
  if (s.largest == null || k > s.players[s.largest]!.knights) {
    const from = s.largest;
    s.largest = p;
    events.push({ k: 'largest', p, n: k, from });
  }
}

/** A player can only win on their own turn. */
export function checkWin(s: GameState, events: GameEvent[]) {
  if (s.phase !== 'play' || s.stage === 'setup') return;
  const p = s.turn;
  const vp = totalVP(s, p);
  if (vp >= s.config.winVP) {
    s.phase = 'over';
    s.winner = p;
    s.offers = [];
    // A win after keep playing (SPEC 8.9) is an overtime win; the first one stays the result.
    if (s.keep?.on) {
      s.keep.wins.push({ p, vp, target: s.config.winVP, seq: s.seq + 1 });
      events.push({ k: 'win', p, vp, overtime: true });
    } else events.push({ k: 'win', p, vp });
  }
}

/** Leave the robber stage (robber or pirate moved). */
export function finishRobber(s: GameState) {
  s.stage = s.robberReturn ?? 'main';
  s.robberReturn = null;
}

/** Leave the free-roads stage. */
export function finishFreePieces(s: GameState) {
  s.stage = s.roadsReturn ?? 'main';
  s.freeRoads = 0;
  s.roadsReturn = null;
}

/** After a free piece from Road Building: leave the stage when done or stuck. */
export function afterFreePiece(x: Ctx) {
  const { s, p } = x;
  s.freeRoads--;
  if (s.freeRoads <= 0 || !canPlaceFreePiece(s, p)) finishFreePieces(s);
}

/* ---------- Rolling ---------- */

function produce(s: GameState, roll: number): { gains: Record<number, PartialRes>; short: Resource[] } {
  const g = geo(s);
  const ms = mods(s);
  const yieldOf = ms.find((m) => m.yieldOf)?.yieldOf;
  const owed = s.players.map(() => zeroRes());
  s.board.hexes.forEach((h, hi) => {
    if (h.n !== roll || hi === s.board.robber || !isResource(h.t)) return;
    for (const v of g.hexVerts[hi]!) {
      const b = s.verts[v];
      if (b) owed[b[0]]![h.t] += yieldOf ? yieldOf(s, h.t, b[1]) : b[1];
    }
  });
  const gains: Record<number, PartialRes> = {};
  const short: Resource[] = [];
  for (const r of RES) {
    const need = owed.reduce((a, o) => a + o[r], 0);
    if (!need) continue;
    const who = owed.flatMap((o, p) => (o[r] ? [p] : []));
    if (need <= s.bank[r]) {
      for (const p of who) {
        gain(s, p, r, owed[p]![r]);
        (gains[p] ??= {})[r] = owed[p]![r];
      }
    } else if (who.length === 1 && s.bank[r] > 0) {
      // Only one player is owed this resource: they get what's left.
      const p = who[0]!;
      const n = s.bank[r];
      gain(s, p, r, n);
      (gains[p] ??= {})[r] = n;
      short.push(r);
    } else {
      short.push(r);
    }
  }
  return { gains, short };
}

/** After the dice (s.dice) are settled: discards and the robber on a 7, production otherwise. */
export function continueRoll(x: Ctx) {
  const { s, events } = x;
  const [d1, d2] = s.dice!;
  if (d1 + d2 === 7) {
    const need: Record<number, number> = {};
    s.players.forEach((pl, i) => {
      const t = total(pl.res);
      if (t > handLimit(s, i)) need[i] = Math.floor(t / 2);
    });
    s.robberReturn = 'main';
    if (Object.keys(need).length) {
      s.discard = need;
      s.stage = 'discard';
      events.push({ k: 'mustDiscard', need });
    } else {
      s.stage = 'robber';
      if (!robberAwake(s)) finishRobber(s);
    }
  } else {
    const out = produce(s, d1 + d2);
    events.push({ k: 'produce', gains: out.gains, short: out.short });
    s.stage = 'main';
    for (const m of mods(s)) m.afterProduce?.(x, d1 + d2);
  }
}
