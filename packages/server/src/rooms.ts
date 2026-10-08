/*
 * Rooms, seats and games. The server is the authority: every move is checked by the engine,
 * saved to SQLite, and only then broadcast. Each connection only ever receives viewFor() of
 * its own seat and events redacted for that seat.
 */

import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  ENGINE_VERSION,
  NEED_DICE,
  SCENARIOS,
  type GameConfig,
  type HouseRules, applyAction, checkInvariants, cpuMove, eventsFor, newCpuMemo, newGame, seedRng, viewFor,
  COLORS, type CpuMemo, StatsFold, cpuChat, type CpuLevel, type GameStats, cpuObserve, cloneJson, type CpuBrain,
  type CpuOptions,
  type Action, type Color, type GameEvent, type GameState, type NewPlayer, type PlayerView, type MapData,
  ANYTHING_GOES, type GenRules, type EditOp, OUR_RULES, scenarioMap, isLogNote, logNotes, type LogNote,
} from '@settlers/engine'; // prettier-ignore
import { History, modeOf } from './history';
import { MapLibrary } from './maps';
import { CpuLibrary, LEVEL_NAME, brainOf, isLevel } from './cpus';
import {
  HISTORY,
  STANDARD_FILL,
  describeEdit,
  editBoard,
  fillBoard,
  newSeed,
  newTable,
  resetFirst,
  rollFor,
  syncCircle,
  turnOrder,
  type BoardSource,
  type TableBoard,
  type Luck,
  type TableState,
} from './table';
import {
  DEFAULT_OPTIONS,
  FULL_GAME_OPTIONS,
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
  type TableInfo,
  type TableOp,
} from './protocol';
import { emptyMusic, isMusic, musicOp, type MusicOp, type MusicState } from './music';
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
  events: LogEntry[];
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
  /** A CPU waiting for answers to its offer: when it stops waiting. */
  cpuWait?: unknown;
  /** What each CPU remembers within a turn, by pid. */
  cpuMemo?: Map<string, CpuMemo>;
  /** CPU chatter: the turn each CPU last spoke, and how often it's been robbed (by pid). */
  chatter?: Map<string, { turn: number; robbed: number }>;
  /** The pre-game table and the board showing on it (docs/pregame.md). */
  table?: { state: TableState; board: TableBoard };
  /** The table as saved, until it's first needed. */
  savedTable?: unknown;
  /** Table music (SPEC 12), once anyone has added some. */
  music?: MusicState;
}

export interface RoomsOptions {
  now?: () => number;
  /** Write a full snapshot every N actions. */
  snapshotEvery?: number;
  /** Override game config (tests only). */
  gameConfig?: { winVP?: number };
  log?: (msg: string) => void;
  /** How long a CPU waits before each move, in ms (default 1–3 s). */
  cpuDelay?: () => number;
  /** How long a CPU waits for answers to its offer, in ms (default 20 s). */
  cpuOfferWait?: number;
  /** Timers for CPU moves (tests use a fake clock). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Random numbers for CPU chatter (tests make it predictable). */
  chatRandom?: () => number;
  /** Dice and picks for who goes first at the table (tests rig them). */
  luck?: Luck;
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

/** A game log entry: an event, or a note worked out from the state after its move. */
type LogEntry = { seq: number; at: number; e: GameEvent | LogNote };

/** A move's log entries: its events, then the notes about them (SPEC 8.10). */
const entriesOf = (seq: number, at: number, s: GameState, events: GameEvent[]): LogEntry[] =>
  [...events, ...logNotes(s, events)].map((e) => ({ seq, at, e }));

/**
 * Rebuild a game from its seed and action log, checking it matches what was saved. `events` is
 * the game's log, with notes worked out on the way (saved actions keep only their events).
 */
export function rebuildGame(
  store: Store,
  row: GameRow,
  log: (m: string) => void,
): {
  state: GameState;
  actions: ActionRow[];
  problems: string[];
  fold: StatsFold | null;
  events: LogEntry[];
} {
  const actions = store.loadActions(row.id);
  const problems: string[] = [];
  let s = newGame(row.seed, row.players, row.config);
  let fold: StatsFold | null = new StatsFold(s);
  let events: LogEntry[] = [];
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
    events.push(...entriesOf(a.seq, a.at, r.state, r.events));
    if (events.length > LOG_EVENTS * 2) events = events.slice(-LOG_EVENTS);
    s = r.state;
  }
  if (problems.length) {
    fold = null;
    // Replay broke: the log is the saved events, without notes.
    events = actions.flatMap((a) => a.events.map((e) => ({ seq: a.seq, at: a.at, e })));
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
  return { state: s, actions, problems, fold, events: events.slice(-LOG_EVENTS) };
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private now: () => number;
  private snapshotEvery: number;
  private log: (m: string) => void;
  private history: History;
  readonly maps: MapLibrary;
  readonly cpuLib: CpuLibrary;

  constructor(
    private store: Store,
    private opts: RoomsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.snapshotEvery = opts.snapshotEvery ?? 25;
    this.log = opts.log ?? ((m) => console.log(m));
    this.history = new History(store);
    this.maps = new MapLibrary(store, this.now, this.log);
    this.cpuLib = new CpuLibrary(store, this.now);
    this.loadAll();
    for (const room of this.rooms.values()) this.scheduleCpu(room);
  }

  private stopped = false;
  /** Cancel pending CPU moves and stop sending updates (shutdown, tests). */
  stop() {
    this.stopped = true;
    for (const room of this.rooms.values()) this.clearCpuTimers(room);
  }

  private clearCpuTimers(room: Room) {
    for (const k of ['cpuTimer', 'cpuWait'] as const) {
      if (room[k] != null) (this.opts.clearTimer ?? clearTimeout)(room[k] as ReturnType<typeof setTimeout>);
      room[k] = undefined;
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
        ...(r.table ? { savedTable: r.table } : {}),
        ...(isMusic(r.music) ? { music: r.music } : {}),
      };
      if (r.gameId) {
        const row = this.store.loadGame(r.gameId);
        if (row) {
          const { state, actions, problems, fold, events } = rebuildGame(this.store, row, this.log);
          if (problems.length) this.log(`room ${r.code} game ${row.id}: ${problems.join('; ')}`);
          room.game = {
            row,
            state,
            clientIds: new Set(actions.map((a) => a.clientId)),
            events,
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
      case 'clientError':
        return this.clientError(conn, msg);
      case 'create':
        return this.create(conn, !!msg.full);
      case 'hello':
        return this.hello(conn, msg.room, msg.token);
      case 'profiles':
        return conn.send({ t: 'profiles', list: this.profileList() });
      case 'newProfile':
        return this.newProfile(conn, msg.name, msg.color);
      case 'mergeProfiles':
        return this.mergeProfiles(conn, msg.from, msg.into);
      case 'deleteProfile':
        return this.deleteProfile(conn, msg.id);
      case 'saved':
        return conn.send({ t: 'saved', list: this.savedList() });
      case 'resume':
        return this.resume(conn, msg.game);
      case 'deleteSaved':
        return this.deleteSaved(conn, msg.game);
      case 'stats':
        return this.statsFor(conn, msg.who);
      case 'maps':
        return conn.send({ t: 'maps', list: this.maps.list() });
      case 'getMap':
        return this.maps.get(conn, msg.id);
      case 'saveMap':
        return this.maps.save(conn, msg.map as MapData, msg.by);
      case 'importMap':
        return this.maps.import(conn, msg.map as MapData, msg.by);
      case 'renameMap':
        return this.maps.rename(conn, msg.id, msg.name);
      case 'duplicateMap':
        return this.maps.duplicate(conn, msg.id, msg.by);
      case 'deleteMap':
        return this.maps.delete(conn, msg.id);
      case 'presets':
        return conn.send({ t: 'presets', list: this.maps.presets() });
      case 'savePreset':
        return this.maps.savePreset(conn, msg.id, msg.name, msg.rules as GenRules, msg.by);
      case 'deletePreset':
        return this.maps.deletePreset(conn, msg.id);
      case 'cpus':
        return conn.send({ t: 'cpus', list: this.cpuLib.list() });
      case 'saveCpu':
        if (this.cpuLib.save(conn, msg.id, msg.name, msg.persona, msg.by))
          conn.send({ t: 'cpus', list: this.cpuLib.list() });
        return;
      case 'deleteCpu':
        if (this.cpuLib.delete(conn, msg.id)) conn.send({ t: 'cpus', list: this.cpuLib.list() });
        return;
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
        return this.join(conn, room, msg.profile, msg.color, msg.move === true);
      case 'setCpuChat':
        return this.setCpuChat(conn, room, msg.on);
      case 'table':
        return this.tableOp(conn, room, msg.op);
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
        return this.editCpu(conn, room, msg.pid, msg.nick, msg.color, msg.level);
      case 'removeCpu':
        return this.removeCpu(conn, room, msg.pid);
      case 'saveSettings':
        return this.saveSettings(conn, room, msg.settings);
      case 'act':
        return this.act(conn, room, msg.id, msg.action);
      case 'chat':
        return this.chat(conn, room, msg.text);
      case 'music':
        return this.music(conn, room, msg.op);
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

  private create(conn: Conn, full = false) {
    const code = this.newCode();
    const room: Room = {
      code,
      createdAt: this.now(),
      seats: [],
      game: null,
      pendingReset: null,
      conns: new Set(),
      options: structuredClone(full ? FULL_GAME_OPTIONS : DEFAULT_OPTIONS),
    };
    this.store.tx(() => {
      this.store.insertRoom({ code, createdAt: room.createdAt, seats: [], gameId: null, options: null });
      if (full) this.store.saveOptions(code, room.options);
    });
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

  private join(conn: Conn, room: Room, profileId: string, color: Color, move = false) {
    if (conn.pid) return conn.send({ t: 'error', text: 'You already have a seat' });
    const prof = this.store.profileById(profileId);
    if (!prof) return conn.send({ t: 'error', text: 'Pick your name from the list' });
    // Your own seat back (SPEC 4.6, 5.1). If another screen still has it (a second tab, a page
    // left open, a phone that dropped off without saying), it moves here once you confirm.
    const mine = room.seats.find((s) => !s.cpu && s.profileId === prof.id);
    if (mine) {
      const elsewhere = [...room.conns].filter((c) => c !== conn && c.pid === mine.pid);
      if (elsewhere.length && !move)
        return conn.send({ t: 'error', text: `${mine.nick}’s seat is in use on another screen` });
      for (const c of elsewhere) {
        c.pid = null;
        c.send({ t: 'error', text: 'Your seat moved to another screen' });
      }
      const token = randomBytes(24).toString('base64url');
      mine.tokenHash = hashToken(token);
      this.store.tx(() => {
        this.store.saveRoom(room.code, room.seats, room.game?.row.id ?? null);
        this.sys(room, elsewhere.length ? `${mine.nick} moved to another screen` : `${mine.nick} is back`);
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
      this.seatsChanged(room);
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

  /**
   * Take a person off the list. Their games keep their name; their stats go. Not while they're
   * connected to a table. Tables they left behind let them go: a seat at a table that hasn't
   * started is taken away, and a seat in a game stays under their name with no profile, so anyone
   * can take it over.
   */
  private deleteProfile(conn: Conn, id: string) {
    const p = this.store.profileById(id);
    if (!p) return conn.send({ t: 'error', text: 'No such player' });
    const left: Room[] = [];
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((st) => st.profileId === p.id);
      if (!seat) continue;
      if (this.isConnected(room, seat.pid))
        return conn.send({ t: 'error', text: `${p.name} is playing right now in room ${room.code}` });
      left.push(room);
    }
    this.store.tx(() => {
      for (const room of left) {
        const seat = room.seats.find((st) => st.profileId === p.id)!;
        if (room.game) delete seat.profileId;
        else {
          room.seats = room.seats.filter((st) => st !== seat);
          for (const c of room.conns) if (c.pid === seat.pid) c.pid = null;
          this.sys(room, `${seat.nick} stood up`);
          this.seatsChanged(room);
        }
        this.store.saveRoom(room.code, room.seats, room.game?.row.id ?? null);
      }
      this.store.deleteProfile(p.id, this.now());
    });
    for (const room of left) this.broadcast(room, this.takeSys(room));
    this.settings.delete(p.id);
    this.log(`profile ${p.name} deleted${left.length ? `, off ${left.length} tables` : ''}`);
    const off = left.length ? ` and taken off ${left.length} table${left.length > 1 ? 's' : ''}` : '';
    conn.send({ t: 'notice', kind: 'info', text: `${p.name} was deleted${off}` });
    conn.send({ t: 'profiles', list: this.profileList() });
  }

  /* ---------- Stats (SPEC 5.6) ---------- */

  private statsFor(conn: Conn, who: string) {
    let name: string;
    if (who.startsWith('cpu:')) {
      // A built-in level, or a custom CPU (its record keeps its name even once deleted).
      const level = who.slice(4);
      const custom = isLevel(level) ? null : this.store.cpuById(level);
      if (!isLevel(level) && !custom) return conn.send({ t: 'error', text: 'No such player' });
      name = isLevel(level) ? `${LEVEL_NAME[level]} CPU` : `${custom!.name} (CPU)`;
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
        hexes: state.board.hexes.map((h) => ({ q: h.q, r: h.r, t: h.t, n: h.n })),
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
    const { state, actions, problems, fold, events } = rebuildGame(this.store, row, this.log);
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
      ...(p.cpu ? this.cpuSeatFrom(links.get(p.pid)?.cpuLevel ?? 'easy') : {}),
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
        events,
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
    this.clearCpuTimers(room);
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
      this.seatsChanged(room);
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
      this.seatsChanged(room);
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

  private editCpu(conn: Conn, room: Room, pid: string, rawNick?: string, color?: Color, level?: string) {
    const seat = this.cpuSeat(conn, room, pid);
    if (!seat) return;
    if (color && room.seats.some((s) => s.color === color && s !== seat))
      return conn.send({ t: 'error', text: 'That color is taken' });
    let nick: string | null = null;
    if (rawNick != null) {
      nick = cleanNick(rawNick);
      if (!nick) return conn.send({ t: 'error', text: 'Pick a name' });
    }
    // A custom CPU's personality is copied onto the seat, so later edits don't change it.
    const custom = level && !isLevel(level) ? this.cpuLib.get(level) : null;
    if (level && !isLevel(level) && !custom) return conn.send({ t: 'error', text: 'That CPU is gone' });
    if (nick) seat.nick = nick;
    if (color) seat.color = color;
    const changed = level != null && level !== (seat.level ?? 'easy');
    if (level) {
      seat.level = level;
      if (custom) seat.persona = custom.persona;
      else delete seat.persona;
    }
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      if (changed) this.sys(room, `${seat.nick} now plays as ${this.levelName(seat)}`);
    });
    this.broadcast(room, this.takeSys(room));
  }

  /** A resumed game's CPU seat: its level, and a custom CPU's personality as saved now (Medium if gone). */
  private cpuSeatFrom(level: string): Pick<SeatRow, 'cpu' | 'level' | 'persona'> {
    if (isLevel(level)) return { cpu: true, level };
    const c = this.store.cpuById(level);
    return c ? { cpu: true, level, persona: c.persona } : { cpu: true, level: 'medium' };
  }

  /** A CPU seat's level as shown in its tag: Easy, Medium, Hard or the custom CPU's name. */
  private levelName(seat: { level?: string }): string {
    const l = seat.level ?? 'easy';
    if (isLevel(l)) return LEVEL_NAME[l];
    return this.store.cpuById(l)?.name ?? 'Custom';
  }

  /** What plays a CPU seat (docs/bot-medium-hard.md). */
  private brainFor(room: Room, pid: string): CpuBrain {
    const seat = room.seats.find((st) => st.pid === pid);
    return brainOf(seat?.level, seat?.persona);
  }

  /** The room's CPU trading settings (docs/bot-medium-hard.md §1.2, D4). */
  private cpuOptions(room: Room, offerTimeout = false): CpuOptions {
    return {
      trading: room.options.cpuTrading !== false,
      oneOffer: room.options.cpuOneOffer !== false,
      ...(offerTimeout ? { offerTimeout: true } : {}),
    };
  }

  private removeCpu(conn: Conn, room: Room, pid: string) {
    const seat = this.cpuSeat(conn, room, pid);
    if (!seat) return;
    room.seats = room.seats.filter((s) => s !== seat);
    this.store.tx(() => {
      this.store.saveRoom(room.code, room.seats, null);
      this.sys(room, `${seat.nick} (CPU) left`);
      this.seatsChanged(room);
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
    // Anything that happens ends a CPU's wait for answers; it looks again.
    if (room.cpuWait != null) {
      (this.opts.clearTimer ?? clearTimeout)(room.cpuWait as ReturnType<typeof setTimeout>);
      room.cpuWait = undefined;
    }
    if (!g || g.state.phase !== 'play' || room.cpuTimer != null) return;
    if (!g.state.players.some((p) => p.cpu)) return;
    const next = this.cpuNext(room, true);
    const s = g.state;
    if (!next) {
      // A CPU's own offer waiting on people: after a while it takes what it has, or withdraws it.
      if (s.players[s.turn]!.cpu && s.offers.some((o) => o.from === s.turn))
        room.cpuWait = (this.opts.setTimer ?? setTimeout)(() => {
          room.cpuWait = undefined;
          this.cpuStep(room, true);
        }, this.opts.cpuOfferWait ?? 20_000);
      return;
    }
    // When the dice could still be handed back to a person, give them a moment to ask first.
    const askable = !!s.back && !s.back.asked && !s.players[s.back.from]!.cpu && !!s.players[s.turn]!.cpu;
    const delay = this.opts.cpuDelay ? this.opts.cpuDelay() : askable ? 4000 : 1000 + Math.random() * 2000;
    room.cpuTimer = (this.opts.setTimer ?? setTimeout)(() => {
      room.cpuTimer = undefined;
      this.cpuStep(room);
    }, delay);
  }

  /** The next CPU move: [seat, action]. With `peek`, its memory is left untouched. */
  private cpuNext(room: Room, peek: boolean, offerTimeout = false): [number, Action] | null {
    const g = room.game!;
    const memos = (room.cpuMemo ??= new Map());
    for (let seat = 0; seat < g.state.players.length; seat++) {
      const pl = g.state.players[seat]!;
      if (!pl.cpu) continue;
      if (!memos.has(pl.pid)) memos.set(pl.pid, newCpuMemo());
      const memo = peek ? cloneJson(memos.get(pl.pid)!) : memos.get(pl.pid)!;
      const a = cpuMove(
        viewFor(g.state, seat),
        seedRng(`${g.row.id}:${g.state.seq}:${seat}`),
        memo,
        this.brainFor(room, pl.pid),
        this.cpuOptions(room, offerTimeout && seat === g.state.turn),
      );
      if (a) return [seat, a];
    }
    return null;
  }

  private cpuStep(room: Room, offerTimeout = false) {
    if (!room.game || room.game.state.phase !== 'play') return;
    const next = this.cpuNext(room, false, offerTimeout);
    if (!next) return;
    const [seat, action] = next;
    const g = room.game;
    const pl = g.state.players[seat]!;
    const r = this.commit(room, seat, pl.pid, `cpu:${g.state.seq}:${seat}`, action);
    if (!r.ok) {
      // A rejected CPU move is a bug in the CPU. Medium and Hard fall back to Easy's move once,
      // so the game goes on; if that fails too, stop rather than retry forever.
      this.log(`room ${room.code}: CPU ${pl.nick} move rejected: ${JSON.stringify(action)} -> ${r.error}`);
      if (this.brainFor(room, pl.pid) === 'easy') return;
      const easy = cpuMove(
        viewFor(g.state, seat),
        seedRng(`${g.row.id}:${g.state.seq}:${seat}:easy`),
        newCpuMemo(),
      );
      if (!easy || !this.commit(room, seat, pl.pid, `cpu:${g.state.seq}:${seat}:easy`, easy).ok) return;
    }
    this.scheduleCpu(room);
  }

  /** Hard CPUs remember what they saw of every move (their own view and redacted events only). */
  private observeCpus(room: Room, events: GameEvent[]) {
    const g = room.game!;
    const memos = (room.cpuMemo ??= new Map());
    g.state.players.forEach((pl, seat) => {
      if (!pl.cpu) return;
      const brain = this.brainFor(room, pl.pid);
      if (brain === 'easy' || brain.base !== 'hard') return;
      if (!memos.has(pl.pid)) memos.set(pl.pid, newCpuMemo());
      try {
        cpuObserve(memos.get(pl.pid)!, viewFor(g.state, seat), eventsFor(events, seat), brain);
      } catch (e) {
        this.log(`room ${room.code}: CPU ${pl.nick} memory: ${String(e)}`);
      }
    });
  }

  private setOptions(conn: Conn, room: Room, options: RoomOptions) {
    const seat = room.seats.find((s) => s.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.game) return conn.send({ t: 'error', text: 'Options can be changed before the game starts' });
    const before = room.options;
    room.options = structuredClone(options);
    const tb = this.table(room);
    const modeChanged = before.scenario !== options.scenario;
    this.store.tx(() => {
      this.store.saveOptions(room.code, room.options);
      // A new mode needs a board of its shape; a saved map that no longer fits gives way to the standard one.
      if (modeChanged) {
        const src = tb.board.source.kind === 'saved' ? ({ kind: 'default' } as const) : tb.board.source;
        const r = this.makeBoard(room, src, newSeed());
        const board = r.ok ? r.board : this.emergencyBoard(room);
        this.pushBoard(room, board);
      }
      this.changed(room, seat.nick, modeChanged ? 'changed the mode' : 'changed the options');
      this.store.saveTable(room.code, tb.state);
    });
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
    // The table's board and turn order (docs/pregame.md 1.4, 2.3).
    const tb = this.table(room);
    const info = this.tableInfo(room);
    if (info.problem) return conn.send({ t: 'error', text: info.problem });
    if (!tb.state.first.pid) return conn.send({ t: 'error', text: 'Finish the roll for who goes first' });
    const bySeat = new Map(room.seats.map((s) => [s.pid, s]));
    const players: NewPlayer[] = turnOrder(tb.state.circle, tb.state.first.pid).map((pid) => {
      const s = bySeat.get(pid)!;
      return { pid: s.pid, color: s.color, nick: s.nick, ...(s.cpu ? { cpu: true } : {}) };
    });
    const row: GameRow = {
      id: randomUUID(),
      roomCode: room.code,
      seed: randomBytes(16).toString('hex'),
      engineVersion: ENGINE_VERSION,
      players,
      config: { ...gameConfigFor(room.options, tb.board.map), ...this.opts.gameConfig },
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
    const deck = !!g.state.config.houseRules?.diceDeck;
    if (action.type === 'roll') action = { type: 'roll', dice: diceForRoll(4, deck) };
    let r = applyAction(g.state, seat, action);
    for (let pairs = 16; !r.ok && r.error === NEED_DICE && pairs <= 64; pairs *= 2) {
      action = { type: 'roll', dice: diceForRoll(pairs, deck) };
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
      // Everyone agreed to keep playing (SPEC 8.9): the game is open again.
      const resumed = g.state.phase === 'over' && r.state.phase === 'play';
      if (over || resumed || r.state.seq % this.snapshotEvery === 0)
        this.store.insertSnapshot(g.row.id, r.state);
      if (over) this.store.endGame(g.row.id, 'won', at);
      if (resumed) this.store.reopenGame(g.row.id);
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
    const items = entriesOf(r.state.seq, at, r.state, r.events);
    g.events.push(...items);
    if (g.events.length > LOG_EVENTS * 2) g.events = g.events.slice(-LOG_EVENTS);
    if (over) room.pendingReset = null;
    // The new state goes out before the ack, so when a client sees its move acknowledged it is
    // already looking at the result (no moment of acting on a stale view).
    this.broadcast(
      room,
      items.map((x): LogItem => ({ k: 'ev', ...x })),
    );
    this.observeCpus(room, r.events);
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
      const brain = this.brainFor(room, pl.pid);
      const talk = brain === 'easy' ? 'quiet' : brain.chatter;
      if (mine.turn !== g.state.turnN && talk !== 'off') {
        const level: CpuLevel = brain === 'easy' ? 'easy' : brain.base;
        const rng = seedRng(String(random()));
        const view = viewFor(g.state, seat);
        const rate = talk === 'chatty' ? 2 : 1;
        const line = cpuChat(view, eventsFor(events, seat), level, rng, mine.robbed, rate);
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

  private optionFromRule(room: Room, rule: string, value: boolean | number | string) {
    const o = structuredClone(room.options);
    if (rule === 'winVP') o.winVP = value as number;
    else (o.houseRules as Record<string, unknown>)[rule] = rule === 'handBack' ? value : value || undefined;
    const parsed = OptionsSchema.safeParse(JSON.parse(JSON.stringify(o)));
    if (!parsed.success) return;
    room.options = parsed.data;
    this.store.saveOptions(room.code, room.options);
  }

  /** Table music (SPEC 12): anyone in the room, seated or watching. */
  private music(conn: Conn, room: Room, op: MusicOp) {
    const who = room.seats.find((s) => s.pid === conn.pid)?.nick ?? 'Someone';
    const r = musicOp(room.music ?? emptyMusic(), op, who, this.now());
    if (!r.ok) return conn.send({ t: 'error', text: r.error });
    if (r.st === room.music) return;
    room.music = r.st;
    this.store.tx(() => {
      this.store.saveMusic(room.code, r.st);
      if (r.note) this.sys(room, r.note);
    });
    this.broadcast(room, this.takeSys(room));
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
    // Back at the table: nobody is ready yet, and a roll for first is rolled again.
    const tb = this.table(room);
    tb.state.ready = [];
    if (tb.state.first.mode === 'roll')
      for (const line of resetFirst(tb.state, 'roll', this.cpus(room), this.names(room), this.opts.luck))
        this.sys(room, line);
    this.store.saveTable(room.code, tb.state);
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

  /* ---------- The pre-game table (docs/pregame.md) ---------- */

  private names(room: Room): Map<string, string> {
    return new Map(room.seats.map((st) => [st.pid, st.nick]));
  }
  private cpus(room: Room): Set<string> {
    return new Set(room.seats.filter((st) => st.cpu).map((st) => st.pid));
  }

  /** The room's table, loading or making it the first time it's needed. */
  private table(room: Room): { state: TableState; board: TableBoard } {
    if (room.table) return room.table;
    const saved = room.savedTable as TableState | undefined;
    delete room.savedTable;
    if (saved?.seqs?.length) {
      const board = this.store.tableBoard(room.code, saved.seqs[saved.at]!) as TableBoard | null;
      if (board) {
        room.table = { state: saved, board };
        syncCircle(
          saved,
          room.seats.map((st) => st.pid),
        );
        return room.table;
      }
    }
    const state = newTable(room.seats.map((st) => st.pid));
    const made = this.makeBoard(room, { kind: 'default' }, newSeed());
    const board = made.ok ? made.board : this.emergencyBoard(room);
    room.table = { state, board };
    this.store.tx(() => this.pushBoard(room, board));
    if (room.seats.length)
      resetFirst(state, state.first.mode, this.cpus(room), this.names(room), this.opts.luck);
    this.store.saveTable(room.code, state);
    return room.table;
  }

  /**
   * The mode's board when nothing else can be made: filled the standard way, or failing that with
   * no number rules at all, or failing even that (a broken map) the mode's own standard board. A
   * bounded number of tries: a map no seed can fill once froze the whole server here.
   */
  private emergencyBoard(room: Room): TableBoard {
    const map = this.modeMap(room);
    const sea = map.modules.includes('seafarers');
    const tries: [MapData, GenRules][] = [
      [map, STANDARD_FILL],
      [map, ANYTHING_GOES],
      [SCENARIOS[sea ? 'heading-for-new-shores' : 'classic']!, ANYTHING_GOES],
    ];
    for (const [m, rules] of tries)
      for (let i = 0; i < 20; i++) {
        const seed = `fallback-${i}`;
        const r = fillBoard(m, rules, seed, 4);
        if (r.ok) {
          if (m !== map || rules !== STANDARD_FILL)
            this.log(`room ${room.code}: ${map.id} board filled without its rules`);
          return { map: r.map, source: { kind: 'default' }, seed, edited: [] };
        }
      }
    throw new Error(`no board can be made for ${map.id}`);
  }

  /** The mode's own map for the seats at the table (a 3-player layout where there is one). */
  private modeMap(room: Room): MapData {
    return scenarioMap(room.options.scenario, room.seats.length);
  }

  /** The map a source draws from, and the rules for its blanks. */
  private sourceOf(
    room: Room,
    src: BoardSource,
  ): { map: MapData; rules: GenRules; presetName?: string } | string {
    const mode = this.modeMap(room);
    if (src.kind === 'default') return { map: mode, rules: STANDARD_FILL };
    if (src.kind === 'generated') {
      const p = this.maps.rulesOf(src.preset);
      return { map: mode, rules: p.rules, presetName: p.name };
    }
    const row = this.store.mapById(src.id);
    if (!row) return 'That map isn’t there any more';
    const m = row.map as MapData;
    if (m.modules.includes('seafarers') !== mode.modules.includes('seafarers'))
      return mode.modules.includes('seafarers')
        ? `“${row.name}” isn’t a Seafarers map; pick Base or Knights for it`
        : `“${row.name}” is a Seafarers map; pick Seafarers or Full game for it`;
    return { map: m, rules: OUR_RULES };
  }

  /** A complete board from a source and seed, keeping `current`'s locks if given. */
  private makeBoard(
    room: Room,
    src: BoardSource,
    seed: string,
    current?: MapData,
  ): { ok: true; board: TableBoard } | { ok: false; error: string } {
    const from = this.sourceOf(room, src);
    if (typeof from === 'string') return { ok: false, error: from };
    const players = Math.max(2, Math.min(4, room.seats.length || 4));
    let r = fillBoard(from.map, from.rules, seed, players, current);
    // A saved map whose blanks can't meet "Our rules" is filled the standard way instead.
    if (!r.ok && src.kind === 'saved') r = fillBoard(from.map, STANDARD_FILL, seed, players, current);
    if (!r.ok) return r;
    const map = r.map;
    const source: BoardSource =
      src.kind === 'generated' ? { ...src, presetName: from.presetName ?? src.presetName } : src;
    if (source.kind === 'generated')
      map.made = { generator: { preset: source.presetName, seed, rules: from.rules } };
    else if (source.kind === 'saved')
      map.made = { ...(map.made ?? {}), generator: { preset: 'Saved map', seed } };
    return { ok: true, board: { map, source, seed, edited: [] } };
  }

  /** Add a board to the history (dropping anything after the current one) and show it. */
  private pushBoard(room: Room, board: TableBoard) {
    const t = room.table!.state;
    const dropped = t.seqs.splice(t.at + 1);
    const seq = t.nextSeq++;
    t.seqs.push(seq);
    while (t.seqs.length > HISTORY) dropped.push(t.seqs.shift()!);
    t.at = t.seqs.length - 1;
    room.table!.board = board;
    this.store.deleteTableBoards(room.code, dropped);
    this.store.putTableBoard(room.code, seq, board);
  }

  /** Something on the table changed: nobody is ready any more (1.4). */
  private changed(room: Room, who: string, what: string) {
    const t = room.table!.state;
    t.ready = [];
    t.last = { who, what, at: this.now() };
  }

  /** Seats came or went: the circle follows and who goes first is settled again. */
  private seatsChanged(room: Room) {
    if (room.game) return;
    const tb = this.table(room);
    if (
      !syncCircle(
        tb.state,
        room.seats.map((st) => st.pid),
      )
    )
      return;
    tb.state.ready = [];
    // A layout made for this many players (Heading for New Shores with 3) replaces the board.
    const src = tb.board.source;
    if (src.kind !== 'saved' && tb.board.map.id !== this.modeMap(room).id) {
      const r = this.makeBoard(room, src, newSeed());
      if (r.ok) {
        this.pushBoard(room, r.board);
        tb.state.last = { who: 'The table', what: `switched to ${r.board.map.name}`, at: this.now() };
      }
    }
    const first = tb.state.first;
    if (first.mode === 'pick' && first.pid && tb.state.circle.includes(first.pid)) return;
    for (const line of resetFirst(tb.state, first.mode, this.cpus(room), this.names(room), this.opts.luck))
      this.sys(room, line);
    this.store.saveTable(room.code, tb.state);
  }

  private tableOp(conn: Conn, room: Room, op: TableOp) {
    const seat = room.seats.find((st) => st.pid === conn.pid);
    if (!seat) return conn.send({ t: 'error', text: 'Take a seat first' });
    if (room.game) return conn.send({ t: 'error', text: 'The game has already started' });
    const tb = this.table(room);
    const t = tb.state;
    const who = seat.nick;
    const fail = (text: string) => conn.send({ t: 'error', text });
    const names = this.names(room);
    const cpus = this.cpus(room);
    const lines: string[] = [];
    switch (op.k) {
      case 'source':
      case 'reroll':
      case 'seed': {
        const src: BoardSource =
          op.k !== 'source'
            ? tb.board.source
            : op.source === 'default'
              ? { kind: 'default' }
              : op.source === 'saved'
                ? { kind: 'saved', id: op.id ?? '', name: this.store.mapById(op.id ?? '')?.name ?? '' }
                : { kind: 'generated', preset: op.preset ?? 'builtin:our rules', presetName: '' };
        const seed = op.k === 'seed' ? op.seed : newSeed();
        // Rerolling keeps the locks; a new source starts fresh.
        const r = this.makeBoard(room, src, seed, op.k === 'source' ? undefined : tb.board.map);
        if (!r.ok) return fail(r.error);
        if (src.kind === 'saved' && op.k === 'source') {
          const m = this.store.mapById(src.id)!.map as MapData;
          room.options = { ...room.options, winVP: Math.max(5, Math.min(30, m.winVP)) };
          this.store.saveOptions(room.code, room.options);
        }
        this.store.tx(() => {
          this.pushBoard(room, r.board);
          this.changed(
            room,
            who,
            op.k === 'reroll'
              ? 'rerolled'
              : op.k === 'seed'
                ? `typed in seed ${seed}`
                : src.kind === 'default'
                  ? 'picked the standard board'
                  : src.kind === 'saved'
                    ? `picked “${src.name}”`
                    : `generated a board with “${r.board.source.kind === 'generated' ? r.board.source.presetName : ''}”`,
          );
          this.store.saveTable(room.code, t);
        });
        break;
      }
      case 'back':
      case 'forward': {
        const at = t.at + (op.k === 'back' ? -1 : 1);
        if (at < 0 || at >= t.seqs.length)
          return fail(op.k === 'back' ? 'That’s the first board' : 'That’s the latest board');
        const board = this.store.tableBoard(room.code, t.seqs[at]!) as TableBoard | null;
        if (!board) return fail('That board isn’t there any more');
        t.at = at;
        tb.board = board;
        this.changed(room, who, op.k === 'back' ? 'went back a board' : 'went forward a board');
        this.store.saveTable(room.code, t);
        break;
      }
      case 'edit': {
        const r = editBoard(tb.board, op.op as EditOp, who);
        if (!r.ok) return fail(r.error);
        const what = describeEdit(op.op as EditOp, tb.board.map);
        this.store.tx(() => {
          this.pushBoard(room, r.board);
          this.changed(room, who, what);
          this.store.saveTable(room.code, t);
        });
        break;
      }
      case 'ready': {
        t.ready = op.on ? [...new Set([...t.ready, seat.pid])] : t.ready.filter((p) => p !== seat.pid);
        this.store.saveTable(room.code, t);
        break;
      }
      case 'circle': {
        const pids = room.seats.map((st) => st.pid);
        if (op.order.length !== pids.length || !pids.every((p) => op.order.includes(p)))
          return fail('Someone sat down or left; try again');
        t.circle = op.order.slice();
        this.changed(room, who, 'changed the seating');
        this.store.saveTable(room.code, t);
        break;
      }
      case 'shuffle': {
        const c = t.circle.slice();
        for (let i = c.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [c[i], c[j]] = [c[j]!, c[i]!];
        }
        t.circle = c;
        this.changed(room, who, 'shuffled the seating');
        this.store.saveTable(room.code, t);
        break;
      }
      case 'firstMode': {
        lines.push(...resetFirst(t, op.mode, cpus, names, this.opts.luck));
        this.changed(
          room,
          who,
          op.mode === 'roll'
            ? 'started a roll for first'
            : op.mode === 'random'
              ? 'picked first at random'
              : 'chose to pick who goes first',
        );
        break;
      }
      case 'pickFirst': {
        if (t.first.mode !== 'pick') return fail('Choose “Pick” first');
        if (!t.circle.includes(op.pid)) return fail('That seat isn’t at the table');
        t.first.pid = op.pid;
        this.changed(
          room,
          who,
          op.pid === seat.pid ? 'will go first' : `picked ${names.get(op.pid)} to go first`,
        );
        break;
      }
      case 'roll': {
        const r = t.first.roll;
        if (t.first.mode !== 'roll' || !r || r.winner) return fail('Nobody is rolling for first');
        if (!r.rolling.includes(seat.pid)) return fail('You’re not in this roll');
        if (r.rolls[seat.pid]) return fail('You’ve rolled');
        lines.push(...rollFor(t, [seat.pid], names, cpus, this.opts.luck));
        break;
      }
      case 'autoRoll': {
        const r = t.first.roll;
        if (t.first.mode !== 'roll' || !r || r.winner) return fail('Nobody is rolling for first');
        lines.push(
          ...rollFor(
            t,
            r.rolling.filter((p) => !r.rolls[p]),
            names,
            cpus,
            this.opts.luck,
          ),
        );
        break;
      }
    }
    if (op.k === 'firstMode' || op.k === 'pickFirst' || op.k === 'roll' || op.k === 'autoRoll')
      this.store.tx(() => {
        for (const line of lines) this.sys(room, line);
        this.store.saveTable(room.code, t);
      });
    this.broadcast(room, this.takeSys(room));
  }

  /** The table as everyone sees it. */
  private tableInfo(room: Room): TableInfo {
    const { state: t, board } = this.table(room);
    const cpus = this.cpus(room);
    const n = room.seats.length;
    let problem: string | null = null;
    const allowed = room.options.ck ? board.map.players.filter((x) => x >= 3) : board.map.players;
    if (n >= 2 && !allowed.includes(n)) problem = `This board is for ${allowed.join(' or ')} players`;
    return {
      board,
      at: t.at,
      count: t.seqs.length,
      ready: [...new Set([...t.ready, ...cpus])].filter((p) => t.circle.includes(p)),
      circle: t.circle,
      first: t.first,
      last: t.last,
      problem,
    };
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
        ...(s.cpu ? { cpu: true, level: s.level ?? 'easy', levelName: this.levelName(s) } : {}),
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
      ...(room.game ? {} : { table: this.tableInfo(room) }),
      ...(room.music ? { music: { ...room.music, now: this.now() } } : {}),
    };
  }

  private redact(items: LogItem[], seat: number | null): LogItem[] {
    // Notes are public (the board and the dice); events are redacted for this seat.
    return items.map((it) =>
      it.k === 'ev' && !isLogNote(it.e) ? { ...it, e: eventsFor([it.e], seat)[0]! } : it,
    );
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

  /** Errors each screen has reported, so one stuck in a loop can't flood the log. */
  private errorsFrom = new WeakMap<Conn, number>();
  /** A screen hit an error (SPEC 13.1): into the server log with the room, who and where. */
  private clientError(conn: Conn, m: Extract<ClientMsg, { t: 'clientError' }>) {
    const n = (this.errorsFrom.get(conn) ?? 0) + 1;
    this.errorsFrom.set(conn, n);
    if (n > 10) return;
    const room = conn.room;
    const who = room?.seats.find((x) => x.pid === conn.pid)?.nick ?? conn.pid ?? 'someone';
    const stack = (m.stack ?? '').split('\n').slice(0, 6).join(' | ');
    this.log(
      `screen error in room ${room?.code ?? '-'} from ${who} (${m.where ?? '?'}, move ${m.seq ?? '?'}): ${m.msg}${stack ? ` | ${stack}` : ''}${n === 10 ? ' (no more from this screen)' : ''}`,
    );
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
export function gameConfigFor(o: RoomOptions, board?: MapData): Partial<GameConfig> {
  const map = SCENARIOS[o.scenario]!;
  const seafarers = map.modules.includes('seafarers');
  const hr: HouseRules = {};
  if (o.houseRules.no7FirstRound) hr.no7FirstRound = true;
  if (o.houseRules.bank3to1) hr.bank3to1 = true;
  if (o.houseRules.freeShipMoves && seafarers) hr.freeShipMoves = true;
  if (o.houseRules.handBack !== false) hr.handBack = true;
  if (o.houseRules.handBackSetup) hr.handBackSetup = true;
  if (o.houseRules.undo !== false) hr.undo = true;
  if (o.houseRules.diceDeck) hr.diceDeck = o.houseRules.diceDeck;
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
  // The bank (SPEC 8.1): limited unless set otherwise. A classic limited bank needs no field
  // (it's how base games always were), so classic configs stay { winVP }.
  if (o.bank === 'unlimited') c.bank = 'unlimited';
  else if (o.ck) c.bank = 'limited';
  // From the pre-game table: exactly its board, and the seats already in turn order.
  if (board) {
    c.map = board;
    c.winVP = o.winVP;
    if (o.ck) c.modules = [...board.modules, 'citiesKnights'];
    c.order = 'given';
  }
  return c;
}

/** Room options matching a game's config (for a resumed game's room). */
export function optionsFor(c: Partial<GameConfig>): RoomOptions {
  // Any Seafarers board resumes in the Seafarers modes; anything else in the base modes.
  const scenario: RoomOptions['scenario'] =
    c.map &&
    [
      'fog-islands', 'four-islands', 'four-islands-far', 'treasure-fog', 'classic-isles', 'classic-isles-far',
      'archipelago', 'the-crossing', 'atoll',
    ].includes(c.map.id) // prettier-ignore
      ? (c.map.id as RoomOptions['scenario'])
      : c.map?.modules.includes('seafarers')
        ? 'heading-for-new-shores'
        : 'classic';
  const hr = c.houseRules ?? {};
  const o: RoomOptions = {
    scenario: SCENARIOS[scenario] ? scenario : 'classic',
    winVP: c.winVP ?? 10,
    houseRules: { ...hr, handBack: !!hr.handBack, undo: !!hr.undo },
  };
  if (c.modules?.includes('citiesKnights')) o.ck = true;
  if (c.bank === 'unlimited') o.bank = 'unlimited';
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
