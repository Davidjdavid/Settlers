import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/index';
import { simulate } from './simulate';

// A quick sample under `npm test`; `npm run sim` plays the full 1,000+ games per scenario.
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

  it('plays Cities & Knights games, alone and with Seafarers', () => {
    for (let i = 0; i < 6; i++) {
      const sea = i >= 4;
      const r = simulate(`unit-ck-${i}`, 3 + (i % 2), {
        deepCheckRate: 0.1,
        maxTurns: 5000,
        modules: sea ? ['seafarers', 'citiesKnights'] : ['citiesKnights'],
        winVP: sea ? 17 : 13,
        ...(sea ? { map: SCENARIOS['heading-for-new-shores']! } : {}),
        houseRules: i % 3 === 1 ? { rerollBeforeAttack: true, barbarianDelay: 1 } : {},
      });
      expect(r.errors).toEqual([]);
      expect(r.finished).toBe(true);
    }
  }, 120000);
});
