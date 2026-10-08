/*
 * Milestone 8 through the server: keep playing after a win (SPEC 8.9) with stats that keep the
 * first win as the result and list overtime wins, and the bank setting (8.1).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botMove, keepMinTarget, seedRng, viewFor, type GameState, type RngState } from '@settlers/engine';
import { DEFAULT_OPTIONS, type ClientMsg, type ServerMsg } from '../src/protocol';
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

function open() {
  timers = [];
  rooms = new Rooms(store, {
    log: () => {},
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
  dir = mkdtempSync(join(tmpdir(), 'settlers-m8-'));
  store = new Store(join(dir, 'test.db'));
  open();
});
afterEach(() => {
  rooms.stop();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (c: FakeConn, m: ClientMsg) => rooms.handle(c, m);
const state = (code: string): GameState => rooms.getRoom(code)!.game!.state;

function table(nicks: string[], cpus = 0) {
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
  for (let i = 0; i < cpus; i++) send(host, { t: 'addCpu' });
  return { code, conns };
}

/** Play until `until` (or the game ends): people move with the test bot, CPU timers as they come. */
function play(code: string, conns: FakeConn[], until: () => boolean, rng: RngState = seedRng('people')) {
  for (let step = 0; !until() && state(code).phase === 'play'; step++) {
    if (step > 60000) throw new Error('game did not finish');
    if (timers.length) {
      timers.shift()!.fn();
      continue;
    }
    const s = state(code);
    let moved = false;
    for (const c of conns) {
      const me = s.players.findIndex((p) => p.pid === c.pid);
      const a = me >= 0 ? botMove(viewFor(s, me), rng) : null;
      if (!a) continue;
      send(c, { t: 'act', id: `m${s.seq}-${me}`, action: a });
      if (!c.last('ack').ok) throw new Error(`rejected ${JSON.stringify(a)}: ${c.last('ack').error}`);
      moved = true;
      break;
    }
    if (!moved && !timers.length) throw new Error(`stuck at ${s.stage}`);
  }
}

const seatOf = (code: string, c: FakeConn) => state(code).players.findIndex((p) => p.pid === c.pid);

describe('Keep playing through the server (SPEC 8.9)', () => {
  it('everyone agrees, the game reopens and plays on; stats keep the first win and list overtime', () => {
    const { code, conns } = table(['Ann', 'Bob'], 1);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => false);
    const won = state(code);
    expect(won.phase).toBe('over');
    const first = won.winner!;
    const row = () => store.loadGame(rooms.getRoom(code)!.game!.row.id)!;
    expect(row().endedAt).not.toBeNull();
    expect(row().endReason).toBe('won');

    // Bob asks for 2 more; the CPU agrees at once; Ann agrees.
    const [ann, bob] = conns as [FakeConn, FakeConn];
    const target = keepMinTarget(won) + 1;
    send(bob, { t: 'act', id: 'ask', action: { type: 'askKeep', target } });
    expect(bob.last('ack').ok).toBe(true);
    expect(ann.last('update').game!.keep!.ask).toMatchObject({ p: seatOf(code, bob), target });
    send(ann, { t: 'act', id: 'yes', action: { type: 'answerKeep', yes: true } });
    expect(ann.last('ack').ok).toBe(true);
    expect(state(code).phase).toBe('play');
    expect(state(code).config.winVP).toBe(target);
    // Open again (it can be saved and resumed), but still a won game for stats.
    expect(row().endedAt).toBeNull();
    expect(row().endReason).toBe('won');
    send(ann, { t: 'stats', who: store.profileByName('Ann')!.id });
    const before = ann.last('stats').record;
    expect(before.games).toBe(1);
    expect(before.wins).toBe(seatOf(code, ann) === first ? 1 : 0);

    // Play on to the overtime win.
    play(code, conns, () => false);
    const end = state(code);
    expect(end.phase).toBe('over');
    expect(end.keep!.wins).toHaveLength(1);
    const ot = end.keep!.wins[0]!.p;
    expect(row().endedAt).not.toBeNull();
    for (const [c, name] of [
      [ann, 'Ann'],
      [bob, 'Bob'],
    ] as const) {
      send(c, { t: 'stats', who: store.profileByName(name)!.id });
      const rec = c.last('stats').record;
      const seat = seatOf(code, c);
      // Wins and points as at the first win; the overtime win has its own count.
      expect(rec.wins).toBe(seat === first ? 1 : 0);
      expect(rec.overtime).toBe(seat === ot ? 1 : 0);
      expect(rec.past[0]!.overtime).toEqual([{ name: end.players[ot]!.nick, target }]);
      expect(rec.past[0]!.players.find((p) => p.won)!.name).toBe(end.players[first]!.nick);
    }
  }, 120000);

  it('overtime survives a restart and plays on to its win', () => {
    const { code, conns } = table(['Ann', 'Bob']);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => false);
    const [ann, bob] = conns as [FakeConn, FakeConn];
    const target = keepMinTarget(state(code));
    send(ann, { t: 'act', id: 'ask', action: { type: 'askKeep', target } });
    send(bob, { t: 'act', id: 'yes', action: { type: 'answerKeep', yes: true } });
    expect(state(code).phase).toBe('play');
    const before = JSON.stringify(state(code));
    const tokens = conns.map((c) => c.last('seat').token);

    rooms.stop();
    store.close();
    store = new Store(join(dir, 'test.db'));
    open();
    expect(JSON.stringify(state(code))).toBe(before);
    const back = tokens.map((token) => {
      const c = new FakeConn();
      send(c, { t: 'hello', room: code, token });
      return c;
    });
    expect(back[0]!.last('sync').game!.keep).toMatchObject({ on: true, wins: [] });
    expect(back[0]!.last('sync').game!.winVP).toBe(target);
    play(code, back, () => false);
    expect(state(code).phase).toBe('over');
    expect(state(code).keep!.wins).toHaveLength(1);
  }, 120000);

  it('one "no" leaves the game finished', () => {
    const { code, conns } = table(['Ann', 'Bob']);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => false);
    const [ann, bob] = conns as [FakeConn, FakeConn];
    send(ann, { t: 'act', id: 'ask', action: { type: 'askKeep', target: keepMinTarget(state(code)) } });
    send(bob, { t: 'act', id: 'no', action: { type: 'answerKeep', yes: false } });
    expect(bob.last('ack').ok).toBe(true);
    expect(state(code).phase).toBe('over');
    expect(store.loadGame(rooms.getRoom(code)!.game!.row.id)!.endedAt).not.toBeNull();
  }, 120000);
});

describe('The bank setting (SPEC 8.1)', () => {
  it('is chosen before the game, saved with it, and shown to everyone', () => {
    const { code, conns } = table(['Ann', 'Bob', 'Cat']);
    send(conns[0]!, {
      t: 'setOptions',
      options: { ...DEFAULT_OPTIONS, ck: true, winVP: 13, bank: 'unlimited' },
    });
    send(conns[0]!, { t: 'start' });
    expect(state(code).config.bank).toBe('unlimited');
    expect(conns[1]!.last('update').game!.rules.bank).toBe('unlimited');
    // Locked once the game starts.
    send(conns[0]!, { t: 'setOptions', options: { ...DEFAULT_OPTIONS, ck: true, winVP: 13 } });
    expect(conns[0]!.last('error').text).toMatch(/before the game starts/);
  });
});

describe('Log notes (SPEC 8.10)', () => {
  const notes = (msgs: ServerMsg[]) =>
    msgs.flatMap((m) =>
      m.t === 'update' || m.t === 'sync'
        ? m.log.flatMap((it) => (it.k === 'ev' && it.e.k === 'blocked' ? [it] : []))
        : [],
    );

  it('everyone sees what the robber blocked, and the notes come back after a restart', () => {
    const { code, conns } = table(['Ann', 'Bob', 'Cat']);
    // A long game, so the robber surely blocks twice before anyone wins (the dice are random:
    // to 10 points about 1 game in 30 ended first).
    send(conns[0]!, {
      t: 'setOptions',
      options: { ...rooms.getRoom(code)!.options, winVP: 20 },
    });
    expect(rooms.getRoom(code)!.options.winVP).toBe(20);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => notes(conns[0]!.msgs).length >= 2);
    const seen = notes(conns[0]!.msgs);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // The same notes for every player: they're public.
    for (const c of conns) expect(notes(c.msgs)).toEqual(seen);
    const token = conns[1]!.last('seat').token;

    rooms.stop();
    store.close();
    store = new Store(join(dir, 'test.db'));
    open();
    const back = new FakeConn();
    send(back, { t: 'hello', room: code, token });
    // Rebuilt from the saved moves: the same notes, in the same places in the log.
    const log = back.last('sync').log;
    expect(notes([back.last('sync')])).toEqual(seen);
    const at = (l: typeof log, n: (typeof seen)[number]) =>
      l.findIndex((it) => it.k === 'ev' && it.seq === n.seq && it.e.k === 'blocked');
    for (const n of seen) expect(log[at(log, n) - 1]).toMatchObject({ k: 'ev', seq: n.seq });
  }, 120000);
});
