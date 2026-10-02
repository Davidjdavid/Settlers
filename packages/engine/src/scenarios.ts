/* The maps and scenarios rooms can choose from. Each is a data file in ../maps. */

import hfns from '../maps/heading-for-new-shores.json';
import hfns3 from '../maps/heading-for-new-shores-3.json';
import type { MapData } from './map';
import { CLASSIC_MAP } from './rules';

export const SCENARIOS: Record<string, MapData> = {
  classic: CLASSIC_MAP,
  'heading-for-new-shores': hfns as unknown as MapData,
};

/** Layouts for a particular number of players (docs/rules/seafarers.md D15). */
const FOR_PLAYERS: Record<string, Record<number, MapData>> = {
  'heading-for-new-shores': { 3: hfns3 as unknown as MapData },
};

/** A scenario's map for this many players: its own layout for that count if it has one. */
export function scenarioMap(scenario: string, players: number): MapData {
  return FOR_PLAYERS[scenario]?.[players] ?? SCENARIOS[scenario]!;
}
