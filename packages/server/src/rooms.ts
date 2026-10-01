/*
 * Rooms, seats and games. The server is the authority: every move is checked by the engine,
 * saved to SQLite, and only then broadcast. Each connection only ever receives viewFor() of
 * its own seat and events redacted for that seat.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ENGINE_VERSION,
  SCENARIOS,
  type GameConfig,
  type HouseRules, applyAction, checkInvariants, eventsFor, newGame, viewFor,
  type Action, type Color, type GameEvent, type GameState, type NewPlayer, type PlayerView,
} from '@settlers/engine'; // prettier-ignore
import {
  DEFAULT_OPTIONS,
  OptionsSchema,
  type ClientMsg,
  type LogItem,
  type RoomInfo,
  type RoomOptions,
  type ServerMsg,
} from './protocol';
import type { ActionRow, ChatRow, GameRow, SeatRow, Store } from './store';

export interface Conn {
  send(msg: ServerMsg): void;
  room: Room | null;
  pid: string | null;
}

interface LiveGame {
  row: GameRow;
  state: GameState;
  /** Client action ids already applied, so resends are harmless. */
  clientIds: Set<string>;
  /** Every event so far, for the log. */
  events: { seq: number; at: number; e: GameEvent }[];
}

export interface Room {
  code: string;
  createdAt: number;
  seats: SeatRow[];
  game: LiveGame | null;
  pendingReset: { pid: string; expiresAt: number } | null;
  conns: Set<Conn>;
  options: RoomOptions;
}

export interface RoomsOptions {
  now?: () => number;
  /** Write a full snapshot every N actions. */
  snapshotEvery?: number;
  /** Override game config (tests only). */
  gameConfig?: { winVP?: number };
  log?: (msg: string) => void;
}

const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
const RESET_WINDOW_MS = 2 * 60 * 1000;
const LOG_EVENTS = 600;
const LOG_CHAT = 150;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function cleanNick(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '')
    .trim()
    .slice(0, 18);
}

function cleanText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240);
}

/** Rebuild a game from its seed and action log, checking it matches what was saved. */
export function rebuildGame(
  store: Store,
  row: GameRow,
  log: (m: string) => void,
): { state: GameState; actions: ActionRow[]; problems: string[] } {
  const actions = store.loadActions(row.id);
  const problems: string[] = [];
  let s = newGame(row.seed, row.players, row.config);
  for (const a of actions) {
    const r = applyAction(s, a.seat, a.action);
    if (!r.ok) {
      problems.push(`action ${a.seq} no longer applies: ${r.error}`);
      break;
    }
    if (r.state.seq !== a.seq || JSON.stringify(r.events) !== JSON.stringify(a.events)) {
      problems.push(`action ${a.seq} replays differently`);
      break;
    }
    s = r.state;
  }
  if (problems.length) {
    // The engine changed in a way that breaks replay. Fall back to the latest snapshot
    // and apply only the actions after it.
    const snap = store.latestSnapshot(row.id);
    log(`game ${row.id}: ${problems.join('; ')}; falling back to snapshot ${snap?.seq ?? 'none'}`);
    if (snap) {
      s = snap;
      for (const a of actions.filter((x) => x.seq > snap.seq)) {
        const r = applyAction(s, a.seat, a.action);
        if (!r.ok) {
          problems.push(`after snapshot, action ${a.seq} fails: ${r.error}`);
          break;
        }
        s = r.state;
      }
    }
  }
  const bad = checkInvariants(s);
  if (bad.length) problems.push(...bad.map((b) => `invariant: ${b}`));
  return { state: s, actions, problems };
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private now: () => number;
  private snapshotEvery: number;
  private log: (m: string) => void;

  constructor(
    private store: Store,
    private opts: RoomsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.snapshotEvery = opts.snapshotEvery ?? 25;
    this.log = opts.log ?? ((m) => console.log(m));
    this.loadAll();
  }

  get size() {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  private loadAll() {
    for (const r of this.store.loadRooms()) {
      const parsed = OptionsSchema.safeParse(r.options);
      const room: Room = {
        options: parsed.success ? parsed.data : structuredClone(DEFAULT_OPTIONS),
        code: r.code,
        createdAt: r.createdAt,
        seats: r.seats,
        game: null,
        pendingReset: null,
        conns: new Set(),
      };
      if (r.gameId) {
        const row = this.store.loadGame(r.gameId);
        if (row) {
          const { state, actions, problems } = rebuildGame(this.store, row, this.log);
          if (problems.length) this.log(`room ${r.code} game ${row.id}: ${problems.join('; ')}`);
          room.game = {
            row,
            state,
            clientIds: new Set(actions.map((a) => a.clientId)),
            events: actions
              .flatMap((a) => a.events.map((e) => ({ seq: a.seq, at: a.at, e })))
              .slice(-LOG_EVENTS),
          };
        }
      }
      this.rooms.set(r.code, room);
    }
    this.log(`loaded ${this.rooms.size} rooms`);
  }

  /* ---------- Connections ---------- */

  disconnect(conn: Conn) {
    const room = conn.room;
    if (!room) return;
    room.conns.delete(conn);
    conn.room = null;
    const pid = conn.pid;
    conn.pid = null;
    if (pid && !this.isConnected(room, pid)) this.broadcast(room, []);
  }

  private isConnected(room: Room, pid: string): boolean {
    for (const c of room.conns) if (c.pid === pid) return true;
    return false;
  }

  handle(conn: Conn, msg: ClientMsg) {
    switch (msg.t) {
      case 'ping':
        return conn.send({ t: 'pong' });
      case 'create':
        return this.create(conn);
      case 'hello':
        return this.hello(conn, msg.room, msg.token);
    }
    const room = conn.room;
    if (!room) return conn.send({ t: 'error', text: 'Join a room first' });
    switch (msg.t) {
      case 'join':
        return this.join(conn, room, msg.nick, msg.color);
      case 'setColor':
        return this.setColor(conn, room, msg.color);
      case 'leave':
        return this.leave(conn, room);
      case 'start':
        return this.start(conn, room);
      case 'setOptions':
        return this.setOptions(conn, room, msg.options);
      case 'act':
        return this.act(conn, room, msg.id, msg.action);
      case 'chat':
        return this.chat(conn, room, msg.text);
      case 'resetRequest':
        return this.resetRequest(conn, room);
      case 'resetConfirm':
        return this.resetConfirm(conn, room);
      case 'resetCancel':
        return this.resetCancel(conn, room);
      case 'claim':
        return this.claim(conn, room, msg.seat);
    }
  }

  private attach(conn: Conn, room: Room, pid: string | null) {
    if (conn.room && conn.room !== room) this.disconnect(conn);
    const wasConnected = pid ? this.isConnected(room, pid) : true;
    conn.room = room;
    conn.pid = pid;
    room.conns.add(conn);
    conn.send({
      t: 'sync',
      room: this.roomInfo(room, conn),
      game: this.viewOf(room, conn),
      log: this.fullLog(room, conn),
    });
    if (!wasConnected) this.broadcast(room, [], conn);
  }

  private create(conn: Conn) {
    let code = '';
    do {
      code = Array.from(randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    } while (this.rooms.has(code) || this.store.roomExists(code));
    const room: Room = {
      code,
      createdAt: this.now(),
      seats: [],
      game: null,
      pendingReset: null,
      conns: new Set(),
      options: structuredClone(DEFAULT_OPTIONS),
    };
    this.store.insertRoom({ code, createdAt: room.createdAt, seats: [], gameId: null, options: null });
    this.rooms.set(code, room);
    this.log(`room ${code} created`);
    this.attach(conn, room, null);
  }

  private hello(conn: Conn, code: string, token?: string) {
    const room = this.rooms.get(code);
    if (!room) return conn.send({ t: 'error', text: `There’s no room ${code}` });
    let pid: string | null = null;
    if (token) {
      const h = hashToken(token);
      pid = room.seats.find((s) => s.tokenHash === h)?.pid ?? null;
    }
    this.attach(conn, room, pid);
  }

  private join(conn: Conn, room: Room, rawNick: string, color: Color) {
    if (conn.pid) return conn.send({ t: 'error', text: 'You already have a seat' });
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    const nick = cleanNick(rawNick);
    if (!nick) return conn.send({ t: 'error', text: 'Pick a nickname' });
    if (room.seats.length >= 4) return conn.send({ t: 'error', text: 'The table is full' });
    if (room.seats.some((s) => s.color === color))
      return conn.send({ t: 'error', text: 'That color is taken' });
    const token = randomBytes(24).toString('base64url');
    const pid = randomBytes(6).toString('base64url');
    room.seats.push({ pid, tokenHash: hashToken(token), nick, color });
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(room, `${nick} sat down`);
    });
    conn.pid = pid;
    conn.send({ t: 'seat', room: room.code, pid, token });
    this.broadcast(room, this.takeSys(room));
  }

  private setColor(conn: Conn, room: Room, color: Color) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    if (room.seats.some((s) => s.color === color && s !== seat))
      return conn.send({ t: 'error', text: 'That color is taken' });
    seat.color = color;
    this.store.saveRoom(room.code, room.seats, null);
    this.broadcast(room, []);
  }

  private leave(conn: Conn, room: Room) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'You are not seated' });
    if (room.game) return conn.send({ t: 'error', text: 'You can’t leave a game in progress' });
    room.seats = room.seats.filter((s) => s !== seat);
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(room, `${seat.nick} stood up`);
    });
    for (const c of room.conns) if (c.pid === seat.pid) c.pid = null;
    this.broadcast(room, this.takeSys(room));
  }

  private setOptions(conn: Conn, room: Room, options: RoomOptions) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.game) return conn.send({ t: 'error', text: 'Options can be changed before the game starts' });
    room.options = structuredClone(options);
    this.store.saveOptions(room.code, room.options);
    this.broadcast(room, []);
  }

  private start(conn: Conn, room: Room) {
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    if (!room.seats.some((s) => s.pid === conn.pid))
      return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.seats.length < 2) return conn.send({ t: 'error', text: 'You need at least 2 players' });
    const map = SCENARIOS[room.options.scenario]!;
    const allowed = playersFor(room.options);
    if (!allowed.includes(room.seats.length)) {
      const name = room.options.ck ? `${map.name} with Cities & Knights` : map.name;
      return conn.send({ t: 'error', text: `${name} needs ${allowed.join(' or ')} players` });
    }
    const players: NewPlayer[] = room.seats.map((s) => ({ pid: s.pid, color: s.color, nick: s.nick }));
    const row: GameRow = {
      id: randomUUID(),
      roomCode: room.code,
      seed: randomBytes(16).toString('hex'),
      engineVersion: ENGINE_VERSION,
      players,
      config: { ...gameConfigFor(room.options), ...this.opts.gameConfig },
      createdAt: this.now(),
      endedAt: null,
      endReason: null,
    };
    let state;
    try {
      state = newGame(row.seed, players, row.config);
    } catch (e) {
      return conn.send({ t: 'error', text: e instanceof Error ? e.message : 'Couldn’t start the game' });
    }
    this.store.tx(() => {
      this.store.insertGame(row);
      this.store.saveRoom(room.code, room.seats, row.id);
      this.sys(room, 'The game started');
    });
    room.game = { row, state, clientIds: new Set(), events: [] };
    room.pendingReset = null;
    this.log(`room ${room.code} game ${row.id} started with ${players.length} players`);
    this.broadcast(room, this.takeSys(room));
  }

  private act(conn: Conn, room: Room, id: string, action: Action) {
    const g = room.game;
    if (!g) return conn.send({ t: 'ack', id, ok: false, error: 'The game has not started yet' });
    if (g.clientIds.has(id)) return conn.send({ t: 'ack', id, ok: true }); // a resend of a move we already applied
    const seat = g.state.players.findIndex((p) => p.pid === conn.pid);
    if (seat < 0) return conn.send({ t: 'ack', id, ok: false, error: 'You are watching this game' });
    const r = applyAction(g.state, seat, action);
    if (!r.ok) return conn.send({ t: 'ack', id, ok: false, error: r.error });
    const at = this.now();
    const over = r.state.phase === 'over';
    // Persist first. If this throws, nothing changes in memory and nobody hears about the move.
    this.store.tx(() => {
      this.store.insertAction(g.row.id, {
        seq: r.state.seq,
        pid: conn.pid!,
        seat,
        clientId: id,
        action,
        events: r.events,
        at,
      });
      if (over || r.state.seq % this.snapshotEvery === 0) this.store.insertSnapshot(g.row.id, r.state);
      if (over) this.store.endGame(g.row.id, 'won', at);
    });
    g.state = r.state;
    g.clientIds.add(id);
    const items = r.events.map((e) => ({ seq: r.state.seq, at, e }));
    g.events.push(...items);
    if (g.events.length > LOG_EVENTS * 2) g.events = g.events.slice(-LOG_EVENTS);
    if (over) room.pendingReset = null;
    // The new state goes out before the ack, so when a client sees its move acknowledged it is
    // already looking at the result (no moment of acting on a stale view).
    this.broadcast(
      room,
      items.map((x): LogItem => ({ k: 'ev', ...x })),
    );
    conn.send({ t: 'ack', id, ok: true });
  }

  private chat(conn: Conn, room: Room, raw: string) {
    const text = cleanText(raw);
    if (!text) return;
    const seat = room.seats.find((s) => s.pid === conn.pid);
    const row = this.store.insertChat({
      roomCode: room.code,
      pid: conn.pid ?? 'watcher',
      nick: seat?.nick ?? 'Watcher',
      text,
      at: this.now(),
    });
    this.broadcast(room, [chatItem(row)]);
  }

  private resetRequest(conn: Conn, room: Room) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Only players can start a new game' });
    if (!room.game) return conn.send({ t: 'error', text: 'There’s no game to end' });
    if (room.game.state.phase === 'over') return this.endCurrentGame(room, seat, 'new game after finish');
    room.pendingReset = { pid: seat.pid, expiresAt: this.now() + RESET_WINDOW_MS };
    this.sys(room, `${seat.nick} wants to end this game and start a new one`);
    for (const c of room.conns) {
      if (c !== conn)
        c.send({
          t: 'notice',
          kind: 'warn',
          text: `${seat.nick} wants to end this game and start a new one. Cancel it if that’s a mistake.`,
        });
    }
    this.broadcast(room, this.takeSys(room));
  }

  private resetConfirm(conn: Conn, room: Room) {
    const p = room.pendingReset;
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat || !p || p.pid !== seat.pid || p.expiresAt < this.now()) {
      return conn.send({ t: 'error', text: 'Ask again to start a new game' });
    }
    this.endCurrentGame(room, seat, 'reset by player');
  }

  private endCurrentGame(room: Room, seat: SeatRow, reason: string) {
    const g = room.game!;
    this.store.tx(() => {
      this.store.endGame(g.row.id, reason, this.now());
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(
        room,
        g.state.phase === 'over' ? `${seat.nick} set up a new game` : `${seat.nick} ended the game`,
      );
    });
    room.game = null;
    room.pendingReset = null;
    this.log(`room ${room.code} game ${g.row.id} ended: ${reason}`);
    for (const c of room.conns) {
      c.send({ t: 'sync', room: this.roomInfo(room, c), game: null, log: this.fullLog(room, c) });
    }
    this.pendingSys.delete(room);
  }

  private resetCancel(conn: Conn, room: Room) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat || !room.pendingReset) return;
    room.pendingReset = null;
    this.sys(room, `${seat.nick} kept the game going`);
    this.broadcast(room, this.takeSys(room));
  }

  private claim(conn: Conn, room: Room, index: number) {
    if (conn.pid) return conn.send({ t: 'error', text: 'You already have a seat' });
    const seat = room.seats[index];
    if (!seat) return conn.send({ t: 'error', text: 'No such seat' });
    if (this.isConnected(room, seat.pid))
      return conn.send({ t: 'error', text: 'That player is still connected' });
    const token = randomBytes(24).toString('base64url');
    seat.tokenHash = hashToken(token);
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, room.game?.row.id ?? null);
      this.sys(room, `Someone took over ${seat.nick}’s seat`);
    });
    conn.pid = seat.pid;
    conn.send({ t: 'seat', room: room.code, pid: seat.pid, token });
    for (const c of room.conns) {
      if (c !== conn) c.send({ t: 'notice', kind: 'warn', text: `Someone took over ${seat.nick}’s seat` });
    }
    this.log(`room ${room.code}: seat ${seat.nick} claimed`);
    this.broadcast(room, this.takeSys(room));
  }

  /* ---------- System notices (stored in the chat table) ---------- */

  private pendingSys = new Map<Room, LogItem[]>();

  private sys(room: Room, text: string) {
    const row = this.store.insertChat({ roomCode: room.code, pid: 'sys', nick: '', text, at: this.now() });
    const list = this.pendingSys.get(room) ?? [];
    list.push(chatItem(row));
    this.pendingSys.set(room, list);
  }

  private takeSys(room: Room): LogItem[] {
    const list = this.pendingSys.get(room) ?? [];
    this.pendingSys.delete(room);
    return list;
  }

  /* ---------- Views ---------- */

  private seatOf(room: Room, conn: Conn): number | null {
    if (!room.game || !conn.pid) return null;
    const i = room.game.state.players.findIndex((p) => p.pid === conn.pid);
    return i >= 0 ? i : null;
  }

  private viewOf(room: Room, conn: Conn): PlayerView | null {
    return room.game ? viewFor(room.game.state, this.seatOf(room, conn)) : null;
  }

  roomInfo(room: Room, conn: Conn): RoomInfo {
    if (room.pendingReset && room.pendingReset.expiresAt < this.now()) room.pendingReset = null;
    const pr = room.pendingReset;
    return {
      code: room.code,
      seats: room.seats.map((s) => ({
        pid: s.pid,
        nick: s.nick,
        color: s.color,
        connected: this.isConnected(room, s.pid),
      })),
      me: conn.pid,
      phase: room.game ? room.game.state.phase : 'lobby',
      options: room.options,
      pendingReset: pr
        ? { pid: pr.pid, nick: room.seats.find((s) => s.pid === pr.pid)?.nick ?? '', expiresAt: pr.expiresAt }
        : null,
    };
  }

  private redact(items: LogItem[], seat: number | null): LogItem[] {
    return items.map((it) => (it.k === 'ev' ? { ...it, e: eventsFor([it.e], seat)[0]! } : it));
  }

  private fullLog(room: Room, conn: Conn): LogItem[] {
    const chat = this.store.recentChat(room.code, LOG_CHAT).map(chatItem);
    const evs: LogItem[] = (room.game?.events ?? []).slice(-LOG_EVENTS).map((x) => ({ k: 'ev', ...x }));
    const all = [...this.redact(evs, this.seatOf(room, conn)), ...chat];
    return all.sort((a, b) => a.at - b.at || order(a) - order(b));
  }

  private broadcast(room: Room, items: LogItem[], skip?: Conn) {
    for (const c of room.conns) {
      if (c === skip) continue;
      c.send({
        t: 'update',
        room: this.roomInfo(room, c),
        game: this.viewOf(room, c),
        log: this.redact(items, this.seatOf(room, c)),
      });
    }
  }
}

/**
 * The game config for room options. A classic game with default options gets exactly the
 * config it always had ({}), so nothing changes for classic games.
 */
export function gameConfigFor(o: RoomOptions): Partial<GameConfig> {
  const map = SCENARIOS[o.scenario]!;
  const seafarers = map.modules.includes('seafarers');
  const hr: HouseRules = {};
  if (o.houseRules.no7FirstRound) hr.no7FirstRound = true;
  if (o.houseRules.bank3to1) hr.bank3to1 = true;
  if (o.houseRules.freeShipMoves && seafarers) hr.freeShipMoves = true;
  if (o.ck) {
    if (o.houseRules.rerollBeforeAttack) hr.rerollBeforeAttack = true;
    if (o.houseRules.noDiscardBeforeAttack) hr.noDiscardBeforeAttack = true;
    if (o.houseRules.barbarianDelay) hr.barbarianDelay = o.houseRules.barbarianDelay;
  }
  const c: Partial<GameConfig> = {};
  if (o.scenario !== 'classic') c.map = map;
  if (o.ck) c.modules = [...map.modules, 'citiesKnights'];
  if (o.winVP !== map.winVP || o.scenario !== 'classic' || o.ck) c.winVP = o.winVP;
  if (Object.keys(hr).length) c.houseRules = hr;
  return c;
}

/** Player counts a room's options allow. */
export function playersFor(o: RoomOptions): number[] {
  const map = SCENARIOS[o.scenario]!;
  return o.ck ? map.players.filter((n) => n >= 3) : map.players;
}

function chatItem(r: ChatRow): LogItem {
  return r.pid === 'sys'
    ? { k: 'sys', id: r.id, at: r.at, text: r.text }
    : { k: 'chat', id: r.id, at: r.at, pid: r.pid, nick: r.nick, text: r.text };
}

/** Stable order for log items with the same timestamp. */
function order(it: LogItem): number {
  return it.k === 'ev' ? it.seq : it.id;
}
