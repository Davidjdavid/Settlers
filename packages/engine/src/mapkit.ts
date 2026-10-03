/*
 * Map editing (docs/maps.md 3-4): pure functions over map files, shared by the editor, the
 * pre-game table and the tests. Every edit returns a new map, or a short reason it's refused.
 *
 * An editor map keeps its tile set in `set` (what the board is made of, placed or blank). Blank
 * tiles, numbers and harbors are 'random' entries drawn from the pool "auto", which is always the
 * set minus everything already placed: place a third ore by hand and there's one fewer to fill.
 */

import { cornerPip, DEFAULT_PIPS, modelOf } from './mapcheck';
import { geometryFor } from './geometry';
import { treasureKey, validateMap, type MapData, type MapHex, type TileSet } from './map';
import { isLand, type PortType, type Terrain } from './types';

/** The standard board's set: 19 tiles, 18 number tokens, 9 harbors. */
export const STANDARD_TERRAIN: Readonly<Partial<Record<Terrain, number>>> = {
  wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3, desert: 1,
}; // prettier-ignore
export const STANDARD_NUMBERS: Readonly<Record<string, number>> = {
  2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1,
}; // prettier-ignore
export const STANDARD_HARBORS: Readonly<Partial<Record<PortType, number>>> = {
  any: 4, wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1,
}; // prettier-ignore

/** Terrains that take a number token. Blanks always become land that might. */
export const producing = (t: Terrain | 'random') => t === 'random' || (isLand(t) && t !== 'desert');
/** Land for the tile set: blanks and every land terrain (fog has its own stack). */
const setLand = (t: Terrain | 'random') => t === 'random' || isLand(t);

type Counts = Record<string, number>;
const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
const bag = (xs: readonly (string | number)[]): Counts => {
  const out: Counts = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
};
const unbag = (c: Counts): string[] => Object.entries(c).flatMap(([k, n]) => new Array<string>(n).fill(k));

/**
 * Spread `counts` over `n` items in proportion (largest remainder; ties to the earlier key),
 * e.g. the standard 19-tile mix for a 25-hex island.
 */
export function scaled(counts: Readonly<Counts>, n: number): Counts {
  const keys = Object.keys(counts);
  const total = sum(counts as Counts);
  const out: Counts = {};
  if (!total || n <= 0) return out;
  const exact = keys.map((k) => (counts[k]! * n) / total);
  let left = n;
  keys.forEach((k, i) => {
    out[k] = Math.floor(exact[i]!);
    left -= out[k]!;
  });
  const order = keys
    .map((k, i) => ({ k, frac: exact[i]! - Math.floor(exact[i]!), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let j = 0; left > 0; j = (j + 1) % order.length, left--) out[order[j]!.k]!++;
  for (const k of keys) if (!out[k]) delete out[k];
  return out;
}

/** Add one item, keeping close to the standard proportions. */
function growOne(c: Counts, std: Readonly<Counts>) {
  const want = scaled(std, sum(c) + 1);
  const k = Object.keys(std).find((x) => (want[x] ?? 0) > (c[x] ?? 0)) ?? Object.keys(std)[0]!;
  c[k] = (c[k] ?? 0) + 1;
}

/** Remove one item: the one with the most still unplaced, then the most over its standard share. */
function shrinkOne(c: Counts, placed: Counts, std: Readonly<Counts>) {
  const want = scaled(std, Math.max(0, sum(c) - 1));
  const keys = Object.keys(c).filter((k) => c[k]! > 0);
  if (!keys.length) return;
  keys.sort(
    (a, b) =>
      c[b]! - (placed[b] ?? 0) - (c[a]! - (placed[a] ?? 0)) ||
      c[b]! - (want[b] ?? 0) - (c[a]! - (want[a] ?? 0)),
  );
  const k = keys[0]!;
  c[k]!--;
  if (!c[k]) delete c[k];
}

const ORDER = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold', 'desert', 'sea', 'any'];
const order = (a: string, b: string) =>
  /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : ORDER.indexOf(a) - ORDER.indexOf(b);

/** `want` minus what's placed (never below 0), made exactly `n` long, in a stable order. */
function fit(want: Counts, placed: Counts, n: number, std: Readonly<Counts>): string[] {
  const left: Counts = {};
  for (const [k, v] of Object.entries(want)) if (v - (placed[k] ?? 0) > 0) left[k] = v - (placed[k] ?? 0);
  while (sum(left) > n) shrinkOne(left, {}, std);
  while (sum(left) < n) growOne(left, std);
  return Object.keys(left)
    .sort(order)
    .flatMap((k) => new Array<string>(left[k]!).fill(k));
}

/** The hexes of one region, or (null) the hexes outside every region, which use the main set. */
export const hexesOf = (m: MapData, region: string | null): MapHex[] =>
  m.hexes.filter((h) => (h.region ?? null) === region);

/** What's placed on these hexes (all by default; blanks left out), and every placed harbor. */
export function placedOf(m: MapData, hexes: readonly MapHex[] = m.hexes): TileSet {
  return {
    terrain: bag(hexes.flatMap((h) => (h.t !== 'random' && isLand(h.t) ? [h.t] : []))),
    numbers: bag(hexes.flatMap((h) => (typeof h.n === 'number' ? [h.n] : []))),
    harbors: bag(m.harbors.flatMap((h) => (h.t !== 'random' ? [h.t] : []))),
  };
}

/**
 * The main tile set: the map's `set`, or what's placed outside regions plus what those hexes'
 * pools hold. Each region has its own set (SPEC 10.4).
 */
export function setOf(m: MapData): TileSet {
  if (m.set) return structuredClone(m.set);
  const main = hexesOf(m, null);
  const p = placedOf(m, main);
  const used = new Set(main.flatMap((h) => (h.pool ? [h.pool] : [])));
  const pools = Object.entries(m.pools ?? {}).flatMap(([k, v]) => (used.has(k) ? [v] : []));
  return {
    terrain: bag([...unbag(p.terrain as Counts), ...pools.flatMap((x) => x.terrain.filter(isLand))]),
    numbers: bag([...unbag(p.numbers), ...pools.flatMap((x) => x.numbers)]),
    harbors: bag([...unbag(p.harbors as Counts), ...(m.harborPool ?? [])]),
  };
}

/** The standard set scaled to a board with this much land and this many harbors. */
export function standardSet(land: number, harbors: number): TileSet {
  const terrain = scaled(STANDARD_TERRAIN as Counts, land);
  return {
    terrain,
    numbers: scaled(STANDARD_NUMBERS, land - (terrain.desert ?? 0)),
    harbors: scaled(STANDARD_HARBORS as Counts, harbors),
  };
}

const FOG_TERRAIN: Terrain[] = ['sea', 'wood', 'sheep', 'wheat', 'brick', 'ore', 'sea', 'gold'];
const FOG_NUMBERS = [5, 9, 4, 10, 6, 8, 3, 11, 2, 12];
/** What fog can hide. */
const FOG_CAN: readonly Terrain[] = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold', 'desert', 'sea'];

/**
 * Bring an editor map back in line after any change: the set follows the board's size, blanks
 * draw from the pool "auto" (the set minus what's placed), and stray references are cleared.
 * Loading any map file through this turns its pools into the one editor pool.
 */
export function normalize(m0: MapData): MapData {
  const m = structuredClone(m0);
  adoptPools(m);
  for (const h of m.hexes) if (h.region !== undefined && !m.regions?.[h.region]) delete h.region;
  // Fog in the map maker follows today's rules (seafarers.md §11.5): tips uncover, and uncovering
  // pays unless switched off. Maps without fog don't carry the settings.
  if (m.hexes.some((h) => h.t === 'fog')) {
    m.fogRewards ??= true;
    m.fogTips = true;
  } else {
    delete m.fogRewards;
    delete m.fogTips;
  }
  const set = setOf(m);
  delete m.set;
  for (const h of m.hexes) {
    if (h.t !== 'random' && !producing(h.t)) delete h.n;
    if (h.t === 'random' && !(typeof h.n === 'number' && h.lock?.n)) h.n = 'random';
    if (producing(h.t) && h.n === undefined) h.n = 'random';
    // Blanks draw from their region's pool, or the main one (SPEC 10.4).
    if (h.t === 'random' || h.n === 'random') h.pool = h.region ?? 'auto';
    else delete h.pool;
    if (h.lock && !h.lock.t && !h.lock.n) delete h.lock;
  }

  // Each set follows its hexes: one tile per land hex, one token per producing tile. Blanks
  // get what's left of their set after what's placed.
  const pools: NonNullable<MapData['pools']> = {};
  const follow = (set: TileSet, hexes: MapHex[], pool: string) => {
    const placed = placedOf(m, hexes);
    const terrain = set.terrain as Counts;
    const land = hexes.filter((h) => setLand(h.t)).length;
    while (sum(terrain) < land) growOne(terrain, STANDARD_TERRAIN as Counts);
    while (sum(terrain) > land) shrinkOne(terrain, placed.terrain as Counts, STANDARD_TERRAIN as Counts);
    const prod = land - (terrain.desert ?? 0);
    while (sum(set.numbers) < prod) growOne(set.numbers, STANDARD_NUMBERS);
    while (sum(set.numbers) > prod) shrinkOne(set.numbers, placed.numbers, STANDARD_NUMBERS);
    const blanks = hexes.filter((h) => h.t === 'random').length;
    const poolT = fit(terrain, placed.terrain as Counts, blanks, STANDARD_TERRAIN as Counts) as Terrain[];
    const numbered = hexes.filter((h) => h.n === 'random').length;
    const deserts = poolT.filter((t) => !producing(t)).length;
    const poolN = fit(set.numbers, placed.numbers, Math.max(0, numbered - deserts), STANDARD_NUMBERS).map(
      Number,
    );
    if (blanks || numbered) pools[pool] = { terrain: poolT, numbers: poolN };
  };
  follow(set, hexesOf(m, null), 'auto');
  for (const [id, r] of Object.entries(m.regions ?? {})) {
    r.set.harbors = {};
    follow(r.set, hexesOf(m, id), id);
  }
  delete m.pools;
  if (Object.keys(pools).length) m.pools = pools;

  // Harbors are the main set's.
  const placed = placedOf(m);
  const harbors = set.harbors as Counts;
  while (sum(harbors) < m.harbors.length) growOne(harbors, STANDARD_HARBORS as Counts);
  while (sum(harbors) > m.harbors.length)
    shrinkOne(harbors, placed.harbors as Counts, STANDARD_HARBORS as Counts);

  const randomH = m.harbors.filter((h) => h.t === 'random').length;
  delete m.harborPool;
  if (randomH)
    m.harborPool = fit(harbors, placed.harbors as Counts, randomH, STANDARD_HARBORS as Counts) as PortType[];

  // Fog stacks hold at least one card per fog hex.
  const fogHexes = m.hexes.filter((h) => h.t === 'fog').length;
  if (!fogHexes) delete m.fog;
  else {
    const fog = m.fog ?? { terrain: [], numbers: [] };
    while (fog.terrain.length < fogHexes)
      fog.terrain.push(FOG_TERRAIN[fog.terrain.length % FOG_TERRAIN.length]!);
    const need = fog.terrain.filter((t) => isLand(t) && t !== 'desert').length;
    while (fog.numbers.length < need) fog.numbers.push(FOG_NUMBERS[fog.numbers.length % FOG_NUMBERS.length]!);
    m.fog = fog;
  }

  const has = (q: number, r: number, ok: (t: MapHex['t']) => boolean) =>
    m.hexes.some((h) => h.q === q && h.r === r && ok(h.t));
  if (Array.isArray(m.robber) && !has(m.robber[0], m.robber[1], (t) => t !== 'sea' && t !== 'fog'))
    m.robber = 'desert';
  if (m.pirate && !has(m.pirate[0], m.pirate[1], (t) => t === 'sea')) m.pirate = null;
  if (Array.isArray(m.start)) m.start = m.start.filter(([q, r]) => has(q, r, () => true));
  m.set = set;
  return m;
}

/**
 * A scenario map with several pools (Heading for New Shores: the main island and the isles)
 * opens in the editor with each pool as a region, so its blanks stay where they belong.
 */
function adoptPools(m: MapData) {
  if (m.regions || m.set) return;
  const names = [...new Set(m.hexes.flatMap((h) => (h.pool ? [h.pool] : [])))];
  if (names.length < 2) return;
  m.regions = {};
  for (const name of names) {
    const hexes = m.hexes.filter((h) => h.pool === name);
    const placed = placedOf(m, hexes);
    const pool = m.pools?.[name] ?? { terrain: [], numbers: [] };
    m.regions[name] = {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      set: {
        terrain: bag([...unbag(placed.terrain as Counts), ...pool.terrain.filter(isLand)]),
        numbers: bag([...unbag(placed.numbers), ...pool.numbers]),
        harbors: {},
      },
    };
    for (const h of hexes) h.region = name;
  }
}

/** A new map: the standard board's 19 hexes and 9 harbor spots, all blank. */
export function standardBlank(base: MapData, id: string, name: string): MapData {
  return normalize({
    format: 1,
    id,
    name,
    modules: [],
    players: [2, 3, 4],
    winVP: 10,
    hexes: base.hexes.map((h) => ({ q: h.q, r: h.r, t: 'random', n: 'random', pool: 'auto' })),
    harbors: base.harbors.map((h) => ({ q: h.q, r: h.r, side: h.side, t: 'random' })),
    robber: 'desert',
    set: standardSet(base.hexes.length, base.harbors.length),
  });
}

/** A new map with nothing on it. */
export function emptyMap(id: string, name: string): MapData {
  return normalize({
    format: 1,
    id,
    name,
    modules: [],
    players: [2, 3, 4],
    winVP: 10,
    hexes: [],
    harbors: [],
    robber: 'desert',
  });
}

/* ---------- Edits ---------- */

export type At = [number, number];
export type Side = { at: At; side: number };

export type EditOp =
  /** Set a hex's terrain ('random' = blank). Its number goes if the terrain can't hold one. */
  | { k: 'terrain'; at: At; t: Terrain | 'random' }
  /** Set a hex's number token ('random' = blank). */
  | { k: 'number'; at: At; n: number | 'random' }
  /** Put a harbor on a coastal side ('random' = blank type), or take it away (null). */
  | { k: 'harbor'; at: At; side: number; t: PortType | 'random' | null }
  /** Drag a tile (terrain and number) onto another hex: they swap. */
  | { k: 'swapTile'; a: At; b: At }
  /** Drag a number token onto another hex: they swap. */
  | { k: 'swapNumber'; a: At; b: At }
  /** Drag a harbor to another coastal side, swapping with a harbor there. */
  | { k: 'moveHarbor'; from: Side; to: Side }
  /** Reshape: add a hex next to the board (always at the end of the list), or remove one. */
  | { k: 'addHex'; at: At; t: Terrain | 'random' }
  | { k: 'removeHex'; at: At }
  /** Lock a placed terrain or number, or a harbor, so filling and rerolling keep it. */
  | { k: 'lock'; at: At; what: 't' | 'n'; on: boolean }
  | { k: 'lockHarbor'; at: At; side: number; on: boolean }
  /** Turn everything that isn't locked back to blank. */
  | { k: 'clear' }
  /** Seafarers (SPEC 10.1): paint a hex in or out of the start area (none painted = all land). */
  | { k: 'start'; at: At; on: boolean }
  /** Seafarers: points for settling a new island, 0–3. */
  | { k: 'islandVP'; n: number }
  /** Treasures (SPEC 10.3): put a treasure spot on a side of a hex, or take it away. Any mode. */
  | { k: 'treasure'; at: At; side: number; on: boolean }
  /** Seafarers: where the pirate starts, a sea hex or off the board (null). */
  | { k: 'pirate'; at: At | null }
  /** Seafarers (10.2): what can turn up under the fog, or the standard stack. */
  | { k: 'fogStack'; terrain: Terrain[]; numbers: number[] }
  | { k: 'fogStack'; standard: true }
  /** Whether uncovering fog pays: land a card, sea or desert a treasure (seafarers.md §11.5). */
  | { k: 'fogRewards'; on: boolean }
  /** Regions (SPEC 10.4): add one, rename or remove it, paint a hex into one or out (null). */
  | { k: 'addRegion'; name?: string }
  | { k: 'renameRegion'; region: string; name: string }
  | { k: 'removeRegion'; region: string }
  | { k: 'region'; at: At; region: string | null }
  /**
   * Swap one tile of a kind into (+1) or out of (−1) the main set (null) or a region's. The
   * set keeps one tile per land hex: another kind makes room, or fills the gap.
   */
  | { k: 'setTile'; region: string | null; t: Terrain; delta: 1 | -1 }
  /** Name, player counts, points to win, Seafarers. */
  | { k: 'meta'; name?: string; players?: number[]; winVP?: number; seafarers?: boolean }
  /** Replace the whole map (a fill, or a generated board). */
  | { k: 'replace'; map: MapData };

export type EditResult = { ok: true; map: MapData } | { ok: false; error: string };

/** Neighbouring positions across sides 0 (east) to 5 (north-east). */
export const SIDE_DIR: readonly At[] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // prettier-ignore
const SIDES = [0, 1, 2, 3, 4, 5];
const SEAFARERS_ONLY: readonly string[] = ['sea', 'gold', 'fog'];
export const MAX_HEXES = 120;
export const MAX_REGIONS = 12;
/** Most treasure spots on a map (the server's schema allows the same). */
export const MAX_TREASURES = 40;

const sameAt = (h: { q: number; r: number }, at: At) => h.q === at[0] && h.r === at[1];
export const across = (at: At, side: number): At => [at[0] + SIDE_DIR[side]![0], at[1] + SIDE_DIR[side]![1]];

/** Side `side` of hex `at` faces the sea or the edge of the board, and the hex is land (or blank). */
export function coastal(m: MapData, at: At, side: number): boolean {
  const h = m.hexes.find((x) => sameAt(x, at));
  if (!h || h.t === 'sea' || h.t === 'fog') return false;
  const o = m.hexes.find((x) => sameAt(x, across(at, side)));
  return !o || o.t === 'sea';
}

/** Every coastal side (where a harbor could go). */
export function coastalSides(m: MapData): Side[] {
  return m.hexes.flatMap((h) =>
    SIDES.filter((s) => coastal(m, [h.q, h.r], s)).map((side) => ({ at: [h.q, h.r] as At, side })),
  );
}

/** The two corners of a side, as keys that every hex sharing the corner agrees on. */
export function cornerKeys(at: At, side: number): [string, string] {
  const key = (xs: At[]) =>
    xs
      .map((x) => x.join(','))
      .sort()
      .join('|');
  return [
    key([at, across(at, (side + 5) % 6), across(at, side)]),
    key([at, across(at, side), across(at, (side + 1) % 6)]),
  ];
}

/** Harbors that share a corner with another, as pairs of indexes. */
export function sharedCorners(m: MapData): [number, number][] {
  const seen = new Map<string, number>();
  const out: [number, number][] = [];
  m.harbors.forEach((h, i) => {
    for (const k of cornerKeys([h.q, h.r], h.side)) {
      const j = seen.get(k);
      if (j !== undefined && j !== i) out.push([j, i]);
      seen.set(k, i);
    }
  });
  return out;
}

/** A sea hex with hexes on all six sides (inside the board) is Seafarers play. */
const innerSea = (m: MapData, h: MapHex) =>
  h.t === 'sea' && SIDES.every((s) => m.hexes.some((x) => sameAt(x, across([h.q, h.r], s))));

/** Everything that stops a map being saved (docs/maps.md 3.1). Rule warnings are separate. */
export function mapProblems(m: MapData): string[] {
  const bad = validateMap(m);
  if (!m.hexes.length) bad.push('the map has no hexes');
  if (sharedCorners(m).length) bad.push('two harbors share a corner');
  if (
    !m.modules.includes('seafarers') &&
    m.hexes.some((h) => h.t === 'gold' || h.t === 'fog' || innerSea(m, h))
  )
    bad.push('sea, gold and fog tiles need Seafarers');
  if (m.players.some((n) => n > 4)) bad.push('maps are for 2 to 4 players');
  // A game can't start without room for everyone's two starting settlements (SPEC 10.1).
  if (m.modules.includes('seafarers') && Array.isArray(m.start)) {
    const need = 2 * Math.max(...m.players);
    const spots = startSpots(m);
    if (spots < need)
      bad.push(
        `the start area has room for ${spots} starting settlements; ${Math.max(...m.players)} players need ${need}`,
      );
  }
  if (m.hexes.length > MAX_HEXES) bad.push('the map is too big');
  return bad;
}

/**
 * How many starting settlements fit in the start area at once: corners on its land (blank
 * tiles count as land), two apart, picked greedily. Used for the one hard check on a start area.
 */
export function startSpots(m: MapData): number {
  if (!Array.isArray(m.start)) return Infinity;
  const g = geometryFor(m.hexes);
  const start = new Set(m.start.map(([q, r]) => m.hexes.findIndex((h) => h.q === q && h.r === r)));
  const land = (h: number) => setLand(m.hexes[h]!.t);
  const taken = new Set<number>();
  let n = 0;
  g.verts.forEach((V, v) => {
    if (!V.hexes.some((h) => start.has(h) && land(h))) return;
    const near = V.edges.map((e) => (g.edges[e]!.a === v ? g.edges[e]!.b : g.edges[e]!.a));
    if (taken.has(v) || near.some((u) => taken.has(u))) return;
    taken.add(v);
    n++;
  });
  return n;
}

/** Apply one edit. */
export function applyEdit(m0: MapData, op: EditOp): EditResult {
  if (op.k === 'replace') return { ok: true, map: normalize(op.map) };
  const m = structuredClone(m0);
  const hex = (at: At) => m.hexes.find((h) => sameAt(h, at));
  const harborAt = (at: At, side: number) => m.harbors.findIndex((x) => sameAt(x, at) && x.side === side);
  const fail = (error: string): EditResult => ({ ok: false, error });
  const dropStrandedHarbors = () => (m.harbors = m.harbors.filter((x) => coastal(m, [x.q, x.r], x.side)));
  switch (op.k) {
    case 'terrain': {
      const h = hex(op.at);
      if (!h) return fail('There’s no hex there');
      if (h.lock?.t) return fail('That tile is locked');
      if (SEAFARERS_ONLY.includes(op.t) && !m.modules.includes('seafarers'))
        return fail('Sea, gold and fog need Seafarers');
      if (op.t !== 'random' && !producing(op.t) && h.lock?.n) return fail('Its number is locked');
      h.t = op.t;
      if (op.t === 'random' && !h.lock?.n) h.n = 'random';
      dropStrandedHarbors();
      break;
    }
    case 'number': {
      const h = hex(op.at);
      if (!h) return fail('There’s no hex there');
      if (h.lock?.n) return fail('That number is locked');
      if (op.n !== 'random' && !(Number.isInteger(op.n) && op.n >= 2 && op.n <= 12 && op.n !== 7))
        return fail('Numbers go from 2 to 12, without 7');
      if (h.t === 'random') return fail('Place a tile there first');
      if (!producing(h.t))
        return fail(
          h.t === 'desert' ? 'The desert doesn’t take a number' : 'That tile doesn’t take a number',
        );
      h.n = op.n;
      break;
    }
    case 'harbor': {
      const i = harborAt(op.at, op.side);
      if (i >= 0 && m.harbors[i]!.lock) return fail('That harbor is locked');
      if (op.t === null) {
        if (i < 0) return fail('There’s no harbor there');
        m.harbors.splice(i, 1);
        break;
      }
      if (!coastal(m, op.at, op.side)) return fail('Harbors go on the coast');
      if (i >= 0) m.harbors[i]!.t = op.t;
      else m.harbors.push({ q: op.at[0], r: op.at[1], side: op.side, t: op.t });
      if (sharedCorners(m).length) return fail('Two harbors can’t share a corner');
      break;
    }
    case 'swapTile': {
      const a = hex(op.a);
      const b = hex(op.b);
      if (!a || !b) return fail('There’s no hex there');
      if (a.lock || b.lock) return fail('That tile is locked');
      [a.t, b.t] = [b.t, a.t];
      [a.n, b.n] = [b.n, a.n];
      for (const h of [a, b]) if (h.n === undefined) delete h.n;
      dropStrandedHarbors();
      break;
    }
    case 'swapNumber': {
      const a = hex(op.a);
      const b = hex(op.b);
      if (!a || !b) return fail('There’s no hex there');
      if (a.lock?.n || b.lock?.n) return fail('That number is locked');
      if (a.t === 'random' || b.t === 'random') return fail('Place a tile there first');
      if (!producing(a.t) || !producing(b.t)) return fail('Numbers only go on tiles that produce');
      [a.n, b.n] = [b.n, a.n];
      break;
    }
    case 'moveHarbor': {
      const i = harborAt(op.from.at, op.from.side);
      if (i < 0) return fail('There’s no harbor there');
      const j = harborAt(op.to.at, op.to.side);
      if (m.harbors[i]!.lock || (j >= 0 && m.harbors[j]!.lock)) return fail('That harbor is locked');
      if (!coastal(m, op.to.at, op.to.side)) return fail('Harbors go on the coast');
      const h = m.harbors[i]!;
      if (j >= 0) [h.t, m.harbors[j]!.t] = [m.harbors[j]!.t, h.t];
      else Object.assign(h, { q: op.to.at[0], r: op.to.at[1], side: op.to.side });
      if (sharedCorners(m).length) return fail('Two harbors can’t share a corner');
      break;
    }
    case 'addHex': {
      if (hex(op.at)) return fail('There’s already a hex there');
      if (m.hexes.length && !SIDES.some((s) => hex(across(op.at, s))))
        return fail('New hexes go next to the board');
      if (m.hexes.length >= MAX_HEXES) return fail('That’s as big as a board can get');
      if (SEAFARERS_ONLY.includes(op.t) && !m.modules.includes('seafarers'))
        return fail('Sea, gold and fog need Seafarers');
      // Board ids come from the hex order, so new hexes always go at the end (3.1).
      m.hexes.push({ q: op.at[0], r: op.at[1], t: op.t });
      dropStrandedHarbors();
      break;
    }
    case 'removeHex': {
      const i = m.hexes.findIndex((h) => sameAt(h, op.at));
      if (i < 0) return fail('There’s no hex there');
      if (m.hexes[i]!.lock) return fail('That tile is locked');
      m.hexes.splice(i, 1);
      m.harbors = m.harbors.filter((x) => !sameAt(x, op.at));
      // A treasure named by the removed hex goes with it.
      if (m.treasures) {
        m.treasures = m.treasures.filter((x) => !sameAt(x, op.at));
        if (!m.treasures.length) delete m.treasures;
      }
      dropStrandedHarbors();
      break;
    }
    case 'lock': {
      const h = hex(op.at);
      if (!h) return fail('There’s no hex there');
      if (op.on && op.what === 't' && h.t === 'random') return fail('Place a tile there first');
      if (op.on && op.what === 'n' && typeof h.n !== 'number') return fail('Place a number there first');
      const lock = { ...h.lock };
      if (op.on) lock[op.what] = true;
      else delete lock[op.what];
      h.lock = lock;
      break;
    }
    case 'lockHarbor': {
      const i = harborAt(op.at, op.side);
      if (i < 0) return fail('There’s no harbor there');
      if (op.on) m.harbors[i]!.lock = true;
      else delete m.harbors[i]!.lock;
      break;
    }
    case 'clear': {
      for (const h of m.hexes) {
        if (h.t === 'sea' || h.t === 'fog') continue;
        if (!h.lock?.t) h.t = 'random';
        if (!h.lock?.n && producing(h.t)) h.n = 'random';
      }
      for (const h of m.harbors) if (!h.lock) h.t = 'random';
      break;
    }
    case 'start': {
      if (!m.modules.includes('seafarers')) return fail('A start area needs Seafarers');
      if (!hex(op.at)) return fail('There’s no hex there');
      const list = (Array.isArray(m.start) ? m.start : []).filter(
        (x) => !sameAt({ q: x[0], r: x[1] }, op.at),
      );
      if (op.on) list.push([op.at[0], op.at[1]]);
      // Nothing painted means everywhere, as before.
      m.start = list.length ? list : 'all';
      break;
    }
    case 'fogRewards': {
      if (!m.hexes.some((h) => h.t === 'fog')) return fail('Add some fog first');
      m.fogRewards = !!op.on;
      m.fogTips = true;
      break;
    }
    case 'islandVP': {
      if (!m.modules.includes('seafarers')) return fail('Island points need Seafarers');
      if (!(Number.isInteger(op.n) && op.n >= 0 && op.n <= 3)) return fail('Island points go from 0 to 3');
      if (op.n) m.specialVP = { ...m.specialVP, newIsland: op.n };
      else delete m.specialVP;
      break;
    }
    case 'treasure': {
      if (!hex(op.at) || !(op.side >= 0 && op.side <= 5)) return fail('There’s no hex there');
      const key = treasureKey({ q: op.at[0], r: op.at[1], side: op.side });
      const list = (m.treasures ?? []).filter((t) => treasureKey(t) !== key);
      const had = list.length !== (m.treasures ?? []).length;
      if (op.on) {
        if (had) return fail('There’s a treasure there already');
        if (list.length >= MAX_TREASURES) return fail(`At most ${MAX_TREASURES} treasures`);
        list.push({ q: op.at[0], r: op.at[1], side: op.side });
      } else if (!had) return fail('There’s no treasure there');
      if (list.length) m.treasures = list;
      else delete m.treasures;
      break;
    }
    case 'pirate': {
      if (!m.modules.includes('seafarers')) return fail('The pirate needs Seafarers');
      if (op.at) {
        const h = hex(op.at);
        if (!h || h.t !== 'sea') return fail('The pirate starts on the sea');
        m.pirate = [op.at[0], op.at[1]];
      } else m.pirate = null;
      break;
    }
    case 'fogStack': {
      if (!m.modules.includes('seafarers')) return fail('Fog needs Seafarers');
      if ('standard' in op) {
        delete m.fog;
        break;
      }
      if (op.terrain.some((t) => t === 'fog' || !FOG_CAN.includes(t)))
        return fail('Fog hides land, gold or sea');
      if (op.numbers.some((n) => !(Number.isInteger(n) && n >= 2 && n <= 12 && n !== 7)))
        return fail('Numbers go from 2 to 12, without 7');
      const fogHexes = m.hexes.filter((h) => h.t === 'fog').length;
      if (op.terrain.length < fogHexes)
        return fail(`The fog stack needs a tile for each of the ${fogHexes} fog hexes`);
      const producing = op.terrain.filter((t) => isLand(t) && t !== 'desert').length;
      if (op.numbers.length < producing) return fail(`The fog stack needs ${producing} numbers for its land`);
      m.fog = { terrain: op.terrain.slice(), numbers: op.numbers.slice() };
      break;
    }
    case 'addRegion': {
      const regions = (m.regions ??= {});
      if (Object.keys(regions).length >= MAX_REGIONS) return fail(`A map can have ${MAX_REGIONS} regions`);
      let i = 1;
      while (regions[`r${i}`]) i++;
      const name = (op.name ?? `Region ${String.fromCharCode(64 + i)}`).trim().slice(0, 40);
      regions[`r${i}`] = { name: name || `Region ${i}`, set: { terrain: {}, numbers: {}, harbors: {} } };
      break;
    }
    case 'renameRegion': {
      const r = m.regions?.[op.region];
      if (!r) return fail('There’s no such region');
      const name = op.name.trim().slice(0, 40);
      if (!name) return fail('Give the region a name');
      r.name = name;
      break;
    }
    case 'removeRegion': {
      if (!m.regions?.[op.region]) return fail('There’s no such region');
      delete m.regions[op.region];
      for (const h of m.hexes) if (h.region === op.region) delete h.region;
      if (!Object.keys(m.regions).length) delete m.regions;
      break;
    }
    case 'region': {
      const h = hex(op.at);
      if (!h) return fail('There’s no hex there');
      if (op.region === null) delete h.region;
      else if (!m.regions?.[op.region]) return fail('There’s no such region');
      else h.region = op.region;
      break;
    }
    case 'setTile': {
      const set = op.region === null ? m.set : m.regions?.[op.region]?.set;
      if (!set) return fail('There’s no such region');
      if (!isLand(op.t)) return fail('Sets hold land tiles');
      if (op.t === 'gold' && !m.modules.includes('seafarers')) return fail('Gold needs Seafarers');
      const hexes = hexesOf(m, op.region);
      const land = hexes.filter((h) => setLand(h.t)).length;
      const placed = placedOf(m, hexes).terrain as Counts;
      const c = set.terrain as Counts;
      const spare = (k: string) => (c[k] ?? 0) - (placed[k] ?? 0);
      if (op.delta === 1) {
        if (!land) return fail('Paint some hexes into it first');
        // The kind with the most spare tiles makes room.
        const out = Object.keys(c)
          .filter((k) => k !== op.t && spare(k) > 0)
          .sort((a, b) => spare(b) - spare(a))[0];
        if (!out) return fail('Every other tile is on the board');
        c[out]!--;
        if (!c[out]) delete c[out];
        c[op.t] = (c[op.t] ?? 0) + 1;
      } else {
        if (spare(op.t) <= 0)
          return fail(c[op.t] ? 'They’re all on the board' : 'There are none to take out');
        c[op.t]!--;
        if (!c[op.t]) delete c[op.t];
        // The kind furthest below its standard share fills the gap.
        const want = scaled(STANDARD_TERRAIN as Counts, sum(c) + 1);
        const fill =
          Object.keys(want)
            .filter((k) => k !== op.t)
            .sort((a, b) => want[b]! - (c[b] ?? 0) - (want[a]! - (c[a] ?? 0)))[0] ?? 'desert';
        c[fill] = (c[fill] ?? 0) + 1;
      }
      break;
    }
    case 'meta': {
      if (op.name !== undefined) {
        const name = op.name.trim().slice(0, 40);
        if (!name) return fail('Give the map a name');
        m.name = name;
      }
      if (op.players) {
        if (!op.players.length || op.players.some((n) => !(n >= 2 && n <= 4)))
          return fail('Maps are for 2 to 4 players');
        m.players = [...new Set(op.players)].sort();
      }
      if (op.winVP !== undefined) {
        if (!(Number.isInteger(op.winVP) && op.winVP >= 3 && op.winVP <= 30))
          return fail('Points to win go from 3 to 30');
        m.winVP = op.winVP;
      }
      if (op.seafarers !== undefined) {
        if (!op.seafarers && m.hexes.some((h) => SEAFARERS_ONLY.includes(h.t)))
          return fail('Take away the sea, gold and fog first');
        m.modules = op.seafarers ? ['seafarers'] : [];
        if (!op.seafarers) {
          delete m.specialVP;
          delete m.pirate;
        }
      }
      break;
    }
  }
  return { ok: true, map: normalize(m) };
}

/* ---------- Rerolling around locks ---------- */

/**
 * The source map with `current`'s locked pieces put in (docs/pregame.md 1.2): rerolling fills
 * this, so locks survive and everything else is drawn again. The hexes are the same as the
 * source's (the table can't reshape). Each locked piece leaves its pool, so counts stay right.
 */
export function withLocks(source: MapData, current: MapData): MapData {
  const out = structuredClone(source);
  const take = <T>(list: T[] | undefined, x: T) => {
    if (!list?.length) return;
    const i = list.indexOf(x);
    list.splice(i >= 0 ? i : list.length - 1, 1);
  };
  current.hexes.forEach((c, i) => {
    const h = out.hexes[i];
    if (!h || h.q !== c.q || h.r !== c.r || !c.lock) return;
    const pool = h.pool ? out.pools?.[h.pool] : undefined;
    if (c.lock.t && c.t !== 'random' && h.t === 'random') {
      take(pool?.terrain, c.t);
      h.t = c.t;
      // A locked desert takes no number (fixPoolNumbers evens out the pool).
      if (!producing(c.t)) delete h.n;
    }
    if (c.lock.n && typeof c.n === 'number' && h.n === 'random') {
      take(pool?.numbers, c.n);
      h.n = c.n;
    }
    h.lock = { ...c.lock };
    if (h.t !== 'random' && h.n !== 'random') delete h.pool;
  });
  for (const c of current.harbors) {
    if (!c.lock || c.t === 'random') continue;
    const i = out.harbors.findIndex((h) => h.q === c.q && h.r === c.r && h.side === c.side);
    if (i >= 0) {
      if (out.harbors[i]!.t === 'random') take(out.harborPool, c.t);
      out.harbors[i] = { ...c };
    } else {
      // A harbor moved on the table: it replaces a blank harbor sharing a corner, or the last blank.
      const keys = new Set(cornerKeys([c.q, c.r], c.side));
      let j = out.harbors.findIndex(
        (h) => h.t === 'random' && cornerKeys([h.q, h.r], h.side).some((k) => keys.has(k)),
      );
      if (j < 0) j = out.harbors.map((h) => h.t).lastIndexOf('random');
      if (j < 0) continue;
      out.harbors.splice(j, 1);
      take(out.harborPool, c.t);
      out.harbors.push({ ...c });
    }
  }
  if (out.harborPool && !out.harborPool.length) delete out.harborPool;
  return fixPoolNumbers(out);
}

/** Make each pool's number count match its hexes again (a locked desert or number can change it). */
function fixPoolNumbers(m: MapData): MapData {
  for (const [name, pool] of Object.entries(m.pools ?? {})) {
    const numbered = m.hexes.filter((h) => h.pool === name && h.n === 'random').length;
    const want = Math.max(0, numbered - pool.terrain.filter((t) => !producing(t)).length);
    while (pool.numbers.length > want) pool.numbers.pop();
    while (pool.numbers.length < want) pool.numbers.push(5);
  }
  return m;
}

/* ---------- Reading a board ---------- */

/** Pip total at every corner (the heat map), by corner id; unknown numbers count 0. */
export function cornerPips(m: MapData, pips: Record<number, number> = DEFAULT_PIPS): number[] {
  const b = modelOf(m);
  return b.g.verts.map((_, v) => cornerPip(b, v, pips));
}

/** What's on the board against the set, for the editor's counts line. */
/** What's placed against the set: the main set's (null) or a region's (SPEC 10.4). */
export function counts(m: MapData, region: string | null = null): { placed: TileSet; set: TileSet } {
  const set = region === null ? setOf(m) : (structuredClone(m.regions?.[region]?.set) ?? setOf(m));
  return { placed: placedOf(m, hexesOf(m, region)), set };
}

/** The editor's undo and redo: every edit is one step. */
export class EditHistory {
  private past: MapData[] = [];
  private future: MapData[] = [];
  constructor(public map: MapData) {}
  apply(op: EditOp): EditResult {
    const r = applyEdit(this.map, op);
    if (r.ok) {
      this.past.push(this.map);
      this.future = [];
      this.map = r.map;
    }
    return r;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  undo(): boolean {
    const m = this.past.pop();
    if (!m) return false;
    this.future.push(this.map);
    this.map = m;
    return true;
  }
  redo(): boolean {
    const m = this.future.pop();
    if (!m) return false;
    this.past.push(this.map);
    this.map = m;
    return true;
  }
}
