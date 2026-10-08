import { describe, expect, it } from 'vitest';
import {
  COLORS,
  applyAction,
  botMove,
  newGame,
  seedRng,
  viewFor,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '@settlers/engine';
import { activeRules, endedRules } from '../src/houserules';

/** A bot game, calling `each` with the state before and after every move and its events. */
function play(
  seed: string,
  config: Partial<GameConfig>,
  each: (a: GameState, b: GameState, evs: GameEvent[]) => void,
) {
  let s = newGame(
    seed,
    ['Ann', 'Bob', 'Cat'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
    config,
  );
  const rng = seedRng(`${seed}-bots`);
  for (let step = 0; step < 4000 && s.phase === 'play'; step++) {
    let moved = false;
    for (let p = 0; p < s.players.length && !moved; p++) {
      const a = botMove(viewFor(s, p), rng);
      const r = a && applyAction(s, p, a);
      if (!r || !r.ok) continue;
      each(s, r.state, r.events);
      s = r.state;
      moved = true;
    }
    if (!moved) break;
  }
}

describe('house rules that last a while (on screen while on, a notice when over)', () => {
  it('no 7s in the first round: on until everyone has had a turn, and no 7 counts while it is', () => {
    let ended = 0;
    play('hr-7', { houseRules: { no7FirstRound: true } }, (a, b, evs) => {
      const on = activeRules(viewFor(b, 0)).some((r) => r.key === 'no7FirstRound');
      expect(on).toBe(b.turnN <= b.players.length);
      // While it's on, any 7 is rolled again (the engine says so with `redo`).
      for (const e of evs) if (e.k === 'roll' && e.d[0] + e.d[1] === 7 && !e.redo) expect(on).toBe(false);
      const gone = endedRules(viewFor(a, 1), viewFor(b, 1));
      if (gone.length) {
        ended++;
        expect(gone.map((r) => r.key)).toEqual(['no7FirstRound']);
        expect(b.turnN).toBe(b.players.length + 1);
      }
    });
    expect(ended).toBe(1);
  });

  it('Knights: re-roll 7s until the first attack, and the barbarians waiting, end when the engine says', () => {
    const seen = new Set<string>();
    play(
      'hr-ck',
      { modules: ['citiesKnights'], winVP: 13, houseRules: { rerollBeforeAttack: true, barbarianDelay: 2 } },
      (a, b, evs) => {
        const keys = activeRules(viewFor(b, 2)).map((r) => r.key);
        expect(keys.includes('rerollBeforeAttack')).toBe(b.ck!.attacks === 0);
        expect(keys.includes('barbarianDelay')).toBe(b.turnN <= 2 * b.players.length);
        // The event die isn't rolled while the barbarians wait.
        if (evs.some((e) => e.k === 'eventDie'))
          expect(
            activeRules(viewFor(a, 2)).some((r) => r.key === 'barbarianDelay') &&
              a.turnN <= 2 * a.players.length,
          ).toBe(false);
        for (const r of endedRules(viewFor(a, 0), viewFor(b, 0))) seen.add(r.key);
      },
    );
    expect([...seen].sort()).toEqual(['barbarianDelay', 'rerollBeforeAttack']);
  });

  it('a rule switched off mid-game is a rule change, not one running out', () => {
    const s = newGame(
      'hr-off',
      ['Ann', 'Bob'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
      {
        houseRules: { no7FirstRound: true },
      },
    );
    const before = viewFor(s, 0);
    const after = structuredClone(before);
    after.rules.houseRules = {};
    after.seq++;
    expect(activeRules(before).map((r) => r.key)).toEqual(['no7FirstRound']);
    expect(endedRules(before, after)).toEqual([]);
  });
});
