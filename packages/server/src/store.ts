/*
 * SQLite persistence. Writes are synchronous and committed before the server tells anyone
 * about them, so a move a player has seen survives a crash or restart.
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Action, Color, CpuLevel, GameConfig, GameEvent, GameState, NewPlayer } from '@settlers/engine';

export interface SeatRow {
  pid: string;
  tokenHash: string;
  nick: string;
  color: Color;
  /** A CPU player (docs/bot.md); its token hash matches nothing. */
  cpu?: true;
  /** The person's profile (SPEC 5.1); CPUs have none. */
  profileId?: string;
  /** A CPU's difficulty (SPEC 5.2). */
  level?: CpuLevel;
}

/** A player profile (SPEC 5.1): a name and a favourite colour, no password. */
export interface ProfileRow {
  id: string;
  name: string;
  color: Color;
  createdAt: number;
}

/** Who sat in each seat of a game, for stats: a profile, or a CPU of some level. */
export interface GamePlayerRow {
  gameId: string;
  pid: string;
  profileId: string | null;
  cpuLevel: string | null;
}

export interface RoomRow {
  code: string;
  createdAt: number;
  seats: SeatRow[];
  gameId: string | null;
  /** Room options as JSON (validated by the caller), or null for defaults. */
  options: unknown;
  /** The pre-game table (docs/pregame.md) as JSON, or null if it has none yet. */
  table?: unknown;
}

export interface GameRow {
  id: string;
  roomCode: string;
  seed: string;
  engineVersion: number;
  players: NewPlayer[];
  config: Partial<GameConfig>;
  createdAt: number;
  endedAt: number | null;
  endReason: string | null;
  /** When the game last had a move (filled in when loaded). */
  lastAt?: number;
}

/** A saved map (docs/maps.md 4.4) or generator preset (5.18), shared by everyone. */
export interface MapRow {
  id: string;
  name: string;
  map: unknown;
  madeBy: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface PresetRow {
  id: string;
  name: string;
  rules: unknown;
  madeBy: string | null;
  createdAt: number;
}

export interface ActionRow {
  seq: number;
  pid: string;
  seat: number;
  clientId: string;
  action: Action;
  events: GameEvent[];
  at: number;
}

export interface ChatRow {
  id: number;
  roomCode: string;
  /** 'sys' for system notices. */
  pid: string;
  nick: string;
  text: string;
  at: number;
}

/** Nicknames match whatever the case and spacing. */
export const nickKey = (nick: string) => nick.trim().toLowerCase().replace(/\s+/g, ' ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  seats_json TEXT NOT NULL,
  game_id TEXT
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  seed TEXT NOT NULL,
  engine_version INTEGER NOT NULL,
  players_json TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  pid TEXT NOT NULL,
  seat INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  action_json TEXT NOT NULL,
  events_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS actions_client ON actions (game_id, client_id);
CREATE TABLE IF NOT EXISTS snapshots (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  pid TEXT NOT NULL,
  nick TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_room ON chat (room_code, id);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  merged_into TEXT
);
CREATE INDEX IF NOT EXISTS profiles_key ON profiles (name_key);
CREATE TABLE IF NOT EXISTS profile_settings (
  profile_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL,
  pid TEXT NOT NULL,
  profile_id TEXT,
  cpu_level TEXT,
  PRIMARY KEY (game_id, pid)
);
CREATE INDEX IF NOT EXISTS game_players_profile ON game_players (profile_id);
CREATE TABLE IF NOT EXISTS profile_merges (
  from_id TEXT NOT NULL,
  into_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_stats (
  game_id TEXT PRIMARY KEY,
  engine_version INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  stats_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  map_json TEXT NOT NULL,
  made_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS table_boards (
  room_code TEXT NOT NULL,
  seq INTEGER NOT NULL,
  board_json TEXT NOT NULL,
  PRIMARY KEY (room_code, seq)
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  made_by TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS player_settings (
  nick_key TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export class Store {
  readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    // FULL: every commit is fsynced before we continue. Slower, but nothing is lost on power loss.
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
    this.setMetaIfMissing('schema_version', '1');
    // Schema 2: room options. Older databases get the column added.
    const cols = this.db.prepare('PRAGMA table_info(rooms)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'options_json'))
      this.db.exec('ALTER TABLE rooms ADD COLUMN options_json TEXT');
    // Schema 3 (SPEC 5.1, 5.7): closed rooms (after "Save and quit"), when a game last moved.
    if (!cols.some((c) => c.name === 'closed_at'))
      this.db.exec('ALTER TABLE rooms ADD COLUMN closed_at INTEGER');
    // Schema 4 (Milestone 6): the pre-game table.
    if (!cols.some((c) => c.name === 'table_json'))
      this.db.exec('ALTER TABLE rooms ADD COLUMN table_json TEXT');
    const gcols = this.db.prepare('PRAGMA table_info(games)').all() as { name: string }[];
    if (!gcols.some((c) => c.name === 'last_at'))
      this.db.exec('ALTER TABLE games ADD COLUMN last_at INTEGER');
    this.migrateProfiles();
  }

  /**
   * Once: a profile for every nickname in the database, each game's seats linked to profiles
   * (CPUs as Easy), and settings moved from nicknames to profiles.
   */
  private migrateProfiles() {
    if (this.getMeta('profiles_migrated')) return;
    this.tx(() => {
      const games = this.db
        .prepare('SELECT id, players_json, created_at FROM games ORDER BY created_at')
        .all() as {
        id: string;
        players_json: string;
        created_at: number;
      }[];
      for (const g of games) {
        for (const p of JSON.parse(g.players_json) as {
          pid: string;
          nick: string;
          color: Color;
          cpu?: boolean;
        }[]) {
          if (p.cpu) this.linkSeat(g.id, p.pid, null, 'easy');
          else this.linkSeat(g.id, p.pid, this.profileFor(p.nick, p.color, g.created_at).id, null);
        }
      }
      const rooms = this.db.prepare('SELECT code, seats_json, created_at FROM rooms').all() as {
        code: string;
        seats_json: string;
        created_at: number;
      }[];
      for (const r of rooms) {
        const seats = JSON.parse(r.seats_json) as SeatRow[];
        for (const st of seats)
          if (!st.cpu && !st.profileId) st.profileId = this.profileFor(st.nick, st.color, r.created_at).id;
        this.db.prepare('UPDATE rooms SET seats_json = ? WHERE code = ?').run(JSON.stringify(seats), r.code);
      }
      const settings = this.db
        .prepare('SELECT nick_key, settings_json, updated_at FROM player_settings')
        .all() as {
        nick_key: string;
        settings_json: string;
        updated_at: number;
      }[];
      for (const st of settings) {
        const prof = this.profileByName(st.nick_key);
        if (prof)
          this.db
            .prepare(
              'INSERT OR REPLACE INTO profile_settings (profile_id, settings_json, updated_at) VALUES (?, ?, ?)',
            )
            .run(prof.id, st.settings_json, st.updated_at);
      }
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('profiles_migrated', '1')").run();
    });
  }

  /** The profile with this name, creating it if there's none (used by the migration). */
  private profileFor(nick: string, color: Color, at: number): ProfileRow {
    const found = this.profileByName(nick);
    if (found) return found;
    const p: ProfileRow = {
      id: `p-${randomUUID()}`,
      name: nick.trim(),
      color: color === 'gray' ? 'red' : color,
      createdAt: at,
    };
    this.insertProfile(p);
    return p;
  }

  close() {
    this.db.close();
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row ? row.value : null;
  }

  setMetaIfMissing(key: string, value: string): string {
    this.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(key, value);
    return this.getMeta(key)!;
  }

  /* ---------- Profiles (SPEC 5.1) ---------- */

  insertProfile(p: ProfileRow) {
    this.db
      .prepare('INSERT INTO profiles (id, name, name_key, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, p.name, nickKey(p.name), p.color, p.createdAt);
  }

  private static profile(r: { id: string; name: string; color: string; created_at: number }): ProfileRow {
    return { id: r.id, name: r.name, color: r.color as Color, createdAt: r.created_at };
  }

  /** Every profile still in use (merged ones are gone), by name. */
  profiles(): ProfileRow[] {
    const rows = this.db
      .prepare('SELECT id, name, color, created_at FROM profiles WHERE merged_into IS NULL ORDER BY name_key')
      .all() as { id: string; name: string; color: string; created_at: number }[];
    return rows.map(Store.profile);
  }

  profileById(id: string): ProfileRow | null {
    const r = this.db
      .prepare('SELECT id, name, color, created_at FROM profiles WHERE id = ? AND merged_into IS NULL')
      .get(id) as { id: string; name: string; color: string; created_at: number } | undefined;
    return r ? Store.profile(r) : null;
  }

  profileByName(name: string): ProfileRow | null {
    const r = this.db
      .prepare('SELECT id, name, color, created_at FROM profiles WHERE name_key = ? AND merged_into IS NULL')
      .get(nickKey(name)) as { id: string; name: string; color: string; created_at: number } | undefined;
    return r ? Store.profile(r) : null;
  }

  linkSeat(gameId: string, pid: string, profileId: string | null, cpuLevel: string | null) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO game_players (game_id, pid, profile_id, cpu_level) VALUES (?, ?, ?, ?)',
      )
      .run(gameId, pid, profileId, cpuLevel);
  }

  gamePlayers(gameId?: string): GamePlayerRow[] {
    const rows = (
      gameId
        ? this.db.prepare('SELECT * FROM game_players WHERE game_id = ?').all(gameId)
        : this.db.prepare('SELECT * FROM game_players').all()
    ) as { game_id: string; pid: string; profile_id: string | null; cpu_level: string | null }[];
    return rows.map((r) => ({
      gameId: r.game_id,
      pid: r.pid,
      profileId: r.profile_id,
      cpuLevel: r.cpu_level,
    }));
  }

  /** Games where both profiles sat (merging them would give one person two seats). */
  sharedGames(a: string, b: string): number {
    const r = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM game_players x JOIN game_players y ON x.game_id = y.game_id WHERE x.profile_id = ? AND y.profile_id = ?',
      )
      .get(a, b) as { n: number };
    return r.n;
  }

  /** Move everything of `from` to `into`; `from` disappears. One transaction (the caller's). */
  mergeProfiles(from: string, into: string, at: number) {
    this.db.prepare('UPDATE game_players SET profile_id = ? WHERE profile_id = ?').run(into, from);
    this.db.prepare('UPDATE profiles SET merged_into = ? WHERE id = ?').run(into, from);
    this.db.prepare('UPDATE profiles SET merged_into = ? WHERE merged_into = ?').run(into, from);
    this.db.prepare('INSERT INTO profile_merges (from_id, into_id, at) VALUES (?, ?, ?)').run(from, into, at);
  }

  getProfileSettings(profileId: string): unknown {
    const row = this.db
      .prepare('SELECT settings_json FROM profile_settings WHERE profile_id = ?')
      .get(profileId) as { settings_json: string } | undefined;
    return row ? JSON.parse(row.settings_json) : null;
  }

  saveProfileSettings(profileId: string, settings: unknown, at: number) {
    this.db
      .prepare(
        'INSERT INTO profile_settings (profile_id, settings_json, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(profile_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at',
      )
      .run(profileId, JSON.stringify(settings), at);
  }

  /* ---------- Stats cache (SPEC 5.6): always rebuildable from the moves ---------- */

  getStats(gameId: string, engineVersion: number, seq: number): unknown {
    const r = this.db
      .prepare('SELECT stats_json FROM game_stats WHERE game_id = ? AND engine_version = ? AND seq = ?')
      .get(gameId, engineVersion, seq) as { stats_json: string } | undefined;
    return r ? JSON.parse(r.stats_json) : null;
  }

  saveStats(gameId: string, engineVersion: number, seq: number, stats: unknown) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO game_stats (game_id, engine_version, seq, stats_json) VALUES (?, ?, ?, ?)',
      )
      .run(gameId, engineVersion, seq, JSON.stringify(stats));
  }

  clearStats() {
    this.db.prepare('DELETE FROM game_stats').run();
  }

  /** All games, newest first (for stats and the saved list). */
  allGames(): GameRow[] {
    const ids = this.db.prepare('SELECT id FROM games ORDER BY created_at DESC').all() as { id: string }[];
    return ids.map((r) => this.loadGame(r.id)!);
  }

  lastSeq(gameId: string): number {
    const r = this.db.prepare('SELECT MAX(seq) AS s FROM actions WHERE game_id = ?').get(gameId) as {
      s: number | null;
    };
    return r.s ?? 0;
  }

  /* ---------- Rooms ---------- */

  closeRoom(code: string, at: number) {
    this.db.prepare('UPDATE rooms SET closed_at = ?, game_id = NULL WHERE code = ?').run(at, code);
  }

  setGameRoom(gameId: string, code: string) {
    this.db.prepare('UPDATE games SET room_code = ? WHERE id = ?').run(code, gameId);
  }

  roomExists(code: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code);
  }

  insertRoom(r: RoomRow) {
    this.db
      .prepare('INSERT INTO rooms (code, created_at, seats_json, game_id) VALUES (?, ?, ?, ?)')
      .run(r.code, r.createdAt, JSON.stringify(r.seats), r.gameId);
  }

  /* ---------- Personal settings, by nickname (SPEC 4.5) ---------- */

  getSettings(nick: string): unknown {
    const row = this.db
      .prepare('SELECT settings_json FROM player_settings WHERE nick_key = ?')
      .get(nickKey(nick)) as { settings_json: string } | undefined;
    return row ? JSON.parse(row.settings_json) : null;
  }

  saveSettings(nick: string, settings: unknown, at: number) {
    this.db
      .prepare(
        'INSERT INTO player_settings (nick_key, settings_json, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(nick_key) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at',
      )
      .run(nickKey(nick), JSON.stringify(settings), at);
  }

  saveOptions(code: string, options: unknown) {
    this.db.prepare('UPDATE rooms SET options_json = ? WHERE code = ?').run(JSON.stringify(options), code);
  }

  saveRoom(code: string, seats: SeatRow[], gameId: string | null) {
    this.db
      .prepare('UPDATE rooms SET seats_json = ?, game_id = ? WHERE code = ?')
      .run(JSON.stringify(seats), gameId, code);
  }

  loadRooms(): RoomRow[] {
    const rows = this.db
      .prepare(
        'SELECT code, created_at, seats_json, game_id, options_json, table_json FROM rooms WHERE closed_at IS NULL',
      )
      .all() as {
      code: string;
      created_at: number;
      seats_json: string;
      game_id: string | null;
      options_json: string | null;
      table_json: string | null;
    }[];
    return rows.map((r) => ({
      code: r.code,
      createdAt: r.created_at,
      seats: JSON.parse(r.seats_json),
      gameId: r.game_id,
      options: r.options_json ? JSON.parse(r.options_json) : null,
      table: r.table_json ? JSON.parse(r.table_json) : null,
    }));
  }

  /* ---------- Games ---------- */

  insertGame(g: GameRow) {
    this.db
      .prepare(
        `INSERT INTO games (id, room_code, seed, engine_version, players_json, config_json, created_at, ended_at, end_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        g.id,
        g.roomCode,
        g.seed,
        g.engineVersion,
        JSON.stringify(g.players),
        JSON.stringify(g.config),
        g.createdAt,
      );
  }

  endGame(id: string, reason: string, at: number) {
    this.db
      .prepare(
        'UPDATE games SET ended_at = COALESCE(ended_at, ?), end_reason = COALESCE(end_reason, ?) WHERE id = ?',
      )
      .run(at, reason, id);
  }

  loadGame(id: string): GameRow | null {
    const r = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | {
          id: string;
          room_code: string;
          seed: string;
          engine_version: number;
          players_json: string;
          config_json: string;
          created_at: number;
          ended_at: number | null;
          end_reason: string | null;
          last_at: number | null;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      roomCode: r.room_code,
      seed: r.seed,
      engineVersion: r.engine_version,
      players: JSON.parse(r.players_json),
      config: JSON.parse(r.config_json),
      createdAt: r.created_at,
      endedAt: r.ended_at,
      endReason: r.end_reason,
      lastAt: r.last_at ?? r.created_at,
    };
  }

  insertAction(gameId: string, a: ActionRow) {
    this.db
      .prepare(
        `INSERT INTO actions (game_id, seq, pid, seat, client_id, action_json, events_json, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        gameId,
        a.seq,
        a.pid,
        a.seat,
        a.clientId,
        JSON.stringify(a.action),
        JSON.stringify(a.events),
        a.at,
      );
    this.db.prepare('UPDATE games SET last_at = ? WHERE id = ?').run(a.at, gameId);
  }

  loadActions(gameId: string, afterSeq = 0): ActionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM actions WHERE game_id = ? AND seq > ? ORDER BY seq')
      .all(gameId, afterSeq) as {
      seq: number;
      pid: string;
      seat: number;
      client_id: string;
      action_json: string;
      events_json: string;
      at: number;
    }[];
    return rows.map((r) => ({
      seq: r.seq,
      pid: r.pid,
      seat: r.seat,
      clientId: r.client_id,
      action: JSON.parse(r.action_json),
      events: JSON.parse(r.events_json),
      at: r.at,
    }));
  }

  insertSnapshot(gameId: string, state: GameState) {
    this.db
      .prepare('INSERT OR REPLACE INTO snapshots (game_id, seq, state_json) VALUES (?, ?, ?)')
      .run(gameId, state.seq, JSON.stringify(state));
  }

  latestSnapshot(gameId: string): GameState | null {
    const r = this.db
      .prepare('SELECT state_json FROM snapshots WHERE game_id = ? ORDER BY seq DESC LIMIT 1')
      .get(gameId) as { state_json: string } | undefined;
    return r ? JSON.parse(r.state_json) : null;
  }

  /* ---------- Chat and notices ---------- */

  insertChat(c: Omit<ChatRow, 'id'>): ChatRow {
    const info = this.db
      .prepare('INSERT INTO chat (room_code, pid, nick, text, at) VALUES (?, ?, ?, ?, ?)')
      .run(c.roomCode, c.pid, c.nick, c.text, c.at);
    return { ...c, id: Number(info.lastInsertRowid) };
  }

  recentChat(roomCode: string, limit: number): ChatRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, room_code, pid, nick, text, at FROM chat WHERE room_code = ? ORDER BY id DESC LIMIT ?',
      )
      .all(roomCode, limit) as {
      id: number;
      room_code: string;
      pid: string;
      nick: string;
      text: string;
      at: number;
    }[];
    return rows
      .reverse()
      .map((r) => ({ id: r.id, roomCode: r.room_code, pid: r.pid, nick: r.nick, text: r.text, at: r.at }));
  }

  /* ---------- The pre-game table ---------- */

  saveTable(code: string, table: unknown) {
    this.db.prepare('UPDATE rooms SET table_json = ? WHERE code = ?').run(JSON.stringify(table), code);
  }

  putTableBoard(code: string, seq: number, board: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO table_boards (room_code, seq, board_json) VALUES (?, ?, ?)')
      .run(code, seq, JSON.stringify(board));
  }

  tableBoard(code: string, seq: number): unknown {
    const r = this.db
      .prepare('SELECT board_json FROM table_boards WHERE room_code = ? AND seq = ?')
      .get(code, seq) as { board_json: string } | undefined;
    return r ? JSON.parse(r.board_json) : null;
  }

  deleteTableBoards(code: string, seqs: number[]) {
    const del = this.db.prepare('DELETE FROM table_boards WHERE room_code = ? AND seq = ?');
    for (const q of seqs) del.run(code, q);
  }

  /* ---------- Maps and presets ---------- */

  maps(): MapRow[] {
    const rows = this.db
      .prepare('SELECT * FROM maps WHERE deleted_at IS NULL ORDER BY updated_at DESC')
      .all() as MapDbRow[];
    return rows.map(mapRow);
  }

  mapById(id: string): MapRow | null {
    const r = this.db.prepare('SELECT * FROM maps WHERE id = ? AND deleted_at IS NULL').get(id) as
      MapDbRow | undefined;
    return r ? mapRow(r) : null;
  }

  /** A live map with this name (any case and spacing), other than `except`. */
  mapNameTaken(name: string, except?: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM maps WHERE name_key = ? AND deleted_at IS NULL AND id != ?')
      .get(nickKey(name), except ?? '');
  }

  putMap(r: MapRow) {
    this.db
      .prepare(
        `INSERT INTO maps (id, name, name_key, map_json, made_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key,
           map_json = excluded.map_json, updated_at = excluded.updated_at`,
      )
      .run(r.id, r.name, nickKey(r.name), JSON.stringify(r.map), r.madeBy, r.createdAt, r.updatedAt);
  }

  deleteMap(id: string, at: number) {
    this.db.prepare('UPDATE maps SET deleted_at = ? WHERE id = ?').run(at, id);
  }

  presets(): PresetRow[] {
    const rows = this.db
      .prepare('SELECT * FROM presets WHERE deleted_at IS NULL ORDER BY name_key')
      .all() as {
      id: string;
      name: string;
      rules_json: string;
      made_by: string | null;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rules: JSON.parse(r.rules_json),
      madeBy: r.made_by,
      createdAt: r.created_at,
    }));
  }

  presetNameTaken(name: string, except?: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM presets WHERE name_key = ? AND deleted_at IS NULL AND id != ?')
      .get(nickKey(name), except ?? '');
  }

  putPreset(r: PresetRow) {
    this.db
      .prepare(
        `INSERT INTO presets (id, name, name_key, rules_json, made_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, rules_json = excluded.rules_json`,
      )
      .run(r.id, r.name, nickKey(r.name), JSON.stringify(r.rules), r.madeBy, r.createdAt);
  }

  deletePreset(id: string, at: number) {
    this.db.prepare('UPDATE presets SET deleted_at = ? WHERE id = ?').run(at, id);
  }

  /** Run `fn` in one transaction: all of its writes commit together or not at all. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

interface MapDbRow {
  id: string;
  name: string;
  map_json: string;
  made_by: string | null;
  created_at: number;
  updated_at: number;
}
const mapRow = (r: MapDbRow): MapRow => ({
  id: r.id,
  name: r.name,
  map: JSON.parse(r.map_json),
  madeBy: r.made_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
