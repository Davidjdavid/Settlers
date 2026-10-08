/*
 * What the new screen (docs/isle.md) tells you without the log: the race to the target, the last
 * rolls, the roll just made, and what each player did since your last turn. Worked out only from
 * what this screen was sent (its log and its view), so nothing secret shows. Pure, so it can be
 * tested.
 */

import {
  COMS,
  RES,
  isLogNote,
  robberAwake,
  stateFromView,
  type Card,
  type Cards,
  type GameEvent,
  type Owe,
  type PlayerView,
  type Seat,
  type Track,
} from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { CARD_LABEL, DEV_LABEL, PROGRESS_LABEL, RES_LABEL, TRACK_LABEL } from '../art';
import { RULE_HELP } from '../help';
import { RULE_LABEL, nameOf, routeName } from '../text';

export type EventFace = 'ship' | Track;

/* ---------- The race (docs/isle.md 5) ---------- */

/** A player's points as this screen knows them: your own hidden points count only for you. */
export const pointsOf = (v: PlayerView, p: Seat) =>
  p === v.me && v.hand ? v.hand.totalVP : v.players[p]!.publicVP + (v.players[p]!.vpCards ?? 0);

export interface Racer {
  p: Seat;
  pts: number;
  /** 1 for the leader; ties share a place. */
  place: number;
  /** Alone in front (a tie for first has no leader). */
  lead: boolean;
  /** Two points or less from winning. */
  near: boolean;
}

export function race(v: PlayerView): Racer[] {
  const pts = v.players.map((_, p) => pointsOf(v, p));
  const top = Math.max(...pts);
  const leaders = pts.filter((x) => x === top).length;
  return pts.map((x, p) => ({
    p,
    pts: x,
    place: 1 + pts.filter((y) => y > x).length,
    lead: x === top && leaders === 1 && x > 0,
    near: x >= v.winVP - 2,
  }));
}

/* ---------- The log, as moves and turns ---------- */

/** A move's events (one action), in order. */
interface Move {
  seq: number;
  evs: GameEvent[];
}
/** A turn: whose, and its moves. `p` is null for the starting placements. */
interface Turn {
  p: Seat | null;
  moves: Move[];
}

/** Moves that only talk about the game: an undo never takes them back. */
const TALK = new Set<GameEvent['k']>([
  'askUndo',
  'answerUndo',
  'cancelUndo',
  'rule',
  'askBack',
  'refuseBack',
  'offer',
  'respond',
  'cancelOffer',
  'askKeep',
  'answerKeep',
  'cancelKeep',
]);
/** What a roll sets off before the turn's main part (where "Undo my turn" goes back to). */
const AFTER_ROLL = new Set<GameEvent['k']>([
  'roll',
  'produce',
  'commodities',
  'eventDie',
  'barbarians',
  'attack',
  'cityLost',
  'draw',
  'owe',
  'mustDiscard',
  'discard',
  'robber',
  'pirate',
  'steal',
  'goldOwed',
  'gold',
  'deckShuffled',
  'longest',
  'metropolis',
  'relocate',
  'knightRemoved',
  'aqueduct',
  'progressBack',
]);

/**
 * The game's turns from the log, with undone moves taken out: an undo takes back the last real
 * move, "Undo my turn" everything after the roll and what it set off, and handing the dice back
 * the turn that had just begun.
 */
function turnsOf(log: readonly LogItem[]): Turn[] {
  const turns: Turn[] = [{ p: null, moves: [] }];
  let seq = -1;
  const cur = () => turns[turns.length - 1]!;
  for (const it of log) {
    if (it.k !== 'ev' || isLogNote(it.e)) continue;
    const e = it.e;
    if (e.k === 'turn') {
      turns.push({ p: e.p, moves: [] });
      seq = -1;
      continue;
    }
    if (e.k === 'handBack') {
      if (turns.length > 1) turns.pop();
      seq = -1;
      continue;
    }
    if (e.k === 'undo') {
      const ms = cur().moves;
      if (e.turn) {
        const roll = ms.findIndex((m) => m.evs.some((x) => x.k === 'roll'));
        let keep = roll + 1;
        while (keep < ms.length && ms[keep]!.evs.every((x) => AFTER_ROLL.has(x.k) || TALK.has(x.k))) keep++;
        cur().moves = [
          ...ms.slice(0, keep),
          ...ms.slice(keep).filter((m) => m.evs.every((x) => TALK.has(x.k))),
        ];
      } else
        for (let i = ms.length - 1; i >= 0; i--)
          if (ms[i]!.evs.some((x) => !TALK.has(x.k))) {
            ms.splice(i, 1);
            break;
          }
      seq = -1;
      continue;
    }
    if (it.seq !== seq) cur().moves.push({ seq: it.seq, evs: [] });
    seq = it.seq;
    cur().moves[cur().moves.length - 1]!.evs.push(e);
  }
  return turns;
}

/* ---------- Rolls (docs/isle.md 6) ---------- */

export interface Roll {
  p: Seat;
  d: [number, number];
  /** The event die (Knights). */
  e?: EventFace;
  seq: number;
}

/** A move's roll: the dice that counted (a 7 rolled again isn't one), with the event die. */
function rollIn(evs: readonly GameEvent[], seq: number): Roll | null {
  const r = [...evs].reverse().find((x): x is Extract<GameEvent, { k: 'roll' }> => x.k === 'roll' && !x.redo);
  if (!r) return null;
  const e = evs.find((x): x is Extract<GameEvent, { k: 'eventDie' }> => x.k === 'eventDie');
  return { p: r.p, d: r.d, seq, ...(e ? { e: e.face } : {}) };
}

/** The last `n` rolls, newest first. */
export function lastRolls(log: readonly LogItem[], n: number): Roll[] {
  const out: Roll[] = [];
  const bySeq = new Map<number, GameEvent[]>();
  for (const it of log) {
    if (it.k !== 'ev' || isLogNote(it.e)) continue;
    bySeq.set(it.seq, [...(bySeq.get(it.seq) ?? []), it.e]);
  }
  for (const [seq, evs] of [...bySeq].reverse()) {
    const r = rollIn(evs, seq);
    if (r) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** A roll as it's announced: who rolled what, and who got what from it. */
export interface RollNews extends Roll {
  sum: number;
  /** Cards each player got (you first, then in seat order); gold to pick counts too. */
  got: { p: Seat; cards: Cards; gold?: number }[];
  /** A 7 rolled again first (no 7s yet). */
  redo: boolean;
  /** A 7: whether the robber moves (Knights: not before the first attack), and who discards. */
  seven: { robber: boolean; discard: Seat[] } | null;
}

/** The roll in a batch of new log items, if there is one. */
export function rollNews(items: readonly LogItem[], v: PlayerView): RollNews | null {
  const evs = items.flatMap((it) => (it.k === 'ev' && !isLogNote(it.e) ? [{ seq: it.seq, e: it.e }] : []));
  const at = evs.findLastIndex((x) => x.e.k === 'roll' && !x.e.redo);
  if (at < 0) return null;
  const seq = evs[at]!.seq;
  const same = evs.filter((x) => x.seq === seq).map((x) => x.e);
  const roll = rollIn(same, seq)!;
  const got = new Map<Seat, { cards: Cards; gold?: number }>();
  const add = (p: Seat, c: Cards) => {
    const g = got.get(p) ?? { cards: {} };
    for (const [k, n] of Object.entries(c)) if (n) g.cards[k as Card] = (g.cards[k as Card] ?? 0) + n;
    got.set(p, g);
  };
  for (const e of same) {
    if (e.k === 'produce' || e.k === 'commodities')
      for (const [p, c] of Object.entries(e.gains)) add(Number(p), c as Cards);
    if (e.k === 'goldOwed')
      for (const [p, n] of Object.entries(e.owed)) {
        const g = got.get(Number(p)) ?? { cards: {} };
        got.set(Number(p), { ...g, gold: (g.gold ?? 0) + n });
      }
  }
  const order = [...got.keys()].sort((a, b) => (a === v.me ? -1 : b === v.me ? 1 : a - b));
  const sum = roll.d[0] + roll.d[1];
  const must = same.find((e): e is Extract<GameEvent, { k: 'mustDiscard' }> => e.k === 'mustDiscard');
  return {
    ...roll,
    sum,
    got: order.map((p) => ({ p, ...got.get(p)! })),
    redo: same.some((e) => e.k === 'roll' && e.redo),
    seven:
      sum === 7
        ? { robber: robberAwake(stateFromView(v)), discard: must ? Object.keys(must.need).map(Number) : [] }
        : null,
  };
}

/* ---------- What players did (docs/isle.md 6, 7) ---------- */

/** "a road", "2 roads". */
const count = (n: number, one: string, many = `${one}s`) => (n === 1 ? `a ${one}` : `${n} ${many}`);
/** "a, b and c". */
export const andList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const PIECE: Record<string, [string, string?]> = {
  road: ['road'],
  ship: ['ship'],
  settlement: ['settlement'],
  city: ['city', 'cities'],
};
const cardsWord = (c: Cards) =>
  ([...RES, ...COMS] as Card[])
    .filter((k) => (c[k] ?? 0) > 0)
    .map((k) => `${c[k]} ${CARD_LABEL[k]}`)
    .join(', ');
/** A tile in words: "Wheat 8", "the desert". */
function tileName(v: PlayerView, h: number): string {
  const x = v.board.hexes[h];
  if (!x) return 'a tile';
  if (x.t in RES_LABEL) return `${RES_LABEL[x.t as keyof typeof RES_LABEL]} ${x.n}`;
  return x.t === 'gold' ? `the gold field ${x.n}` : `the ${x.t}`;
}
/** "you" for you, the name for anyone else, mid-sentence. */
const obj = (v: PlayerView, p: Seat | null) => (p === v.me ? 'you' : nameOf(v, p));

/**
 * What one player did in some events, as short phrases without their name ("built a city and 2
 * roads", "stole from you"): for the seat bubbles and each turn of the recap.
 */
export function didOf(v: PlayerView, p: Seat, evs: readonly GameEvent[]): string[] {
  const out: string[] = [];
  const built = new Map<string, number>();
  let devs = 0;
  let bank = false;
  const tradedWith: Seat[] = [];
  for (const e of evs) {
    switch (e.k) {
      case 'build':
        if (e.p === p) built.set(e.what, (built.get(e.what) ?? 0) + 1);
        break;
      case 'wall':
        if (e.p === p) built.set('wall', (built.get('wall') ?? 0) + 1);
        break;
      case 'knight':
        if (e.p === p) built.set('knight', (built.get('knight') ?? 0) + 1);
        break;
      case 'buyDev':
        if (e.p === p) devs++;
        break;
      case 'playDev':
        if (e.p === p && e.card !== 'mono') out.push(`played ${DEV_LABEL[e.card]}`);
        break;
      case 'mono':
        if (e.p === p) {
          const n = Object.values(e.from).reduce((a, b) => a + b, 0);
          const mine = v.me != null ? (e.from[v.me] ?? 0) : 0;
          out.push(`played Monopoly on ${CARD_LABEL[e.r]} (took ${n}${mine ? `, ${mine} from you` : ''})`);
        }
        break;
      case 'progress':
        if (e.p === p) out.push(`played ${PROGRESS_LABEL[e.card]}`);
        break;
      case 'robber':
        if (e.p === p) out.push(`moved the robber to ${tileName(v, e.h)}`);
        break;
      case 'pirate':
        if (e.p === p) out.push('moved the pirate');
        break;
      case 'steal':
        if (e.p === p)
          out.push(
            e.from === v.me && e.r
              ? `stole 1 ${CARD_LABEL[e.r]} from you`
              : `stole a card from ${obj(v, e.from)}`,
          );
        break;
      case 'bank':
        if (e.p === p) bank = true;
        break;
      case 'trade':
        if (e.a === p && !tradedWith.includes(e.b)) tradedWith.push(e.b);
        else if (e.b === p && !tradedWith.includes(e.a)) tradedWith.push(e.a);
        break;
      case 'longest':
        if (e.p === p) out.push(`took ${routeName(v)}${e.from != null ? ` from ${obj(v, e.from)}` : ''}`);
        break;
      case 'largest':
        if (e.p === p) out.push(`took Largest Army${e.from != null ? ` from ${obj(v, e.from)}` : ''}`);
        break;
      case 'moveShip':
        if (e.p === p) out.push('moved a ship');
        break;
      case 'discover':
        if (e.p === p) out.push('uncovered the fog');
        break;
      case 'islandBonus':
        if (e.p === p) out.push(`reached a new island (+${e.vp})`);
        break;
      case 'treasure':
        if (e.p === p) out.push('found a treasure');
        break;
      case 'improve':
        if (e.p === p) out.push(`raised ${TRACK_LABEL[e.track]} to ${e.lvl}`);
        break;
      case 'metropolis':
        if (e.p === p) out.push(`got the ${TRACK_LABEL[e.track]} metropolis`);
        break;
      case 'promote':
        if (e.p === p) out.push('promoted a knight');
        break;
      case 'activate':
      case 'activateAll':
        if (e.p === p && !out.includes('activated knights')) out.push('activated knights');
        break;
      case 'moveKnight':
        if (e.p === p) out.push('moved a knight');
        break;
      case 'chase':
        if (e.p === p) out.push('chased the robber away');
        break;
      case 'discard':
        if (e.p === p) out.push(`discarded ${Object.values(e.c).reduce((a, b) => a + (b ?? 0), 0)}`);
        break;
      case 'cityLost':
        if (e.p === p) out.push('lost a city to the barbarians');
        break;
      case 'win':
        if (e.p === p) out.push('won!');
        break;
    }
  }
  const pieces = [...built].map(([k, n]) =>
    k === 'wall'
      ? count(n, 'city wall')
      : k === 'knight'
        ? count(n, 'knight')
        : count(n, PIECE[k]?.[0] ?? k, PIECE[k]?.[1]),
  );
  // Settlements and cities first: they score.
  pieces.sort((a, b) => Number(/road|ship|wall|knight/.test(a)) - Number(/road|ship|wall|knight/.test(b)));
  const head: string[] = [];
  if (pieces.length) head.push(`built ${andList(pieces)}`);
  if (devs) head.push(`bought ${count(devs, 'development card')}`);
  if (tradedWith.length) head.push(`traded with ${andList(tradedWith.map((x) => obj(v, x)))}`);
  if (bank) head.push('traded with the bank');
  return [...head, ...out];
}

/* ---------- Since your last turn (docs/isle.md 7) ---------- */

export interface TurnRecap {
  p: Seat;
  roll: Roll | null;
  /** Cards you got and lost in this turn. */
  got: Cards;
  lost: Cards;
  /** What they did. */
  did: string[];
  /** Other things everyone should know: someone else discarding, the barbarians, a rule. */
  news: string[];
}

const addTo = (to: Cards, c: Cards | null | undefined, times = 1) => {
  for (const [k, n] of Object.entries(c ?? {})) if (n) to[k as Card] = (to[k as Card] ?? 0) + n * times;
};

function recapOf(v: PlayerView, t: Turn & { p: Seat }): TurnRecap {
  const me = v.me;
  const evs = t.moves.flatMap((m) => m.evs);
  const got: Cards = {};
  const lost: Cards = {};
  const news: string[] = [];
  let roll: Roll | null = null;
  for (const m of t.moves) roll ??= rollIn(m.evs, m.seq);
  for (const e of evs) {
    switch (e.k) {
      case 'produce':
      case 'commodities':
        if (me != null) addTo(got, e.gains[me] as Cards | undefined);
        break;
      case 'gold':
      case 'treasureGot':
        if (e.p === me) addTo(got, e.got as Cards);
        break;
      case 'aqueduct':
        if (e.p === me) addTo(got, { [e.r]: 1 });
        break;
      case 'trade':
        if (e.a === me) {
          addTo(lost, e.give as Cards);
          addTo(got, e.want as Cards);
        } else if (e.b === me) {
          addTo(lost, e.want as Cards);
          addTo(got, e.give as Cards);
        }
        break;
      case 'steal':
        if (e.from === me && e.r) addTo(lost, { [e.r]: 1 });
        break;
      case 'mono':
        if (me != null && e.from[me]) addTo(lost, { [e.r]: e.from[me] });
        break;
      case 'discard':
        if (e.p === me) addTo(lost, e.c as Cards);
        else if (e.p !== t.p)
          news.push(`${nameOf(v, e.p)} discarded ${Object.values(e.c).reduce((a, b) => a + (b ?? 0), 0)}`);
        break;
      case 'give':
        if (e.to === me) addTo(got, e.cards);
        if (e.from === me) addTo(lost, e.cards);
        break;
      case 'gain':
        // Resource or Trade Monopoly: one kind, so many from each player.
        if (me != null && e.from?.[me]) addTo(lost, { [Object.keys(e.cards)[0]!]: e.from[me] });
        break;
      case 'attack':
        news.push(
          e.losers.length
            ? `The barbarians won: ${andList(e.losers.map((p) => (p === me ? 'you' : nameOf(v, p))))} lost a city`
            : e.defender != null
              ? `The barbarians lost; ${nameOf(v, e.defender)} defended Catan`
              : 'The barbarians lost',
        );
        break;
      case 'rule':
        news.push(`${nameOf(v, e.p)} changed “${RULE_LABEL[e.rule]}”`);
        break;
      case 'keepPlaying':
        news.push(`Everyone kept playing, to ${e.target} points`);
        break;
    }
  }
  return { p: t.p, roll, got, lost, did: didOf(v, t.p, evs), news };
}

/**
 * Every other player's turn since your last one, oldest first. On your turn: the turns between
 * your last turn and this one. Otherwise: the turns since yours, the one being played included.
 * Before your first turn: every turn so far. At most `max`, the latest.
 */
export function recapSince(log: readonly LogItem[], v: PlayerView, max = 8): TurnRecap[] {
  if (v.me == null) return [];
  const turns = turnsOf(log).filter((t): t is Turn & { p: Seat } => t.p != null);
  const last = turns.length - 1;
  const mineNow = v.phase === 'play' && v.turn === v.me && turns[last]?.p === v.me;
  const end = mineNow ? last : turns.length;
  let from = 0;
  for (let i = end - 1; i >= 0; i--)
    if (turns[i]!.p === v.me) {
      from = i + 1;
      break;
    }
  return turns
    .slice(from, end)
    .slice(-max)
    .map((t) => recapOf(v, t));
}

/**
 * What each other player did since your last turn, for the bubble by their seat: their latest turn
 * in `recapSince`, in words ("traded with the bank and built a road"). Turns where they did
 * nothing but roll leave no bubble.
 */
export function sinceYourTurn(log: readonly LogItem[], v: PlayerView): Partial<Record<Seat, string>> {
  const out: Partial<Record<Seat, string>> = {};
  for (const t of recapSince(log, v, Infinity))
    if (t.did.length) out[t.p] = andList(t.did);
    else delete out[t.p];
  return out;
}

/** Cards in words: "2 Wheat, 1 Ore". */
export const cardsLine = cardsWord;

/* ---------- The awards shelf (docs/isle.md 14) ---------- */

export interface Award {
  key: 'longest' | 'largest' | Track;
  label: string;
  /** Who holds it now (from the view). */
  holder: Seat | null;
  /** Who got it first and on which turn, when the log goes back that far. */
  first?: { p: Seat; turn: number };
  /** The last change: who had it before and who got it (null: nobody), and on which turn. */
  last?: { from: Seat | null; to: Seat | null; turn: number };
}

/** Longest Road, Largest Army (not with Knights) and each metropolis, with their story. */
export function awards(v: PlayerView, log: readonly LogItem[]): Award[] {
  const out: Award[] = [{ key: 'longest', label: routeName(v), holder: v.longest }];
  if (!v.ck) out.push({ key: 'largest', label: 'Largest Army', holder: v.largest });
  else
    for (const t of ['science', 'trade', 'politics'] as const) {
      const at = v.ck.metro[t];
      out.push({
        key: t,
        label: `${TRACK_LABEL[t]} metropolis`,
        holder: at != null ? (v.verts[at]?.[0] ?? null) : null,
      });
    }
  const byKey = new Map(out.map((a) => [a.key, a]));
  // Whether the log goes back to the starting placements (the server sends the latest events
  // only), so "first" is really the first.
  const whole = log.some((it) => it.k === 'ev' && !isLogNote(it.e) && it.e.k === 'setup');
  // Turns are counted back from the current one: the log may not go back to the first.
  const turns = turnsOf(log);
  const real = turns.filter((t) => t.p != null).length;
  let ago = real;
  for (const t of turns) {
    if (t.p != null) ago--;
    const turn = Math.max(0, v.turnN - ago);
    for (const m of t.moves)
      for (const e of m.evs) {
        const a =
          e.k === 'longest' || e.k === 'largest'
            ? byKey.get(e.k)
            : e.k === 'metropolis'
              ? byKey.get(e.track)
              : undefined;
        if (!a || (e.k !== 'longest' && e.k !== 'largest' && e.k !== 'metropolis')) continue;
        if (e.p != null && !a.first && whole) a.first = { p: e.p, turn };
        a.last = { from: e.from, to: e.p, turn };
      }
  }
  return out;
}

/* ---------- Moments (docs/isle.md 6, 14) ---------- */

/** A big thing that just happened, shown across the top of the board (docs/isle.md 14). */
export interface MomentData {
  title: string;
  detail?: string;
  /** Whose moment it is (their colour and token). */
  seat?: Seat;
}

/** The big things in a batch of new log items (docs/isle.md 14: ranked by the cost of missing them). */
export function momentsIn(v: PlayerView, items: readonly LogItem[]): MomentData[] {
  const out: MomentData[] = [];
  const N = (p: Seat | null) => nameOf(v, p);
  const obj = (p: Seat | null) => (p === v.me ? 'you' : N(p));
  for (const it of items) {
    if (it.k !== 'ev' || isLogNote(it.e)) continue;
    const e: GameEvent = it.e;
    switch (e.k) {
      case 'longest':
        out.push(
          e.p != null
            ? {
                title: `${N(e.p)} took ${routeName(v)}`,
                detail: e.from != null ? `from ${obj(e.from)} · ${e.n} long` : `${e.n} long`,
                seat: e.p,
              }
            : {
                title: `Nobody holds ${routeName(v)} now`,
                ...(e.from != null ? { detail: `${N(e.from)} lost it` } : {}),
              },
        );
        break;
      case 'largest':
        out.push({
          title: `${N(e.p)} took Largest Army`,
          detail: e.from != null ? `from ${obj(e.from)} · ${e.n} knights` : `${e.n} knights`,
          seat: e.p,
        });
        break;
      case 'metropolis':
        out.push({
          title: `${N(e.p)} got the ${TRACK_LABEL[e.track]} metropolis`,
          detail: e.from != null ? `taken from ${obj(e.from)}` : 'a golden gate on a city: +2 points',
          seat: e.p,
        });
        break;
      case 'steal':
        if (e.from === v.me || e.p === v.me)
          out.push({
            title: `${N(e.p)} stole ${e.r ? `1 ${CARD_LABEL[e.r]}` : 'a card'} from ${obj(e.from)}`,
            seat: e.p,
          });
        break;
      case 'mono':
        out.push({
          title: `${N(e.p)} played Monopoly`,
          detail: `and took every ${CARD_LABEL[e.r]}`,
          seat: e.p,
        });
        break;
      case 'attack':
        out.push({
          title: e.losers.length ? 'The barbarians won' : 'The barbarians were beaten',
          detail: e.losers.length
            ? `${andList(e.losers.map(obj))} lost a city`
            : e.defender != null
              ? `${N(e.defender)} defended Catan`
              : `strength ${e.strength} against ${e.defense}`,
        });
        break;
      case 'rule': {
        // What it is now and what it means: the first sentence of its explanation.
        const now =
          e.rule === 'winVP'
            ? `now ${e.value} to win`
            : typeof e.value === 'boolean'
              ? e.value
                ? 'turned on'
                : 'turned off'
              : `now ${String(e.value)}`;
        const help = RULE_HELP[e.rule].match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? '';
        out.push({
          title: `${N(e.p)} changed “${RULE_LABEL[e.rule]}”: ${now}`,
          detail: e.rule === 'winVP' ? 'See Table rules in the menu' : help,
          seat: e.p,
        });
        break;
      }
      case 'undo':
        if (e.turn)
          out.push({
            title: `${N(e.p)}${e.p === v.me ? 'r' : '’s'} turn was undone`,
            detail: 'Back to just after the roll',
            seat: e.p,
          });
        break;
      case 'draw':
        // A progress card of yours: it's in your hand along the bottom (docs/isle.md 14).
        if (e.p === v.me)
          out.push({
            title: `You drew a ${TRACK_LABEL[e.track]} card${e.card ? `: ${PROGRESS_LABEL[e.card]}` : ''}`,
            detail: 'It’s with your cards, along the bottom',
            seat: e.p,
          });
        break;
      case 'discover':
        out.push({ title: `${N(e.p)} uncovered the fog`, seat: e.p });
        break;
      case 'treasure':
        out.push({ title: `${N(e.p)} found a treasure`, seat: e.p });
        break;
      case 'win':
        break;
    }
  }
  return out;
}

/* ---------- Who the game is waiting for, and why (docs/isle.md 4) ---------- */

/** One thing the game is waiting on: who, and what they're doing, in a few words. */
export interface Waiting {
  who: Seat[];
  /** "picking gold", "choosing a city to lose to the barbarians". */
  what: string;
}

const OWE_WAIT: Record<Owe['k'], (v: PlayerView, o: Owe) => string> = {
  loseCity: () => 'choosing a city to lose to the barbarians',
  defenderDraw: () => 'drawing a progress card for beating the barbarians',
  overflow: () => 'putting back a progress card (only 4 allowed)',
  aqueduct: () => 'picking a free resource (Aqueduct)',
  relocate: () => 'moving a knight that was chased away',
  desert: () => 'removing a knight (Deserter)',
  deserterPlace: () => 'placing a knight (Deserter)',
  give: (v, o) => `giving ${'n' in o ? o.n : ''} cards to ${obj(v, 'to' in o ? o.to : null)} (Wedding)`,
  discard: (_v, o) => `discarding ${'n' in o ? o.n : ''} cards (Saboteur)`,
  harbor: () => 'offering resources for commodities (Commercial Harbor)',
  harborGive: (v, o) => `giving ${obj(v, 'to' in o ? o.to : null)} a commodity (Commercial Harbor)`,
  take: (v, o) => `taking cards from ${obj(v, 'from' in o ? o.from : null)} (Master Merchant)`,
  spy: (v, o) => `taking a progress card from ${obj(v, 'from' in o ? o.from : null)} (Spy)`,
  rebuild: () => 'rebuilding a road (Diplomat)',
};

/**
 * Everything the game is waiting on right now, so nobody wonders whose turn it is or whether
 * it's stuck: a discard after a 7, gold, a treasure, the barbarians' choices, a progress card
 * over the limit, and the plain turn ("about to roll", "playing").
 */
export function waitingFor(v: PlayerView): Waiting[] {
  if (v.phase !== 'play') return [];
  const out: Waiting[] = [];
  const add = (p: Seat, what: string) => {
    const w = out.find((x) => x.what === what);
    if (w) {
      if (!w.who.includes(p)) w.who.push(p);
    } else out.push({ who: [p], what });
  };
  const sea = v.rules.modules.includes('seafarers');
  switch (v.stage) {
    case 'setup':
      add(v.turn, 'placing a starting settlement and road');
      break;
    case 'preroll':
      add(v.turn, v.ck ? 'about to roll (or play a card first, like the Alchemist)' : 'about to roll');
      break;
    case 'discard':
      for (const p of Object.keys(v.discard ?? {}).map(Number))
        add(p, `discarding ${v.discard![p]} cards (a 7 was rolled)`);
      break;
    case 'robber':
      add(v.turn, sea ? 'moving the robber or the pirate' : 'moving the robber');
      break;
    case 'roads':
      add(
        v.turn,
        `placing ${v.freeRoads} free ${sea ? 'roads or ships' : v.freeRoads === 1 ? 'road' : 'roads'}`,
      );
      break;
    case 'gold':
      for (const [p, n] of Object.entries(v.sea?.gold?.owed ?? {}))
        add(Number(p), `picking ${n} resource${n === 1 ? '' : 's'} from a gold field`);
      break;
    case 'treasure':
      for (const o of v.tr?.owe ?? [])
        add(
          o.p,
          o.k === 'deck'
            ? 'picking a progress deck for a treasure'
            : o.k === 'pick'
              ? `picking ${o.n} resource${o.n === 1 ? '' : 's'} for a treasure`
              : 'placing free roads and ships from a treasure',
        );
      break;
    case 'ck':
      for (const o of v.ck?.owe ?? []) add(o.p, OWE_WAIT[o.k](v, o));
      break;
    case 'main':
      add(v.turn, 'playing');
      break;
  }
  // Questions the table is answering (SPEC 4.4, 5.10, 13.2). An undo that could be asked for
  // (the last move's) waits on nobody until it is.
  if (v.undo?.asked)
    for (let p = 0; p < v.players.length; p++)
      if (p !== v.undo.p && !v.undo.ok.includes(p) && !v.players[p]!.cpu)
        add(p, `answering ${obj(v, v.undo.p)}${v.undo.p === v.me ? 'r' : '’s'} request to undo`);
  if (v.back?.asked && !v.back.refused)
    add(v.turn, `deciding whether to give the dice back to ${obj(v, v.back.from)}`);
  return out;
}
