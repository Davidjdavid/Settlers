/*
 * Where each card sits in your hand (SPEC 13.2). With Cities & Knights, two rows of four: wood,
 * sheep, ore and brick on top, and under them books, linen and coin (each under the resource it
 * comes from) with wheat filling the last spot. Otherwise one row of five in the same order.
 */

import type { Card } from '@settlers/engine';

export type HandKind = 'base' | 'ck';

export const HAND_LAYOUT: Record<HandKind, readonly Card[]> = {
  base: ['wood', 'sheep', 'ore', 'brick', 'wheat'],
  ck: ['wood', 'sheep', 'ore', 'brick', 'paper', 'cloth', 'coin', 'wheat'],
};
