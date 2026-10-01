/*
 * npm run sim -- [--games N] [--seed S] [--replay SEED] [--players 2|3|4]
 * Plays N random games (players cycling 2, 3, 4 unless fixed) and exits non-zero on any failure.
 */

import { simulate } from '../test/simulate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const replay = arg('replay');
const games = Number(arg('games') ?? 1000);
const base = arg('seed') ?? 'sim';
const fixedPlayers = arg('players') ? Number(arg('players')) : null;

function playersFor(seed: string, i: number): number {
  if (fixedPlayers) return fixedPlayers;
  // A replay seed carries its player count: "<base>-<i>-<n>p".
  const m = /-(\d)p$/.exec(seed);
  return m ? Number(m[1]) : 2 + (i % 3);
}

if (replay) {
  const r = simulate(replay, playersFor(replay, 0), { deepCheckRate: 1 });
  console.log(JSON.stringify({ ...r, log: `${r.log.length} actions` }, null, 2));
  process.exit(r.ok ? 0 : 1);
}

const t0 = Date.now();
let failed = 0;
let turns = 0;
let actions = 0;
const wins: Record<string, number> = {};
for (let i = 0; i < games; i++) {
  const n = playersFor('', i);
  const seed = `${base}-${i}-${n}p`;
  const r = simulate(seed, n);
  turns += r.turns;
  actions += r.actions;
  const key = `${n}p seat ${r.winner}`;
  wins[key] = (wins[key] ?? 0) + 1;
  if (!r.ok) {
    failed++;
    console.error(
      `FAIL ${seed}\n  ${r.errors.slice(0, 5).join('\n  ')}\n  replay: npm run sim -- --replay ${seed}`,
    );
    if (failed >= 10) break;
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(
  `${games} games, ${failed} failed, avg ${(turns / games).toFixed(0)} turns / ${(actions / games).toFixed(0)} actions, ${secs}s`,
);
console.log('wins by seat:', JSON.stringify(wins));
process.exit(failed ? 1 : 0);
