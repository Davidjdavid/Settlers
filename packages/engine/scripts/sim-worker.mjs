// Worker entry for the simulator: registers the TypeScript loader, then runs sim.ts as a worker.
import { register } from 'tsx/esm/api';

register();
await import('./sim.ts');
