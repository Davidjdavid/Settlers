import { describe, expect, it } from 'vitest';
import { geometryFor, newGame, viewFor, type GameState } from '@settlers/engine';
import { spotAt, spotLabel, spotsOf } from '../src/boardinfo';

const seats = ['Alex', 'Sam', 'Joe'].map((nick, i) => ({
  pid: `p${i}`,
  nick,
  color: (['red', 'blue', 'white'] as const)[i]!,
}));

/** A Knights game with a Science metropolis, a walled city, a knight and the merchant. */
function game(): GameState {
  const s = structuredClone(
    newGame('info', seats, { modules: ['citiesKnights'], winVP: 13, order: 'given' }),
  );
  s.verts[0] = [0, 2];
  s.verts[10] = [1, 2];
  s.verts[20] = [2, 1];
  s.ck!.metro.science = 0;
  s.ck!.lvl[0]!.science = 4;
  s.ck!.walls = [10];
  s.ck!.knights[30] = { p: 1, lvl: 2, on: true };
  s.ck!.knights[31] = { p: 2, lvl: 1, on: false };
  const wheat = s.board.hexes.findIndex((h) => h.t === 'wheat');
  s.ck!.merchant = { h: wheat, p: 2 };
  return s;
}

const labels = (s: GameState, seat = 2) => {
  const v = viewFor(s, seat);
  const g = geometryFor(v.board.hexes);
  return { v, g, spots: spotsOf(v, g, false) };
};

describe('Board labels (SPEC 8.3)', () => {
  it('a metropolis says whose, its worth, and who can take it', () => {
    const s = game();
    const { v, spots } = labels(s);
    const m = spots.find((x) => x.spot.k === 'metro')!;
    expect(spotLabel(v, m.spot)).toBe(
      "Science metropolis · Alex · worth 4 points (city 2 + metropolis 2) · can't be pillaged by barbarians · Alex is at Science level 4, so whoever reaches level 5 first takes it",
    );
    s.ck!.lvl[0]!.science = 5;
    const after = labels(s);
    expect(spotLabel(after.v, m.spot)).toMatch(/· it's Alex's for good$/);
  });

  it('knights, walls, the merchant and the robber', () => {
    const { v, spots } = labels(game());
    const text = (k: string, at?: number) =>
      spotLabel(
        v,
        spots.find((x) => x.spot.k === k && (at == null || ('v' in x.spot && x.spot.v === at)))!.spot,
      );
    expect(text('knight', 30)).toBe("Sam's strong knight (strength 2) · active");
    expect(text('knight', 31)).toBe("Joe's basic knight (strength 1) · not active");
    expect(text('building', 10)).toBe("Sam's city · 2 points · city wall: adds 2 to their hand limit");
    expect(text('building', 20)).toBe("Joe's settlement · 1 point");
    expect(text('merchant')).toBe("Joe's merchant · Joe trades Wheat 2:1 · worth 1 point");
    // Before the first barbarian attack the robber can't move in Knights.
    expect(text('robber')).toMatch(/^The robber · .* stays put until the barbarians first attack$/);
  });

  it('harbors say their rate; 3:1 harbors go when the bank trades 3:1', () => {
    const { v, g, spots } = labels(game());
    const ports = spots.filter((x) => x.spot.k === 'port');
    expect(ports).toHaveLength(v.board.ports.length);
    const texts = ports.map((x) => spotLabel(v, x.spot));
    expect(texts).toContain('3:1 harbor · trade 3 of one card for 1 of anything');
    expect(texts).toContain('2:1 Ore harbor · trade 2 Ore for 1 of anything');
    const any = v.board.ports.filter((p) => p.t === 'any').length;
    expect(spotsOf(v, g, true).filter((x) => x.spot.k === 'port')).toHaveLength(ports.length - any);
  });

  it('finds the piece nearest the pointer, and nothing far from any piece', () => {
    const { g, spots } = labels(game());
    const k = g.verts[30]!;
    expect(spotAt(spots, k.x + 0.05, k.y - 0.05)?.spot).toEqual({ k: 'knight', v: 30 });
    // The middle of an empty land hex far from everything.
    const empty = g.hexes.findIndex(
      (h, i) =>
        game().board.hexes[i]!.t !== 'sea' && spots.every((x) => Math.hypot(x.x - h.x, x.y - h.y) > 0.6),
    );
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(spotAt(spots, g.hexes[empty]!.x, g.hexes[empty]!.y)).toBeNull();
  });
});
