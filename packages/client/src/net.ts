/*
 * Connection to the server, plus the client-side store React subscribes to.
 * - Reconnects with backoff whenever the socket drops, then re-sends `hello` with the seat token.
 * - Moves carry an id; unacknowledged moves are re-sent after a reconnect (the server applies
 *   each id at most once).
 * - The client never decides outcomes; it only shows what the server sends.
 */

import { useSyncExternalStore } from 'react';
import type { Action, Color, GameStats, GenRules, MapData, Persona, PlayerView } from '@settlers/engine';
import type {
  MapInfo,
  PresetInfo,
  CpuInfo,
  ClientMsg,
  DiceInfo,
  GameStatsInfo,
  LogItem,
  MusicOp,
  PlayerRecord,
  PlayerSettings,
  ProfileInfo,
  RoomInfo,
  RoomOptions,
  SavedGame,
  ServerMsg,
  TableOp,
} from '@settlers/server/protocol';

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
  /** Profiles (SPEC 5.1), saved games (5.7), stats (5.6): loaded on request. */
  profiles: ProfileInfo[] | null;
  saved: SavedGame[] | null;
  record: { who: string; name: string; record: PlayerRecord } | null;
  gameStats: GameStatsInfo | null;
  /** This game's dice so far, and its full stats once it's over. */
  dice: DiceInfo | null;
  stats: GameStats | null;
  /** The page outside rooms: the start screen, the Stats page, or maps. */
  path: string;
  /** Saved maps and generator presets (docs/maps.md 4.4, 5.18), loaded on request. */
  maps: MapInfo[] | null;
  /** The map last opened or saved, for the editor. */
  openMap: { map: MapData; info: MapInfo; saved?: boolean } | null;
  presets: PresetInfo[] | null;
  /** Custom CPUs (docs/bot-medium-hard.md §5.2), loaded on request. */
  cpus: CpuInfo[] | null;
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

/** A map as the protocol carries it (editor maps only ever use the Seafarers module). */
type MapMsg = Extract<ClientMsg, { t: 'saveMap' }>['map'];

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
    profiles: null,
    saved: null,
    record: null,
    gameStats: null,
    dice: null,
    stats: null,
    path: typeof location === 'undefined' ? '/' : location.pathname,
    maps: null,
    openMap: null,
    presets: null,
    cpus: null,
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
  /** Resuming a saved game: the next sync is its new room. */
  private resuming = false;

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
      else if (this.creating) this.send({ t: 'create', full: true });
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
        if (this.creating || this.resuming) {
          this.creating = false;
          this.resuming = false;
          history.pushState(null, '', `/r/${m.room.code}`);
        }
        this.set({
          roomCode: m.room.code,
          room: m.room,
          game: this.staged ? this.state.game : m.game,
          log: m.log,
          roomError: null,
          dice: m.dice ?? null,
          stats: m.stats ?? null,
        });
        if (this.rematching && !m.game && m.room.me) {
          this.rematching = false;
          this.send({ t: 'start' });
        }
        // Re-send moves that were never acknowledged (safe: ids are applied once).
        for (const [id, w] of this.waiting) this.send({ t: 'act', id, action: w.action });
        return;
      }
      case 'update': {
        const before = this.state.game;
        const seen = new Set(this.state.log.map(itemKey));
        const items = m.log.filter((it) => !seen.has(itemKey(it)));
        this.set({
          room: m.room,
          game: this.staged ? this.state.game : m.game,
          log: [...this.state.log, ...items].slice(-800),
          dice: m.dice ?? null,
          stats: m.stats ?? null,
        });
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
        // Outside a room, an error is about joining one, except on the pages that do other
        // things (Maps, Stats, CPUs), where it pops up like any other.
        if (!this.state.room && !/^\/(maps|stats|cpus)/.test(this.state.path))
          this.set({ roomError: m.text });
        else this.toast(m.text, 'err');
        return;
      case 'notice':
        this.toast(m.text, m.kind);
        return;
      case 'pong':
        return;
      case 'profiles':
        this.set({ profiles: m.list });
        return;
      case 'profile':
        setStored('settlers.profile', m.profile.id);
        return;
      case 'saved':
        this.set({ saved: m.list });
        return;
      case 'stats':
        this.set({ record: { who: m.who, name: m.name, record: m.record } });
        return;
      case 'gameStats':
        this.set({ gameStats: m.game });
        return;
      case 'maps':
        this.set({ maps: m.list });
        return;
      case 'map':
        this.set({ openMap: { map: m.map, info: m.info, ...(m.saved ? { saved: true } : {}) } });
        if (m.saved) this.toast(`Saved “${m.info.name}”`);
        return;
      case 'presets':
        this.set({ presets: m.list });
        return;
      case 'cpus':
        this.set({ cpus: m.list });
        return;
      case 'closed':
        // "Save and quit" (or a deleted game): back to the start screen.
        this.waiting.clear();
        history.pushState(null, '', '/');
        this.set({
          roomCode: null,
          room: null,
          game: null,
          log: [],
          pending: 0,
          dice: null,
          stats: null,
          path: '/',
        });
        this.toast(m.text);
        this.send({ t: 'saved' });
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
    this.send({ t: 'create', full: true });
  }

  leaveRoom() {
    this.set({ roomCode: null, room: null, game: null, log: [], roomError: null, path: '/' });
    history.pushState(null, '', '/');
    this.ws?.close();
  }

  /** Go to a page outside rooms (the Stats page, or back to the start). */
  go(path: string) {
    if (location.pathname !== path) history.pushState(null, '', path);
    this.set({ path });
  }
  /** The browser's back/forward buttons. */
  popped() {
    this.set({ path: location.pathname });
  }

  /** Sit down as a profile (remembered as this browser's last pick). */
  join(profile: string, color: Color, move = false) {
    setStored('settlers.profile', profile);
    this.send(move ? { t: 'join', profile, color, move } : { t: 'join', profile, color });
  }
  loadProfiles() {
    this.send({ t: 'profiles' });
  }
  newProfile(name: string, color: Color) {
    this.send({ t: 'newProfile', name, color });
  }
  /** Take a person off the list, from the Stats page. */
  deleteProfile(id: string) {
    this.send({ t: 'deleteProfile', id });
  }
  mergeProfiles(from: string, into: string) {
    this.send({ t: 'mergeProfiles', from, into });
  }
  loadSaved() {
    this.send({ t: 'saved' });
  }
  resume(game: string) {
    this.resuming = true;
    this.set({ roomError: null });
    this.send({ t: 'resume', game });
  }
  deleteSaved(game: string) {
    this.send({ t: 'deleteSaved', game });
  }
  loadMaps() {
    this.send({ t: 'maps' });
  }
  openSavedMap(id: string) {
    this.set({ openMap: null });
    this.send({ t: 'getMap', id });
  }
  /** Who's making maps on this browser: its last profile's name. */
  private by(): { by?: string } {
    const id = getStored('settlers.profile');
    const name = this.state.profiles?.find((p) => p.id === id)?.name;
    return name ? { by: name } : {};
  }
  saveMap(map: MapData) {
    this.send({ t: 'saveMap', map: map as MapMsg, ...this.by() });
  }
  importMap(map: MapData) {
    this.send({ t: 'importMap', map: map as MapMsg, ...this.by() });
  }
  renameMap(id: string, name: string) {
    this.send({ t: 'renameMap', id, name });
  }
  duplicateMap(id: string) {
    this.send({ t: 'duplicateMap', id, ...this.by() });
  }
  deleteMap(id: string) {
    this.send({ t: 'deleteMap', id });
  }
  loadPresets() {
    this.send({ t: 'presets' });
  }
  savePreset(id: string | undefined, name: string, rules: GenRules) {
    this.send({ t: 'savePreset', ...(id ? { id } : {}), name, rules, ...this.by() });
  }
  deletePreset(id: string) {
    this.send({ t: 'deletePreset', id });
  }
  loadCpus() {
    this.send({ t: 'cpus' });
  }
  saveCpu(id: string | undefined, name: string, persona: Persona) {
    this.send({ t: 'saveCpu', ...(id ? { id } : {}), name, persona, ...this.by() });
  }
  deleteCpu(id: string) {
    this.send({ t: 'deleteCpu', id });
  }
  loadStats(who: string) {
    this.send({ t: 'stats', who });
  }
  loadGameStats(game: string) {
    this.set({ gameStats: null });
    this.send({ t: 'gameStats', game });
  }
  closeGameStats() {
    this.set({ gameStats: null });
  }
  setCpuChat(on: boolean) {
    this.send({ t: 'setCpuChat', on });
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
  /** Anything on the pre-game table (docs/pregame.md). */
  tableOp(op: TableOp) {
    this.send({ t: 'table', op });
  }
  addCpu() {
    this.send({ t: 'addCpu' });
  }

  editCpu(pid: string, change: { nick?: string; color?: Color; level?: string }) {
    this.send({ t: 'editCpu', pid, ...change });
  }

  removeCpu(pid: string) {
    this.send({ t: 'removeCpu', pid });
  }

  setOptions(options: RoomOptions) {
    this.send({ t: 'setOptions', options });
  }
  chat(text: string) {
    this.send({ t: 'chat', text });
  }
  /** After a game: the same players, the same mode, a new board. */
  rematch() {
    this.rematching = true;
    this.send({ t: 'resetRequest' });
  }
  private rematching = false;

  resetRequest(kind: 'reset' | 'quit' = 'reset') {
    this.send({ t: 'resetRequest', kind });
  }
  resetConfirm() {
    this.send({ t: 'resetConfirm' });
  }
  resetCancel() {
    this.send({ t: 'resetCancel' });
  }
  /** Table music (SPEC 12). */
  music(op: MusicOp) {
    this.send({ t: 'music', op });
  }

  saveSettings(settings: PlayerSettings) {
    this.send({ t: 'saveSettings', settings });
  }
  claim(seat: number) {
    this.send({ t: 'claim', seat });
  }

  /** Send a move. Resolves when the server accepts or rejects it. */
  /** Moves recorded instead of sent while a made-up view is shown (see stage). */
  private staged: Action[] | null = null;
  /**
   * Test hook for screens a real game rarely reaches (e2e/m8.spec.ts, the Smith): show a
   * made-up game view in this browser only. Until the page reloads, the server's views are
   * ignored here and moves are recorded instead of sent, so the server never sees any of it.
   */
  stage(game: PlayerView) {
    this.staged = [];
    this.set({ game });
  }
  stagedMoves(): Action[] {
    return this.staged?.slice() ?? [];
  }

  act(action: Action): Promise<{ ok: boolean; error?: string }> {
    if (this.staged) {
      this.staged.push(action);
      return Promise.resolve({ ok: true });
    }
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
