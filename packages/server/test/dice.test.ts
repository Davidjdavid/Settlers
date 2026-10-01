import { describe, expect, it } from 'vitest';
import { diceForRoll, rollDie } from '../src/dice';

/** How far a count may stray: 4.5 standard deviations (a fair die fails ~1 in 150,000 per count). */
const within = (count: number, n: number, p: number) =>
  Math.abs(count - n * p) <= 4.5 * Math.sqrt(n * p * (1 - p));

describe('the dice function (SPEC 5.3)', () => {
  it('1,000,000 rolls: each die even over 1–6, totals match two-dice odds, dice independent', () => {
    const N = 1_000_000;
    const faces = [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]; // per die, index 1–6
    const totals = new Array<number>(13).fill(0);
    const pairs = new Array<number>(36).fill(0);
    const events = new Array<number>(7).fill(0);
    for (let i = 0; i < N; i++) {
      const { d, e } = diceForRoll(1);
      expect(d).toHaveLength(2);
      const [a, b] = d as [number, number];
      faces[0]![a]!++;
      faces[1]![b]!++;
      totals[a + b]!++;
      pairs[(a - 1) * 6 + (b - 1)]!++;
      events[e![0]!]!++;
    }
    for (const f of faces)
      for (let v = 1; v <= 6; v++) expect(within(f[v]!, N, 1 / 6), `face ${v}: ${f[v]}`).toBe(true);
    for (let v = 1; v <= 6; v++) expect(within(events[v]!, N, 1 / 6), `event ${v}`).toBe(true);
    const ways = (t: number) => 6 - Math.abs(t - 7);
    for (let t = 2; t <= 12; t++)
      expect(within(totals[t]!, N, ways(t) / 36), `total ${t}: ${totals[t]}`).toBe(true);
    for (const c of pairs) expect(within(c, N, 1 / 36)).toBe(true);
    // The headline odds, as percentages.
    expect(totals[2]! / N).toBeCloseTo(1 / 36, 2); // ≈ 2.8%
    expect(totals[6]! / N).toBeCloseTo(5 / 36, 2); // ≈ 13.9%
    expect(totals[7]! / N).toBeCloseTo(6 / 36, 2); // ≈ 16.7%
    // Chi-square over the 36 (die 1, die 2) pairs: 35 degrees of freedom, 99.99th percentile ≈ 75.
    const chi = pairs.reduce((sum, c) => sum + (c - N / 36) ** 2 / (N / 36), 0);
    expect(chi).toBeLessThan(75);
    console.log(
      `1,000,000 rolls: totals ${totals
        .slice(2)
        .map((c, i) => `${i + 2}:${((100 * c) / N).toFixed(2)}%`)
        .join(' ')}; chi² ${chi.toFixed(1)}`,
    );
  }, 60000);

  it('only ever gives whole numbers 1 to 6', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) seen.add(rollDie());
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
