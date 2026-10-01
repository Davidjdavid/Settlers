/*
 * Record "golden" base games with the current engine: full move logs plus a hash of every
 * state and event list. test/golden.test.ts replays them and must match exactly, which proves
 * engine changes don't alter how saved base games replay.
 * Only re-run this on purpose, when a rules change is intended (and bump ENGINE_VERSION).
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { applyAction, newGame } from '../src/index';
import { seatsFor, simulate } from '../test/simulate';

const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const games = [];
for (let i = 0; i < 12; i++) {
  const n = 2 + (i % 3);
  const seed = `golden-${i}-${n}p`;
  const r = simulate(seed, n);
  if (!r.ok) throw new Error(`simulation failed for ${seed}`);
  let s = newGame(seed, seatsFor(n));
  const steps: string[] = [];
  for (const [p, a] of r.log) {
    const res = applyAction(s, p, a);
    if (!res.ok) throw new Error(res.error);
    s = res.state;
    steps.push(hash([s, res.events]));
  }
  games.push({ seed, players: n, log: r.log, steps: hash(steps), final: hash(s) });
}
writeFileSync(new URL('../test/fixtures/base-golden.json', import.meta.url), JSON.stringify(games));
console.log(`wrote ${games.length} golden games`);
