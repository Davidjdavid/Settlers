/* Turning events into short sentences for the log. Wording follows the prototype. */

import {
  COMS,
  RES,
  type Cards,
  type GameEvent,
  type PlayerView,
  type RuleKey,
  type Seat,
} from '@settlers/engine';
import { DEV_LABEL, PROGRESS_LABEL, TRACK_LABEL } from './art';

export function nameOf(v: PlayerView, p: Seat | null): string {
  if (p == null) return 'Nobody';
  if (p === v.me) return 'You';
  return v.players[p]?.nick || 'Someone';
}

export function cardsText(c: Cards | null | undefined): string {
  const parts = [...RES, ...COMS].filter((r) => (c?.[r] ?? 0) > 0).map((r) => `${c![r]} ${r}`);
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
    case 'setup': {
      const what = v.verts[e.v]?.[1] === 2 && v.ck ? 'a city' : 'a settlement';
      return {
        text: e.got ? `${who(e.p)} placed ${what} and got ${cardsText(e.got)}` : `${who(e.p)} placed ${what}`,
      };
    }
    case 'turn':
      return { text: `${who(e.p) === 'You' ? 'Your' : `${who(e.p)}’s`} turn`, sep: true };
    case 'roll':
      if (e.redo)
        return {
          text: v.ck
            ? `${who(e.p)} rolled 7, but there are no 7s yet: rolling again`
            : `${who(e.p)} rolled 7, but there are no 7s in the first round: rolling again`,
        };
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
    /* Cities & Knights */
    case 'eventDie':
      return {
        text:
          e.face === 'ship'
            ? 'Event die: the barbarian ship'
            : `Event die: ${TRACK_LABEL[e.face].toLowerCase()} gate`,
      };
    case 'barbarians':
      return {
        text: e.at >= 7 ? 'The barbarians land!' : `The barbarians sail closer (${e.at} of 7)`,
        big: e.at >= 7,
      };
    case 'attack':
      return {
        text:
          e.strength > e.defense
            ? `The barbarians (${e.strength}) beat the knights (${e.defense})${e.losers.length ? `: ${listNames(v, e.losers)} ${e.losers.length === 1 && e.losers[0] !== v.me ? 'loses' : 'lose'} a city` : ''}`
            : `The knights (${e.defense}) drive off the barbarians (${e.strength})${e.defender != null ? `: ${who(e.defender)} ${e.defender === v.me ? 'are' : 'is'} Defender of Catan (+1 point)` : e.tied.length ? `: ${listNames(v, e.tied)} each draw a progress card` : ''}`,
        big: true,
      };
    case 'cityLost':
      return { text: `${who(e.p)} lost a city to the barbarians` };
    case 'draw':
      return {
        text: e.card
          ? `${who(e.p)} drew ${PROGRESS_LABEL[e.card]}${e.card === 'printer' || e.card === 'constitution' ? ' (+1 point)' : ''}`
          : `${who(e.p)} drew a ${TRACK_LABEL[e.track].toLowerCase()} card`,
        big: e.card === 'printer' || e.card === 'constitution',
      };
    case 'commodities': {
      const lines = Object.entries(e.gains).map(([p, g]) => `${who(Number(p))} got ${cardsText(g)}`);
      return { text: lines.join('. ') + '.' };
    }
    case 'improve':
      return { text: `${who(e.p)} raised ${TRACK_LABEL[e.track].toLowerCase()} to level ${e.lvl}` };
    case 'metropolis':
      return {
        text:
          e.from != null
            ? `${who(e.p)} took the ${TRACK_LABEL[e.track].toLowerCase()} metropolis from ${who(e.from)}`
            : `${who(e.p)} built the ${TRACK_LABEL[e.track].toLowerCase()} metropolis`,
        big: true,
      };
    case 'wall':
      return { text: `${who(e.p)} built a city wall${e.free ? ' (free)' : ''}` };
    case 'knight':
      return { text: `${who(e.p)} built a knight` };
    case 'promote':
      return {
        text: `${who(e.p)} promoted a knight to ${['', 'basic', 'strong', 'mighty'][e.lvl]}${e.free ? ' (free)' : ''}`,
      };
    case 'activate':
      return { text: `${who(e.p)} activated a knight` };
    case 'activateAll':
      return { text: `${who(e.p)} activated ${e.n} knight${e.n === 1 ? '' : 's'}` };
    case 'moveKnight':
      return {
        text:
          e.displaced != null
            ? `${who(e.p)}’s knight chased away ${who(e.displaced) === 'You' ? 'your' : `${who(e.displaced)}’s`} knight`
            : `${who(e.p)} moved a knight`,
      };
    case 'relocate':
      return {
        text:
          e.to == null
            ? `${who(e.p)}’s knight had nowhere to go and went home`
            : `${who(e.p)} placed a knight`,
      };
    case 'knightRemoved':
      return { text: `${who(e.p)} lost a knight` };
    case 'chase':
      return { text: `${who(e.p)}’s knight chased the robber` };
    case 'progress':
      return { text: `${who(e.p)} played ${PROGRESS_LABEL[e.card]}`, big: true };
    case 'progressBack':
      return { text: `${who(e.p)} put a ${TRACK_LABEL[e.track].toLowerCase()} card back` };
    case 'aqueduct':
      return { text: `${who(e.p)} took 1 ${e.r} (aqueduct)` };
    case 'give':
      return {
        text: e.cards
          ? `${who(e.from)} gave ${cardsText(e.cards)} to ${who(e.to)}`
          : `${who(e.from)} gave ${e.n} card${e.n === 1 ? '' : 's'} to ${who(e.to)}`,
      };
    case 'spy':
      return {
        text: e.card
          ? `${who(e.p)} took ${PROGRESS_LABEL[e.card]} from ${who(e.from)}`
          : `${who(e.p)} took a ${TRACK_LABEL[e.track].toLowerCase()} card from ${who(e.from)}`,
      };
    case 'merchant':
      return { text: `${who(e.p)} placed the merchant` };
    case 'inventor':
      return { text: `${who(e.p)} swapped two number tokens` };
    case 'gain':
      return {
        text: e.from
          ? `${who(e.p)} took ${cardsText(e.cards)} from everyone`
          : `${who(e.p)} took ${cardsText(e.cards)} from the bank`,
      };
    case 'roadRemoved':
      return {
        text: `${who(e.by)} removed ${e.p === e.by ? 'their own' : who(e.p) === 'You' ? 'your' : `${who(e.p)}’s`} road`,
      };
    case 'owe':
      return null;
    case 'askBack':
      return { text: `${who(e.p)} asked for the dice back`, big: true };
    case 'handBack':
      return {
        text: `${who(e.p)} handed the dice back to ${who(e.to) === 'You' ? 'you' : who(e.to)}`,
        big: true,
      };
    case 'refuseBack':
      return { text: `${who(e.p)} kept the dice` };
    case 'askUndo':
      return { text: `${who(e.p)} asked to undo their last move` };
    case 'answerUndo':
      return { text: e.yes ? `${who(e.p)} agreed to the undo` : `${who(e.p)} said no to the undo` };
    case 'cancelUndo':
      return { text: `${who(e.p)} withdrew the undo request` };
    case 'undo':
      return { text: `${who(e.p)}’s last move was undone`, big: true };
    case 'rule':
      return { text: `${who(e.p)} ${ruleText(e.rule, e.value)}`, big: true };
  }
}

/** Names for game rules, as switches and in the log. */
export const RULE_LABEL: Record<RuleKey, string> = {
  winVP: 'Points to win',
  no7FirstRound: 'No 7s in the first round',
  bank3to1: '3:1 bank trades for everyone',
  freeShipMoves: 'Move ships as often as you like',
  rerollBeforeAttack: 'Re-roll 7s until the barbarians have attacked',
  noDiscardBeforeAttack: 'No discards on a 7 until the barbarians have attacked',
  barbarianDelay: 'Barbarians and progress cards start after round',
  handBack: 'Players can hand the dice back',
  handBackSetup: 'Hand the dice back during setup too',
  undo: 'Players can ask to undo a move',
};

function ruleText(rule: RuleKey, value: boolean | number): string {
  if (rule === 'winVP') return `set points to win to ${value}`;
  if (rule === 'barbarianDelay') return `set the barbarians to start after round ${value}`;
  return `turned ${value ? 'on' : 'off'} “${RULE_LABEL[rule]}”`;
}
