import { describe, expect, it } from 'vitest';
import fogMap from './fixtures/fog-test.json';
import {
  SCENARIOS, applyAction, checkInvariants, edgeSides, geo, isLand, legalActions, newGame, rateFor, roadOK,
  routeLen, seedRng, settlementOK, shipOK, totalVP, viewFor, type GameState, type MapData, type Seat,
} from '../src/index'; // prettier-ignore
import { act, reject, rigDice, setHand } from './helpers';
import { seatsFor } from './simulate';

const HFNS = SCENARIOS['heading-for-new-shores']!;
const FOG = fogMap as unknown as MapData;

/** A Seafarers game with no pieces placed, in the main phase, seat 0 to move. */
function sea(n = 3, map = HFNS, houseRules = {}): GameState {
  const s = structuredClone(newGame('sea', seatsFor(n), { map, houseRules }));
  s.stage = 'main';
  s.turnN = 5;
  s.setupI = n * 2;
  s.dice = [3, 4];
  return s;
}

function put(
  s: GameState,
  p: Seat,
  o: { settlements?: number[]; cities?: number[]; roads?: number[]; ships?: number[] },
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
  for (const e of o.ships ?? []) {
    s.sea!.ships[e] = p;
    s.players[p]!.pieces.ship!--;
  }
  s.roadLens = s.players.map((_, i) => routeLen(s, i));
}

const kind = (s: GameState, e: number) => {
  const sides = edgeSides(s, e);
  const land = sides.filter(isLand).length;
  return land === 2 ? 'land' : land === 1 ? 'coast' : 'sea';
};

/** A coastal vertex on the main island, with its coast edge and a sea edge beyond it. */
function coastSpot(s: GameState) {
  const g = geo(s);
  for (let v = 0; v < g.verts.length; v++) {
    const hs = g.verts[v]!.hexes;
    if (!hs.some((h) => h < 19) || !hs.some((h) => s.board.hexes[h]!.t === 'sea')) continue;
    const coast = g.verts[v]!.edges.find((e) => kind(s, e) === 'coast');
    const land = g.verts[v]!.edges.find((e) => kind(s, e) === 'land');
    if (coast == null || land == null) continue;
    const E = g.edges[coast]!;
    const far = E.a === v ? E.b : E.a;
    const seaEdge = g.verts[far]!.edges.find((e) => kind(s, e) === 'sea');
    if (seaEdge == null) continue;
    const E2 = g.edges[seaEdge]!;
    return { v, coast, land, far, seaEdge, beyond: E2.a === far ? E2.b : E2.a };
  }
  throw new Error('no coast spot');
}

describe('Seafarers setup', () => {
  it('needs 3 or 4 players and gives everyone 15 ships', () => {
    expect(() => newGame('x', seatsFor(2), { map: HFNS })).toThrow(/3, 4 players/);
    const s = newGame('x', seatsFor(4), { map: HFNS });
    expect(s.config.modules).toEqual(['seafarers']);
    expect(s.config.winVP).toBe(14);
    expect(s.players.every((p) => p.pieces.ship === 15)).toBe(true);
    // D14: the pirate starts on a set sea hex (1, 3), not off the board.
    expect(s.board.hexes[s.board.pirate!]).toMatchObject({ q: 1, r: 3, t: 'sea' });
    expect(s.board.hexes[s.board.robber]!.t).toBe('desert');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('allows a starting ship on the coast, never on land', () => {
    let s = newGame('setup-ship', seatsFor(3), { map: HFNS });
    const { v, coast, land } = coastSpot(s);
    expect(reject(s, 0, { type: 'setup', v, e: land, ship: true })).toMatch(/water/);
    s = act(s, 0, { type: 'setup', v, e: coast, ship: true }).state;
    expect(s.sea!.ships[coast]).toBe(0);
    expect(s.edges[coast]).toBeNull();
    expect(s.players[0]!.pieces).toMatchObject({ ship: 14, road: 15, settlement: 4 });
    expect(checkInvariants(s)).toEqual([]);
  });

  it('a map whose starting area is "all" lets you start on any island (custom maps; old saved games)', () => {
    const s = newGame('anywhere', seatsFor(3), { map: { ...HFNS, start: 'all' } });
    const outer = legalActions(s, 0).find(
      (a) => a.type === 'setup' && geo(s).verts[a.v]!.hexes.every((h) => h >= 19),
    );
    expect(outer).toBeDefined();
  });
});

describe('roads and ships', () => {
  it('roads stay on land and coast, ships on coast and sea', () => {
    const s = sea();
    const { v, coast, land, seaEdge } = coastSpot(s);
    put(s, 0, { settlements: [v] });
    expect(roadOK(s, 0, land)).toBe(true);
    expect(roadOK(s, 0, coast)).toBe(true);
    expect(shipOK(s, 0, coast)).toBe(true);
    expect(shipOK(s, 0, land)).toBe(false);
    put(s, 0, { ships: [coast] });
    expect(roadOK(s, 0, seaEdge)).toBe(false);
    expect(shipOK(s, 0, seaEdge)).toBe(true);
  });

  it('a ship costs wood and sheep and must connect to your ship or building', () => {
    let s = sea();
    const { v, coast, seaEdge } = coastSpot(s);
    put(s, 0, { settlements: [v] });
    s = setHand(s, 0, { wood: 1, sheep: 1 });
    expect(reject(s, 0, { type: 'ship', e: seaEdge })).toMatch(/connect/);
    s = act(s, 0, { type: 'ship', e: coast }).state;
    expect(s.players[0]!.res).toMatchObject({ wood: 0, sheep: 0 });
    expect(s.sea!.builtThisTurn).toEqual([coast]);
    expect(reject(s, 0, { type: 'ship', e: seaEdge })).toMatch(/costs/);
  });

  it('roads and ships only join at your own settlement', () => {
    const s = sea();
    const { v, coast, land } = coastSpot(s);
    const g = geo(s);
    // A road leading to the coast vertex, with no settlement there: no ship from the road end.
    put(s, 1, { settlements: [g.edges[land]!.a === v ? g.edges[land]!.b : g.edges[land]!.a], roads: [land] });
    expect(shipOK(s, 1, coast)).toBe(false);
    put(s, 1, { settlements: [v] });
    expect(shipOK(s, 1, coast)).toBe(true);
  });

  it('a ship lets you settle where it ends; never on open water', () => {
    const s = sea();
    const g = geo(s);
    // An outer-island vertex on the coast, and a ship on its coast edge.
    const isle = s.board.hexes.findIndex((h, i) => i >= 19 && isLand(h.t));
    const v = g.hexVerts[isle]!.find((x) => g.verts[x]!.edges.some((e) => kind(s, e) === 'coast'))!;
    const e = g.verts[v]!.edges.find((x) => kind(s, x) === 'coast')!;
    expect(settlementOK(s, 0, v)).toBe(false);
    put(s, 0, { ships: [e] });
    expect(settlementOK(s, 0, v)).toBe(true);
    // A vertex touching only sea can never be settled.
    const water = g.verts.findIndex((V) => V.hexes.every((h) => s.board.hexes[h]!.t === 'sea'));
    const we = g.verts[water]!.edges[0]!;
    put(s, 0, { ships: [we] });
    expect(settlementOK(s, 0, water)).toBe(false);
  });
});

describe('moving ships', () => {
  function ready() {
    const s = sea();
    const spot = coastSpot(s);
    put(s, 0, { settlements: [spot.v], ships: [spot.coast, spot.seaEdge] });
    return { s, ...spot };
  }

  it('moves the ship at the open end, once per turn, never one built this turn', () => {
    const { s, coast, seaEdge } = ready();
    expect(reject(s, 0, { type: 'moveShip', from: coast, to: seaEdge })).toMatch(/open end/);
    const dests = legalActions(s, 0).filter((a) => a.type === 'moveShip');
    expect(dests.length).toBeGreaterThan(0);
    expect(dests.every((a) => a.type === 'moveShip' && a.from === seaEdge)).toBe(true);
    const to = dests[0]!.type === 'moveShip' ? dests[0]!.to : -1;
    const moved = act(s, 0, { type: 'moveShip', from: seaEdge, to });
    expect(moved.events[0]).toEqual({ k: 'moveShip', p: 0, from: seaEdge, to });
    expect(moved.state.sea!.ships[seaEdge]).toBeNull();
    expect(reject(moved.state, 0, { type: 'moveShip', from: to, to: seaEdge })).toMatch(/one ship per turn/);

    const built = structuredClone(s);
    built.sea!.builtThisTurn = [seaEdge];
    expect(reject(built, 0, { type: 'moveShip', from: seaEdge, to })).toMatch(/built this turn/);
  });

  it('house rule: move ships freely', () => {
    const { s, seaEdge } = ready();
    s.config.houseRules = { freeShipMoves: true };
    const a = legalActions(s, 0).find((x) => x.type === 'moveShip')!;
    if (a.type !== 'moveShip') throw new Error();
    const t = act(s, 0, a).state;
    expect(legalActions(t, 0).some((x) => x.type === 'moveShip')).toBe(true);
    void seaEdge;
  });

  it('ships next to the pirate are frozen', () => {
    const { s, seaEdge } = ready();
    const pirateHex = geo(s).edges[seaEdge]!.hexes.find((h) => s.board.hexes[h]!.t === 'sea')!;
    s.board.pirate = pirateHex;
    expect(reject(s, 0, { type: 'moveShip', from: seaEdge, to: 0 })).toMatch(/pirate/);
  });
});

describe('robber and pirate', () => {
  it('the robber can only go on land; the pirate only on sea, stealing from ship owners', () => {
    let s = sea();
    const { v, coast, seaEdge } = coastSpot(s);
    put(s, 1, { settlements: [v], ships: [coast, seaEdge] });
    s = setHand(s, 1, { ore: 2 });
    s.stage = 'robber';
    s.robberReturn = 'main';
    const seaHex = geo(s).edges[seaEdge]!.hexes.find((h) => s.board.hexes[h]!.t === 'sea')!;
    expect(reject(s, 0, { type: 'robber', hex: seaHex })).toMatch(/land/);
    const landHex = s.board.hexes.findIndex((h, i) => h.t === 'wood' && i !== s.board.robber);
    expect(reject(s, 0, { type: 'pirate', hex: landHex })).toMatch(/sea/);
    const r = act(s, 0, { type: 'pirate', hex: seaHex });
    expect(r.events[0]).toEqual({ k: 'pirate', p: 0, h: seaHex, victim: 1 });
    expect(r.events[1]).toMatchObject({ k: 'steal', p: 0, from: 1, r: 'ore' });
    expect(r.state.board.pirate).toBe(seaHex);
    expect(r.state.stage).toBe('main');
    // Ships can't be built next to the pirate.
    const t = setHand(r.state, 1, { wood: 1, sheep: 1 });
    t.turn = 1;
    for (const e of geo(t).edges.flatMap((E, e) => (E.hexes.includes(seaHex) ? [e] : [])))
      expect(shipOK(t, 1, e)).toBe(false);
  });

  it('a Knight can move the pirate instead of the robber', () => {
    let s = sea();
    s.players[0]!.dev.knight = 1;
    s.deck.knight--;
    s = act(s, 0, { type: 'playKnight' }).state;
    expect(legalActions(s, 0).some((a) => a.type === 'pirate')).toBe(true);
    expect(legalActions(s, 0).some((a) => a.type === 'robber')).toBe(true);
  });
});

describe('gold fields', () => {
  it('gold pays a resource of your choice; everyone owed chooses before play continues', () => {
    // The city is put straight onto a small island; a starting area of "all" makes that no new island.
    let s = sea(3, { ...HFNS, start: 'all' });
    s.stage = 'preroll';
    const gold = s.board.hexes.findIndex((h) => h.t === 'gold');
    const n = s.board.hexes[gold]!.n;
    const [v0] = geo(s).hexVerts[gold]!.filter((v) => !geo(s).verts[v]!.hexes.some((h) => h < 19));
    put(s, 1, { cities: [v0!] });
    const r = act(rigDice(s, n), 0, { type: 'roll' });
    expect(r.events).toContainEqual({ k: 'goldOwed', owed: { 1: 2 } });
    s = r.state;
    expect(s.stage).toBe('gold');
    expect(reject(s, 0, { type: 'end' })).toBeTruthy();
    expect(reject(s, 1, { type: 'chooseGold', cards: { ore: 1 } })).toMatch(/exactly 2/);
    const done = act(s, 1, { type: 'chooseGold', cards: { ore: 1, wheat: 1 } });
    expect(done.events).toEqual([{ k: 'gold', p: 1, got: { ore: 1, wheat: 1 } }]);
    expect(done.state.stage).toBe('main');
    expect(done.state.players[1]!.res).toMatchObject({ ore: 1, wheat: 1 });
    expect(checkInvariants(done.state)).toEqual([]);
  });

  it('a second starting settlement next to gold earns a free choice', () => {
    // Heading for New Shores keeps gold on the small islands; a map that allows starting there.
    let s = newGame('gold-setup', seatsFor(3), { map: { ...HFNS, start: 'all' } });
    const gold = s.board.hexes.findIndex((h) => h.t === 'gold');
    // Play setup with the first legal moves, but place the very last settlement next to gold.
    for (let i = 0; i < 5; i++) {
      const a = legalActions(s, s.turn).find(
        (x) => x.type === 'setup' && !x.ship && !geo(s).verts[x.v]!.hexes.includes(gold),
      )!;
      s = act(s, s.turn, a).state;
    }
    const last = legalActions(s, s.turn).find(
      (x) => x.type === 'setup' && !x.ship && geo(s).verts[x.v]!.hexes.includes(gold),
    )!;
    const p = s.turn;
    s = act(s, p, last).state;
    expect(s.stage).toBe('gold');
    expect(s.sea!.gold).toEqual({ owed: { [p]: 1 }, back: 'preroll' });
    s = act(s, p, { type: 'chooseGold', cards: { brick: 1 } }).state;
    expect(s.stage).toBe('preroll');
  });
});

describe('island bonus and winning', () => {
  it('2 VP for the first settlement on each island that isn’t home, once per island', () => {
    let s = sea();
    const g = geo(s);
    s.sea!.home[0] = [Array.from({ length: 19 }, (_, i) => i)];
    const isle = s.board.hexes.findIndex((h, i) => i >= 19 && isLand(h.t));
    const coastVs = g.hexVerts[isle]!.filter((x) => g.verts[x]!.edges.some((e) => kind(s, e) === 'coast'));
    const v = coastVs[0]!;
    const e = g.verts[v]!.edges.find((x) => kind(s, x) === 'coast')!;
    put(s, 0, { ships: [e] });
    s = setHand(s, 0, { wood: 2, brick: 2, sheep: 2, wheat: 2 });
    const before = totalVP(s, 0);
    const r = act(s, 0, { type: 'settlement', v });
    expect(r.events).toContainEqual({ k: 'islandBonus', p: 0, vp: 2 });
    expect(totalVP(r.state, 0)).toBe(before + 1 + 2);
    expect(r.state.sea!.specialVP[0]).toBe(2);
    expect(checkInvariants(r.state)).toEqual([]);
    // A second settlement on the same island earns nothing extra.
    const w = coastVs.find((x) => x !== v && !g.verts[v]!.adj.includes(x) && x !== v)!;
    const t = structuredClone(r.state);
    put(t, 0, { ships: [g.verts[w]!.edges.find((x) => kind(t, x) === 'coast')!] });
    const r2 = act(t, 0, { type: 'settlement', v: w });
    expect(r2.events.some((x) => x.k === 'islandBonus')).toBe(false);
  });

  it('settling a home island earns no bonus', () => {
    let s = sea();
    const { v, coast } = coastSpot(s);
    s.sea!.home[0] = [Array.from({ length: 19 }, (_, i) => i)];
    put(s, 0, { ships: [coast] });
    s = setHand(s, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
    const r = act(s, 0, { type: 'settlement', v });
    expect(r.events.some((x) => x.k === 'islandBonus')).toBe(false);
  });

  it('wins at 14 on your own turn', () => {
    const s = sea();
    s.players[0]!.vpCards = 13;
    s.deck.vp = 0;
    s.deck = { knight: 0, road: 0, plenty: 0, mono: 0, vp: 1 };
    s.players[0]!.vpCards = 13;
    const t = setHand(s, 0, { sheep: 1, wheat: 1, ore: 1 });
    const r = act(t, 0, { type: 'buyDev' });
    expect(r.state.phase).toBe('over');
  });
});

describe('longest trade route', () => {
  it('counts roads and ships joined at your own settlement', () => {
    const s = sea();
    const { v, coast, land, seaEdge } = coastSpot(s);
    put(s, 0, { settlements: [v], roads: [land], ships: [coast, seaEdge] });
    expect(routeLen(s, 0)).toBe(3);
    const t = structuredClone(s);
    t.verts[v] = null;
    t.players[0]!.pieces.settlement++;
    // Without the settlement the road and ships don't join.
    expect(routeLen(t, 0)).toBe(2);
  });

  it('road building can place ships', () => {
    let s = sea();
    const { v, coast, seaEdge } = coastSpot(s);
    put(s, 0, { settlements: [v] });
    s.players[0]!.dev.road = 1;
    s.deck.road--;
    s = act(s, 0, { type: 'playRoads' }).state;
    s = act(s, 0, { type: 'freeShip', e: coast }).state;
    s = act(s, 0, { type: 'freeShip', e: seaEdge }).state;
    expect(s.stage).toBe('main');
    expect(s.sea!.ships[seaEdge]).toBe(0);
  });
});

describe('fog', () => {
  it('building next to fog discovers it and rewards the builder', () => {
    let s = sea(3, FOG);
    const g = geo(s);
    // A main-island coast vertex next to fog.
    const v = g.verts.findIndex(
      (V) => V.hexes.some((h) => h < 19) && V.hexes.some((h) => s.board.hexes[h]!.t === 'fog'),
    );
    const e = g.verts[v]!.edges.find((x) => edgeSides(s, x).includes('fog') && edgeSides(s, x).some(isLand))!;
    put(s, 0, { settlements: [v] });
    s = setHand(s, 0, { wood: 1, brick: 1 });
    const fogBefore = s.sea!.fog.terrain.length;
    const r = act(s, 0, { type: 'road', e });
    const d = r.events.find((x) => x.k === 'discover');
    expect(d).toBeDefined();
    expect(r.state.sea!.fog.terrain.length).toBe(fogBefore - 1);
    if (d && d.k === 'discover' && d.t !== 'sea' && d.t !== 'gold' && d.t !== 'desert')
      expect(d.got).toEqual({ [d.t]: 1 });
    if (d && d.k === 'discover' && d.t === 'gold') expect(r.state.stage).toBe('gold');
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('the fog stack never appears in a player’s view', () => {
    const s = sea(3, FOG);
    const v = viewFor(s, 0);
    expect(v.sea!.fogLeft).toBe(18);
    expect(JSON.stringify(v)).not.toContain('"terrain"');
  });
});

describe('house rules', () => {
  it('no 7s in the first round: a 7 is rolled again', () => {
    let s = sea(3, HFNS, { no7FirstRound: true });
    s.stage = 'preroll';
    s.turnN = 1;
    s = rigDice(s, 7);
    const r = act(s, 0, { type: 'roll' });
    expect(r.events[0]).toMatchObject({ k: 'roll', redo: true });
    const last = r.events.filter((e) => e.k === 'roll').at(-1)!;
    if (last.k !== 'roll') throw new Error();
    expect(last.d[0] + last.d[1]).not.toBe(7);
    // After the first round 7s count.
    let t = sea(3, HFNS, { no7FirstRound: true });
    t.stage = 'preroll';
    t.turnN = 4;
    t = rigDice(t, 7);
    expect(act(t, 0, { type: 'roll' }).events[0]).toMatchObject({ k: 'roll', d: expect.anything() });
    expect(act(t, 0, { type: 'roll' }).state.dice!.reduce((a, b) => a + b)).toBe(7);
  });

  it('3:1 bank trades for everyone', () => {
    const s = sea(3, HFNS, { bank3to1: true });
    expect(rateFor(s, 0, 'wood')).toBe(3);
    expect(rateFor(sea(), 0, 'wood')).toBe(4);
  });
});

void seedRng;
void applyAction;
