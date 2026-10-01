/* Turning events into short sentences for the log. Wording follows the prototype. */

import { RES, type GameEvent, type PartialRes, type PlayerView, type Seat } from '@settlers/engine';
import { DEV_LABEL } from './art';

export function nameOf(v: PlayerView, p: Seat | null): string {
  if (p == null) return 'Nobody';
  if (p === v.me) return 'You';
  return v.players[p]?.nick || 'Someone';
}

export function cardsText(c: PartialRes | null | undefined): string {
  const parts = RES.filter((r) => (c?.[r] ?? 0) > 0).map((r) => `${c![r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

export function listNames(v: PlayerView, seats: Seat[]): string {
  const names = seats.map((p) => nameOf(v, p));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Longest Road", or "Longest Trade Route" when ships count too. */
export const routeName = (v: PlayerView) =>
  v.rules.modules.includes('seafarers') ? 'Longest Trade Route' : 'Longest Road';

/** One log line, or null for events that only matter to the UI. */
export function eventText(
  v: PlayerView,
  e: GameEvent,
): { text: string; big?: boolean; sep?: boolean } | null {
  const who = (p: Seat | null) => nameOf(v, p);
  switch (e.k) {
    case 'start':
      return { text: 'The game started', big: true };
    case 'setup':
      return {
        text: e.got
          ? `${who(e.p)} placed a settlement and got ${cardsText(e.got)}`
          : `${who(e.p)} placed a settlement`,
      };
    case 'turn':
      return { text: `${who(e.p) === 'You' ? 'Your' : `${who(e.p)}’s`} turn`, sep: true };
    case 'roll':
      if (e.redo)
        return { text: `${who(e.p)} rolled 7, but there are no 7s in the first round: rolling again` };
      return { text: `${who(e.p)} rolled ${e.d[0] + e.d[1]}`, big: e.d[0] + e.d[1] === 7 };
    case 'produce': {
      const lines = Object.entries(e.gains).map(([p, g]) => `${who(Number(p))} got ${cardsText(g)}`);
      const short = e.short.length ? ` The bank ran out of ${e.short.join(', ')}.` : '';
      return { text: (lines.length ? lines.join('. ') + '.' : 'Nobody got anything.') + short };
    }
    case 'mustDiscard':
      return { text: `${listNames(v, Object.keys(e.need).map(Number))} must discard half their cards` };
    case 'discard':
      return { text: `${who(e.p)} discarded ${cardsText(e.c)}` };
    case 'robber':
      return { text: `${who(e.p)} moved the robber` };
    case 'steal':
      return {
        text: e.r
          ? `${who(e.p)} stole 1 ${e.r} from ${who(e.from)}`
          : `${who(e.p)} stole a card from ${who(e.from)}`,
      };
    case 'build':
      return { text: `${who(e.p)} built a ${e.what}${e.free ? ' (free)' : ''}` };
    case 'buyDev':
      return {
        text: e.card
          ? `${who(e.p)} bought a ${DEV_LABEL[e.card]} card`
          : `${who(e.p)} bought a development card`,
      };
    case 'playDev':
      return { text: `${who(e.p)} played ${DEV_LABEL[e.card]}` };
    case 'plenty':
      return { text: `${who(e.p)} took ${cardsText(e.got)} from the bank` };
    case 'mono': {
      const n = Object.values(e.from).reduce((a, b) => a + b, 0);
      return { text: `${who(e.p)} took ${n} ${e.r} from everyone` };
    }
    case 'bank':
      return { text: `${who(e.p)} traded ${e.n} ${e.give} for 1 ${e.get} with the bank` };
    case 'offer':
      return {
        text: `${who(e.offer.from)} offered ${cardsText(e.offer.give)} for ${cardsText(e.offer.want)}`,
      };
    case 'trade':
      return { text: `${who(e.a)} gave ${cardsText(e.give)} to ${who(e.b)} for ${cardsText(e.want)}` };
    case 'longest':
      return {
        text: e.p == null ? `Nobody holds ${routeName(v)} now` : `${who(e.p)} took ${routeName(v)} (${e.n})`,
        big: true,
      };
    case 'largest':
      return { text: `${who(e.p)} took Largest Army (${e.n} knights)`, big: true };
    case 'win':
      return { text: `${who(e.p)} won with ${e.vp} points!`, big: true };
    case 'respond':
    case 'cancelOffer':
      return null;
    case 'moveShip':
      return { text: `${who(e.p)} moved a ship` };
    case 'pirate':
      return { text: `${who(e.p)} moved the pirate` };
    case 'goldOwed':
      return {
        text: `Gold! ${listNames(v, Object.keys(e.owed).map(Number))} ${Object.keys(e.owed).length === 1 ? 'picks' : 'pick'} resources`,
      };
    case 'gold':
      return { text: `${who(e.p)} took ${cardsText(e.got)} from a gold field` };
    case 'discover':
      return {
        text: `${who(e.p)} discovered ${e.t === 'sea' ? 'open sea' : e.t === 'gold' ? 'a gold field' : `${e.t}${e.n ? ` (${e.n})` : ''}`}${e.got ? ` and got ${cardsText(e.got)}` : ''}`,
      };
    case 'islandBonus':
      return { text: `${who(e.p)} settled a new island: +${e.vp} points`, big: true };
  }
}
