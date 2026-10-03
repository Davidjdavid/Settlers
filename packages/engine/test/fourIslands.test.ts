import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import type { MapData } from '../src/map';

const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const; // prettier-ignore
const dist = (a: number[], b: number[]) => {
  const dq = a[0]! - b[0]!;
  const dr = a[1]! - b[1]!;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};

/** The map's islands: groups of land hexes that touch (every land hex here is fixed in place). */
function islandsOf(m: MapData): number[][][] {
  const land = m.hexes.filter((h) => h.t !== 'sea' && h.t !== 'fog').map((h) => [h.q, h.r]);
  const key = (c: number[]) => `${c[0]},${c[1]}`;
  const all = new Set(land.map(key));
  const seen = new Set<string>();
  const out: number[][][] = [];
  for (const c of land) {
    if (seen.has(key(c))) continue;
    const part: number[][] = [];
    const stack = [c];
    seen.add(key(c));
    while (stack.length) {
      const x = stack.pop()!;
      part.push(x);
      for (const [dq, dr] of DIRS) {
        const y = [x[0]! + dq, x[1]! + dr];
        if (all.has(key(y)) && !seen.has(key(y))) {
          seen.add(key(y));
          stack.push(y);
        }
      }
    }
    out.push(part);
  }
  return out;
}

describe('Four Islands (3 October: the two right islands touched)', () => {
  it.each([
    ['four-islands', 1],
    ['four-islands-far', 2],
  ] as const)('%s: four islands of 7 tiles, at least %i sea tiles apart', (id, gap) => {
    const m = SCENARIOS[id]!;
    // Land is all drawn from the one pool, which holds no sea: where land is never changes.
    expect(Object.values(m.pools ?? {}).every((p) => !p.terrain.includes('sea'))).toBe(true);
    const parts = islandsOf(m);
    expect(parts.map((p) => p.length)).toEqual([7, 7, 7, 7]);
    for (let i = 0; i < parts.length; i++)
      for (const b of parts.slice(i + 1)) {
        const closest = Math.min(...parts[i]!.flatMap((x) => b.map((y) => dist(x, y))));
        expect(closest - 1).toBeGreaterThanOrEqual(gap);
      }
  });
});
