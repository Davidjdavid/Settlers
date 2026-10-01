/*
 * SQLite persistence. Writes are synchronous and committed before the server tells anyone
 * about them, so a move a player has seen survives a crash or restart.
 */

import Database from 'better-sqlite3';
import type { Action, Color, GameConfig, GameEvent, GameState, NewPlayer } from '@settlers/engine';

export interface SeatRow {
  pid: string;
  tokenHash: string;
  nick: string;
  color: Color;
}

export interface RoomRow {
  code: string;
  createdAt: number;
  seats: SeatRow[];
  gameId: string | null;
  /** Room options as JSON (validated by the caller), or null for defaults. */
  options: unknown;
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

  /* ---------- Rooms ---------- */

  roomExists(code: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code);
  }

  insertRoom(r: RoomRow) {
    this.db
      .prepare('INSERT INTO rooms (code, created_at, seats_json, game_id) VALUES (?, ?, ?, ?)')
      .run(r.code, r.createdAt, JSON.stringify(r.seats), r.gameId);
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
      .prepare('SELECT code, created_at, seats_json, game_id, options_json FROM rooms')
      .all() as {
      code: string;
      created_at: number;
      seats_json: string;
      game_id: string | null;
      options_json: string | null;
    }[];
    return rows.map((r) => ({
      code: r.code,
      createdAt: r.created_at,
      seats: JSON.parse(r.seats_json),
      gameId: r.game_id,
      options: r.options_json ? JSON.parse(r.options_json) : null,
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

  /** Run `fn` in one transaction: all of its writes commit together or not at all. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
