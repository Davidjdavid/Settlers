/*
 * Authoring helper: writes the Seafarers map files. The JSON files are the source of truth once
 * written; this script just saves typing coordinates by hand. Never change hex order in a map
 * that has been played (it would break replays of saved games).
 */
import { writeFileSync } from 'node:fs';
import classic from '../maps/classic.json';
import type { MapData, MapHex } from '../src/map';

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const; // prettier-ignore

/** Hexes at distance `n` from the centre, walking around the ring. */
function ring(n: number): [number, number][] {
  const out: [number, number][] = [];
  let q = DIRS[4][0] * n;
  let r = DIRS[4][1] * n;
  for (let side = 0; side < 6; side++) {
    for (let i = 0; i < n; i++) {
      out.push([q, r]);
      q += DIRS[side]![0];
      r += DIRS[side]![1];
    }
  }
  return out;
}

const main = (classic as MapData).hexes.map((h) => ({ ...h }));
const harbors = (classic as MapData).harbors;
const mainPool = (classic as MapData).pools!.main!;

// Heading for New Shores: main island, a ring of sea, then four small islands among more sea.
const outer = ring(4);
const isleAt = new Set([1, 2, 3, 7, 8, 9, 13, 14, 15, 19, 20, 21]);
const hfns: MapData = {
  format: 1,
  id: 'heading-for-new-shores',
  name: 'Heading for New Shores',
  modules: ['seafarers'],
  players: [3, 4],
  winVP: 14,
  specialVP: { newIsland: 2 },
  hexes: [
    ...main,
    ...ring(3).map(([q, r]): MapHex => ({ q, r, t: 'sea' })),
    ...outer.map(([q, r], i): MapHex =>
      isleAt.has(i) ? { q, r, t: 'random', pool: 'isles', n: 'random' } : { q, r, t: 'sea' },
    ),
  ],
  pools: {
    main: mainPool,
    isles: {
      terrain: [
        'gold',
        'gold',
        'wood',
        'wood',
        'brick',
        'brick',
        'sheep',
        'sheep',
        'wheat',
        'wheat',
        'ore',
        'ore',
      ],
      numbers: [2, 3, 4, 4, 5, 6, 8, 9, 10, 10, 11, 12],
    },
  },
  harbors,
  harborPool: (classic as MapData).harborPool!,
  start: 'all',
  robber: 'desert',
  pirate: null,
};

// Fog test map (tests only): main island, a ring of fog, then sea. Starts only on the main island.
const fogTest: MapData = {
  format: 1,
  id: 'fog-test',
  name: 'Fog test',
  modules: ['seafarers'],
  players: [3, 4],
  winVP: 12,
  specialVP: { newIsland: 2 },
  hexes: [
    ...main,
    ...ring(3).map(([q, r]): MapHex => ({ q, r, t: 'fog' })),
    ...ring(4).map(([q, r]): MapHex => ({ q, r, t: 'sea' })),
  ],
  pools: { main: mainPool },
  fog: {
    terrain: [
      'sea',
      'sea',
      'sea',
      'sea',
      'sea',
      'sea',
      'gold',
      'gold',
      'wood',
      'wood',
      'brick',
      'brick',
      'sheep',
      'sheep',
      'wheat',
      'wheat',
      'ore',
      'ore',
    ],
    numbers: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 5, 9],
  },
  harbors: [],
  start: main.map((h) => [h.q, h.r] as [number, number]),
  robber: 'desert',
  pirate: [ring(4)[0]![0], ring(4)[0]![1]],
};

writeFileSync(new URL('../maps/heading-for-new-shores.json', import.meta.url), JSON.stringify(hfns));
writeFileSync(new URL('../test/fixtures/fog-test.json', import.meta.url), JSON.stringify(fogTest));
console.log('wrote maps');
