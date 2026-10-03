/*
 * Fog map settings (docs/rules/seafarers.md §11.5, D17; treasures.md D9): tips uncover, and
 * uncovering pays (land its card, sea or desert a treasure) or pays nothing. Maps from before
 * keep the old rules.
 */
import { describe, expect, it } from 'vitest';
import fogMap from './fixtures/fog-test.json';
import {
  SCENARIOS, checkInvariants, checkTransition, edgeSides, geo, isLand, newGame, viewFor, type GameState, type MapData,
  type Terrain,
} from '../src/index'; // prettier-ignore
import { act, setHand } from './helpers';
import { seatsFor } from './simulate';

const FOG = fogMap as unknown as MapData;

function game(map: MapData): GameState {
  const s = structuredClone(newGame('fog-rules', seatsFor(3), { map }));
  s.stage = 'main';
  s.turnN = 5;
  s.setupI = 6;
  s.dice = [3, 4];
  return s;
}
const withRules = (o: { fogRewards?: boolean; fogTips?: boolean }): MapData => ({ ...FOG, ...o });

/**
 * A road from a settlement on the main island whose far end touches fog, though neither side of
 * the road is fog: the tip case. Returns the state ready to build it, the edge and the fog hexes
 * at its far end.
 */
function tipRoad(map: MapData) {
  let s = game(map);
  const g = geo(s);
  const fogAt = (v: number) => g.verts[v]!.hexes.filter((h) => s.board.hexes[h]!.t === 'fog');
  for (let e = 0; e < g.edges.length; e++) {
    const E = g.edges[e]!;
    const sides = edgeSides(s, e);
    if (sides.includes('fog') || !sides.some(isLand) || E.hexes.length < 2) continue;
    for (const [from, to] of [
      [E.a, E.b],
      [E.b, E.a],
    ] as const) {
      if (fogAt(from).length || !fogAt(to).length) continue;
      if (!g.verts[from]!.hexes.every((h) => isLand(s.board.hexes[h]!.t))) continue;
      s.verts[from] = [0, 1];
      s.players[0]!.pieces.settlement--;
      s = setHand(s, 0, { wood: 1, brick: 1 });
      return { s, e, ends: fogAt(to) };
    }
  }
  throw new Error('no tip road on the test map');
}

/** The next fog tiles drawn, in order. */
function rig(s: GameState, terrain: Terrain[]) {
  s.sea!.fog.terrain = [...terrain, ...s.sea!.fog.terrain.slice(terrain.length)];
}

describe('fog map settings (seafarers.md §11.5)', () => {
  it('maps from before: a road whose tip touches fog uncovers nothing', () => {
    const { s, e } = tipRoad(FOG);
    const r = act(s, 0, { type: 'road', e });
    expect(r.events.filter((x) => x.k === 'discover')).toEqual([]);
  });

  it('with tips on, a road whose tip touches fog uncovers it, and it pays', () => {
    const { s, e, ends } = tipRoad(withRules({ fogTips: true, fogRewards: true }));
    rig(
      s,
      ends.map(() => 'wood'),
    );
    const r = act(s, 0, { type: 'road', e });
    const found = r.events.filter((x) => x.k === 'discover');
    expect(found.map((x) => x.k === 'discover' && x.h)).toEqual(ends.slice().sort((a, b) => a - b));
    expect(found.every((x) => x.k === 'discover' && x.t === 'wood')).toBe(true);
    // A wood for each: the road's own wood was spent.
    expect(r.state.players[0]!.res.wood).toBe(ends.length);
    expect(checkInvariants(r.state)).toEqual([]);
    expect(checkTransition(s, r.state)).toEqual([]);
  });

  it('a ship whose tip touches fog uncovers it too (the Fog Islands)', () => {
    let s = game(SCENARIOS['fog-islands']!);
    const g = geo(s);
    const fogAt = (v: number) => g.verts[v]!.hexes.filter((h) => s.board.hexes[h]!.t === 'fog');
    // Water a ship can take, not along fog.
    const water = (e: number) => {
      const t = edgeSides(s, e);
      return !t.includes('fog') && t.includes('sea');
    };
    // A settlement on the coast, a ship from it, and a sea edge on from there whose far end
    // touches fog (though nothing along the way does).
    for (let c = 0; c < g.verts.length; c++) {
      if (fogAt(c).length || !g.verts[c]!.hexes.some((h) => isLand(s.board.hexes[h]!.t))) continue;
      for (const e1 of g.verts[c]!.edges.filter(water)) {
        const E1 = g.edges[e1]!;
        const m = E1.a === c ? E1.b : E1.a;
        if (fogAt(m).length) continue;
        for (const e of g.verts[m]!.edges.filter((x) => x !== e1 && water(x))) {
          const E = g.edges[e]!;
          const to = E.a === m ? E.b : E.a;
          if (!fogAt(to).length) continue;
          s.verts[c] = [0, 1];
          s.players[0]!.pieces.settlement--;
          s.sea!.ships[e1] = 0;
          s.players[0]!.pieces.ship!--;
          s = setHand(s, 0, { wood: 1, sheep: 1 });
          rig(
            s,
            fogAt(to).map(() => 'sea'),
          );
          const r = act(s, 0, { type: 'ship', e });
          const found = r.events.filter((x) => x.k === 'discover').map((x) => x.k === 'discover' && x.h);
          expect(found).toEqual(fogAt(to).sort((a, b) => a - b));
          expect(checkTransition(s, r.state)).toEqual([]);
          return;
        }
      }
    }
    throw new Error('no tip ship on the test map');
  });

  it('sea or desert uncovered gives a treasure from the fog treasure deck; land its card', () => {
    const map = withRules({ fogTips: true, fogRewards: true });
    const { s, e, ends } = tipRoad(map);
    expect(s.config.modules).toContain('treasures');
    const fogHexes = s.board.hexes.filter((h) => h.t === 'fog').length;
    expect(s.tr!.fogDeck).toHaveLength(fogHexes);
    rig(
      s,
      ends.map((_, i) => (i ? 'desert' : 'sea')),
    );
    // Make every treasure the three resources, to see it paid straight away.
    s.tr!.fogDeck = s.tr!.fogDeck!.map(() => 'trio');
    const r = act(s, 0, { type: 'road', e });
    const tr = r.events.filter((x) => x.k === 'treasure');
    expect(tr).toHaveLength(ends.length);
    expect(tr.map((x) => x.k === 'treasure' && x.h)).toEqual(ends.slice().sort((a, b) => a - b));
    expect(r.state.tr!.fogFound!.map((f) => f.h)).toEqual(ends.slice().sort((a, b) => a - b));
    expect(r.state.tr!.fogDeck).toHaveLength(fogHexes - ends.length);
    expect(r.state.players[0]!.res).toMatchObject({
      sheep: ends.length,
      brick: ends.length,
      wheat: ends.length,
    });
    expect(checkInvariants(r.state)).toEqual([]);
    expect(checkTransition(s, r.state)).toEqual([]);
  });

  it('one road uncovering sea along it and at a lower-numbered tip: both paid, and the checks agree', () => {
    // Hexes pay along the road first, then at its ends (§11.5), which isn't board order: the check
    // that every uncovered sea paid mustn't care about the order.
    const base = game(withRules({ fogTips: true, fogRewards: true }));
    const g = geo(base);
    const fog = (st: GameState, h: number) => st.board.hexes[h]!.t === 'fog';
    let tried = 0;
    for (let e = 0; e < g.edges.length; e++) {
      const E = g.edges[e]!;
      const along = E.hexes.filter((h) => fog(base, h));
      if (along.length !== 1 || !E.hexes.some((h) => isLand(base.board.hexes[h]!.t))) continue;
      for (const [from, to] of [
        [E.a, E.b],
        [E.b, E.a],
      ] as const) {
        const tip = g.verts[to]!.hexes.filter((h) => !E.hexes.includes(h) && fog(base, h));
        if (!tip.some((h) => h < along[0]!)) continue;
        let s = structuredClone(base);
        s.verts[from] = [0, 1];
        s.players[0]!.pieces.settlement--;
        s = setHand(s, 0, { wood: 1, brick: 1 });
        const ends = [...new Set([...g.verts[E.a]!.hexes, ...g.verts[E.b]!.hexes])].filter(
          (h) => !E.hexes.includes(h) && fog(s, h),
        );
        rig(
          s,
          [...along, ...ends].map(() => 'sea'),
        );
        const r = act(s, 0, { type: 'road', e });
        tried++;
        expect(r.state.tr!.fogFound!.map((f) => f.h)).toEqual([...along, ...ends.sort((a, b) => a - b)]);
        expect(checkInvariants(r.state)).toEqual([]);
        expect(checkTransition(s, r.state)).toEqual([]);
        return;
      }
    }
    expect(tried, 'no such road on the test map').toBeGreaterThan(0);
  });

  it('desert uncovered gives a treasure too', () => {
    const { s, e, ends } = tipRoad(withRules({ fogTips: true, fogRewards: true }));
    rig(
      s,
      ends.map(() => 'desert'),
    );
    const r = act(s, 0, { type: 'road', e });
    expect(r.events.filter((x) => x.k === 'treasure')).toHaveLength(ends.length);
    expect(checkTransition(s, r.state)).toEqual([]);
  });

  it('switched off, uncovering pays nothing: no card, no gold, no treasure', () => {
    const { s, e, ends } = tipRoad(withRules({ fogTips: true, fogRewards: false }));
    expect(s.config.modules ?? []).not.toContain('treasures');
    rig(
      s,
      ends.map((_, i) => (['wood', 'gold', 'sea'] as const)[i % 3]!),
    );
    const r = act(s, 0, { type: 'road', e });
    for (const d of r.events) if (d.k === 'discover') expect(d.got).toBeNull();
    expect(r.events.some((x) => x.k === 'treasure' || x.k === 'goldOwed')).toBe(false);
    expect(r.state.stage).toBe('main');
    expect(r.state.players[0]!.res.wood).toBe(0);
  });

  it('the fog treasure deck is secret; only how many are left shows', () => {
    const s = game(withRules({ fogTips: true, fogRewards: true }));
    const v = viewFor(s, 0);
    expect(v.tr!.fogLeft).toBe(s.tr!.fogDeck!.length);
    expect(v.tr!.fogFound).toEqual([]);
    expect(JSON.stringify(v)).not.toContain('fogDeck');
  });
});
