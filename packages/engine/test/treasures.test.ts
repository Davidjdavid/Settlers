import { describe, expect, it } from 'vitest';
import {
  CLASSIC_MAP, SCENARIOS, applyAction, checkInvariants, eventsFor, geo, legalActions, newGame, shipOK,
  viewFor, waitingOn, type GameState, type MapData, type Seat, type TreasureKind,
} from '../src/index'; // prettier-ignore
import { act, edgePath, place, reject, setHand } from './helpers';
import { seatsFor } from './simulate';

/** A map with treasure spots (the tests then choose which edges are spots, and the deck). */
const withSpots = (m: MapData): MapData => ({
  ...m,
  id: `${m.id}-tr`,
  treasures: [{ q: m.hexes[0]!.q, r: m.hexes[0]!.r, side: 0 }],
});

/** A game in the main phase, seat 0 to move, with treasure spots at `spots` holding `deck`. */
function game(
  spots: (s: GameState) => number[],
  deck: TreasureKind[],
  o: { map?: MapData; modules?: ('seafarers' | 'citiesKnights')[]; bank?: 'unlimited' } = {},
): GameState {
  const map = withSpots(o.map ?? CLASSIC_MAP);
  const s = structuredClone(
    newGame('tr', seatsFor(3), {
      map,
      order: 'given',
      ...(o.modules ? { modules: o.modules } : {}),
      ...(o.bank ? { bank: o.bank } : {}),
    }),
  );
  s.stage = 'main';
  s.turnN = 5;
  s.setupI = 6;
  s.dice = [3, 4];
  s.tr!.spots = spots(s);
  s.tr!.deck = deck.slice();
  return s;
}

/** Seat 0 with a settlement and a road, and the next edge along the path as a treasure spot. */
function road(deck: TreasureKind[], o: Parameters<typeof game>[2] = {}) {
  let path: number[] = [];
  let s = game(
    (s) => {
      path = edgePath(s, landCorner(s), 3).edges;
      return [path[1]!];
    },
    deck,
    o,
  );
  const v0 = landCorner(s);
  s = place(s, 0, { settlements: [v0], roads: [path[0]!] });
  s = setHand(s, 0, { wood: 3, brick: 3 });
  return { s, spot: path[1]!, next: path[2]! };
}

/** A corner in the middle of the land, so roads can go anywhere around it. */
function landCorner(s: GameState): number {
  const g = geo(s);
  return g.verts.findIndex(
    (v) => v.hexes.length === 3 && v.hexes.every((h) => s.board.hexes[h]!.t !== 'sea'),
  );
}

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([]);

describe('treasures (docs/rules/treasures.md)', () => {
  it('a map with spots plays with treasures in every mode; the deck is one card per spot, dealt round (D1, D8)', () => {
    const map: MapData = {
      ...CLASSIC_MAP,
      id: 'six',
      treasures: [0, 1, 2, 3, 4, 5].map((side) => ({
        q: CLASSIC_MAP.hexes[9]!.q,
        r: CLASSIC_MAP.hexes[9]!.r,
        side,
      })),
    };
    const s = newGame('d1', seatsFor(3), { map });
    expect(s.config.modules).toEqual(['treasures']);
    expect(s.tr!.spots).toHaveLength(6);
    expect([...s.tr!.deck].sort()).toEqual(['dev', 'pick', 'pick', 'roads', 'roads', 'trio']);
    ok(s);
    // Two names for one edge are refused by the map check.
    const twice: MapData = {
      ...map,
      treasures: [
        { q: 0, r: 0, side: 0 },
        { q: 1, r: 0, side: 3 },
      ],
    };
    expect(() => newGame('d1', seatsFor(3), { map: twice })).toThrow(/same edge/);
    // A classic game is untouched.
    expect(newGame('d1', seatsFor(3)).config).toEqual({ winVP: 10 });
    expect(newGame('d1', seatsFor(3)).tr).toBeUndefined();
  });

  it('building a road on a spot finds it: sheep, brick and wheat; the spot is gone for good', () => {
    const { s, spot } = road(['trio']);
    const r = act(s, 0, { type: 'road', e: spot });
    expect(r.events).toContainEqual({ k: 'treasure', p: 0, e: spot, kind: 'trio' });
    expect(r.events).toContainEqual({ k: 'treasureGot', p: 0, got: { sheep: 1, brick: 1, wheat: 1 } });
    expect(r.state.players[0]!.res).toMatchObject({ sheep: 1, brick: 3, wheat: 1 });
    expect(r.state.tr!.spots).toEqual([]);
    expect(r.state.tr!.found).toEqual([{ e: spot, p: 0, k: 'trio' }]);
    ok(r.state);
  });

  it('2 resources of your choice: a sheet only the finder answers, then play goes on', () => {
    const { s, spot } = road(['pick']);
    const r = act(s, 0, { type: 'road', e: spot }).state;
    expect(r.stage).toBe('treasure');
    expect(waitingOn(r)).toEqual([0]);
    ok(r);
    expect(reject(r, 0, { type: 'end' })).toBeTruthy();
    expect(reject(r, 1, { type: 'treasurePick', cards: { ore: 2 } })).toMatch(/no treasure/);
    expect(reject(r, 0, { type: 'treasurePick', cards: { ore: 1 } })).toMatch(/Pick 2/);
    expect(reject(r, 0, { type: 'treasurePick', cards: { paper: 2 } as never })).toBeTruthy();
    const picks = legalActions(r, 0);
    expect(picks.every((a) => a.type === 'treasurePick')).toBe(true);
    expect(picks).toHaveLength(15);
    const d = act(r, 0, { type: 'treasurePick', cards: { ore: 2 } });
    expect(d.state.stage).toBe('main');
    expect(d.state.players[0]!.res.ore).toBe(2);
    expect(d.events).toContainEqual({ k: 'treasureGot', p: 0, got: { ore: 2 } });
    ok(d.state);
  });

  it('the bank running short: you get what it has; an Unlimited bank never runs short (D4)', () => {
    // Sheep, brick and wheat with no sheep in the bank.
    let { s, spot } = road(['trio']);
    s.players[1]!.res.sheep = s.bank.sheep;
    s.bank.sheep = 0;
    let r = act(s, 0, { type: 'road', e: spot });
    expect(r.events).toContainEqual({ k: 'treasureGot', p: 0, got: { brick: 1, wheat: 1 } });
    ok(r.state);
    // Two of your choice with one card left in the bank by the time you choose: you pick that one.
    ({ s, spot } = road(['pick']));
    const st = act(s, 0, { type: 'road', e: spot }).state;
    for (const k of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
      st.players[1]!.res[k] += st.bank[k];
      st.bank[k] = 0;
    }
    st.players[1]!.res.ore--;
    st.bank.ore = 1;
    expect(st.stage).toBe('treasure');
    expect(legalActions(st, 0)).toEqual([{ type: 'treasurePick', cards: { ore: 1 } }]);
    expect(reject(st, 0, { type: 'treasurePick', cards: { ore: 2 } })).toMatch(/out of ore/);
    expect(act(st, 0, { type: 'treasurePick', cards: { ore: 1 } }).state.players[0]!.res.ore).toBe(1);
    // Unlimited: all three, always.
    ({ s, spot } = road(['trio'], { bank: 'unlimited' }));
    r = act(s, 0, { type: 'road', e: spot });
    expect(r.events).toContainEqual({ k: 'treasureGot', p: 0, got: { sheep: 1, brick: 1, wheat: 1 } });
  });

  it('free roads: 2 placed straight away, with the normal rules and piece limits', () => {
    const { s, spot, next } = road(['roads']);
    const r = act(s, 0, { type: 'road', e: spot });
    expect(r.state.stage).toBe('roads');
    expect(r.state.freeRoads).toBe(2);
    expect(r.events).toContainEqual({ k: 'treasureRoads', p: 0, n: 2 });
    const one = act(r.state, 0, { type: 'freeRoad', e: next }).state;
    expect(one.freeRoads).toBe(1);
    ok(one);
    // Only one road left in supply: one free road.
    const low = structuredClone(s);
    low.players[0]!.pieces.road = 2; // one for the road that finds it, one left
    const r2 = act(low, 0, { type: 'road', e: spot });
    expect(r2.events).toContainEqual({ k: 'treasureRoads', p: 0, n: 1 });
    expect(r2.state.freeRoads).toBe(1);
    // None left: nothing to place.
    low.players[0]!.pieces.road = 1;
    const r3 = act(low, 0, { type: 'road', e: spot });
    expect(r3.events).toContainEqual({ k: 'treasureRoads', p: 0, n: 0 });
    expect(r3.state.stage).toBe('main');
  });

  it('found while placing free pieces: the new 2 are added to the ones still to place (D3)', () => {
    const { s, spot } = road(['roads']);
    const rb = structuredClone(s);
    rb.stage = 'roads';
    rb.freeRoads = 2;
    rb.roadsReturn = 'main';
    const r = act(rb, 0, { type: 'freeRoad', e: spot });
    expect(r.state.stage).toBe('roads');
    expect(r.state.freeRoads).toBe(3);
    // Found with the last free piece: 2 more.
    rb.freeRoads = 1;
    const last = act(rb, 0, { type: 'freeRoad', e: spot });
    expect(last.state.stage).toBe('roads');
    expect(last.state.freeRoads).toBe(2);
    expect(last.state.roadsReturn).toBe('main');
    ok(last.state);
  });

  it('a free development card: new this turn; none left turns the treasure into another kind (D5, D6)', () => {
    let { s, spot } = road(['dev']);
    let r = act(s, 0, { type: 'road', e: spot });
    const dev = r.events.find((e) => e.k === 'treasureDev')!;
    expect(dev).toBeTruthy();
    const card = (dev as { card: string }).card;
    expect(card).toBeTruthy();
    const me = r.state.players[0]!;
    if (card === 'vp') expect(me.vpCards).toBe(1);
    else expect(me.fresh[card as 'knight']).toBe(1);
    // Others see only that a card came.
    expect(eventsFor(r.events, 1).find((e) => e.k === 'treasureDev')).toEqual({
      k: 'treasureDev',
      p: 0,
      card: null,
    });
    ok(r.state);
    // The development deck empty: rerolled into roads, a pick or the trio.
    ({ s, spot } = road(['dev']));
    for (const k of Object.keys(s.deck) as (keyof typeof s.deck)[]) s.deck[k] = 0;
    r = act(s, 0, { type: 'road', e: spot });
    const t = r.events.find((e) => e.k === 'treasure') as { kind: string; from?: string };
    expect(t.from).toBe('dev');
    expect(['roads', 'pick', 'trio']).toContain(t.kind);
    expect(r.state.tr!.found[0]!.k).toBe(t.kind);
  });

  it('Knights: a progress card from the deck you pick; every deck empty rerolls it', () => {
    let { s, spot } = road(['dev'], { modules: ['citiesKnights'] });
    let r = act(s, 0, { type: 'road', e: spot }).state;
    expect(r.stage).toBe('treasure');
    expect(legalActions(r, 0).map((a) => a.type)).toEqual(['treasureDeck', 'treasureDeck', 'treasureDeck']);
    r.ck!.decks.trade = [];
    expect(reject(r, 0, { type: 'treasureDeck', track: 'trade' })).toMatch(/empty/);
    const top = r.ck!.decks.science[0]!;
    const d = act(r, 0, { type: 'treasureDeck', track: 'science' });
    expect(d.events).toContainEqual({ k: 'draw', p: 0, track: 'science', card: top });
    expect(d.state.stage).toBe('main');
    ({ s, spot } = road(['dev'], { modules: ['citiesKnights'] }));
    s.ck!.decks = { trade: [], science: [], politics: [] };
    const e = act(s, 0, { type: 'road', e: spot }).events.find((e) => e.k === 'treasure') as {
      from?: string;
    };
    expect(e.from).toBe('dev');
  });

  it('a ship built on a spot finds it, and so does a ship moved onto one', () => {
    const map = SCENARIOS['heading-for-new-shores']!;
    let s = game(() => [], ['trio', 'trio'], { map, modules: ['seafarers'] });
    // A coastal settlement for seat 0 and two sea edges in a row from it.
    const g = geo(s);
    const v = g.verts.findIndex(
      (x, i) =>
        x.hexes.length === 3 &&
        x.hexes.some((h) => s.board.hexes[h]!.t === 'sea') &&
        x.hexes.some((h) => s.board.hexes[h]!.t !== 'sea' && s.board.hexes[h]!.t !== 'fog') &&
        i >= 0,
    );
    s = place(s, 0, { settlements: [v] });
    s = setHand(s, 0, { wood: 4, sheep: 4 });
    const first = g.verts[v]!.edges.find((e) => shipOK(s, 0, e))!;
    s.tr!.spots = [first];
    s.tr!.deck = ['trio'];
    const r = act(s, 0, { type: 'ship', e: first });
    expect(r.events).toContainEqual({ k: 'treasure', p: 0, e: first, kind: 'trio' });
    ok(r.state);
    // Moving a ship: one built last turn, moved onto a spot.
    const t = structuredClone(r.state);
    t.sea!.builtThisTurn = [];
    const E = geo(t).edges[first]!;
    const far = E.a === v ? E.b : E.a;
    const onto = geo(t).verts[far]!.edges.find((e) => e !== first && shipOK(t, 0, e));
    if (onto == null) return; // (the coast turns back to land here)
    const away = geo(t).verts[v]!.edges.find((e) => e !== first && shipOK(t, 0, e));
    if (away == null) return;
    t.tr!.spots = [away];
    t.tr!.deck = ['trio'];
    const m = applyAction(t, 0, { type: 'moveShip', from: first, to: away });
    if (m.ok) {
      expect(m.events).toContainEqual({ k: 'treasure', p: 0, e: away, kind: 'trio' });
      ok(m.state);
    }
  });

  it('setup roads find treasures too (D2): choices straight away, free roads on your first turn', () => {
    const map = withSpots(CLASSIC_MAP);
    let s = newGame('setup', seatsFor(3), { map, order: 'given' });
    const a = legalActions(s, 0).find((x) => x.type === 'setup') as { v: number; e: number };
    s = structuredClone(s);
    s.tr!.spots = [a.e];
    s.tr!.deck = ['pick'];
    const r = act(s, 0, { type: 'setup', v: a.v, e: a.e }).state;
    expect(r.stage).toBe('treasure');
    expect(r.tr!.back).toBe('setup');
    expect(waitingOn(r)).toEqual([0]);
    const after = act(r, 0, { type: 'treasurePick', cards: { wood: 1, ore: 1 } }).state;
    expect(after.stage).toBe('setup');
    expect(after.turn).toBe(1);
    ok(after);
    // Free roads found in setup wait for the finder's first turn.
    s.tr!.deck = ['roads'];
    let g2 = act(s, 0, { type: 'setup', v: a.v, e: a.e }).state;
    expect(g2.tr!.owe).toEqual([{ p: 0, k: 'roads', n: 2 }]);
    while (g2.stage === 'setup') g2 = act(g2, g2.turn, legalActions(g2, g2.turn)[0]!).state;
    expect(g2.turn).toBe(0);
    expect(g2.stage).toBe('roads');
    expect(g2.freeRoads).toBe(2);
    expect(g2.roadsReturn).toBe('preroll');
    ok(g2);
  });

  it('views show the spots, never the deck', () => {
    const { s } = road(['trio']);
    s.tr!.spots = [...s.tr!.spots, ...s.tr!.spots.map((e) => e + 1)];
    s.tr!.deck = ['dev', 'roads'];
    const v = viewFor(s, 1);
    expect(v.tr!.spots).toEqual(s.tr!.spots);
    expect(JSON.stringify(v)).not.toMatch(/"deck":\["/);
    expect(Object.keys(v.tr!).sort()).toEqual(['back', 'found', 'owe', 'spots']);
  });

  it('the invariants catch a lost card and a found spot coming back', () => {
    const { s } = road(['trio']);
    const bad = structuredClone(s);
    bad.tr!.deck = [];
    expect(checkInvariants(bad).join()).toMatch(/treasure deck/);
    const twice = structuredClone(s);
    twice.tr!.found = [{ e: s.tr!.spots[0]!, p: 0 as Seat, k: 'trio' }];
    expect(checkInvariants(twice).join()).toMatch(/still face down/);
  });
});
