/*
 * Medium, Hard and custom CPUs through the server (docs/bot-medium-hard.md): picking a level or
 * a custom CPU for a seat, the custom CPU library, the room's CPU trading switches, the 1–3 s
 * pace, offers a person never answers, and whole games on a fake clock.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HARD, MEDIUM, botMove, seedRng, viewFor, type GameState } from '@settlers/engine';
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
const logs: string[] = [];

/** `delay`: a fixed CPU pause, or 'real' for the real 1–3 s. */
function open(delay: number | 'real' = 1500) {
  timers = [];
  rooms = new Rooms(store, {
    log: (m) => logs.push(m),
    ...(delay !== 'real' ? { cpuDelay: () => delay } : {}),
    cpuOfferWait: 20_000,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => (timers = timers.filter((x) => x !== t)),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-cpulevels-'));
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

function lobby() {
  const host = new FakeConn();
  send(host, { t: 'create' });
  const code = host.last('sync').room.code;
  send(host, joinAs(store, 'Ann', 'red'));
  return { host, code };
}
const seats = (c: FakeConn) => c.last('update').room.seats;
/** Every event of the room's game, from the saved moves. */
const allEvents = (code: string) =>
  store.loadActions(rooms.getRoom(code)!.game!.row.id).flatMap((a) => a.events);

describe('Picking a CPU', () => {
  it('a CPU starts Easy; anyone can make it Medium or Hard, and its tag says so', () => {
    const { host, code } = lobby();
    send(host, { t: 'addCpu' });
    const cpu = seats(host)[1]!;
    expect([cpu.level, cpu.levelName]).toEqual(['easy', 'Easy']);
    const watcher = new FakeConn();
    send(watcher, { t: 'hello', room: code });
    send(watcher, { t: 'editCpu', pid: cpu.pid, level: 'hard' });
    expect(seats(host)[1]).toMatchObject({ level: 'hard', levelName: 'Hard' });
    expect(JSON.stringify(host.msgs)).toContain('CPU 1 now plays as Hard');
  });

  it('custom CPUs are shared, picked like a level, and a seat keeps the personality it picked', () => {
    const { host } = lobby();
    const other = new FakeConn();
    send(other, { t: 'cpus' });
    expect(other.last('cpus').list).toEqual([]);
    send(host, { t: 'saveCpu', name: 'Turnip', persona: { ...MEDIUM, robber: 'leader' }, by: 'Ann' });
    const turnip = host.last('cpus').list[0]!;
    expect(turnip).toMatchObject({
      name: 'Turnip',
      by: 'Ann',
      persona: { base: 'medium', robber: 'leader' },
    });
    send(other, { t: 'cpus' });
    expect(other.last('cpus').list.map((c) => c.name)).toEqual(['Turnip']);
    // Names are unique, and can't be a built-in level.
    send(other, { t: 'saveCpu', name: 'turnip', persona: MEDIUM });
    expect(other.last('error').text).toMatch(/already a CPU called/);
    send(other, { t: 'saveCpu', name: 'Hard', persona: MEDIUM });
    expect(other.last('error').text).toMatch(/already a CPU called/);

    send(host, { t: 'addCpu' });
    const pid = seats(host)[1]!.pid;
    send(host, { t: 'editCpu', pid, level: turnip.id });
    expect(seats(host)[1]).toMatchObject({ level: turnip.id, levelName: 'Turnip' });
    // Editing Turnip later doesn't change the seat that picked it.
    send(other, { t: 'saveCpu', id: turnip.id, name: 'Turnip', persona: { ...HARD, chatter: 'off' } });
    const room = rooms.getRoom(host.last('update').room.code)!;
    expect(room.seats[1]!.persona).toMatchObject({ base: 'medium', robber: 'leader' });
    // Deleting it: gone from the list, and it can't be picked any more.
    send(other, { t: 'deleteCpu', id: turnip.id });
    expect(other.last('cpus').list).toEqual([]);
    send(host, { t: 'addCpu' });
    send(host, { t: 'editCpu', pid: seats(host)[2]!.pid, level: turnip.id });
    expect(host.last('error').text).toMatch(/gone/);
  });

  it('a custom CPU’s stats are under its own name, even after it is deleted', () => {
    const { host } = lobby();
    send(host, { t: 'saveCpu', name: 'Beet', persona: HARD });
    const id = host.last('cpus').list[0]!.id;
    send(host, { t: 'deleteCpu', id });
    send(host, { t: 'stats', who: `cpu:${id}` });
    expect(host.last('stats').name).toBe('Beet (CPU)');
    send(host, { t: 'stats', who: 'cpu:hard' });
    expect(host.last('stats').name).toBe('Hard CPU');
    send(host, { t: 'stats', who: 'cpu:toString' });
    expect(host.last('error').text).toMatch(/No such player/);
    send(host, { t: 'stats', who: 'cpu:c-nobody' });
    expect(host.last('error').text).toMatch(/No such player/);
  });
});

/** Ann and two CPUs; plays until the game ends. `answer` decides whether Ann answers a CPU's offer. */
function play(code: string, host: FakeConn, answer: (step: number) => boolean) {
  const rng = seedRng('ann');
  const fired: number[] = [];
  for (let step = 0; state(code).phase === 'play'; step++) {
    if (step > 60000) throw new Error('game did not finish');
    const s = state(code);
    const me = s.players.findIndex((p) => !p.cpu);
    const a = botMove(viewFor(s, me), rng);
    const cpuOffer = a?.type === 'respond' && s.players[s.offers.find((o) => o.id === a.id)!.from]!.cpu;
    if (timers.length && (!a || (cpuOffer && !answer(step)))) {
      const t = timers.shift()!;
      fired.push(t.ms);
      t.fn();
      continue;
    }
    expect(a, `stuck at ${s.stage}`).not.toBeNull();
    send(host, { t: 'act', id: `h${step}`, action: a! });
    expect(host.last('ack').ok).toBe(true);
  }
  return fired;
}

describe('Medium and Hard in a game', () => {
  it('play whole games with a person; a restart mid-game loses nothing but Hard’s memory', () => {
    const { host, code } = lobby();
    send(host, { t: 'addCpu' });
    send(host, { t: 'addCpu' });
    const [, m, h] = seats(host);
    send(host, { t: 'editCpu', pid: m!.pid, level: 'medium' });
    send(host, { t: 'editCpu', pid: h!.pid, level: 'hard' });
    send(host, { t: 'start' });
    let restarted = false;
    const rng = seedRng('ann');
    for (let step = 0; state(code).phase === 'play'; step++) {
      if (step > 60000) throw new Error('game did not finish');
      if (!restarted && state(code).turnN > 25 && timers.length) {
        rooms.stop();
        store.close();
        store = new Store(join(dir, 'test.db'));
        open();
        restarted = true;
        send(host, { t: 'hello', room: code });
        const token = (host.msgs.find((x) => x.t === 'seat') as Extract<ServerMsg, { t: 'seat' }>).token;
        send(host, { t: 'hello', room: code, token });
        expect(rooms.getRoom(code)!.seats.map((x) => x.level ?? null)).toEqual([null, 'medium', 'hard']);
      }
      if (timers.length) {
        timers.shift()!.fn();
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
    expect(logs.filter((x) => x.includes('rejected') || x.includes('memory'))).toEqual([]);
  }, 120000);

  it('every CPU move waits 1 to 3 seconds; an offer nobody answers is withdrawn after 20 s', () => {
    rooms.stop();
    open('real');
    const { host, code } = lobby();
    send(host, { t: 'addCpu' });
    send(host, { t: 'addCpu' });
    for (const st of seats(host).slice(1)) send(host, { t: 'editCpu', pid: st.pid, level: 'medium' });
    send(host, { t: 'start' });
    // Ann never answers the CPUs' offers.
    const fired = play(code, host, () => false);
    const pauses = fired.filter((ms) => ms !== 20_000 && ms !== 4000);
    // Games vary in length (the server rolls real dice); any game has well over 30 CPU moves.
    expect(pauses.length).toBeGreaterThan(30);
    expect(pauses.every((ms) => ms >= 1000 && ms <= 3000)).toBe(true);
    expect(Math.max(...pauses)).toBeGreaterThan(2000);
    const waits = fired.filter((ms) => ms === 20_000).length;
    const offers = allEvents(code).filter((e) => e.k === 'offer').length;
    expect(waits).toBeGreaterThan(0);
    expect(offers).toBeGreaterThan(0);
    expect(logs.filter((x) => x.includes('rejected'))).toEqual([]);
  }, 120000);

  it('with "CPU trading" off, CPUs never offer and turn down every offer', () => {
    const { host, code } = lobby();
    send(host, { t: 'setOptions', options: { ...DEFAULT_OPTIONS, cpuTrading: false } });
    send(host, { t: 'addCpu' });
    send(host, { t: 'addCpu' });
    for (const st of seats(host).slice(1)) send(host, { t: 'editCpu', pid: st.pid, level: 'medium' });
    send(host, { t: 'start' });
    // Ann answers every offer (there should be none from CPUs) and offers trades herself.
    const rng = seedRng('offers');
    for (let step = 0; state(code).phase === 'play'; step++) {
      if (step > 60000) throw new Error('game did not finish');
      if (timers.length) {
        timers.shift()!.fn();
        continue;
      }
      const s = state(code);
      const me = s.players.findIndex((p) => !p.cpu);
      if (s.turn === me && s.stage === 'main' && !s.offers.length && step % 3 === 0) {
        const have = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as const).find(
          (r) => s.players[me]!.res[r] > 0,
        );
        if (have) {
          send(host, {
            t: 'act',
            id: `o${step}`,
            action: { type: 'offer', give: { [have]: 2 }, want: { ore: 1 } },
          });
          if (host.last('ack').ok) continue;
        }
      }
      const a = botMove(viewFor(s, me), rng);
      expect(a, `stuck at ${s.stage}`).not.toBeNull();
      send(host, { t: 'act', id: `h${step}`, action: a! });
      expect(host.last('ack').ok).toBe(true);
    }
    const events = allEvents(code);
    const cpus = new Set(state(code).players.flatMap((p, i) => (p.cpu ? [i] : [])));
    expect(events.filter((e) => e.k === 'offer' && cpus.has(e.offer.from))).toEqual([]);
    expect(events.filter((e) => e.k === 'respond' && cpus.has(e.p) && e.yes)).toEqual([]);
    expect(events.filter((e) => e.k === 'respond' && cpus.has(e.p)).length).toBeGreaterThan(0);
  }, 120000);
});
