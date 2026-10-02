/*
 * Maps and scenarios are data (JSON files in packages/engine/maps). This module checks a map
 * file and turns it into a starting board, using the game's seeded random generator.
 *
 * Coordinates are axial q/r with pointy-top hexes. Hex sides are numbered 0-5 clockwise from
 * the east side: 0 east, 1 south-east, 2 south-west, 3 west, 4 north-west, 5 north-east.
 */

import { numbersOK } from './board';
import { geometryFor, type Geometry } from './geometry';
import { shuffle, type RngState } from './rng';
import {
  isLand,
  isResource,
  type Board,
  type HexData,
  type ModuleId,
  type PortType,
  type Terrain,
} from './types';

export interface MapHex {
  q: number;
  r: number;
  /** A terrain, or 'random' to draw from `pool`. */
  t: Terrain | 'random';
  pool?: string;
  /** A number token, 'random' (from the pool's numbers), or absent for none. */
  n?: number | 'random';
  /** Kept as they are when the generator fills the board (docs/maps.md 4.2). */
  lock?: { t?: boolean; n?: boolean };
}

export interface MapHarbor {
  /** The land hex the harbor belongs to, and which of its sides faces the water. */
  q: number;
  r: number;
  side: number;
  /** A harbor type, or 'random' to draw from `harborPool`. */
  t: PortType | 'random';
  /** Kept where it is, with its type, when the generator fills the board. */
  lock?: boolean;
}

/** Every tile, number token and harbor a board is made of, placed or still blank (docs/maps.md 3). */
export interface TileSet {
  terrain: Partial<Record<Terrain, number>>;
  /** Keyed by the token's number. */
  numbers: Record<string, number>;
  harbors: Partial<Record<PortType, number>>;
}

/** Where a map came from. Shown in the map list; never used by the rules. */
export interface MapMade {
  by?: string;
  at?: number;
  generator?: { preset: string; seed: string; rules?: import('./mapcheck').GenRules };
  /** Who edited it after it was generated. */
  edited?: string[];
}

export interface MapData {
  format: 1;
  id: string;
  name: string;
  /** Expansion modules this map needs. */
  modules: ModuleId[];
  /** Player counts this map supports. */
  players: number[];
  /** Default points to win. */
  winVP: number;
  /** Special victory points awarded by this scenario. */
  specialVP?: { newIsland?: number };
  /** Hexes, in a fixed order (the order defines board ids, so never reorder a published map). */
  hexes: MapHex[];
  /** Random terrain and numbers, drawn in the order listed. */
  pools?: Record<string, { terrain: Terrain[]; numbers: number[] }>;
  harbors: MapHarbor[];
  harborPool?: PortType[];
  /** Face-down stacks for fog hexes. */
  fog?: { terrain: Terrain[]; numbers: number[] };
  numberRules?: { noAdjacentRed?: boolean; noAdjacentSame?: boolean };
  /** Where starting settlements may go: 'all' land, or a list of hexes. Default 'all'. */
  start?: 'all' | [number, number][];
  /** 'desert' = the first desert hex, a hex, or null = off the board. */
  robber: 'desert' | [number, number] | null;
  /** Seafarers: a sea hex, or null = off the board. */
  pirate?: [number, number] | null;
  /** Editor maps: the tile set blanks are filled from (blanks get what's left after what's placed). */
  set?: TileSet;
  made?: MapMade;
}

/** The hex index at q,r, or -1. */
export function hexAt(hexes: readonly { q: number; r: number }[], q: number, r: number): number {
  return hexes.findIndex((h) => h.q === q && h.r === r);
}

/** The edge id for side `side` of hex `h`. */
export function edgeOfSide(g: Geometry, h: number, side: number): number {
  const a = g.hexVerts[h]![side]!;
  const b = g.hexVerts[h]![(side + 1) % 6]!;
  return g.verts[a]!.edges.find((e) => {
    const E = g.edges[e]!;
    return (E.a === a && E.b === b) || (E.a === b && E.b === a);
  })!;
}

const TERRAINS: readonly string[] = [
  'wood',
  'brick',
  'sheep',
  'wheat',
  'ore',
  'gold',
  'desert',
  'sea',
  'fog',
];
const PORTS: readonly string[] = ['any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
const produces = (t: Terrain) => isResource(t) || t === 'gold';

/** Problems with a map file; empty means it's usable. */
export function validateMap(m: MapData): string[] {
  const bad: string[] = [];
  if (m.format !== 1) bad.push('unknown format');
  if (!m.id || !m.name) bad.push('missing id or name');
  if (!m.players.length || m.players.some((n) => n < 2 || n > 6)) bad.push('player counts must be 2-6');
  if (!(m.winVP >= 3 && m.winVP <= 30)) bad.push('winVP out of range');
  const seen = new Set<string>();
  for (const h of m.hexes) {
    const k = `${h.q},${h.r}`;
    if (seen.has(k)) bad.push(`duplicate hex ${k}`);
    seen.add(k);
    if (h.t !== 'random' && !TERRAINS.includes(h.t)) bad.push(`hex ${k}: unknown terrain ${h.t}`);
    if (h.t === 'random' && !m.pools?.[h.pool ?? '']) bad.push(`hex ${k}: unknown pool ${h.pool}`);
    if (h.n === 'random' && !m.pools?.[h.pool ?? '']) bad.push(`hex ${k}: random number needs a pool`);
    if (typeof h.n === 'number' && (h.n < 2 || h.n > 12 || h.n === 7))
      bad.push(`hex ${k}: bad number ${h.n}`);
    if (h.t !== 'random' && typeof h.n === 'number' && !produces(h.t))
      bad.push(`hex ${k}: ${h.t} can't have a number`);
  }
  for (const [name, pool] of Object.entries(m.pools ?? {})) {
    const hs = m.hexes.filter((h) => h.t === 'random' && h.pool === name);
    if (hs.length !== pool.terrain.length)
      bad.push(`pool ${name}: ${pool.terrain.length} terrains for ${hs.length} hexes`);
    if (pool.terrain.some((t) => !TERRAINS.includes(t) || t === 'fog')) bad.push(`pool ${name}: bad terrain`);
    const numbered = m.hexes.filter((h) => h.pool === name && h.n === 'random');
    const needed = numbered.length - pool.terrain.filter((t) => !produces(t)).length;
    if (numbered.length && needed !== pool.numbers.length) {
      bad.push(`pool ${name}: ${pool.numbers.length} numbers for ${needed} producing hexes`);
    }
  }
  const coords = m.hexes.map((h) => ({ q: h.q, r: h.r }));
  if (!bad.length) {
    const g = geometryFor(coords);
    const randomPorts = m.harbors.filter((p) => p.t === 'random').length;
    if (randomPorts !== (m.harborPool?.length ?? 0))
      bad.push(`${randomPorts} random harbors but ${m.harborPool?.length ?? 0} in the pool`);
    for (const p of m.harbors) {
      const h = hexAt(coords, p.q, p.r);
      if (h < 0) bad.push(`harbor at missing hex ${p.q},${p.r}`);
      else if (!(p.side >= 0 && p.side <= 5)) bad.push(`harbor side ${p.side}`);
      else if (p.t !== 'random' && !PORTS.includes(p.t)) bad.push(`harbor type ${p.t}`);
      else {
        const e = g.edges[edgeOfSide(g, h, p.side)]!;
        const t = m.hexes[h]!.t;
        const other = e.hexes.find((x) => x !== h);
        const otherT = other == null ? 'sea' : m.hexes[other]!.t;
        if (t === 'sea' || t === 'fog' || (other != null && otherT !== 'sea'))
          bad.push(`harbor at ${p.q},${p.r} side ${p.side} isn't on the coast`);
      }
    }
    if (Array.isArray(m.start))
      for (const [q, r] of m.start) if (hexAt(coords, q, r) < 0) bad.push(`start hex ${q},${r} missing`);
    if (Array.isArray(m.robber)) {
      const h = hexAt(coords, m.robber[0], m.robber[1]);
      if (h < 0 || m.hexes[h]!.t === 'sea' || m.hexes[h]!.t === 'fog') bad.push('robber must start on land');
    }
    if (m.pirate) {
      const h = hexAt(coords, m.pirate[0], m.pirate[1]);
      if (h < 0 || m.hexes[h]!.t !== 'sea') bad.push('pirate must start on sea');
    }
    const fogHexes = m.hexes.filter((h) => h.t === 'fog').length;
    if (fogHexes) {
      if (!m.fog || m.fog.terrain.length < fogHexes)
        bad.push('fog stack smaller than the number of fog hexes');
      else {
        const landInStack = m.fog.terrain.filter(produces).length;
        if (m.fog.numbers.length < landInStack) bad.push('not enough fog number tokens');
      }
    }
    if ((m.fog?.terrain ?? []).includes('fog')) bad.push('fog stack can’t contain fog');
  }
  return bad;
}

/** Build the starting board from map data. Draws from `rng` in a fixed order. */
export function boardFromMap(
  m: MapData,
  rng: RngState,
): { board: Board; fog: { terrain: Terrain[]; numbers: number[] } } {
  const problems = validateMap(m);
  if (problems.length) throw new Error(`Bad map ${m.id}: ${problems.join('; ')}`);
  const coords = m.hexes.map((h) => ({ q: h.q, r: h.r }));
  const g = geometryFor(coords);
  const terr: Terrain[] = m.hexes.map((h) => (h.t === 'random' ? 'desert' : h.t));
  const nums: number[] = m.hexes.map((h) => (typeof h.n === 'number' ? h.n : 0));
  const pools = Object.entries(m.pools ?? {});

  // 1. Terrain for each pool.
  for (const [name, pool] of pools) {
    const idx = m.hexes.flatMap((h, i) => (h.t === 'random' && h.pool === name ? [i] : []));
    const drawn = shuffle(pool.terrain.slice(), rng);
    idx.forEach((i, k) => (terr[i] = drawn[k]!));
  }
  // 2. Numbers for each pool, re-drawn until the number rules hold (or give up after 5000 tries).
  const rules = { noAdjacentRed: true, noAdjacentSame: true, ...m.numberRules };
  for (const [name, pool] of pools) {
    const idx = m.hexes.flatMap((h, i) => (h.pool === name && h.n === 'random' ? [i] : []));
    if (!idx.length) continue;
    for (let tries = 0; tries < 5000; tries++) {
      const ns = shuffle(pool.numbers.slice(), rng);
      let k = 0;
      for (const i of idx) nums[i] = produces(terr[i]!) ? ns[k++]! : 0;
      if (numbersOK(g, nums, rules)) break;
    }
  }
  // 3. Harbor types.
  const portTypes = shuffle((m.harborPool ?? []).slice(), rng);
  let pk = 0;
  const ports = m.harbors.map((p) => ({
    e: edgeOfSide(g, hexAt(coords, p.q, p.r), p.side),
    t: p.t === 'random' ? portTypes[pk++]! : p.t,
  }));
  // 4. Fog stacks, face down.
  const fog = {
    terrain: shuffle((m.fog?.terrain ?? []).slice(), rng),
    numbers: shuffle((m.fog?.numbers ?? []).slice(), rng),
  };

  const hexes: HexData[] = m.hexes.map((h, i) => ({ q: h.q, r: h.r, t: terr[i]!, n: nums[i]! }));
  const robber =
    m.robber === 'desert' ? terr.indexOf('desert') : m.robber ? hexAt(coords, m.robber[0], m.robber[1]) : -1;
  const board: Board = { hexes, ports, robber };
  if (m.modules.includes('seafarers')) board.pirate = m.pirate ? hexAt(coords, m.pirate[0], m.pirate[1]) : -1;
  return { board, fog };
}

/** Hexes where starting settlements may go. */
export function startHexes(m: MapData | undefined, board: Board): Set<number> {
  if (!m || !m.start || m.start === 'all') {
    return new Set(board.hexes.flatMap((h, i) => (isLand(h.t) ? [i] : [])));
  }
  return new Set(m.start.map(([q, r]) => hexAt(board.hexes, q, r)));
}
