/*
 * Starting areas and island bonuses come from each scenario's data file (docs/rules/seafarers.md
 * §4, §15). Reproduces the bug seen in a live game: a CPU started on a small island in Heading for
 * New Shores, and settling a new island later earned no bonus.
 */

import { describe, expect, it } from 'vitest';
import {
  SCENARIOS, applyAction, checkInvariants, cpuMove, geo, isLand, legalActions, newCpuMemo, newGame, publicVP,
  seedRng, startHexes, viewFor, vpBreakdown, scenarioMap, hexAt, HFNS_3_OLD, type GameState, type MapData,
} from '../src/index'; // prettier-ignore
import { islandOf } from '../src/modules/seafarers';
import { act, reject } from './helpers';
import { seatsFor } from './simulate';

/** Every published scenario with Seafarers rules. */
const SEA = [...Object.values(SCENARIOS), HFNS_3_OLD].filter((m) => m.modules.includes('seafarers'));

/** Corners of island hexes outside the scenario's starting area. */
function outsideStart(s: GameState): number[] {
  const start = startHexes(s.config.map, s.board);
  const g = geo(s);
  return g.verts.flatMap((V, v) =>
    V.hexes.some((h) => isLand(s.board.hexes[h]!.t)) && !V.hexes.some((h) => start.has(h)) ? [v] : [],
  );
}

describe.each(SEA.map((m) => [m.name, m] as const))('%s: starting area', (_name, map) => {
  it('the data file names the starting area (not the whole board)', () => {
    expect(map.start).not.toBe('all');
    expect(Array.isArray(map.start) && map.start.length).toBeTruthy();
  });

  it('a starting settlement outside it is refused, for people and CPUs alike', () => {
    const s = newGame('start-area', seatsFor(3), { map: map as MapData });
    const out = outsideStart(s);
    expect(out.length).toBeGreaterThan(0);
    for (const v of out) {
      const e = geo(s).verts[v]!.edges[0]!;
      const r = applyAction(s, s.turn, { type: 'setup', v, e });
      expect(r.ok, `corner ${v} outside the starting area was accepted`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/start/i);
    }
    // The spots offered (and highlighted) are all inside it.
    const offered = legalActions(s, s.turn).flatMap((a) => (a.type === 'setup' ? [a.v] : []));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((v) => out.includes(v))).toEqual([]);
    // A CPU's setup move, from its own view, is inside it too (many tries).
    for (let i = 0; i < 40; i++) {
      const p = { ...s, players: s.players.map((x, j) => (j === s.turn ? { ...x, cpu: true as const } : x)) };
      const a = cpuMove(viewFor(p, s.turn), seedRng(`cpu${i}`), newCpuMemo());
      expect(a?.type).toBe('setup');
      if (a?.type === 'setup') expect(out).not.toContain(a.v);
    }
  });
});

describe('Heading for New Shores: island bonus', () => {
  const map = SCENARIOS['heading-for-new-shores']! as MapData;

  it('the bug: a starting settlement on a small island was accepted (and made it "home")', () => {
    let s = newGame('bug', seatsFor(3), { map });
    const isle = outsideStart(s)[0]!;
    expect(reject(s, s.turn, { type: 'setup', v: isle, e: geo(s).verts[isle]!.edges[0]! })).toMatch(/start/i);
    // Setup ends with everyone on the main island; nobody has island points yet.
    while (s.stage === 'setup') s = act(s, s.turn, legalActions(s, s.turn)[0]!).state;
    expect(s.sea!.specialVP).toEqual([0, 0, 0]);
  });

  it('2 points for each player’s first settlement on each new island, once, and they show in the score', () => {
    let s = newGame('bonus', seatsFor(3), { map });
    while (s.stage === 'setup') s = act(s, s.turn, legalActions(s, s.turn)[0]!).state;
    s = structuredClone(s);
    s.stage = 'main';
    const g = geo(s);
    const isleHexes = s.board.hexes.flatMap((h, i) =>
      isLand(h.t) && !startHexes(map, s.board).has(i) ? [i] : [],
    );
    const islands: number[][] = [];
    for (const h of isleHexes) if (!islands.some((x) => x.includes(h))) islands.push(islandOf(s, h));
    expect(islands.length).toBeGreaterThanOrEqual(2);
    /** Put a settlement for p on a free corner of `island` by placing it directly, then build one by the rules. */
    const settle = (st: GameState, p: number, island: number[]) => {
      const v = g.verts.findIndex(
        (V, i) => V.hexes.some((h) => island.includes(h)) && !st.verts[i] && V.adj.every((w) => !st.verts[w]),
      );
      const e = g.verts[v]!.edges[0]!;
      const t = structuredClone(st);
      t.turn = p;
      t.sea!.ships[e] = p; // a ship there so the settlement connects
      t.players[p]!.pieces.ship!--;
      for (const r of ['wood', 'brick', 'sheep', 'wheat'] as const) {
        t.players[p]!.res[r]++;
        t.bank[r]--;
      }
      return applyAction(t, p, { type: 'settlement', v });
    };
    const before = publicVP(s, 0);
    const r = settle(s, 0, islands[0]!);
    if (!r.ok) throw new Error(r.error);
    expect(r.events).toContainEqual({ k: 'islandBonus', p: 0, vp: 2 });
    expect(publicVP(r.state, 0)).toBe(before + 1 + 2);
    expect(vpBreakdown(r.state, 0, false)).toContainEqual({ k: 'island', n: 1, vp: 2 });
    expect(checkInvariants(r.state)).toEqual([]);
    // Same island again: nothing more.
    const r2 = settle(r.state, 0, islands[0]!);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.events.some((e) => e.k === 'islandBonus')).toBe(false);
    // Another player on the same island still gets their own bonus; a second island gives another.
    const r3 = settle(r2.state, 1, islands[0]!);
    if (!r3.ok) throw new Error(r3.error);
    expect(r3.events).toContainEqual({ k: 'islandBonus', p: 1, vp: 2 });
    const r4 = settle(r3.state, 0, islands[1]!);
    if (!r4.ok) throw new Error(r4.error);
    expect(r4.state.sea!.specialVP[0]).toBe(4);
    // The main island never gives a bonus.
    expect(checkInvariants(r4.state)).toEqual([]);
  });
});

describe('Heading for New Shores: pirate and the 3-player layout (D14, D15)', () => {
  it('the pirate starts on a set sea hex that touches no land', () => {
    for (const n of [3, 4]) {
      const map = scenarioMap('heading-for-new-shores', n);
      const s = newGame('pirate', seatsFor(n), { map });
      const at = hexAt(s.board.hexes, 1, 3);
      expect(s.board.pirate).toBe(at);
      expect(s.board.hexes[at]!.t).toBe('sea');
      const g = geo(s);
      const touching = new Set(g.hexVerts[at]!.flatMap((v) => g.verts[v]!.hexes));
      for (const h of touching) if (h !== at) expect(s.board.hexes[h]!.t).toBe('sea');
    }
  });

  it('3 players play the full main island, the same as 4 (D15, changed 2 October)', () => {
    expect(scenarioMap('heading-for-new-shores', 3)).toBe(SCENARIOS['heading-for-new-shores']);
    expect(scenarioMap('heading-for-new-shores', 4)).toBe(SCENARIOS['heading-for-new-shores']);
    const map = scenarioMap('heading-for-new-shores', 3);
    expect(map.players).toContain(3);
    const s = newGame('three', seatsFor(3), { map });
    expect(startHexes(map, s.board).size).toBe(19);
    // The old 16-tile layout still loads, for games that saved it.
    const old = newGame('three-old', seatsFor(3), { map: HFNS_3_OLD });
    expect(startHexes(HFNS_3_OLD, old.board).size).toBe(16);
  });
});
