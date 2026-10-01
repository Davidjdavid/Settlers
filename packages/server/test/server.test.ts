import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMsg } from '../src/protocol';
import { startServer, type RunningServer } from '../src/server';

let dir: string;
let srv: RunningServer;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-srv-'));
  const web = join(dir, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>Settlers</title>');
  writeFileSync(join(web, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'secret.txt'), 'nope');
  srv = await startServer({
    port: 0,
    dbFile: join(dir, 'db.sqlite'),
    passphrase: 'open sesame',
    staticDir: web,
    log: () => {},
  });
  base = `http://127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

async function login(pass: string): Promise<{ status: number; cookie: string | null }> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ passphrase: pass }) });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null };
}

function connect(cookie?: string): Promise<{ ws: WebSocket; next: () => Promise<ServerMsg> }> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: cookie ? { cookie } : {} });
    const queue: ServerMsg[] = [];
    const waiters: ((m: ServerMsg) => void)[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      const w = waiters.shift();
      if (w) w(m);
      else queue.push(m);
    });
    ws.on('open', () =>
      ok({ ws, next: () => new Promise((r) => (queue.length ? r(queue.shift()!) : waiters.push(r))) }),
    );
    ws.on('error', fail);
    ws.on('unexpected-response', (_req, res) => fail(new Error(`HTTP ${res.statusCode}`)));
  });
}

describe('http', () => {
  it('health check', async () => {
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });

  it('serves the app, app routes and hashed assets', async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain('Settlers');
    expect(await (await fetch(`${base}/r/ABCD`)).text()).toContain('Settlers');
    const a = await fetch(`${base}/assets/app-123.js`);
    expect(a.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('does not serve files outside the client folder', async () => {
    const r = await fetch(`${base}/..%2fsecret.txt`);
    expect(await r.text()).not.toContain('nope');
  });

  it('checks the passphrase', async () => {
    expect((await login('wrong')).status).toBe(401);
    const ok = await login('  open sesame ');
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^settlers_auth=/);
    const s = await fetch(`${base}/api/session`, { headers: { cookie: ok.cookie! } });
    expect(await s.json()).toEqual({ authed: true });
  });
});

describe('websocket', () => {
  it('refuses connections without the passphrase cookie', async () => {
    await expect(connect()).rejects.toThrow(/401/);
    await expect(connect('settlers_auth=forged')).rejects.toThrow(/401/);
  });

  it('creates a room and plays a move over the wire', async () => {
    const { cookie } = await login('open sesame');
    const a = await connect(cookie!);
    a.ws.send(JSON.stringify({ t: 'create' }));
    const sync = await a.next();
    if (sync.t !== 'sync') throw new Error(sync.t);
    const code = sync.room.code;
    a.ws.send(JSON.stringify({ t: 'join', nick: 'Ann', color: 'red' }));
    expect((await a.next()).t).toBe('seat');
    await a.next(); // update

    const b = await connect(cookie!);
    b.ws.send(JSON.stringify({ t: 'hello', room: code }));
    expect((await b.next()).t).toBe('sync');
    b.ws.send(JSON.stringify({ t: 'join', nick: 'Bob', color: 'blue' }));
    expect((await b.next()).t).toBe('seat');

    b.ws.send(JSON.stringify({ t: 'bogus' }));
    let m = await b.next();
    while (m.t === 'update') m = await b.next();
    expect(m).toMatchObject({ t: 'error', text: 'Bad message' });

    b.ws.send(JSON.stringify({ t: 'act', id: 'z', action: { type: 'road', e: -5 } }));
    m = await b.next();
    expect(m).toMatchObject({ t: 'ack', id: 'z', ok: false });

    a.ws.send(JSON.stringify({ t: 'ping' }));
    let p = await a.next();
    while (p.t !== 'pong') p = await a.next();
    a.ws.close();
    b.ws.close();
  });
});
