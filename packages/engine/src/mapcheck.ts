/*
 * The board rules checker (docs/maps.md section 5, "How each rule is checked"). It only reads a
 * board and the settings, so it can judge the generator's output independently. The editor and
 * the pre-game table use it for warnings, so it also works on boards with blanks: a rule is only
 * reported broken when the known pieces already break it.
 */

import { geometryFor, type Geometry } from './geometry';
import { hexAt, edgeOfSide, startHexes, type MapData } from './map';
import { isLand, isResource, RES, type PortType, type Resource, type Terrain } from './types';

/** Generator and checker settings (a preset). A null limit means the rule is off. */
export interface GenRules {
  /** 5.1 Pips per number token. */
  pips: Record<number, number>;
  /** 5.2 6s and 8s never touch. */
  redApart: boolean;
  /** 5.3 A 2:1 harbor never touches its own resource with a good number ('68', or '5689'). */
  harborGood: 'off' | '68' | '5689';
  /** 5.4 No 6 or 8 touches any harbor. */
  harborNoRed: boolean;
  /** 5.5 No corner above this many pips. */
  bestSpot: number | null;
  /** 5.6 No inland corner below this many pips. */
  badSpot: number | null;
  /** D3: count inland corners on the desert for 5.6 too. */
  badSpotDesert: boolean;
  /** 5.7 2 and 12 never touch. */
  twoTwelveApart: boolean;
  /** 5.8 No corner touches two of 2, 3, 11, 12. */
  noLowClusters: boolean;
  /** Corners allowed to break 5.8 anyway (only when the generator eases the spot rules, D7). */
  lowClusterAllow?: number;
  /** 5.9 The same number never touches itself. */
  sameApart: boolean;
  /** 5.10 Largest group of touching tiles of one resource. */
  clump: number | null;
  /** 5.11 Each resource's pips within this percentage of its fair share. */
  balance: number | null;
  /** 5.12 Largest gap between the best and worst greedy starting picks, in pips. */
  fairness: number | null;
  /** 5.12 Players in the fairness model; null = the table's player count. */
  fairPlayers: number | null;
  /** 5.15 */
  desert: 'center' | 'edge' | 'random' | 'none';
  /** 5.16 */
  harbors: 'standard' | 'random';
  /** 5.17 */
  numbers: 'spiral' | 'random';
}

export const DEFAULT_PIPS: Readonly<Record<number, number>> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
}; // prettier-ignore

/** "Our rules": every rule on, with the default numbers (docs/maps.md 5). */
export const OUR_RULES: GenRules = {
  pips: { ...DEFAULT_PIPS },
  redApart: true,
  harborGood: '68',
  harborNoRed: false,
  bestSpot: 12,
  badSpot: 4,
  badSpotDesert: false,
  twoTwelveApart: true,
  noLowClusters: true,
  sameApart: true,
  clump: 3,
  balance: 25,
  fairness: 4,
  fairPlayers: null,
  desert: 'random',
  harbors: 'standard',
  numbers: 'random',
};

/** "Anything goes": every rule off. */
export const ANYTHING_GOES: GenRules = {
  pips: { ...DEFAULT_PIPS },
  redApart: false,
  harborGood: 'off',
  harborNoRed: false,
  bestSpot: null,
  badSpot: null,
  badSpotDesert: false,
  twoTwelveApart: false,
  noLowClusters: false,
  sameApart: false,
  clump: null,
  balance: null,
  fairness: null,
  fairPlayers: null,
  desert: 'random',
  harbors: 'standard',
  numbers: 'random',
};

export type RuleId =
  | 'red'
  | 'harborGood'
  | 'harborRed'
  | 'best'
  | 'bad'
  | 'twoTwelve'
  | 'lowCluster'
  | 'same'
  | 'clump'
  | 'balance'
  | 'fair'
  | 'desert'
  | 'spiral'
  | 'harborSpot';

/** Rule numbers and names, in the order the docs list them. */
export const RULE_INFO: Record<RuleId, { no: string; name: string }> = {
  red: { no: '5.2', name: 'Red numbers never touch' },
  harborGood: { no: '5.3', name: '2:1 harbors away from good numbers of their resource' },
  harborRed: { no: '5.4', name: 'No 6 or 8 at any harbor' },
  best: { no: '5.5', name: 'Best-spot limit' },
  bad: { no: '5.6', name: 'Bad-spot limit' },
  twoTwelve: { no: '5.7', name: '2 and 12 never touch' },
  lowCluster: { no: '5.8', name: 'No clusters of 2, 3, 11, 12' },
  same: { no: '5.9', name: 'Same number never touches' },
  clump: { no: '5.10', name: 'Resource clump limit' },
  balance: { no: '5.11', name: 'Resource balance' },
  fair: { no: '5.12', name: 'Starting fairness' },
  desert: { no: '5.15', name: 'Desert' },
  spiral: { no: '5.17', name: 'Official number spiral' },
  harborSpot: { no: '3.1', name: 'Harbors on the coast, never sharing a corner' },
};

export interface Violation {
  rule: RuleId;
  text: string;
  /** What's involved, for highlighting: hex indexes, corner (vertex) ids, harbor indexes. */
  hexes: number[];
  corners: number[];
  harbors: number[];
}

/** A board as the rules see it. null = not known yet (a blank). */
export interface BoardModel {
  g: Geometry;
  /** Terrain; null for a blank tile (always land). */
  t: (Terrain | null)[];
  /** Number token; 0 = none, null = not known yet. */
  n: (number | null)[];
  harbors: HarborSpot[];
}

export interface HarborSpot {
  t: PortType | null;
  hex: number;
  side: number;
  edge: number;
  /** The two corners at the ends of its side. */
  corners: [number, number];
  /** Every land hex those corners touch. */
  hexes: number[];
}

export const RED = (n: number | null) => n === 6 || n === 8;
const LOW = (n: number | null) => n === 2 || n === 3 || n === 11 || n === 12;
/** Blanks are always land. */
export const landAt = (b: BoardModel, h: number) => b.t[h] === null || isLand(b.t[h]!);

export function harborSpot(
  b: Pick<BoardModel, 'g' | 't'>,
  hex: number,
  side: number,
  t: PortType | null,
): HarborSpot {
  const edge = edgeOfSide(b.g, hex, side);
  const E = b.g.edges[edge]!;
  const hexes = [...new Set([...b.g.verts[E.a]!.hexes, ...b.g.verts[E.b]!.hexes])].filter(
    (h) => b.t[h] === null || isLand(b.t[h]!),
  );
  return { t, hex, side, edge, corners: [E.a, E.b], hexes: hexes.sort((x, y) => x - y) };
}

export function modelOf(m: MapData): BoardModel {
  const g = geometryFor(m.hexes.map((h) => ({ q: h.q, r: h.r })));
  const t = m.hexes.map((h) => (h.t === 'random' ? null : h.t));
  const n = m.hexes.map((h) => (typeof h.n === 'number' ? h.n : h.n === 'random' ? null : 0));
  const b: BoardModel = { g, t, n, harbors: [] };
  b.harbors = m.harbors.map((p) =>
    harborSpot(b, hexAt(m.hexes, p.q, p.r), p.side, p.t === 'random' ? null : p.t),
  );
  return b;
}

export const pipOf = (pips: Record<number, number>, n: number | null) => (n ? (pips[n] ?? 0) : 0);

/** A corner's pip total, counting unknown numbers as 0. */
export function cornerPip(b: BoardModel, v: number, pips: Record<number, number>): number {
  let s = 0;
  for (const h of b.g.verts[v]!.hexes) s += pipOf(pips, b.n[h]!);
  return s;
}

/** A corner whose three hexes are all land (the desert counts as land). */
export const inland = (b: BoardModel, v: number) =>
  b.g.verts[v]!.hexes.length === 3 && b.g.verts[v]!.hexes.every((h) => landAt(b, h));

/** Hexes with a side on the sea or the edge of the board. */
export function coastalHex(b: BoardModel, h: number): boolean {
  if (!landAt(b, h)) return false;
  return b.g.hexNeighbors[h]!.length < 6 || b.g.hexNeighbors[h]!.some((j) => !landAt(b, j));
}

/** The land hex nearest the middle of the land (ties: first in board order). */
export function centerHex(b: BoardModel): number {
  const land = b.g.hexes.flatMap((_, i) => (landAt(b, i) ? [i] : []));
  if (!land.length) return -1;
  const cx = land.reduce((a, i) => a + b.g.hexes[i]!.x, 0) / land.length;
  const cy = land.reduce((a, i) => a + b.g.hexes[i]!.y, 0) / land.length;
  let best = land[0]!;
  let bd = Infinity;
  for (const i of land) {
    const d = (b.g.hexes[i]!.x - cx) ** 2 + (b.g.hexes[i]!.y - cy) ** 2;
    if (d < bd - 1e-9) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Touching groups of one resource, as lists of hex indexes (known tiles only). */
export function clumps(b: BoardModel): { t: Resource; hexes: number[] }[] {
  const seen = new Set<number>();
  const out: { t: Resource; hexes: number[] }[] = [];
  b.t.forEach((t, i) => {
    if (seen.has(i) || !t || !isResource(t)) return;
    const group = [i];
    seen.add(i);
    for (let k = 0; k < group.length; k++)
      for (const j of b.g.hexNeighbors[group[k]!]!)
        if (!seen.has(j) && b.t[j] === t) {
          seen.add(j);
          group.push(j);
        }
    out.push({ t, hexes: group.sort((x, y) => x - y) });
  });
  return out;
}

/** Each resource's pip total and fair share (5.11). Only meaningful on a complete board. */
export function resourcePips(b: BoardModel, pips: Record<number, number>) {
  let total = 0;
  let producing = 0;
  const pipsBy = Object.fromEntries(RES.map((r) => [r, 0])) as Record<Resource, number>;
  const hexesBy = Object.fromEntries(RES.map((r) => [r, 0])) as Record<Resource, number>;
  b.t.forEach((t, i) => {
    const n = b.n[i];
    if (!n) return;
    total += pipOf(pips, n);
    producing++;
    if (t && isResource(t)) {
      pipsBy[t] += pipOf(pips, n);
      hexesBy[t]++;
    }
  });
  return RES.map((r) => ({
    r,
    pips: pipsBy[r],
    hexes: hexesBy[r],
    fair: producing ? (total * hexesBy[r]) / producing : 0,
  }));
}

/** Snake order for n players: 1, 2, …, n, n, …, 2, 1 (as seat numbers from 0). */
export const snake = (n: number) => [...Array(n).keys(), ...[...Array(n).keys()].reverse()];

export interface Draft {
  /** Each player's two corners, in pick order. */
  picks: number[][];
  scores: number[];
  gap: number;
}

/**
 * The greedy setup draft of 5.12: in snake order, each player takes the free corner with the
 * highest pip total (distance rule kept). Ties go to more different resources, then board order.
 */
export function greedyDraft(
  b: BoardModel,
  pips: Record<number, number>,
  players: number,
  start?: Set<number>,
): Draft {
  const resources = (v: number) =>
    new Set(b.g.verts[v]!.hexes.filter((h) => b.n[h]! > 0).map((h) => b.t[h])).size;
  const cand = b.g.verts
    .map((V, v) => ({
      v,
      p: cornerPip(b, v, pips),
      k: resources(v),
      ok: V.hexes.some((h) => landAt(b, h) && (!start || start.has(h))),
    }))
    .filter((c) => c.ok)
    .sort((x, y) => y.p - x.p || y.k - x.k || x.v - y.v);
  const blocked = new Set<number>();
  const picks: number[][] = Array.from({ length: players }, () => []);
  const scores = new Array<number>(players).fill(0);
  let i = 0;
  for (const p of snake(players)) {
    while (i < cand.length && blocked.has(cand[i]!.v)) i++;
    const c = cand[i];
    if (!c) break;
    picks[p]!.push(c.v);
    scores[p]! += c.p;
    blocked.add(c.v);
    for (const a of b.g.verts[c.v]!.adj) blocked.add(a);
  }
  return { picks, scores, gap: Math.max(...scores) - Math.min(...scores) };
}

/** The official token order, A to R. */
export const SPIRAL_TOKENS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

/**
 * The 12 spiral orders of the standard board (each outer corner, both directions), as hex
 * indexes; null if the land isn't the standard 19-hex shape.
 */
export function spiralOrders(b: BoardModel): number[][] | null {
  const land = b.g.hexes.flatMap((h, i) => (landAt(b, i) ? [i] : []));
  const at = (q: number, r: number) => b.g.hexes.findIndex((h) => h.q === q && h.r === r);
  const dist = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  if (land.length !== 19 || land.some((i) => dist(b.g.hexes[i]!.q, b.g.hexes[i]!.r) > 2)) return null;
  const ring = (rad: number) => {
    const hs = land.filter((i) => dist(b.g.hexes[i]!.q, b.g.hexes[i]!.r) === rad);
    return hs.sort(
      (i, j) => Math.atan2(b.g.hexes[i]!.y, b.g.hexes[i]!.x) - Math.atan2(b.g.hexes[j]!.y, b.g.hexes[j]!.x),
    );
  };
  const outer = ring(2);
  const inner = ring(1);
  const center = at(0, 0);
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // prettier-ignore
  const from = (list: number[], start: number, dir: 1 | -1) => {
    const k = list.indexOf(start);
    return list.map((_, j) => list[(k + dir * j + list.length * 2) % list.length]!);
  };
  const out: number[][] = [];
  for (const [dq, dr] of DIRS)
    for (const dir of [1, -1] as const)
      out.push([...from(outer, at(2 * dq!, 2 * dr!), dir), ...from(inner, at(dq!, dr!), dir), center]);
  return out;
}

/** Numbers laid along a spiral order, skipping hexes that take none; null if they don't fit. */
export function spiralNumbers(b: BoardModel, order: number[], tokens = SPIRAL_TOKENS): number[] | null {
  const n = new Array<number>(b.t.length).fill(0);
  let k = 0;
  for (const h of order) {
    const t = b.t[h];
    if (t === 'desert') continue;
    if (k >= tokens.length) return null;
    n[h] = tokens[k++]!;
  }
  return k === tokens.length ? n : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NAME: Record<string, string> = {
  wood: 'wood', brick: 'brick', sheep: 'sheep', wheat: 'wheat', ore: 'ore', any: '3:1',
}; // prettier-ignore

/**
 * Every rule the board breaks under these settings. Works on partial boards: unknown tiles,
 * numbers and harbor types never cause a violation, and whole-board rules (balance, fairness,
 * spiral) wait until the board is complete.
 */
export function checkBoard(m: MapData, rules: GenRules, players: number): Violation[] {
  const b = modelOf(m);
  const out: Violation[] = [];
  const add = (rule: RuleId, text: string, x: { hexes?: number[]; corners?: number[]; harbors?: number[] }) =>
    out.push({ rule, text, hexes: x.hexes ?? [], corners: x.corners ?? [], harbors: x.harbors ?? [] });
  const { g, t, n } = b;
  const pips = rules.pips;
  const pairs: [number, number][] = [];
  g.hexNeighbors.forEach((ns, i) => ns.forEach((j) => i < j && pairs.push([i, j])));

  // Harbors on the coast, never sharing a corner (3.1: a valid board needs this).
  const cornerOwner = new Map<number, number>();
  b.harbors.forEach((h, i) => {
    const E = g.edges[h.edge]!;
    const other = E.hexes.find((x) => x !== h.hex);
    if (!landAt(b, h.hex) || (other !== undefined && landAt(b, other)))
      add('harborSpot', 'A harbor isn’t on the coast', { harbors: [i], hexes: [h.hex] });
    for (const c of h.corners) {
      const j = cornerOwner.get(c);
      if (j !== undefined) add('harborSpot', 'Two harbors share a corner', { harbors: [j, i], corners: [c] });
      cornerOwner.set(c, i);
    }
  });

  for (const [i, j] of pairs) {
    const a = n[i]!;
    const c = n[j]!;
    if (!a || !c) continue;
    if (rules.redApart && RED(a) && RED(c)) add('red', `${a} and ${c} touch`, { hexes: [i, j] });
    if (rules.twoTwelveApart && ((a === 2 && c === 12) || (a === 12 && c === 2)))
      add('twoTwelve', '2 and 12 touch', { hexes: [i, j] });
    if (rules.sameApart && a === c) add('same', `Two ${a}s touch`, { hexes: [i, j] });
  }

  const desertAt = (v: number) => g.verts[v]!.hexes.some((h) => t[h] === 'desert');
  g.verts.forEach((V, v) => {
    const known = V.hexes.every((h) => n[h] !== null);
    const p = cornerPip(b, v, pips);
    if (rules.bestSpot !== null && p > rules.bestSpot)
      add('best', `A corner has ${p} pips (limit ${rules.bestSpot})`, { corners: [v], hexes: V.hexes });
    if (
      rules.badSpot !== null &&
      known &&
      inland(b, v) &&
      (rules.badSpotDesert || !desertAt(v)) &&
      p < rules.badSpot
    )
      add('bad', `An inland corner has ${plural(p, 'pip')} (limit ${rules.badSpot})`, {
        corners: [v],
        hexes: V.hexes,
      });
    if (rules.noLowClusters) {
      const low = V.hexes.filter((h) => LOW(n[h]!));
      if (low.length >= 2)
        add('lowCluster', `${low.map((h) => n[h]).join(' and ')} at one corner`, {
          corners: [v],
          hexes: low,
        });
    }
  });
  if (rules.lowClusterAllow && out.filter((x) => x.rule === 'lowCluster').length <= rules.lowClusterAllow)
    out.splice(0, out.length, ...out.filter((x) => x.rule !== 'lowCluster'));

  b.harbors.forEach((h, i) => {
    if (rules.harborNoRed) {
      const red = h.hexes.filter((x) => RED(n[x]!));
      if (red.length) add('harborRed', `A ${n[red[0]!]} touches a harbor`, { harbors: [i], hexes: red });
    }
    if (rules.harborGood !== 'off' && h.t && h.t !== 'any') {
      const good = (x: number | null) => RED(x) || (rules.harborGood === '5689' && (x === 5 || x === 9));
      const bad = h.hexes.filter((x) => t[x] === h.t && good(n[x]!));
      if (bad.length)
        add('harborGood', `The ${NAME[h.t]} 2:1 harbor touches ${NAME[h.t]} with a ${n[bad[0]!]}`, {
          harbors: [i],
          hexes: bad,
        });
    }
  });

  if (rules.clump !== null)
    for (const c of clumps(b))
      if (c.hexes.length > rules.clump)
        add('clump', `${c.hexes.length} ${NAME[c.t]} tiles touch (limit ${rules.clump})`, { hexes: c.hexes });

  const deserts = t.flatMap((x, i) => (x === 'desert' ? [i] : []));
  if (rules.desert === 'none' && deserts.length)
    add('desert', 'There’s a desert (setting: no desert)', { hexes: deserts });
  if (rules.desert === 'edge')
    for (const d of deserts)
      if (!coastalHex(b, d)) add('desert', 'The desert isn’t on the coast', { hexes: [d] });
  if (rules.desert === 'center') {
    const c = centerHex(b);
    if (c >= 0 && t[c] !== null && t[c] !== 'desert')
      add('desert', 'The desert isn’t in the middle', { hexes: [c] });
  }

  const complete = t.every((x) => x !== null) && n.every((x) => x !== null);
  if (!complete) return out;

  if (rules.balance !== null) {
    for (const r of resourcePips(b, pips)) {
      if (!r.hexes) continue;
      const lo = r.fair * (1 - rules.balance / 100);
      const hi = r.fair * (1 + rules.balance / 100);
      if (r.pips < lo - 1e-9 || r.pips > hi + 1e-9)
        add(
          'balance',
          `${cap(NAME[r.r]!)} has ${r.pips} pips; fair is ${Math.ceil(lo - 1e-9)}–${Math.floor(hi + 1e-9)}`,
          {
            hexes: t.flatMap((x, i) => (x === r.r ? [i] : [])),
          },
        );
    }
  }
  if (rules.fairness !== null) {
    const np = rules.fairPlayers ?? players;
    const d = greedyDraft(b, pips, np, startSet(m, b));
    if (d.gap > rules.fairness)
      add('fair', `Starting picks differ by ${d.gap} pips with ${np} players (limit ${rules.fairness})`, {
        corners: d.picks.flat(),
      });
  }
  if (rules.numbers === 'spiral') {
    const orders = spiralOrders(b);
    const fits = orders?.some((o) => {
      const want = spiralNumbers(b, o);
      return want !== null && want.every((x, i) => x === n[i]);
    });
    if (!fits) add('spiral', 'The numbers don’t follow the official spiral', {});
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The hexes starting settlements may touch, or undefined for all land. */
export function startSet(m: MapData, b: BoardModel): Set<number> | undefined {
  if (!Array.isArray(m.start)) return undefined;
  return startHexes(m, {
    hexes: m.hexes.map((h, i) => ({ q: h.q, r: h.r, t: b.t[i] ?? 'desert', n: 0 })),
    ports: [],
    robber: -1,
  });
}

/** The fairness summary (5.14) for a complete board. */
export function fairnessSummary(m: MapData, pips: Record<number, number> = DEFAULT_PIPS) {
  const b = modelOf(m);
  const terr = (v: number) => b.g.verts[v]!.hexes.filter((h) => b.n[h]! > 0).map((h) => b.t[h] as Terrain);
  const corners = b.g.verts.map((_, v) => ({ v, pips: cornerPip(b, v, pips), terrain: terr(v) }));
  const best = corners
    .slice()
    .sort((x, y) => y.pips - x.pips || x.v - y.v)
    .slice(0, 3);
  const inl = corners.filter((c) => inland(b, c.v)).sort((x, y) => x.pips - y.pips || x.v - y.v);
  const start = startSet(m, b);
  return {
    resources: resourcePips(b, pips),
    best,
    worstInland: inl[0] ?? null,
    draft: Object.fromEntries([3, 4].map((np) => [np, greedyDraft(b, pips, np, start)])) as Record<
      3 | 4,
      Draft
    >,
  };
}
