/*
 * The pre-game table (docs/pregame.md): one shared board per room with a back/forward history,
 * the seating circle, Ready, and who goes first (roll-off, random or picked). The server keeps
 * the one true table; every change is saved before anyone hears about it.
 *
 * Boards are made by the generator from a source (the mode's default map, a saved map, or a
 * preset on the mode's board shape) and a seed. Everything here is plain data plus a few
 * functions; Rooms does the saving and broadcasting.
 */

import { randomInt } from 'node:crypto';
import {
  ANYTHING_GOES,
  applyEdit,
  generate,
  validateMap,
  withLocks,
  type EditOp,
  type GenRules,
  type MapData,
} from '@settlers/engine';
import { rollDie } from './dice';

export type BoardSource =
  | { kind: 'default' }
  | { kind: 'saved'; id: string; name: string }
  | { kind: 'generated'; preset: string; presetName: string };

/** One board in the table's history: always complete (no blanks), ready to play on. */
export interface TableBoard {
  map: MapData;
  source: BoardSource;
  seed: string;
  /** Who changed it by hand on the table. */
  edited: string[];
}

export interface RollOff {
  /** 1 for the first roll, 2+ for re-rolls between tied players. */
  round: number;
  /** Who rolls this round. */
  rolling: string[];
  rolls: Record<string, [number, number]>;
  winner: string | null;
}

export type FirstMode = 'roll' | 'random' | 'pick';

/** The table, saved with the room (the boards themselves are saved one by one). */
export interface TableState {
  /** The history: board sequence numbers, oldest first, and which one is showing. */
  seqs: number[];
  at: number;
  nextSeq: number;
  ready: string[];
  /** Seats in turn order around the table (pids). */
  circle: string[];
  first: { mode: FirstMode; pid: string | null; roll: RollOff | null };
  last: { who: string; what: string; at: number } | null;
}

/** Up to this many boards are kept for Back. */
export const HISTORY = 60;

/** How a default board is filled: as the game always has (no touching 6/8s or equal numbers). */
export const STANDARD_FILL: GenRules = { ...ANYTHING_GOES, redApart: true, sameApart: true };

/** A short seed like k7Qp-3x (docs/maps.md 5.18), from the crypto generator. */
export function newSeed(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s = Array.from({ length: 6 }, () => abc[randomInt(abc.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function newTable(pids: string[]): TableState {
  return {
    seqs: [],
    at: -1,
    nextSeq: 1,
    ready: [],
    circle: pids.slice(),
    first: { mode: 'random', pid: null, roll: null },
    last: null,
  };
}

/**
 * Fill `base` (blanks drawn with `rules`) into a complete board. `current`'s locks are kept.
 * Returns the board, or why no board fits.
 */
export function fillBoard(
  base: MapData,
  rules: GenRules,
  seed: string,
  players: number,
  current?: MapData,
): { ok: true; map: MapData } | { ok: false; error: string } {
  const src = current ? withLocks(base, current) : structuredClone(base);
  if (validateMap(src).length) return { ok: false, error: 'This map can’t be filled' };
  const r = generate(src, rules, { seed, players, keep: 'placed', now: Date.now });
  if (!r.ok) return { ok: false, error: r.error };
  const map = r.map;
  delete map.set;
  return { ok: true, map };
}

/** Edits allowed on the table: the board stays complete and keeps its shape. */
export function tableEditError(op: EditOp): string | null {
  switch (op.k) {
    case 'terrain':
      return op.t === 'random' ? 'Pick a tile' : null;
    case 'number':
      return op.n === 'random' ? 'Pick a number' : null;
    case 'harbor':
      return op.t === 'random' || op.t === null ? 'Pick a harbor' : null;
    case 'swapTile':
    case 'swapNumber':
    case 'moveHarbor':
    case 'lock':
    case 'lockHarbor':
      return null;
    default:
      return 'That can’t be changed here; edit the map in Maps';
  }
}

/** Apply a table edit to a board. */
export function editBoard(
  b: TableBoard,
  op: EditOp,
  who: string,
): { ok: true; board: TableBoard } | { ok: false; error: string } {
  const bad = tableEditError(op);
  if (bad) return { ok: false, error: bad };
  const r = applyEdit(b.map, op);
  if (!r.ok) return r;
  const map = r.map;
  delete map.set;
  const edited =
    op.k === 'lock' || op.k === 'lockHarbor' || b.edited.includes(who) ? b.edited : [...b.edited, who];
  return { ok: true, board: { ...b, map, edited } };
}

/** "placed ore", "moved a 6"… for the "who changed it" line. */
export function describeEdit(op: EditOp, before: MapData): string {
  const at = (q: number, r: number) => before.hexes.find((h) => h.q === q && h.r === r);
  switch (op.k) {
    case 'terrain':
      return `placed ${op.t}`;
    case 'number':
      return `placed a ${op.n}`;
    case 'harbor':
      return 'changed a harbor';
    case 'swapTile':
      return `moved ${at(...op.a)?.t ?? 'a tile'}`;
    case 'swapNumber': {
      const n = at(...op.a)?.n;
      return typeof n === 'number' ? `moved a ${n}` : 'moved a number';
    }
    case 'moveHarbor':
      return 'moved a harbor';
    case 'lock':
      return `${op.on ? 'locked' : 'unlocked'} a ${op.what === 't' ? 'tile' : 'number'}`;
    case 'lockHarbor':
      return `${op.on ? 'locked' : 'unlocked'} a harbor`;
    default:
      return 'changed the board';
  }
}

/** Turn order: the circle, starting from the first player (docs/pregame.md 2.3). */
export function turnOrder(circle: string[], first: string | null): string[] {
  const i = first ? circle.indexOf(first) : -1;
  return i < 0 ? circle.slice() : [...circle.slice(i), ...circle.slice(0, i)];
}

/** Setup snake: first to last, then back. */
export const setupSnake = (order: string[]) => [...order, ...order.slice().reverse()];

/** Keep the circle in step with the seats: leavers go, newcomers join at the end. */
export function syncCircle(t: TableState, pids: string[]): boolean {
  const kept = t.circle.filter((p) => pids.includes(p));
  const added = pids.filter((p) => !kept.includes(p));
  const circle = [...kept, ...added];
  if (JSON.stringify(circle) === JSON.stringify(t.circle)) return false;
  t.circle = circle;
  return true;
}

/* ---------- Who goes first (2.2) ---------- */

/** The log lines a roll-off step produced. */
type Lines = string[];

/** Where the randomness comes from: the crypto dice and generator (tests can rig them). */
export interface Luck {
  die: () => number;
  pick: (n: number) => number;
}
export const CRYPTO_LUCK: Luck = { die: rollDie, pick: (n) => randomInt(n) };

/** Start (or restart) the first-player choice for the seats in the circle. */
export function resetFirst(
  t: TableState,
  mode: FirstMode,
  cpus: Set<string>,
  names: Map<string, string>,
  luck: Luck = CRYPTO_LUCK,
): Lines {
  t.first = { mode, pid: null, roll: null };
  if (!t.circle.length) return [];
  if (mode === 'random') {
    t.first.pid = t.circle[luck.pick(t.circle.length)]!;
    return [`${names.get(t.first.pid)} was picked at random to go first`];
  }
  if (mode === 'pick') {
    t.first.pid = t.circle[0]!;
    return [];
  }
  t.first.roll = { round: 1, rolling: t.circle.slice(), rolls: {}, winner: null };
  return rollFor(
    t,
    t.circle.filter((p) => cpus.has(p)),
    names,
    cpus,
    luck,
  );
}

/**
 * Roll two dice for each of `who` who still has to roll this round, then settle the round: the
 * highest total goes first; players tied for highest roll again (and only they), CPUs at once.
 */
export function rollFor(
  t: TableState,
  who: string[],
  names: Map<string, string>,
  cpus: Set<string>,
  luck: Luck = CRYPTO_LUCK,
): Lines {
  const r = t.first.roll;
  if (!r || r.winner) return [];
  const lines: Lines = [];
  for (const pid of who) {
    if (!r.rolling.includes(pid) || r.rolls[pid]) continue;
    const d: [number, number] = [luck.die(), luck.die()];
    r.rolls[pid] = d;
    lines.push(`${names.get(pid)} rolled ${d[0]} + ${d[1]} = ${d[0] + d[1]}`);
  }
  if (r.rolling.some((p) => !r.rolls[p])) return lines;
  const total = (p: string) => r.rolls[p]![0] + r.rolls[p]![1];
  const best = Math.max(...r.rolling.map(total));
  const tied = r.rolling.filter((p) => total(p) === best);
  if (tied.length === 1) {
    r.winner = tied[0]!;
    t.first.pid = r.winner;
    lines.push(`${names.get(r.winner)} goes first`);
    return lines;
  }
  lines.push(`${listNames(tied.map((p) => names.get(p)!))} tied on ${best} and roll again`);
  t.first.roll = { round: r.round + 1, rolling: tied, rolls: {}, winner: null };
  return [
    ...lines,
    ...rollFor(
      t,
      tied.filter((p) => cpus.has(p)),
      names,
      cpus,
      luck,
    ),
  ];
}

const listNames = (xs: string[]) =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
