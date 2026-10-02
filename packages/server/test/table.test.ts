/* The pre-game table and turn order (docs/pregame.md 3). */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLASSIC_MAP,
  TABLE_TALK,
  applyEdit,
  botMove,
  checkBoard,
  legalActions,
  OUR_RULES,
  seedRng,
  standardBlank,
  viewFor,
  type GameState,
  type MapData,
} from '@settlers/engine';
import { ClientMsgSchema, type ClientMsg, type ServerMsg, type TableInfo } from '../src/protocol';
import { Rooms, type Conn } from '../src/rooms';
import { Store } from '../src/store';
import { setupSnake, turnOrder, type Luck } from '../src/table';
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
/** Rigged dice and picks for who goes first: faces are used in order, then 1s. */
let faces: number[] = [];
let picks: number[] = [];
const luck: Luck = { die: () => faces.shift() ?? 1, pick: (n) => (picks.shift() ?? 0) % n };
const open = () =>
  (rooms = new Rooms(store, {
    log: () => {},
    luck,
    cpuDelay: () => 1000,
    setTimer: () => 0,
    clearTimer: () => {},
  }));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-table-'));
  store = new Store(join(dir, 'test.db'));
  faces = [];
  picks = [];
  open();
});
afterEach(() => {
  rooms.stop();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
function restart() {
  rooms.stop();
  store.close();
  store = new Store(join(dir, 'test.db'));
  open();
}

/** Send through the same validation as the WebSocket. */
function send(c: FakeConn, m: unknown) {
  const p = ClientMsgSchema.safeParse(JSON.parse(JSON.stringify(m)));
  if (!p.success) throw new Error(`rejected: ${p.error.message}`);
  rooms.handle(c, p.data as ClientMsg);
}
const op = (c: FakeConn, o: unknown) => send(c, { t: 'table', op: o });
const info = (c: FakeConn): TableInfo => {
  const m = [...c.msgs].reverse().find((x) => (x.t === 'sync' || x.t === 'update') && x.room.table)!;
  return (m as Extract<ServerMsg, { t: 'sync' }>).room.table!;
};
const lastError = (c: FakeConn) =>
  [...c.msgs].reverse().find((m) => m.t === 'error') as { text: string } | undefined;
const state = (code: string): GameState => rooms.getRoom(code)!.game!.state;

function seated(nicks: string[], cpus = 0) {
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
  const pids = conns.map((c) => c.pid!);
  return { code, conns, pids, host };
}

/** Who places in setup, in order, playing the first legal placement each time. */
function setupActors(code: string, conns: FakeConn[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 40 && state(code).stage === 'setup'; i++) {
    const s = state(code);
    const p = s.players[s.turn]!;
    out.push(p.nick);
    const c = conns.find((x) => x.pid === p.pid)!;
    const a = legalActions(s, s.turn).find((x) => !TABLE_TALK.includes(x.type))!;
    send(c, { t: 'act', id: `s${s.seq}`, action: a });
  }
  return out;
}

describe('turn order', () => {
  it('Joe, Alex and Sam: circle Sam → Alex → Joe, Alex first', () => {
    const { code, conns, pids } = seated(['Joe', 'Alex', 'Sam']);
    const [joe, alex, sam] = pids as [string, string, string];
    op(conns[0]!, { k: 'circle', order: [sam, alex, joe] });
    op(conns[2]!, { k: 'firstMode', mode: 'pick' });
    op(conns[1]!, { k: 'pickFirst', pid: alex });
    const t = info(conns[0]!);
    expect(t.circle).toEqual([sam, alex, joe]);
    expect(t.first.pid).toBe(alex);
    expect(turnOrder(t.circle, t.first.pid)).toEqual([alex, joe, sam]);
    send(conns[0]!, { t: 'start' });
    expect(state(code).players.map((p) => p.nick)).toEqual(['Alex', 'Joe', 'Sam']);
    expect(setupActors(code, conns)).toEqual(['Alex', 'Joe', 'Sam', 'Sam', 'Joe', 'Alex']);
    // Then turns go Alex, Joe, Sam, Alex…
    const turns: string[] = [];
    const rng = seedRng('turns');
    for (let step = 0; turns.length < 4 && step < 2000; step++) {
      const s = state(code);
      const name = s.players[s.turn]!.nick;
      if (turns.at(-1) !== name) turns.push(name);
      for (const c of conns) {
        const me = s.players.findIndex((p) => p.pid === c.pid);
        const a = botMove(viewFor(s, me), rng);
        if (!a) continue;
        send(c, { t: 'act', id: `t${s.seq}-${me}`, action: a });
        break;
      }
    }
    expect(turns).toEqual(['Alex', 'Joe', 'Sam', 'Alex']);
  });

  it('setup snakes for 2, 3 and 4 players', () => {
    for (const n of [2, 3, 4]) {
      const names = ['Ann', 'Bob', 'Cat', 'Dan'].slice(0, n).map((x) => `${x}${n}`);
      const { code, conns, pids } = seated(names);
      op(conns[0]!, { k: 'firstMode', mode: 'pick' });
      op(conns[0]!, { k: 'pickFirst', pid: pids[1]! });
      send(conns[0]!, { t: 'start' });
      const order = turnOrder(pids, pids[1]!).map((p) => names[pids.indexOf(p)]!);
      expect(setupActors(code, conns)).toEqual(setupSnake(order));
    }
  });

  it('roll-off: ties roll again, only the tied players', () => {
    const { conns, pids } = seated(['Ann', 'Bob', 'Cat']);
    const [ann, bob, cat] = pids as [string, string, string];
    op(conns[0]!, { k: 'firstMode', mode: 'roll' });
    expect(info(conns[0]!).first.roll).toMatchObject({ round: 1, rolling: [ann, bob, cat], rolls: {} });
    faces = [6, 6];
    op(conns[0]!, { k: 'roll' });
    faces = [5, 6];
    op(conns[1]!, { k: 'roll' });
    faces = [6, 5];
    op(conns[2]!, { k: 'roll' });
    // Bob and Cat tied on 11 below Ann's 12: Ann goes first.
    expect(info(conns[0]!).first.pid).toBe(ann);

    op(conns[1]!, { k: 'firstMode', mode: 'roll' });
    faces = [5, 5];
    op(conns[0]!, { k: 'roll' });
    faces = [6, 4];
    op(conns[1]!, { k: 'roll' });
    faces = [1, 2];
    op(conns[2]!, { k: 'roll' });
    let t = info(conns[0]!);
    expect(t.first.pid).toBeNull();
    expect(t.first.roll).toMatchObject({ round: 2, rolling: [ann, bob], rolls: {} });
    op(conns[2]!, { k: 'roll' });
    expect(lastError(conns[2]!)?.text).toBe('You’re not in this roll');
    faces = [2, 2];
    op(conns[0]!, { k: 'roll' });
    faces = [3, 2];
    op(conns[1]!, { k: 'roll' });
    t = info(conns[0]!);
    expect(t.first.pid).toBe(bob);
    const log = conns[0]!.msgs
      .flatMap((m) => (m.t === 'update' ? m.log : []))
      .map((x) => ('text' in x ? x.text : ''));
    expect(log).toContain('Ann rolled 5 + 5 = 10');
    expect(log).toContain('Ann and Bob tied on 10 and roll again');
    expect(log).toContain('Bob goes first');
  });

  it('roll-off: a three-way tie, then a tie in the re-roll', () => {
    const { conns, pids } = seated(['Ann', 'Bob', 'Cat']);
    const [ann, bob, cat] = pids as [string, string, string];
    op(conns[0]!, { k: 'firstMode', mode: 'roll' });
    faces = [4, 4, 5, 3, 6, 2];
    op(conns[0]!, { k: 'autoRoll' });
    expect(info(conns[0]!).first.roll).toMatchObject({ round: 2, rolling: [ann, bob, cat] });
    faces = [2, 2, 3, 1, 1, 1];
    op(conns[1]!, { k: 'autoRoll' });
    expect(info(conns[0]!).first.roll).toMatchObject({ round: 3, rolling: [ann, bob] });
    faces = [1, 1, 6, 6];
    op(conns[2]!, { k: 'autoRoll' });
    expect(info(conns[0]!).first.pid).toBe(bob);
  });

  it('CPUs roll on their own; Auto-roll rolls for everyone left', () => {
    const { conns, pids } = seated(['Ann', 'Bob'], 1);
    const t0 = info(conns[0]!);
    const cpu = t0.circle.find((p) => !pids.includes(p))!;
    faces = [3, 3];
    op(conns[0]!, { k: 'firstMode', mode: 'roll' });
    let t = info(conns[0]!);
    expect(Object.keys(t.first.roll!.rolls)).toEqual([cpu]);
    expect(t.first.roll!.rolls[cpu]).toEqual([3, 3]);
    faces = [1, 1, 2, 2];
    op(conns[1]!, { k: 'autoRoll' });
    t = info(conns[0]!);
    expect(t.first.pid).toBe(cpu);
  });

  it('random and pick', () => {
    const { conns, pids } = seated(['Ann', 'Bob', 'Cat']);
    picks = [2];
    op(conns[0]!, { k: 'firstMode', mode: 'random' });
    expect(info(conns[0]!).first).toMatchObject({ mode: 'random', pid: pids[2] });
    op(conns[0]!, { k: 'firstMode', mode: 'pick' });
    expect(info(conns[0]!).first.pid).toBe(pids[0]);
    op(conns[2]!, { k: 'pickFirst', pid: pids[1]! });
    expect(info(conns[0]!).first.pid).toBe(pids[1]);
    // Shuffle keeps everyone; a bad order is refused.
    op(conns[0]!, { k: 'shuffle' });
    expect([...info(conns[0]!).circle].sort()).toEqual([...pids].sort());
    op(conns[0]!, { k: 'circle', order: [pids[0]!, pids[1]!] });
    expect(lastError(conns[0]!)?.text).toBe('Someone sat down or left; try again');
  });

  it('a new room seats people in the order they sat down; leaving and joining keep the circle', () => {
    const { conns, pids } = seated(['Ann', 'Bob', 'Cat']);
    expect(info(conns[0]!).circle).toEqual(pids);
    send(conns[1]!, { t: 'leave' });
    expect(info(conns[0]!).circle).toEqual([pids[0], pids[2]]);
  });
});

describe('the table', () => {
  it('Ready is a signal; any change clears it; anyone can start', () => {
    const { code, conns, pids } = seated(['Ann', 'Bob'], 1);
    op(conns[0]!, { k: 'ready', on: true });
    let t = info(conns[1]!);
    expect(t.ready).toContain(pids[0]);
    expect(t.ready).toHaveLength(2); // Ann and the CPU
    op(conns[1]!, { k: 'reroll' });
    t = info(conns[0]!);
    expect(t.ready).toHaveLength(1);
    expect(t.last).toMatchObject({ who: 'Bob', what: 'rerolled' });
    op(conns[0]!, { k: 'ready', on: true });
    send(conns[1]!, { t: 'setOptions', options: { scenario: 'classic', winVP: 9, houseRules: {} } });
    expect(info(conns[0]!).ready).toHaveLength(1);
    op(conns[0]!, { k: 'ready', on: true });
    op(conns[0]!, { k: 'shuffle' });
    expect(info(conns[0]!).ready).toHaveLength(1);
    send(conns[1]!, { t: 'start' });
    expect(rooms.getRoom(code)!.game).not.toBeNull();
  });

  it('the game starts on exactly the board on the table', () => {
    const { code, conns } = seated(['Ann', 'Bob', 'Cat']);
    op(conns[1]!, { k: 'source', source: 'generated', preset: 'builtin:our rules' });
    const t = info(conns[0]!);
    expect(t.board.source).toMatchObject({ kind: 'generated', presetName: 'Our rules' });
    expect(
      checkBoard(t.board.map, OUR_RULES, 3).filter((v) => !['best', 'bad', 'lowCluster'].includes(v.rule)),
    ).toEqual([]);
    send(conns[0]!, { t: 'start' });
    const s = state(code);
    s.board.hexes.forEach((h, i) => {
      expect(h.t).toBe(t.board.map.hexes[i]!.t);
      expect(h.n).toBe(t.board.map.hexes[i]!.n ?? 0);
    });
    expect(s.board.ports.map((p) => p.t)).toEqual(t.board.map.harbors.map((h) => h.t));
    expect(s.config.map!.made?.generator).toMatchObject({ preset: 'Our rules', seed: t.board.seed });
  });

  it('reroll, back and forward, typed seeds, edits and locks', () => {
    const { conns, host } = seated(['Ann', 'Bob']);
    const first = info(host);
    expect(first.count).toBe(1);
    op(conns[1]!, { k: 'reroll' });
    const second = info(host);
    expect(second.count).toBe(2);
    expect(second.board.seed).not.toBe(first.board.seed);
    op(conns[0]!, { k: 'back' });
    expect(info(host).board).toEqual(first.board);
    expect(info(host).last).toMatchObject({ who: 'Ann', what: 'went back a board' });
    op(conns[0]!, { k: 'forward' });
    expect(info(host).board).toEqual(second.board);
    op(conns[0]!, { k: 'forward' });
    expect(lastError(conns[0]!)?.text).toBe('That’s the latest board');
    // The same seed gives the same board.
    op(conns[0]!, { k: 'seed', seed: first.board.seed });
    expect(info(host).board.map.hexes).toEqual(first.board.map.hexes);
    // An edit: swap two tiles; Bob's name goes on the board.
    const m = info(host).board.map;
    const a = m.hexes[0]!;
    const b = m.hexes.find((h) => h.t !== a.t)!;
    op(conns[1]!, { k: 'edit', op: { k: 'swapTile', a: [a.q, a.r], b: [b.q, b.r] } });
    const edited = info(host);
    expect(edited.board.map.hexes[0]!.t).toBe(b.t);
    expect(edited.board.edited).toEqual(['Bob']);
    expect(edited.last).toMatchObject({ who: 'Bob', what: `moved ${a.t}` });
    // Lock it; rerolls keep it.
    op(conns[1]!, { k: 'edit', op: { k: 'lock', at: [a.q, a.r], what: 't', on: true } });
    for (let i = 0; i < 5; i++) {
      op(conns[0]!, { k: 'reroll' });
      expect(info(host).board.map.hexes[0]).toMatchObject({ t: b.t, lock: { t: true } });
    }
    // Blanks and reshaping aren't table edits.
    op(conns[0]!, { k: 'edit', op: { k: 'terrain', at: [a.q, a.r], t: 'wood' } });
    expect(lastError(conns[0]!)?.text).toBe('That tile is locked');
  });

  it('watchers see everything but can’t change anything', () => {
    const { code, host } = seated(['Ann', 'Bob']);
    const watcher = new FakeConn();
    send(watcher, { t: 'hello', room: code });
    expect(info(watcher).count).toBe(1);
    for (const o of [
      { k: 'reroll' },
      { k: 'ready', on: true },
      { k: 'shuffle' },
      { k: 'firstMode', mode: 'roll' },
    ]) {
      op(watcher, o);
      expect(lastError(watcher)?.text).toBe('Take a seat first');
    }
    expect(info(host).count).toBe(1);
  });

  it('a saved map; a mode it doesn’t fit; a board for the wrong number of players', () => {
    const { conns, host } = seated(['Ann', 'Bob']);
    let m: MapData = standardBlank(CLASSIC_MAP, 'new', 'Ore heart');
    const r = applyEdit(m, { k: 'terrain', at: [0, 0], t: 'ore' });
    if (!r.ok) throw new Error(r.error);
    m = r.map;
    send(host, { t: 'saveMap', map: m });
    const id = host.last('map').map.id;
    op(conns[0]!, { k: 'source', source: 'saved', id });
    let t = info(host);
    expect(t.board.source).toEqual({ kind: 'saved', id, name: 'Ore heart' });
    expect(t.board.map.hexes.find((h) => h.q === 0 && h.r === 0)!.t).toBe('ore');
    expect(t.board.map.hexes.every((h) => h.t !== 'random' && h.n !== 'random')).toBe(true);
    // Seafarers mode needs a Seafarers board: the table goes back to the mode's own map.
    send(conns[1]!, {
      t: 'setOptions',
      options: { scenario: 'heading-for-new-shores', winVP: 14, houseRules: {} },
    });
    t = info(host);
    expect(t.board.source).toEqual({ kind: 'default' });
    expect(t.board.map.hexes).toHaveLength(61);
    expect(t.problem).toBe('This board is for 3 or 4 players');
    send(conns[0]!, { t: 'start' });
    expect(lastError(conns[0]!)?.text).toBe('Heading for New Shores needs 3 or 4 players');
    op(conns[0]!, { k: 'source', source: 'saved', id });
    expect(lastError(conns[0]!)?.text).toBe('“Ore heart” isn’t a Seafarers map; pick Base or Knights for it');
  });

  it('the table survives a restart', () => {
    const { code, conns, pids } = seated(['Ann', 'Bob', 'Cat']);
    op(conns[0]!, { k: 'reroll' });
    op(conns[0]!, { k: 'reroll' });
    op(conns[0]!, { k: 'back' });
    op(conns[1]!, { k: 'circle', order: [pids[2]!, pids[0]!, pids[1]!] });
    op(conns[1]!, { k: 'firstMode', mode: 'roll' });
    faces = [6, 6];
    op(conns[2]!, { k: 'roll' });
    const before = info(conns[0]!);
    restart();
    const c = new FakeConn();
    send(c, { t: 'hello', room: code });
    const after = info(c);
    expect(after.board).toEqual(before.board);
    expect(after.at).toBe(1);
    expect(after.count).toBe(3);
    expect(after.circle).toEqual(before.circle);
    expect(after.first).toEqual(before.first);
    op(conns[0]!, { k: 'forward' });
  });
});
