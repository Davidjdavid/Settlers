import { describe, expect, it } from 'vitest';
import { applyAction, chatIsTrue, cpuChat, newGame, seedRng, viewFor, type GameState } from '../src/index';
import { configFor, seatsFor, simulate } from './simulate';

describe('CPU chatter (SPEC 5.14)', () => {
  it('Easy and Medium only say what is true about their hand and plans', () => {
    let lines = 0;
    for (let g = 0; g < 6; g++) {
      const seed = `chat${g}`;
      const r = simulate(seed, 3, {});
      let s: GameState = newGame(seed, seatsFor(3), configFor({}));
      for (const [p, a] of r.log) {
        const x = applyAction(s, p, a);
        if (!x.ok) throw new Error(x.error);
        s = x.state;
        for (let seat = 0; seat < 3; seat++) {
          const v = viewFor(s, seat);
          for (const level of ['easy', 'medium'] as const) {
            const c = cpuChat(v, x.events, level, seedRng(`${g}:${s.seq}:${seat}:${level}`));
            if (!c) continue;
            lines++;
            expect(chatIsTrue(v, c), `${c.text} with ${JSON.stringify(v.hand!.res)}`).toBe(true);
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(100);
  });

  it('says nothing for someone else’s view, or when the game is over', () => {
    const s = newGame('x', seatsFor(3));
    expect(cpuChat(viewFor(s, null), [{ k: 'turn', p: 0 }], 'easy', seedRng('y'))).toBeNull();
  });
});
