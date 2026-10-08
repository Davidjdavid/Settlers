import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botMove, seedRng, viewFor, type GameState } from '@settlers/engine';
import { DEFAULT_OPTIONS, type ClientMsg, type RoomOptions, type ServerMsg } from '../src/protocol';
import { Rooms, gameConfigFor, type Conn } from '../src/rooms';
import { Store } from '../src/store';
import { joinAs } from './util';

class FakeConn implements Conn {
  room: Conn['room'] = null;
  pid: string | null = null;
  msgs: ServerMsg[] = [];
  send(m: ServerMsg) {
    this.msgs.push(structuredClone(m));
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> {
    const m = [...this.msgs].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`no ${t} message`);
    return m as Extract<ServerMsg, { t: T }>;
  }
}

let dir: string;
let store: Store;
let rooms: Rooms;
const quiet = () => {};
const HFNS: RoomOptions = { scenario: 'heading-for-new-shores', winVP: 14, houseRules: {} };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-opts-'));
  store = new Store(join(dir, 'test.db'));
  rooms = new Rooms(store, { log: quiet });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (c: FakeConn, m: ClientMsg) => rooms.handle(c, m);

function table(n: number) {
  const host = new FakeConn();
  send(host, { t: 'create' });
  const code = host.last('sync').room.code;
  const colors = ['red', 'blue', 'white', 'purple'] as const;
  const conns = [host];
  for (let i = 1; i < n; i++) {
    const c = new FakeConn();
    send(c, { t: 'hello', room: code });
    conns.push(c);
  }
  const tokens = conns.map((c, i) => {
    send(c, joinAs(store, `P${i}`, colors[i]!));
    return c.last('seat').token;
  });
  return { code, conns, tokens };
}

const state = (code: string): GameState => rooms.getRoom(code)!.game!.state;

/** Each seat's bot plays from that seat's own view until the game ends. */
function playOut(code: string, conns: FakeConn[], seed: string, maxMoves = 20000) {
  const rng = seedRng(seed);
  let n = 0;
  for (; state(code).phase === 'play' && n < maxMoves; n++) {
    const s = state(code);
    let moved = false;
    for (let seat = 0; seat < s.players.length && !moved; seat++) {
      const a = botMove(viewFor(s, seat), rng);
      if (!a) continue;
      const c = conns.find((x) => x.pid === s.players[seat]!.pid)!;
      send(c, { t: 'act', id: `${seed}-${n}`, action: a });
      const ack = c.last('ack');
      if (!ack.ok) throw new Error(`rejected ${JSON.stringify(a)}: ${ack.error}`);
      moved = true;
    }
    if (!moved) throw new Error(`stuck at ${s.stage}`);
  }
  return n;
}

describe('room options', () => {
  it('only seated players change them, only in the lobby, and everyone sees them', () => {
    const { conns } = table(3);
    const watcher = new FakeConn();
    send(watcher, { t: 'hello', room: conns[0]!.last('sync').room.code });
    send(watcher, { t: 'setOptions', options: HFNS });
    expect(watcher.last('error').text).toMatch(/seat/);
    send(conns[1]!, { t: 'setOptions', options: { ...HFNS, houseRules: { no7FirstRound: true } } });
    expect(conns[2]!.last('update').room.options).toEqual({ ...HFNS, houseRules: { no7FirstRound: true } });
    send(conns[0]!, { t: 'start' });
    send(conns[0]!, { t: 'setOptions', options: DEFAULT_OPTIONS });
    expect(conns[0]!.last('error').text).toMatch(/before the game starts/);
  });

  it('Seafarers needs 3 or 4 players', () => {
    const { conns, code } = table(2);
    send(conns[0]!, { t: 'setOptions', options: HFNS });
    send(conns[0]!, { t: 'start' });
    expect(conns[0]!.last('error').text).toMatch(/3 or 4 players/);
    expect(rooms.getRoom(code)!.game).toBeNull();
  });

  it('a classic game with default options keeps exactly the classic config', () => {
    // New games can hand the dice back (SPEC 4.4) and undo a move or a whole turn (5.10, 13.2);
    // turning those off gives the classic config.
    expect(gameConfigFor(DEFAULT_OPTIONS)).toEqual({
      houseRules: { handBack: true, undo: true, undoTurn: true },
    });
    expect(gameConfigFor({ ...DEFAULT_OPTIONS, houseRules: { handBack: false, undo: false } })).toEqual({});
    // A whole turn can be switched off on its own, and never comes without Undo.
    expect(gameConfigFor({ ...DEFAULT_OPTIONS, houseRules: { undoTurn: false } }).houseRules).toEqual({
      handBack: true,
      undo: true,
    });
    expect(
      gameConfigFor({ ...DEFAULT_OPTIONS, houseRules: { handBack: false, undo: false, undoTurn: true } }),
    ).toEqual({});
    expect(
      gameConfigFor({ ...DEFAULT_OPTIONS, winVP: 12, houseRules: { bank3to1: true, freeShipMoves: true } }),
    ).toEqual({
      winVP: 12,
      houseRules: { bank3to1: true, handBack: true, undo: true, undoTurn: true },
    });
    const sea = gameConfigFor({ ...HFNS, houseRules: { freeShipMoves: true } });
    expect(sea.map?.id).toBe('heading-for-new-shores');
    expect(sea.houseRules).toEqual({ freeShipMoves: true, handBack: true, undo: true, undoTurn: true });
  });

  it('Cities & Knights adds its module, needs 3 or 4 players, and only then takes its house rules', () => {
    const ck: RoomOptions = {
      scenario: 'classic',
      ck: true,
      winVP: 13,
      houseRules: { rerollBeforeAttack: true, barbarianDelay: 2, freeShipMoves: true },
    };
    expect(gameConfigFor(ck)).toEqual({
      modules: ['citiesKnights'],
      winVP: 13,
      houseRules: { rerollBeforeAttack: true, barbarianDelay: 2, handBack: true, undo: true, undoTurn: true },
      // New Knights games have a limited bank: 12 of each commodity (SPEC 8.1).
      bank: 'limited',
    });
    // Unlimited for any mode; a classic limited bank adds nothing (base games always were).
    expect(gameConfigFor({ ...ck, bank: 'unlimited' }).bank).toBe('unlimited');
    expect(gameConfigFor({ ...DEFAULT_OPTIONS, bank: 'unlimited' })).toEqual({
      bank: 'unlimited',
      houseRules: { handBack: true, undo: true, undoTurn: true },
    });
    const both = gameConfigFor({ ...HFNS, ck: true, winVP: 17 });
    expect(both.modules).toEqual(['seafarers', 'citiesKnights']);
    expect(
      gameConfigFor({
        ...DEFAULT_OPTIONS,
        houseRules: { rerollBeforeAttack: true, handBack: false, undo: false },
      }),
    ).toEqual({});
    const { conns, code } = table(2);
    send(conns[0]!, { t: 'setOptions', options: ck });
    send(conns[0]!, { t: 'start' });
    expect(conns[0]!.last('error').text).toMatch(/Cities & Knights needs 3 or 4 players/);
    expect(rooms.getRoom(code)!.game).toBeNull();
  });

  it('options and the scenario survive a restart', () => {
    const { conns, code } = table(3);
    send(conns[0]!, { t: 'setOptions', options: { ...HFNS, winVP: 12 } });
    send(conns[0]!, { t: 'start' });
    expect(state(code).config.winVP).toBe(12);
    store.close();
    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: quiet });
    expect(rooms.getRoom(code)!.options).toEqual({ ...HFNS, winVP: 12 });
    // Three players play the full island (docs/rules/seafarers.md D15, changed 2 October).
    expect(state(code).config.map?.id).toBe('heading-for-new-shores');
  });

  it('a room made from the home page starts on the Full game with an unlimited bank, kept through a restart', () => {
    const host = new FakeConn();
    send(host, { t: 'create', full: true });
    const code = host.last('sync').room.code;
    const full = {
      scenario: 'heading-for-new-shores',
      ck: true,
      winVP: 17,
      bank: 'unlimited',
      houseRules: {},
    };
    expect(rooms.getRoom(code)!.options).toEqual(full);
    expect(host.last('sync').room.options).toEqual(full);
    store.close();
    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: quiet });
    expect(rooms.getRoom(code)!.options).toEqual(full);
    // Without it (older clients, tests), the base game as before.
    const old = new FakeConn();
    send(old, { t: 'create' });
    expect(old.last('sync').room.options).toEqual({ scenario: 'classic', winVP: 10, houseRules: {} });
  });

  it('the dice deck (docs/rules/dice-deck.md): a whole game through the server, kept across a restart', () => {
    const { conns, code } = table(3);
    send(conns[0]!, {
      t: 'setOptions',
      options: { ...DEFAULT_OPTIONS, houseRules: { diceDeck: 'trimmed' } },
    });
    expect(gameConfigFor(rooms.getRoom(code)!.options).houseRules?.diceDeck).toBe('trimmed');
    send(conns[0]!, { t: 'start' });
    expect(state(code).config.houseRules?.diceDeck).toBe('trimmed');
    playOut(code, conns, 'deck');
    const s = state(code);
    expect(s.phase).toBe('over');
    // Every roll was drawn with the server's random numbers, saved with the move.
    const rolls = store
      .loadActions(rooms.getRoom(code)!.game!.row.id)
      .filter((r) => r.action.type === 'roll');
    expect(rolls.length).toBeGreaterThan(31);
    for (const r of rolls) expect((r.action as { dice: { r?: number[] } }).dice.r?.length).toBeGreaterThan(0);
    expect(s.diceDeck!.out).toHaveLength(5);
    // Players see only how many are left.
    const view = conns[1]!.last('update').game!;
    expect(view.deckLeft).toBe(s.diceDeck!.left.length);
    expect(JSON.stringify(view)).not.toContain('"out"');
    // A restart rebuilds the same deck from the saved moves.
    store.close();
    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: quiet });
    expect(state(code).diceDeck).toEqual(s.diceDeck);
  });

  it('older databases get the options column added', () => {
    store.close();
    const file = join(dir, 'old.db');
    const old = new Database(file);
    old.exec(
      "CREATE TABLE rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, seats_json TEXT NOT NULL, game_id TEXT); INSERT INTO rooms VALUES ('ABCD', 1, '[]', NULL);",
    );
    old.close();
    store = new Store(file);
    rooms = new Rooms(store, { log: quiet });
    expect(rooms.getRoom('ABCD')!.options).toEqual(DEFAULT_OPTIONS);
  });
});

describe('a Seafarers game through the server', () => {
  it('plays to the end, then replays identically after a restart', () => {
    const { conns, code } = table(4);
    send(conns[0]!, {
      t: 'setOptions',
      options: { ...HFNS, houseRules: { no7FirstRound: true, freeShipMoves: true } },
    });
    send(conns[0]!, { t: 'start' });
    playOut(code, conns, 'srv-sea');
    expect(state(code).phase).toBe('over');
    const final = JSON.stringify(state(code));
    // Nobody was ever sent the fog stack or anyone else's hand.
    for (const c of conns) {
      for (const m of c.msgs) {
        if (m.t !== 'update' && m.t !== 'sync') continue;
        const json = JSON.stringify(m);
        expect(json).not.toContain('"rng"');
        expect(json).not.toContain('"fog":{');
      }
    }
    store.close();
    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: quiet });
    expect(JSON.stringify(state(code))).toBe(final);
  });
});

describe('a Cities & Knights game through the server', () => {
  it.each([
    ['alone', { scenario: 'classic', ck: true, winVP: 13, houseRules: { barbarianDelay: 1 } }],
    ['with Seafarers', { scenario: 'heading-for-new-shores', ck: true, winVP: 17, houseRules: {} }],
  ] as const)(
    'plays to the end %s, leaks nothing, and replays identically',
    (_name, options) => {
      const { conns, code } = table(3);
      send(conns[0]!, { t: 'setOptions', options: options as RoomOptions });
      send(conns[0]!, { t: 'start' });
      expect(state(code).ck).toBeTruthy();
      playOut(code, conns, `srv-ck-${_name}`, 60000);
      expect(state(code).phase).toBe('over');
      const final = JSON.stringify(state(code));
      for (const c of conns) {
        for (const m of c.msgs) {
          if (m.t !== 'update' && m.t !== 'sync') continue;
          const json = JSON.stringify(m);
          expect(json).not.toContain('"rng"');
          // Deck order never leaves the server: decks are sent as counts.
          expect(json).not.toMatch(/"decks":\{"trade":\[/);
          for (const it of m.log) {
            if (it.k === 'ev' && it.e.k === 'draw' && it.e.p !== m.game?.me && it.e.card)
              expect(['printer', 'constitution']).toContain(it.e.card);
          }
        }
      }
      store.close();
      store = new Store(join(dir, 'test.db'));
      rooms = new Rooms(store, { log: quiet });
      expect(JSON.stringify(state(code))).toBe(final);
    },
    120000,
  );
});
