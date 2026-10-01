/*
 * Rooms, seats and games. The server is the authority: every move is checked by the engine,
 * saved to SQLite, and only then broadcast. Each connection only ever receives viewFor() of
 * its own seat and events redacted for that seat.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ENGINE_VERSION,
  NEED_DICE,
  SCENARIOS,
  type GameConfig,
  type HouseRules, applyAction, checkInvariants, cpuMove, eventsFor, newCpuMemo, newGame, seedRng, viewFor,
  COLORS, type CpuMemo, StatsFold, cpuChat, type CpuLevel, type GameStats,
  type Action, type Color, type GameEvent, type GameState, type NewPlayer, type PlayerView,
} from '@settlers/engine'; // prettier-ignore
import { History, modeOf } from './history';
import {
  DEFAULT_OPTIONS,
  OptionsSchema,
  SettingsSchema,
  type ClientMsg,
  type DiceInfo,
  type PlayerSettings,
  type ProfileInfo,
  type SavedGame,
  type LogItem,
  type RoomInfo,
  type RoomOptions,
  type ServerMsg,
} from './protocol';
import { diceForRoll } from './dice';
import { nickKey, type ActionRow, type ChatRow, type GameRow, type SeatRow, type Store } from './store';

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
  /** Stats kept move by move (SPEC 5.6); null if the game couldn't be replayed from the start. */
  fold: StatsFold | null;
}

export interface Room {
  code: string;
  createdAt: number;
  seats: SeatRow[];
  game: LiveGame | null;
  pendingReset: { pid: string; expiresAt: number; kind: 'reset' | 'quit' } | null;
  conns: Set<Conn>;
  options: RoomOptions;
  /** The pending CPU move, if any. */
  cpuTimer?: unknown;
  /** What each CPU remembers within a turn, by pid. */
  cpuMemo?: Map<string, CpuMemo>;
  /** CPU chatter: the turn each CPU last spoke, and how often it's been robbed (by pid). */
  chatter?: Map<string, { turn: number; robbed: number }>;
}

export interface RoomsOptions {
  now?: () => number;
  /** Write a full snapshot every N actions. */
  snapshotEvery?: number;
  /** Override game config (tests only). */
  gameConfig?: { winVP?: number };
  log?: (msg: string) => void;
  /** How long a CPU waits before each move, in ms (default 1–2 s). */
  cpuDelay?: () => number;
  /** Timers for CPU moves (tests use a fake clock). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Random numbers for CPU chatter (tests make it predictable). */
  chatRandom?: () => number;
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
): { state: GameState; actions: ActionRow[]; problems: string[]; fold: StatsFold | null } {
  const actions = store.loadActions(row.id);
  const problems: string[] = [];
  let s = newGame(row.seed, row.players, row.config);
  let fold: StatsFold | null = new StatsFold(s);
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
    try {
      fold?.step(s, a.seat, a.action, r.events, r.state);
    } catch (e) {
      log(`game ${row.id}: stats stopped at ${a.seq}: ${String(e)}`);
      fold = null;
    }
    s = r.state;
  }
  if (problems.length) fold = null;
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
  return { state: s, actions, problems, fold };
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private now: () => number;
  private snapshotEvery: number;
  private log: (m: string) => void;
  private history: History;

  constructor(
    private store: Store,
    private opts: RoomsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.snapshotEvery = opts.snapshotEvery ?? 25;
    this.log = opts.log ?? ((m) => console.log(m));
    this.history = new History(store);
    this.loadAll();
    for (const room of this.rooms.values()) this.scheduleCpu(room);
  }

  private stopped = false;
  /** Cancel pending CPU moves and stop sending updates (shutdown, tests). */
  stop() {
    this.stopped = true;
    for (const room of this.rooms.values()) {
      if (room.cpuTimer != null)
        (this.opts.clearTimer ?? clearTimeout)(room.cpuTimer as ReturnType<typeof setTimeout>);
      room.cpuTimer = undefined;
    }
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
          const { state, actions, problems, fold } = rebuildGame(this.store, row, this.log);
          if (problems.length) this.log(`room ${r.code} game ${row.id}: ${problems.join('; ')}`);
          room.game = {
            row,
            state,
            clientIds: new Set(actions.map((a) => a.clientId)),
            events: actions
              .flatMap((a) => a.events.map((e) => ({ seq: a.seq, at: a.at, e })))
              .slice(-LOG_EVENTS),
            fold,
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
    if (!room || this.stopped) return;
    room.conns.delete(conn);
    conn.room = null;
    const pid = conn.pid;
    conn.pid = null;
    if (pid && !this.isConnected(room, pid)) this.broadcast(room, []);
  }

  private isConnected(room: Room, pid: string): boolean {
    if (room.seats.some((s) => s.pid === pid && s.cpu)) return true; // CPUs are always here
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
      case 'profiles':
        return conn.send({ t: 'profiles', list: this.profileList() });
      case 'newProfile':
        return this.newProfile(conn, msg.name, msg.color);
      case 'mergeProfiles':
        return this.mergeProfiles(conn, msg.from, msg.into);
      case 'saved':
        return conn.send({ t: 'saved', list: this.savedList() });
      case 'resume':
        return this.resume(conn, msg.game);
      case 'deleteSaved':
        return this.deleteSaved(conn, msg.game);
      case 'stats':
        return this.statsFor(conn, msg.who);
      case 'gameStats': {
        const g = this.history.gameInfo(msg.game);
        const row = this.store.loadGame(msg.game);
        // Only finished games: an unfinished game's stats would show hands.
        if (!g || !row || row.endReason !== 'won')
          return conn.send({ t: 'error', text: 'No stats for that game' });
        return conn.send({ t: 'gameStats', game: g });
      }
    }
    const room = conn.room;
    if (!room) return conn.send({ t: 'error', text: 'Join a room first' });
    switch (msg.t) {
      case 'join':
        return this.join(conn, room, msg.profile, msg.color);
      case 'setCpuChat':
        return this.setCpuChat(conn, room, msg.on);
      case 'setColor':
        return this.setColor(conn, room, msg.color);
      case 'leave':
        return this.leave(conn, room);
      case 'start':
        return this.start(conn, room);
      case 'setOptions':
        return this.setOptions(conn, room, msg.options);
      case 'addCpu':
        return this.addCpu(conn, room);
      case 'editCpu':
        return this.editCpu(conn, room, msg.pid, msg.nick, msg.color);
      case 'removeCpu':
        return this.removeCpu(conn, room, msg.pid);
      case 'saveSettings':
        return this.saveSettings(conn, room, msg.settings);
      case 'act':
        return this.act(conn, room, msg.id, msg.action);
      case 'chat':
        return this.chat(conn, room, msg.text);
      case 'resetRequest':
        return this.resetRequest(conn, room, msg.kind ?? 'reset');
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
      ...this.extras(room),
    });
    if (!wasConnected) this.broadcast(room, [], conn);
  }

  private create(conn: Conn) {
    const code = this.newCode();
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

  private newCode(): string {
    let code = '';
    do {
      code = Array.from(randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    } while (this.rooms.has(code) || this.store.roomExists(code));
    return code;
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

  private join(conn: Conn, room: Room, profileId: string, color: Color) {
    if (conn.pid) return conn.send({ t: 'error', text: 'You already have a seat' });
    const prof = this.store.profileById(profileId);
    if (!prof) return conn.send({ t: 'error', text: 'Pick your name from the list' });
    // Your own seat back (SPEC 4.6, 5.1): the same profile gets its seat if nobody is using it.
    const mine = room.seats.find((s) => !s.cpu && s.profileId === prof.id);
    if (mine) {
      if (this.isConnected(room, mine.pid))
        return conn.send({ t: 'error', text: `${mine.nick}’s seat is in use` });
      const token = randomBytes(24).toString('base64url');
      mine.tokenHash = hashToken(token);
      this.store.tx(() => {
        this.store.saveRoom(room.code, room.seats, room.game?.row.id ?? null);
        this.sys(room, `${mine.nick} is back`);
      });
      conn.pid = mine.pid;
      conn.send({ t: 'seat', room: room.code, pid: mine.pid, token });
      this.broadcast(room, this.takeSys(room));
      return;
    }
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    if (color === 'gray') return conn.send({ t: 'error', text: 'Gray is for CPU players' });
    if (room.seats.length >= 4) return conn.send({ t: 'error', text: 'The table is full' });
    if (room.seats.some((s) => s.color === color))
      return conn.send({ t: 'error', text: 'That color is taken' });
    const token = randomBytes(24).toString('base64url');
    const pid = randomBytes(6).toString('base64url');
    const nick = prof.name;
    room.seats.push({ pid, tokenHash: hashToken(token), nick, color, profileId: prof.id });
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(room, `${nick} sat down`);
    });
    conn.pid = pid;
    conn.send({ t: 'seat', room: room.code, pid, token });
    this.broadcast(room, this.takeSys(room));
  }

  /* ---------- Profiles (SPEC 5.1) ---------- */

  private profileList(): ProfileInfo[] {
    const using = new Set<string>();
    for (const room of this.rooms.values())
      for (const seat of room.seats)
        if (seat.profileId && this.isConnected(room, seat.pid)) using.add(seat.profileId);
    return this.store
      .profiles()
      .map((p) => ({ id: p.id, name: p.name, color: p.color, inUse: using.has(p.id) }));
  }

  private newProfile(conn: Conn, rawName: string, color: Color) {
    const name = cleanNick(rawName);
    if (!name) return conn.send({ t: 'error', text: 'Pick a name' });
    if (color === 'gray') return conn.send({ t: 'error', text: 'Gray is for CPU players' });
    if (this.store.profileByName(name)) return conn.send({ t: 'error', text: `There’s already a ${name}` });
    const p = { id: `p-${randomUUID()}`, name, color, createdAt: this.now() };
    this.store.insertProfile(p);
    this.log(`profile ${name} created`);
    conn.send({ t: 'profile', profile: { id: p.id, name, color, inUse: false } });
    conn.send({ t: 'profiles', list: this.profileList() });
  }

  private mergeProfiles(conn: Conn, from: string, into: string) {
    const a = this.store.profileById(from);
    const b = this.store.profileById(into);
    if (!a || !b || a.id === b.id) return conn.send({ t: 'error', text: 'Pick two different names' });
    if (this.store.sharedGames(a.id, b.id))
      return conn.send({
        t: 'error',
        text: `${a.name} and ${b.name} played in the same game, so they’re different people`,
      });
    for (const room of this.rooms.values())
      if (room.seats.some((st) => st.profileId === a.id && this.isConnected(room, st.pid)))
        return conn.send({ t: 'error', text: `${a.name} is playing right now` });
    this.store.tx(() => {
      this.store.mergeProfiles(a.id, b.id, this.now());
      for (const room of this.rooms.values()) {
        let changed = false;
        for (const st of room.seats)
          if (st.profileId === a.id) {
            st.profileId = b.id;
            changed = true;
          }
        if (changed) this.store.saveRoom(room.code, room.seats, room.game?.row.id ?? null);
      }
    });
    this.settings.delete(a.id);
    this.log(`profile ${a.name} merged into ${b.name}`);
    conn.send({ t: 'notice', kind: 'info', text: `${a.name} is now part of ${b.name}` });
    conn.send({ t: 'profiles', list: this.profileList() });
  }

  /* ---------- Stats (SPEC 5.6) ---------- */

  private statsFor(conn: Conn, who: string) {
    let name: string;
    if (who.startsWith('cpu:')) {
      const level = who.slice(4);
      if (!['easy', 'medium', 'hard'].includes(level))
        return conn.send({ t: 'error', text: 'No such player' });
      name = `${level[0]!.toUpperCase()}${level.slice(1)} CPU`;
    } else {
      const p = this.store.profileById(who);
      if (!p) return conn.send({ t: 'error', text: 'No such player' });
      name = p.name;
    }
    conn.send({ t: 'stats', who, name, record: this.history.recordFor(who) });
  }

  /* ---------- Saved games (SPEC 5.7) ---------- */

  /** Unfinished games, newest first, with their public scores. */
  private savedList(): SavedGame[] {
    const live = new Map<string, Room>();
    for (const room of this.rooms.values()) if (room.game) live.set(room.game.row.id, room);
    const out: SavedGame[] = [];
    for (const row of this.store.allGames()) {
      if (row.endedAt != null) continue;
      const room = live.get(row.id);
      const state = room ? room.game!.state : this.savedState(row);
      if (!state) continue;
      const links = new Map(this.store.gamePlayers(row.id).map((g) => [g.pid, g]));
      out.push({
        id: row.id,
        players: state.players.map((p, i) => {
          const prof = links.get(p.pid)?.profileId;
          return {
            name: (prof && this.store.profileById(prof)?.name) || p.nick,
            color: p.color,
            ...(p.cpu ? { cpu: true } : {}),
            vp: viewFor(state, null).players[i]!.publicVP,
          };
        }),
        lastAt: row.lastAt ?? row.createdAt,
        mode: modeOf(row.config),
        hexes: state.board.hexes.map((h) => ({ t: h.t, n: h.n })),
        room: room?.code ?? null,
      });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt);
  }

  private savedStates = new Map<string, { seq: number; state: GameState }>();
  private savedState(row: GameRow): GameState | null {
    const seq = this.store.lastSeq(row.id);
    const hit = this.savedStates.get(row.id);
    if (hit && hit.seq === seq) return hit.state;
    const { state, problems } = rebuildGame(this.store, row, this.log);
    if (problems.length) this.log(`saved game ${row.id}: ${problems.join('; ')}`);
    this.savedStates.set(row.id, { seq, state });
    return state;
  }

  /** Open a saved game in a fresh room; everyone picks their profile to get their seat. */
  private resume(conn: Conn, gameId: string) {
    const row = this.store.loadGame(gameId);
    if (!row || row.endedAt != null) return conn.send({ t: 'error', text: 'That game isn’t saved any more' });
    for (const room of this.rooms.values())
      if (room.game?.row.id === gameId) return this.attach(conn, room, null);
    const { state, actions, problems, fold } = rebuildGame(this.store, row, this.log);
    if (problems.length) this.log(`resume ${row.id}: ${problems.join('; ')}`);
    const links = new Map(this.store.gamePlayers(row.id).map((g) => [g.pid, g]));
    const code = this.newCode();
    const seats: SeatRow[] = row.players.map((p) => ({
      pid: p.pid,
      // No token matches until someone sits down as this profile.
      tokenHash: '',
      nick:
        (links.get(p.pid)?.profileId && this.store.profileById(links.get(p.pid)!.profileId!)?.name) || p.nick,
      color: p.color,
      ...(p.cpu ? { cpu: true as const, level: (links.get(p.pid)?.cpuLevel ?? 'easy') as CpuLevel } : {}),
      ...(links.get(p.pid)?.profileId ? { profileId: links.get(p.pid)!.profileId! } : {}),
    }));
    const room: Room = {
      code,
      createdAt: this.now(),
      seats,
      game: {
        row,
        state,
        clientIds: new Set(actions.map((a) => a.clientId)),
        events: actions.flatMap((a) => a.events.map((e) => ({ seq: a.seq, at: a.at, e }))).slice(-LOG_EVENTS),
        fold,
      },
      pendingReset: null,
      conns: new Set(),
      options: optionsFor(row.config),
    };
    this.store.tx(() => {
      this.store.insertRoom({
        code,
        createdAt: room.createdAt,
        seats,
        gameId: row.id,
        options: room.options,
      });
      this.store.saveRoom(code, seats, row.id);
      this.store.saveOptions(code, room.options);
      this.store.setGameRoom(row.id, code);
      this.sys(room, 'The game was resumed');
    });
    this.rooms.set(code, room);
    this.log(`room ${code} resumed game ${row.id}`);
    this.attach(conn, room, null);
    this.pendingSys.delete(room);
    this.scheduleCpu(room);
  }

  private deleteSaved(conn: Conn, gameId: string) {
    const row = this.store.loadGame(gameId);
    if (!row || row.endedAt != null)
      return conn.send({ t: 'error', text: 'Only unfinished games can be deleted' });
    for (const room of this.rooms.values()) {
      if (room.game?.row.id !== gameId) continue;
      if (room.seats.some((st) => !st.cpu && this.isConnected(room, st.pid)))
        return conn.send({ t: 'error', text: 'Someone is playing it right now' });
      this.closeRoom(room, 'This game was deleted');
    }
    this.store.endGame(gameId, 'deleted', this.now());
    this.log(`saved game ${gameId} deleted`);
    conn.send({ t: 'saved', list: this.savedList() });
  }

  /** Close a room: its game stays saved (unless it's over); everyone goes back to the start. */
  private closeRoom(room: Room, text: string) {
    if (room.cpuTimer != null)
      (this.opts.clearTimer ?? clearTimeout)(room.cpuTimer as ReturnType<typeof setTimeout>);
    room.cpuTimer = undefined;
    this.store.closeRoom(room.code, this.now());
    this.rooms.delete(room.code);
    for (const c of room.conns) {
      c.send({ t: 'closed', text });
      c.room = null;
      c.pid = null;
    }
    room.conns.clear();
    this.log(`room ${room.code} closed`);
  }

  private setCpuChat(conn: Conn, room: Room, on: boolean) {
    const seat = room.seats.find((st) => st.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Take a seat first' });
    room.options = { ...room.options, cpuChat: on };
    this.store.saveOptions(room.code, room.options);
    this.sys(room, `${seat.nick} turned CPU chatter ${on ? 'on' : 'off'}`);
    this.broadcast(room, this.takeSys(room));
  }

  private setColor(conn: Conn, room: Room, color: Color) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    if (color === 'gray' && !seat.cpu) return conn.send({ t: 'error', text: 'Gray is for CPU players' });
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

  /* ---------- CPU seats (docs/bot.md) ---------- */

  private addCpu(conn: Conn, room: Room) {
    if (!room.seats.some((s) => s.pid === conn.pid))
      return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    if (room.seats.length >= 4) return conn.send({ t: 'error', text: 'The table is full' });
    const taken = new Set(room.seats.map((s) => s.color));
    const color = taken.has('gray') ? COLORS.find((c) => !taken.has(c))! : 'gray';
    let n = 1;
    while (room.seats.some((s) => s.nick === `CPU ${n}`)) n++;
    const seat: SeatRow = {
      pid: `cpu-${randomBytes(6).toString('base64url')}`,
      tokenHash: 'cpu',
      nick: `CPU ${n}`,
      color,
      cpu: true,
      level: 'easy',
    };
    room.seats.push(seat);
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(room, `${seat.nick} (CPU) sat down`);
    });
    this.broadcast(room, this.takeSys(room));
  }

  private cpuSeat(conn: Conn, room: Room, pid: string): SeatRow | null {
    const seat = room.seats.find((s) => s.pid === pid && s.cpu);
    if (!seat) {
      conn.send({ t: 'error', text: 'That isn’t a CPU player' });
      return null;
    }
    if (room.game) {
      conn.send({ t: 'error', text: 'The game has already started' });
      return null;
    }
    return seat;
  }

  private editCpu(conn: Conn, room: Room, pid: string, rawNick?: string, color?: Color) {
    const seat = this.cpuSeat(conn, room, pid);
    if (!seat) return;
    if (color && room.seats.some((s) => s.color === color && s !== seat))
      return conn.send({ t: 'error', text: 'That color is taken' });
    if (rawNick != null) {
      const nick = cleanNick(rawNick);
      if (!nick) return conn.send({ t: 'error', text: 'Pick a name' });
      seat.nick = nick;
    }
    if (color) seat.color = color;
    this.store.saveRoom(room.code, room.seats, null);
    this.broadcast(room, []);
  }

  private removeCpu(conn: Conn, room: Room, pid: string) {
    const seat = this.cpuSeat(conn, room, pid);
    if (!seat) return;
    room.seats = room.seats.filter((s) => s !== seat);
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(room, `${seat.nick} (CPU) left`);
    });
    this.broadcast(room, this.takeSys(room));
  }

  private saveSettings(conn: Conn, room: Room, settings: PlayerSettings) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat?.profileId) return conn.send({ t: 'error', text: 'Take a seat first' });
    this.store.saveProfileSettings(seat.profileId, settings, this.now());
    this.settings.set(seat.profileId, settings);
    // Only you see your settings, on every device you're using.
    for (const c of room.conns)
      if (c.pid === seat.pid)
        c.send({ t: 'update', room: this.roomInfo(room, c), game: this.viewOf(room, c), log: [] });
  }

  /** Settings by profile, read from the database once. */
  private settings = new Map<string, PlayerSettings>();
  private settingsOf(profileId: string): PlayerSettings {
    let s = this.settings.get(profileId);
    if (!s) {
      const parsed = SettingsSchema.safeParse(this.store.getProfileSettings(profileId));
      s = parsed.success ? parsed.data : {};
      this.settings.set(profileId, s);
    }
    return s;
  }

  /** If a CPU has something to do, make its move after a short pause. */
  private scheduleCpu(room: Room) {
    const g = room.game;
    if (!g || g.state.phase !== 'play' || room.cpuTimer != null) return;
    if (!g.state.players.some((p) => p.cpu)) return;
    const next = this.cpuNext(room, true);
    if (!next) return;
    // When the dice could still be handed back to a person, give them a moment to ask first.
    const s = g.state;
    const askable = !!s.back && !s.back.asked && !s.players[s.back.from]!.cpu && !!s.players[s.turn]!.cpu;
    const delay = this.opts.cpuDelay ? this.opts.cpuDelay() : askable ? 4000 : 1000 + Math.random() * 1000;
    room.cpuTimer = (this.opts.setTimer ?? setTimeout)(() => {
      room.cpuTimer = undefined;
      this.cpuStep(room);
    }, delay);
  }

  /** The next CPU move: [seat, action]. With `peek`, its memory is left untouched. */
  private cpuNext(room: Room, peek: boolean): [number, Action] | null {
    const g = room.game!;
    const memos = (room.cpuMemo ??= new Map());
    for (let seat = 0; seat < g.state.players.length; seat++) {
      const pl = g.state.players[seat]!;
      if (!pl.cpu) continue;
      if (!memos.has(pl.pid)) memos.set(pl.pid, newCpuMemo());
      const memo = peek ? { ...memos.get(pl.pid)! } : memos.get(pl.pid)!;
      const a = cpuMove(viewFor(g.state, seat), seedRng(`${g.row.id}:${g.state.seq}:${seat}`), memo);
      if (a) return [seat, a];
    }
    return null;
  }

  private cpuStep(room: Room) {
    if (!room.game || room.game.state.phase !== 'play') return;
    const next = this.cpuNext(room, false);
    if (!next) return;
    const [seat, action] = next;
    const pl = room.game.state.players[seat]!;
    const r = this.commit(room, seat, pl.pid, `cpu:${room.game.state.seq}:${seat}`, action);
    // A rejected CPU move is a bug in the CPU; stop rather than retry forever.
    if (!r.ok)
      return this.log(
        `room ${room.code}: CPU ${pl.nick} move rejected: ${JSON.stringify(action)} -> ${r.error}`,
      );
    this.scheduleCpu(room);
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
    if (room.seats.every((s) => s.cpu))
      return conn.send({ t: 'error', text: 'At least one person must play' });
    const map = SCENARIOS[room.options.scenario]!;
    const allowed = playersFor(room.options);
    if (!allowed.includes(room.seats.length)) {
      const name = room.options.ck ? `${map.name} with Cities & Knights` : map.name;
      return conn.send({ t: 'error', text: `${name} needs ${allowed.join(' or ')} players` });
    }
    const players: NewPlayer[] = room.seats.map((s) => ({
      pid: s.pid,
      color: s.color,
      nick: s.nick,
      ...(s.cpu ? { cpu: true } : {}),
    }));
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
      for (const st of room.seats)
        this.store.linkSeat(
          row.id,
          st.pid,
          st.cpu ? null : (st.profileId ?? null),
          st.cpu ? (st.level ?? 'easy') : null,
        );
      this.store.saveRoom(room.code, room.seats, row.id);
      this.sys(room, 'The game started');
    });
    room.game = { row, state, clientIds: new Set(), events: [], fold: new StatsFold(state) };
    room.chatter = new Map();
    room.pendingReset = null;
    room.cpuMemo = new Map();
    this.log(`room ${room.code} game ${row.id} started with ${players.length} players`);
    this.broadcast(room, this.takeSys(room));
    this.scheduleCpu(room);
  }

  private act(conn: Conn, room: Room, id: string, action: Action) {
    const g = room.game;
    if (!g) return conn.send({ t: 'ack', id, ok: false, error: 'The game has not started yet' });
    if (g.clientIds.has(id)) return conn.send({ t: 'ack', id, ok: true }); // a resend of a move we already applied
    const seat = g.state.players.findIndex((p) => p.pid === conn.pid);
    if (seat < 0) return conn.send({ t: 'ack', id, ok: false, error: 'You are watching this game' });
    const r = this.commit(room, seat, conn.pid!, id, action);
    if (!r.ok) return conn.send({ t: 'ack', id, ok: false, error: r.error });
    conn.send({ t: 'ack', id, ok: true });
    this.scheduleCpu(room);
  }

  /** Apply, save, then broadcast one move. */
  private commit(
    room: Room,
    seat: number,
    pid: string,
    id: string,
    action: Action,
  ): { ok: boolean; error?: string } {
    const g = room.game!;
    // Rolls get the server's dice (SPEC 5.3); they're saved with the move, so replays use them.
    if (action.type === 'roll') action = { type: 'roll', dice: diceForRoll() };
    let r = applyAction(g.state, seat, action);
    for (let pairs = 16; !r.ok && r.error === NEED_DICE && pairs <= 64; pairs *= 2) {
      action = { type: 'roll', dice: diceForRoll(pairs) };
      r = applyAction(g.state, seat, action);
    }
    if (!r.ok) return { ok: false, error: r.error };
    const at = this.now();
    const over = r.state.phase === 'over';
    // Persist first. If this throws, nothing changes in memory and nobody hears about the move.
    this.store.tx(() => {
      this.store.insertAction(g.row.id, {
        seq: r.state.seq,
        pid,
        seat,
        clientId: id,
        action,
        events: r.events,
        at,
      });
      if (over || r.state.seq % this.snapshotEvery === 0) this.store.insertSnapshot(g.row.id, r.state);
      if (over) this.store.endGame(g.row.id, 'won', at);
    });
    const prev = g.state;
    g.state = r.state;
    g.clientIds.add(id);
    if (g.fold) {
      try {
        g.fold.step(prev, seat, action, r.events, r.state);
      } catch (e) {
        this.log(`room ${room.code}: stats stopped: ${String(e)}`);
        g.fold = null;
      }
    }
    if (over && g.fold) this.store.saveStats(g.row.id, ENGINE_VERSION, r.state.seq, g.fold.st);
    // A rule changed mid-game also becomes the room's option for the next game.
    for (const e of r.events) if (e.k === 'rule') this.optionFromRule(room, e.rule, e.value);
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
    this.chatter(room, r.events);
    return { ok: true };
  }

  /** Now and then a CPU says something in table talk (SPEC 5.14): at most once per turn. */
  private chatter(room: Room, events: GameEvent[]) {
    const g = room.game;
    if (!g || room.options.cpuChat === false || g.state.phase !== 'play') return;
    const said = (room.chatter ??= new Map());
    const random = this.opts.chatRandom ?? Math.random;
    g.state.players.forEach((pl, seat) => {
      if (!pl.cpu) return;
      const mine = said.get(pl.pid) ?? { turn: -1, robbed: 0 };
      const robbed = events.some((e) => e.k === 'steal' && e.from === seat);
      if (mine.turn !== g.state.turnN) {
        const level = room.seats.find((st) => st.pid === pl.pid)?.level ?? 'easy';
        const rng = seedRng(String(random()));
        const line = cpuChat(viewFor(g.state, seat), eventsFor(events, seat), level, rng, mine.robbed);
        if (line) {
          mine.turn = g.state.turnN;
          const row = this.store.insertChat({
            roomCode: room.code,
            pid: pl.pid,
            nick: pl.nick,
            text: line.text,
            at: this.now(),
          });
          this.broadcast(room, [chatItem(row)]);
        }
      }
      if (robbed) mine.robbed++;
      said.set(pl.pid, mine);
    });
  }

  private optionFromRule(room: Room, rule: string, value: boolean | number) {
    const o = structuredClone(room.options);
    if (rule === 'winVP') o.winVP = value as number;
    else (o.houseRules as Record<string, unknown>)[rule] = rule === 'handBack' ? value : value || undefined;
    const parsed = OptionsSchema.safeParse(JSON.parse(JSON.stringify(o)));
    if (!parsed.success) return;
    room.options = parsed.data;
    this.store.saveOptions(room.code, room.options);
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

  private resetRequest(conn: Conn, room: Room, kind: 'reset' | 'quit') {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Only players can start a new game' });
    if (!room.game) return conn.send({ t: 'error', text: 'There’s no game to end' });
    if (room.game.state.phase === 'over') return this.endCurrentGame(room, seat, 'new game after finish');
    room.pendingReset = { pid: seat.pid, expiresAt: this.now() + RESET_WINDOW_MS, kind };
    const what =
      kind === 'quit' ? 'save this game and stop for tonight' : 'end this game and start a new one';
    this.sys(room, `${seat.nick} wants to ${what}`);
    for (const c of room.conns) {
      if (c !== conn)
        c.send({
          t: 'notice',
          kind: 'warn',
          text: `${seat.nick} wants to ${what}. Cancel it if that’s a mistake.`,
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
    if (p.kind === 'quit') {
      this.store.tx(() => this.sys(room, `${seat.nick} saved the game for later`));
      return this.closeRoom(room, 'The game is saved. Resume it from Saved Games any time.');
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
    if (seat.cpu) return conn.send({ t: 'error', text: 'That’s a CPU player' });
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
        ...(s.cpu ? { cpu: true, level: s.level ?? 'easy' } : {}),
        ...(s.profileId ? { profile: s.profileId } : {}),
      })),
      me: conn.pid,
      phase: room.game ? room.game.state.phase : 'lobby',
      options: room.options,
      mySettings: (() => {
        const seat = room.seats.find((s) => s.pid === conn.pid);
        return seat?.profileId ? this.settingsOf(seat.profileId) : null;
      })(),
      pendingReset: pr
        ? {
            pid: pr.pid,
            nick: room.seats.find((s) => s.pid === pr.pid)?.nick ?? '',
            expiresAt: pr.expiresAt,
            kind: pr.kind,
          }
        : null,
      myProfile: room.seats.find((s) => s.pid === conn.pid)?.profileId ?? null,
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
    const extras = this.extras(room);
    for (const c of room.conns) {
      if (c === skip) continue;
      c.send({
        t: 'update',
        room: this.roomInfo(room, c),
        game: this.viewOf(room, c),
        log: this.redact(items, this.seatOf(room, c)),
        ...extras,
      });
    }
  }

  /** Public dice stats during a game; the full stats once it's over (SPEC 5.4, 5.5). */
  private extras(room: Room): { dice?: DiceInfo; stats?: GameStats } {
    const st = room.game?.fold?.st;
    if (!st) return {};
    const gap = new Array<number>(13).fill(st.rollLog.length);
    st.rollLog.forEach((x, i) => (gap[x.t] = st.rollLog.length - 1 - i));
    const dice: DiceInfo = {
      dice: st.dice,
      gap,
      rolls: st.players.map((p) => p.rolls),
      events: st.events,
      chosen: st.chosen,
    };
    return room.game!.state.phase === 'over' ? { dice, stats: st } : { dice };
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
  if (o.houseRules.handBack !== false) hr.handBack = true;
  if (o.houseRules.handBackSetup) hr.handBackSetup = true;
  if (o.houseRules.undo !== false) hr.undo = true;
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

/** Room options matching a game's config (for a resumed game's room). */
export function optionsFor(c: Partial<GameConfig>): RoomOptions {
  const scenario = c.map && c.map.id !== 'classic' ? (c.map.id as RoomOptions['scenario']) : 'classic';
  const hr = c.houseRules ?? {};
  const o: RoomOptions = {
    scenario: SCENARIOS[scenario] ? scenario : 'classic',
    winVP: c.winVP ?? 10,
    houseRules: { ...hr, handBack: !!hr.handBack, undo: !!hr.undo },
  };
  if (c.modules?.includes('citiesKnights')) o.ck = true;
  const parsed = OptionsSchema.safeParse(JSON.parse(JSON.stringify(o)));
  return parsed.success ? parsed.data : structuredClone(DEFAULT_OPTIONS);
}

/** Player counts a room's options allow. */
export function playersFor(o: RoomOptions): number[] {
  const map = SCENARIOS[o.scenario]!;
  return o.ck ? map.players.filter((n) => n >= 3) : map.players;
}

function chatItem(r: ChatRow): LogItem {
  return r.pid === 'sys'
    ? { k: 'sys', id: r.id, at: r.at, text: r.text }
    : {
        k: 'chat',
        id: r.id,
        at: r.at,
        pid: r.pid,
        nick: r.nick,
        text: r.text,
        ...(r.pid.startsWith('cpu-') ? { cpu: true } : {}),
      };
}

/** Stable order for log items with the same timestamp. */
function order(it: LogItem): number {
  return it.k === 'ev' ? it.seq : it.id;
}
