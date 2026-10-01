/* Read-only questions about a game state. Ported from the prototype. */

import { geometryFor, type Geometry } from './geometry';
import { mods } from './modules/api';
import {
  DEV_PLAY,
  RES,
  type GameState,
  type PartialRes,
  type Player,
  type PortType,
  type Resource,
  type ResCounts,
  type Seat,
} from './types';

export const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
} satisfies Record<string, PartialRes>;

export const DEV_COUNTS = { knight: 14, vp: 5, road: 2, plenty: 2, mono: 2 };
export const PIECES = { road: 15, settlement: 5, city: 4 };
export const BANK_EACH = 19;
export const MAX_SEATS = 4;
export const MIN_SEATS = 2;

export const geo = (s: GameState): Geometry => geometryFor(s.board.hexes);

export const zeroRes = (): ResCounts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const total = (res: PartialRes | null | undefined): number =>
  RES.reduce((a, r) => a + ((res && res[r]) || 0), 0);
export const has = (res: PartialRes, cost: PartialRes): boolean =>
  RES.every((r) => (res[r] || 0) >= (cost[r] || 0));

export function snakeOrder(n: number): Seat[] {
  const a: Seat[] = [];
  for (let i = 0; i < n; i++) a.push(i);
  return a.concat(a.slice().reverse());
}

export function vertFree(s: GameState, v: number): boolean {
  const g = geo(s);
  return !s.verts[v] && g.verts[v]!.adj.every((u) => !s.verts[u]);
}

/** May a settlement go on v at all (modules may require it to touch land)? */
export function vertexOK(s: GameState, v: number): boolean {
  return mods(s).every((m) => m.vertexOK?.(s, v) ?? true);
}

/** May a road go on edge e at all, ignoring whether it connects? */
export function roadEdgeOK(s: GameState, e: number): boolean {
  return s.edges[e] == null && mods(s).every((m) => m.roadEdgeOK?.(s, e) ?? true);
}

export function setupVertOK(s: GameState, v: number): boolean {
  return vertFree(s, v) && vertexOK(s, v) && mods(s).every((m) => m.setupVertexOK?.(s, v) ?? true);
}

export function legalSetupVerts(s: GameState): number[] {
  const out: number[] = [];
  for (let v = 0; v < s.verts.length; v++) if (setupVertOK(s, v)) out.push(v);
  return out;
}

export function legalSetupRoads(s: GameState, v: number): number[] {
  return geo(s).verts[v]!.edges.filter((e) => roadEdgeOK(s, e));
}

export function robberHexOK(s: GameState, h: number): boolean {
  return h >= 0 && h < s.board.hexes.length && mods(s).every((m) => m.robberHexOK?.(s, h) ?? true);
}

export function roadOK(s: GameState, p: Seat, e: number): boolean {
  const g = geo(s);
  if (!Number.isInteger(e) || e < 0 || e >= g.edges.length || !roadEdgeOK(s, e)) return false;
  const E = g.edges[e]!;
  for (const v of [E.a, E.b]) {
    const b = s.verts[v];
    if (b && b[0] === p) return true;
    if (b && b[0] !== p) continue; // an opponent's building blocks the connection
    if (g.verts[v]!.edges.some((f) => f !== e && s.edges[f] === p)) return true;
  }
  return false;
}

export function legalRoads(s: GameState, p: Seat): number[] {
  const out: number[] = [];
  for (let e = 0; e < s.edges.length; e++) if (roadOK(s, p, e)) out.push(e);
  return out;
}

export function settlementOK(s: GameState, p: Seat, v: number): boolean {
  if (!Number.isInteger(v) || v < 0 || v >= s.verts.length) return false;
  if (!vertFree(s, v) || !vertexOK(s, v)) return false;
  return (
    geo(s).verts[v]!.edges.some((e) => s.edges[e] === p) || mods(s).some((m) => m.settleSupport?.(s, p, v))
  );
}

export function legalSettlements(s: GameState, p: Seat): number[] {
  const out: number[] = [];
  for (let v = 0; v < s.verts.length; v++) if (settlementOK(s, p, v)) out.push(v);
  return out;
}

export function legalCities(s: GameState, p: Seat): number[] {
  const out: number[] = [];
  s.verts.forEach((b, v) => {
    if (b && b[0] === p && b[1] === 1) out.push(v);
  });
  return out;
}

export function portsOf(s: GameState, p: Seat): Set<PortType> {
  const g = geo(s);
  const set = new Set<PortType>();
  for (const pt of s.board.ports) {
    const e = g.edges[pt.e]!;
    for (const v of [e.a, e.b]) {
      const b = s.verts[v];
      if (b && b[0] === p) set.add(pt.t);
    }
  }
  return set;
}

export function rateFor(s: GameState, p: Seat, r: Resource): number {
  const ps = portsOf(s, p);
  return ps.has(r) ? 2 : ps.has('any') || s.config.houseRules?.bank3to1 ? 3 : 4;
}

/** Points everyone can see: buildings plus longest road and largest army. */
export function publicVP(s: GameState, p: Seat): number {
  let vp = 0;
  for (const b of s.verts) if (b && b[0] === p) vp += b[1];
  if (s.longest === p) vp += 2;
  if (s.largest === p) vp += 2;
  for (const m of mods(s)) vp += m.extraVP?.(s, p) ?? 0;
  return vp;
}

export function totalVP(s: GameState, p: Seat): number {
  return publicVP(s, p) + s.players[p]!.vpCards;
}

/** All dev cards a player holds, including hidden VP cards. */
export function devCount(pl: Player): number {
  let n = pl.vpCards;
  for (const k of DEV_PLAY) n += pl.dev[k] + pl.fresh[k];
  return n;
}

export function deckCount(s: GameState): number {
  return Object.values(s.deck).reduce((a, b) => a + b, 0);
}

export function robberVictims(s: GameState, p: Seat, hex: number): Seat[] {
  const set = new Set<Seat>();
  for (const v of geo(s).hexVerts[hex]!) {
    const b = s.verts[v];
    if (b && b[0] !== p && total(s.players[b[0]]!.res) > 0) set.add(b[0]);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Longest continuous road for a player; opponents' buildings break it. */
export function roadLen(s: GameState, p: Seat): number {
  const g = geo(s);
  let best = 0;
  const used = new Set<number>();
  const dfs = (v: number, len: number) => {
    if (len > best) best = len;
    const b = s.verts[v];
    if (len > 0 && b && b[0] !== p) return;
    for (const e of g.verts[v]!.edges) {
      if (s.edges[e] !== p || used.has(e)) continue;
      used.add(e);
      const E = g.edges[e]!;
      dfs(E.a === v ? E.b : E.a, len + 1);
      used.delete(e);
    }
  };
  for (let v = 0; v < g.verts.length; v++) {
    if (g.verts[v]!.edges.some((e) => s.edges[e] === p)) dfs(v, 0);
  }
  return best;
}

/** The length that counts for longest road (modules may count ships too). */
export function routeLen(s: GameState, p: Seat): number {
  for (const m of mods(s)) if (m.routeLen) return m.routeLen(s, p);
  return roadLen(s, p);
}

/** How many free pieces Road Building can give p, and whether any can be placed now. */
export function freePieceSupply(s: GameState, p: Seat): number {
  let n = s.players[p]!.pieces.road;
  for (const m of mods(s)) n += m.freePieceSupply?.(s, p) ?? 0;
  return n;
}

export function canPlaceFreePiece(s: GameState, p: Seat): boolean {
  if (s.players[p]!.pieces.road > 0 && legalRoads(s, p).length) return true;
  return mods(s).some((m) => m.canPlaceFreePiece?.(s, p));
}

/** Seats that must act right now. */
export function waitingOn(s: GameState): Seat[] {
  if (s.phase !== 'play') return [];
  if (s.stage === 'discard') return Object.keys(s.discard ?? {}).map(Number);
  for (const m of mods(s)) {
    const w = m.waitingOn?.(s);
    if (w) return w;
  }
  return [s.turn];
}
