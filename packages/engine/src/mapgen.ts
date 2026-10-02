/*
 * The board generator (docs/maps.md 5). It fills every blank tile, number and harbor of a map
 * under a preset's rules, by a seeded constraint search: desert, then terrain (clump limit), then
 * numbers (touching rules and corner limits), then harbors, then the whole-board checks. Each
 * choice is checked as it's made and undone at once if it breaks a rule.
 *
 * The search is bounded by a count of steps, never the clock, so the same map, rules and seed
 * give the same board on any computer. An optional clock (`now`) is only a safety net, and if it
 * fires that's reported as an error. Every board it returns has passed the separate checker
 * (mapcheck.ts) as a final gate.
 */

import {
  ANYTHING_GOES,
  OUR_RULES,
  checkBoard,
  centerHex,
  coastalHex,
  greedyDraft,
  harborSpot,
  inland,
  landAt,
  modelOf,
  pipOf,
  RED,
  RULE_INFO,
  spiralNumbers,
  spiralOrders,
  SPIRAL_TOKENS,
  startSet,
  type BoardModel,
  type GenRules,
  type HarborSpot,
  type RuleId,
  type Violation,
} from './mapcheck';
import { coastalSides, cornerKeys, normalize, applyEdit, type At } from './mapkit';
import { hexAt, validateMap, type MapData } from './map';
import { nextInt, seedRng, shuffle, type RngState } from './rng';
import { isResource, RES, type PortType, type Terrain } from './types';

export interface GenOptions {
  seed: string;
  /** Players at the table, for the starting-fairness model (unless the preset fixes it). */
  players: number;
  /** 'placed' fills blanks only (the editor's "Fill the rest"); 'locked' also redoes everything unlocked. */
  keep?: 'placed' | 'locked';
  /** Step budget for the whole search. */
  budget?: number;
  /** Ease the spot rules a little if the strict search runs long (D7). On by default. */
  ease?: boolean;
  /** Diagnose why nothing fits (on by default). */
  diagnose?: boolean;
  /** A clock in ms, as a safety net only. */
  now?: () => number;
}

export type GenResult =
  | { ok: true; map: MapData; steps: number; attempts: number; late: number; eased: boolean }
  | { ok: false; error: string; rules: RuleId[]; steps: number };

export const DEFAULT_BUDGET = 300_000;
const DIAG_BUDGET = 25_000;
const TERRAIN_NODES = 4_000;
const NUMBER_NODES = 3_000;
const NUMBER_TRIES = 6;
const CLOCK_LIMIT_MS = 1000;

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.max(0, Math.floor((to - from) / step) + 1) }, (_, i) => from + i * step);

/**
 * D7: rules about how good or bad single spots are. A board may now and then break one of these
 * a little (when the strict search runs long), but never the others.
 */
export const SOFT_RULES: readonly RuleId[] = ['best', 'bad', 'lowCluster'];

/** The spot rules eased by one step: best spot +1, bad spot -1, one pair of weak numbers may touch. */
export function eased(r: GenRules): GenRules {
  return {
    ...r,
    bestSpot: r.bestSpot === null ? null : r.bestSpot + 1,
    badSpot: r.badSpot === null ? null : Math.max(0, r.badSpot - 1),
    ...(r.noLowClusters ? { lowClusterAllow: 2 } : {}),
  };
}

class OutOfSteps extends Error {}
class OutOfTime extends Error {}

/** Settings that can never work, refused before any search (5.13). */
export function refuseRules(m: MapData, rules: GenRules): string | null {
  const vals = Object.values(rules.pips);
  if (vals.some((v) => !(v >= 0 && Number.isFinite(v)))) return 'Pips per token can’t be negative';
  if (rules.clump !== null && rules.clump < 1)
    return `A clump limit of ${rules.clump} can’t work: every resource tile is a clump of at least 1`;
  const nums = [
    ...m.hexes.flatMap((h) => (typeof h.n === 'number' ? [h.n] : [])),
    ...Object.values(m.pools ?? {}).flatMap((p) => p.numbers),
  ];
  const top = Math.max(0, ...nums.map((n) => pipOf(rules.pips, n)));
  if (rules.bestSpot !== null && rules.bestSpot < top)
    return `A best-spot limit of ${rules.bestSpot} can’t work: a single token is worth ${top} pips`;
  if (rules.badSpot !== null && rules.badSpot > 3 * Math.max(0, ...vals))
    return `A bad-spot limit of ${rules.badSpot} can’t work: no corner can reach it`;
  if (rules.balance !== null && rules.balance < 0) return 'Resource balance can’t be below 0%';
  if (rules.fairness !== null && rules.fairness < 0) return 'The starting-fairness gap can’t be below 0';
  if (rules.fairPlayers !== null && !(rules.fairPlayers >= 2 && rules.fairPlayers <= 4))
    return 'Starting fairness is for 2 to 4 players';
  if (rules.numbers === 'spiral') {
    if (!spiralOrders(modelOf(m))) return 'The official spiral only works on the standard board';
    if (rules.desert === 'none') return 'The official spiral needs a desert';
    const have = nums
      .slice()
      .sort((a, b) => a - b)
      .join();
    if (
      have !==
      SPIRAL_TOKENS.slice()
        .sort((a, b) => a - b)
        .join()
    )
      return 'The official spiral needs the standard number tokens';
  }
  if (rules.desert === 'none' && m.hexes.some((h) => h.t === 'desert'))
    return 'There’s a desert placed on the board, but the desert setting is None';
  return null;
}

/** Fill a map's blanks (and, with keep 'locked', everything unlocked) under `rules`. */
export function generate(shape: MapData, rules: GenRules, o: GenOptions): GenResult {
  let m = structuredClone(shape);
  if (o.keep === 'locked') {
    const r = applyEdit(normalize(m), { k: 'clear' });
    if (!r.ok) return { ok: false, error: r.error, rules: [], steps: 0 };
    m = r.map;
  }
  const problems = validateMap(m);
  if (problems.length)
    return { ok: false, error: `This map has a problem: ${problems[0]}`, rules: [], steps: 0 };
  const refused = refuseRules(m, rules);
  if (refused) return { ok: false, error: refused, rules: [], steps: 0 };
  const budget = o.budget ?? DEFAULT_BUDGET;
  const soft = eased(rules);
  const phases: [GenRules, number][] =
    o.ease !== false && JSON.stringify(soft) !== JSON.stringify(rules)
      ? [
          [rules, budget * 0.75],
          [soft, budget * 0.25],
        ]
      : [[rules, budget]];
  const t0 = o.now?.() ?? 0;
  let steps = 0;
  for (const [k, [r, b]] of phases.entries()) {
    const s = new Search(m, r, { ...o, seed: k ? `${o.seed}:eased` : o.seed }, b, t0);
    try {
      const out = s.run();
      if (out)
        return {
          ok: true,
          map: out,
          steps: steps + s.steps,
          attempts: s.attempts,
          late: s.late,
          eased: k > 0,
        };
    } catch (e) {
      if (e instanceof OutOfTime)
        return {
          ok: false,
          error: 'The generator took too long. Please report this seed.',
          rules: [],
          steps: steps + s.steps,
        };
      if (!(e instanceof OutOfSteps)) throw e;
    }
    steps += s.steps;
  }
  if (o.diagnose === false) return { ok: false, error: 'No board fits these settings', rules: [], steps };
  const d = diagnose(m, rules, o);
  return { ok: false, error: d.error, rules: d.rules, steps };
}

/** One search, with its own random stream and step count. */
class Search {
  steps = 0;
  attempts = 0;
  /** Boards the final checker refused (should stay 0 for local rules). */
  late = 0;
  private rng: RngState;
  private b: BoardModel;
  private pools: Record<string, { terrain: Terrain[]; numbers: number[] }>;
  /** Pool of each hex's blank terrain, and of its blank number. */
  private tPool: (string | null)[];
  private nPool: (string | null)[];
  private fixedT: boolean[];
  private fixedN: boolean[];
  /** Harbors: `fixed` = its type is placed; `pinned` = its position stays (placed or locked). */
  private harbors: Harbor[];
  private harborPool: PortType[];
  private start: Set<number> | undefined;
  private players: number;
  private maxPip: number;
  /** Pips by number, 0-12, and which corners are inland (blanks count as land, so this never changes). */
  private pipTable: number[];
  private inlandAt: boolean[];

  constructor(
    private m: MapData,
    private rules: GenRules,
    private o: GenOptions,
    private budget: number,
    private t0: number,
  ) {
    this.rng = seedRng(`gen:${o.seed}`);
    this.b = modelOf(m);
    this.pools = structuredClone(m.pools ?? {});
    this.tPool = m.hexes.map((h) => (h.t === 'random' ? (h.pool ?? null) : null));
    this.nPool = m.hexes.map((h) => (h.n === 'random' ? (h.pool ?? null) : null));
    this.fixedT = m.hexes.map((h) => h.t !== 'random');
    this.fixedN = m.hexes.map((h) => h.n !== 'random');
    this.harbors = m.harbors.map((h) => ({
      t: h.t === 'random' ? null : h.t,
      fixed: h.t !== 'random',
      pinned: h.t !== 'random' || !!h.lock,
      q: h.q,
      r: h.r,
      side: h.side,
    }));
    this.harborPool = (m.harborPool ?? []).slice();
    this.start = startSet(m, this.b);
    this.players = rules.fairPlayers ?? o.players;
    this.maxPip = Math.max(0, ...Object.values(rules.pips));
    this.pipTable = Array.from({ length: 13 }, (_, k) => pipOf(rules.pips, k));
    this.inlandAt = this.b.g.verts.map((_, v) => inland(this.b, v));
    this.settled = m.hexes.map(() => []);
    for (const h of this.harbors)
      if (rules.harbors !== 'random' || h.pinned)
        for (const x of this.spotOf(h).hexes) this.settled[x]!.push(h);
    if (rules.desert === 'none') this.removeDeserts();
  }

  private step(n = 1) {
    this.steps += n;
    if (this.steps > this.budget) throw new OutOfSteps();
    if (this.o.now && (this.steps & 1023) === 0 && this.o.now() - this.t0 > CLOCK_LIMIT_MS)
      throw new OutOfTime();
  }

  /** D2: with no desert, each pool desert becomes a random resource with an extra 3-5 or 9-11 token. */
  private removeDeserts() {
    for (const p of Object.values(this.pools)) {
      p.terrain = p.terrain.map((t) => {
        if (t !== 'desert') return t;
        p.numbers.push([3, 4, 5, 9, 10, 11][nextInt(this.rng, 6)]!);
        return RES[nextInt(this.rng, RES.length)]!;
      });
    }
  }

  run(): MapData | null {
    for (;;) {
      this.attempts++;
      this.step(10);
      if (!this.placeTerrain()) continue;
      for (let k = 0; k < NUMBER_TRIES; k++) {
        if (!this.placeNumbers()) continue;
        if (!this.placeHarbors()) continue;
        if (!this.wholeBoardOK()) continue;
        const out = this.toMap();
        if (this.gate(out)) return out;
        this.late++;
      }
    }
  }

  /* ----- Terrain ----- */

  private placeTerrain(): boolean {
    const { b } = this;
    const blanks = b.t.flatMap((_, i) => (this.tPool[i] !== null ? [i] : []));
    for (const i of blanks) b.t[i] = null;
    const left: Record<string, Terrain[]> = Object.fromEntries(
      Object.entries(this.pools).map(([k, p]) => [k, p.terrain.slice()]),
    );
    // The desert first, where the setting says.
    const center = this.rules.desert === 'center' ? centerHex(b) : -1;
    for (const [k, pool] of Object.entries(left)) {
      let deserts = pool.filter((t) => t === 'desert').length;
      if (!deserts) continue;
      const mine = shuffle(
        blanks.filter((i) => this.tPool[i] === k && !this.fixedNumber(i)),
        this.rng,
      );
      let spots: number[];
      if (this.rules.desert === 'center')
        spots = mine.includes(center) ? [center, ...mine.filter((i) => i !== center)] : mine;
      else if (this.rules.desert === 'edge') spots = mine.filter((i) => coastalHex(b, i));
      else spots = mine;
      for (const i of spots) {
        if (!deserts) break;
        b.t[i] = 'desert';
        deserts--;
      }
      if (deserts) return false;
      left[k] = pool.filter((t) => t !== 'desert');
    }
    const order = blanks.filter((i) => b.t[i] === null);
    let nodes = 0;
    const dfs = (j: number): boolean => {
      if (j === order.length) return true;
      if (++nodes > TERRAIN_NODES) return false;
      this.step();
      const i = order[j]!;
      const pool = left[this.tPool[i]!]!;
      const options = shuffle([...new Set(pool)], this.rng);
      for (const t of options) {
        if (this.fixedNumber(i) && t === 'desert') continue;
        b.t[i] = t;
        if (this.clumpOK(i)) {
          pool.splice(pool.indexOf(t), 1);
          if (dfs(j + 1)) return true;
          pool.push(t);
        }
        b.t[i] = null;
      }
      return false;
    };
    return dfs(0);
  }

  /** A blank tile that already has a number (a locked number) must get producing land. */
  private fixedNumber(i: number) {
    return this.fixedN[i]! && typeof this.m.hexes[i]!.n === 'number';
  }

  private clumpOK(i: number): boolean {
    const { b } = this;
    const lim = this.rules.clump;
    const t = b.t[i];
    if (lim === null || !t || !isResource(t)) return true;
    const seen = new Set([i]);
    const q = [i];
    for (let k = 0; k < q.length; k++)
      for (const j of b.g.hexNeighbors[q[k]!]!)
        if (!seen.has(j) && b.t[j] === t) {
          seen.add(j);
          q.push(j);
          if (seen.size > lim) return false;
        }
    return true;
  }

  /* ----- Numbers ----- */

  /** Total pips of every token on the board, which no arrangement changes. */
  private balanceBounds(): Record<string, [number, number]> | null {
    const { b, rules } = this;
    if (rules.balance === null) return null;
    let total = 0;
    let producing = 0;
    b.t.forEach((t, i) => {
      if (!t || t === 'desert' || t === 'sea' || t === 'fog') return;
      if (!this.nPool[i] && !b.n[i]) return;
      producing++;
    });
    const all = [
      ...b.n.flatMap((n, i) => (this.nPool[i] === null && n ? [n] : [])),
      ...Object.values(this.pools).flatMap((p) => p.numbers),
    ];
    for (const n of all) total += pipOf(rules.pips, n);
    const out: Record<string, [number, number]> = {};
    for (const r of RES) {
      const count = b.t.filter((t, i) => t === r && (this.nPool[i] !== null || b.n[i])).length;
      const fair = producing ? (total * count) / producing : 0;
      out[r] = [fair * (1 - rules.balance / 100) - 1e-9, fair * (1 + rules.balance / 100) + 1e-9];
    }
    return out;
  }

  private placeNumbers(): boolean {
    const { b, rules } = this;
    const want = b.t.flatMap((t, i) => (this.nPool[i] !== null ? [i] : []));
    for (const i of want) b.n[i] = b.t[i] === 'desert' || b.t[i] === 'sea' ? 0 : null;
    const order = want.filter((i) => b.n[i] === null);
    const left: Record<string, number[]> = Object.fromEntries(
      Object.entries(this.pools).map(([k, p]) => [k, p.numbers.slice()]),
    );
    if (rules.numbers === 'spiral') return this.spiral(order);
    const bounds = this.balanceBounds();
    const resPips: Record<string, number> = Object.fromEntries(RES.map((r) => [r, 0]));
    const resLeft: Record<string, number> = Object.fromEntries(RES.map((r) => [r, 0]));
    b.n.forEach((n, i) => {
      const t = b.t[i];
      if (t && isResource(t)) {
        if (n) resPips[t]! += pipOf(rules.pips, n);
        else if (n === null) resLeft[t]!++;
      }
    });
    const maxPip = this.maxPip;
    let nodes = 0;
    const dfs = (j: number): boolean => {
      if (j === order.length) return true;
      if (++nodes > NUMBER_NODES) return false;
      this.step();
      const i = order[j]!;
      const pool = left[this.nPool[i]!]!;
      const t = b.t[i]!;
      for (const v of shuffle([...new Set(pool)], this.rng)) {
        if (!this.numberOK(i, v)) continue;
        if (bounds && isResource(t)) {
          const p = resPips[t]! + pipOf(rules.pips, v);
          const [lo, hi] = bounds[t]!;
          if (p > hi || p + (resLeft[t]! - 1) * maxPip < lo) continue;
        }
        b.n[i] = v;
        pool.splice(pool.indexOf(v), 1);
        if (isResource(t)) {
          resPips[t]! += pipOf(rules.pips, v);
          resLeft[t]!--;
        }
        if (dfs(j + 1)) return true;
        if (isResource(t)) {
          resPips[t]! -= pipOf(rules.pips, v);
          resLeft[t]!++;
        }
        pool.push(v);
        b.n[i] = null;
      }
      return false;
    };
    return dfs(0);
  }

  /** Can hex i take number v, given the numbers placed so far? */
  private numberOK(i: number, v: number): boolean {
    const { b, rules, pipTable } = this;
    const n = b.n;
    const red = v === 6 || v === 8;
    for (const j of b.g.hexNeighbors[i]!) {
      const w = n[j];
      if (!w) continue;
      if (rules.redApart && red && (w === 6 || w === 8)) return false;
      if (rules.sameApart && v === w) return false;
      if (rules.twoTwelveApart && v + w === 14 && (v === 2 || v === 12)) return false;
    }
    const pv = pipTable[v]!;
    const lowV = isLow(v) ? 1 : 0;
    for (const c of b.g.hexVerts[i]!) {
      const hs = b.g.verts[c]!.hexes;
      let sum = pv;
      let unknown = 0;
      let lows = lowV;
      for (const h of hs) {
        if (h === i) continue;
        const w = n[h];
        if (w === null) unknown++;
        else if (w) {
          sum += pipTable[w]!;
          if (isLow(w)) lows++;
        }
      }
      if (rules.bestSpot !== null && sum > rules.bestSpot) return false;
      if (rules.noLowClusters && !rules.lowClusterAllow && lows >= 2) return false;
      if (
        rules.badSpot !== null &&
        this.inlandAt[c] &&
        (rules.badSpotDesert || !this.desertAt(c)) &&
        sum + unknown * this.maxPip < rules.badSpot
      )
        return false;
    }
    if (rules.harborNoRed && red && this.harborNear(i, null)) return false;
    const t = b.t[i];
    if (rules.harborGood !== 'off' && this.good(v) && t && isResource(t) && this.harborNear(i, t))
      return false;
    return true;
  }

  private desertAt(c: number): boolean {
    for (const h of this.b.g.verts[c]!.hexes) if (this.b.t[h] === 'desert') return true;
    return false;
  }

  private good(v: number | null) {
    return RED(v) || (this.rules.harborGood === '5689' && (v === 5 || v === 9));
  }

  /**
   * Does hex i touch a harbor whose position is settled (standard positions, or a pinned one):
   * any harbor (type null), or a placed harbor of this type?
   */
  private harborNear(i: number, type: PortType | null): boolean {
    for (const h of this.settled[i]!) if (type === null || h.t === type) return true;
    return false;
  }
  /** For each hex, the harbors with a settled position that touch it. */
  private settled: Harbor[][] = [];

  private spots = new Map<string, HarborSpot>();
  private spotOf(h: { q: number; r: number; side: number }): HarborSpot {
    const k = `${h.q},${h.r},${h.side}`;
    let s = this.spots.get(k);
    if (!s) {
      s = harborSpot(this.b, hexAt(this.m.hexes, h.q, h.r), h.side, null);
      this.spots.set(k, s);
    }
    return s;
  }

  private spiral(order: number[]): boolean {
    const orders = spiralOrders(this.b)!;
    for (const k of shuffle(
      orders.map((_, i) => i),
      this.rng,
    )) {
      this.step(20);
      const n = spiralNumbers(this.b, orders[k]!);
      if (!n) continue;
      for (const i of order) this.b.n[i] = n[i]!;
      if (order.every((i) => this.numberOKFull(i))) return true;
    }
    for (const i of order) this.b.n[i] = null;
    return false;
  }

  /** numberOK for a hex whose number is already on the board. */
  private numberOKFull(i: number): boolean {
    const v = this.b.n[i]!;
    this.b.n[i] = null;
    const ok = !v || this.numberOK(i, v);
    this.b.n[i] = v;
    return ok;
  }

  /* ----- Harbors ----- */

  private placeHarbors(): boolean {
    const { rules } = this;
    const active = this.harbors.map((h) => ({ ...h }));
    if (rules.harbors === 'random' && active.some((h) => !h.pinned)) {
      if (!this.harborPositions(active)) return false;
    }
    const blank = active.filter((h) => !h.fixed);
    const left = this.harborPool.slice();
    let nodes = 0;
    const dfs = (j: number): boolean => {
      if (j === blank.length) return true;
      if (++nodes > 2000) return false;
      this.step();
      const h = blank[j]!;
      for (const t of shuffle([...new Set(left)], this.rng)) {
        if (!this.harborTypeOK(h, t)) continue;
        h.t = t;
        left.splice(left.indexOf(t), 1);
        if (dfs(j + 1)) return true;
        left.push(t);
        h.t = null;
      }
      return false;
    };
    if (!dfs(0)) return false;
    this.placed = active;
    return true;
  }
  private placed: { t: PortType | null; q: number; r: number; side: number }[] = [];

  private harborTypeOK(h: { q: number; r: number; side: number }, t: PortType): boolean {
    if (this.rules.harborGood === 'off' || t === 'any') return true;
    const spot = this.spotOf(h);
    return !spot.hexes.some((x) => this.b.t[x] === t && this.good(this.b.n[x]!));
  }

  /**
   * 5.16 random positions, spread around the coast: walking the coast from a random start, the
   * gaps between harbors stay close to an even share, and no two share a corner.
   */
  private harborPositions(active: Harbor[]): boolean {
    const g = this.b.g;
    const cx = g.hexes.reduce((a, h) => a + h.x, 0) / g.hexes.length;
    const cy = g.hexes.reduce((a, h) => a + h.y, 0) / g.hexes.length;
    const ring = coastalSides(this.mapNow())
      .map((s) => {
        const E = g.edges[this.spotOf({ q: s.at[0], r: s.at[1], side: s.side }).edge]!;
        const a = Math.atan2(
          (g.verts[E.a]!.y + g.verts[E.b]!.y) / 2 - cy,
          (g.verts[E.a]!.x + g.verts[E.b]!.x) / 2 - cx,
        );
        return { s, a, keys: cornerKeys(s.at, s.side) };
      })
      .sort((x, y) => x.a - y.a);
    const used = new Set<string>();
    for (const h of active.filter((x) => x.pinned))
      for (const k of cornerKeys([h.q, h.r], h.side)) used.add(k);
    const free = active.filter((h) => !h.pinned);
    if (!free.length) return true;
    const L = ring.length;
    const k = free.length;
    if (L < k) return false;
    const ok = ring.map(
      (x) =>
        !x.keys.some((c) => used.has(c)) &&
        !(
          this.rules.harborNoRed &&
          this.spotOf({ q: x.s.at[0], r: x.s.at[1], side: x.s.side }).hexes.some((h) => RED(this.b.n[h]!))
        ),
    );
    const lo = Math.max(1, Math.floor(L / k) - 1);
    const hi = Math.ceil(L / k) + 1;
    const start = nextInt(this.rng, L);
    const chosen: number[] = [];
    let nodes = 0;
    const dfs = (j: number, at: number): boolean => {
      if (++nodes > 3000) return false;
      this.step();
      if (j === k) {
        const wrap = start + L - at;
        return wrap >= lo || k === 1;
      }
      const gaps = j === 0 ? [0] : shuffle(range(lo, hi), this.rng);
      for (const gap of gaps) {
        const pos = at + gap;
        if (pos - start >= L) continue;
        const x = ring[pos % L]!;
        if (!ok[pos % L] || x.keys.some((c) => used.has(c))) continue;
        for (const c of x.keys) used.add(c);
        chosen.push(pos % L);
        if (dfs(j + 1, pos)) return true;
        chosen.pop();
        for (const c of x.keys) used.delete(c);
      }
      return false;
    };
    // The first harbor goes on the first usable side from the random start.
    let first = start;
    while (first < start + L && !ok[first % L]) first++;
    if (first >= start + L) return false;
    if (!dfs(0, first)) return false;
    chosen.forEach((i, j) => {
      const s = ring[i]!.s;
      Object.assign(free[j]!, { q: s.at[0], r: s.at[1], side: s.side });
    });
    return true;
  }

  /* ----- Whole board ----- */

  private wholeBoardOK(): boolean {
    const { b, rules } = this;
    this.step(20);
    if (rules.balance !== null) {
      const bounds = this.balanceBounds()!;
      for (const r of RES) {
        let p = 0;
        b.t.forEach((t, i) => t === r && (p += pipOf(rules.pips, b.n[i]!)));
        const [lo, hi] = bounds[r]!;
        if (b.t.some((t) => t === r) && (p < lo || p > hi)) return false;
      }
    }
    if (rules.fairness !== null && greedyDraft(b, rules.pips, this.players, this.start).gap > rules.fairness)
      return false;
    return true;
  }

  /** The current board as a map (with the harbors as last placed). */
  private mapNow(): MapData {
    const m = structuredClone(this.m);
    m.hexes.forEach((h, i) => {
      h.t = this.b.t[i] ?? 'random';
      const n = this.b.n[i];
      if (n) h.n = n;
      else if (n === 0) delete h.n;
      if (h.t !== 'random' && h.n !== 'random') delete h.pool;
    });
    return m;
  }

  private toMap(): MapData {
    const m = this.mapNow();
    m.harbors = this.placed.map((h, i) => {
      const lock = this.m.harbors[i]?.lock;
      return { q: h.q, r: h.r, side: h.side, t: h.t!, ...(lock && this.harbors[i]!.pinned ? { lock } : {}) };
    });
    delete m.pools;
    delete m.harborPool;
    delete m.set;
    if (this.rules.desert === 'none' && m.robber === 'desert') m.robber = null;
    return m;
  }

  /**
   * The final gate: the separate checker must find nothing, apart from rules broken only by
   * pieces that were already on the board (the person placed them on purpose).
   */
  private gate(out: MapData): boolean {
    if (validateMap(out).length) return false;
    const v = checkBoard(out, this.rules, this.o.players);
    return v.every((x) => this.preexisting(x, out));
  }

  private preexisting(v: Violation, out: MapData): boolean {
    if (v.rule === 'balance' || v.rule === 'fair' || v.rule === 'spiral') return false;
    if (!v.hexes.length && !v.harbors.length) return false;
    const fixedHarbor = (i: number) => {
      const h = out.harbors[i]!;
      const k = this.harbors.findIndex(
        (x) => x.fixed && x.pinned && x.q === h.q && x.r === h.r && x.side === h.side,
      );
      return k >= 0;
    };
    return v.hexes.every((i) => this.fixedT[i] && this.fixedN[i]) && v.harbors.every(fixedHarbor);
  }
}

const isLow = (x: number) => x === 2 || x === 3 || x === 11 || x === 12;

type Harbor = { t: PortType | null; fixed: boolean; pinned: boolean; q: number; r: number; side: number };

/* ----- Saying why nothing fits (5.13) ----- */

type Knob = {
  id: RuleId;
  off: (r: GenRules) => GenRules;
  label: (r: GenRules) => string;
  /** For limits: settings to try, nearest first, with words for the message. */
  nearer?: { tries: (r: GenRules) => GenRules[]; value: (r: GenRules) => string; too: string; most: string };
};

const KNOBS: Knob[] = [
  { id: 'red', off: (r) => ({ ...r, redApart: false }), label: () => 'red numbers never touching' },
  {
    id: 'harborGood',
    off: (r) => ({ ...r, harborGood: 'off' }),
    label: () => '2:1 harbors away from good numbers',
  },
  { id: 'harborRed', off: (r) => ({ ...r, harborNoRed: false }), label: () => 'no 6 or 8 at any harbor' },
  {
    id: 'best',
    off: (r) => ({ ...r, bestSpot: null }),
    label: (r) => `the best-spot limit of ${r.bestSpot}`,
    nearer: {
      tries: (r) => range(r.bestSpot! + 1, r.bestSpot! + 6).map((v) => ({ ...r, bestSpot: v })),
      value: (r) => `${r.bestSpot}`,
      too: 'too low',
      most: 'lowest',
    },
  },
  {
    id: 'bad',
    off: (r) => ({ ...r, badSpot: null }),
    label: (r) => `the bad-spot limit of ${r.badSpot}`,
    nearer: {
      tries: (r) =>
        range(Math.max(0, r.badSpot! - 6), r.badSpot! - 1)
          .reverse()
          .map((v) => ({ ...r, badSpot: v })),
      value: (r) => `${r.badSpot}`,
      too: 'too high',
      most: 'highest',
    },
  },
  { id: 'twoTwelve', off: (r) => ({ ...r, twoTwelveApart: false }), label: () => '2 and 12 never touching' },
  {
    id: 'lowCluster',
    off: (r) => ({ ...r, noLowClusters: false }),
    label: () => 'no clusters of 2, 3, 11, 12',
  },
  { id: 'same', off: (r) => ({ ...r, sameApart: false }), label: () => 'the same number never touching' },
  {
    id: 'clump',
    off: (r) => ({ ...r, clump: null }),
    label: (r) => `the clump limit of ${r.clump}`,
    nearer: {
      tries: (r) => range(r.clump! + 1, r.clump! + 4).map((v) => ({ ...r, clump: v })),
      value: (r) => `${r.clump}`,
      too: 'too low',
      most: 'lowest',
    },
  },
  {
    id: 'balance',
    off: (r) => ({ ...r, balance: null }),
    label: (r) => `resource balance ±${r.balance}%`,
    nearer: {
      tries: (r) => range(r.balance! + 5, r.balance! + 40, 5).map((v) => ({ ...r, balance: v })),
      value: (r) => `±${r.balance}%`,
      too: 'too tight',
      most: 'tightest',
    },
  },
  {
    id: 'fair',
    off: (r) => ({ ...r, fairness: null }),
    label: (r) => `the starting-fairness gap of ${r.fairness}`,
    nearer: {
      tries: (r) => range(r.fairness! + 1, r.fairness! + 8).map((v) => ({ ...r, fairness: v })),
      value: (r) => `${r.fairness}`,
      too: 'too small',
      most: 'smallest',
    },
  },
  {
    id: 'desert',
    off: (r) => ({ ...r, desert: 'random' }),
    label: (r) => `the desert setting (${r.desert})`,
  },
  { id: 'spiral', off: (r) => ({ ...r, numbers: 'random' }), label: () => 'the official spiral' },
];

const isOn = (k: Knob, r: GenRules) => JSON.stringify(k.off(r)) !== JSON.stringify(r);

/** Which rules block, and the nearest setting that works, by retrying with small budgets. */
export function diagnose(m: MapData, rules: GenRules, o: GenOptions): { error: string; rules: RuleId[] } {
  const works = (r: GenRules) =>
    generate(m, r, { ...o, keep: 'placed', budget: DIAG_BUDGET, diagnose: false, ease: false }).ok;
  const on = KNOBS.filter((k) => isOn(k, rules));
  const singles = on.filter((k) => works(k.off(rules)));
  if (singles.length > 1) {
    const names = singles.map((k) => k.label(rules));
    return {
      error: `No board fits: ${names.slice(0, -1).join(', ')} together with ${names.at(-1)}. Turning off any one of them works.`,
      rules: singles.map((k) => k.id),
    };
  }
  const k = singles[0];
  if (k) {
    const near = k.nearer?.tries(rules).find(works);
    if (k.nearer && near)
      return {
        error: `No board fits: ${k.label(rules)} is ${k.nearer.too}. The ${k.nearer.most} that works with your other rules is about ${k.nearer.value(near)}.`,
        rules: [k.id],
      };
    return { error: `No board fits: ${k.label(rules)} can’t be met with your other rules.`, rules: [k.id] };
  }
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++)
      if (works(on[j]!.off(on[i]!.off(rules))))
        return {
          error: `No board fits: ${on[i]!.label(rules)} together with ${on[j]!.label(rules)}.`,
          rules: [on[i]!.id, on[j]!.id],
        };
  return { error: 'No board fits these settings. Try “Our rules”.', rules: [] };
}

/** Fill only the blanks ("Fill the rest randomly"), keeping the editor's set. */
export function fillRest(m: MapData, rules: GenRules, seed: string, players: number): GenResult {
  const r = generate(normalize(m), rules, { seed, players, keep: 'placed' });
  if (!r.ok) return r;
  const out = structuredClone(r.map);
  out.set = normalize(m).set;
  return { ...r, map: normalize(out) };
}

export { RULE_INFO };

/** Built-in presets (5.18); these two can't be deleted. */
export const BUILTIN_PRESETS: readonly { name: string; rules: GenRules }[] = [
  { name: 'Our rules', rules: OUR_RULES },
  { name: 'Anything goes', rules: ANYTHING_GOES },
];
