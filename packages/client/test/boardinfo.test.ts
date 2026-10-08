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
    // What it sits on and what it brings in (SPEC 13.4), then the wall.
    expect(text('building', 10)).toMatch(
      /^Sam's city · 2 points · on [A-Za-z]+ \d+(, [A-Za-z]+ \d+)* · about \d+ cards? every 10 rolls · city wall: adds 2 to their hand limit$/,
    );
    expect(text('building', 20)).toMatch(/^Joe's settlement · 1 point · on /);
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
    // A point on land out of every labelled piece's reach (number tokens included).
    const points = g.hexes.flatMap((h, i) =>
      game().board.hexes[i]!.t === 'sea'
        ? []
        : [
            [h.x + 0.45, h.y],
            [h.x - 0.45, h.y],
            [h.x, h.y + 0.45],
            [h.x, h.y - 0.45],
          ],
    );
    const empty = points.find(([x, y]) => spots.every((s) => Math.hypot(s.x - x!, s.y - y!) > s.r + 0.05));
    expect(empty).toBeDefined();
    expect(spotAt(spots, empty![0]!, empty![1]!)).toBeNull();
  });

  it('a number token says how often it comes up, how often it has, and whom it pays (SPEC 13.4)', () => {
    const s = game();
    const { v, g, spots } = labels(s);
    // The tile under Sam's walled city at corner 10 that has a number.
    const h = g.verts[10]!.hexes.find((x) => v.board.hexes[x]!.n > 0 && x !== v.board.robber)!;
    const tile = spots.find((x) => x.spot.k === 'tile' && x.spot.h === h)!;
    const n = v.board.hexes[h]!.n;
    const ways = 6 - Math.abs(n - 7);
    const rolled = new Array<number>(13).fill(0);
    rolled[n] = 3;
    const text = spotLabel(v, tile.spot, rolled);
    expect(text).toContain(
      `${n} · comes up ${ways} in 36 rolls (${Math.round((ways / 36) * 100)}%) · rolled 3 times so far · pays `,
    );
    expect(text).toContain("Sam's city (2)");
    // With the robber on it, it pays nothing.
    s.board.robber = h;
    expect(spotLabel(viewFor(s, 2), tile.spot)).toMatch(/the robber is on it: it pays nothing$/);
  });
});
