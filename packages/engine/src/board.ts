/* The standard 19-hex base board generator (same rules as the prototype). */

import { geometryFor, type Geometry } from './geometry';
import { shuffle, type RngState } from './rng';
import type { Board, HexData, PortType, Terrain } from './types';

/** Axial coordinates of the radius-2 hexagon, row by row. */
export const BASE_COORDS: { q: number; r: number }[] = (() => {
  const out: { q: number; r: number }[] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) {
      if (Math.abs(q + r) <= 2) out.push({ q, r });
    }
  }
  return out;
})();

const TERRAIN: Terrain[] = [
  'wood', 'wood', 'wood', 'wood', 'sheep', 'sheep', 'sheep', 'sheep', 'wheat', 'wheat', 'wheat', 'wheat',
  'brick', 'brick', 'brick', 'ore', 'ore', 'ore', 'desert',
]; // prettier-ignore
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const PORT_TYPES: PortType[] = ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
/** Coastal edges skipped between ports, walking around the island. */
const PORT_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4];

export function basePortSlots(g: Geometry): number[] {
  const out: number[] = [];
  let idx = 1;
  for (const gap of PORT_GAPS) {
    out.push(g.coast[idx % g.coast.length]!);
    idx += gap;
  }
  return out;
}

/** No two adjacent hexes share a number, and 6s and 8s never touch. */
export function numbersOK(g: Geometry, nums: number[]): boolean {
  const red = (n: number) => n === 6 || n === 8;
  for (let i = 0; i < nums.length; i++) {
    const a = nums[i]!;
    if (!a) continue;
    for (const j of g.hexNeighbors[i]!) {
      const b = nums[j]!;
      if (!b) continue;
      if (a === b || (red(a) && red(b))) return false;
    }
  }
  return true;
}

export function generateBaseBoard(rng: RngState): Board {
  const g = geometryFor(BASE_COORDS);
  const terr = shuffle(TERRAIN.slice(), rng);
  let nums: number[] = [];
  for (let tries = 0; tries < 5000; tries++) {
    const ns = shuffle(NUMBERS.slice(), rng);
    let k = 0;
    nums = terr.map((t) => (t === 'desert' ? 0 : ns[k++]!));
    if (numbersOK(g, nums)) break;
  }
  const portTypes = shuffle(PORT_TYPES.slice(), rng);
  const hexes: HexData[] = BASE_COORDS.map((c, i) => ({ q: c.q, r: c.r, t: terr[i]!, n: nums[i]! }));
  return {
    hexes,
    ports: basePortSlots(g).map((e, i) => ({ e, t: portTypes[i]! })),
    robber: terr.indexOf('desert'),
  };
}
