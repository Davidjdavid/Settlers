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
import { SCENARIOS, type HouseRules, type MapData, type ModuleId } from '../src/index';
import { simulate, type SimResult } from '../test/simulate';

interface Scenario {
  map?: MapData;
  modules?: ModuleId[];
  players: number[];
  winVP?: number;
  /** Random players are slow at Cities & Knights; allow longer games before calling one stuck. */
  maxTurns?: number;
  /** Points to win in odd-numbered games, to keep the run quick (even ones use winVP). */
  quickVP?: number;
  /** House-rule mixes to cycle through (letters as in parseSeed). */
  rules: string[];
}
const HFNS = SCENARIOS['heading-for-new-shores']!;
const SIMS: Record<string, Scenario> = {
  classic: { players: [2, 3, 4], rules: ['n', 'b', 'nb'] },
  'heading-for-new-shores': {
    map: HFNS,
    players: HFNS.players,
    maxTurns: 3000,
    rules: ['n', 'b', 'nb', 'f', 'nbf'],
  },
  'fog-test': { map: fogTest as unknown as MapData, players: [3, 4], rules: ['n', 'b', 'nb', 'f', 'nbf'] },
  ck: {
    modules: ['citiesKnights'],
    players: [3, 4],
    winVP: 13,
    quickVP: 10,
    maxTurns: 3000,
    rules: ['r', 'd', 'w', 'b', 'nrw', 'bdw'],
  },
  'ck-sea': {
    map: HFNS,
    modules: ['seafarers', 'citiesKnights'],
    players: [3, 4],
    winVP: 17,
    quickVP: 13,
    maxTurns: 5000,
    rules: ['r', 'd', 'w', 'f', 'nbf', 'rdw'],
  },
};
const DEFAULT_GAMES: Record<string, number> = {
  classic: 1000,
  'heading-for-new-shores': 1000,
  'fog-test': 200,
  ck: 1000,
  'ck-sea': 1000,
};

/**
 * Seed format: base.scenario.index.<n>p.<house rules or ->. House rules: n no 7s in round 1,
 * b 3:1 bank, f free ship moves, r re-roll 7s / d no discards until the barbarians attack,
 * w barbarians wait 2 rounds.
 */
function makeSeed(base: string, scenario: string, i: number): string {
  const sc = SIMS[scenario]!;
  const n = sc.players[i % sc.players.length]!;
  const hr = i % 3 === 2 ? sc.rules[((i / 3) | 0) % sc.rules.length]! : '-';
  return `${base}.${scenario}.${i}.${n}p.${hr}`;
}

function parseSeed(seed: string): { scenario: string; n: number; houseRules: HouseRules } {
  const [, scenario, , np, hr] = seed.split('.');
  if (!scenario || !SIMS[scenario] || !np) throw new Error(`can't parse seed ${seed}`);
  const houseRules: HouseRules = {};
  if (hr?.includes('n')) houseRules.no7FirstRound = true;
  if (hr?.includes('b')) houseRules.bank3to1 = true;
  if (hr?.includes('f')) houseRules.freeShipMoves = true;
  if (hr?.includes('r')) houseRules.rerollBeforeAttack = true;
  if (hr?.includes('d')) houseRules.noDiscardBeforeAttack = true;
  if (hr?.includes('w')) houseRules.barbarianDelay = 2;
  return { scenario, n: Number(np.replace('p', '')), houseRules };
}

function run(seed: string, deepCheckRate?: number): SimResult {
  const { scenario, n, houseRules } = parseSeed(seed);
  const sc = SIMS[scenario]!;
  const index = Number(seed.split('.')[2]);
  const winVP = sc.quickVP && index % 2 ? sc.quickVP : sc.winVP;
  return simulate(seed, n, {
    ...(sc.map ? { map: sc.map } : {}),
    ...(sc.modules ? { modules: sc.modules } : {}),
    ...(winVP ? { winVP } : {}),
    ...(sc.maxTurns ? { maxTurns: sc.maxTurns } : {}),
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
