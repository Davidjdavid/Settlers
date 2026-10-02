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
import { handRisk } from '../src/handrisk';

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
