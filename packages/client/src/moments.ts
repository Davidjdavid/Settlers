/*
 * Big moments (SPEC 13.4): what just happened, as short cards across the top of the board, and
 * the recap at the end of each round. Worked out only from what this screen was sent (the log's
 * events and the views before and after), so nothing secret shows. Pure, so it can be tested.
 */

import { isLogNote, type GameEvent, type PlayerView, type Seat } from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { CARD_LABEL, DEV_LABEL, PROGRESS_LABEL } from './art';
import { RULE_HELP } from './help';
import { RULE_LABEL, TREASURE_LABEL, nameOf, routeName } from './text';

/** How much to show: everything, big moments only, or nothing. */
export type MomentLevel = 'all' | 'big' | 'off';

export interface Moment {
  kind: string;
  title: string;
  detail?: string;
  /** Whose moment it is (for their colour). */
  seat?: Seat;
  big: boolean;
}

/** A player's points as this screen knows them: your own hidden points count only for you. */
export const pointsOf = (v: PlayerView, p: Seat) =>
  p === v.me && v.hand ? v.hand.totalVP : (v.players[p]?.publicVP ?? 0);

/** The first sentence of a rule's explanation. */
const firstSentence = (s: string) => s.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? s;

/** "is" or "are" after a name ("You are", "Ann is"). */
const is = (v: PlayerView, p: Seat) => (p === v.me ? 'are' : 'is');

/** Moments for one batch of new log items (one update from the server). */
export function momentsFor(
  items: readonly LogItem[],
  before: PlayerView | null,
  after: PlayerView | null,
): Moment[] {
  if (!after || after.phase !== 'play' || !before) return [];
  const v = after;
  const N = (p: Seat | null) => nameOf(v, p);
  const out: Moment[] = [];
  const events: GameEvent[] = [];
  for (const it of items) if (it.k === 'ev' && !isLogNote(it.e)) events.push(it.e);
  // A move undone or the dice handed back: the game went back; nothing new to celebrate.
  const back = events.find((e) => e.k === 'undo' || e.k === 'handBack');
  if (back) {
    if (back.k === 'undo' && back.turn)
      out.push({
        kind: 'undo',
        title: `${N(back.p)}${back.p === v.me ? 'r' : '’s'} turn was undone`,
        detail: 'Back to just after the roll.',
        seat: back.p,
        big: true,
      });
    return out;
  }
  // What earned each player points in this batch.
  const why = new Map<Seat, string[]>();
  const because = (p: Seat, w: string) => why.set(p, [...(why.get(p) ?? []), w]);
  for (const e of events) {
    switch (e.k) {
      case 'build':
        if (e.what === 'settlement' || e.what === 'city') because(e.p, `built a ${e.what}`);
        break;
      case 'longest':
        if (e.p != null) {
          because(e.p, `took ${routeName(v)}`);
          out.push({
            kind: 'award',
            title: `${N(e.p)} took ${routeName(v)}`,
            detail: e.from != null ? `${e.n} long, from ${N(e.from).replace(/^You$/, 'you')}` : `${e.n} long`,
            seat: e.p,
            big: true,
          });
        } else out.push({ kind: 'award', title: `Nobody holds ${routeName(v)} now`, big: true });
        break;
      case 'largest':
        because(e.p, 'took Largest Army');
        out.push({
          kind: 'award',
          title: `${N(e.p)} took Largest Army`,
          detail:
            e.from != null ? `${e.n} knights, from ${N(e.from).replace(/^You$/, 'you')}` : `${e.n} knights`,
          seat: e.p,
          big: true,
        });
        break;
      case 'rule': {
        const label = RULE_LABEL[e.rule];
        const title =
          e.rule === 'winVP'
            ? `${N(e.p)} set points to win to ${e.value}`
            : typeof e.value === 'boolean'
              ? `${N(e.p)} turned ${e.value ? 'on' : 'off'} “${label}”`
              : `${N(e.p)} changed “${label}”`;
        out.push({ kind: 'rule', title, detail: firstSentence(RULE_HELP[e.rule]), seat: e.p, big: true });
        break;
      }
      case 'playDev':
        if (e.card !== 'mono')
          out.push({ kind: 'card', title: `${N(e.p)} played ${DEV_LABEL[e.card]}`, seat: e.p, big: true });
        break;
      case 'mono': {
        const n = Object.values(e.from).reduce((a, b) => a + b, 0);
        out.push({
          kind: 'card',
          title: `${N(e.p)} played Monopoly`,
          detail: `and took ${n} ${CARD_LABEL[e.r]} from everyone`,
          seat: e.p,
          big: true,
        });
        break;
      }
      case 'progress':
        out.push({ kind: 'card', title: `${N(e.p)} played ${PROGRESS_LABEL[e.card]}`, seat: e.p, big: true });
        break;
      case 'steal': {
        const mine = e.p === v.me || e.from === v.me;
        out.push({
          kind: 'steal',
          title: `${N(e.p)} stole ${e.r ? `1 ${CARD_LABEL[e.r]}` : 'a card'} from ${N(e.from).replace(/^You$/, 'you')}`,
          seat: e.p,
          big: mine,
        });
        break;
      }
      case 'discover':
        out.push({
          kind: 'fog',
          title: `${N(e.p)} uncovered the fog`,
          detail: e.t === 'sea' ? 'Open sea.' : `It’s ${e.t}${e.n ? ` ${e.n}` : ''}.`,
          seat: e.p,
          big: true,
        });
        break;
      case 'treasure':
        out.push({
          kind: 'treasure',
          title: `${N(e.p)} found a treasure`,
          detail: TREASURE_LABEL[e.kind],
          seat: e.p,
          big: true,
        });
        break;
      case 'roll':
        if (!e.redo && e.d[0] + e.d[1] === 7)
          out.push({
            kind: 'seven',
            title: `${N(e.p)} rolled a 7`,
            detail: 'The robber moves.',
            seat: e.p,
            big: false,
          });
        break;
      case 'trade':
        out.push({
          kind: 'trade',
          title: `${N(e.a)} traded with ${N(e.b).replace(/^You$/, 'you')}`,
          seat: e.a,
          big: false,
        });
        break;
      case 'buyDev':
        out.push({ kind: 'buy', title: `${N(e.p)} bought a development card`, seat: e.p, big: false });
        break;
    }
  }
  // Points: who gained, why, and their new total.
  const leaderOf = (x: PlayerView) => {
    const pts = x.players.map((_, p) => pointsOf(x, p));
    const top = Math.max(...pts);
    const at = pts.flatMap((n, p) => (n === top ? [p] : []));
    return at.length === 1 ? at[0]! : null;
  };
  v.players.forEach((_, p) => {
    const was = pointsOf(before, p);
    const now = pointsOf(v, p);
    if (now <= was) return;
    const reasons = (why.get(p) ?? []).filter((r) => !r.startsWith('took'));
    // An award already has its own moment.
    if (!reasons.length && why.get(p)?.length) return;
    out.push({
      kind: 'points',
      title: reasons.length
        ? `${N(p)} ${reasons.join(' and ')}`
        : `${N(p)} gained ${now - was} point${now - was === 1 ? '' : 's'}`,
      detail: `${now} point${now === 1 ? '' : 's'}`,
      seat: p,
      big: true,
    });
  });
  const lead0 = leaderOf(before);
  const lead1 = leaderOf(v);
  if (lead1 != null && lead1 !== lead0)
    out.push({
      kind: 'lead',
      title: `${N(lead1)} ${lead1 === v.me ? 'take' : 'takes'} the lead`,
      detail: `${pointsOf(v, lead1)} points`,
      seat: lead1,
      big: true,
    });
  // Close to winning (public points; your own hidden points only on your screen).
  v.players.forEach((_, p) => {
    const left = (x: PlayerView) => x.winVP - pointsOf(x, p);
    const now = left(v);
    if (now > 0 && now <= 2 && left(before) > now)
      out.push({
        kind: 'close',
        title: `${N(p)} ${is(v, p)} ${now} point${now === 1 ? '' : 's'} from winning`,
        seat: p,
        big: true,
      });
  });
  return out;
}

/** Which moments to show at a level. */
export const shown = (ms: readonly Moment[], level: MomentLevel) =>
  level === 'off' ? [] : level === 'all' ? ms.slice() : ms.filter((m) => m.big);

/** The round a turn number is in (turn 1 is the first after the starting placements). */
export const roundOf = (turnN: number, players: number) => (turnN < 1 ? 0 : Math.ceil(turnN / players));

/**
 * The recap at the end of a round: points gained by each player since `start` and the awards that
 * changed hands. Null when nothing changed.
 */
export function recapFor(
  round: number,
  start: readonly number[],
  v: PlayerView,
  awards: readonly string[],
): Moment | null {
  const gains = v.players
    .map((_, p) => ({ p, d: pointsOf(v, p) - (start[p] ?? 0) }))
    .filter((x) => x.d > 0)
    .sort((a, b) => b.d - a.d || a.p - b.p);
  if (!gains.length && !awards.length) return null;
  const parts = gains.map((x) => `${nameOf(v, x.p)} +${x.d}`);
  return { kind: 'recap', title: `Round ${round}`, detail: [...parts, ...awards].join(' · '), big: true };
}

/** Places for the scoreboard: 1 for the most points, ties sharing a place. */
export function placesOf(points: readonly number[]): number[] {
  return points.map((n) => 1 + points.filter((m) => m > n).length);
}

/** "1st", "2nd", "3rd", "4th". */
export const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** The award changes in a batch, worded for the recap ("Longest Road to Bob"). */
export function awardNotes(items: readonly LogItem[], v: PlayerView): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.k !== 'ev' || isLogNote(it.e)) continue;
    const e = it.e;
    if (e.k === 'longest' && e.p != null) out.push(`${routeName(v)} to ${nameOf(v, e.p)}`);
    if (e.k === 'largest') out.push(`Largest Army to ${nameOf(v, e.p)}`);
  }
  return out;
}
