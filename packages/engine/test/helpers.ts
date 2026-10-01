import {
  applyAction, geo, roadLen, legalActions, newGame, nextInt, seedRng, type Action, type GameEvent, type GameState,
  type PartialRes, type Seat,
} from '../src/index'; // prettier-ignore
import { seatsFor } from './simulate';

/** Apply an action that must succeed. */
export function act(s: GameState, p: Seat, a: Action): { state: GameState; events: GameEvent[] } {
  const r = applyAction(s, p, a);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(a)} by ${p} to succeed: ${r.error}`);
  return r;
}

/** Apply an action that must fail; returns the error. */
export function reject(s: GameState, p: Seat, a: Action): string {
  const r = applyAction(s, p, a);
  if (r.ok) throw new Error(`expected ${JSON.stringify(a)} by ${p} to fail`);
  return r.error;
}

/** A game with setup finished using the first legal placements; seat 0 to roll. */
export function afterSetup(n = 3, seed = 'test'): GameState {
  let s = newGame(seed, seatsFor(n));
  while (s.stage === 'setup') s = act(s, s.turn, legalActions(s, s.turn)[0]!).state;
  return s;
}

/** Set the PRNG so the next roll is `sum`. */
export function rigDice(s: GameState, sum: number): GameState {
  for (let i = 0; ; i++) {
    const rng = seedRng(`rig-${i}`);
    const probe: typeof rng = [...rng];
    if (2 + nextInt(probe, 6) + nextInt(probe, 6) === sum) return { ...s, rng };
  }
}

/** Replace a player's hand, taking from or returning to the bank so totals stay conserved. */
export function setHand(s: GameState, p: Seat, res: PartialRes): GameState {
  const t = structuredClone(s);
  const pl = t.players[p]!;
  for (const r of Object.keys(pl.res) as (keyof typeof pl.res)[]) {
    const want = res[r] ?? 0;
    t.bank[r] += pl.res[r] - want;
    pl.res[r] = want;
  }
  return t;
}

/** A clean board with no pieces, for building exact positions by hand. */
export function emptyBoard(n = 3, seed = 'empty'): GameState {
  const s = structuredClone(newGame(seed, seatsFor(n)));
  s.stage = 'main';
  s.turnN = 1;
  s.setupI = n * 2;
  s.dice = [3, 4];
  return s;
}

/** Place pieces directly (bypassing rules) and keep piece supplies conserved. */
export function place(
  s: GameState,
  p: Seat,
  opts: { roads?: number[]; settlements?: number[]; cities?: number[] },
): GameState {
  const t = structuredClone(s);
  for (const e of opts.roads ?? []) {
    t.edges[e] = p;
    t.players[p]!.pieces.road--;
  }
  for (const v of opts.settlements ?? []) {
    t.verts[v] = [p, 1];
    t.players[p]!.pieces.settlement--;
  }
  for (const v of opts.cities ?? []) {
    t.verts[v] = [p, 2];
    t.players[p]!.pieces.city--;
  }
  t.roadLens = t.players.map((_, i) => roadLen(t, i));
  return t;
}

/** A path of `len` connected edges starting at vertex `start`, never revisiting a vertex. */
export function edgePath(
  s: GameState,
  start: number,
  len: number,
  avoid: Set<number> = new Set(),
): { edges: number[]; verts: number[] } {
  const g = geo(s);
  const verts = [start];
  const edges: number[] = [];
  const go = (v: number): boolean => {
    if (edges.length === len) return true;
    for (const e of g.verts[v]!.edges) {
      const E = g.edges[e]!;
      const w = E.a === v ? E.b : E.a;
      if (verts.includes(w) || avoid.has(w)) continue;
      edges.push(e);
      verts.push(w);
      if (go(w)) return true;
      edges.pop();
      verts.pop();
    }
    return false;
  };
  if (!go(start)) throw new Error('no path');
  return { edges, verts };
}
