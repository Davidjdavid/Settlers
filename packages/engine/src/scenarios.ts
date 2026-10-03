/* The maps and scenarios rooms can choose from. Each is a data file in ../maps. */

import hfns from '../maps/heading-for-new-shores.json';
import hfns3 from '../maps/heading-for-new-shores-3.json';
import fogIslands from '../maps/fog-islands.json';
import fourIslands from '../maps/four-islands.json';
import fourIslandsFar from '../maps/four-islands-far.json';
import treasureFog from '../maps/treasure-fog.json';
import classicIsles from '../maps/classic-isles.json';
import classicIslesFar from '../maps/classic-isles-far.json';
import archipelago from '../maps/archipelago.json';
import theCrossing from '../maps/the-crossing.json';
import atoll from '../maps/atoll.json';
import type { MapData } from './map';
import { CLASSIC_MAP } from './rules';

export const SCENARIOS: Record<string, MapData> = {
  classic: CLASSIC_MAP,
  'heading-for-new-shores': hfns as unknown as MapData,
  /** Our own Fog Islands (SPEC 10.2): a home island, fog hiding islands and gold across the water. */
  'fog-islands': fogIslands as unknown as MapData,
  /** Added 2 October, from the players' wishes. Four islands; 2 points for settling another. */
  'four-islands': fourIslands as unknown as MapData,
  /** Four Islands on a bigger sea: at least two sea tiles between islands (3 October). */
  'four-islands-far': fourIslandsFar as unknown as MapData,
  /** The classic board, a sea full of treasure spots, and fog islands around the edge. */
  'treasure-fog': treasureFog as unknown as MapData,
  /** The classic board with a big sea to the east, where islands come up at random. */
  'classic-isles': classicIsles as unknown as MapData,
  /** The classic board and seven small islands, at least two sea tiles from it and from each other (3 October). */
  'classic-isles-far': classicIslesFar as unknown as MapData,
  /** Ten small islands one sea tile apart and no home island: start anywhere (3 October). */
  archipelago: archipelago as unknown as MapData,
  /** Two big islands facing each other across a wide channel, gold isles in the middle (3 October). */
  'the-crossing': theCrossing as unknown as MapData,
  /** A ring of land around a lagoon, broken by three inlets, with a rich island in the middle (3 October). */
  atoll: atoll as unknown as MapData,
};

/**
 * Layouts for a particular number of players. None now: Heading for New Shores used its own
 * smaller 3-player island until players found it looked like missing tiles (docs/rules/seafarers.md
 * D15, changed 2 October); 3 players now play the full island. The old file stays, so saved games
 * that copied it are unaffected (a game keeps a copy of its map anyway).
 */
const FOR_PLAYERS: Record<string, Record<number, MapData>> = {};
/** The old 3-player Heading for New Shores layout (kept for the simulator and older tests). */
export const HFNS_3_OLD = hfns3 as unknown as MapData;

/** A scenario's map for this many players: its own layout for that count if it has one. */
export function scenarioMap(scenario: string, players: number): MapData {
  return FOR_PLAYERS[scenario]?.[players] ?? SCENARIOS[scenario]!;
}

/**
 * The premade Seafarers maps a new map can start from in the editor (a copy; 3 October). Not
 * Classic and the Isles: its random tiles can be sea, which the editor's tile set can't hold, so
 * a copy would turn that sea into land (test/maps.test.ts checks every map listed here copies
 * exactly).
 */
export const COPYABLE_MAPS = [
  'heading-for-new-shores', 'fog-islands', 'four-islands', 'four-islands-far', 'treasure-fog', 'classic-isles-far',
  'archipelago', 'the-crossing', 'atoll',
] as const; // prettier-ignore
