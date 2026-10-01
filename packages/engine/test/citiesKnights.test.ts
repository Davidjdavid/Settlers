import { describe, expect, it } from 'vitest';
import {
  EVENT_FACES, applyAction, checkInvariants, eventsFor, geo, legalActions, newGame, rateFor, roadOK, routeLen,
  seedRng, nextInt, totalVP, trackOf, viewFor, type Action, type GameState, type HouseRules, type Knight,
  type Progress, type Seat, type Track,
} from '../src/index'; // prettier-ignore
import { act, reject, setHand } from './helpers';
import { seatsFor } from './simulate';

/** A Cities & Knights game with no pieces placed, in the main phase, seat 0 to move. */
function ckGame(n = 3, houseRules: HouseRules = {}): GameState {
  const s = structuredClone(
    newGame('ck', seatsFor(n), {
      modules: ['citiesKnights'],
      winVP: 13,
      ...(Object.keys(houseRules).length ? { houseRules } : {}),
    }),
  );
  s.stage = 'main';
  s.turnN = 5;
  s.setupI = n * 2;
  s.dice = [3, 4];
  return s;
}

function put(
  s: GameState,
  p: Seat,
  o: {
    settlements?: number[];
    cities?: number[];
    roads?: number[];
    knights?: [number, 1 | 2 | 3, boolean][];
  },
) {
  for (const v of o.settlements ?? []) {
    s.verts[v] = [p, 1];
    s.players[p]!.pieces.settlement--;
  }
  for (const v of o.cities ?? []) {
    s.verts[v] = [p, 2];
    s.players[p]!.pieces.city--;
  }
  for (const e of o.roads ?? []) {
    s.edges[e] = p;
    s.players[p]!.pieces.road--;
  }
  for (const [v, lvl, on] of o.knights ?? []) s.ck!.knights[v] = { p, lvl, on };
  s.roadLens = s.players.map((_, i) => routeLen(s, i));
  return s;
}

/** Move a progress card from its deck into p's hand. */
function give(s: GameState, p: Seat, ...cards: Progress[]) {
  for (const card of cards) {
    const deck = s.ck!.decks[trackOf(card)];
    deck.splice(deck.indexOf(card), 1);
    s.ck!.hands[p]!.push(card);
  }
  return s;
}

/** Set the PRNG so the next roll gives these production dice and event die face. */
function rigRoll(s: GameState, d1: number, d2: number, face: 'ship' | Track = 'ship'): GameState {
  for (let i = 0; ; i++) {
    const rng = seedRng(`ckrig-${i}`);
    const probe: typeof rng = [...rng];
    if (nextInt(probe, 6) + 1 !== d1 || nextInt(probe, 6) + 1 !== d2) continue;
    if (EVENT_FACES[nextInt(probe, 6)] !== face) continue;
    return { ...s, rng };
  }
}

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([]);
const g = (s: GameState) => geo(s);
/** Two corners joined by an edge, plus the edge. */
function edgeAt(s: GameState, e: number) {
  const E = g(s).edges[e]!;
  return { a: E.a, b: E.b };
}
/** A path of n edges from vertex v that avoids the given corners. */
function path(
  s: GameState,
  v: number,
  n: number,
  avoid: number[] = [],
): { edges: number[]; verts: number[] } {
  const verts = [v];
  const edges: number[] = [];
  const go = (x: number): boolean => {
    if (edges.length === n) return true;
    for (const e of g(s).verts[x]!.edges) {
      const E = g(s).edges[e]!;
      const w = E.a === x ? E.b : E.a;
      if (verts.includes(w) || avoid.includes(w)) continue;
      edges.push(e);
      verts.push(w);
      if (go(w)) return true;
      edges.pop();
      verts.pop();
    }
    return false;
  };
  if (!go(v)) throw new Error('no path');
  return { edges, verts };
}

/** A start corner from which a road of n1 and a branch of n2 from its far end both fit. */
function twoPaths(s: GameState, n1: number, n2: number) {
  for (let v = 0; v < g(s).verts.length; v++) {
    try {
      const p = path(s, v, n1);
      const q = path(s, p.verts[n1]!, n2, p.verts);
      // Keep the branch clear of the first road (distance rule for the settlements at the ends).
      if (q.verts.slice(1).some((x) => g(s).verts[x]!.adj.some((y) => p.verts.slice(0, -1).includes(y))))
        continue;
      return { p, q };
    } catch {
      continue;
    }
  }
  throw new Error('no paths');
}

describe('Cities & Knights: setup and production', () => {
  it('starts with a settlement then a city, which pays resources only', () => {
    let s = newGame('ck-setup', seatsFor(3), { modules: ['citiesKnights'], winVP: 13 });
    expect(s.config).toEqual({ winVP: 13, modules: ['citiesKnights'] });
    while (s.stage === 'setup') {
      const r = act(s, s.turn, legalActions(s, s.turn)[0]!);
      const ev = r.events.find((e) => e.k === 'setup');
      if (ev?.k === 'setup' && ev.got)
        expect(Object.keys(ev.got).every((k) => ['wood', 'brick', 'sheep', 'wheat', 'ore'].includes(k))).toBe(
          true,
        );
      s = r.state;
    }
    for (let p = 0; p < 3; p++) {
      expect(s.verts.filter((b) => b && b[0] === p && b[1] === 1)).toHaveLength(1);
      expect(s.verts.filter((b) => b && b[0] === p && b[1] === 2)).toHaveLength(1);
      expect(s.players[p]!.pieces.city).toBe(3);
      expect(s.players[p]!.res.paper).toBe(0);
    }
    ok(s);
  });

  it('needs 3 or 4 players and has no development cards', () => {
    expect(() => newGame('x', seatsFor(2), { modules: ['citiesKnights'] })).toThrow(/3 or 4/);
    const s = ckGame();
    s.players[0]!.res = { ...s.players[0]!.res, sheep: 1, wheat: 1, ore: 1 };
    s.bank.sheep--;
    s.bank.wheat--;
    s.bank.ore--;
    expect(reject(s, 0, { type: 'buyDev' })).toMatch(/no development cards/);
    expect(legalActions(s, 0).some((a) => a.type === 'buyDev')).toBe(false);
  });

  it('cities make a commodity on forest, pasture and mountains, and 2 brick or wheat', () => {
    const s0 = ckGame();
    const byT = (t: string) => s0.board.hexes.findIndex((h, i) => h.t === t && i !== s0.board.robber);
    for (const [t, com, n] of [
      ['wood', 'paper', 1],
      ['sheep', 'cloth', 1],
      ['ore', 'coin', 1],
      ['brick', null, 2],
      ['wheat', null, 2],
    ] as const) {
      let s = structuredClone(s0);
      const h = byT(t);
      const v = g(s).hexVerts[h]![0]!;
      put(s, 0, { cities: [v], roads: [g(s).verts[v]!.edges[0]!] });
      s.stage = 'preroll';
      const roll = s.board.hexes[h]!.n;
      // Expected from every hex at this corner showing the same number.
      const want: Record<string, number> = {};
      for (const x of g(s).verts[v]!.hexes) {
        const hx = s.board.hexes[x]!;
        if (hx.n !== roll || x === s.board.robber) continue;
        want[hx.t] = (want[hx.t] ?? 0) + (hx.t === 'brick' || hx.t === 'wheat' ? 2 : 1);
        const c = { wood: 'paper', sheep: 'cloth', ore: 'coin' }[hx.t as string];
        if (c) want[c] = (want[c] ?? 0) + 1;
      }
      const d1 = Math.min(6, roll - 1);
      s = act(rigRoll(s, d1, roll - d1, 'trade'), 0, { type: 'roll' }).state;
      expect(s.players[0]!.res[t]).toBe(want[t]);
      expect(want[t]).toBeGreaterThanOrEqual(n);
      if (com) expect(s.players[0]!.res[com]).toBe(want[com]);
      ok(s);
    }
  });

  it('commodities are unlimited, trade 4:1, and count toward the hand', () => {
    let s = ckGame();
    s = setHand(s, 0, { coin: 4 });
    expect(rateFor(s, 0, 'coin')).toBe(4);
    s = act(s, 0, { type: 'bank', give: 'coin', get: 'paper' }).state;
    expect(s.players[0]!.res.paper).toBe(1);
    s = setHand(s, 0, { coin: 30 });
    ok(s);
    expect(viewFor(s, 1).players[0]!.resCount).toBe(30);
  });
});

describe('Cities & Knights: improvements and metropolises', () => {
  it('costs 1, 2, 3... of the commodity and needs a city', () => {
    let s = ckGame();
    s = setHand(s, 0, { cloth: 10 });
    expect(reject(s, 0, { type: 'improve', track: 'trade' })).toMatch(/need a city/);
    put(s, 0, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    s = act(s, 0, { type: 'improve', track: 'trade' }).state;
    expect(s.players[0]!.res.cloth).toBe(9);
    s = act(s, 0, { type: 'improve', track: 'trade' }).state;
    expect(s.players[0]!.res.cloth).toBe(7);
    s = setHand(s, 0, { cloth: 2 });
    expect(reject(s, 0, { type: 'improve', track: 'trade' })).toMatch(/costs 3 cloth/);
    expect(reject(s, 0, { type: 'improve', track: 'politics' })).toMatch(/costs 1 coin/);
    ok(s);
  });

  it('level 4 earns the metropolis (+2 VP); level 5 takes it from a level-4 holder for good', () => {
    let s = ckGame();
    put(s, 0, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    const far = g(s).verts.findIndex((V, v) => v > 20 && !V.adj.includes(0) && v !== 0);
    put(s, 1, { cities: [far], roads: [g(s).verts[far]!.edges[0]!] });
    s.ck!.lvl[0]!.science = 3;
    s.ck!.lvl[1]!.science = 3;
    s = setHand(s, 0, { paper: 4 });
    expect(reject(s, 0, { type: 'improve', track: 'science' })).toMatch(/city for the metropolis/);
    const before = totalVP(s, 0);
    s = act(s, 0, { type: 'improve', track: 'science', v: 0 }).state;
    expect(s.ck!.metro.science).toBe(0);
    expect(totalVP(s, 0)).toBe(before + 2);
    ok(s);
    // Seat 1 reaches 4: a tie, nothing. Then 5: takes it.
    s.turn = 1;
    s = setHand(s, 1, { paper: 9 });
    s = act(s, 1, { type: 'improve', track: 'science' }).state;
    expect(s.ck!.metro.science).toBe(0);
    s = act(s, 1, { type: 'improve', track: 'science', v: far }).state;
    expect(s.ck!.metro.science).toBe(far);
    ok(s);
    // Seat 0 reaching 5 now gets nothing: seat 1 is at 5.
    s.turn = 0;
    s = setHand(s, 0, { paper: 5 });
    s = act(s, 0, { type: 'improve', track: 'science' }).state;
    expect(s.ck!.metro.science).toBe(far);
    expect(reject(s, 0, { type: 'improve', track: 'science' })).toMatch(/complete/);
    ok(s);
  });

  it('level 3 abilities: trading house 2:1 for commodities; fortress for mighty knights', () => {
    const s = ckGame();
    s.ck!.lvl[0]!.trade = 3;
    expect(rateFor(s, 0, 'coin')).toBe(2);
    expect(rateFor(s, 0, 'wood')).toBe(4);
    expect(rateFor(s, 1, 'coin')).toBe(4);
  });

  it('aqueduct: a roll that gives you nothing gives you a resource of your choice', () => {
    let s = ckGame();
    put(s, 0, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    s.ck!.lvl[0]!.science = 3;
    s.stage = 'preroll';
    const nums = new Set(g(s).verts[0]!.hexes.map((h) => s.board.hexes[h]!.n));
    const roll = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find((n) => !nums.has(n))!;
    const d1 = Math.min(6, roll - 1);
    const r = act(rigRoll(s, d1, roll - d1, 'trade'), 0, { type: 'roll' });
    s = r.state;
    expect(s.stage).toBe('ck');
    expect(s.ck!.owe).toEqual([{ k: 'aqueduct', p: 0 }]);
    expect(legalActions(s, 0).filter((a) => a.type === 'choose')).toHaveLength(5);
    s = act(s, 0, { type: 'choose', r: 'ore' }).state;
    expect(s.players[0]!.res.ore).toBe(1);
    expect(s.stage).toBe('main');
    ok(s);
  });
});

describe('Cities & Knights: knights', () => {
  function withRoad() {
    const s = ckGame();
    const p = path(s, 0, 4);
    put(s, 0, { settlements: [0], roads: p.edges });
    return { s, p };
  }

  it('builds next to your road, promotes once per turn, activates', () => {
    let { s, p } = withRoad();
    s = setHand(s, 0, { sheep: 3, ore: 3, wheat: 1 });
    const v = p.verts[2]!;
    const lonely = g(s).verts.findIndex(
      (V, x) => !p.verts.includes(x) && !V.adj.some((y) => p.verts.includes(y)),
    );
    expect(reject(s, 0, { type: 'knight', v: lonely })).toMatch(/next to your road/);
    expect(reject(s, 0, { type: 'knight', v: 0 })).toMatch(/next to your road/);
    s = act(s, 0, { type: 'knight', v }).state;
    expect(s.ck!.knights[v]).toEqual({ p: 0, lvl: 1, on: false });
    s = act(s, 0, { type: 'promote', v }).state;
    expect(reject(s, 0, { type: 'promote', v })).toMatch(/once per turn/);
    s = act(s, 0, { type: 'activate', v }).state;
    expect(s.ck!.knights[v]).toMatchObject({ lvl: 2, on: true });
    // Mighty needs a fortress.
    delete s.ck!.knights[v]!.up;
    expect(reject(s, 0, { type: 'promote', v })).toMatch(/fortress/);
    ok(s);
  });

  it('a knight activated this turn can’t act; later it moves along your roads', () => {
    let { s, p } = withRoad();
    s = setHand(s, 0, { wheat: 1 });
    put(s, 0, { knights: [[p.verts[1]!, 1, false]] });
    s = act(s, 0, { type: 'activate', v: p.verts[1]! }).state;
    expect(reject(s, 0, { type: 'moveKnight', from: p.verts[1]!, to: p.verts[3]! })).toMatch(
      /turn it was activated/,
    );
    delete s.ck!.knights[p.verts[1]!]!.fresh;
    const off = g(s).verts[p.verts[4]!]!.adj.find((x) => !p.verts.includes(x))!;
    expect(reject(s, 0, { type: 'moveKnight', from: p.verts[1]!, to: off })).toMatch(/can’t go there/);
    s = act(s, 0, { type: 'moveKnight', from: p.verts[1]!, to: p.verts[4]! }).state;
    expect(s.ck!.knights[p.verts[4]!]).toEqual({ p: 0, lvl: 1, on: false });
    expect(s.ck!.knights[p.verts[1]!]).toBeNull();
    ok(s);
  });

  it('displaces a weaker knight, whose owner moves it; equal strength can’t be displaced', () => {
    const s0 = ckGame();
    const { p, q } = twoPaths(s0, 4, 3);
    put(s0, 0, { settlements: [p.verts[0]!], roads: p.edges, knights: [[p.verts[1]!, 2, true]] });
    // Seat 1's knight sits at the end of seat 0's road, on its own road with two free spots.
    put(s0, 1, { settlements: [q.verts[3]!], roads: q.edges, knights: [[p.verts[4]!, 1, true]] });
    let s = act(s0, 0, { type: 'moveKnight', from: p.verts[1]!, to: p.verts[4]! }).state;
    expect(s.ck!.knights[p.verts[4]!]).toMatchObject({ p: 0, lvl: 2, on: false });
    expect(s.stage).toBe('ck');
    expect(s.ck!.owe).toEqual([{ k: 'relocate', p: 1, lvl: 1, on: true, not: p.verts[4]! }]);
    expect(reject(s, 0, { type: 'end' })).toMatch(/Finish/);
    s = act(s, 1, { type: 'choose', v: q.verts[1]! }).state;
    expect(s.ck!.knights[q.verts[1]!]).toEqual({ p: 1, lvl: 1, on: true });
    expect(s.stage).toBe('main');
    ok(s);
    // Equal strength: no.
    const t = structuredClone(s0);
    t.ck!.knights[p.verts[4]!]!.lvl = 2;
    expect(reject(t, 0, { type: 'moveKnight', from: p.verts[1]!, to: p.verts[4]! })).toMatch(
      /can’t go there/,
    );
  });

  it('another player’s knight blocks your roads and splits your road', () => {
    const s = ckGame();
    // A 5-road path whose end has two free ways on: one for seat 1, one to test.
    let found: { p: ReturnType<typeof path>; out: number[] } | null = null;
    for (let v = 0; v < g(s).verts.length && !found; v++) {
      let p: ReturnType<typeof path>;
      try {
        p = path(s, v, 5);
      } catch {
        continue;
      }
      const end = p.verts[5]!;
      const out = g(s).verts[end]!.edges.filter((e) => {
        const E = g(s).edges[e]!;
        const w = E.a === end ? E.b : E.a;
        return (
          !p.edges.includes(e) &&
          !p.verts.includes(w) &&
          !g(s).verts[w]!.adj.some((y) => p.verts.includes(y) && y !== end)
        );
      });
      if (out.length >= 2) found = { p, out };
    }
    const { p, out } = found!;
    put(s, 0, { settlements: [p.verts[0]!], roads: p.edges });
    expect(routeLen(s, 0)).toBe(5);
    const [theirs, beyond] = out as [number, number];
    expect(roadOK(s, 0, beyond)).toBe(true);
    const E = g(s).edges[theirs]!;
    put(s, 1, {
      roads: [theirs],
      settlements: [E.a === p.verts[5] ? E.b : E.a],
      knights: [[p.verts[5]!, 1, false]],
    });
    expect(roadOK(s, 0, beyond)).toBe(false);
    put(s, 1, { knights: [[p.verts[2]!, 1, false]] });
    expect(routeLen(s, 0)).toBe(3);
  });
});

describe('Cities & Knights: barbarians and the robber', () => {
  /** Two players with a city each; seat 0 with an active knight of strength k0. */
  function board(k0: number, k1 = 0) {
    const s = ckGame();
    const a = path(s, 0, 2);
    put(s, 0, { cities: [0], roads: a.edges });
    if (k0) put(s, 0, { knights: [[a.verts[2]!, k0 as 1, true]] });
    const far = g(s).verts.findIndex(
      (V, x) => x > 30 && !V.adj.some((y) => a.verts.includes(y)) && !a.verts.includes(x),
    );
    const b = path(s, far, 2, a.verts);
    put(s, 1, { cities: [far], roads: b.edges });
    if (k1) put(s, 1, { knights: [[b.verts[2]!, k1 as 1, true]] });
    s.ck!.walls.push(far);
    s.ck!.barb = 6;
    s.stage = 'preroll';
    return { s, far, knight: a.verts[2]! };
  }

  it('the ship moves on a ship roll; at 7 it attacks: the weakest lose a city and its wall', () => {
    const { s, far, knight } = board(1);
    // 2 cities vs 1 strength: barbarians win; seat 2 has no city, seat 1 has 0 strength.
    const r = act(rigRoll(s, 2, 3, 'ship'), 0, { type: 'roll' });
    expect(r.events).toContainEqual({
      k: 'attack',
      strength: 2,
      defense: 1,
      losers: [1],
      defender: null,
      tied: [],
    });
    expect(r.state.verts[far]).toEqual([1, 1]);
    expect(r.state.ck!.walls).toEqual([]);
    expect(r.state.ck!.barb).toBe(0);
    expect(r.state.ck!.attacks).toBe(1);
    expect(r.state.ck!.knights[knight]!.on).toBe(false);
    ok(r.state);
  });

  it('when Catan wins, the strongest defender gets a point; a tie draws progress cards', () => {
    const { s } = board(2);
    const r = act(rigRoll(s, 2, 3, 'ship'), 0, { type: 'roll' });
    expect(r.events).toContainEqual(expect.objectContaining({ k: 'attack', defender: 0 }));
    expect(r.state.ck!.defender[0]).toBe(1);
    expect(totalVP(r.state, 0)).toBe(totalVP(s, 0) + 1);
    ok(r.state);
    const t = board(1, 1).s;
    const u = act(rigRoll(t, 2, 3, 'ship'), 0, { type: 'roll' }).state;
    expect(u.ck!.owe).toEqual([
      { k: 'defenderDraw', p: 0 },
      { k: 'defenderDraw', p: 1 },
    ]);
    // Production waits until the draws are chosen.
    expect(u.stage).toBe('ck');
    expect(u.ck!.then).toBe('produce');
    const v = act(act(u, 1, { type: 'choose', track: 'politics' }).state, 0, {
      type: 'choose',
      track: 'trade',
    }).state;
    expect(v.stage).toBe('main');
    expect(v.ck!.hands[0]!.length + v.ck!.shown[0]!.length).toBe(1);
    ok(v);
  });

  it('the robber sleeps until the first attack, but 7s still make players discard', () => {
    let { s } = board(0);
    s.ck!.barb = 0;
    s = setHand(s, 1, { wood: 9 });
    s = setHand(s, 2, { wood: 9 });
    const r = act(rigRoll(s, 3, 4, 'trade'), 0, { type: 'roll' }).state;
    // Seat 1's wall raises their limit to 9; seat 2 must discard.
    expect(r.discard).toEqual({ 2: 4 });
    const after = act(r, 2, { type: 'discard', cards: { wood: 4 } }).state;
    expect(after.stage).toBe('main');
    expect(after.board.robber).toBe(s.board.robber);
    ok(after);
  });

  it('house rules: no discards, or re-roll 7s, until the first attack; barbarians can wait', () => {
    let { s } = board(0);
    s.ck!.barb = 0;
    s = setHand(s, 2, { wood: 9 });
    s.config.houseRules = { noDiscardBeforeAttack: true };
    expect(act(rigRoll(s, 3, 4, 'trade'), 0, { type: 'roll' }).state.stage).toBe('main');
    s.config.houseRules = { rerollBeforeAttack: true };
    const r = act(rigRoll(s, 3, 4, 'trade'), 0, { type: 'roll' });
    expect(r.events[0]).toEqual({ k: 'roll', p: 0, d: [3, 4], redo: true });
    s.config.houseRules = { barbarianDelay: 2 };
    s.turnN = 6;
    expect(act(rigRoll(s, 2, 3, 'ship'), 0, { type: 'roll' }).events.some((e) => e.k === 'eventDie')).toBe(
      false,
    );
    s.turnN = 7;
    expect(act(rigRoll(s, 2, 3, 'ship'), 0, { type: 'roll' }).events.some((e) => e.k === 'eventDie')).toBe(
      true,
    );
  });

  it('after the first attack an active knight next to the robber can chase it', () => {
    let { s, knight } = board(1);
    s.stage = 'main';
    s.ck!.attacks = 1;
    const rob = g(s).verts[knight]!.hexes[0]!;
    s.board.robber = rob;
    const to = s.board.hexes.findIndex((h, i) => i !== rob && h.t !== 'desert');
    s = act(s, 0, { type: 'chase', v: knight, hex: to }).state;
    expect(s.board.robber).toBe(to);
    expect(s.ck!.knights[knight]!.on).toBe(false);
    ok(s);
  });
});

describe('Cities & Knights: progress cards', () => {
  it('draws by level and red die on a gate, and colours are public', () => {
    let s = ckGame();
    put(s, 0, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    s.ck!.lvl[0]!.politics = 2;
    s.ck!.lvl[1]!.politics = 1;
    s.stage = 'preroll';
    const r = act(rigRoll(s, 5, 3, 'politics'), 0, { type: 'roll' });
    expect(r.state.ck!.hands[0]!.length + r.state.ck!.shown[0]!.length).toBe(1);
    expect(r.state.ck!.hands[1]).toEqual([]);
    const card = r.state.ck!.hands[0]![0];
    if (card) {
      expect(viewFor(r.state, 1).ck!.colors[0]).toEqual({ trade: 0, politics: 1, science: 0 });
      expect(viewFor(r.state, 1).ck!.hand).toEqual([]);
      expect(JSON.stringify(eventsFor(r.events, 1))).not.toContain(card);
      expect(JSON.stringify(eventsFor(r.events, 0))).toContain(card);
    }
    expect(JSON.stringify(viewFor(r.state, 0))).not.toContain('"decks":{"trade":[');
    s = r.state;
    ok(s);
  });

  it('a 5th card on someone else’s turn goes back at once; on your own turn you keep it until you end', () => {
    let s = ckGame();
    put(s, 1, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    put(s, 0, { cities: [30], roads: [g(s).verts[30]!.edges[0]!] });
    give(s, 1, 'spy', 'spy', 'warlord', 'wedding');
    give(s, 0, 'bishop', 'diplomat', 'intrigue', 'saboteur');
    // The next two politics cards: seat 0 draws first.
    const deck = s.ck!.decks.politics;
    for (const c of ['deserter', 'warlord'] as const) deck.splice(deck.indexOf(c), 1);
    deck.unshift('deserter', 'warlord');
    s.ck!.lvl[1]!.politics = 3;
    s.ck!.lvl[0]!.politics = 3;
    s.stage = 'preroll';
    s = act(rigRoll(s, 3, 3, 'politics'), 0, { type: 'roll' }).state;
    expect(s.ck!.owe).toEqual([{ k: 'overflow', p: 1 }]);
    expect(s.ck!.hands[0]!.length).toBe(5);
    s = act(s, 1, { type: 'choose', card: 'wedding' }).state;
    expect(s.ck!.hands[1]!.length).toBe(4);
    expect(s.ck!.decks.politics.at(-1)).toBe('wedding');
    expect(reject(s, 0, { type: 'end' })).toMatch(/4 progress cards/);
    s = act(s, 0, { type: 'dropProgress', card: 'bishop' }).state;
    ok(s);
    ok(s);
  });

  it('Alchemist picks the production dice before the roll; played cards go under their deck', () => {
    let s = ckGame();
    s.stage = 'preroll';
    give(s, 0, 'alchemist');
    s = act(s, 0, { type: 'progress', card: 'alchemist', d: [5, 6] }).state;
    expect(s.ck!.decks.science.at(-1)).toBe('alchemist');
    s = act(s, 0, { type: 'roll' }).state;
    expect(s.dice).toEqual([5, 6]);
    ok(s);
    const t = ckGame();
    give(t, 0, 'alchemist');
    expect(reject(t, 0, { type: 'progress', card: 'alchemist', d: [1, 1] })).toMatch(/before you roll/);
  });

  it('Resource Monopoly takes up to 2 from each; Trade Monopoly 1 commodity', () => {
    let s = ckGame();
    give(s, 0, 'resourceMonopoly', 'tradeMonopoly');
    s = setHand(s, 1, { ore: 5, coin: 3 });
    s = setHand(s, 2, { ore: 1 });
    s = act(s, 0, { type: 'progress', card: 'resourceMonopoly', r: 'ore' }).state;
    expect(s.players[0]!.res.ore).toBe(3);
    s = act(s, 0, { type: 'progress', card: 'tradeMonopoly', r: 'coin' }).state;
    expect(s.players[0]!.res.coin).toBe(1);
    ok(s);
  });

  it('Bishop steals from everyone on the tile, only once the robber is awake', () => {
    let s = ckGame();
    give(s, 0, 'bishop');
    const h = s.board.hexes.findIndex((x, i) => i !== s.board.robber && x.t !== 'desert');
    const [a, , b] = g(s).hexVerts[h]!;
    put(s, 1, { settlements: [a!], roads: [g(s).verts[a!]!.edges[0]!] });
    put(s, 2, { settlements: [b!], roads: [g(s).verts[b!]!.edges[0]!] });
    s = setHand(s, 1, { wood: 1 });
    s = setHand(s, 2, { coin: 1 });
    expect(reject(s, 0, { type: 'progress', card: 'bishop', h })).toMatch(/robber stays put/);
    s.ck!.attacks = 1;
    s = act(s, 0, { type: 'progress', card: 'bishop', h }).state;
    expect(s.players[0]!.res.wood + s.players[0]!.res.coin!).toBe(2);
    ok(s);
  });

  it('Spy shows the target’s cards only to the spy, then takes one', () => {
    let s = ckGame();
    give(s, 0, 'spy');
    give(s, 1, 'merchant', 'crane');
    s = act(s, 0, { type: 'progress', card: 'spy', to: 1 }).state;
    expect(viewFor(s, 0).ck!.reveal).toEqual({ from: 1, progress: ['merchant', 'crane'] });
    expect(viewFor(s, 2).ck!.reveal).toBeNull();
    const r = act(s, 0, { type: 'choose', card: 'crane' });
    expect(r.state.ck!.hands[0]).toEqual(['crane']);
    expect(eventsFor(r.events, 2)).toContainEqual({ k: 'spy', p: 0, from: 1, track: 'science', card: null });
    ok(r.state);
  });

  it('Wedding and Saboteur make richer players give or discard', () => {
    let s = ckGame();
    put(s, 1, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    give(s, 0, 'wedding', 'saboteur');
    s = setHand(s, 1, { wood: 3, coin: 2 });
    s = act(s, 0, { type: 'progress', card: 'wedding' }).state;
    expect(s.ck!.owe).toEqual([{ k: 'give', p: 1, to: 0, n: 2 }]);
    s = act(s, 1, { type: 'choose', cards: { wood: 2 } }).state;
    expect(s.players[0]!.res.wood).toBe(2);
    s = act(s, 0, { type: 'progress', card: 'saboteur' }).state;
    expect(s.ck!.owe).toEqual([{ k: 'discard', p: 1, n: 1 }]);
    s = act(s, 1, { type: 'choose', cards: { coin: 1 } }).state;
    expect(s.players[1]!.res.coin).toBe(1);
    ok(s);
  });

  it('the Merchant gives a point and 2:1 on its tile', () => {
    let s = ckGame();
    put(s, 0, { settlements: [0], roads: [g(s).verts[0]!.edges[0]!] });
    give(s, 0, 'merchant');
    const h = g(s).verts[0]!.hexes.find((x) => s.board.hexes[x]!.t !== 'desert')!;
    const vp = totalVP(s, 0);
    s = act(s, 0, { type: 'progress', card: 'merchant', h }).state;
    expect(totalVP(s, 0)).toBe(vp + 1);
    const t = s.board.hexes[h]!.t as 'wood';
    expect(rateFor(s, 0, t)).toBe(2);
    ok(s);
  });

  it('Deserter swaps a knight; Intrigue displaces one; Smith promotes two; Warlord activates all', () => {
    let s = ckGame();
    const { p, q } = twoPaths(s, 4, 3);
    put(s, 0, {
      settlements: [p.verts[0]!],
      roads: p.edges,
      knights: [
        [p.verts[1]!, 1, false],
        [p.verts[2]!, 1, false],
      ],
    });
    put(s, 1, { settlements: [q.verts[3]!], roads: q.edges, knights: [[p.verts[4]!, 2, true]] });
    give(s, 0, 'smith', 'warlord', 'intrigue', 'deserter');
    s = act(s, 0, { type: 'progress', card: 'smith', vs: [p.verts[1]!, p.verts[2]!] }).state;
    expect([s.ck!.knights[p.verts[1]!]!.lvl, s.ck!.knights[p.verts[2]!]!.lvl]).toEqual([2, 2]);
    s = act(s, 0, { type: 'progress', card: 'warlord' }).state;
    expect(s.ck!.knights[p.verts[1]!]!.on).toBe(true);
    // Deserter: seat 1 has one knight, removed at once; seat 0 may place a strength-2 knight? No: none left.
    s = act(s, 0, { type: 'progress', card: 'deserter', to: 1 }).state;
    expect(s.ck!.knights[p.verts[4]!]).toBeNull();
    expect(s.stage).toBe('main');
    ok(s);
    let t = ckGame();
    put(t, 0, { settlements: [p.verts[0]!], roads: p.edges });
    put(t, 1, { settlements: [q.verts[3]!], roads: q.edges, knights: [[p.verts[4]!, 2, true]] });
    give(t, 0, 'intrigue');
    t = act(t, 0, { type: 'progress', card: 'intrigue', v: p.verts[4]! }).state;
    expect(t.ck!.owe).toEqual([{ k: 'relocate', p: 1, lvl: 2, on: true, not: p.verts[4]! }]);
    t = act(t, 1, { type: 'choose', v: q.verts[1]! }).state;
    expect(t.ck!.knights[q.verts[1]!]).toEqual({ p: 1, lvl: 2, on: true });
    ok(t);
  });

  it('Diplomat removes an open road; your own may be rebuilt free', () => {
    let s = ckGame();
    const p = path(s, 0, 2);
    put(s, 0, { settlements: [0], roads: p.edges });
    give(s, 0, 'diplomat');
    expect(reject(s, 0, { type: 'progress', card: 'diplomat', e: p.edges[0]! })).toMatch(/open road/);
    s = act(s, 0, { type: 'progress', card: 'diplomat', e: p.edges[1]! }).state;
    expect(s.edges[p.edges[1]!]).toBeNull();
    expect(s.ck!.owe).toEqual([{ k: 'rebuild', p: 0 }]);
    const e = legalActions(s, 0).find(
      (a): a is Extract<Action, { type: 'choose' }> => a.type === 'choose' && a.e != null,
    )!.e!;
    s = act(s, 0, { type: 'choose', e }).state;
    expect(s.edges[e]).toBe(0);
    ok(s);
  });

  it('Inventor swaps numbers (never 2, 12, 6, 8); Irrigation pays 2 wheat per field', () => {
    let s = ckGame();
    give(s, 0, 'inventor', 'irrigation');
    const ok2 = s.board.hexes.flatMap((h, i) => (h.n && ![2, 12, 6, 8].includes(h.n) ? [i] : []));
    const six = s.board.hexes.findIndex((h) => h.n === 6);
    expect(reject(s, 0, { type: 'progress', card: 'inventor', h: six, h2: ok2[0]! })).toMatch(
      /not 2, 12, 6 or 8/,
    );
    const [a, b] = [s.board.hexes[ok2[0]!]!.n, s.board.hexes[ok2[1]!]!.n];
    s = act(s, 0, { type: 'progress', card: 'inventor', h: ok2[0]!, h2: ok2[1]! }).state;
    expect([s.board.hexes[ok2[0]!]!.n, s.board.hexes[ok2[1]!]!.n]).toEqual([b, a]);
    const field = s.board.hexes.findIndex((h) => h.t === 'wheat');
    const v = g(s).hexVerts[field]![0]!;
    put(s, 0, { settlements: [v], roads: [g(s).verts[v]!.edges[0]!] });
    const fields = new Set(g(s).verts[v]!.hexes.filter((h) => s.board.hexes[h]!.t === 'wheat')).size;
    s = act(s, 0, { type: 'progress', card: 'irrigation' }).state;
    expect(s.players[0]!.res.wheat).toBe(2 * fields);
    ok(s);
  });

  it('Commercial Harbor and Master Merchant', () => {
    let s = ckGame();
    put(s, 1, { cities: [0], roads: [g(s).verts[0]!.edges[0]!] });
    give(s, 0, 'commercialHarbor', 'masterMerchant');
    s = setHand(s, 0, { wood: 2 });
    s = setHand(s, 1, { cloth: 1, ore: 3 });
    s = act(s, 0, { type: 'progress', card: 'commercialHarbor' }).state;
    expect(s.ck!.owe).toEqual([{ k: 'harbor', p: 0, left: [1] }]);
    s = act(s, 0, { type: 'choose', to: 1, r: 'wood' }).state;
    s = act(s, 1, { type: 'choose', r: 'cloth' }).state;
    expect(s.players[0]!.res).toMatchObject({ wood: 1, cloth: 1 });
    expect(s.players[1]!.res).toMatchObject({ wood: 1, cloth: 0 });
    s = act(s, 0, { type: 'progress', card: 'masterMerchant', to: 1 }).state;
    expect(viewFor(s, 0).ck!.reveal?.hand).toMatchObject({ ore: 3, wood: 1 });
    s = act(s, 0, { type: 'choose', cards: { ore: 2 } }).state;
    expect(s.players[0]!.res.ore).toBe(2);
    ok(s);
  });

  it('Medicine, Engineer, Crane, Merchant Fleet and Road Building', () => {
    let s = ckGame();
    put(s, 0, {
      settlements: [0],
      cities: [30],
      roads: [g(s).verts[0]!.edges[0]!, g(s).verts[30]!.edges[0]!],
    });
    give(s, 0, 'medicine', 'engineer', 'crane', 'merchantFleet');
    s = setHand(s, 0, { ore: 2, wheat: 1, paper: 3 });
    s = act(s, 0, { type: 'progress', card: 'medicine', v: 0 }).state;
    expect(s.verts[0]).toEqual([0, 2]);
    s = act(s, 0, { type: 'progress', card: 'engineer', v: 30 }).state;
    expect(s.ck!.walls).toEqual([30]);
    s = act(s, 0, { type: 'progress', card: 'crane' }).state;
    s = act(s, 0, { type: 'improve', track: 'science' }).state; // level 1 for 0
    s = act(s, 0, { type: 'improve', track: 'science' }).state; // level 2 for 2
    expect(s.players[0]!.res.paper).toBe(1);
    const before = rateFor(s, 0, 'paper');
    s = act(s, 0, { type: 'progress', card: 'merchantFleet', r: 'paper' }).state;
    expect(rateFor(s, 0, 'paper')).toBe(2);
    s = act(s, 0, { type: 'end' }).state;
    expect(rateFor(s, 0, 'paper')).toBe(before);
    ok(s);
  });
});

describe('Cities & Knights: hidden information', () => {
  it('views never contain deck order or other players’ progress cards', () => {
    const s = ckGame();
    give(s, 1, 'spy', 'merchant');
    const v = viewFor(s, 0);
    expect(v.ck!.decks).toEqual({ trade: 17, politics: 17, science: 18 });
    expect(v.ck!.colors[1]).toEqual({ trade: 1, politics: 1, science: 0 });
    expect(JSON.stringify(v)).not.toContain('spy');
    expect(viewFor(s, 1).ck!.hand).toEqual(['spy', 'merchant']);
  });

  it('a knight type has the fields the client expects', () => {
    const k: Knight = { p: 0, lvl: 1, on: false };
    expect(k).toBeTruthy();
    expect(applyAction).toBeTruthy();
  });
});
