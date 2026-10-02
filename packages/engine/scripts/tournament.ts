/*
 * npm run tournament -- [--games N] [--mode classic|seafarers|ck|full|all] [--mix hm|me|hhmm|all]
 *                       [--seed S] [--workers N]
 *
 * CPU tournaments (docs/bot-medium-hard.md §4.3): 4-player games with only CPUs, every move
 * checked by the simulator's rules (legal, invariants, nothing hidden used). Mixes:
 *   hm    1 Hard + 3 Medium   (target: Hard wins clearly more than its 25% share, D2)
 *   me    1 Medium + 3 Easy   (target: Medium wins at least 60%)
 *   hhmm  2 Hard + 2 Medium   (for interest)
 * Seats are shuffled every game. Prints win rates with a 95% range.
 */

import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { HARD, MEDIUM, SCENARIOS, type CpuBrain, type MapData, type ModuleId } from '../src/index';
import { cpuGame } from '../test/cpuSim';

const HFNS = SCENARIOS['heading-for-new-shores']!;
const MODES: Record<string, { map?: MapData; modules?: ModuleId[]; winVP?: number; maxTurns: number }> = {
  classic: { maxTurns: 600 },
  seafarers: { map: HFNS, maxTurns: 800 },
  ck: { modules: ['citiesKnights'], winVP: 13, maxTurns: 800 },
  full: { map: HFNS, modules: ['seafarers', 'citiesKnights'], winVP: 17, maxTurns: 1000 },
};
/**
 * `above`: the bottom of the 95% range must be above this (Hard beats chance); `atLeast`: the
 * win rate itself must reach it.
 */
const MIXES: Record<string, { label: string; seats: CpuBrain[]; above?: number; atLeast?: number }> = {
  hm: { label: '1 Hard + 3 Medium', seats: [HARD, MEDIUM, MEDIUM, MEDIUM], above: 0.25 },
  me: { label: '1 Medium + 3 Easy', seats: [MEDIUM, 'easy', 'easy', 'easy'], atLeast: 0.6 },
  hhmm: { label: '2 Hard + 2 Medium', seats: [HARD, HARD, MEDIUM, MEDIUM] },
};

interface Result {
  seed: string;
  ok: boolean;
  finished: boolean;
  /** Did the measured CPU (the mix's first seat) win? */
  won: boolean;
  turns: number;
  errors: string[];
}

/** Seed: base.mode.mix.index. The game shuffles the seats, so the measured CPU sits anywhere. */
function play(seed: string): Result {
  const [, mode, mix] = seed.split('.');
  const m = MODES[mode!]!;
  const x = MIXES[mix!]!;
  const r = cpuGame(seed, 4, 4, {
    ...(m.map ? { map: m.map } : {}),
    ...(m.modules ? { modules: m.modules } : {}),
    ...(m.winVP ? { winVP: m.winVP } : {}),
    maxTurns: m.maxTurns,
    brains: x.seats,
    hiddenRate: 0.01,
    unfinishedOK: true,
  });
  return {
    seed,
    ok: r.ok,
    finished: r.finished,
    won: r.winner != null && r.brains[r.winner] === x.seats[0],
    turns: r.turns,
    errors: r.errors.slice(0, 3),
  };
}

if (!isMainThread) {
  for (const seed of workerData.seeds as string[]) parentPort!.postMessage(play(seed));
} else {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const modes = (arg('mode') ?? 'all') === 'all' ? Object.keys(MODES) : [arg('mode')!];
  const mixes = (arg('mix') ?? 'all') === 'all' ? Object.keys(MIXES) : [arg('mix')!];
  const games = Number(arg('games') ?? 1000);
  const base = arg('seed') ?? 'tour';
  const seeds = modes.flatMap((mo) =>
    mixes.flatMap((mi) => Array.from({ length: games }, (_, i) => `${base}.${mo}.${mi}.${i}`)),
  );
  const workers = Math.max(1, Math.min(Number(arg('workers') ?? availableParallelism()), seeds.length));
  const t0 = Date.now();
  const results: Result[] = [];
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const mine = seeds.filter((_, i) => i % workers === w);
      return new Promise<void>((done, fail) => {
        const worker = new Worker(new URL('./tournament-worker.mjs', import.meta.url), {
          workerData: { seeds: mine },
        });
        worker.on('message', (m: Result) => results.push(m));
        worker.on('error', fail);
        worker.on('exit', () => done());
      });
    }),
  );
  let bad = 0;
  let short = 0;
  console.log('mode       mix                 games  finished  measured won   95% range      target');
  for (const mo of modes)
    for (const mi of mixes) {
      const rs = results.filter((r) => r.seed.split('.')[1] === mo && r.seed.split('.')[2] === mi);
      const fails = rs.filter((r) => !r.ok);
      bad += fails.length;
      const fin = rs.filter((r) => r.finished);
      const p = fin.length ? fin.filter((r) => r.won).length / fin.length : 0;
      const se = fin.length ? 1.96 * Math.sqrt((p * (1 - p)) / fin.length) : 0;
      const x = MIXES[mi]!;
      const miss = (x.above != null && p - se <= x.above) || (x.atLeast != null && p < x.atLeast);
      const target =
        x.above != null ? `above ${x.above * 100}%` : x.atLeast != null ? `at least ${x.atLeast * 100}%` : '';
      if (miss) short++;
      console.log(
        `${mo.padEnd(10)} ${x.label.padEnd(19)} ${String(rs.length).padStart(5)}  ${String(fin.length).padStart(8)}  ` +
          `${(p * 100).toFixed(1).padStart(10)}%   ${((p - se) * 100).toFixed(1)}-${((p + se) * 100).toFixed(1)}%`.padEnd(
            16,
          ) +
          (target ? `  ${miss ? 'MISSED' : 'met'}: ${target}` : ''),
      );
      for (const f of fails.slice(0, 5)) console.error(`FAIL ${f.seed}\n  ${f.errors.join('\n  ')}`);
    }
  console.log(`${results.length} games on ${workers} workers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(bad || short ? 1 : 0);
}
