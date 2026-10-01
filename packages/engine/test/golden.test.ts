import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, newGame, type Action } from '../src/index';
import { seatsFor } from './simulate';

const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const games = JSON.parse(readFileSync(new URL('./fixtures/base-golden.json', import.meta.url), 'utf8')) as {
  seed: string;
  players: number;
  log: [number, Action][];
  steps: string;
  final: string;
}[];

// Saved base games on the live server must keep replaying exactly. These were recorded with
// engine version 1; every state and event list must hash the same as when they were recorded.
describe('golden base games replay identically', () => {
  for (const g of games) {
    it(g.seed, () => {
      let s = newGame(g.seed, seatsFor(g.players));
      const steps: string[] = [];
      for (const [p, a] of g.log) {
        const r = applyAction(s, p, a);
        if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
        s = r.state;
        steps.push(hash([s, r.events]));
      }
      expect(hash(steps)).toBe(g.steps);
      expect(hash(s)).toBe(g.final);
    });
  }
});
