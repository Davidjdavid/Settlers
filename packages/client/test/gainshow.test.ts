import { describe, expect, it } from 'vitest';
import { gainWords } from '../src/gainshow';

describe('the cards you just got, in words (gainshow.tsx)', () => {
  it('in the hand’s order, with "and" before the last', () => {
    expect(gainWords({ wheat: 2 })).toBe('2 Wheat');
    expect(gainWords({ ore: 1, wheat: 2 })).toBe('2 Wheat and 1 Ore');
    expect(gainWords({ coin: 1, brick: 2, wood: 1 })).toBe('1 Wood, 2 Brick and 1 Coin');
    expect(gainWords({ paper: 1, cloth: 0 })).toBe('1 Books');
    expect(gainWords({})).toBe('');
  });
});
