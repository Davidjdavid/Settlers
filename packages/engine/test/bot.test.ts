import { describe, expect, it } from 'vitest';
import {
  applyAction,
  botMove,
  checkInvariants,
  newGame,
  seedRng,
  stateFromView,
  viewFor,
  legalActions,
} from '../src/index';
import { seatsFor } from './simulate';

describe('bot (plays from its own view only)', () => {
  it('finishes games, and every move it picks is accepted by the real engine', () => {
    for (let g = 0; g < 12; g++) {
      const n = 2 + (g % 3);
      let s = newGame(`bot-${g}`, seatsFor(n));
      const rng = seedRng(`botrng-${g}`);
      let steps = 0;
      while (s.phase === 'play') {
        if (++steps > 20000) throw new Error('bot game did not finish');
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
  });

  it('stateFromView gives the same legal moves for your own turn as the real state', () => {
    let s = newGame('sfv', seatsFor(3));
    const rng = seedRng('sfv');
    for (let i = 0; i < 300 && s.phase === 'play'; i++) {
      const p = s.stage === 'discard' ? Number(Object.keys(s.discard!)[0]) : s.turn;
      if (s.stage !== 'discard') {
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
  });
});
