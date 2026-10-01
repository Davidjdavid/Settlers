/*
 * HTTP + WebSocket front door: passphrase login, static client files, health check,
 * and authenticated WebSocket connections handed to Rooms.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClientMsgSchema, type ServerMsg } from './protocol';
import { Rooms, type Conn, type RoomsOptions } from './rooms';
import { Store } from './store';

export interface ServerConfig {
  port: number;
  host?: string;
  dbFile: string;
  passphrase: string;
  /** Directory with the built client; omitted in tests. */
  staticDir?: string;
  /** Mark the auth cookie Secure (behind https). */
  secureCookie?: boolean;
  version?: string;
  rooms?: RoomsOptions;
  log?: (m: string) => void;
}

export interface RunningServer {
  port: number;
  rooms: Rooms;
  store: Store;
  close(): Promise<void>;
}

const COOKIE = 'settlers_auth';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer(cfg: ServerConfig): Promise<RunningServer> {
  const log = cfg.log ?? ((m: string) => console.log(m));
  const store = new Store(cfg.dbFile);
  const rooms = new Rooms(store, { log, ...cfg.rooms });
  // Generated once and kept in the database, so logins survive restarts.
  const secret = store.setMetaIfMissing('cookie_secret', randomBytes(32).toString('hex'));
  const authValue = createHmac('sha256', secret).update(`auth:${cfg.passphrase}`).digest('base64url');
  const started = Date.now();

  const authed = (req: IncomingMessage) => {
    const got = parseCookies(req.headers.cookie)[COOKIE];
    return !!got && safeEqual(got, authValue);
  };

  const attempts = new Map<string, { n: number; reset: number }>();
  const tooMany = (ip: string) => {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || a.reset < now) {
      attempts.set(ip, { n: 1, reset: now + 60_000 });
      return false;
    }
    a.n++;
    return a.n > 10;
  };

  const http = createServer((req, res) => {
    handleHttp(req, res).catch((e) => {
      log(`http error: ${e instanceof Error ? e.stack : e}`);
      if (!res.headersSent) send(res, 500, { error: 'Server error' });
      else res.end();
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname === '/healthz') {
      return send(res, 200, {
        ok: true,
        version: cfg.version ?? 'dev',
        uptime: Math.round((Date.now() - started) / 1000),
        rooms: rooms.size,
      });
    }
    if (url.pathname === '/api/session') return send(res, 200, { authed: authed(req) });
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (tooMany(ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
      const body = await readBody(req, 2000);
      let pass = '';
      try {
        pass = String(JSON.parse(body).passphrase ?? '');
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      if (!safeEqual(pass.trim(), cfg.passphrase)) {
        log(`failed login from ${ip}`);
        return send(res, 401, { error: 'That passphrase isn’t right' });
      }
      const cookie = [
        `${COOKIE}=${authValue}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${60 * 60 * 24 * 365}`,
      ];
      if (cfg.secureCookie) cookie.push('Secure');
      res.setHeader('Set-Cookie', cookie.join('; '));
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(url.pathname, res);
  }

  function serveStatic(pathname: string, res: ServerResponse) {
    if (!cfg.staticDir) return send(res, 404, { error: 'No client build' });
    const root = resolve(cfg.staticDir);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return send(res, 400, { error: 'Bad path' });
    const isFile = existsSync(file) && statSync(file).isFile();
    if (!isFile) {
      // Unknown paths without an extension (e.g. /r/ABCD) are app routes.
      if (extname(pathname)) return send(res, 404, { error: 'Not found' });
      file = join(root, 'index.html');
    }
    const hashed = /\/assets\//.test(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const origin = req.headers.origin;
    const sameOrigin = !origin || new URL(origin).host === req.headers.host;
    if (url.pathname !== '/ws' || !authed(req) || !sameOrigin) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws));
  });

  function onSocket(ws: WebSocket) {
    const conn: Conn & { alive: boolean } = {
      room: null,
      pid: null,
      alive: true,
      send(msg: ServerMsg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    // Simple flood guard: at most 60 messages per 10 seconds.
    let budget = 60;
    const refill = setInterval(() => (budget = 60), 10_000);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data) => {
      if (--budget < 0) {
        ws.close(1008, 'Too many messages');
        return;
      }
      let parsed;
      try {
        parsed = ClientMsgSchema.safeParse(JSON.parse(String(data)));
      } catch {
        return conn.send({ t: 'error', text: 'Bad message' });
      }
      if (!parsed.success) {
        const raw = safeJson(String(data));
        if (raw && raw.t === 'act' && typeof raw.id === 'string') {
          return conn.send({ t: 'ack', id: raw.id.slice(0, 64), ok: false, error: 'That move isn’t valid' });
        }
        return conn.send({ t: 'error', text: 'Bad message' });
      }
      try {
        rooms.handle(conn, parsed.data);
      } catch (e) {
        log(`error handling ${parsed.data.t}: ${e instanceof Error ? e.stack : e}`);
        if (parsed.data.t === 'act')
          conn.send({
            t: 'ack',
            id: parsed.data.id,
            ok: false,
            error: 'The server had a problem saving that move. Try again.',
          });
        else conn.send({ t: 'error', text: 'The server had a problem. Try again.' });
      }
    });
    ws.on('close', () => {
      clearInterval(refill);
      rooms.disconnect(conn);
    });
    ws.on('error', () => ws.terminate());
    sockets.set(ws, conn);
  }

  // Heartbeat: drop connections that stop answering pings.
  const sockets = new Map<WebSocket, Conn & { alive: boolean }>();
  const heartbeat = setInterval(() => {
    for (const [ws, conn] of sockets) {
      if (ws.readyState !== ws.OPEN) {
        sockets.delete(ws);
        continue;
      }
      if (!conn.alive) {
        ws.terminate();
        sockets.delete(ws);
        continue;
      }
      conn.alive = false;
      ws.ping();
    }
  }, 20_000);

  return new Promise((resolvePromise) => {
    http.listen(cfg.port, cfg.host ?? '127.0.0.1', () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
      log(`listening on ${cfg.host ?? '127.0.0.1'}:${port}`);
      resolvePromise({
        port,
        rooms,
        store,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            for (const ws of sockets.keys()) ws.terminate();
            wss.close();
            http.close(() => {
              store.close();
              done();
            });
            http.closeAllConnections();
          }),
      });
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > max) {
        req.destroy();
        fail(new Error('body too large'));
      }
    });
    req.on('end', () => ok(s));
    req.on('error', fail);
  });
}

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function clientIp(req: IncomingMessage): string {
  // Caddy on the same machine sets X-Forwarded-For.
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
