/*
 * Turning events into log lines (SPEC 8.10). A line is a list of parts: plain words, player
 * names, cards with their amount, hidden cards ("a card") and warnings. The log draws each part
 * in its colour with its icon; lineText gives the same line as plain text. Wording follows the
 * prototype.
 */

import {
  COMS,
  RES,
  isLogNote,
  type Card,
  type Cards,
  type GameEvent,
  type LogNote,
  type PlayerView,
  type RuleKey,
  type Seat,
} from '@settlers/engine';
import { CARD_LABEL, DEV_LABEL, PROGRESS_LABEL, RES_LABEL, TRACK_LABEL } from './art';

export function nameOf(v: PlayerView, p: Seat | null): string {
  if (p == null) return 'Nobody';
  if (p === v.me) return 'You';
  return v.players[p]?.nick || 'Someone';
}

/** Cards as plain text: "2 Brick, 1 Ore", or "nothing". */
export function cardsText(c: Cards | null | undefined): string {
  const parts = [...RES, ...COMS].filter((r) => (c?.[r] ?? 0) > 0).map((r) => `${c![r]} ${CARD_LABEL[r]}`);
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

/** One part of a log line. */
export type Seg =
  | string
  /** A player's name: "Alex" / "You"; `f` for "you", "Alex’s"/"Your", or mid-sentence "your". */
  | { p: Seat | null; f?: 'obj' | 'poss' | 'possMid' }
  /** n cards of one kind, with its colour and icon. */
  | { c: Card; n: number }
  /** Cards this player may not see: "a card", "2 cards". */
  | { hidden: number }
  /** 7s, the robber, the barbarians. */
  | { warn: string };

export interface Line {
  parts: Seg[];
  big?: boolean;
  bad?: boolean;
  /** A turn divider (SPEC 8.10): the log adds the roll to it. */
  turn?: Seat;
}

/** A line's parts from a template: interpolated parts stay parts, numbers become words. */
function L(strs: TemplateStringsArray, ...args: (Seg | Seg[] | number)[]): Seg[] {
  const out: Seg[] = [];
  strs.forEach((s, i) => {
    if (s) out.push(s);
    if (i >= args.length) return;
    const a = args[i]!;
    if (Array.isArray(a)) out.push(...a);
    else out.push(typeof a === 'number' ? String(a) : a);
  });
  return out;
}

const P = (p: Seat | null, f?: 'obj' | 'poss' | 'possMid'): Seg => (f ? { p, f } : { p });
const W = (warn: string): Seg => ({ warn });

/** "A, B and C" from parts. */
function and(xs: Seg[][]): Seg[] {
  const out: Seg[] = [];
  xs.forEach((x, i) => {
    if (i) out.push(i === xs.length - 1 ? ' and ' : ', ');
    out.push(...x);
  });
  return out;
}

/** Cards as parts: "2 Brick and 1 Ore", or "nothing". */
function C(c: Cards | Partial<Record<Card, number>> | null | undefined): Seg[] {
  const kinds = ([...RES, ...COMS] as Card[]).filter((r) => (c?.[r] ?? 0) > 0);
  return kinds.length ? and(kinds.map((r) => [{ c: r, n: c![r]! }])) : ['nothing'];
}

const names = (seats: Seat[]): Seg[] => and(seats.map((p) => [P(p)]));
const count = (o: Record<number, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** A tile in words: "Ore 6", "the desert". */
function tile(v: PlayerView, h: number): string {
  const x = v.board.hexes[h];
  if (!x) return 'a tile';
  if (x.t in RES_LABEL) return `${RES_LABEL[x.t as keyof typeof RES_LABEL]} ${x.n}`;
  return x.t === 'gold' ? `the gold field ${x.n}` : `the ${x.t}`;
}

/** Plain text for a part. */
export function segText(v: PlayerView, s: Seg): string {
  if (typeof s === 'string') return s;
  if ('p' in s) {
    const me = s.p != null && s.p === v.me;
    const n = nameOf(v, s.p);
    if (s.f === 'obj') return me ? 'you' : n;
    if (s.f === 'poss') return me ? 'Your' : `${n}’s`;
    if (s.f === 'possMid') return me ? 'your' : `${n}’s`;
    return n;
  }
  if ('c' in s) return `${s.n} ${CARD_LABEL[s.c]}`;
  if ('hidden' in s) return s.hidden === 1 ? 'a card' : `${s.hidden} cards`;
  return s.warn;
}

export const lineText = (v: PlayerView, l: Line) => l.parts.map((s) => segText(v, s)).join('');

/** The log lines for an event or note; none for events that only matter to the UI. */
export function eventLines(v: PlayerView, e: GameEvent | LogNote): Line[] {
  const one = (parts: Seg[], o: Omit<Line, 'parts'> = {}): Line[] => [{ parts, ...o }];
  if (isLogNote(e)) {
    // "The robber blocked 1 Brick from Joe"
    return Object.entries(e.lost).map(([p, c]) => ({
      parts: L`The ${W('robber')} blocked ${C(c)} from ${P(Number(p), 'obj')}`,
    }));
  }
  switch (e.k) {
    case 'start':
      return one(['The game started'], { big: true });
    case 'setup': {
      const what = v.verts[e.v]?.[1] === 2 && v.ck ? 'a city' : 'a settlement';
      return one(e.got ? L`${P(e.p)} placed ${what} and got ${C(e.got)}` : L`${P(e.p)} placed ${what}`);
    }
    case 'turn':
      return one(L`${P(e.p, 'poss')} turn`, { turn: e.p });
    case 'roll':
      if (e.redo)
        return one(
          v.ck
            ? L`${P(e.p)} rolled ${W('7')}, but there are no 7s yet: rolling again`
            : L`${P(e.p)} rolled ${W('7')}, but there are no 7s in the first round: rolling again`,
        );
      return one(
        e.d[0] + e.d[1] === 7
          ? L`${P(e.p)} rolled ${e.d[0]} + ${e.d[1]} = ${W('7')}`
          : L`${P(e.p)} rolled ${e.d[0]} + ${e.d[1]} = ${e.d[0] + e.d[1]}`,
      );
    case 'produce': {
      const got = Object.entries(e.gains).map(([p, g]) => ({ parts: L`${P(Number(p))} got ${C(g)}` }));
      const lines = got.length ? got : [{ parts: ['Nobody got anything'] }];
      return [...lines, ...shortLines(e.short, e.gains)];
    }
    case 'mustDiscard':
      return one(L`${names(Object.keys(e.need).map(Number))} must discard half their cards`);
    case 'discard':
      return one(L`${P(e.p)} discarded ${C(e.c)}`);
    case 'robber':
      return one(L`${P(e.p)} moved the ${W('robber')} to ${tile(v, e.h)}`);
    case 'steal':
      return one(
        e.r
          ? L`${P(e.p)} stole ${[{ c: e.r, n: 1 }]} from ${P(e.from, 'obj')}`
          : L`${P(e.p)} stole ${[{ hidden: 1 }]} from ${P(e.from, 'obj')}`,
      );
    case 'build':
      return one(L`${P(e.p)} built a ${e.what}${e.free ? ' (free)' : ''}`);
    case 'buyDev':
      return one(
        e.card ? L`${P(e.p)} bought a ${DEV_LABEL[e.card]} card` : L`${P(e.p)} bought a development card`,
      );
    case 'playDev':
      return one(L`${P(e.p)} played ${DEV_LABEL[e.card]}`);
    case 'plenty':
      return one(L`${P(e.p)} took ${C(e.got)} from the bank`);
    case 'mono': {
      const from = Object.entries(e.from).filter(([, n]) => n > 0);
      const detail = from.length
        ? L`: ${and(from.map(([q, n]) => L`${n} from ${P(Number(q), 'obj')}`))}`
        : [];
      return one([...L`${P(e.p)} took ${[{ c: e.r, n: count(e.from) }]} with Monopoly`, ...detail]);
    }
    case 'bank':
      return one(L`${P(e.p)} traded ${[{ c: e.give, n: e.n }]} to the bank for ${[{ c: e.get, n: 1 }]}`);
    case 'offer':
      return one(L`${P(e.offer.from)} offered ${C(e.offer.give)} for ${C(e.offer.want)}`);
    case 'trade':
      return one(L`${P(e.a)} gave ${P(e.b, 'obj')} ${C(e.give)} for ${C(e.want)}`);
    case 'longest':
      return one(
        e.p == null
          ? L`Nobody holds ${routeName(v)} now`
          : e.from != null
            ? L`${P(e.p)} took ${routeName(v)} (${e.n}) from ${P(e.from, 'obj')}`
            : L`${P(e.p)} took ${routeName(v)} (${e.n})`,
        { big: true },
      );
    case 'largest':
      return one(
        e.from != null
          ? L`${P(e.p)} took Largest Army (${e.n} knights) from ${P(e.from, 'obj')}`
          : L`${P(e.p)} took Largest Army (${e.n} knights)`,
        { big: true },
      );
    case 'win':
      return one(
        e.overtime
          ? L`${P(e.p)} won in overtime with ${e.vp} points!`
          : L`${P(e.p)} won with ${e.vp} points!`,
        { big: true },
      );
    case 'respond':
    case 'cancelOffer':
      return [];
    case 'moveShip':
      return one(L`${P(e.p)} moved a ship`);
    case 'pirate':
      return one(L`${P(e.p)} moved the ${W('pirate')}`);
    case 'goldOwed': {
      const who = Object.keys(e.owed).map(Number);
      return one(L`Gold! ${names(who)} ${who.length === 1 && who[0] !== v.me ? 'picks' : 'pick'} resources`);
    }
    case 'gold':
      return one(L`${P(e.p)} took ${C(e.got)} from a gold field`);
    case 'discover': {
      const what =
        e.t === 'sea' ? 'open sea' : e.t === 'gold' ? 'a gold field' : `${e.t}${e.n ? ` (${e.n})` : ''}`;
      return one(
        e.got ? L`${P(e.p)} discovered ${what} and got ${C(e.got)}` : L`${P(e.p)} discovered ${what}`,
      );
    }
    case 'islandBonus':
      return one(L`${P(e.p)} settled a new island: +${e.vp} points`, { big: true });
    /* Cities & Knights */
    case 'eventDie':
      return one(
        e.face === 'ship'
          ? L`Event die: the ${W('barbarian')} ship`
          : L`Event die: ${TRACK_LABEL[e.face].toLowerCase()} gate`,
      );
    case 'barbarians':
      return one(
        e.at >= 7 ? L`${W('The barbarians land!')}` : L`The ${W('barbarians')} sail closer (${e.at} of 7)`,
        { big: e.at >= 7 },
      );
    case 'attack': {
      const lost = e.losers.length === 1 && e.losers[0] !== v.me ? 'loses' : 'lose';
      return one(
        e.strength > e.defense
          ? [
              ...L`The ${W('barbarians')} (${e.strength}) beat the knights (${e.defense})`,
              ...(e.losers.length ? L`: ${names(e.losers)} ${lost} a city` : []),
            ]
          : [
              ...L`The knights (${e.defense}) drive off the ${W('barbarians')} (${e.strength})`,
              ...(e.defender != null
                ? L`: ${P(e.defender)} ${e.defender === v.me ? 'are' : 'is'} Defender of Catan (+1 point)`
                : e.tied.length
                  ? L`: ${names(e.tied)} each draw a progress card`
                  : []),
            ],
        { big: true, bad: e.strength > e.defense },
      );
    }
    case 'cityLost':
      return one(L`${P(e.p)} lost a city to the ${W('barbarians')}: it’s a settlement now`, {
        big: true,
        bad: true,
      });
    case 'draw': {
      const vp = e.card === 'printer' || e.card === 'constitution';
      return one(
        e.card
          ? L`${P(e.p)} drew ${PROGRESS_LABEL[e.card]}${vp ? ' (+1 point)' : ''}`
          : L`${P(e.p)} drew a ${TRACK_LABEL[e.track].toLowerCase()} card`,
        { big: vp },
      );
    }
    case 'commodities':
      return [
        ...Object.entries(e.gains).map(([p, g]) => ({ parts: L`${P(Number(p))} got ${C(g)}` })),
        ...shortLines(e.short ?? [], e.gains),
      ];
    case 'improve':
      return one(L`${P(e.p)} raised ${TRACK_LABEL[e.track].toLowerCase()} to level ${e.lvl}`);
    case 'metropolis': {
      const t = TRACK_LABEL[e.track].toLowerCase();
      return one(
        e.from != null
          ? L`${P(e.p)} took the ${t} metropolis from ${P(e.from, 'obj')}`
          : L`${P(e.p)} built the ${t} metropolis`,
        { big: true },
      );
    }
    case 'wall':
      return one(L`${P(e.p)} built a city wall${e.free ? ' (free)' : ''}`);
    case 'knight':
      return one(L`${P(e.p)} built a knight`);
    case 'promote':
      return one(
        L`${P(e.p)} promoted a knight to ${['', 'basic', 'strong', 'mighty'][e.lvl]!}${e.free ? ' (free)' : ''}`,
      );
    case 'activate':
      return one(L`${P(e.p)} activated a knight`);
    case 'activateAll':
      return one(L`${P(e.p)} activated ${e.n} knight${e.n === 1 ? '' : 's'}`);
    case 'moveKnight':
      return one(
        e.displaced != null
          ? L`${P(e.p, 'poss')} knight chased away ${P(e.displaced, 'possMid')} knight`
          : L`${P(e.p)} moved a knight`,
      );
    case 'relocate':
      return one(
        e.to == null
          ? L`${P(e.p, 'poss')} knight had nowhere to go and went home`
          : L`${P(e.p)} placed a knight`,
      );
    case 'knightRemoved':
      return one(L`${P(e.p)} lost a knight`);
    case 'chase':
      return one(L`${P(e.p, 'poss')} knight chased the ${W('robber')}`);
    case 'progress':
      return one(L`${P(e.p)} played ${PROGRESS_LABEL[e.card]}`, { big: true });
    case 'progressBack':
      return one(L`${P(e.p)} put a ${TRACK_LABEL[e.track].toLowerCase()} card back`);
    case 'aqueduct':
      return one(L`${P(e.p)} took ${[{ c: e.r, n: 1 }]} (aqueduct)`);
    case 'give':
      return one(
        e.cards
          ? L`${P(e.from)} gave ${P(e.to, 'obj')} ${C(e.cards)}`
          : L`${P(e.from)} gave ${P(e.to, 'obj')} ${[{ hidden: e.n }]}`,
      );
    case 'spy':
      return one(
        e.card
          ? L`${P(e.p)} took ${PROGRESS_LABEL[e.card]} from ${P(e.from, 'obj')}`
          : L`${P(e.p)} took a ${TRACK_LABEL[e.track].toLowerCase()} card from ${P(e.from, 'obj')}`,
      );
    case 'merchant':
      return one(L`${P(e.p)} placed the merchant on ${tile(v, e.h)}`);
    case 'inventor':
      return one(L`${P(e.p)} swapped two number tokens`);
    case 'gain':
      return one(
        e.from
          ? L`${P(e.p)} took ${C(e.cards)} from everyone`
          : L`${P(e.p)} took ${C(e.cards)} from the bank`,
      );
    case 'roadRemoved':
      return one(
        e.p === e.by ? L`${P(e.by)} removed their own road` : L`${P(e.by)} removed ${P(e.p, 'possMid')} road`,
      );
    case 'owe':
      return [];
    case 'askBack':
      return one(L`${P(e.p)} asked for the dice back`, { big: true });
    case 'handBack':
      return one(L`${P(e.p)} handed the dice back to ${P(e.to, 'obj')}`, { big: true });
    case 'refuseBack':
      return one(L`${P(e.p)} kept the dice`);
    case 'askUndo':
      return one(L`${P(e.p)} asked to undo their last move`);
    case 'answerUndo':
      return one(e.yes ? L`${P(e.p)} agreed to the undo` : L`${P(e.p)} said no to the undo`);
    case 'cancelUndo':
      return one(L`${P(e.p)} withdrew the undo request`);
    case 'undo':
      return one(L`${P(e.p, 'poss')} last move was undone`, { big: true });
    case 'rule':
      return one(L`${P(e.p)} ${ruleText(e.rule, e.value)}`, { big: true });
    case 'askKeep':
      return one(L`${P(e.p)} asked to keep playing, first to ${e.target} points`);
    case 'answerKeep':
      return one(e.yes ? L`${P(e.p)} wants to keep playing` : L`${P(e.p)} would rather stop`);
    case 'cancelKeep':
      return one(L`${P(e.p)} withdrew the request to keep playing`);
    case 'keepPlaying':
      return one(L`Keep playing! First to ${e.target} points wins in overtime`, { big: true });
  }
}

/**
 * SPEC 8.1: a limited bank that couldn't pay a roll. Nobody gets that card, unless only one
 * player was owed it: they get what was left.
 */
function shortLines(cards: readonly Card[], gains: Record<number, Partial<Record<Card, number>>>): Line[] {
  return cards.map((c) => {
    const name = CARD_LABEL[c];
    const got = Object.keys(gains).find((p) => gains[Number(p)]![c]);
    return {
      parts:
        got != null
          ? L`The bank ran out of ${name}: ${P(Number(got))} got what was left`
          : L`The bank is out of ${name}: nobody gets ${name} this roll`,
      bad: true,
    };
  });
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
