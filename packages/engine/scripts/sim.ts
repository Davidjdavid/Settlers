/*
 * npm run sim -- [--games N] [--scenario classic|heading-for-new-shores|fog-test|all] [--seed S]
 *                [--replay SEED] [--workers N]
 *
 * Plays N random games per scenario (players and house rules vary by game) across worker
 * threads, and exits non-zero on any failure. Every game's seed encodes how it was set up, so
 * `--replay <seed>` reruns exactly that game with every check on every step.
 */

import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fogTest from '../test/fixtures/fog-test.json';
import { SCENARIOS, type HouseRules, type MapData } from '../src/index';
import { simulate, type SimResult } from '../test/simulate';

const MAPS: Record<string, MapData> = { ...SCENARIOS, 'fog-test': fogTest as unknown as MapData };
const DEFAULT_GAMES: Record<string, number> = {
  classic: 1000,
  'heading-for-new-shores': 1000,
  'fog-test': 200,
};

/** Seed format: base.scenario.index.<n>p.<house rules: n b f or ->. */
function makeSeed(base: string, scenario: string, i: number): string {
  const map = MAPS[scenario]!;
  const n = map.players[i % map.players.length]!;
  const hr = i % 3 === 2 ? ['n', 'b', 'nb', 'f', 'nbf'][((i / 3) % 5) | 0]! : '-';
  return `${base}.${scenario}.${i}.${n}p.${scenario === 'classic' ? hr.replace('f', '') || '-' : hr}`;
}

function parseSeed(seed: string): { scenario: string; n: number; houseRules: HouseRules } {
  const [, scenario, , np, hr] = seed.split('.');
  if (!scenario || !MAPS[scenario] || !np) throw new Error(`can't parse seed ${seed}`);
  const houseRules: HouseRules = {};
  if (hr?.includes('n')) houseRules.no7FirstRound = true;
  if (hr?.includes('b')) houseRules.bank3to1 = true;
  if (hr?.includes('f')) houseRules.freeShipMoves = true;
  return { scenario, n: Number(np.replace('p', '')), houseRules };
}

function run(seed: string, deepCheckRate?: number): SimResult {
  const { scenario, n, houseRules } = parseSeed(seed);
  return simulate(seed, n, {
    ...(scenario === 'classic' ? {} : { map: MAPS[scenario]! }),
    houseRules,
    ...(deepCheckRate != null ? { deepCheckRate } : {}),
  });
}

type Summary = { seed: string; ok: boolean; turns: number; actions: number; errors: string[] };

if (!isMainThread) {
  for (const seed of workerData.seeds as string[]) {
    const r = run(seed);
    parentPort!.postMessage({
      seed,
      ok: r.ok,
      turns: r.turns,
      actions: r.actions,
      errors: r.errors.slice(0, 5),
    } satisfies Summary);
  }
} else {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const replay = arg('replay');
  if (replay) {
    const r = run(replay, 1);
    console.log(JSON.stringify({ ...r, log: `${r.log.length} actions` }, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  const which = arg('scenario') ?? 'all';
  const scenarios = which === 'all' ? Object.keys(DEFAULT_GAMES) : [which];
  const base = arg('seed') ?? 'sim';
  const seeds = scenarios.flatMap((sc) => {
    const n = Number(arg('games') ?? DEFAULT_GAMES[sc] ?? 1000);
    return Array.from({ length: n }, (_, i) => makeSeed(base, sc, i));
  });
  const workers = Math.max(1, Math.min(Number(arg('workers') ?? availableParallelism()), seeds.length));
  const t0 = Date.now();
  const results: Summary[] = [];
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const mine = seeds.filter((_, i) => i % workers === w);
      return new Promise<void>((done, fail) => {
        const worker = new Worker(new URL('./sim-worker.mjs', import.meta.url), {
          workerData: { seeds: mine },
        });
        worker.on('message', (m: Summary) => results.push(m));
        worker.on('error', fail);
        worker.on('exit', () => done());
      });
    }),
  );
  let failed = 0;
  for (const sc of scenarios) {
    const rs = results.filter((r) => r.seed.split('.')[1] === sc);
    const bad = rs.filter((r) => !r.ok);
    failed += bad.length;
    const avg = (f: (r: Summary) => number) =>
      (rs.reduce((a, r) => a + f(r), 0) / Math.max(1, rs.length)).toFixed(0);
    console.log(
      `${sc}: ${rs.length} games, ${bad.length} failed, avg ${avg((r) => r.turns)} turns / ${avg((r) => r.actions)} actions`,
    );
    for (const r of bad.slice(0, 10)) {
      console.error(
        `FAIL ${r.seed}\n  ${r.errors.join('\n  ')}\n  replay: npm run sim -- --replay ${r.seed}`,
      );
    }
  }
  if (results.length !== seeds.length) {
    console.error(`only ${results.length} of ${seeds.length} games reported back`);
    failed++;
  }
  console.log(`${results.length} games on ${workers} workers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed ? 1 : 0);
}
