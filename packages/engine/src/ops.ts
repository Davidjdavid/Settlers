/*
 * Small state-changing helpers shared by the base rules and expansion modules.
 * They only ever run on the clone made by applyAction.
 */

import { nextInt } from './rng';
import type { Ctx } from './modules/api';
import { BANK_EACH, canPlaceFreePiece, routeLen, totalVP, zeroRes } from './queries';
import {
  RES,
  type GameEvent,
  type GameState,
  type PartialRes,
  type Resource,
  type ResCounts,
  type Seat,
} from './types';

export const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
export const isRes = (x: unknown): x is Resource =>
  typeof x === 'string' && (RES as readonly string[]).includes(x);

/** Validate card counts from the network. Null if malformed. */
export function cleanCounts(obj: unknown): ResCounts | null {
  const out = zeroRes();
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!isRes(k)) return null;
    const n = o[k];
    if (n === undefined || n === 0) continue;
    if (!isInt(n) || n < 0 || n > BANK_EACH * 5) return null;
    out[k] = n;
  }
  return out;
}

export function gain(s: GameState, p: Seat, r: Resource, n: number) {
  s.players[p]!.res[r] += n;
  s.bank[r] -= n;
}

export function pay(s: GameState, p: Seat, cost: PartialRes) {
  for (const r of RES) {
    const n = cost[r] || 0;
    s.players[p]!.res[r] -= n;
    s.bank[r] += n;
  }
}

export function stealRandom(s: GameState, from: Seat, to: Seat): Resource | null {
  const pool: Resource[] = [];
  for (const r of RES) for (let i = 0; i < s.players[from]!.res[r]; i++) pool.push(r);
  if (!pool.length) return null;
  const r = pool[nextInt(s.rng, pool.length)]!;
  s.players[from]!.res[r]--;
  s.players[to]!.res[r]++;
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
    events.push({ k: 'win', p, vp });
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
