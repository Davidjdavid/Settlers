import { describe, expect, it } from 'vitest';
import { nextInt, seedRng, type RollEntry } from '@settlers/engine';
import { binomTail, chiTail10, diceFacts, fairChance, howOften, runChance } from '../src/dicefacts';

const roll = (p: number, a: number, b: number, turn = 0): RollEntry => ({ p, d: [a, b], turn });

describe('the numbers behind the dice sentences (SPEC 13.3)', () => {
  it('runs in a row', () => {
    expect(runChance(1, 1, 0.3)).toBeCloseTo(0.3);
    expect(runChance(2, 2, 0.3)).toBeCloseTo(0.09);
    expect(runChance(3, 2, 0.5)).toBeCloseTo(3 / 8); // HH in three coin flips
    expect(runChance(4, 4, 1 / 6)).toBeCloseTo(1 / 1296);
    expect(runChance(3, 4, 0.5)).toBe(0);
    // Against a simulation: three 7s in a row somewhere in 30 rolls.
    const rng = seedRng('runs');
    let hits = 0;
    const N = 20000;
    for (let g = 0; g < N; g++) {
      let run = 0;
      let hit = false;
      for (let i = 0; i < 30; i++) {
        const t = 2 + nextInt(rng, 6) + nextInt(rng, 6);
        run = t === 7 ? run + 1 : 0;
        if (run >= 3) hit = true;
      }
      if (hit) hits++;
    }
    expect(Math.abs(hits / N - runChance(30, 3, 1 / 6))).toBeLessThan(0.01);
  });

  it('binomial tails and the chi-square test', () => {
    expect(binomTail(2, 1, 0.5)).toBeCloseTo(0.75);
    expect(binomTail(2, 0, 0.5, true)).toBeCloseTo(0.25);
    expect(binomTail(10, 0, 0.3)).toBeCloseTo(1);
    // Textbook values for 10 degrees of freedom.
    expect(chiTail10(18.307)).toBeCloseTo(0.05, 3);
    expect(chiTail10(9.342)).toBeCloseTo(0.5, 2);
    expect(chiTail10(0)).toBe(1);
    // Exactly the expected spread is as fair as it gets.
    expect(fairChance([0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1])).toBe(1);
    // All 7s isn't.
    expect(fairChance([0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0])).toBeLessThan(1e-6);
  });

  it('says how often in words', () => {
    expect(howOften(0.7)).toBe('most games');
    expect(howOften(0.3)).toBe('about 3 games in 10');
    expect(howOften(0.025)).toBe('about 1 game in 40');
  });
});

describe('what stands out (SPEC 13.3)', () => {
  it('four 7s in a row on one player’s turns', () => {
    const list: RollEntry[] = [];
    const others = [5, 6, 8, 9, 4, 10, 3, 11];
    for (let i = 0; i < 4; i++) {
      list.push(roll(0, 3, 4, i * 3));
      list.push(roll(1, 2, others[i * 2]! - 2, i * 3 + 1));
      list.push(roll(2, 2, others[i * 2 + 1]! - 2, i * 3 + 2));
    }
    const facts = diceFacts(list, ['Ann', 'You', 'Cat']);
    const mine = facts.find((f) => f.k === 'mine')!;
    expect(mine.text).toMatch(
      /^Ann rolled a 7 on four turns running\. For someone with 4 rolls that happens in about 1 game in \d+\.$/,
    );
    expect(facts.find((f) => f.k === 'sevens')!.text).toBe(
      'Sevens: 4 so far, about 2 expected. Most by Ann: 4 of 4 rolls.',
    );
    expect(facts.at(-1)).toEqual({
      k: 'fair',
      text: 'Too early to say how fair the dice look: that takes about 36 rolls (12 so far).',
    });
    // In a row overall too, when nobody rolled between.
    const row = diceFacts(
      [roll(0, 3, 4), roll(1, 5, 2), roll(2, 1, 6), roll(0, 6, 1)],
      ['Ann', 'Bob', 'Cat'],
    );
    expect(row[0]!.text).toMatch(
      /^Four 7s in a row \(rolls 1–4\)\. That happens in about 1 game in \d+ with 4 rolls\.$/,
    );
  });

  it('a 7 rolled again counts once for the turn; dice the Alchemist set don’t count', () => {
    const list: RollEntry[] = [
      { ...roll(0, 3, 4), again: true },
      roll(0, 2, 2),
      { ...roll(1, 6, 6), set: true },
    ];
    const facts = diceFacts(list, ['Ann', 'Bob']);
    expect(facts.find((f) => f.k === 'sevens')!.text).toBe(
      'Sevens: 1 so far, under 1 expected. Most by Ann: 1 of 2 rolls.',
    );
    expect(diceFacts([], ['Ann'])).toEqual([{ k: 'fair', text: 'No rolls yet.' }]);
  });

  it('a normal game says little; a lopsided one says what’s odd', () => {
    const rng = seedRng('fair-game');
    const fair: RollEntry[] = Array.from({ length: 120 }, (_, i) =>
      roll(i % 3, 1 + nextInt(rng, 6), 1 + nextInt(rng, 6)),
    );
    const facts = diceFacts(fair, ['Ann', 'Bob', 'Cat']);
    expect(facts.at(-1)!.k).toBe('fair');
    // Lots of 8s and no 6s for a long time.
    const odd: RollEntry[] = Array.from({ length: 60 }, (_, i) =>
      i % 2 ? roll(i % 3, 4, 4) : roll(i % 3, 1 + (i % 6), i % 6 === 4 ? 2 : 3),
    );
    const t = diceFacts(odd, ['Ann', 'Bob', 'Cat']);
    expect(t.some((f) => f.k === 'hot' && f.text.startsWith('8s are hot'))).toBe(true);
    expect(t.at(-1)!.text).toMatch(/^The spread is unusual/);
  });
});
