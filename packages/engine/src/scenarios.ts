/* The maps and scenarios rooms can choose from. Each is a data file in ../maps. */

import hfns from '../maps/heading-for-new-shores.json';
import type { MapData } from './map';
import { CLASSIC_MAP } from './rules';

export const SCENARIOS: Record<string, MapData> = {
  classic: CLASSIC_MAP,
  'heading-for-new-shores': hfns as MapData,
};
