// npm run dev: the game server (restarts on change) plus the Vite client with hot reload.
// Open http://localhost:5173 and use the passphrase "dev".
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', 'packages/server/src/main.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '8080',
      DATA_DIR: './data',
      SITE_PASSPHRASE: process.env.SITE_PASSPHRASE ?? 'dev',
    },
  }),
  spawn('npm', ['run', 'dev', '-w', '@settlers/client'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
