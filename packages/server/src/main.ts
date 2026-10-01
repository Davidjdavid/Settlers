/* Production entry point. Configuration comes from environment variables. */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './server';

const env = process.env;
const passphrase = env.SITE_PASSPHRASE ?? '';
if (!passphrase && env.NODE_ENV === 'production') {
  console.error('SITE_PASSPHRASE is not set; refusing to start.');
  process.exit(1);
}
const dataDir = env.DATA_DIR ?? './data';
mkdirSync(dataDir, { recursive: true });

const server = await startServer({
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '127.0.0.1',
  dbFile: join(dataDir, 'settlers.db'),
  passphrase: passphrase || 'dev',
  staticDir: env.STATIC_DIR,
  secureCookie: env.NODE_ENV === 'production',
  version: env.APP_VERSION ?? 'dev',
});

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: shutting down`);
    server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
