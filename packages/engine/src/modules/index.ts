/* The registry of expansion modules. */

import { registerModules } from './api';
import { seafarers } from './seafarers';

registerModules({ seafarers: () => seafarers });

export { seafarers };
