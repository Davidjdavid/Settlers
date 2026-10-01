import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botMove, seedRng, viewFor, type GameState } from '@settlers/engine';
import type { ClientMsg, ServerMsg } from '../src/protocol';
import { Rooms, type Conn } from '../src/rooms';
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
let timers: { fn: () => void; ms: number }[];
const logs: string[] = [];

function open() {
  timers = [];
  rooms = new Rooms(store, {
    log: (m) => logs.push(m),
    cpuDelay: () => 1500,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => (timers = timers.filter((x) => x !== t)),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-cpu-'));
  store = new Store(join(dir, 'test.db'));
  logs.length = 0;
  open();
});
afterEach(() => {
  rooms.stop();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (c: FakeConn, m: ClientMsg) => rooms.handle(c, m);
const state = (code: string): GameState => rooms.getRoom(code)!.game!.state;

/** A room with one seated person. */
function lobby() {
  const host = new FakeConn();
  send(host, { t: 'create' });
  const code = host.last('sync').room.code;
  send(host, joinAs(store, 'Ann', 'red'));
  return { host, code };
}

/** Run the next CPU timer. */
function tick() {
  const t = timers.shift();
  expect(t!.ms).toBe(1500);
  t!.fn();
}

describe('CPU seats in the lobby', () => {
  it('a seated player adds a gray CPU; anyone renames, recolours or removes it', () => {
    const { host, code } = lobby();
    const watcher = new FakeConn();
    send(watcher, { t: 'hello', room: code });
    send(watcher, { t: 'addCpu' });
    expect(watcher.last('error').text).toMatch(/seat/);
    send(host, { t: 'addCpu' });
    send(host, { t: 'addCpu' });
    const seats = host.last('update').room.seats;
    expect(seats.map((s) => [s.nick, s.color, !!s.cpu, s.connected])).toEqual([
      ['Ann', 'red', false, true],
      ['CPU 1', 'gray', true, true],
      ['CPU 2', 'blue', true, true],
    ]);
    send(watcher, { t: 'editCpu', pid: seats[1]!.pid, nick: 'Turnip', color: 'purple' });
    send(watcher, { t: 'editCpu', pid: seats[2]!.pid, color: 'red' });
    expect(watcher.last('error').text).toMatch(/taken/);
    send(watcher, { t: 'editCpu', pid: seats[0]!.pid, nick: 'Hacked' });
    expect(watcher.last('error').text).toMatch(/isn’t a CPU/);
    send(watcher, { t: 'removeCpu', pid: seats[2]!.pid });
    expect(host.last('update').room.seats.map((s) => [s.nick, s.color])).toEqual([
      ['Ann', 'red'],
      ['Turnip', 'purple'],
    ]);
  });

  it('a CPU seat can’t be taken over; a person must be seated to start', () => {
    const { host, code } = lobby();
    send(host, { t: 'addCpu' });
    send(host, { t: 'addCpu' });
    send(host, { t: 'leave' });
    const c = new FakeConn();
    send(c, { t: 'hello', room: code });
    send(c, { t: 'claim', seat: 0 });
    expect(c.last('error').text).toMatch(/CPU/);
    // Sit back down: now it can start.
    send(host, joinAs(store, 'Ann', 'red'));
    send(host, { t: 'start' });
    expect(rooms.getRoom(code)!.game).not.toBeNull();
    expect(state(code).players.filter((p) => p.cpu)).toHaveLength(2);
  });
});

describe('CPU players in a game', () => {
  it('play a whole game on their own, 1.5 s per move, and the game replays after a restart', () => {
    const { host, code } = lobby();
    send(host, { t: 'addCpu' });
    send(host, { t: 'addCpu' });
    send(host, { t: 'start' });
    const rng = seedRng('human');
    let restarted = false;
    for (let step = 0; state(code).phase === 'play'; step++) {
      if (step > 40000) throw new Error('game did not finish');
      // Halfway through a CPU's pause, restart the server: the CPU carries on.
      if (!restarted && state(code).turnN > 30 && timers.length) {
        rooms.stop();
        store.close();
        store = new Store(join(dir, 'test.db'));
        open();
        restarted = true;
        send(host, { t: 'hello', room: code, token: undefined });
        const token = (host.msgs.find((m) => m.t === 'seat') as Extract<ServerMsg, { t: 'seat' }>).token;
        send(host, { t: 'hello', room: code, token });
        expect(timers).toHaveLength(1);
      }
      if (timers.length) {
        tick();
        continue;
      }
      const s = state(code);
      const me = s.players.findIndex((p) => !p.cpu);
      const a = botMove(viewFor(s, me), rng);
      expect(a, `stuck at ${s.stage}`).not.toBeNull();
      send(host, { t: 'act', id: `h${step}`, action: a! });
      expect(host.last('ack').ok).toBe(true);
    }
    expect(restarted).toBe(true);
    expect(logs.filter((m) => m.includes('CPU') && m.includes('rejected'))).toEqual([]);
    expect(timers).toEqual([]);
    // CPU moves are saved like anyone's: a restart rebuilds the same game.
    const final = JSON.stringify(state(code));
    rooms.stop();
    store.close();
    store = new Store(join(dir, 'test.db'));
    open();
    expect(JSON.stringify(state(code))).toBe(final);
    // Nothing the person was sent shows another hand.
    for (const m of host.msgs)
      if (m.t === 'update' || m.t === 'sync') expect(JSON.stringify(m)).not.toContain('"rng"');
  }, 60000);
});
