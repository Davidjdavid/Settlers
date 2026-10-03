/*
 * Treasures, as specified in docs/rules/treasures.md. Spots sit on paths; the first road or ship
 * on one finds it, and the finder draws the top card of the treasure deck (one card per spot).
 * Works in every mode: the module is on whenever the map has spots.
 *
 * Finding is checked after every move (a road, a ship, a ship moved, a free piece, a setup
 * piece), so no base rule needs to know about treasures. Choices (resources to pick, a progress
 * deck) are made in a short treasure stage, entered only from a resting stage; free roads and
 * ships are added to Road Building in progress, or placed when it's next the finder's turn to act.
 */

import { edgeOfSide, hexAt } from '../map';
import { checkWin, gain, isInt, isRes } from '../ops';
import { canPlaceFreePiece, deckCount, devCardsOn, freePieceSupply, geo } from '../queries';
import { nextInt, shuffle } from '../rng';
import {
  DEV_TYPES, RES, TRACKS, TREASURES, type GameState, type PartialRes, type Resource, type Seat, type Stage,
  type TreasureKind, type TreasureState,
} from '../types'; // prettier-ignore
import type { Ctx, RuleModule } from './api';
import { drawProgress } from './citiesKnights';

const tr = (s: GameState) => s.tr!;

/** Stages a treasure choice may interrupt (others finish first). */
const RESTING: readonly Stage[] = ['setup', 'preroll', 'main', 'roads'];

/** Resource cards the bank holds in all. */
const bankRes = (s: GameState) => RES.reduce((n, r) => n + s.bank[r], 0);

/** Is there a development (or, in Knights, progress) card a treasure could give? */
function devAvailable(s: GameState): boolean {
  if (s.ck) return TRACKS.some((t) => s.ck!.decks[t].length > 0);
  return devCardsOn(s) && deckCount(s) > 0;
}

/** The deck for a map's spots: the four kinds dealt round in turn, then shuffled (D1). */
export function treasureDeck(n: number): TreasureKind[] {
  return Array.from({ length: n }, (_, i) => TREASURES[i % TREASURES.length]!);
}

/** A treasure found on edge e by p: draw it and make it happen. */
function find(x: Ctx, e: number, p: Seat) {
  const { s, events } = x;
  const t = tr(s);
  t.spots = t.spots.filter((x) => x !== e);
  let k = t.deck.shift()!;
  let from: 'dev' | undefined;
  // No card to give: the treasure becomes one of the other kinds (D5).
  if (k === 'dev' && !devAvailable(s)) {
    const others = TREASURES.filter((x) => x !== 'dev');
    k = others[nextInt(s.rng, others.length)]!;
    from = 'dev';
  }
  t.found.push({ e, p, k });
  events.push(from ? { k: 'treasure', p, e, kind: k, from } : { k: 'treasure', p, e, kind: k });
  happen(x, p, k);
}

function happen(x: Ctx, p: Seat, k: TreasureKind) {
  const { s, events } = x;
  const t = tr(s);
  switch (k) {
    case 'trio': {
      // Whatever the bank has of the three (D4).
      const got: PartialRes = {};
      for (const r of ['sheep', 'brick', 'wheat'] as const)
        if (s.bank[r] > 0) {
          gain(s, p, r, 1);
          got[r] = 1;
        }
      events.push({ k: 'treasureGot', p, got });
      return;
    }
    case 'pick': {
      const n = Math.min(2, bankRes(s));
      if (n) t.owe.push({ p, k: 'pick', n });
      else events.push({ k: 'treasureGot', p, got: {} });
      return;
    }
    case 'roads':
      t.owe.push({ p, k: 'roads', n: 2 });
      return;
    case 'dev': {
      if (s.ck) {
        t.owe.push({ p, k: 'deck', n: 1 });
        return;
      }
      // The top of the development deck, as when bought: new, so not playable this turn.
      let i = nextInt(s.rng, deckCount(s));
      let card: (typeof DEV_TYPES)[number] = DEV_TYPES[0];
      for (const c of DEV_TYPES) {
        if (i < s.deck[c]) {
          card = c;
          break;
        }
        i -= s.deck[c];
      }
      s.deck[card]--;
      const me = s.players[p]!;
      if (card === 'vp') me.vpCards++;
      else me.fresh[card]++;
      events.push({ k: 'treasureDev', p, card });
      return;
    }
  }
}

/**
 * Sea or desert uncovered on a map whose fog pays (docs/rules/seafarers.md §11.5, D9): the top card
 * of the fog treasure deck, made to happen like any treasure. Its event has no edge (e -1) and
 * names the hex.
 */
function fogFind(x: Ctx, h: number, p: Seat) {
  const e = -1;
  const { s, events } = x;
  const t = tr(s);
  const deck = t.fogDeck!;
  let k = deck.shift()!;
  let from: 'dev' | undefined;
  if (k === 'dev' && !devAvailable(s)) {
    const others = TREASURES.filter((x) => x !== 'dev');
    k = others[nextInt(s.rng, others.length)]!;
    from = 'dev';
  }
  t.fogFound!.push({ h, p, k });
  events.push(from ? { k: 'treasure', p, e, kind: k, from, h } : { k: 'treasure', p, e, kind: k, h });
  happen(x, p, k);
}

/** Choices still owed (not free pieces). */
const choices = (t: TreasureState) => t.owe.filter((o) => o.k !== 'roads');

/** After every move: find treasures, start the choices, give free pieces when they can be placed. */
function settle(x: Ctx) {
  const { s, events } = x;
  const t = tr(s);
  if (s.phase !== 'play') return;
  if (t.fogDeck) {
    // This move's uncovered sea and desert, each once.
    const done = new Set(t.fogFound!.map((f) => f.h));
    for (const ev of events)
      if (ev.k === 'discover' && (ev.t === 'sea' || ev.t === 'desert') && !done.has(ev.h)) {
        done.add(ev.h);
        fogFind(x, ev.h, ev.p);
      }
  }
  const ships = s.sea?.ships;
  for (const e of t.spots.slice()) {
    const owner = s.edges[e] ?? ships?.[e] ?? null;
    if (owner != null) find(x, e, owner);
  }
  if (choices(t).length) {
    if (s.stage !== 'treasure' && RESTING.includes(s.stage)) {
      t.back = s.stage;
      s.stage = 'treasure';
    }
  } else if (s.stage === 'preroll' || s.stage === 'main' || s.stage === 'roads') {
    // Free roads and ships for the player whose turn it is: added to any still to place (D3).
    const p = s.turn;
    const mine = t.owe.filter((o) => o.k === 'roads' && o.p === p);
    if (mine.length) {
      t.owe = t.owe.filter((o) => !(o.k === 'roads' && o.p === p));
      const want = mine.reduce((a, o) => a + o.n, 0);
      const placing = s.stage === 'roads' ? s.freeRoads : 0;
      let n = Math.max(0, Math.min(want, freePieceSupply(s, p) - placing));
      if (s.stage === 'roads') s.freeRoads += n;
      else if (n && canPlaceFreePiece(s, p)) {
        s.freeRoads = n;
        s.roadsReturn = s.stage === 'preroll' ? 'preroll' : 'main';
        s.stage = 'roads';
      } else n = 0;
      events.push({ k: 'treasureRoads', p, n });
    }
  }
  checkWin(s, events);
}

/** Leave the treasure stage once nothing is left to choose. */
function done(s: GameState) {
  const t = tr(s);
  if (s.stage === 'treasure' && !choices(t).length) {
    s.stage = t.back ?? 'main';
    t.back = null;
  }
}

export const treasures: RuleModule = {
  id: 'treasures',

  init(s) {
    const m = s.config.map;
    const g = geo(s);
    const spots: number[] = [];
    for (const x of m?.treasures ?? []) {
      const h = hexAt(m!.hexes, x.q, x.r);
      if (h < 0) continue;
      const e = edgeOfSide(g, h, x.side);
      if (e != null && !spots.includes(e)) spots.push(e);
    }
    s.tr = { spots, deck: shuffle(treasureDeck(spots.length), s.rng), found: [], owe: [], back: null };
    // Fog that pays: one treasure per fog hex (D9).
    if (m?.fogRewards) {
      const n = s.board.hexes.filter((h) => h.t === 'fog').length;
      if (n) {
        s.tr.fogDeck = shuffle(treasureDeck(n), s.rng);
        s.tr.fogFound = [];
      }
    }
  },

  afterAction: settle,

  waitingOn(s) {
    if (s.stage !== 'treasure') return undefined;
    return [...new Set(choices(tr(s)).map((o) => o.p))];
  },

  reduce(x, a) {
    if (a.type !== 'treasurePick' && a.type !== 'treasureDeck') return undefined;
    const { s, p, events } = x;
    const t = tr(s);
    if (s.stage !== 'treasure') return 'You have no treasure to choose';
    const i = t.owe.findIndex((o) => o.p === p && o.k !== 'roads');
    const o = t.owe[i];
    if (!o) return 'You have no treasure to choose';
    if (a.type === 'treasurePick') {
      if (o.k !== 'pick') return 'Pick a progress deck';
      const c = a.cards;
      if (!c || typeof c !== 'object') return `Pick ${o.n} resources`;
      let n = 0;
      for (const [k, v] of Object.entries(c)) {
        if (!isRes(k) || !isInt(v) || v < 0) return 'Pick resources only';
        if (v > s.bank[k]) return `The bank is out of ${k}`;
        n += v;
      }
      // The bank may have run short since: you get what it has.
      const need = Math.min(o.n, bankRes(s));
      if (n !== need) return need === 1 ? 'Pick 1 resource' : `Pick ${need} resources`;
      t.owe.splice(i, 1);
      done(s);
      const got: PartialRes = {};
      for (const [k, v] of Object.entries(c) as [Resource, number][])
        if (v) {
          gain(s, p, k, v);
          got[k] = v;
        }
      events.push({ k: 'treasureGot', p, got });
      return null;
    }
    if (o.k !== 'deck') return `Pick ${o.n} resources`;
    if (!(TRACKS as readonly string[]).includes(a.track)) return 'Pick a deck';
    if (!devAvailable(s)) {
      // Every deck ran out while waiting: the treasure becomes another kind (D5).
      t.owe.splice(i, 1);
      const others = TREASURES.filter((x) => x !== 'dev');
      const k = others[nextInt(s.rng, others.length)]!;
      events.push({ k: 'treasure', p, e: -1, kind: k, from: 'dev' });
      happen(x, p, k);
      done(s);
      return null;
    }
    if (!s.ck!.decks[a.track].length) return 'That deck is empty';
    t.owe.splice(i, 1);
    // Leave the stage first, so a card over the limit is owed from where play goes back to.
    done(s);
    drawProgress(s, p, a.track, events);
    return null;
  },

  legal(s, p, out) {
    if (s.stage !== 'treasure') return;
    const o = choices(tr(s)).find((o) => o.p === p);
    if (!o) return;
    if (o.k === 'deck') {
      const open = TRACKS.filter((t) => s.ck!.decks[t].length > 0);
      for (const track of open.length ? open : TRACKS) out.push({ type: 'treasureDeck', track });
      return;
    }
    const need = Math.min(o.n, bankRes(s));
    if (need === 0) {
      out.push({ type: 'treasurePick', cards: {} });
      return;
    }
    for (const a of RES) {
      if (!s.bank[a]) continue;
      if (need === 1) {
        out.push({ type: 'treasurePick', cards: { [a]: 1 } });
        continue;
      }
      for (const b of RES) {
        if (b < a) continue;
        if (a === b ? s.bank[a] < 2 : !s.bank[b]) continue;
        out.push({ type: 'treasurePick', cards: a === b ? { [a]: 2 } : { [a]: 1, [b]: 1 } });
      }
    }
  },

  invariants(s) {
    const bad: string[] = [];
    const t = s.tr;
    if (!t) return ['treasures on but no treasure state'];
    if (t.deck.length !== t.spots.length)
      bad.push(`treasure deck ${t.deck.length} for ${t.spots.length} spots`);
    if (new Set(t.spots).size !== t.spots.length) bad.push('a treasure spot listed twice');
    const found = new Set(t.found.map((f) => f.e));
    if (found.size !== t.found.length) bad.push('a treasure found twice');
    for (const e of t.spots) {
      if (found.has(e)) bad.push(`found treasure ${e} still face down`);
      // (A road that wins the game ends it before anything is found.)
      if (s.phase === 'play' && (s.edges[e] != null || s.sea?.ships[e] != null))
        bad.push(`a piece on unfound treasure ${e}`);
    }
    if (s.stage === 'treasure' && (!choices(t).length || t.back == null))
      bad.push('treasure stage with nothing to choose');
    if (t.back != null && s.stage !== 'treasure' && s.stage !== 'ck')
      bad.push(`treasure back ${t.back} outside the treasure stage`);
    for (const o of t.owe) if (!(o.n > 0)) bad.push(`treasure owes ${o.n}`);
    if (t.fogDeck) {
      // Every fog hex left can still pay; each uncovered sea or desert paid exactly once.
      const fog = s.board.hexes.filter((h) => h.t === 'fog').length;
      if (t.fogDeck.length < fog) bad.push(`fog treasure deck ${t.fogDeck.length} for ${fog} fog hexes`);
      const fh = new Set(t.fogFound!.map((f) => f.h));
      if (fh.size !== t.fogFound!.length) bad.push('a fog treasure given twice');
      for (const f of t.fogFound!) {
        const tt = s.board.hexes[f.h]?.t;
        if (tt !== 'sea' && tt !== 'desert') bad.push(`fog treasure from ${tt} hex ${f.h}`);
      }
    }
    return bad;
  },

  transition(prev, next) {
    const bad: string[] = [];
    const a = prev.tr!;
    const b = next.tr!;
    // Spots only ever go, and every one that goes is found; the deck plus found stay whole.
    if (b.spots.some((e) => !a.spots.includes(e))) bad.push('a treasure spot came back');
    if (
      b.found.length < a.found.length ||
      a.found.some((f, i) => JSON.stringify(f) !== JSON.stringify(b.found[i]))
    )
      bad.push('a found treasure changed');
    if (a.spots.length + a.found.length !== b.spots.length + b.found.length)
      bad.push('treasure deck plus found changed size');
    if (!!a.fogDeck !== !!b.fogDeck) bad.push('the fog treasure deck came or went');
    if (a.fogDeck && b.fogDeck) {
      if (a.fogDeck.length + a.fogFound!.length !== b.fogDeck.length + b.fogFound!.length)
        bad.push('fog treasure deck plus found changed size');
      if (a.fogFound!.some((f, i) => JSON.stringify(f) !== JSON.stringify(b.fogFound![i])))
        bad.push('a fog treasure changed');
      // Every sea or desert uncovered by this move paid (and nothing else did).
      const uncovered = next.board.hexes
        .map((h, i) => (prev.board.hexes[i]!.t === 'fog' && (h.t === 'sea' || h.t === 'desert') ? i : -1))
        .filter((i) => i >= 0);
      // They pay along the piece first, then at its ends (§11.5), so compare them in board order.
      const paid = b
        .fogFound!.slice(a.fogFound!.length)
        .map((f) => f.h)
        .sort((x, y) => x - y);
      if (next.phase !== 'over' && JSON.stringify(paid) !== JSON.stringify(uncovered))
        bad.push(`fog paid ${paid} for ${uncovered}`);
    }
    return bad;
  },

  view(s, _seat, v) {
    const t = tr(s);
    v.tr = {
      spots: t.spots.slice(),
      found: t.found.map((f) => ({ ...f })),
      owe: t.owe.map((o) => ({ ...o })),
      back: t.back,
      ...(t.fogDeck ? { fogLeft: t.fogDeck.length, fogFound: t.fogFound!.map((f) => ({ ...f })) } : {}),
    };
  },

  fromView(v, s) {
    const t = v.tr!;
    s.tr = {
      spots: t.spots.slice(),
      // The real order is secret; placeholders only matter for counting.
      deck: t.spots.map(() => 'trio'),
      found: t.found.map((f) => ({ ...f })),
      owe: t.owe.map((o) => ({ ...o })),
      back: t.back,
      ...(t.fogLeft != null
        ? { fogDeck: Array.from({ length: t.fogLeft }, () => 'trio' as const), fogFound: t.fogFound!.slice() }
        : {}),
    };
  },
};

/** What p must choose now in the treasure stage: resources (how many) or a deck; null if nothing. */
export function treasureDue(s: GameState, p: Seat): { k: 'pick' | 'deck'; n: number } | null {
  if (s.stage !== 'treasure' || !s.tr) return null;
  const o = choices(s.tr).find((o) => o.p === p);
  if (!o) return null;
  return o.k === 'pick' ? { k: 'pick', n: Math.min(o.n, bankRes(s)) } : { k: 'deck', n: 1 };
}

/** For the client and CPUs: is edge e a treasure still face down? */
export const treasureAt = (v: { tr?: { spots: number[] } }, e: number) => !!v.tr?.spots.includes(e);
