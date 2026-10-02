/*
 * Hard's card counting (docs/bot-medium-hard.md §3.1-3.2), from public information only: the
 * CPU's own view and the events redacted for its seat. For every player it keeps a likely hand,
 * the expected number of each card. Steals it didn't see spread the card over the victim's
 * likely hand in proportion; after every move each guess is put back in line with the player's
 * public card count, so a missed detail can never pile up.
 */

import { COST, DEV_COUNTS } from '../queries';
import { ACTIVATE_COST, KNIGHT_COST, PROMOTE_COST, WALL_COST } from '../modules/citiesKnights';
import { SHIP_COST } from '../modules/seafarers';
import { COMS, RES, TRACK_COM, type Card, type GameEvent, type Seat } from '../types';
import type { PlayerView } from '../view';

/** Expected count of each card, per player. */
export type Guess = Record<string, number>[];

const kindsOf = (v: PlayerView): Card[] => (v.ck ? [...RES, ...COMS] : [...RES]);

export function newGuess(v: PlayerView): Guess {
  return v.players.map(() => ({}));
}

const add = (h: Record<string, number>, c: string, k: number) => (h[c] = (h[c] ?? 0) + k);

/** Take n cards of unknown kind from `from`, in proportion to its likely hand; returns what went. */
function spread(h: Record<string, number>, kinds: Card[], n: number): Record<string, number> {
  const tot = kinds.reduce((a, c) => a + Math.max(0, h[c] ?? 0), 0);
  const out: Record<string, number> = {};
  if (tot <= 0) return out;
  for (const c of kinds) {
    const share = (Math.max(0, h[c] ?? 0) / tot) * Math.min(n, tot);
    if (!share) continue;
    h[c] = (h[c] ?? 0) - share;
    out[c] = share;
  }
  return out;
}

/** Fold one move's events (as this seat saw them) into the guess. */
export function observe(guess: Guess, v: PlayerView, events: GameEvent[]): Guess {
  const kinds = kindsOf(v);
  const g = guess.length === v.players.length ? guess : newGuess(v);
  const gain = (p: Seat, cards: Partial<Record<string, number>> | null | undefined, sign = 1) => {
    if (!cards) return;
    for (const [c, k] of Object.entries(cards)) if (k) add(g[p]!, c, sign * k);
  };
  for (const e of events) {
    switch (e.k) {
      case 'setup':
        gain(e.p, e.got);
        break;
      case 'produce':
      case 'commodities':
        for (const [q, cards] of Object.entries(e.gains)) gain(Number(q), cards);
        break;
      case 'gold':
      case 'plenty':
        gain(e.p, e.got);
        break;
      case 'discover':
        gain(e.p, e.got);
        break;
      case 'aqueduct':
        add(g[e.p]!, e.r, 1);
        break;
      case 'discard':
        gain(e.p, e.c, -1);
        break;
      case 'steal':
        if (e.r) {
          add(g[e.from]!, e.r, -1);
          add(g[e.p]!, e.r, 1);
        } else gain(e.p, spread(g[e.from]!, kinds, 1));
        break;
      case 'mono':
        for (const [q, k] of Object.entries(e.from)) {
          add(g[Number(q)]!, e.r, -k);
          add(g[e.p]!, e.r, k);
        }
        break;
      case 'gain': {
        gain(e.p, e.cards);
        const types = Object.keys(e.cards);
        for (const [q, k] of Object.entries(e.from ?? {})) {
          if (types.length === 1) add(g[Number(q)]!, types[0]!, -k);
          else spread(g[Number(q)]!, kinds, k);
        }
        break;
      }
      case 'give':
        if (e.cards) {
          gain(e.from, e.cards, -1);
          gain(e.to, e.cards);
        } else gain(e.to, spread(g[e.from]!, kinds, e.n));
        break;
      case 'bank':
        add(g[e.p]!, e.give, -e.n);
        add(g[e.p]!, e.get, 1);
        break;
      case 'trade':
        gain(e.a, e.give, -1);
        gain(e.a, e.want);
        gain(e.b, e.want, -1);
        gain(e.b, e.give);
        break;
      case 'build':
        if (!e.free) gain(e.p, e.what === 'ship' ? SHIP_COST : COST[e.what], -1);
        break;
      case 'buyDev':
        gain(e.p, COST.dev, -1);
        break;
      case 'knight':
        gain(e.p, KNIGHT_COST, -1);
        break;
      case 'promote':
        if (!e.free) gain(e.p, PROMOTE_COST, -1);
        break;
      case 'activate':
        gain(e.p, ACTIVATE_COST, -1);
        break;
      case 'wall':
        if (!e.free) gain(e.p, WALL_COST, -1);
        break;
      case 'improve':
        add(g[e.p]!, TRACK_COM[e.track], -e.lvl);
        break;
      default:
        break;
    }
  }
  return reconcile(g, v);
}

/** Put every guess back in line with what the view shows: its own hand exactly, others' card counts. */
export function reconcile(g: Guess, v: PlayerView): Guess {
  const kinds = kindsOf(v);
  v.players.forEach((pl, q) => {
    const h = g[q]!;
    if (q === v.me && v.hand) {
      for (const c of kinds) h[c] = v.hand.res[c] ?? 0;
      return;
    }
    for (const c of kinds) if (!((h[c] ?? 0) > 0)) h[c] = 0;
    const tot = kinds.reduce((a, c) => a + h[c]!, 0);
    const want = pl.resCount;
    if (tot > want) for (const c of kinds) h[c] = (h[c]! * want) / tot;
    else if (tot < want) {
      // Cards it can't account for: spread over the resources (commodities only come from cities).
      const pool = RES as readonly Card[];
      for (const c of pool) h[c] = h[c]! + (want - tot) / pool.length;
    }
  });
  return g;
}

/** Development cards still unseen by this seat: the deck plus everyone else's unplayed cards. */
export function unseenDev(v: PlayerView): Record<keyof typeof DEV_COUNTS, number> {
  const played = { knight: 0, road: 0, plenty: 0, mono: 0 };
  for (const p of v.players) {
    played.knight += p.knights;
    played.road += p.played.road;
    played.plenty += p.played.plenty;
    played.mono += p.played.mono;
  }
  const h = v.hand;
  const mine = (k: 'knight' | 'road' | 'plenty' | 'mono') => (h ? h.dev[k] + h.fresh[k] : 0);
  return {
    knight: Math.max(0, DEV_COUNTS.knight - played.knight - mine('knight')),
    road: Math.max(0, DEV_COUNTS.road - played.road - mine('road')),
    plenty: Math.max(0, DEV_COUNTS.plenty - played.plenty - mine('plenty')),
    mono: Math.max(0, DEV_COUNTS.mono - played.mono - mine('mono')),
    vp: Math.max(0, DEV_COUNTS.vp - (h?.vpCards ?? 0)),
  };
}

/** Expected hidden victory points of player q: each unplayed card is a VP card with the pool's odds. */
export function hiddenVP(v: PlayerView, q: Seat): number {
  if (q === v.me || v.ck) return 0;
  const pool = unseenDev(v);
  const n = Object.values(pool).reduce((a, b) => a + b, 0);
  return n ? (v.players[q]!.devCount * pool.vp) / n : 0;
}

/** Expected unplayed Knights of player q. */
export function hiddenKnights(v: PlayerView, q: Seat): number {
  if (q === v.me) return v.hand ? v.hand.dev.knight + v.hand.fresh.knight : 0;
  const pool = unseenDev(v);
  const n = Object.values(pool).reduce((a, b) => a + b, 0);
  return n ? (v.players[q]!.devCount * pool.knight) / n : 0;
}
