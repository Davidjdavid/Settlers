/*
 * Connection to the server, plus the client-side store React subscribes to.
 * - Reconnects with backoff whenever the socket drops, then re-sends `hello` with the seat token.
 * - Moves carry an id; unacknowledged moves are re-sent after a reconnect (the server applies
 *   each id at most once).
 * - The client never decides outcomes; it only shows what the server sends.
 */

import { useSyncExternalStore } from 'react';
import type { Action, Color, PlayerView } from '@settlers/engine';
import type { ClientMsg, LogItem, RoomInfo, RoomOptions, ServerMsg } from '@settlers/server/protocol';

export type Status = 'connecting' | 'live' | 'offline';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'err';
}

export interface ClientState {
  auth: 'checking' | 'needed' | 'ok';
  status: Status;
  roomCode: string | null;
  room: RoomInfo | null;
  game: PlayerView | null;
  log: LogItem[];
  toasts: Toast[];
  /** Moves sent but not yet acknowledged. */
  pending: number;
  roomError: string | null;
}

export interface Fresh {
  items: LogItem[];
  before: PlayerView | null;
  after: PlayerView | null;
}

const tokenKey = (room: string) => `settlers.token.${room}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setStored(key: string, value: string) {
  try {
    storage()?.setItem(key, value);
  } catch {
    /* private mode: tokens just won't survive a refresh */
  }
}

let nextToast = 1;

export class Client {
  state: ClientState = {
    auth: 'checking',
    status: 'connecting',
    roomCode: null,
    room: null,
    game: null,
    log: [],
    toasts: [],
    pending: 0,
    roomError: null,
  };
  private listeners = new Set<() => void>();
  private freshListeners = new Set<(f: Fresh) => void>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMsgAt = 0;
  private waiting = new Map<
    string,
    { action: Action; resolve: (r: { ok: boolean; error?: string }) => void }
  >();
  private creating = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  onFresh(fn: (f: Fresh) => void): () => void {
    this.freshListeners.add(fn);
    return () => {
      this.freshListeners.delete(fn);
    };
  }

  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: nextToast++, text, kind };
    this.set({ toasts: [...this.state.toasts, t].slice(-4) });
    setTimeout(
      () => this.set({ toasts: this.state.toasts.filter((x) => x.id !== t.id) }),
      kind === 'info' ? 3500 : 6000,
    );
  }

  /* ---------- Auth ---------- */

  async checkAuth() {
    try {
      const r = await fetch('/api/session');
      const j = (await r.json()) as { authed: boolean };
      this.set({ auth: j.authed ? 'ok' : 'needed' });
      if (j.authed) this.connect();
    } catch {
      this.set({ auth: 'needed' });
      setTimeout(() => this.checkAuth(), 3000);
    }
  }

  async login(passphrase: string): Promise<string | null> {
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!r.ok) return ((await r.json()) as { error?: string }).error ?? 'That didn’t work';
      this.set({ auth: 'ok' });
      this.connect();
      return null;
    } catch {
      return 'Can’t reach the server. Check your connection.';
    }
  }

  /* ---------- Socket ---------- */

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
      return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.set({ status: this.retry ? 'offline' : 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      this.lastMsgAt = Date.now();
      this.set({ status: 'live' });
      if (this.state.roomCode) this.hello(this.state.roomCode);
      else if (this.creating) this.send({ t: 'create' });
    };
    ws.onmessage = (ev) => {
      this.lastMsgAt = Date.now();
      try {
        this.receive(JSON.parse(String(ev.data)) as ServerMsg);
      } catch (e) {
        console.error('bad message', e);
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 1006 && this.retry === 0) void this.recheckAuth();
      this.scheduleReconnect();
    };
  }

  /** A refused upgrade looks like a plain close; check whether we were logged out. */
  private async recheckAuth() {
    try {
      const j = (await (await fetch('/api/session')).json()) as { authed: boolean };
      if (!j.authed) this.set({ auth: 'needed' });
    } catch {
      /* offline; keep retrying */
    }
  }

  private scheduleReconnect() {
    if (this.state.auth !== 'ok') return;
    this.set({ status: 'offline' });
    const delay = Math.min(5000, 400 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Called on focus/online/heartbeat: make sure we're connected and not stuck. */
  nudge() {
    if (this.state.auth !== 'ok') return;
    if (!this.ws) {
      this.retry = 0;
      this.connect();
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastMsgAt > 45_000) this.ws.close();
      else this.send({ t: 'ping' });
    }
  }

  private send(m: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  private hello(code: string) {
    const token = getStored(tokenKey(code)) ?? undefined;
    this.send(token ? { t: 'hello', room: code, token } : { t: 'hello', room: code });
  }

  private receive(m: ServerMsg) {
    switch (m.t) {
      case 'seat':
        setStored(tokenKey(m.room), m.token);
        return;
      case 'sync': {
        if (this.creating) {
          this.creating = false;
          history.pushState(null, '', `/r/${m.room.code}`);
        }
        this.set({ roomCode: m.room.code, room: m.room, game: m.game, log: m.log, roomError: null });
        // Re-send moves that were never acknowledged (safe: ids are applied once).
        for (const [id, w] of this.waiting) this.send({ t: 'act', id, action: w.action });
        return;
      }
      case 'update': {
        const before = this.state.game;
        const seen = new Set(this.state.log.map(itemKey));
        const items = m.log.filter((it) => !seen.has(itemKey(it)));
        this.set({ room: m.room, game: m.game, log: [...this.state.log, ...items].slice(-800) });
        if (items.length) for (const fn of this.freshListeners) fn({ items, before, after: m.game });
        return;
      }
      case 'ack': {
        const w = this.waiting.get(m.id);
        if (!w) return;
        this.waiting.delete(m.id);
        this.set({ pending: this.waiting.size });
        if (!m.ok) this.toast(m.error ?? 'That didn’t work', 'err');
        w.resolve({ ok: m.ok, ...(m.error ? { error: m.error } : {}) });
        return;
      }
      case 'error':
        if (!this.state.room) this.set({ roomError: m.text });
        else this.toast(m.text, 'err');
        return;
      case 'notice':
        this.toast(m.text, m.kind);
        return;
      case 'pong':
        return;
    }
  }

  /* ---------- Room actions ---------- */

  openRoom(code: string) {
    this.waiting.clear();
    this.set({ roomCode: code, room: null, game: null, log: [], roomError: null, pending: 0 });
    this.hello(code);
  }

  createRoom() {
    this.creating = true;
    this.set({ roomCode: null, room: null, game: null, log: [], roomError: null });
    this.send({ t: 'create' });
  }

  leaveRoom() {
    this.set({ roomCode: null, room: null, game: null, log: [], roomError: null });
    history.pushState(null, '', '/');
    this.ws?.close();
  }

  join(nick: string, color: Color) {
    setStored('settlers.nick', nick);
    this.send({ t: 'join', nick, color });
  }
  setColor(color: Color) {
    this.send({ t: 'setColor', color });
  }
  stand() {
    this.send({ t: 'leave' });
  }
  start() {
    this.send({ t: 'start' });
  }
  setOptions(options: RoomOptions) {
    this.send({ t: 'setOptions', options });
  }
  chat(text: string) {
    this.send({ t: 'chat', text });
  }
  resetRequest() {
    this.send({ t: 'resetRequest' });
  }
  resetConfirm() {
    this.send({ t: 'resetConfirm' });
  }
  resetCancel() {
    this.send({ t: 'resetCancel' });
  }
  claim(seat: number) {
    this.send({ t: 'claim', seat });
  }

  /** Send a move. Resolves when the server accepts or rejects it. */
  act(action: Action): Promise<{ ok: boolean; error?: string }> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      this.waiting.set(id, { action, resolve });
      this.set({ pending: this.waiting.size });
      // If offline, the move goes out on reconnect.
      this.send({ t: 'act', id, action });
    });
  }
}

export function itemKey(it: LogItem): string {
  return it.k === 'ev' ? `e${it.seq}:${JSON.stringify(it.e)}` : `c${it.id}`;
}

export const client = new Client();

export function useClient(): ClientState {
  return useSyncExternalStore(client.subscribe, () => client.state);
}
