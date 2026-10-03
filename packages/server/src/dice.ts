/*
 * The one dice function (SPEC 5.3). Every die in every game — people's rolls, CPU rolls, 7s rolled
 * again, the event die — comes from here: each die is its own number from 1 to 6 from Node's
 * cryptographically secure generator. A total is never generated directly; it is two dice added.
 */

import { randomInt } from 'node:crypto';
import type { ServerDice } from '@settlers/engine';

/** One die: 1 to 6, each equally likely. */
export function rollDie(): number {
  return randomInt(1, 7);
}

/**
 * Dice for one roll move: `pairs` rolls' worth of number dice (more than one only matters when a
 * 7 is rolled again) and one event die; with the dice deck on, random numbers to draw cards with.
 * The engine uses them in order and ignores the rest.
 */
export function diceForRoll(pairs = 4, deck = false): ServerDice {
  const d: number[] = [];
  for (let i = 0; i < pairs * 2; i++) d.push(rollDie());
  // For the dice deck house rule: each number picks a card among those left (dice-deck.md §4).
  // Below 2^30, so taking it modulo at most 36 leaves no bias worth the name (under 1 in 10^7).
  if (!deck) return { d, e: [rollDie()] };
  const r: number[] = [];
  for (let i = 0; i < pairs * 2; i++) r.push(randomInt(0, 2 ** 30));
  return { d, e: [rollDie()], r };
}
