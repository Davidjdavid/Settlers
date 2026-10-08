import { describe, expect, it } from 'vitest';
import {
  COLORS,
  applyAction,
  botMove,
  cardKinds,
  handLimit,
  newGame,
  seedRng,
  stateFromView,
  viewFor,
  type GameConfig,
  type GameState,
} from '@settlers/engine';
import { handRisk, tradeRisk } from '../src/handrisk';

/** Bot games, calling `each` with the state after every move. */
function play(seed: string, config: Partial<GameConfig>, each: (s: GameState) => void) {
  let s = newGame(
    seed,
    ['Ann', 'Bob', 'Cat', 'Dan'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
    config,
  );
  const rng = seedRng(`${seed}-bots`);
  for (let step = 0; step < 6000 && s.phase === 'play'; step++) {
    let moved = false;
    for (let p = 0; p < s.players.length && !moved; p++) {
      const a = botMove(viewFor(s, p), rng);
      const r = a && applyAction(s, p, a);
      if (!r || !r.ok) continue;
      s = r.state;
      moved = true;
      each(s);
    }
    if (!moved) break;
  }
  return s;
}

describe('Hand-limit warning (SPEC 8.4)', () => {
  for (const [name, config] of [
    ['classic', {}],
    ['Cities & Knights', { modules: ['citiesKnights'], winVP: 13 }],
    [
      'Cities & Knights, no discards before the first attack',
      {
        modules: ['citiesKnights'],
        winVP: 13,
        houseRules: { noDiscardBeforeAttack: true },
      },
    ],
  ] as [string, Partial<GameConfig>][]) {
    it(`${name}: shown exactly when over the limit, with the right number, on every screen`, () => {
      let over = 0;
      let walls = 0;
      let calm = 0;
      const check = (s: GameState) => {
        for (let seat = 0; seat < s.players.length; seat++) {
          const v = viewFor(s, seat);
          const vs = stateFromView(v);
          s.players.forEach((pl, p) => {
            // Every card in hand counts, commodities included; others see the same total.
            const n = cardKinds(s).reduce((a, k) => a + (pl.res[k] ?? 0), 0);
            expect(v.players[p]!.resCount).toBe(n);
            // Before the first attack with "no discards" the rules have no limit; the calm
            // note goes by the usual one, 7 plus 2 a wall (D2).
            const quiet = !!s.config.houseRules?.noDiscardBeforeAttack && s.ck!.attacks === 0;
            const usual = 7 + 2 * (s.ck?.walls.filter((x) => s.verts[x]?.[0] === p).length ?? 0);
            const limit = quiet ? usual : handLimit(s, p);
            if (!quiet) expect(limit).toBe(usual);
            const r = handRisk(v, vs, p, n);
            if (n <= limit) return expect(r).toBeNull();
            expect(r).not.toBeNull();
            over++;
            expect(r!.calm).toBe(quiet);
            const lose = Math.floor(n / 2);
            if (quiet) {
              calm++;
              expect(r!.text).toMatch(
                new RegExp(`^${n} cards: a 7 would cost .* ${lose}, but nobody discards`),
              );
            } else {
              expect(r!.text).toMatch(
                new RegExp(`^${n} cards\\. If a 7 is rolled, .* discard ${lose} \\(half`),
              );
              expect(r!.text).toContain(`limit is ${limit}`);
              if (limit > 7) {
                walls++;
                expect(r!.text).toContain(`plus ${limit - 7} for`);
              }
            }
          });
        }
      };
      play(`risk-${name}`, config, (s) => {
        check(s);
        // The bots spend fast, so also each state with 6 more cards in every hand.
        const big = structuredClone(s);
        for (const pl of big.players) pl.res.wheat += 6;
        check(big);
      });
      expect(over).toBeGreaterThan(0);
      if (config.houseRules?.noDiscardBeforeAttack) expect(calm).toBeGreaterThan(0);
      if (config.modules && !config.houseRules) expect(walls).toBeGreaterThan(0);
    });
  }
});

describe('A trade over the hand limit (SPEC 8.4)', () => {
  const players = ['Ann', 'Bob', 'Cat'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! }));
  /** A started game with `n` wheat in Ann's hand and `walls` city walls of hers. */
  const at = (n: number, walls: number, config: Partial<GameConfig> = {}) => {
    let s: GameState = newGame('tradeRisk', players, config);
    // Play the starting placements with the bot, then set Ann's hand.
    const rng = seedRng('tradeRisk-bots');
    while (s.stage === 'setup') {
      const r = applyAction(s, s.turn, botMove(viewFor(s, s.turn), rng)!);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    s = structuredClone(s);
    for (const k of cardKinds(s)) s.players[0]!.res[k] = 0;
    s.players[0]!.res.wheat = n;
    if (walls) {
      // Her two cities, and a third on a free corner (only the count matters here).
      const mine = s.verts.flatMap((b, i) => (b && b[0] === 0 ? [i] : []));
      mine.push(s.verts.findIndex((b) => b == null));
      for (const x of mine) s.verts[x] = [0, 2];
      s.ck!.walls = mine.slice(0, walls);
      expect(s.ck!.walls).toHaveLength(walls);
    }
    const v = viewFor(s, 0);
    return { v, vs: stateFromView(v) };
  };

  it('warns when a trade takes you over 7, and says how many a 7 would cost', () => {
    const { v, vs } = at(6, 0);
    expect(tradeRisk(v, vs, { wheat: 1 }, { ore: 2 })).toBeNull(); // 7: at the limit
    const r = tradeRisk(v, vs, { wheat: 1 }, { ore: 3 });
    expect(r).toMatchObject({ now: 6, after: 8, limit: 7, lose: 4 });
    expect(r!.text).toBe(
      'This trade puts you at 8 cards, over your limit of 7. If a 7 is rolled, you’d discard 4.',
    );
  });

  it('already over: only a trade that adds cards warns', () => {
    const { v, vs } = at(9, 0);
    expect(tradeRisk(v, vs, { wheat: 2 }, { ore: 1 })).toBeNull();
    expect(tradeRisk(v, vs, { wheat: 1 }, { ore: 1 })).toBeNull();
    expect(tradeRisk(v, vs, { wheat: 1 }, { ore: 2 })).toMatchObject({ after: 10, lose: 5 });
  });

  it('a bank trade never warns: it always takes cards away', () => {
    const { v, vs } = at(8, 0);
    expect(tradeRisk(v, vs, { wheat: 4 }, { ore: 1 })).toBeNull();
    expect(tradeRisk(v, vs, { wheat: 2 }, { ore: 1 })).toBeNull();
  });

  for (const walls of [1, 2, 3])
    it(`Cities & Knights with ${walls} city wall${walls > 1 ? 's' : ''}: the limit is ${7 + 2 * walls}`, () => {
      const limit = 7 + 2 * walls;
      const { v, vs } = at(limit - 1, walls, { modules: ['citiesKnights'], winVP: 13 });
      expect(tradeRisk(v, vs, { wheat: 1 }, { ore: 2 })).toBeNull();
      const r = tradeRisk(v, vs, { wheat: 1 }, { ore: 3 });
      expect(r).toMatchObject({ after: limit + 1, limit });
      expect(r!.text).toContain(
        `over your limit of ${limit} (7, plus ${2 * walls} for your city wall${walls > 1 ? 's' : ''})`,
      );
    });

  it('no warning while nobody discards (before the first attack, with that house rule)', () => {
    const config = { modules: ['citiesKnights'], winVP: 13, houseRules: { noDiscardBeforeAttack: true } };
    const { v, vs } = at(7, 0, config as Partial<GameConfig>);
    expect(tradeRisk(v, vs, { wheat: 1 }, { ore: 3 })).toBeNull();
  });
});
