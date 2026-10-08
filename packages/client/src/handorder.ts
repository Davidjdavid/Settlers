/*
 * Arranging the cards in your hand (SPEC 13.2): a grid of spots, one row of five resources, and
 * with Cities & Knights a second row with each commodity under the resource it comes from. Pure,
 * so it can be tested without a screen.
 */

import { RES, type Card } from '@settlers/engine';

export type HandKind = 'base' | 'ck';
/** Each spot's card, or null for an empty spot. */
export type Slots = (Card | null)[];

export const DEFAULT_SLOTS: Record<HandKind, readonly (Card | null)[]> = {
  base: [...RES],
  // Paper under wood, cloth under sheep, coin under ore.
  ck: [...RES, 'paper', null, 'cloth', null, 'coin'],
};

/** A saved arrangement if it holds exactly this kind of game's cards in its spots; else the default. */
export function slotsFor(saved: unknown, kind: HandKind): Slots {
  const def = DEFAULT_SLOTS[kind];
  const want = def.filter((c): c is Card => c != null);
  if (!Array.isArray(saved) || saved.length !== def.length) return def.slice();
  const cards = saved.filter((c) => c != null);
  const ok = cards.length === want.length && want.every((c) => cards.includes(c));
  return ok ? (saved.slice() as Slots) : def.slice();
}

/** Swap two spots (moving a card to an empty spot leaves its old spot empty). */
export function swapSlots(slots: readonly (Card | null)[], a: number, b: number): Slots {
  const out = slots.slice();
  if (a < 0 || b < 0 || a >= out.length || b >= out.length) return out;
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}

export const isDefault = (slots: readonly (Card | null)[], kind: HandKind) =>
  slots.length === DEFAULT_SLOTS[kind].length && slots.every((c, i) => c === DEFAULT_SLOTS[kind][i]);
