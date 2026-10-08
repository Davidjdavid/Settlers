import { describe, expect, it } from 'vitest';
import { COMS, RES } from '@settlers/engine';
import { HAND_LAYOUT } from '../src/handorder';

describe('the cards in your hand (SPEC 13.2)', () => {
  it('Knights: two rows of four, each commodity under the resource it comes from', () => {
    const ck = HAND_LAYOUT.ck;
    expect(ck.slice(0, 4)).toEqual(['wood', 'sheep', 'ore', 'brick']);
    expect(ck.slice(4)).toEqual(['paper', 'cloth', 'coin', 'wheat']);
    // Books under wood, linen under sheep, coin under ore.
    expect(ck[4]).toBe('paper');
    expect(ck[5]).toBe('cloth');
    expect(ck[6]).toBe('coin');
    expect([...ck].sort()).toEqual([...RES, ...COMS].sort());
  });

  it('otherwise one row of five in the same order', () => {
    expect(HAND_LAYOUT.base).toEqual(['wood', 'sheep', 'ore', 'brick', 'wheat']);
    expect([...HAND_LAYOUT.base].sort()).toEqual([...RES].sort());
  });
});
