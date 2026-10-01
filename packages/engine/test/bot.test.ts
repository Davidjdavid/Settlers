import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  applyAction,
  botMove,
  checkInvariants,
  newGame,
  seedRng,
  stateFromView,
  viewFor,
  legalActions,
  type GameConfig,
} from '../src/index';
import { seatsFor } from './simulate';

describe('bot (plays from its own view only)', () => {
  it('finishes games, and every move it picks is accepted by the real engine', () => {
    for (let g = 0; g < 20; g++) {
      const seafarers = g >= 12 && g < 16;
      const ck = g >= 16;
      const n = seafarers || ck ? 3 + (g % 2) : 2 + (g % 3);
      const hfns = { map: SCENARIOS['heading-for-new-shores']! };
      const ckCfg: Partial<GameConfig> =
        g < 18
          ? { modules: ['citiesKnights'], winVP: 13 }
          : { ...hfns, modules: ['seafarers', 'citiesKnights'], winVP: 17 };
      let s = newGame(`bot-${g}`, seatsFor(n), seafarers ? hfns : ck ? ckCfg : {});
      const rng = seedRng(`botrng-${g}`);
      let steps = 0;
      while (s.phase === 'play') {
        if (++steps > 100000) throw new Error('bot game did not finish');
        let moved = false;
        for (let p = 0; p < n && !moved; p++) {
          const a = botMove(viewFor(s, p), rng);
          if (!a) continue;
          const r = applyAction(s, p, a);
          if (!r.ok) throw new Error(`bot move rejected: ${JSON.stringify(a)} -> ${r.error}`);
          s = r.state;
          moved = true;
        }
        if (!moved) throw new Error(`nobody could move at stage ${s.stage}`);
        expect(checkInvariants(s)).toEqual([]);
      }
      expect(s.winner).not.toBeNull();
    }
  }, 120000);

  it.each([
    ['classic', {}],
    ['seafarers', { map: SCENARIOS['heading-for-new-shores']! }],
    ['cities & knights', { modules: ['citiesKnights'], winVP: 13 }],
    [
      'cities & knights + seafarers',
      { map: SCENARIOS['heading-for-new-shores']!, modules: ['seafarers', 'citiesKnights'], winVP: 17 },
    ],
  ] as const)(
    'stateFromView gives the same legal moves for your own turn as the real state (%s)',
    (_name, cfg) => {
      let s = newGame('sfv', seatsFor(3), cfg as Partial<GameConfig>);
      const rng = seedRng('sfv');
      for (let i = 0; i < 1500 && s.phase === 'play'; i++) {
        let p = s.stage === 'discard' ? Number(Object.keys(s.discard!)[0]) : s.turn;
        if (s.stage === 'gold') p = Number(Object.keys(s.sea!.gold!.owed)[0]);
        if (s.stage === 'ck') p = s.ck!.owe[0]!.p;
        if (s.stage !== 'discard' && s.stage !== 'gold') {
          const real = legalActions(s, p).filter((a) => a.type !== 'respond' && a.type !== 'confirm');
          const approx = legalActions(stateFromView(viewFor(s, p)), p).filter(
            (a) => a.type !== 'respond' && a.type !== 'confirm',
          );
          // Robber choices depend on others' card counts only, which the view has.
          expect(approx).toEqual(real);
        }
        const a = botMove(viewFor(s, p), rng)!;
        s = (applyAction(s, p, a) as { ok: true; state: typeof s }).state;
      }
    },
  );
});
