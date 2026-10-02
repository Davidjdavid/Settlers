/* The registry of expansion modules. */

import { registerModules } from './api';
import { citiesKnights } from './citiesKnights';
import { seafarers } from './seafarers';
import { treasures } from './treasures';

registerModules({
  seafarers: () => seafarers,
  citiesKnights: () => citiesKnights,
  treasures: () => treasures,
});

export { citiesKnights, seafarers, treasures };
