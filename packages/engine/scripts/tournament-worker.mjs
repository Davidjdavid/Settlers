// Worker entry for the tournaments: registers the TypeScript loader, then runs tournament.ts as a worker.
import { register } from 'tsx/esm/api';

register();
await import('./tournament.ts');
