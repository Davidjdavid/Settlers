/* Start and stop the real production build of the server for end-to-end tests. */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

export class TestServer {
  proc: ChildProcess | null = null;
  output = '';
  readonly dataDir = mkdtempSync(join(tmpdir(), 'settlers-e2e-'));
  constructor(
    readonly port: number,
    readonly passphrase: string,
  ) {}

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    this.proc = spawn(process.execPath, [join(ROOT, 'packages/server/dist/server.mjs')], {
      env: {
        ...process.env,
        PORT: String(this.port),
        DATA_DIR: this.dataDir,
        STATIC_DIR: join(ROOT, 'packages/client/dist'),
        SITE_PASSPHRASE: this.passphrase,
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc.stdout!.on('data', (d) => (this.output += d));
    this.proc.stderr!.on('data', (d) => (this.output += d));
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`${this.url}/healthz`);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server did not start:\n${this.output}`);
  }

  /** Kill without warning, like a crash or power cut. */
  async crash() {
    const p = this.proc!;
    const exited = new Promise((r) => p.once('exit', r));
    p.kill('SIGKILL');
    await exited;
    this.proc = null;
  }

  async stop() {
    if (!this.proc) return;
    const p = this.proc;
    const exited = new Promise((r) => p.once('exit', r));
    p.kill('SIGTERM');
    await exited;
    this.proc = null;
  }
}
