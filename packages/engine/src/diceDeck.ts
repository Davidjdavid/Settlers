/*
 * The dice deck house rules (docs/rules/dice-deck.md): the number dice come from a deck of 36
 * cards, one per way two dice land, shuffled back when empty; the trimmed deck takes 5 out at
 * random, face down, at each shuffle. Draws are picked by random numbers: the server's, saved with
 * the roll move, or the game's own in the simulator and old games.
 */

import type { DiceDeck, GameEvent, GameState } from './types';

export const DECK_CARDS = 36;
/** Cards the trimmed deck takes out at each shuffle. */
export const DECK_OUT = 5;

/** The dice a card shows: [first, second], each 1–6. */
export const cardDice = (c: number): [number, number] => [1 + Math.floor(c / 6), 1 + (c % 6)];

/** Draw the next card, shuffling first if the deck is empty. `rand(n)` is a whole number below n. */
export function drawDice(s: GameState, rand: (n: number) => number, events: GameEvent[]): [number, number] {
  let dk = s.diceDeck;
  if (!dk || !dk.left.length) {
    const left = Array.from({ length: DECK_CARDS }, (_, i) => i);
    const out: number[] = [];
    if (s.config.houseRules?.diceDeck === 'trimmed')
      for (let i = 0; i < DECK_OUT; i++) out.push(left.splice(rand(left.length), 1)[0]!);
    dk = s.diceDeck = { left, out: out.sort((a, b) => a - b), used: [] };
    events.push({ k: 'deckShuffled', left: left.length });
  }
  const c = dk.left.splice(rand(dk.left.length), 1)[0]!;
  dk.used.push(c);
  return cardDice(c);
}

/** dice-deck.md §5: every card once, in exactly one of used, left and out. */
export function deckProblems(s: GameState): string[] {
  const dk: DiceDeck | undefined = s.diceDeck;
  if (!dk) return [];
  const bad: string[] = [];
  const all = [...dk.used, ...dk.left, ...dk.out];
  if (all.length !== DECK_CARDS) bad.push(`dice deck has ${all.length} cards`);
  if (new Set(all).size !== all.length) bad.push('a dice card twice');
  if (all.some((c) => !Number.isInteger(c) || c < 0 || c >= DECK_CARDS)) bad.push('a bad dice card');
  if (dk.out.length !== 0 && dk.out.length !== DECK_OUT) bad.push(`${dk.out.length} dice cards out`);
  return bad;
}
