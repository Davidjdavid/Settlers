/* The hand-limit warning (SPEC 8.4), worked out from a player's own view. */

import { handLimit, stateFromView, type Cards, type PlayerView, type Seat } from '@settlers/engine';
import { nameOf } from './text';

/**
 * A player's hand limit and why (SPEC 8.4): 7, plus 2 for each city wall with Cities & Knights.
 * `quiet`: with "no discards before the first attack", nobody discards yet, so the rules give no
 * limit until then; the usual one still shows (D2).
 */
export function limitOf(v: PlayerView, s: ReturnType<typeof stateFromView>, p: Seat) {
  const quiet = !!v.rules.houseRules.noDiscardBeforeAttack && !!v.ck && v.ck.attacks === 0;
  const walls = v.ck ? v.ck.walls.filter((x) => v.verts[x]?.[0] === p).length : 0;
  return { limit: quiet ? 7 + 2 * walls : handLimit(s, p), walls, quiet };
}

/** Over the hand limit (SPEC 8.4): who would discard how many on a 7, and why that limit. */
export function handRisk(
  v: PlayerView,
  s: ReturnType<typeof stateFromView>,
  p: Seat,
  n: number,
): { text: string; calm: boolean } | null {
  const { limit, walls, quiet } = limitOf(v, s, p);
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

export interface TradeRisk {
  now: number;
  after: number;
  limit: number;
  lose: number;
  text: string;
}

const sum = (c: Cards) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);

/**
 * A trade that would put you over your hand limit (SPEC 8.4), or further over it: what to warn
 * you about before you agree to it. Null when the trade leaves you at or under your limit, takes
 * cards away, or nobody discards yet ("no discards before the first attack").
 */
export function tradeRisk(
  v: PlayerView,
  s: ReturnType<typeof stateFromView>,
  /** What you give and what you get. */
  give: Cards,
  get: Cards,
): TradeRisk | null {
  const me = v.me;
  if (me == null || !v.hand) return null;
  const { limit, walls, quiet } = limitOf(v, s, me);
  if (quiet) return null;
  const now = sum(v.hand.res);
  const after = now - sum(give) + sum(get);
  if (after <= limit || after <= now) return null;
  const lose = Math.floor(after / 2);
  const why = walls ? ` (7, plus ${2 * walls} for your city wall${walls > 1 ? 's' : ''})` : '';
  return {
    now,
    after,
    limit,
    lose,
    text: `This trade puts you at ${after} cards, over your limit of ${limit}${why}. If a 7 is rolled, you’d discard ${lose}.`,
  };
}
