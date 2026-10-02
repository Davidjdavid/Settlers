import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  botMove,
  legalActions,
  nextFloat,
  seedRng,
  statsFromLog,
  viewFor,
  type GameState,
  type RngState,
} from '@settlers/engine';
import { ClientMsgSchema, type ClientMsg, type ServerMsg } from '../src/protocol';
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
  const chat = seedRng('chatter');
  rooms = new Rooms(store, {
    log: () => {},
    cpuDelay: () => 1500,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => (timers = timers.filter((x) => x !== t)),
    // Predictable chatter.
    chatRandom: () => nextFloat(chat),
  });
}
function restart() {
  rooms.stop();
  store.close();
  store = new Store(join(dir, 'test.db'));
  open();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-m5-'));
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

/** A room with these people seated (and `cpus` CPU players). */
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

/** Play until `until`: people move with the test bot, CPU timers run as they come. */
function play(code: string, conns: FakeConn[], until: () => boolean, rng: RngState = seedRng('people')) {
  for (let step = 0; !until(); step++) {
    if (step > 60000) throw new Error('game did not finish');
    if (timers.length) {
      timers.shift()!.fn();
      continue;
    }
    const s = state(code);
    let moved = false;
    for (const c of conns) {
      const me = s.players.findIndex((p) => p.pid === c.pid);
      if (me < 0) continue;
      const a = botMove(viewFor(s, me), rng);
      if (!a) continue;
      send(c, { t: 'act', id: `m${s.seq}-${me}`, action: a });
      if (!c.last('ack').ok) throw new Error(`rejected ${JSON.stringify(a)}: ${c.last('ack').error}`);
      moved = true;
      break;
    }
    if (!moved && !timers.length) throw new Error(`stuck at ${s.stage}`);
  }
}

describe('profiles (SPEC 5.1)', () => {
  it('made once per name, listed with who is using them, and merged unless they shared a game', () => {
    const c = new FakeConn();
    send(c, { t: 'newProfile', name: 'Ann', color: 'red' });
    const ann = c.last('profile').profile;
    send(c, { t: 'newProfile', name: ' ann ', color: 'blue' });
    expect(c.last('error').text).toMatch(/already/);
    send(c, { t: 'newProfile', name: 'Bbo', color: 'blue' });
    const typo = c.last('profile').profile;
    send(c, { t: 'newProfile', name: 'Bob', color: 'blue' });
    const bob = c.last('profile').profile;
    // Seated and connected: in use.
    const { code, conns } = table(['Ann', 'Bbo']);
    send(c, { t: 'profiles' });
    expect(c.last('profiles').list.find((p) => p.id === ann.id)!.inUse).toBe(true);
    // They played together, so they can't be merged.
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => state(code).turnN > 2);
    send(c, { t: 'mergeProfiles', from: typo.id, into: ann.id });
    expect(c.last('error').text).toMatch(/same game|playing/);
    // Bbo was a typo for Bob: merge (after leaving the table).
    rooms.disconnect(conns[1]!);
    send(c, { t: 'mergeProfiles', from: typo.id, into: bob.id });
    expect(c.last('notice').text).toMatch(/Bbo is now part of Bob/);
    expect(c.last('profiles').list.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(store.gamePlayers().filter((g) => g.profileId === bob.id)).toHaveLength(1);
    expect(rooms.getRoom(code)!.seats[1]!.profileId).toBe(bob.id);
  });

  it('existing games get profiles from their nicknames, CPUs count as Easy, settings move over', () => {
    const { code, conns } = table(['Ann', 'Bob'], 1);
    send(conns[0]!, { t: 'start' });
    const gameId = rooms.getRoom(code)!.game!.row.id;
    store.saveSettings('ann', { confirmEnd: false }, 1);
    // Make the database look like it did before profiles.
    store.db.exec(
      "DELETE FROM profiles; DELETE FROM game_players; DELETE FROM meta WHERE key = 'profiles_migrated'",
    );
    const row = store.db.prepare('SELECT seats_json FROM rooms WHERE code = ?').get(code) as {
      seats_json: string;
    };
    const seats = (JSON.parse(row.seats_json) as Record<string, unknown>[]).map(
      ({ profileId: _p, ...rest }) => rest,
    );
    store.db.prepare('UPDATE rooms SET seats_json = ? WHERE code = ?').run(JSON.stringify(seats), code);
    restart();
    const links = store.gamePlayers(gameId);
    expect(links).toHaveLength(3);
    expect(links.filter((l) => l.cpuLevel === 'easy')).toHaveLength(1);
    const ann = store.profileByName('Ann')!;
    expect(links.some((l) => l.profileId === ann.id)).toBe(true);
    expect(store.getProfileSettings(ann.id)).toEqual({ confirmEnd: false });
    expect(rooms.getRoom(code)!.seats[0]!.profileId).toBe(ann.id);
  });
});

describe('dice (SPEC 5.3)', () => {
  it('every roll in a game, CPU rolls too, uses dice rolled by the server and saved with the move', () => {
    const { code, conns } = table(['Ann'], 2);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => state(code).turnN > 12);
    const id = rooms.getRoom(code)!.game!.row.id;
    const rolls = store.loadActions(id).filter((a) => a.action.type === 'roll');
    expect(rolls.length).toBeGreaterThan(10);
    expect(rolls.some((a) => a.seat !== state(code).players.findIndex((p) => !p.cpu))).toBe(true);
    for (const a of rolls) {
      if (a.action.type !== 'roll' || !a.action.dice) throw new Error('roll without server dice');
      const d = a.action.dice.d;
      const ev = a.events.filter((e) => e.k === 'roll');
      ev.forEach((e, i) => {
        if (e.k === 'roll') expect(e.d).toEqual([d[2 * i], d[2 * i + 1]]);
      });
    }
    // A player can't send their own dice: the message is rejected before it reaches the game.
    const cheat = { t: 'act', id: 'cheat', action: { type: 'roll', dice: { d: [6, 6] } } };
    expect(ClientMsgSchema.safeParse(cheat).success).toBe(false);
  });
});

describe('a finished game: stats and history (SPEC 5.5, 5.6)', () => {
  it('stats rebuilt from the saved moves equal the live ones, survive a restart, and only 2+ people count', () => {
    const { code, conns } = table(['Ann', 'Bob'], 1);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => state(code).phase === 'over');
    const g = rooms.getRoom(code)!.game!;
    const final = conns[0]!.last('update');
    expect(final.stats).toBeDefined();
    const rebuilt = statsFromLog(g.row.seed, g.row.players, g.row.config, store.loadActions(g.row.id));
    expect(JSON.stringify(final.stats)).toBe(JSON.stringify(rebuilt.stats));
    // During play only the dice were sent; nobody saw card stats before the end.
    for (const m of conns[1]!.msgs)
      if ((m.t === 'update' || m.t === 'sync') && m.game?.phase === 'play') expect(m.stats).toBeUndefined();

    restart();
    const c = new FakeConn();
    const ann = store.profileByName('Ann')!;
    const bob = store.profileByName('Bob')!;
    send(c, { t: 'stats', who: ann.id });
    const rec = c.last('stats').record;
    expect(rec.games).toBe(1);
    const annSeat = rebuilt.state.players.findIndex((p) => p.pid === conns[0]!.pid);
    expect(rec.wins).toBe(rebuilt.state.winner === annSeat ? 1 : 0);
    expect(rec.vs.map((v) => v.name).sort()).toEqual(['Bob', 'CPU 1']);
    expect(rec.past[0]!.id).toBe(g.row.id);
    send(c, { t: 'stats', who: 'cpu:easy' });
    expect(c.last('stats').record.games).toBe(1);
    expect(c.last('stats').name).toBe('Easy CPU');
    send(c, { t: 'gameStats', game: g.row.id });
    const info = c.last('gameStats').game;
    expect(info.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob', 'CPU 1']);
    expect(JSON.stringify(info.stats)).toBe(JSON.stringify(rebuilt.stats));

    // One person against CPUs: not in the history.
    const solo = table(['Bob'], 2);
    send(solo.conns[0]!, { t: 'start' });
    play(solo.code, solo.conns, () => state(solo.code).phase === 'over');
    send(c, { t: 'stats', who: bob.id });
    expect(c.last('stats').record.games).toBe(1);
  }, 120000);
});

describe('saved games (SPEC 5.7)', () => {
  it('save and quit, restart, resume: everyone back in their own seat exactly where it stopped', () => {
    const { code, conns } = table(['Ann', 'Bob', 'Cat']);
    send(conns[0]!, { t: 'start' });
    play(code, conns, () => state(code).turnN >= 6);
    const before = JSON.stringify(state(code));
    const gameId = rooms.getRoom(code)!.game!.row.id;
    const pids = conns.map((c) => c.pid);
    // Save and quit asks everyone first, then closes the room.
    send(conns[1]!, { t: 'resetRequest', kind: 'quit' });
    expect(conns[0]!.last('notice').text).toMatch(/save this game/);
    send(conns[1]!, { t: 'resetConfirm' });
    for (const c of conns) expect(c.last('closed').text).toMatch(/saved/);
    expect(rooms.getRoom(code)).toBeUndefined();

    restart();
    expect(rooms.getRoom(code)).toBeUndefined(); // closed rooms stay closed
    const c = new FakeConn();
    send(c, { t: 'saved' });
    const list = c.last('saved').list;
    expect(list.map((x) => x.id)).toEqual([gameId]);
    expect(list[0]!.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob', 'Cat']);
    expect(list[0]!.mode).toBe('base');
    expect(list[0]!.hexes).toHaveLength(19);
    expect(list[0]!.room).toBeNull();

    send(c, { t: 'resume', game: gameId });
    const room = c.last('sync').room;
    expect(room.code).not.toBe(code);
    expect(c.last('sync').game!.me).toBeNull();
    expect(JSON.stringify(rooms.getRoom(room.code)!.game!.state)).toBe(before);
    // Each person picks their profile and gets their own seat.
    const back = ['Ann', 'Bob', 'Cat'].map((nick, i) => {
      const x = i === 0 ? c : new FakeConn();
      if (i) send(x, { t: 'hello', room: room.code });
      send(x, joinAs(store, nick, 'red'));
      expect(x.last('seat').pid).toBe(pids[i]);
      return x;
    });
    // The game carries on.
    play(room.code, back, () => state(room.code).turnN >= 8);
    // While it's open, it's in the list with its room.
    send(c, { t: 'saved' });
    expect(c.last('saved').list[0]!.room).toBe(room.code);
  }, 120000);

  it('deleting removes an unfinished game from the list; a finished game can’t be deleted', () => {
    const { code, conns } = table(['Ann', 'Bob']);
    send(conns[0]!, { t: 'start' });
    const gameId = rooms.getRoom(code)!.game!.row.id;
    const c = new FakeConn();
    send(c, { t: 'deleteSaved', game: gameId });
    expect(c.last('error').text).toMatch(/playing it/);
    send(conns[0]!, { t: 'resetRequest', kind: 'quit' });
    send(conns[0]!, { t: 'resetConfirm' });
    send(c, { t: 'deleteSaved', game: gameId });
    expect(c.last('saved').list).toEqual([]);
    send(c, { t: 'resume', game: gameId });
    expect(c.last('error').text).toMatch(/isn’t saved/);
  });
});

describe('undo through the server (SPEC 5.10)', () => {
  it('CPUs agree at once; people must each say yes', () => {
    const solo = table(['Ann'], 2);
    send(solo.conns[0]!, { t: 'start' });
    const ann = solo.conns[0]!;
    const meOf = (code: string, c: FakeConn) => state(code).players.findIndex((p) => p.pid === c.pid);
    // Setup: Ann places, then asks to undo before the next CPU moves.
    play(
      solo.code,
      solo.conns,
      () => state(solo.code).turn === meOf(solo.code, ann) && state(solo.code).stage === 'setup',
    );
    const before = JSON.stringify({ ...state(solo.code), seq: 0, undo: null });
    const s = state(solo.code);
    const place = legalActions(s, meOf(solo.code, ann)).find((a) => a.type === 'setup')!;
    send(ann, { t: 'act', id: 'place', action: place });
    timers.length = 0; // the CPUs wait
    send(ann, { t: 'act', id: 'undo', action: { type: 'askUndo' } });
    expect(ann.last('ack').ok).toBe(true);
    expect(JSON.stringify({ ...state(solo.code), seq: 0, undo: null })).toBe(before);
    // With people: one "no" ends it.
    const t = table(['Bob', 'Cat']);
    send(t.conns[0]!, { t: 'start' });
    const s2 = state(t.code);
    const mover = t.conns.find((c) => c.pid === s2.players[s2.turn]!.pid)!;
    const other = t.conns.find((c) => c !== mover)!;
    send(mover, { t: 'act', id: 'p', action: legalActions(s2, s2.turn).find((a) => a.type === 'setup')! });
    send(mover, { t: 'act', id: 'u', action: { type: 'askUndo' } });
    expect(other.last('update').game!.undo).toEqual({ p: s2.turn, asked: true, ok: [] });
    send(other, { t: 'act', id: 'no', action: { type: 'answerUndo', yes: false } });
    expect(state(t.code).undo).toBeUndefined();
    expect(state(t.code).verts.filter((x) => x)).toHaveLength(1);
  });
});

describe('CPU chatter (SPEC 5.14)', () => {
  it('at most one line per CPU per turn, and none once switched off', () => {
    const { code, conns } = table(['Ann'], 2);
    send(conns[0]!, { t: 'start' });
    // 60 turns: about 30 CPU turns, each with a 1-in-4 chance of a line (plus lines when robbed).
    const over = () => state(code).phase === 'over';
    play(code, conns, () => state(code).turnN >= 60 || over());
    const cpuChat = () =>
      conns[0]!.msgs
        .flatMap((m) => (m.t === 'update' ? m.log : []))
        .filter((it) => it.k === 'chat' && it.cpu);
    const lines = cpuChat();
    // The game is random (the server rolls real dice), so only "some" is certain enough to test.
    expect(lines.length).toBeGreaterThan(1);
    // Each line is stored with the turn it was said in; no CPU speaks twice in a turn.
    const said = rooms.getRoom(code)!.chatter!;
    expect(said.size).toBeGreaterThan(0);
    const perTurn = new Map<string, number>();
    let turn = 0;
    for (const m of conns[0]!.msgs) {
      if (m.t !== 'update') continue;
      if (m.game) turn = m.game.turnN;
      for (const it of m.log)
        if (it.k === 'chat' && it.cpu) {
          const key = `${it.pid}:${turn}`;
          perTurn.set(key, (perTurn.get(key) ?? 0) + 1);
        }
    }
    expect([...perTurn.values()].every((n) => n === 1)).toBe(true);
    // Not every turn.
    expect(lines.length).toBeLessThan(60);
    send(conns[0]!, { t: 'setCpuChat', on: false });
    const n = cpuChat().length;
    play(code, conns, () => state(code).turnN >= 90 || over());
    expect(cpuChat().length).toBe(n);
  }, 120000);
});
