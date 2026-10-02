/*
 * npm run maps -- [--boards N] [--preset <name>] [--workers N]
 *
 * Generates N boards (default 10,000) for every built-in and test preset across worker threads,
 * and checks each with the separate checker (docs/maps.md 6.1): no rule broken, except the spot
 * rules on rare eased boards (D7), and then by at most one step. It also checks every board is a
 * valid map with the right tiles, that a sample regenerates identically from its seed, and the
 * time per board. Exits non-zero on any failure. Heading for New Shores' shape gets 1,000 boards
 * per preset that works there.
 */

import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  checkBoard,
  CLASSIC_MAP,
  generate,
  mapProblems,
  normalize,
  SCENARIOS,
  SOFT_RULES,
  type GenRules,
  type MapData,
} from '../src/index';
import { TEST_PRESETS } from '../test/mapPresets';

const SHAPES: Record<string, MapData> = {
  standard: normalize(CLASSIC_MAP),
  hfns: SCENARIOS['heading-for-new-shores']!,
};

interface Job {
  preset: number;
  shape: string;
  i: number;
}
interface Result {
  job: Job;
  ms: number;
  eased: boolean;
  errors: string[];
}

/** Every tile, token and harbor type on a finished board, as sorted lists. */
function contents(m: MapData) {
  const terr = m.hexes.map((h) => h.t).filter((t) => t !== 'sea' && t !== 'fog' && t !== 'random');
  const pools = Object.values(m.pools ?? {});
  return {
    terrain: [...terr, ...pools.flatMap((p) => p.terrain)].sort(),
    numbers: [
      ...m.hexes.flatMap((h) => (typeof h.n === 'number' ? [h.n] : [])),
      ...pools.flatMap((p) => p.numbers),
    ].sort((a, b) => a - b),
    harbors: [...m.harbors.flatMap((h) => (h.t === 'random' ? [] : [h.t])), ...(m.harborPool ?? [])].sort(),
  };
}

function runJob(job: Job): Result {
  const { name, rules } = TEST_PRESETS[job.preset]!;
  const shape = SHAPES[job.shape]!;
  const players = 2 + (job.i % 3);
  const seed = `maps.${name}.${job.shape}.${job.i}`;
  const errors: string[] = [];
  const t0 = performance.now();
  const r = generate(shape, rules, { seed, players });
  const ms = performance.now() - t0;
  if (!r.ok) return { job, ms, eased: false, errors: [`${seed}: ${r.error}`] };
  const out = r.map;
  for (const p of mapProblems(out)) errors.push(`${seed}: not a valid map: ${p}`);
  if (
    out.hexes.some((h) => h.t === 'random' || h.n === 'random') ||
    out.harbors.some((h) => h.t === 'random')
  )
    errors.push(`${seed}: blanks left`);
  for (const v of checkBoard(out, rules, players)) {
    if (!SOFT_RULES.includes(v.rule)) errors.push(`${seed}: broke ${v.rule}: ${v.text}`);
    else if (!r.eased) errors.push(`${seed}: broke ${v.rule} without easing: ${v.text}`);
  }
  if (r.eased) {
    for (const v of checkBoard(out, easedLimits(rules), players))
      errors.push(`${seed}: eased too far: ${v.text}`);
  } else if (r.late)
    errors.push(`${seed}: the checker refused ${r.late} boards the search thought were fine`);
  // The same tiles as the shape's set (no desert: one desert becomes a resource plus a 3-5 or 9-11).
  const want = contents(shape);
  const got = contents(out);
  if (rules.desert === 'none') {
    const d = want.terrain.indexOf('desert');
    if (d >= 0) want.terrain.splice(d, 1);
    const extra = got.terrain.filter((t) => t !== 'desert');
    if (got.terrain.includes('desert') || extra.length !== want.terrain.length + (d >= 0 ? 1 : 0))
      errors.push(`${seed}: wrong tiles with no desert`);
  } else if (JSON.stringify(want.terrain) !== JSON.stringify(got.terrain))
    errors.push(`${seed}: wrong terrain`);
  if (rules.desert !== 'none' && JSON.stringify(want.numbers) !== JSON.stringify(got.numbers))
    errors.push(`${seed}: wrong numbers`);
  if (JSON.stringify(want.harbors) !== JSON.stringify(got.harbors)) errors.push(`${seed}: wrong harbors`);
  if (job.i % 50 === 0) {
    const again = generate(shape, rules, { seed, players });
    if (!again.ok || JSON.stringify(again.map) !== JSON.stringify(out))
      errors.push(`${seed}: not the same board twice`);
  }
  return { job, ms, eased: r.eased, errors };
}

/** The checker's view of an eased board: the spot rules one step looser (mapgen's eased()). */
function easedLimits(rules: GenRules): GenRules {
  return {
    ...rules,
    ...(rules.bestSpot !== null ? { bestSpot: rules.bestSpot + 1 } : {}),
    ...(rules.badSpot !== null ? { badSpot: Math.max(0, rules.badSpot - 1) } : {}),
    ...(rules.noLowClusters ? { lowClusterAllow: 2 } : {}),
  };
}

/** Presets that make sense on a shape (the spiral only fits the standard board). */
const fits = (rules: GenRules, shape: string) =>
  shape === 'standard' || (rules.numbers !== 'spiral' && rules.desert !== 'center');

if (!isMainThread) {
  for (const job of workerData.jobs as Job[]) parentPort!.postMessage(runJob(job));
} else {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const boards = Number(arg('boards') ?? 10_000);
  const only = arg('preset');
  const jobs: Job[] = [];
  TEST_PRESETS.forEach((p, preset) => {
    if (only && p.name !== only) return;
    for (const shape of Object.keys(SHAPES)) {
      if (!fits(p.rules, shape)) continue;
      const n = shape === 'standard' ? boards : Math.ceil(boards / 10);
      for (let i = 0; i < n; i++) jobs.push({ preset, shape, i });
    }
  });
  const workers = Math.max(1, Math.min(Number(arg('workers') ?? availableParallelism()), jobs.length));
  const t0 = Date.now();
  const results: Result[] = [];
  await Promise.all(
    Array.from(
      { length: workers },
      (_, w) =>
        new Promise<void>((done, fail) => {
          const worker = new Worker(new URL('./maps-worker.mjs', import.meta.url), {
            workerData: { jobs: jobs.filter((_, i) => i % workers === w) },
          });
          worker.on('message', (m: Result) => results.push(m));
          worker.on('error', fail);
          worker.on('exit', () => done());
        }),
    ),
  );
  let failed = 0;
  for (const [preset, p] of TEST_PRESETS.entries()) {
    for (const shape of Object.keys(SHAPES)) {
      const rs = results.filter((r) => r.job.preset === preset && r.job.shape === shape);
      if (!rs.length) continue;
      const bad = rs.filter((r) => r.errors.length);
      const eased = rs.filter((r) => r.eased).length;
      const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
      const p99 = ms[Math.floor(ms.length * 0.99)]!;
      const rate = (100 * eased) / rs.length;
      const slow = p99 > 1000;
      const tooEased = rate >= 1;
      failed += bad.length + (slow ? 1 : 0) + (tooEased ? 1 : 0);
      console.log(
        `${p.name} (${shape}): ${rs.length} boards, ${bad.length} failed, ${eased} eased (${rate.toFixed(2)}%), ` +
          `avg ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1)} ms, p99 ${p99.toFixed(0)} ms, max ${ms.at(-1)!.toFixed(0)} ms` +
          (slow ? '  SLOW' : '') +
          (tooEased ? '  EASED TOO OFTEN' : ''),
      );
      for (const r of bad.slice(0, 5)) console.error(`  FAIL ${r.errors.slice(0, 3).join('\n       ')}`);
    }
  }
  if (results.length !== jobs.length) {
    console.error(`only ${results.length} of ${jobs.length} boards reported back`);
    failed++;
  }
  console.log(`${results.length} boards on ${workers} workers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed ? 1 : 0);
}
