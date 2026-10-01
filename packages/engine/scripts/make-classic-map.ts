/*
 * Writes maps/classic.json from the original base-board constants, so the data file describes
 * exactly the board the engine always generated. Run once; the golden test proves equivalence.
 */
import { writeFileSync } from 'node:fs';
import { BASE_COORDS, NUMBERS, PORT_TYPES, TERRAIN, basePortSlots } from '../src/board';
import { geometryFor } from '../src/geometry';
import { edgeOfSide, type MapData } from '../src/map';

const g = geometryFor(BASE_COORDS);
const harbors = basePortSlots(g).map((e) => {
  const h = g.edges[e]!.hexes[0]!;
  const side = [0, 1, 2, 3, 4, 5].find((s) => edgeOfSide(g, h, s) === e)!;
  return { q: BASE_COORDS[h]!.q, r: BASE_COORDS[h]!.r, side, t: 'random' as const };
});
const map: MapData = {
  format: 1,
  id: 'classic',
  name: 'Classic',
  modules: [],
  players: [2, 3, 4],
  winVP: 10,
  hexes: BASE_COORDS.map((c) => ({ q: c.q, r: c.r, t: 'random', pool: 'main', n: 'random' })),
  pools: { main: { terrain: TERRAIN, numbers: NUMBERS } },
  harbors,
  harborPool: PORT_TYPES,
  start: 'all',
  robber: 'desert',
};
writeFileSync(new URL('../maps/classic.json', import.meta.url), JSON.stringify(map));
console.log('wrote maps/classic.json');
