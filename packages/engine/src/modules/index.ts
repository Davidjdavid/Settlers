/* The registry of expansion modules. */

import { registerModules } from './api';
import { citiesKnights } from './citiesKnights';
import { seafarers } from './seafarers';

registerModules({ seafarers: () => seafarers, citiesKnights: () => citiesKnights });

export { citiesKnights, seafarers };
