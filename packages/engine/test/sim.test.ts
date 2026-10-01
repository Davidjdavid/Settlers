import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';

// A quick sample under `npm test`; `npm run sim` plays the full 1,000+ games.
describe('simulator', () => {
  for (const n of [2, 3, 4]) {
    it(`plays ${n}-player games to completion with all invariants holding`, () => {
      for (let i = 0; i < 25; i++) {
        const r = simulate(`unit-${n}-${i}`, n, { deepCheckRate: 0.1 });
        expect(r.errors).toEqual([]);
        expect(r.finished).toBe(true);
      }
    });
  }
});
