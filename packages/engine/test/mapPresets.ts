/* Presets the generator tests run besides the built-in ones (docs/maps.md 6). */

import { BUILTIN_PRESETS, OUR_RULES, type GenRules } from '../src/index';

export const TEST_PRESETS: { name: string; rules: GenRules }[] = [
  ...BUILTIN_PRESETS,
  { name: 'Desert in the middle, 5/9 good', rules: { ...OUR_RULES, desert: 'center', harborGood: '5689' } },
  { name: 'Desert on the edge, random harbors', rules: { ...OUR_RULES, desert: 'edge', harbors: 'random' } },
  { name: 'No desert', rules: { ...OUR_RULES, desert: 'none' } },
  { name: 'No 6 or 8 at harbors', rules: { ...OUR_RULES, harborNoRed: true, harbors: 'random' } },
  { name: 'Official spiral', rules: { ...OUR_RULES, numbers: 'spiral', noLowClusters: false } },
  {
    name: 'Two players, tight',
    rules: { ...OUR_RULES, fairPlayers: 2, bestSpot: 11, clump: 2, balance: 15, fairness: 3 },
  },
  {
    name: 'Desert corners count',
    rules: { ...OUR_RULES, badSpot: 5, badSpotDesert: true, pips: { ...OUR_RULES.pips, 6: 6, 8: 6 } },
  },
];
