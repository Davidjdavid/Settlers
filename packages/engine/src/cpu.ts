/*
 * The CPU players. Easy is specified in docs/bot.md: legal, weak, and never mean to humans.
 * Medium, Hard and custom CPUs (docs/bot-medium-hard.md) are in cpu/smart.ts. Every CPU decides
 * from its own view only. `memo` is what it remembers; the caller keeps it, and feeds it what
 * the CPU saw of every move through cpuObserve.
 */

import { TABLE_TALK, legalActions, mustDiscard } from './legal';
import { ckDiscardDue, firstOwe } from './modules/citiesKnights';
import { goldDue } from './modules/seafarers';
import { treasureDue } from './modules/treasures';
import { COST, cardKinds, geo, handLimit, rateFor, robberHexOK, total, vertFree, vertexOK } from './queries';
import { nextFloat, nextInt, type RngState } from './rng';
import {
  RES, type Action, type Card, type Cards, type GameState, type Progress, type Resource, type Seat,
} from './types'; // prettier-ignore
import { stateFromView, type PlayerView } from './view';
import { DEFAULT_CPU_OPTIONS, type CpuBrain, type CpuOptions } from './cpu/persona';
import { smartMove } from './cpu/smart';
import { newGuess, observe, type Guess } from './cpu/track';
import type { GameEvent } from './types';

export interface CpuMemo {
  /** The turn this memory is about. */
  turnN: number;
  /** Easy: one of its 1-in-4 "build" turns? */
  buildTurn: boolean;
  /** Easy: has it built this turn? */
  built: boolean;
  /** Medium and Hard: offers made this turn, so it never repeats one. */
  offers?: string[];
  /** Its moves so far this turn. */
  moves?: number;
  /** Offers by id: its move count when it first saw each (an offer on its turn is answered at once). */
  seen?: Record<number, number>;
  /** Turns it ended holding more cards than the hand limit (for walls). */
  big?: number;
  /** Hard: its guess at every hand, from what it has seen. */
  guess?: Guess;
}
export const newCpuMemo = (): CpuMemo => ({ turnN: -1, buildTurn: false, built: false });

/**
 * Its move, or null if it has nothing to do. `brain` picks Easy or a personality (Medium, Hard
 * or custom); `opts` are the room's CPU trading settings.
 */
export function cpuMove(
  v: PlayerView,
  rng: RngState,
  memo: CpuMemo,
  brain: CpuBrain = 'easy',
  opts: CpuOptions = DEFAULT_CPU_OPTIONS,
): Action | null {
  return brain === 'easy' ? easyMove(v, rng, memo) : smartMove(v, rng, memo, brain, opts);
}

/** Fold what this CPU saw of one move (its own view after it, and the events redacted for it). */
export function cpuObserve(
  memo: CpuMemo,
  v: PlayerView,
  events: GameEvent[],
  brain: CpuBrain = 'easy',
): void {
  if (brain === 'easy' || brain.base !== 'hard' || v.me == null) return;
  memo.guess = observe(memo.guess ?? newGuess(v), v, events);
}

/** Chance that a turn is a build turn. */
export const CPU_BUILD_CHANCE = 0.25;

/** Progress cards it plays (docs/bot.md §6.2). Everything else it never plays. */
export const CPU_PLAYS: ReadonlySet<Progress> = new Set<Progress>([
  'crane', 'engineer', 'irrigation', 'mining', 'medicine', 'roadBuilding', 'smith', 'warlord', 'merchant',
  'merchantFleet',
]); // prettier-ignore

type Spot = { type: 'robber' | 'pirate'; hex: number };

/** Players with a piece next to a robber or pirate spot (buildings, or ships for the pirate). */
export function spotPlayers(s: GameState, spot: Spot): Seat[] {
  const g = geo(s);
  const out = new Set<Seat>();
  if (spot.type === 'robber') {
    for (const v of g.hexVerts[spot.hex]!) {
      const b = s.verts[v];
      if (b) out.add(b[0]);
    }
  } else {
    g.edges.forEach((E, e) => {
      const o = s.sea?.ships[e];
      if (o != null && E.hexes.includes(spot.hex)) out.add(o);
    });
  }
  return [...out].sort((a, b) => a - b);
}

/** Human buildings (or ships) next to a spot. */
function humanPieces(s: GameState, spot: Spot): number {
  const g = geo(s);
  if (spot.type === 'robber')
    return g.hexVerts[spot.hex]!.filter((v) => {
      const b = s.verts[v];
      return b && !s.players[b[0]]!.cpu;
    }).length;
  return g.edges.filter((E, e) => {
    const o = s.sea?.ships[e];
    return o != null && !s.players[o]!.cpu && E.hexes.includes(spot.hex);
  }).length;
}

/**
 * Where it puts the robber or pirate (docs/bot.md §5). Lower is better:
 * [tier, players shared with, no CPU to rob (0/1), human pieces].
 */
export function spotRank(s: GameState, me: Seat, spot: Spot): number[] {
  const who = spotPlayers(s, spot);
  const others = who.filter((p) => p !== me);
  const tier = !who.length ? 1 : !others.length ? 2 : who.includes(me) ? 3 : 4;
  const cpuVictim = others.some((p) => s.players[p]!.cpu && total(s.players[p]!.res) > 0);
  return [tier, others.length, cpuVictim ? 0 : 1, humanPieces(s, spot), spot.type === 'robber' ? 0 : 1];
}

const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

/** Every place the robber (or, with Seafarers, the pirate) could go now. */
function spots(s: GameState): Spot[] {
  const out: Spot[] = [];
  for (let h = 0; h < s.board.hexes.length; h++) {
    if (h !== s.board.robber && robberHexOK(s, h)) out.push({ type: 'robber', hex: h });
    if (s.sea && s.board.hexes[h]!.t === 'sea' && h !== s.board.pirate) out.push({ type: 'pirate', hex: h });
  }
  return out;
}

/** The best spot among those whose rank is lowest, at random. */
function bestSpot(
  s: GameState,
  me: Seat,
  options: Spot[],
  rng: RngState,
): { spot: Spot; rank: number[] } | null {
  let best: { spot: Spot; rank: number[] }[] = [];
  for (const spot of options) {
    const rank = spotRank(s, me, spot);
    if (!best.length || cmp(rank, best[0]!.rank) < 0) best = [{ spot, rank }];
    else if (cmp(rank, best[0]!.rank) === 0) best.push({ spot, rank });
  }
  return best.length ? best[nextInt(rng, best.length)]! : null;
}

/** Robber or pirate move: the best spot, robbing a CPU before a human when it must rob. */
export function cpuEasyRobber(s: GameState, me: Seat, acts: Action[], rng: RngState): Action | null {
  const moves = acts.filter(
    (a): a is Extract<Action, { type: 'robber' | 'pirate' }> => a.type === 'robber' || a.type === 'pirate',
  );
  const pick = bestSpot(
    s,
    me,
    moves.map((a) => ({ type: a.type, hex: a.hex })),
    rng,
  );
  if (!pick) return null;
  const here = moves.filter((a) => a.type === pick.spot.type && a.hex === pick.spot.hex);
  const cpuVictims = here.filter((a) => a.victim != null && s.players[a.victim]!.cpu);
  const pool = cpuVictims.length ? cpuVictims : here;
  return pool[nextInt(rng, pool.length)]!;
}

/** Cards held, most first. */
function byMost(s: GameState, me: Seat, kinds: readonly Card[] = cardKinds(s)): Card[] {
  const res = s.players[me]!.res;
  return kinds.filter((k) => (res[k] ?? 0) > 0).sort((a, b) => (res[b] ?? 0) - (res[a] ?? 0));
}

/** Give up n cards, most-held first. */
function shed(s: GameState, me: Seat, n: number): Cards {
  const left: Cards = { ...s.players[me]!.res };
  const out: Cards = {};
  for (let i = 0; i < n; i++) {
    const k = cardKinds(s)
      .filter((x) => (left[x] ?? 0) > 0)
      .sort((a, b) => (left[b] ?? 0) - (left[a] ?? 0))[0]!;
    left[k]!--;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Resources it holds fewest of, that the bank has. */
function fewest(s: GameState, me: Seat): Resource[] {
  const res = s.players[me]!.res;
  return RES.filter((r) => s.bank[r] > 0).sort((a, b) => res[a] - res[b]);
}

/** A bank trade that sheds cards: give the most-held card it can trade, get the fewest-held resource. */
function protectHand(s: GameState, me: Seat, acts: Action[]): Action | null {
  const banks = acts.filter((a): a is Extract<Action, { type: 'bank' }> => a.type === 'bank');
  if (!banks.length) return null;
  const give = byMost(s, me).find((k) => banks.some((a) => a.give === k));
  if (!give) return null;
  const order = fewest(s, me);
  const options = banks.filter((a) => a.give === give);
  options.sort((a, b) => order.indexOf(a.get as Resource) - order.indexOf(b.get as Resource));
  return options.find((a) => (RES as readonly string[]).includes(a.get)) ?? options[0]!;
}

/** The first bank trade toward a city, if trades alone can complete one. */
function towardCity(s: GameState, me: Seat): Action | null {
  const pl = s.players[me]!;
  if (pl.pieces.city <= 0 || !s.verts.some((b) => b && b[0] === me && b[1] === 1)) return null;
  const hand: Cards = { ...pl.res };
  const bank: Cards = { ...s.bank };
  const need = COST.city as Cards;
  const trades: [Card, Resource][] = [];
  for (let guard = 0; guard < 10; guard++) {
    const missing = (['wheat', 'ore'] as Resource[]).find((r) => (hand[r] ?? 0) < (need[r] ?? 0));
    if (!missing) break;
    if ((bank[missing] ?? 0) < 1) return null;
    const spare = (k: Card) => (hand[k] ?? 0) - (need[k] ?? 0);
    const give = cardKinds(s)
      .filter((k) => k !== missing && spare(k) >= rateFor(s, me, k))
      .sort((a, b) => spare(b) - spare(a))[0];
    if (!give) return null;
    hand[give]! -= rateFor(s, me, give);
    hand[missing] = (hand[missing] ?? 0) + 1;
    bank[missing]!--;
    trades.push([give, missing]);
  }
  const first = trades[0];
  return first ? { type: 'bank', give: first[0], get: first[1] } : null;
}

/** Roads and ships that reach a corner where a settlement could go. */
function toSpot(s: GameState, acts: Action[]): Action[] {
  const g = geo(s);
  const spot = (v: number) => vertFree(s, v) && vertexOK(s, v);
  return acts.filter((a) => {
    if (!('e' in a) || a.e == null) return false;
    const E = g.edges[a.e as number]!;
    return spot(E.a) || spot(E.b);
  });
}

/** Actions of one type. */
function ofType<T extends Action['type']>(acts: Action[], t: T): Extract<Action, { type: T }>[] {
  return acts.filter((a) => a.type === t) as Extract<Action, { type: T }>[];
}

const anyOf = <T>(rng: RngState, xs: T[]): T | null => (xs.length ? xs[nextInt(rng, xs.length)]! : null);

/** Easy's move (docs/bot.md), or null if it has nothing to do. */
function easyMove(v: PlayerView, rng: RngState, memo: CpuMemo): Action | null {
  const me = v.me;
  if (me == null || v.phase !== 'play') return null;
  const s = stateFromView(v);
  const pl = s.players[me]!;

  // Owed right away: discards, gold, Cities & Knights choices.
  const need = mustDiscard(s, me);
  if (need) return { type: 'discard', cards: shed(s, me, need) };
  const gold = goldDue(s, me);
  if (gold) {
    const cards: Cards = {};
    const bank = { ...s.bank };
    for (let i = 0; i < gold; i++) {
      const r = RES.filter((x) => bank[x] > 0).sort(
        (a, b) => pl.res[a] + (cards[a] ?? 0) - (pl.res[b] + (cards[b] ?? 0)),
      )[0]!;
      bank[r]--;
      cards[r] = (cards[r] ?? 0) + 1;
    }
    return { type: 'chooseGold', cards };
  }
  if (s.stage === 'ck') return cpuOwedChoice(s, me, rng);
  if (s.stage === 'gold') return null;
  if (s.stage === 'treasure') {
    const due = treasureDue(s, me);
    if (!due) return null;
    if (due.k === 'deck') {
      const decks = legalActions(s, me);
      return decks[nextInt(rng, decks.length)] ?? null;
    }
    // Like gold: what it has least of.
    const cards: Cards = {};
    const bank = { ...s.bank };
    for (let i = 0; i < due.n; i++) {
      const r = RES.filter((x) => bank[x] > 0).sort(
        (a, b) => pl.res[a] + (cards[a] ?? 0) - (pl.res[b] + (cards[b] ?? 0)),
      )[0]!;
      bank[r]--;
      cards[r] = (cards[r] ?? 0) + 1;
    }
    return { type: 'treasurePick', cards: cards as Partial<Record<(typeof RES)[number], number>> };
  }

  // Decline every trade offer it is asked to answer.
  for (const o of s.offers) {
    if (o.from === me || o.resp[me] != null) continue;
    if (o.from === s.turn || s.turn === me) return { type: 'respond', id: o.id, yes: false };
  }
  if (s.turn !== me) return null;
  // Asked for the dice back: a CPU always hands them back (SPEC 4.4).
  if (s.back?.asked) return { type: 'handBack' };

  const acts = legalActions(s, me).filter(
    (a) =>
      a.type !== 'respond' && a.type !== 'confirm' && a.type !== 'cancel' && !TABLE_TALK.includes(a.type),
  );
  if (!acts.length) return null;
  if (s.stage !== 'setup' && memo.turnN !== s.turnN) {
    memo.turnN = s.turnN;
    memo.buildTurn = nextFloat(rng) < CPU_BUILD_CHANCE;
    memo.built = false;
  }
  const of = <T extends Action['type']>(t: T) => ofType(acts, t);

  switch (s.stage) {
    case 'setup':
      return anyOf(rng, acts);
    case 'robber':
      return cpuEasyRobber(s, me, acts, rng);
    case 'roads': {
      const pieces = acts.filter((a) => a.type === 'freeRoad' || a.type === 'freeShip');
      return anyOf(rng, toSpot(s, pieces)) ?? anyOf(rng, pieces) ?? of('skipRoads')[0] ?? null;
    }
    case 'preroll': {
      // A Knight only when the robber can go where nobody is robbed.
      const knight = of('playKnight')[0];
      if (knight && nextFloat(rng) < 0.5) {
        const best = bestSpot(s, me, spots(s), rng);
        if (best && best.rank[0]! <= 2) return knight;
      }
      return of('roll')[0] ?? null;
    }
    case 'main':
      return mainMove(s, me, acts, rng, memo);
    default:
      return null;
  }
}

function mainMove(s: GameState, me: Seat, acts: Action[], rng: RngState, memo: CpuMemo): Action {
  const of = <T extends Action['type']>(t: T) => ofType(acts, t);
  const pl = s.players[me]!;

  // Cities & Knights: knights first, so they help against the barbarians.
  const activate = of('activate')[0];
  if (activate) return activate;
  const knight = anyOf(rng, of('knight'));
  if (knight) return knight;

  // Harmless cards.
  const card = harmlessCard(s, me, acts, rng);
  if (card) return card;

  // One build, on one turn in four.
  if (memo.buildTurn && !memo.built) {
    const build =
      anyOf(rng, of('city')) ??
      anyOf(rng, of('settlement')) ??
      anyOf(rng, toSpot(s, [...of('road'), ...of('ship')])) ??
      of('buyDev')[0] ??
      improve(s, me, of('improve'), rng) ??
      ((pl.res.brick ?? 0) >= 4 ? anyOf(rng, of('wall')) : null) ??
      anyOf(
        rng,
        of('promote').filter((a) => s.ck?.knights[a.v]?.lvl === 1),
      );
    if (build) {
      memo.built = true;
      return build;
    }
    const trade = towardCity(s, me);
    if (
      trade &&
      acts.some(
        (a) =>
          a.type === 'bank' &&
          a.give === (trade as { give: Card }).give &&
          a.get === (trade as { get: Card }).get,
      )
    )
      return trade;
  }

  // End of turn: protect the hand, keep at most 4 progress cards, then end.
  if (total(pl.res) > handLimit(s, me)) {
    const trade = protectHand(s, me, acts);
    if (trade) return trade;
  }
  const drops = of('dropProgress');
  if (drops.length) return drops.find((a) => !CPU_PLAYS.has(a.card)) ?? anyOf(rng, drops)!;
  return of('end')[0] ?? acts[0]!;
}

/** An improvement in the track whose commodity it holds most of. */
function improve(
  s: GameState,
  me: Seat,
  opts: Extract<Action, { type: 'improve' }>[],
  rng: RngState,
): Action | null {
  if (!opts.length) return null;
  const res = s.players[me]!.res;
  const com = { trade: 'cloth', politics: 'coin', science: 'paper' } as const;
  const top = Math.max(...opts.map((a) => res[com[a.track]] ?? 0));
  return anyOf(
    rng,
    opts.filter((a) => (res[com[a.track]] ?? 0) === top),
  );
}

/** A development or progress card it may play: never one that takes from or hurts a human. */
function harmlessCard(s: GameState, me: Seat, acts: Action[], rng: RngState): Action | null {
  const roads = acts.find((a) => a.type === 'playRoads');
  if (roads && toSpot(s, legalActions({ ...s, stage: 'roads', freeRoads: 2 } as GameState, me)).length)
    return roads;
  const plenty = acts.filter((a): a is Extract<Action, { type: 'playPlenty' }> => a.type === 'playPlenty');
  if (plenty.length) {
    const order = fewest(s, me);
    return plenty.sort(
      (a, b) => order.indexOf(a.r1) + order.indexOf(a.r2) - order.indexOf(b.r1) - order.indexOf(b.r2),
    )[0]!;
  }
  const plays = acts.filter(
    (a): a is Extract<Action, { type: 'progress' }> => a.type === 'progress' && CPU_PLAYS.has(a.card),
  );
  const ok = plays.filter((a) => {
    if (a.card === 'merchant') {
      const m = s.ck?.merchant;
      return !m || s.players[m.p]!.cpu;
    }
    if (a.card === 'merchantFleet') return a.r === byMost(s, me)[0];
    return true;
  });
  return anyOf(rng, ok);
}

/** Answer a Cities & Knights choice it owes (docs/bot.md §7). */
export function cpuOwedChoice(s: GameState, me: Seat, rng: RngState): Action | null {
  const o = firstOwe(s, me);
  if (!o) return null;
  const due = ckDiscardDue(s, me);
  if (due) return { type: 'choose', cards: shed(s, me, due) };
  const opts = legalActions(s, me).filter(
    (a): a is Extract<Action, { type: 'choose' }> => a.type === 'choose',
  );
  if (!opts.length) return null;
  switch (o.k) {
    case 'give':
      return { type: 'choose', cards: shed(s, me, o.n) };
    case 'overflow':
      return opts.find((a) => a.card && !CPU_PLAYS.has(a.card)) ?? anyOf(rng, opts);
    case 'aqueduct': {
      const order = fewest(s, me);
      return opts.sort((a, b) => order.indexOf(a.r as Resource) - order.indexOf(b.r as Resource))[0]!;
    }
    case 'harborGive': {
      const most = byMost(s, me)[0];
      return opts.find((a) => a.r === most) ?? opts[0]!;
    }
    case 'desert': {
      const k = s.ck!.knights;
      return opts.sort((a, b) => k[a.v!]!.lvl - k[b.v!]!.lvl)[0]!;
    }
    case 'deserterPlace':
    case 'rebuild':
    case 'harbor':
      return opts.find((a) => a.skip) ?? anyOf(rng, opts);
    default:
      return anyOf(rng, opts);
  }
}
