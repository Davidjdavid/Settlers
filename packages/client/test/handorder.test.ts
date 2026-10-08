import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOTS, isDefault, slotsFor, swapSlots } from '../src/handorder';

describe('arranging your cards (SPEC 13.2)', () => {
  it('starts with each commodity under the resource it comes from', () => {
    expect(slotsFor(undefined, 'base')).toEqual(['wood', 'brick', 'sheep', 'wheat', 'ore']);
    const ck = slotsFor(undefined, 'ck');
    expect(ck.slice(0, 5)).toEqual(['wood', 'brick', 'sheep', 'wheat', 'ore']);
    expect(ck[5]).toBe('paper'); // under wood
    expect(ck[7]).toBe('cloth'); // under sheep
    expect(ck[9]).toBe('coin'); // under ore
    expect([ck[6], ck[8]]).toEqual([null, null]);
  });

  it('swaps two spots, or moves a card to an empty spot', () => {
    const a = swapSlots(DEFAULT_SLOTS.ck, 9, 0);
    expect(a[0]).toBe('coin');
    expect(a[9]).toBe('wood');
    const b = swapSlots(DEFAULT_SLOTS.ck, 9, 8);
    expect(b[8]).toBe('coin');
    expect(b[9]).toBeNull();
    expect(isDefault(b, 'ck')).toBe(false);
    expect(isDefault(swapSlots(b, 8, 9), 'ck')).toBe(true);
    expect(swapSlots(DEFAULT_SLOTS.base, 0, 99)).toEqual(DEFAULT_SLOTS.base);
  });

  it('a saved arrangement that doesn’t fit this kind of game falls back to the standard one', () => {
    const mine = swapSlots(DEFAULT_SLOTS.base, 0, 4);
    expect(slotsFor(mine, 'base')).toEqual(mine);
    expect(slotsFor(mine, 'ck')).toEqual(DEFAULT_SLOTS.ck);
    expect(slotsFor(['wood', 'wood', 'sheep', 'wheat', 'ore'], 'base')).toEqual(DEFAULT_SLOTS.base);
    expect(slotsFor(['wood', 'brick', 'sheep', 'wheat', 'paper'], 'base')).toEqual(DEFAULT_SLOTS.base);
    expect(slotsFor('junk', 'ck')).toEqual(DEFAULT_SLOTS.ck);
  });
});
