import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RES,
  legalActions,
  mustDiscard,
  nextInt,
  seedRng,
  total,
  type Action,
  type GameState,
  type PartialRes,
} from '@settlers/engine';
import type { ClientMsg, ServerMsg } from '../src/protocol';
import { Rooms, type Conn } from '../src/rooms';
import { Store } from '../src/store';
import { joinAs, moves } from './util';

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
  clear() {
    this.msgs = [];
  }
}

let dir: string;
let store: Store;
let rooms: Rooms;
const quiet = () => {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-test-'));
  store = new Store(join(dir, 'test.db'));
  rooms = new Rooms(store, { log: quiet });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function send(rooms: Rooms, c: FakeConn, m: ClientMsg) {
  rooms.handle(c, m);
}

/** Create a room with n seated players; returns their connections and tokens. */
function table(n: number): { code: string; conns: FakeConn[]; tokens: string[] } {
  const host = new FakeConn();
  send(rooms, host, { t: 'create' });
  const code = host.last('sync').room.code;
  const colors = ['red', 'blue', 'white', 'purple'] as const;
  const conns = [host];
  for (let i = 1; i < n; i++) {
    const c = new FakeConn();
    send(rooms, c, { t: 'hello', room: code });
    conns.push(c);
  }
  const tokens = conns.map((c, i) => {
    send(rooms, c, joinAs(store, `P${i}`, colors[i]!));
    return c.last('seat').token;
  });
  return { code, conns, tokens };
}

function state(code: string): GameState {
  return rooms.getRoom(code)!.game!.state;
}

function connFor(conns: FakeConn[], s: GameState, seat: number): FakeConn {
  return conns.find((c) => c.pid === s.players[seat]!.pid)!;
}

let actN = 0;
/** Play one random legal move through the server. Returns false when the game is over. */
function randomMove(code: string, conns: FakeConn[], rng: [number, number, number, number]): boolean {
  const s = state(code);
  if (s.phase === 'over') return false;
  let seat = s.turn;
  let action: Action;
  if (s.stage === 'discard') {
    seat = Number(Object.keys(s.discard!)[0]);
    const left = { ...s.players[seat]!.res };
    const cards: PartialRes = {};
    for (let i = 0; i < mustDiscard(s, seat); i++) {
      const r = RES.filter((x) => left[x] > 0)[0]!;
      left[r]--;
      cards[r] = (cards[r] ?? 0) + 1;
    }
    action = { type: 'discard', cards };
  } else {
    const acts = moves(s, seat).filter(
      (a) => a.type !== 'respond' && a.type !== 'cancel' && a.type !== 'confirm',
    );
    const builds = acts.filter((a) =>
      ['city', 'settlement', 'road', 'buyDev', 'setup', 'robber', 'roll', 'freeRoad'].includes(a.type),
    );
    action = (builds.length ? builds : acts)[nextInt(rng, (builds.length ? builds : acts).length)]!;
  }
  const c = connFor(conns, s, seat);
  const id = `a${actN++}`;
  send(rooms, c, { t: 'act', id, action });
  const ack = c.last('ack');
  if (ack.id !== id || !ack.ok) throw new Error(`move rejected: ${JSON.stringify(action)} ${ack.error}`);
  return true;
}

describe('rooms', () => {
  it('creates rooms, seats players and starts a game', () => {
    const { code, conns } = table(3);
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    send(rooms, conns[0]!, { t: 'start' });
    const u = conns[1]!.last('update');
    expect(u.room.phase).toBe('play');
    expect(u.game?.stage).toBe('setup');
    expect(u.room.seats.every((s) => s.connected)).toBe(true);
  });

  it('rejects joins after start, duplicate colors and empty nicks', () => {
    const host = new FakeConn();
    send(rooms, host, { t: 'create' });
    send(rooms, host, { t: 'newProfile', name: '   ', color: 'red' });
    expect(host.last('error').text).toMatch(/name/);
    send(rooms, host, { t: 'join', profile: 'p-nobody', color: 'red' });
    expect(host.last('error').text).toMatch(/name from the list/);
    send(rooms, host, joinAs(store, 'Ann', 'red'));
    const b = new FakeConn();
    send(rooms, b, { t: 'hello', room: host.last('seat').room });
    send(rooms, b, joinAs(store, 'Bob', 'red'));
    expect(b.last('error').text).toMatch(/color/);
    send(rooms, b, joinAs(store, 'Bob', 'blue'));
    send(rooms, host, { t: 'start' });
    const c = new FakeConn();
    send(rooms, c, { t: 'hello', room: host.last('seat').room });
    send(rooms, c, joinAs(store, 'Cat', 'white'));
    expect(c.last('error').text).toMatch(/started/);
  });

  it('the mover gets the new state before the ack', () => {
    const { code, conns } = table(2);
    send(rooms, conns[0]!, { t: 'start' });
    const s = state(code);
    const turn = connFor(conns, s, s.turn);
    turn.clear();
    send(rooms, turn, { t: 'act', id: 'order', action: moves(s, s.turn)[0]! });
    expect(turn.msgs.map((m) => m.t)).toEqual(['update', 'ack']);
  });

  it('only the player whose turn it is can move, and resends are applied once', () => {
    const { code, conns } = table(3);
    send(rooms, conns[0]!, { t: 'start' });
    const s = state(code);
    const notTurn = connFor(conns, s, (s.turn + 1) % 3);
    send(rooms, notTurn, { t: 'act', id: 'x1', action: moves(s, s.turn)[0]! });
    expect(notTurn.last('ack')).toMatchObject({ id: 'x1', ok: false, error: 'Wait for your turn' });

    const turn = connFor(conns, s, s.turn);
    const a = moves(s, s.turn)[0]!;
    send(rooms, turn, { t: 'act', id: 'same', action: a });
    expect(state(code).seq).toBe(1);
    send(rooms, turn, { t: 'act', id: 'same', action: a });
    expect(turn.last('ack')).toMatchObject({ id: 'same', ok: true });
    expect(state(code).seq).toBe(1);
  });

  it('never sends a player anyone else’s hidden cards', () => {
    const { code, conns } = table(3);
    send(rooms, conns[0]!, { t: 'start' });
    const rng = seedRng('leak');
    for (let i = 0; i < 400 && randomMove(code, conns, rng); i++);
    const s = state(code);
    // The game's own seed never leaves the server (the table's board seed is public by design).
    const gameSeed = rooms.getRoom(code)!.game!.row.seed;
    for (const c of conns) {
      const seat = s.players.findIndex((p) => p.pid === c.pid);
      for (const m of c.msgs) {
        if (m.t !== 'update' && m.t !== 'sync') continue;
        const json = JSON.stringify(m);
        expect(json).not.toContain('"rng"');
        expect(json).not.toContain('"deck"');
        expect(json).not.toContain(gameSeed);
        if (m.game) expect(json).not.toContain('"seed"');
        if (m.game) {
          // Only your own hand, and other players appear as counts.
          expect(m.game.me).toBe(seat);
          for (const p of m.game.players) expect(Object.keys(p)).not.toContain('res');
        }
        for (const it of m.log) {
          if (it.k !== 'ev') continue;
          if (it.e.k === 'steal' && it.e.p !== seat && it.e.from !== seat) expect(it.e.r).toBeNull();
          if (it.e.k === 'buyDev' && it.e.p !== seat) expect(it.e.card).toBeNull();
        }
      }
    }
  });

  it('survives a restart: same state, seats reclaimed by token', () => {
    const { code, conns, tokens } = table(3);
    send(rooms, conns[0]!, { t: 'start' });
    const rng = seedRng('restart');
    for (let i = 0; i < 150 && randomMove(code, conns, rng); i++);
    const before = JSON.stringify(state(code));
    store.close();

    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: quiet });
    expect(JSON.stringify(state(code))).toBe(before);

    const back = new FakeConn();
    send(rooms, back, { t: 'hello', room: code, token: tokens[1] });
    const sync = back.last('sync');
    expect(sync.room.me).toBe(conns[1]!.pid);
    expect(sync.game?.hand).not.toBeNull();
    expect(sync.log.some((it) => it.k === 'ev')).toBe(true);
    // Play continues after the restart.
    const newConns = conns.map((c, i) => {
      const n = new FakeConn();
      send(rooms, n, { t: 'hello', room: code, token: tokens[i] });
      return n;
    });
    for (let i = 0; i < 50 && randomMove(code, newConns, rng); i++);
    expect(state(code).seq).toBeGreaterThan(JSON.parse(before).seq);
  });

  it('plays complete games through the server and replays them identically after restart', () => {
    for (let g = 0; g < 3; g++) {
      const { code, conns } = table(2 + g);
      send(rooms, conns[0]!, { t: 'start' });
      const rng = seedRng(`full-${g}`);
      let n = 0;
      while (randomMove(code, conns, rng)) if (++n > 5000) throw new Error('game did not finish');
      expect(state(code).phase).toBe('over');
      const final = JSON.stringify(state(code));
      store.close();
      store = new Store(join(dir, 'test.db'));
      rooms = new Rooms(store, { log: quiet });
      expect(JSON.stringify(state(code))).toBe(final);
    }
  });

  it('a failed save changes nothing and tells nobody', () => {
    const { code, conns } = table(2);
    send(rooms, conns[0]!, { t: 'start' });
    const s = state(code);
    const turn = connFor(conns, s, s.turn);
    const other = conns.find((c) => c !== turn)!;
    other.clear();
    const orig = store.insertAction.bind(store);
    store.insertAction = () => {
      throw new Error('disk full');
    };
    expect(() => send(rooms, turn, { t: 'act', id: 'boom', action: moves(s, s.turn)[0]! })).toThrow(
      'disk full',
    );
    expect(state(code)).toBe(s);
    expect(other.msgs).toEqual([]);
    store.insertAction = orig;
    send(rooms, turn, { t: 'act', id: 'boom', action: moves(s, s.turn)[0]! });
    expect(turn.last('ack').ok).toBe(true);
  });

  it('marks players disconnected and back', () => {
    const { conns, tokens, code } = table(2);
    rooms.disconnect(conns[1]!);
    expect(conns[0]!.last('update').room.seats[1]!.connected).toBe(false);
    const back = new FakeConn();
    send(rooms, back, { t: 'hello', room: code, token: tokens[1] });
    expect(conns[0]!.last('update').room.seats[1]!.connected).toBe(true);
  });

  it('ending a game needs a request, warns everyone, then a confirm', () => {
    const { code, conns } = table(3);
    send(rooms, conns[0]!, { t: 'start' });
    send(rooms, conns[1]!, { t: 'resetConfirm' });
    expect(conns[1]!.last('error').text).toMatch(/Ask again/);
    send(rooms, conns[1]!, { t: 'resetRequest' });
    expect(conns[0]!.last('notice')).toMatchObject({ kind: 'warn' });
    expect(conns[2]!.last('update').room.pendingReset?.pid).toBe(conns[1]!.pid);
    // Someone else can't confirm it, and anyone can cancel it.
    send(rooms, conns[0]!, { t: 'resetConfirm' });
    expect(rooms.getRoom(code)!.game).not.toBeNull();
    send(rooms, conns[2]!, { t: 'resetCancel' });
    expect(conns[0]!.last('update').room.pendingReset).toBeNull();
    send(rooms, conns[1]!, { t: 'resetConfirm' });
    expect(rooms.getRoom(code)!.game).not.toBeNull();
    // Request + confirm by the same player ends it; seats stay.
    send(rooms, conns[1]!, { t: 'resetRequest' });
    send(rooms, conns[1]!, { t: 'resetConfirm' });
    expect(rooms.getRoom(code)!.game).toBeNull();
    expect(conns[0]!.last('sync').room).toMatchObject({ phase: 'lobby' });
    expect(rooms.getRoom(code)!.seats).toHaveLength(3);
  });

  it('reset requests expire', () => {
    let t = 1000;
    rooms = new Rooms(store, { log: quiet, now: () => t });
    const { code, conns } = table(2);
    send(rooms, conns[0]!, { t: 'start' });
    send(rooms, conns[0]!, { t: 'resetRequest' });
    t += 3 * 60 * 1000;
    send(rooms, conns[0]!, { t: 'resetConfirm' });
    expect(rooms.getRoom(code)!.game).not.toBeNull();
  });

  it('a disconnected seat can be taken over, with a warning; a connected one cannot', () => {
    const { code, conns, tokens } = table(3);
    send(rooms, conns[0]!, { t: 'start' });
    const newcomer = new FakeConn();
    send(rooms, newcomer, { t: 'hello', room: code });
    send(rooms, newcomer, { t: 'claim', seat: 1 });
    expect(newcomer.last('error').text).toMatch(/still connected/);
    rooms.disconnect(conns[1]!);
    send(rooms, newcomer, { t: 'claim', seat: 1 });
    const seat = newcomer.last('seat');
    expect(seat.pid).toBe(rooms.getRoom(code)!.seats[1]!.pid);
    expect(conns[0]!.last('notice')).toMatchObject({ kind: 'warn' });
    // The old token no longer works.
    const old = new FakeConn();
    send(rooms, old, { t: 'hello', room: code, token: tokens[1] });
    expect(old.last('sync').room.me).toBeNull();
    const fresh = new FakeConn();
    send(rooms, fresh, { t: 'hello', room: code, token: seat.token });
    expect(fresh.last('sync').room.me).toBe(seat.pid);
  });

  it('chat is stored and included when you rejoin', () => {
    const { code, conns, tokens } = table(2);
    send(rooms, conns[0]!, { t: 'chat', text: '  hello\u0007 there  ' });
    expect(conns[1]!.last('update').log).toContainEqual(
      expect.objectContaining({ k: 'chat', text: 'hello there', nick: 'P0' }),
    );
    const back = new FakeConn();
    send(rooms, back, { t: 'hello', room: code, token: tokens[1] });
    expect(back.last('sync').log).toContainEqual(expect.objectContaining({ k: 'chat', text: 'hello there' }));
  });

  it('unknown rooms are reported', () => {
    const c = new FakeConn();
    send(rooms, c, { t: 'hello', room: 'ZZZZ' });
    expect(c.last('error').text).toMatch(/no room/);
    send(rooms, c, { t: 'start' });
    expect(c.last('error').text).toMatch(/Join a room/);
  });
});

describe('a hand total never goes negative in views', () => {
  it('counts match', () => {
    const { code, conns } = table(2);
    send(rooms, conns[0]!, { t: 'start' });
    const rng = seedRng('counts');
    for (let i = 0; i < 100 && randomMove(code, conns, rng); i++);
    const s = state(code);
    const v = conns[0]!.last('update').game!;
    s.players.forEach((p, i) => expect(v.players[i]!.resCount).toBe(total(p.res)));
  });
});
