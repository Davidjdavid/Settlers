/* The dice deck house rules (docs/rules/dice-deck.md). */
import { describe, expect, it } from 'vitest';
import {
  DECK_CARDS, DECK_OUT, NEED_DICE, applyAction, cardDice, deckProblems, drawDice, newGame, nextInt, viewFor,
  type GameEvent, type GameState,
} from '../src/index'; // prettier-ignore
import { act, afterSetup } from './helpers';
import { seatsFor } from './simulate';

const ways = (t: number) => 6 - Math.abs(t - 7);

function deckGame(kind: 'full' | 'trimmed', seed = 'deck'): GameState {
  const s = structuredClone(newGame(seed, seatsFor(3), { houseRules: { diceDeck: kind } }));
  return s;
}

/** Roll as the player whose turn it is, from a fresh pre-roll stage each time. */
function rollOnce(s: GameState): { state: GameState; events: GameEvent[] } {
  s.stage = 'preroll';
  s.discard = null;
  return act(s, s.turn, { type: 'roll' });
}

describe('the dice deck (dice-deck.md)', () => {
  it('the cards are exactly the 36 ways two dice land', () => {
    const totals = new Array<number>(13).fill(0);
    const seen = new Set<string>();
    for (let c = 0; c < DECK_CARDS; c++) {
      const [a, b] = cardDice(c);
      seen.add(`${a},${b}`);
      totals[a + b]!++;
    }
    expect(seen.size).toBe(36);
    for (let t = 2; t <= 12; t++) expect(totals[t]).toBe(ways(t));
  });

  it('36 rolls of the full deck give exactly the average spread, then it is shuffled', () => {
    let s = afterSetup(3, 'deck-full');
    s.config.houseRules = { ...s.config.houseRules, diceDeck: 'full' };
    const totals = new Array<number>(13).fill(0);
    for (let i = 0; i < 36; i++) {
      const r = rollOnce(s);
      const roll = r.events.find((e) => e.k === 'roll')!;
      if (roll.k !== 'roll') throw new Error();
      totals[roll.d[0] + roll.d[1]]!++;
      expect(r.events.some((e) => e.k === 'deckShuffled')).toBe(i === 0);
      // (The test jumps stages by hand, so only the deck's own invariant applies.)
      expect(deckProblems(r.state)).toEqual([]);
      s = r.state;
    }
    for (let t = 2; t <= 12; t++) expect(totals[t], `total ${t}`).toBe(ways(t));
    expect(s.diceDeck!.left).toEqual([]);
    const next = rollOnce(s);
    expect(next.events.find((e) => e.k === 'deckShuffled')).toEqual({ k: 'deckShuffled', left: 36 });
    expect(next.state.diceDeck!.used).toHaveLength(1);
  });

  it('the trimmed deck takes 5 out at random at each shuffle and draws the other 31', () => {
    let s = afterSetup(3, 'deck-trim');
    s.config.houseRules = { ...s.config.houseRules, diceDeck: 'trimmed' };
    const outs: string[] = [];
    for (let i = 0; i < 31 * 3; i++) {
      const r = rollOnce(s);
      const sh = r.events.find((e) => e.k === 'deckShuffled');
      expect(!!sh).toBe(i % 31 === 0);
      if (sh) {
        expect(sh).toEqual({ k: 'deckShuffled', left: DECK_CARDS - DECK_OUT });
        expect(r.state.diceDeck!.out).toHaveLength(DECK_OUT);
        outs.push(r.state.diceDeck!.out.join(','));
      }
      // (The test jumps stages by hand, so only the deck's own invariant applies.)
      expect(deckProblems(r.state)).toEqual([]);
      s = r.state;
    }
    // Different cards out each time (three random picks of 5 from 36 practically never match).
    expect(new Set(outs).size).toBe(3);
  });

  it('a 7 rolled again draws the next card; the 7 is used up', () => {
    const s = deckGame('full');
    s.config.houseRules = { ...s.config.houseRules, no7FirstRound: true };
    // A deck whose next draws are a 7 (card 5 = 1,6) then a 6 (card 0 = 1,1? no: 1,1 is 2).
    s.diceDeck = { left: [5, 1], out: [], used: Array.from({ length: 34 }, (_, i) => i + 2) };
    s.stage = 'preroll';
    s.turnN = 1;
    s.setupI = 6;
    const r = applyAction(s, s.turn, { type: 'roll', dice: { d: [], e: [1], r: [0, 0] } });
    if (!r.ok) throw new Error(r.error);
    const rolls = r.events.filter((e) => e.k === 'roll');
    expect(rolls.map((e) => e.k === 'roll' && [e.d, !!e.redo])).toEqual([
      [[1, 6], true],
      [[1, 2], false],
    ]);
    expect(r.state.diceDeck!.left).toEqual([]);
  });

  it('server picks choose the card; too few picks asks the server for more', () => {
    const s = deckGame('full');
    s.stage = 'preroll';
    s.setupI = 6;
    s.turnN = 4;
    s.diceDeck = {
      left: [3, 14, 35],
      out: [],
      used: Array.from({ length: 36 }, (_, i) => i).filter((c) => ![3, 14, 35].includes(c)),
    };
    const r = applyAction(s, s.turn, { type: 'roll', dice: { d: [], e: [1], r: [1 + 3 * 1000] } });
    if (!r.ok) throw new Error(r.error);
    // Pick 3001 % 3 = 1: the second card left, 14 = (3, 3).
    expect(r.state.dice).toEqual(cardDice(14));
    expect(r.state.dice).toEqual([3, 3]);
    const short = applyAction(s, s.turn, { type: 'roll', dice: { d: [], e: [1], r: [] } });
    expect(short).toEqual({ ok: false, error: NEED_DICE });
  });

  it('the deck never shows in a view: only how many cards are left', () => {
    const s = rollOnce(deckGame('trimmed')).state;
    const v = viewFor(s, 0);
    expect(v.deckLeft).toBe(30);
    expect(JSON.stringify(v)).not.toMatch(/"left"|"out"|"used"|diceDeck"?:\s*\{/);
  });

  it('switching it on mid-game starts a fresh deck; off and on again with the same kind keeps it', () => {
    let s = rollOnce(deckGame('full')).state;
    expect(s.diceDeck!.used).toHaveLength(1);
    s.stage = 'main';
    s = act(s, s.turn, { type: 'setRule', rule: 'diceDeck', value: false }).state;
    expect(s.config.houseRules?.diceDeck).toBeUndefined();
    expect(s.diceDeck!.used).toHaveLength(1);
    s = act(s, s.turn, { type: 'setRule', rule: 'diceDeck', value: 'trimmed' }).state;
    expect(s.diceDeck).toBeUndefined();
    expect(s.config.houseRules?.diceDeck).toBe('trimmed');
    expect(() => act(s, s.turn, { type: 'setRule', rule: 'diceDeck', value: true as never })).toThrow(
      /valid setting/,
    );
  });

  it('draws are even: 36,000 draws from shuffled decks pick every card equally', () => {
    const s = deckGame('full');
    const rng = structuredClone(s.rng);
    const counts = new Array<number>(DECK_CARDS).fill(0);
    const ev: GameEvent[] = [];
    for (let i = 0; i < 36_000; i++) {
      const [a, b] = drawDice(s, (n) => nextInt(rng, n), ev);
      counts[(a - 1) * 6 + (b - 1)]!++;
    }
    // Whole decks: every card exactly once per 36 draws.
    expect(new Set(counts)).toEqual(new Set([1000]));
  });
});
