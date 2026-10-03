/*
 * npm run sim -- [--games N] [--scenario classic|heading-for-new-shores|fog-test|ck|ck-sea|cpu-*|all] [--seed S]
 *                [--replay SEED] [--workers N]
 *
 * Plays N random games per scenario (players and house rules vary by game) across worker
 * threads, and exits non-zero on any failure. Every game's seed encodes how it was set up, so
 * `--replay <seed>` reruns exactly that game with every check on every step.
 *
 * The cpu-* scenarios seat 1 or more CPU players against the test bot, cycling through Easy
 * (docs/bot.md), Medium, Hard and a custom CPU (docs/bot-medium-hard.md), and check every CPU
 * move against its rules.
 */

import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fogTest from '../test/fixtures/fog-test.json';
import treasureTest from '../test/fixtures/treasure-test.json';
import {
  HARD, MEDIUM, SCENARIOS, scenarioMap, type CpuBrain, type HouseRules, type MapData, type ModuleId,
} from '../src/index'; // prettier-ignore
import { cpuGame } from '../test/cpuSim';
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
  /** CPU players against the test bot. */
  cpu?: boolean;
  /** House-rule mixes to cycle through (letters as in parseSeed). */
  rules: string[];
}
const HFNS = SCENARIOS['heading-for-new-shores']!;
const SIMS: Record<string, Scenario> = {
  classic: { players: [2, 3, 4], rules: ['n', 'b', 'nb', 'hu', 'nH', 'u', 'I', 'O', 'k', 'nK'] },
  'heading-for-new-shores': {
    map: HFNS,
    players: HFNS.players,
    maxTurns: 3000,
    rules: ['n', 'b', 'nb', 'f', 'nbfu', 'hu', 'fH', 'I'],
  },
  'heading-for-new-shores-3': {
    map: scenarioMap('heading-for-new-shores', 3),
    players: [3],
    maxTurns: 3000,
    rules: ['n', 'b', 'nb', 'f', 'nbfu', 'hu', 'fH'],
  },
  'fog-test': { map: fogTest as unknown as MapData, players: [3, 4], rules: ['n', 'b', 'nb', 'fu', 'nbf'] },
  // SPEC 10.5: the Fog Islands in Seafarers and in Full game mode.
  'fog-islands': {
    map: SCENARIOS['fog-islands']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'nb', 'f', 'nbfu', 'hu', 'I'],
  },
  'fog-islands-ck': {
    map: SCENARIOS['fog-islands']!,
    modules: ['seafarers', 'citiesKnights'],
    players: [3, 4],
    winVP: 15,
    quickVP: 12,
    maxTurns: 5000,
    rules: ['r', 'd', 'w', 'f', 'nbfu', 'rdw', 'hu', 'I', 'O', 'rk', 'K'],
  },
  ck: {
    modules: ['citiesKnights'],
    players: [3, 4],
    winVP: 13,
    quickVP: 10,
    maxTurns: 3000,
    rules: ['r', 'd', 'w', 'b', 'nrwu', 'bdw', 'hu', 'rH', 'I', 'O', 'bO', 'hK', 'k'],
  },
  'ck-sea': {
    map: HFNS,
    modules: ['seafarers', 'citiesKnights'],
    players: [3, 4],
    winVP: 17,
    quickVP: 13,
    maxTurns: 5000,
    rules: ['r', 'd', 'w', 'f', 'nbfu', 'rdw', 'hu', 'wHu', 'I', 'O'],
  },
  // The maps added on 2 October: Four Islands, Treasure Fog, Classic and the Isles.
  'four-islands': {
    map: SCENARIOS['four-islands']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu'],
  },
  'four-islands-far': {
    map: SCENARIOS['four-islands-far']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu'],
  },
  'treasure-fog': {
    map: SCENARIOS['treasure-fog']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu'],
  },
  'classic-isles': {
    map: SCENARIOS['classic-isles']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu'],
  },
  'classic-isles-far': {
    map: SCENARIOS['classic-isles-far']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu', 'k'],
  },
  archipelago: {
    map: SCENARIOS['archipelago']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu', 'k'],
  },
  'the-crossing': {
    map: SCENARIOS['the-crossing']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu', 'k'],
  },
  atoll: {
    map: SCENARIOS['atoll']!,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'f', 'hu', 'k'],
  },
  'treasure-fog-ck': {
    map: SCENARIOS['treasure-fog']!,
    modules: ['seafarers', 'citiesKnights'],
    players: [3, 4],
    winVP: 17,
    quickVP: 13,
    maxTurns: 5000,
    rules: ['r', 'd', 'w', 'f', 'hu', 'I'],
  },
  // SPEC 10.5: a test map with treasures, in Seafarers and in Full game mode.
  treasures: {
    map: treasureTest as unknown as MapData,
    players: [3, 4],
    maxTurns: 3000,
    rules: ['n', 'b', 'nb', 'f', 'nbfu', 'hu', 'I'],
  },
  'treasures-ck': {
    map: treasureTest as unknown as MapData,
    modules: ['seafarers', 'citiesKnights'],
    players: [3, 4],
    winVP: 17,
    quickVP: 13,
    maxTurns: 5000,
    rules: ['r', 'd', 'w', 'f', 'nbfu', 'rdw', 'hu', 'I', 'O'],
  },
};
for (const k of ['classic', 'heading-for-new-shores', 'ck', 'ck-sea', 'treasures-ck'] as const) {
  const base = SIMS[k]!;
  SIMS[`cpu-${k}`] = {
    ...base,
    cpu: true,
    players: base.players.filter((n) => n >= (k === 'classic' ? 2 : 3)),
  };
}
const DEFAULT_GAMES: Record<string, number> = {
  classic: 1000,
  'heading-for-new-shores': 1000,
  'heading-for-new-shores-3': 500,
  'fog-test': 200,
  'fog-islands': 1000,
  'fog-islands-ck': 1000,
  ck: 1000,
  'ck-sea': 1000,
  'cpu-classic': 250,
  'cpu-heading-for-new-shores': 250,
  'cpu-ck': 250,
  'cpu-ck-sea': 250,
  treasures: 1000,
  'treasures-ck': 400,
  'cpu-treasures-ck': 100,
  'four-islands': 200,
  'four-islands-far': 200,
  'treasure-fog': 200,
  'classic-isles': 200,
  'classic-isles-far': 200,
  archipelago: 200,
  'the-crossing': 200,
  atoll: 200,
  'treasure-fog-ck': 100,
};

/** The CPUs the cpu-* scenarios cycle through: Easy, Medium, Hard and a custom one. */
const CPU_KINDS: CpuBrain[] = [
  'easy',
  MEDIUM,
  HARD,
  { ...MEDIUM, robber: 'leader', trading: 'generous', style: 'cards', focus: 'chase', timing: 'hold' },
];

/**
 * Seed format: base.scenario.index.<n>p.<house rules or ->. House rules: n no 7s in round 1,
 * b 3:1 bank, f free ship moves, r re-roll 7s / d no discards until the barbarians attack,
 * w barbarians wait 2 rounds, h dice can be handed back (H: during setup too); the bank (SPEC 8.1):
 * k the dice deck, K the dice deck with 5 cards out (docs/rules/dice-deck.md);
 * I unlimited, O as before Milestone 8 (commodities unlimited); otherwise limited, as new games.
 */
function makeSeed(base: string, scenario: string, i: number): string {
  const sc = SIMS[scenario]!;
  const n = sc.players[i % sc.players.length]!;
  const hr = i % 3 === 2 ? sc.rules[((i / 3) | 0) % sc.rules.length]! : '-';
  return `${base}.${scenario}.${i}.${n}p.${hr}`;
}

function parseSeed(seed: string): {
  scenario: string;
  n: number;
  houseRules: HouseRules;
  bank: 'limited' | 'unlimited' | undefined;
} {
  const [, scenario, , np, hr] = seed.split('.');
  if (!scenario || !SIMS[scenario] || !np) throw new Error(`can't parse seed ${seed}`);
  const houseRules: HouseRules = {};
  if (hr?.includes('n')) houseRules.no7FirstRound = true;
  if (hr?.includes('b')) houseRules.bank3to1 = true;
  if (hr?.includes('f')) houseRules.freeShipMoves = true;
  if (hr?.includes('r')) houseRules.rerollBeforeAttack = true;
  if (hr?.includes('d')) houseRules.noDiscardBeforeAttack = true;
  if (hr?.includes('w')) houseRules.barbarianDelay = 2;
  if (hr?.includes('h')) houseRules.handBack = true;
  if (hr?.includes('u')) houseRules.undo = true;
  if (hr?.includes('k')) houseRules.diceDeck = 'full';
  if (hr?.includes('K')) houseRules.diceDeck = 'trimmed';
  if (hr?.includes('H')) Object.assign(houseRules, { handBack: true, handBackSetup: true });
  const bank = hr?.includes('I') ? 'unlimited' : hr?.includes('O') ? undefined : 'limited';
  return { scenario, n: Number(np.replace('p', '')), houseRules, bank };
}

function run(seed: string, deepCheckRate?: number): SimResult & { cpuWon?: boolean } {
  const { scenario, n, houseRules, bank } = parseSeed(seed);
  const sc = SIMS[scenario]!;
  const index = Number(seed.split('.')[2]);
  const winVP = sc.quickVP && index % 2 ? sc.quickVP : sc.winVP;
  if (sc.cpu) {
    // 1 to n-1 CPUs, of every kind in turn; the rest are test bots.
    const k = 1 + (index % (n - 1));
    const brains = Array.from({ length: n }, (_, i): CpuBrain | 'bot' =>
      i < k ? CPU_KINDS[(index + i) % CPU_KINDS.length]! : 'bot',
    );
    const r = cpuGame(seed, n, k, {
      brains,
      ...(sc.map ? { map: sc.map } : {}),
      ...(sc.modules ? { modules: sc.modules } : {}),
      ...(winVP ? { winVP } : {}),
      maxTurns: sc.maxTurns ?? 3000,
      houseRules,
      ...(bank ? { bank } : {}),
      ...(deepCheckRate != null ? { hiddenRate: deepCheckRate } : {}),
    });
    return { ...r, winner: null, log: [] };
  }
  return simulate(seed, n, {
    ...(sc.map ? { map: sc.map } : {}),
    ...(sc.modules ? { modules: sc.modules } : {}),
    ...(winVP ? { winVP } : {}),
    ...(sc.maxTurns ? { maxTurns: sc.maxTurns } : {}),
    houseRules,
    ...(bank ? { bank } : {}),
    ...(deepCheckRate != null ? { deepCheckRate } : {}),
  });
}

type Summary = {
  seed: string;
  ok: boolean;
  turns: number;
  actions: number;
  errors: string[];
  cpuWon?: boolean;
};

if (!isMainThread) {
  for (const seed of workerData.seeds as string[]) {
    const r = run(seed);
    parentPort!.postMessage({
      seed,
      ok: r.ok,
      turns: r.turns,
      actions: r.actions,
      errors: r.errors.slice(0, 5),
      ...(r.cpuWon != null ? { cpuWon: r.cpuWon } : {}),
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
      `${sc}: ${rs.length} games, ${bad.length} failed, avg ${avg((r) => r.turns)} turns / ${avg((r) => r.actions)} actions` +
        (SIMS[sc]?.cpu ? `, CPUs won ${rs.filter((r) => r.cpuWon).length}` : ''),
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
