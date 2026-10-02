/*
 * CPU chatter (SPEC 5.14): now and then a CPU says something in table talk. It is made only
 * from the CPU's own view, so even a bluffing CPU knows no more than a person at the table.
 * Easy and Medium only say what's true about their hand and plans; Hard may bluff.
 * Chatter never changes the game: the server posts it like a chat line.
 */

import { nextFloat, nextInt, type RngState } from './rng';
import { COST } from './queries';
import { RES, type GameEvent, type Resource } from './types';
import type { PlayerView } from './view';

export type CpuLevel = 'easy' | 'medium' | 'hard';

const NAME: Record<Resource, string> = {
  wood: 'wood',
  brick: 'brick',
  sheep: 'sheep',
  wheat: 'wheat',
  ore: 'ore',
};

/** A line and the facts it claims (for checking that Easy and Medium tell the truth). */
export interface Chat {
  text: string;
  /** What the line says about the CPU's hand: 'want' r means it has none of r, 'lots' means 4+. */
  claim:
    | { k: 'want' | 'lots'; r: Resource }
    | { k: 'saving'; what: 'city' | 'settlement' }
    | { k: 'robbed' }
    | { k: 'none' };
}

const pick = <T>(rng: RngState, xs: readonly T[]): T => xs[nextInt(rng, xs.length)]!;

/** What it's saving for: a city if it has a settlement to upgrade, else a settlement. */
function goal(v: PlayerView): 'city' | 'settlement' {
  const me = v.me!;
  return v.verts.some((b) => b && b[0] === me && b[1] === 1) ? 'city' : 'settlement';
}

/**
 * Something to say at the start of the CPU's turn, or after it was robbed, or null.
 * `robbedBefore`: how many times it was robbed earlier this game (for "AGAIN").
 * `rate`: how chatty (1 as usual, 2 for a chatty custom CPU).
 */
export function cpuChat(
  v: PlayerView,
  events: GameEvent[],
  level: CpuLevel,
  rng: RngState,
  robbedBefore = 0,
  rate = 1,
): Chat | null {
  const me = v.me;
  if (me == null || !v.hand || v.phase !== 'play') return null;
  const hand = v.hand.res;
  const robbed = events.find((e) => e.k === 'steal' && e.from === me);
  if (robbed && robbed.k === 'steal') {
    if (nextFloat(rng) >= Math.min(1, 0.5 * rate)) return null;
    const lines = robbedBefore
      ? ['robbed AGAIN', 'seriously, again?', 'why is it always me']
      : robbed.r && RES.includes(robbed.r as Resource)
        ? [`hey, that was my ${robbed.r}!`, 'ouch', 'rude']
        : ['ouch', 'rude'];
    return { text: pick(rng, lines), claim: { k: 'robbed' } };
  }
  const myTurnStart = events.some((e) => e.k === 'turn' && e.p === me);
  if (!myTurnStart || nextFloat(rng) >= Math.min(1, 0.25 * rate)) return null;

  const g = goal(v);
  const cost = COST[g] as Partial<Record<Resource, number>>;
  const missing = RES.filter((r) => (cost[r] ?? 0) > 0 && hand[r] === 0);
  const lots = RES.filter((r) => hand[r] >= 4);
  if (level === 'hard') {
    // Cagey, and sometimes a bluff about what it wants; never anything it couldn't know.
    if (nextFloat(rng) < 0.5)
      return { text: pick(rng, ['no comment', 'I have a plan', 'just watching']), claim: { k: 'none' } };
    const r = pick(rng, RES);
    return { text: `anyone have ${NAME[r]}?`, claim: { k: 'none' } };
  }
  const options: Chat[] = [];
  for (const r of missing)
    options.push({
      text: pick(rng, [`anyone have ${NAME[r]}?`, `looking for ${NAME[r]}`]),
      claim: { k: 'want', r },
    });
  for (const r of lots)
    options.push({
      text: pick(rng, [`drowning in ${NAME[r]}`, `so much ${NAME[r]}`]),
      claim: { k: 'lots', r },
    });
  options.push({ text: `saving up for a ${g}`, claim: { k: 'saving', what: g } });
  return pick(rng, options);
}

/** Is a chat line true for this hand? (Easy and Medium must always say true things.) */
export function chatIsTrue(v: PlayerView, c: Chat): boolean {
  const hand = v.hand!.res;
  switch (c.claim.k) {
    case 'want':
      return hand[c.claim.r] === 0;
    case 'lots':
      return hand[c.claim.r] >= 4;
    case 'saving':
      return c.claim.what === goal(v);
    default:
      return true;
  }
}
