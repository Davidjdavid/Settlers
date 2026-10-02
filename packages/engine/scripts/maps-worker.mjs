// Worker entry for the map checker: registers the TypeScript loader, then runs maps.ts as a worker.
import { register } from 'tsx/esm/api';

register();
await import('./maps.ts');
