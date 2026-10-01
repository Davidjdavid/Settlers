import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '@settlers/engine';
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
}

let dir: string;
let store: Store;
let rooms: Rooms;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-polish-'));
  store = new Store(join(dir, 'test.db'));
  rooms = new Rooms(store, { log: () => {} });
});
afterEach(() => {
  rooms.stop();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (c: FakeConn, m: ClientMsg) => rooms.handle(c, m);
const state = (code: string): GameState => rooms.getRoom(code)!.game!.state;

function table(nicks: string[]) {
  const host = new FakeConn();
  send(host, { t: 'create' });
  const code = host.last('sync').room.code;
  const colors = ['red', 'blue', 'white', 'orange'] as const;
  const conns = nicks.map((nick, i) => {
    const c = i === 0 ? host : new FakeConn();
    if (i) send(c, { t: 'hello', room: code });
    send(c, joinAs(store, nick, colors[i]!));
    return c;
  });
  return { code, conns };
}

describe('personal settings follow the nickname', () => {
  it('saved by a seated player, seen on their other devices and in other rooms', () => {
    const { conns } = table(['Ann', 'Bob']);
    expect(conns[0]!.last('update').room.mySettings).toEqual({});
    send(conns[0]!, { t: 'saveSettings', settings: { confirmEnd: false, confirmTrade: false } });
    expect(conns[0]!.last('update').room.mySettings).toEqual({ confirmEnd: false, confirmTrade: false });
    // Bob's settings are his own.
    expect(conns[1]!.last('update').room.mySettings).toEqual({});
    // Another room, a new device, same nickname (any case).
    const { conns: other } = table(['ann']);
    expect(other[0]!.last('update').room.mySettings).toEqual({ confirmEnd: false, confirmTrade: false });
    // And after a restart.
    store.close();
    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: () => {} });
    const { conns: again } = table(['ANN']);
    expect(again[0]!.last('update').room.mySettings).toEqual({ confirmEnd: false, confirmTrade: false });
    const watcher = new FakeConn();
    send(watcher, { t: 'hello', room: again[0]!.last('update').room.code });
    send(watcher, { t: 'saveSettings', settings: {} });
    expect(watcher.last('error').text).toMatch(/seat/);
  });
});

describe('rejoining by name (SPEC 4.6)', () => {
  it('a disconnected player gets their seat back with the same nickname; a connected one is refused', () => {
    const { code, conns } = table(['Ann', 'Bob', 'Cat']);
    send(conns[0]!, { t: 'start' });
    const bobPid = conns[1]!.pid;
    rooms.disconnect(conns[1]!);
    const phone = new FakeConn();
    send(phone, { t: 'hello', room: code });
    send(phone, joinAs(store, ' bob ', 'yellow'));
    expect(phone.last('seat').pid).toBe(bobPid);
    expect(phone.last('update').game!.me).toBe(state(code).players.findIndex((p) => p.pid === bobPid));
    const thief = new FakeConn();
    send(thief, { t: 'hello', room: code });
    send(thief, joinAs(store, 'Cat', 'yellow'));
    expect(thief.last('error').text).toMatch(/in use/);
    send(thief, joinAs(store, 'Dan', 'yellow'));
    expect(thief.last('error').text).toMatch(/already started/);
  });
});

describe('colours', () => {
  it('gray is only for CPU players', () => {
    const { conns } = table(['Ann']);
    send(conns[0]!, { t: 'setColor', color: 'gray' });
    expect(conns[0]!.last('error').text).toMatch(/CPU/);
    const c = new FakeConn();
    send(c, { t: 'hello', room: conns[0]!.last('update').room.code });
    send(c, joinAs(store, 'Bob', 'gray'));
    expect(c.last('error').text).toMatch(/CPU/);
    send(conns[0]!, { t: 'addCpu' });
    expect(conns[0]!.last('update').room.seats[1]!.color).toBe('gray');
  });
});

describe('game rules during the game', () => {
  it('the player whose turn it is changes one; it is saved, replayed and kept for the next game', () => {
    const { code, conns } = table(['Ann', 'Bob']);
    send(conns[0]!, { t: 'start' });
    const s = state(code);
    const turn = conns.find((c) => c.pid === s.players[s.turn]!.pid)!;
    const other = conns.find((c) => c !== turn)!;
    send(other, { t: 'act', id: 'r1', action: { type: 'setRule', rule: 'bank3to1', value: true } });
    expect(other.last('ack').ok).toBe(false);
    send(turn, { t: 'act', id: 'r2', action: { type: 'setRule', rule: 'bank3to1', value: true } });
    expect(turn.last('ack').ok).toBe(true);
    expect(state(code).config.houseRules).toEqual({ handBack: true, undo: true, bank3to1: true });
    expect(rooms.getRoom(code)!.options.houseRules.bank3to1).toBe(true);
    const log = other.last('update').log;
    expect(log.some((it) => it.k === 'ev' && it.e.k === 'rule')).toBe(true);
    // Restart: the rule is still on, because the change is a saved move.
    store.close();
    store = new Store(join(dir, 'test.db'));
    rooms = new Rooms(store, { log: () => {} });
    expect(state(code).config.houseRules?.bank3to1).toBe(true);
    expect(rooms.getRoom(code)!.options.houseRules.bank3to1).toBe(true);
  });

  it('dice are handed back through the server', () => {
    const { code, conns } = table(['Ann', 'Bob']);
    send(conns[0]!, { t: 'start' });
    const by = (p: number) => conns.find((c) => c.pid === state(code).players[p]!.pid)!;
    let n = 0;
    while (state(code).stage === 'setup') {
      const s = state(code);
      send(by(s.turn), { t: 'act', id: `s${n++}`, action: moves(s, s.turn)[0]! });
    }
    const first = state(code).turn;
    send(by(first), { t: 'act', id: 'roll', action: { type: 'roll' } });
    while (state(code).stage !== 'main') {
      const s = state(code);
      const p = s.stage === 'discard' ? Number(Object.keys(s.discard!)[0]) : s.turn;
      const a = moves(s, p).find((x) => x.type !== 'respond')!;
      send(by(p), {
        t: 'act',
        id: `x${n++}`,
        action: s.stage === 'discard' ? { type: 'discard', cards: { wood: s.discard![p]! } } : a,
      });
    }
    const before = JSON.stringify({ ...state(code), seq: 0 });
    send(by(first), { t: 'act', id: 'end', action: { type: 'end' } });
    const next = state(code).turn;
    send(by(first), { t: 'act', id: 'ask', action: { type: 'askBack' } });
    expect(by(next).last('update').game!.back).toEqual({ from: first, asked: true, refused: false });
    send(by(next), { t: 'act', id: 'give', action: { type: 'handBack' } });
    expect(state(code).turn).toBe(first);
    expect(JSON.stringify({ ...state(code), seq: 0 })).toBe(before);
  });
});
