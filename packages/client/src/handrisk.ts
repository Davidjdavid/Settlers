/* The hand-limit warning (SPEC 8.4), worked out from a player's own view. */

import { handLimit, stateFromView, type PlayerView, type Seat } from '@settlers/engine';
import { nameOf } from './text';

/** Over the hand limit (SPEC 8.4): who would discard how many on a 7, and why that limit. */
export function handRisk(
  v: PlayerView,
  s: ReturnType<typeof stateFromView>,
  p: Seat,
  n: number,
): { text: string; calm: boolean } | null {
  // With "no discards before the first attack", nobody discards yet, so the rules give no limit
  // until then; the note still goes by the usual one (D2) and stays calm.
  const quiet = !!v.rules.houseRules.noDiscardBeforeAttack && !!v.ck && v.ck.attacks === 0;
  const walls = v.ck ? v.ck.walls.filter((x) => v.verts[x]?.[0] === p).length : 0;
  const limit = quiet ? 7 + 2 * walls : handLimit(s, p);
  if (n <= limit) return null;
  const lose = Math.floor(n / 2);
  const you = p === v.me;
  if (quiet)
    return {
      calm: true,
      text: `${n} cards: a 7 would cost ${you ? 'you' : nameOf(v, p)} ${lose}, but nobody discards until the barbarians have attacked`,
    };
  const why = walls
    ? `: 7, plus ${2 * walls} for ${you ? 'your' : 'their'} city wall${walls > 1 ? 's' : ''}`
    : '';
  return {
    calm: false,
    text: `${n} cards. If a 7 is rolled, ${you ? 'you’ll' : `${nameOf(v, p)} will`} discard ${lose} (half, rounded down). ${you ? 'Your' : 'Their'} limit is ${limit}${why}.`,
  };
}
