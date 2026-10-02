/* Map editor actions, the board checker and the generator (docs/maps.md 6). */

import { describe, expect, it } from 'vitest';
import {
  ANYTHING_GOES,
  applyAction,
  applyEdit,
  checkBoard,
  CLASSIC_MAP,
  coastalSides,
  counts,
  EditHistory,
  emptyMap,
  fairnessSummary,
  fillRest,
  generate,
  geo,
  greedyDraft,
  legalActions,
  mapProblems,
  modelOf,
  newGame,
  normalize,
  OUR_RULES,
  SCENARIOS,
  standardBlank,
  validateMap,
  type At,
  type EditOp,
  type GenRules,
  type MapData,
  type RuleId,
} from '../src/index';
import { TEST_PRESETS } from './mapPresets';
import { seatsFor } from './simulate';

const blank = () => standardBlank(CLASSIC_MAP, 'm-test', 'Test');
const ok = (m: MapData, op: EditOp): MapData => {
  const r = applyEdit(m, op);
  if (!r.ok) throw new Error(r.error);
  expect(mapProblems(r.map)).toEqual([]);
  return r.map;
};
const refused = (m: MapData, op: EditOp): string => {
  const r = applyEdit(m, op);
  if (r.ok) throw new Error(`expected ${op.k} to be refused`);
  return r.error;
};
const hex = (m: MapData, at: At) => m.hexes.find((h) => h.q === at[0] && h.r === at[1])!;
const pool = (m: MapData) => m.pools?.auto ?? { terrain: [], numbers: [] };
const count = <T>(xs: T[], x: T) => xs.filter((y) => y === x).length;

describe('editor actions', () => {
  it('starts from the standard board, all blank, with the standard set', () => {
    const m = blank();
    expect(m.hexes).toHaveLength(19);
    expect(m.harbors).toHaveLength(9);
    expect(pool(m).terrain).toHaveLength(19);
    expect(pool(m).numbers).toHaveLength(18);
    expect(m.harborPool).toHaveLength(9);
    expect(validateMap(m)).toEqual([]);
  });

  it('places a tile, and the pool loses one of that tile', () => {
    let m = blank();
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'ore' });
    expect(hex(m, [0, 0]).t).toBe('ore');
    expect(count(pool(m).terrain, 'ore')).toBe(2);
    expect(pool(m).terrain).toHaveLength(18);
    // A fourth ore: the pool has none left, so something else makes room.
    m = ok(m, { k: 'terrain', at: [1, 0], t: 'ore' });
    m = ok(m, { k: 'terrain', at: [0, 1], t: 'ore' });
    m = ok(m, { k: 'terrain', at: [-1, 0], t: 'ore' });
    expect(count(pool(m).terrain, 'ore')).toBe(0);
    expect(pool(m).terrain).toHaveLength(15);
    expect(counts(m).placed.terrain.ore).toBe(4);
    expect(counts(m).set.terrain.ore).toBe(3);
  });

  it('places and changes a number; refuses one on the desert, a blank or a bad value', () => {
    let m = ok(blank(), { k: 'terrain', at: [0, 0], t: 'wheat' });
    m = ok(m, { k: 'number', at: [0, 0], n: 6 });
    expect(hex(m, [0, 0]).n).toBe(6);
    expect(count(pool(m).numbers, 6)).toBe(1);
    m = ok(m, { k: 'number', at: [0, 0], n: 'random' });
    expect(hex(m, [0, 0]).n).toBe('random');
    expect(count(pool(m).numbers, 6)).toBe(2);
    expect(refused(m, { k: 'number', at: [1, 0], n: 5 })).toBe('Place a tile there first');
    expect(refused(m, { k: 'number', at: [0, 0], n: 7 })).toBe('Numbers go from 2 to 12, without 7');
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'desert' });
    expect(hex(m, [0, 0]).n).toBeUndefined();
    expect(refused(m, { k: 'number', at: [0, 0], n: 5 })).toBe('The desert doesn’t take a number');
  });

  it('places, changes and removes harbors only on the coast, never sharing a corner', () => {
    let m = blank();
    const h = m.harbors[0]!;
    m = ok(m, { k: 'harbor', at: [h.q, h.r], side: h.side, t: 'ore' });
    expect(m.harbors[0]!.t).toBe('ore');
    expect(m.harborPool).toHaveLength(8);
    expect(count(m.harborPool!, 'ore')).toBe(0);
    m = ok(m, { k: 'harbor', at: [h.q, h.r], side: h.side, t: null });
    expect(m.harbors).toHaveLength(8);
    expect(refused(m, { k: 'harbor', at: [0, 0], side: 0, t: 'any' })).toBe('Harbors go on the coast');
    // Next to an existing harbor's side: they'd share a corner.
    const o = m.harbors[0]!;
    expect(refused(m, { k: 'harbor', at: [o.q, o.r], side: (o.side + 1) % 6, t: 'any' })).toBe(
      'Two harbors can’t share a corner',
    );
  });

  it('swaps tiles, numbers and harbors by dragging', () => {
    let m = ok(blank(), { k: 'terrain', at: [0, 0], t: 'wheat' });
    m = ok(m, { k: 'number', at: [0, 0], n: 8 });
    m = ok(m, { k: 'terrain', at: [2, -2], t: 'brick' });
    m = ok(m, { k: 'number', at: [2, -2], n: 4 });
    m = ok(m, { k: 'swapTile', a: [0, 0], b: [2, -2] });
    expect(hex(m, [0, 0])).toMatchObject({ t: 'brick', n: 4 });
    expect(hex(m, [2, -2])).toMatchObject({ t: 'wheat', n: 8 });
    m = ok(m, { k: 'swapNumber', a: [0, 0], b: [2, -2] });
    expect(hex(m, [0, 0])).toMatchObject({ t: 'brick', n: 8 });
    // A tile dragged onto a blank swaps with the blank.
    m = ok(m, { k: 'swapTile', a: [0, 0], b: [1, 0] });
    expect(hex(m, [1, 0])).toMatchObject({ t: 'brick', n: 8 });
    expect(hex(m, [0, 0]).t).toBe('random');
    expect(refused(m, { k: 'swapNumber', a: [1, 0], b: [0, 0] })).toBe('Place a tile there first');

    const [a, b] = m.harbors;
    m = ok(m, { k: 'harbor', at: [a!.q, a!.r], side: a!.side, t: 'sheep' });
    m = ok(m, { k: 'harbor', at: [b!.q, b!.r], side: b!.side, t: 'wood' });
    m = ok(m, {
      k: 'moveHarbor',
      from: { at: [a!.q, a!.r], side: a!.side },
      to: { at: [b!.q, b!.r], side: b!.side },
    });
    expect(m.harbors[0]!.t).toBe('wood');
    expect(m.harbors[1]!.t).toBe('sheep');
    // Move to a free coastal side.
    const used = new Set(m.harbors.flatMap((h) => [`${h.q},${h.r}`]));
    const free = coastalSides(m).find(
      (s) =>
        !used.has(s.at.join(',')) &&
        applyEdit(m, { k: 'moveHarbor', from: { at: [a!.q, a!.r], side: a!.side }, to: s }).ok,
    )!;
    m = ok(m, { k: 'moveHarbor', from: { at: [a!.q, a!.r], side: a!.side }, to: free });
    expect(m.harbors[0]).toMatchObject({ q: free.at[0], r: free.at[1], side: free.side, t: 'wood' });
  });

  it('reshapes: new hexes go at the end, removing one drops its harbors', () => {
    let m = blank();
    const order = m.hexes.map((h) => `${h.q},${h.r}`);
    expect(refused(m, { k: 'addHex', at: [5, 5], t: 'wood' })).toBe('New hexes go next to the board');
    m = ok(m, { k: 'addHex', at: [3, -1], t: 'wood' });
    expect(m.hexes.map((h) => `${h.q},${h.r}`)).toEqual([...order, '3,-1']);
    expect(counts(m).set.terrain).toMatchObject({ wood: 5 });
    expect(pool(m).terrain).toHaveLength(19);
    const h = m.harbors[0]!;
    const before = m.harbors.length;
    m = ok(m, { k: 'removeHex', at: [h.q, h.r] });
    expect(m.harbors.length).toBeLessThan(before);
    expect(m.hexes).toHaveLength(19);
    expect(refused(m, { k: 'addHex', at: [0, 0], t: 'wood' })).toBe('There’s already a hex there');
  });

  it('gold, fog and inner sea need Seafarers', () => {
    let m = blank();
    expect(refused(m, { k: 'terrain', at: [0, 0], t: 'gold' })).toBe('Sea, gold and fog need Seafarers');
    m = ok(m, { k: 'meta', seafarers: true });
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'sea' });
    m = ok(m, { k: 'terrain', at: [1, 0], t: 'gold' });
    m = ok(m, { k: 'terrain', at: [0, 1], t: 'fog' });
    expect(m.fog!.terrain.length).toBeGreaterThanOrEqual(1);
    expect(refused(m, { k: 'meta', seafarers: false })).toBe('Take away the sea, gold and fog first');
    const bad = { ...m, modules: [] };
    expect(mapProblems(bad)).toContain('sea, gold and fog tiles need Seafarers');
  });

  it('locks keep tiles, numbers and harbors through Clear unlocked and edits', () => {
    let m = ok(blank(), { k: 'terrain', at: [0, 0], t: 'wheat' });
    m = ok(m, { k: 'number', at: [0, 0], n: 6 });
    m = ok(m, { k: 'terrain', at: [1, 0], t: 'ore' });
    const h = m.harbors[2]!;
    m = ok(m, { k: 'harbor', at: [h.q, h.r], side: h.side, t: 'brick' });
    m = ok(m, { k: 'lock', at: [0, 0], what: 't', on: true });
    m = ok(m, { k: 'lock', at: [0, 0], what: 'n', on: true });
    m = ok(m, { k: 'lockHarbor', at: [h.q, h.r], side: h.side, on: true });
    expect(refused(m, { k: 'terrain', at: [0, 0], t: 'wood' })).toBe('That tile is locked');
    expect(refused(m, { k: 'number', at: [0, 0], n: 5 })).toBe('That number is locked');
    expect(refused(m, { k: 'harbor', at: [h.q, h.r], side: h.side, t: 'any' })).toBe('That harbor is locked');
    expect(refused(m, { k: 'lock', at: [5, 5], what: 't', on: true })).toBe('There’s no hex there');
    expect(refused(m, { k: 'lock', at: [2, 0], what: 't', on: true })).toBe('Place a tile there first');
    m = ok(m, { k: 'clear' });
    expect(hex(m, [0, 0])).toMatchObject({ t: 'wheat', n: 6 });
    expect(hex(m, [1, 0]).t).toBe('random');
    expect(m.harbors[2]!.t).toBe('brick');
    expect(m.harbors.filter((x) => x.t !== 'random')).toHaveLength(1);
    m = ok(m, { k: 'lock', at: [0, 0], what: 't', on: false });
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'random' });
    // The number stays (locked) on the blank tile.
    expect(hex(m, [0, 0]).n).toBe(6);
  });

  it('names, player counts and points to win are checked', () => {
    const m = blank();
    expect(ok(m, { k: 'meta', name: '  Ring island  ' }).name).toBe('Ring island');
    expect(refused(m, { k: 'meta', name: '   ' })).toBe('Give the map a name');
    expect(refused(m, { k: 'meta', players: [5] })).toBe('Maps are for 2 to 4 players');
    expect(refused(m, { k: 'meta', winVP: 2 })).toBe('Points to win go from 3 to 30');
    expect(ok(m, { k: 'meta', players: [4, 3, 3], winVP: 12 })).toMatchObject({ players: [3, 4], winVP: 12 });
  });

  it('Seafarers pieces (SPEC 10.1): start area, island points, pirate start, fog stack', () => {
    let m = blank();
    expect(refused(m, { k: 'start', at: [0, 0], on: true })).toBe('A start area needs Seafarers');
    m = ok(m, { k: 'meta', seafarers: true, players: [3] });
    m = ok(m, { k: 'terrain', at: [2, -2], t: 'sea' });
    m = ok(m, { k: 'terrain', at: [0, 2], t: 'fog' });
    // Start area: painted hexes; none painted means all land.
    expect(m.start ?? 'all').toBe('all');
    for (const at of [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
    ] as At[]) {
      // One hex at a time: the area is too small until there's room for everyone.
      const r = applyEdit(m, { k: 'start', at, on: true });
      if (!r.ok) throw new Error(r.error);
      m = r.map;
    }
    expect(mapProblems(m)).toEqual([]);
    expect(m.start).toHaveLength(7);
    m = ok(m, { k: 'start', at: [1, -1], on: false });
    expect(m.start).toHaveLength(6);
    // Island points 0–3; 0 means none.
    m = ok(m, { k: 'islandVP', n: 2 });
    expect(m.specialVP).toEqual({ newIsland: 2 });
    expect(refused(m, { k: 'islandVP', n: 4 })).toBe('Island points go from 0 to 3');
    // The pirate starts on the sea, or off the board.
    expect(refused(m, { k: 'pirate', at: [0, 0] })).toBe('The pirate starts on the sea');
    m = ok(m, { k: 'pirate', at: [2, -2] });
    expect(m.pirate).toEqual([2, -2]);
    // The fog stack: set by hand, checked, or back to standard.
    m = ok(m, { k: 'fogStack', terrain: ['gold', 'sea'], numbers: [6] });
    expect(m.fog).toEqual({ terrain: ['gold', 'sea'], numbers: [6] });
    expect(refused(m, { k: 'fogStack', terrain: ['gold'], numbers: [] })).toMatch(/needs 1 numbers/);
    expect(refused(m, { k: 'fogStack', terrain: [], numbers: [] })).toMatch(
      /a tile for each of the 1 fog hex/,
    );
    expect(refused(m, { k: 'fogStack', terrain: ['fog'], numbers: [] })).toBe('Fog hides land, gold or sea');
    m = ok(m, { k: 'fogStack', standard: true });
    expect(m.fog!.terrain.length).toBeGreaterThanOrEqual(1);
    // A game plays it: settlements only in the start area, the pirate where it was put.
    const s = newGame('sea-start', seatsFor(3), { map: m, modules: ['seafarers'], winVP: 10 });
    const setup = new Set(legalActions(s, s.turn).flatMap((a) => (a.type === 'setup' ? [a.v] : [])));
    expect(setup.size).toBeGreaterThan(0);
    const startHex = new Set(
      (m.start as [number, number][]).map(([q, r]) => s.board.hexes.findIndex((h) => h.q === q && h.r === r)),
    );
    for (const v of setup) expect(geo(s).verts[v]!.hexes.some((h) => startHex.has(h))).toBe(true);
    expect(s.board.pirate).toBe(s.board.hexes.findIndex((h) => h.q === 2 && h.r === -2));
  });

  it('filling a Seafarers map keeps its start area, pirate, island points and fog (SPEC 10.1)', () => {
    let m = ok(blank(), { k: 'meta', seafarers: true, players: [3] });
    for (const at of [
      [2, -2],
      [-2, 2],
    ] as At[])
      m = ok(m, { k: 'terrain', at, t: 'sea' });
    m = ok(m, { k: 'terrain', at: [0, 2], t: 'fog' });
    m = ok(m, { k: 'pirate', at: [2, -2] });
    m = ok(m, { k: 'islandVP', n: 2 });
    for (const at of [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
    ] as At[]) {
      const r = applyEdit(m, { k: 'start', at, on: true });
      if (r.ok) m = r.map;
    }
    m = ok(m, { k: 'fogStack', terrain: ['gold', 'wheat'], numbers: [6, 8] });
    const r = fillRest(m, ANYTHING_GOES, 'sea-fill', 3);
    if (!r.ok) throw new Error(r.error);
    expect(r.map.hexes.every((h) => h.t !== 'random')).toBe(true);
    expect(r.map.start).toEqual(m.start);
    expect(r.map.pirate).toEqual([2, -2]);
    expect(r.map.specialVP).toEqual({ newIsland: 2 });
    expect(r.map.fog).toEqual({ terrain: ['gold', 'wheat'], numbers: [6, 8] });
    const s = newGame('sea-play', seatsFor(3), { map: r.map, modules: ['seafarers'], winVP: 10 });
    expect(s.sea!.fog.terrain.slice().sort()).toEqual(['gold', 'wheat']);
  });

  it('a start area too small for everyone is the one hard check (SPEC 10.1)', () => {
    let m = ok(blank(), { k: 'meta', seafarers: true, players: [4] });
    const r = applyEdit(m, { k: 'start', at: [0, 0], on: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(mapProblems(r.map)).toContain(
      'the start area has room for 3 starting settlements; 4 players need 8',
    );
    m = r.map;
    // Unbalanced on purpose is fine: a big enough start area anywhere passes.
    for (const at of [
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
      [2, -1],
      [-2, 1],
    ] as At[]) {
      const x = applyEdit(m, { k: 'start', at, on: true });
      if (x.ok) m = x.map;
    }
    expect(mapProblems(m)).toEqual([]);
  });

  it('regions (SPEC 10.4): their own tile set, drawn only into their own hexes', () => {
    let m = ok(blank(), { k: 'meta', seafarers: true });
    m = ok(m, { k: 'addRegion' });
    expect(Object.entries(m.regions!)).toEqual([
      ['r1', { name: 'Region A', set: { terrain: {}, numbers: {}, harbors: {} } }],
    ]);
    const isles: At[] = [
      [2, -2],
      [2, -1],
      [2, 0],
    ];
    for (const at of isles) m = ok(m, { k: 'region', at, region: 'r1' });
    // The region's set follows its 3 hexes; the main set the other 16.
    const tiles = (t: Record<string, number | undefined>) =>
      Object.values(t).reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(tiles(m.regions!.r1!.set.terrain)).toBe(3);
    expect(tiles(m.set!.terrain)).toBe(16);
    // Gold in, swapped for another of the region's tiles: still 3.
    m = ok(m, { k: 'setTile', region: 'r1', t: 'gold', delta: 1 });
    m = ok(m, { k: 'setTile', region: 'r1', t: 'gold', delta: 1 });
    expect(m.regions!.r1!.set.terrain.gold).toBe(2);
    expect(tiles(m.regions!.r1!.set.terrain)).toBe(3);
    expect(m.pools!.r1!.terrain.filter((t) => t === 'gold')).toHaveLength(2);
    expect(m.pools!.auto!.terrain).not.toContain('gold');
    // Taking one out puts back what the region is shortest of.
    m = ok(m, { k: 'setTile', region: 'r1', t: 'gold', delta: -1 });
    expect(m.regions!.r1!.set.terrain.gold).toBe(1);
    expect(tiles(m.regions!.r1!.set.terrain)).toBe(3);
    const none = (['wood', 'brick', 'sheep', 'wheat', 'ore', 'desert'] as const).find(
      (t) => !m.regions!.r1!.set.terrain[t],
    )!;
    expect(refused(m, { k: 'setTile', region: 'r1', t: none, delta: -1 })).toBe('There are none to take out');
    // Every fill draws the region's tiles into the region only.
    for (let i = 0; i < 20; i++) {
      const r = fillRest(m, ANYTHING_GOES, `regions-${i}`, 4);
      if (!r.ok) throw new Error(r.error);
      const inIsles = (h: { q: number; r: number }) => isles.some(([q, rr]) => q === h.q && rr === h.r);
      expect(r.map.hexes.filter((h) => h.t === 'gold').every(inIsles)).toBe(true);
      expect(r.map.hexes.filter((h) => inIsles(h) && h.t === 'gold')).toHaveLength(1);
    }
    // Renamed, then removed: its hexes go back to the main set.
    m = ok(m, { k: 'renameRegion', region: 'r1', name: 'Far isles' });
    expect(m.regions!.r1!.name).toBe('Far isles');
    m = ok(m, { k: 'removeRegion', region: 'r1' });
    expect(m.regions).toBeUndefined();
    expect(m.hexes.some((h) => h.region)).toBe(false);
    expect(tiles(m.set!.terrain)).toBe(19);
  });

  it('regions work without Seafarers too (D5), and a scenario’s pools open as regions', () => {
    let m = ok(blank(), { k: 'addRegion', name: 'Middle' });
    m = ok(m, { k: 'region', at: [0, 0], region: 'r1' });
    m = ok(m, { k: 'setTile', region: 'r1', t: 'desert', delta: 1 });
    // The main set keeps its own desert until it's taken out.
    expect(m.set!.terrain.desert).toBe(1);
    m = ok(m, { k: 'setTile', region: null, t: 'desert', delta: -1 });
    expect(m.set!.terrain.desert).toBeUndefined();
    const r = fillRest(m, ANYTHING_GOES, 'desert-middle', 4);
    if (!r.ok) throw new Error(r.error);
    expect(r.map.hexes.find((h) => h.q === 0 && h.r === 0)!.t).toBe('desert');
    expect(r.map.hexes.filter((h) => h.t === 'desert')).toHaveLength(1);
    // Heading for New Shores: the main island and the isles become regions.
    const hfns = normalize(SCENARIOS['heading-for-new-shores']!);
    expect(Object.keys(hfns.regions!).sort()).toEqual(['isles', 'main']);
    expect(mapProblems(hfns)).toEqual([]);
    const f = fillRest(hfns, ANYTHING_GOES, 'hfns-regions', 4);
    if (!f.ok) throw new Error(f.error);
    const isle = new Set(
      SCENARIOS['heading-for-new-shores']!.hexes.flatMap((h) =>
        h.pool === 'isles' ? [`${h.q},${h.r}`] : [],
      ),
    );
    const golds = f.map.hexes.filter((h) => h.t === 'gold');
    expect(golds.length).toBeGreaterThan(0);
    expect(golds.every((h) => isle.has(`${h.q},${h.r}`))).toBe(true);
  });

  it('undo and redo step back and forward through every kind of action', () => {
    const start = blank();
    const hist = new EditHistory(start);
    const [a, b] = start.harbors;
    const ops: EditOp[] = [
      { k: 'terrain', at: [0, 0], t: 'wheat' },
      { k: 'number', at: [0, 0], n: 9 },
      { k: 'terrain', at: [1, 0], t: 'sheep' },
      { k: 'swapTile', a: [0, 0], b: [1, -1] },
      { k: 'number', at: [1, 0], n: 3 },
      { k: 'swapNumber', a: [1, 0], b: [1, -1] },
      { k: 'harbor', at: [a!.q, a!.r], side: a!.side, t: 'ore' },
      { k: 'moveHarbor', from: { at: [a!.q, a!.r], side: a!.side }, to: { at: [b!.q, b!.r], side: b!.side } },
      { k: 'lock', at: [1, -1], what: 't', on: true },
      { k: 'lockHarbor', at: [b!.q, b!.r], side: b!.side, on: true },
      { k: 'addHex', at: [3, -1], t: 'random' },
      { k: 'removeHex', at: [-2, 2] },
      { k: 'meta', name: 'Renamed' },
      { k: 'clear' },
      { k: 'meta', seafarers: true },
      { k: 'terrain', at: [2, -2], t: 'sea' },
      { k: 'terrain', at: [0, 2], t: 'fog' },
      { k: 'start', at: [0, 0], on: true },
      { k: 'start', at: [0, 0], on: false },
      { k: 'islandVP', n: 1 },
      { k: 'pirate', at: [2, -2] },
      { k: 'fogStack', terrain: ['wood'], numbers: [8] },
      { k: 'fogStack', standard: true },
      { k: 'addRegion' },
      { k: 'region', at: [1, 0], region: 'r1' },
      { k: 'region', at: [0, 1], region: 'r1' },
      { k: 'setTile', region: 'r1', t: 'gold', delta: 1 },
      { k: 'setTile', region: null, t: 'ore', delta: 1 },
      { k: 'renameRegion', region: 'r1', name: 'Gold coast' },
      { k: 'region', at: [0, 1], region: null },
      { k: 'removeRegion', region: 'r1' },
    ];
    const states = [hist.map];
    for (const op of ops) {
      const r = hist.apply(op);
      if (!r.ok) throw new Error(`${op.k}: ${r.error}`);
      states.push(hist.map);
    }
    expect(hist.apply({ k: 'terrain', at: [9, 9], t: 'wood' }).ok).toBe(false);
    for (let i = states.length - 1; i > 0; i--) {
      expect(hist.map).toEqual(states[i]);
      expect(hist.undo()).toBe(true);
    }
    expect(hist.map).toEqual(start);
    expect(hist.undo()).toBe(false);
    for (let i = 1; i < states.length; i++) {
      expect(hist.redo()).toBe(true);
      expect(hist.map).toEqual(states[i]);
    }
    expect(hist.redo()).toBe(false);
    // A new edit after undoing clears the redo steps.
    hist.undo();
    hist.apply({ k: 'meta', name: 'Other' });
    expect(hist.canRedo).toBe(false);
  });

  it('an empty map grows from nothing', () => {
    let m = emptyMap('m-e', 'Empty');
    expect(mapProblems(m)).toContain('the map has no hexes');
    m = ok(m, { k: 'addHex', at: [0, 0], t: 'wood' });
    m = ok(m, { k: 'addHex', at: [1, 0], t: 'random' });
    expect(m.hexes).toHaveLength(2);
    expect(pool(m).terrain).toHaveLength(1);
  });

  it('save, load and save again gives the same file; export and import too', () => {
    let m = blank();
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'ore' });
    m = ok(m, { k: 'number', at: [0, 0], n: 5 });
    m = ok(m, { k: 'lock', at: [0, 0], what: 'n', on: true });
    const saved = JSON.stringify(m);
    const loaded = normalize(JSON.parse(saved) as MapData);
    expect(JSON.stringify(loaded)).toBe(saved);
    const filled = fillRest(m, OUR_RULES, 'x', 4);
    if (!filled.ok) throw new Error(filled.error);
    const again = JSON.stringify(normalize(JSON.parse(JSON.stringify(filled.map)) as MapData));
    expect(again).toBe(JSON.stringify(filled.map));
  });

  it('refuses bad files on import with a short reason', () => {
    const m = blank();
    expect(mapProblems({ ...m, format: 2 as 1 })).toContain('unknown format');
    expect(mapProblems({ ...m, hexes: [...m.hexes, m.hexes[0]!] })[0]).toMatch(/duplicate hex/);
    expect(
      mapProblems({ ...m, hexes: m.hexes.map((h, i) => (i ? h : { ...h, t: 'lava' as 'wood' })) })[0],
    ).toMatch(/unknown terrain/);
    const [a] = m.harbors;
    expect(mapProblems({ ...m, harbors: [...m.harbors, { ...a!, side: (a!.side + 1) % 6 }] })).toContain(
      'two harbors share a corner',
    );
  });
});

describe('fill the rest', () => {
  it('fills every blank and keeps everything placed, locked or not', () => {
    let m = blank();
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'desert' });
    m = ok(m, { k: 'terrain', at: [1, 0], t: 'ore' });
    m = ok(m, { k: 'number', at: [1, 0], n: 6 });
    m = ok(m, { k: 'lock', at: [1, 0], what: 't', on: true });
    const h = m.harbors[4]!;
    m = ok(m, { k: 'harbor', at: [h.q, h.r], side: h.side, t: 'ore' });
    const r = fillRest(m, OUR_RULES, 'fill-1', 4);
    if (!r.ok) throw new Error(r.error);
    const out = r.map;
    expect(out.hexes.every((x) => x.t !== 'random' && x.n !== 'random')).toBe(true);
    expect(hex(out, [0, 0]).t).toBe('desert');
    expect(hex(out, [1, 0])).toMatchObject({ t: 'ore', n: 6, lock: { t: true } });
    expect(out.harbors[4]!.t).toBe('ore');
    expect(out.harbors.every((x) => x.t !== 'random')).toBe(true);
    expect(counts(out).placed.terrain).toEqual({ wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3, desert: 1 });
    expect(validateMap(out)).toEqual([]);
    expect(checkBoard(out, OUR_RULES, 4)).toEqual([]);
  });

  it('leaves rules that only placed pieces break to the warnings', () => {
    let m = blank();
    m = ok(m, { k: 'terrain', at: [0, 0], t: 'wheat' });
    m = ok(m, { k: 'number', at: [0, 0], n: 6 });
    m = ok(m, { k: 'terrain', at: [1, 0], t: 'ore' });
    m = ok(m, { k: 'number', at: [1, 0], n: 8 });
    const r = fillRest(m, OUR_RULES, 'fill-2', 4);
    if (!r.ok) throw new Error(r.error);
    const v = checkBoard(r.map, OUR_RULES, 4).filter((x) => x.rule === 'red');
    expect(v).toHaveLength(1);
    expect(v[0]!.text).toBe('6 and 8 touch');
  });

  it('Clear unlocked then Fill regenerates everything but the locks', () => {
    let m = fillRest(blank(), OUR_RULES, 'a', 4);
    if (!m.ok) throw new Error(m.error);
    let map = ok(m.map, { k: 'lock', at: [0, 0], what: 't', on: true });
    map = ok(map, { k: 'clear' });
    const again = fillRest(map, OUR_RULES, 'b', 4);
    if (!again.ok) throw new Error(again.error);
    expect(hex(again.map, [0, 0]).t).toBe(hex(m.map, [0, 0]).t);
    expect(again.map.hexes.some((h, i) => h.t !== m.map.hexes[i]!.t)).toBe(true);
  });
});

/** A complete standard board with given terrain and numbers, row by row (as in the classic map). */
function board(terrain: string, numbers: (number | 0)[]): MapData {
  const T: Record<string, string> = { W: 'wood', B: 'brick', S: 'sheep', H: 'wheat', O: 'ore', D: 'desert' };
  const m = structuredClone(CLASSIC_MAP);
  m.hexes = m.hexes.map((h, i) => {
    const t = T[terrain[i]!] as 'wood';
    return numbers[i] ? { q: h.q, r: h.r, t, n: numbers[i]! } : { q: h.q, r: h.r, t };
  });
  delete m.pools;
  m.harbors = m.harbors.map((h, i) => ({
    ...h,
    t: (['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'] as const)[i]!,
  }));
  delete m.harborPool;
  return m;
}
const ALL_ON: GenRules = { ...OUR_RULES, harborNoRed: true };
const rulesBroken = (m: MapData, r: GenRules = ALL_ON, players = 4): RuleId[] => [
  ...new Set(checkBoard(m, r, players).map((v) => v.rule)),
];

describe('the checker', () => {
  it('passes generated boards and catches each planted break', () => {
    const r = generate(normalize(CLASSIC_MAP), OUR_RULES, { seed: 'plant', players: 4 });
    if (!r.ok) throw new Error(r.error);
    const good = r.map;
    expect(checkBoard(good, OUR_RULES, 4)).toEqual([]);
    const b = modelOf(good);
    const pair = (pred: (i: number, j: number) => boolean) => {
      for (let i = 0; i < b.g.hexes.length; i++)
        for (const j of b.g.hexNeighbors[i]!) if (pred(i, j)) return [i, j] as const;
      throw new Error('no pair');
    };
    const withNumbers = (ns: Record<number, number>) => {
      const m = structuredClone(good);
      for (const [i, n] of Object.entries(ns)) m.hexes[Number(i)]!.n = n;
      return m;
    };
    const prod = (i: number) => typeof good.hexes[i]!.n === 'number';
    // 5.2: put a 6 next to an 8.
    const [i, j] = pair((x, y) => prod(x) && prod(y));
    expect(rulesBroken(withNumbers({ [i]: 6, [j]: 8 }), OUR_RULES)).toContain('red');
    // 5.9 and 5.7.
    expect(rulesBroken(withNumbers({ [i]: 9, [j]: 9 }), OUR_RULES)).toContain('same');
    expect(rulesBroken(withNumbers({ [i]: 2, [j]: 12 }), OUR_RULES)).toContain('twoTwelve');
    // 5.8: a 3 next to an 11.
    expect(rulesBroken(withNumbers({ [i]: 3, [j]: 11 }), OUR_RULES)).toContain('lowCluster');
    // 5.5: a corner with 6 + 5 + 9 = 13 pips.
    const v = b.g.verts.findIndex((V) => V.hexes.length === 3 && V.hexes.every(prod));
    const [x, y, z] = b.g.verts[v]!.hexes;
    expect(rulesBroken(withNumbers({ [x!]: 6, [y!]: 5, [z!]: 9 }), OUR_RULES)).toContain('best');
    // 5.6: an inland corner with 2 + 3 + 4 has 6 pips, under a limit of 8.
    expect(rulesBroken(withNumbers({ [x!]: 2, [y!]: 3, [z!]: 4 }), { ...OUR_RULES, badSpot: 8 })).toContain(
      'bad',
    );
    // 5.10: four touching wood.
    const clumped = structuredClone(good);
    const center = 9;
    for (const k of [center, ...b.g.hexNeighbors[center]!.slice(0, 3)]) clumped.hexes[k]!.t = 'wood';
    expect(rulesBroken(clumped, OUR_RULES)).toContain('clump');
  });

  it('checks harbors against the numbers they touch (5.3, 5.4)', () => {
    const r = generate(normalize(CLASSIC_MAP), OUR_RULES, { seed: 'harbor', players: 4 });
    if (!r.ok) throw new Error(r.error);
    const m = structuredClone(r.map);
    const b = modelOf(m);
    const h = b.harbors.findIndex((x) => x.t !== 'any');
    const spot = b.harbors[h]!;
    const hexIdx = spot.hexes.find((x) => b.n[x]! > 0)!;
    m.hexes[hexIdx]!.t = spot.t as 'wood';
    m.hexes[hexIdx]!.n = 8;
    const broken = rulesBroken(m, ALL_ON);
    expect(broken).toContain('harborGood');
    expect(broken).toContain('harborRed');
    expect(rulesBroken(m, { ...ALL_ON, harborGood: 'off', harborNoRed: false })).not.toContain('harborGood');
  });

  it('checks balance and starting fairness on complete boards only', () => {
    // Every good number on wood: wood is far over its fair share.
    const m = board('WWWWHSSSHHHBBBOOOSD', [6, 8, 6, 8, 2, 3, 3, 4, 4, 5, 5, 9, 9, 10, 10, 11, 11, 12, 0]);
    expect(rulesBroken(m, OUR_RULES)).toContain('balance');
    expect(checkBoard(m, OUR_RULES, 4).find((v) => v.rule === 'balance')!.text).toMatch(
      /^Wood has 20 pips; fair is/,
    );
    const partial = structuredClone(m);
    partial.hexes[0]!.n = 'random';
    partial.pools = { p: { terrain: [], numbers: [6] } };
    partial.hexes[0]!.pool = 'p';
    expect(rulesBroken(partial, OUR_RULES)).not.toContain('balance');
    expect(rulesBroken(partial, OUR_RULES)).not.toContain('fair');
  });

  it('the greedy draft picks in snake order, best corner first, keeping the distance rule', () => {
    const r = generate(normalize(CLASSIC_MAP), ANYTHING_GOES, { seed: 'draft', players: 3 });
    if (!r.ok) throw new Error(r.error);
    const b = modelOf(r.map);
    const d = greedyDraft(b, OUR_RULES.pips, 3);
    expect(d.picks.map((p) => p.length)).toEqual([2, 2, 2]);
    const all = d.picks.flat();
    for (const v of all) for (const a of b.g.verts[v]!.adj) expect(all).not.toContain(a);
    const pip = (v: number) => b.g.verts[v]!.hexes.reduce((s, h) => s + (OUR_RULES.pips[b.n[h]!] ?? 0), 0);
    // Picks in snake order are each the best free corner, so their pips never rise.
    const inOrder = [
      d.picks[0]![0]!,
      d.picks[1]![0]!,
      d.picks[2]![0]!,
      d.picks[2]![1]!,
      d.picks[1]![1]!,
      d.picks[0]![1]!,
    ];
    for (let k = 1; k < inOrder.length; k++)
      expect(pip(inOrder[k]!)).toBeLessThanOrEqual(pip(inOrder[k - 1]!));
    expect(d.gap).toBe(Math.max(...d.scores) - Math.min(...d.scores));
    const s = fairnessSummary(r.map);
    expect(s.best).toHaveLength(3);
    expect(s.draft[3].gap).toBe(d.gap);
    expect(s.resources.reduce((a, x) => a + x.pips, 0)).toBe(58);
  });
});

describe('the generator', () => {
  it('gives the same board for the same seed, and different boards for different seeds', () => {
    for (const p of TEST_PRESETS) {
      const a = generate(normalize(CLASSIC_MAP), p.rules, { seed: 'same', players: 3 });
      const b = generate(normalize(CLASSIC_MAP), p.rules, { seed: 'same', players: 3 });
      const c = generate(normalize(CLASSIC_MAP), p.rules, { seed: 'other', players: 3 });
      if (!a.ok || !b.ok || !c.ok) throw new Error(`${p.name} failed`);
      expect(JSON.stringify(a.map), p.name).toBe(JSON.stringify(b.map));
      expect(JSON.stringify(a.map), p.name).not.toBe(JSON.stringify(c.map));
    }
  });

  it('meets every preset on 100 boards each (the full 10,000 run is npm run maps)', () => {
    for (const p of TEST_PRESETS) {
      for (let i = 0; i < 100; i++) {
        const players = 2 + (i % 3);
        const r = generate(normalize(CLASSIC_MAP), p.rules, { seed: `unit.${i}`, players });
        if (!r.ok) throw new Error(`${p.name} ${i}: ${r.error}`);
        const v = checkBoard(r.map, p.rules, players).filter(
          (x) => !r.eased || !['best', 'bad', 'lowCluster'].includes(x.rule),
        );
        expect(v, `${p.name} ${i}`).toEqual([]);
      }
    }
  });

  it('works on the Seafarers shape, keeping each pool to its own hexes', () => {
    const hfns = SCENARIOS['heading-for-new-shores']!;
    const r = generate(hfns, OUR_RULES, { seed: 'sea', players: 4 });
    if (!r.ok) throw new Error(r.error);
    hfns.hexes.forEach((h, i) => {
      const out = r.map.hexes[i]!;
      if (h.pool === 'isles') expect(['gold', 'wood', 'brick', 'sheep', 'wheat', 'ore']).toContain(out.t);
      if (h.pool === 'main') expect(out.t).not.toBe('gold');
      if (h.t === 'sea') expect(out.t).toBe('sea');
    });
    expect(validateMap(r.map)).toEqual([]);
  });

  it('a game starts on exactly the generated board', () => {
    const r = generate(normalize(CLASSIC_MAP), OUR_RULES, { seed: 'game', players: 3 });
    if (!r.ok) throw new Error(r.error);
    const s = newGame('g1', seatsFor(3), { map: r.map });
    s.board.hexes.forEach((h, i) => {
      expect(h.t).toBe(r.map.hexes[i]!.t);
      expect(h.n).toBe(r.map.hexes[i]!.n ?? 0);
    });
    expect(s.board.ports.map((p) => p.t)).toEqual(r.map.harbors.map((h) => h.t));
    // And it plays: the first setup move is legal.
    const first = legalActions(s, s.turn)[0]!;
    expect(applyAction(s, s.turn, first).ok).toBe(true);
  });

  it('with no desert, the robber starts off the board', () => {
    const r = generate(normalize(CLASSIC_MAP), { ...OUR_RULES, desert: 'none' }, { seed: 'nd', players: 3 });
    if (!r.ok) throw new Error(r.error);
    expect(r.map.hexes.some((h) => h.t === 'desert')).toBe(false);
    expect(r.map.robber).toBe(null);
    const s = newGame('g2', seatsFor(3), { map: r.map });
    expect(s.board.robber).toBe(-1);
  });
});

describe('settings that can’t work fail fast, naming the rule', () => {
  const shape = normalize(CLASSIC_MAP);
  const cases: [string, GenRules, MapData, RegExp][] = [
    ['clump 0', { ...OUR_RULES, clump: 0 }, shape, /^A clump limit of 0 can’t work/],
    [
      'best spot 4',
      { ...OUR_RULES, bestSpot: 4 },
      shape,
      /^A best-spot limit of 4 can’t work: a single token is worth 5 pips/,
    ],
    ['bad spot 16', { ...OUR_RULES, badSpot: 16 }, shape, /^A bad-spot limit of 16 can’t work/],
    [
      'spiral off the standard board',
      { ...OUR_RULES, numbers: 'spiral' },
      SCENARIOS['heading-for-new-shores']!,
      /only works on the standard board/,
    ],
    ['spiral without a desert', { ...OUR_RULES, numbers: 'spiral', desert: 'none' }, shape, /needs a desert/],
    [
      'spiral with no weak clusters',
      { ...OUR_RULES, numbers: 'spiral' },
      shape,
      /no clusters of 2, 3, 11, 12 together with the official spiral/,
    ],
    [
      'no 6 or 8 at the standard harbors',
      { ...OUR_RULES, harborNoRed: true },
      shape,
      /red numbers never touching together with no 6 or 8 at any harbor/,
    ],
    [
      'best spot 8',
      { ...OUR_RULES, bestSpot: 8 },
      shape,
      /the best-spot limit of 8 is too low\. The lowest that works with your other rules is about 1\d\./,
    ],
    [
      'balance 0%',
      { ...OUR_RULES, balance: 0 },
      shape,
      /resource balance ±0% is too tight\. The tightest that works .* about ±\d+%\./,
    ],
  ];
  for (const [name, rules, m, msg] of cases) {
    it(name, () => {
      // CPU time spent on it, so other tests running at the same time can't make this flaky.
      const c0 = process.cpuUsage();
      const r = generate(m, rules, { seed: 'impossible', players: 4 });
      const used = process.cpuUsage(c0);
      const ms = (used.user + used.system) / 1000;
      if (r.ok) throw new Error('expected no board');
      expect(r.error).toMatch(msg);
      expect(ms).toBeLessThan(2000);
    });
  }
});
