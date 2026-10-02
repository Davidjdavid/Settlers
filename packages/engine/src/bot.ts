/*
 * A simple bot that chooses a move from its own view only, so it can't cheat. Used by the
 * end-to-end test, and the starting point for the deliberately weak CPU player.
 */

import { TABLE_TALK, legalActions, mustDiscard } from './legal';
import { ckDiscardDue } from './modules/citiesKnights';
import { goldDue } from './modules/seafarers';
import { treasureDue } from './modules/treasures';
import { COST, cardKinds, geo, has, legalSettlements, rateFor, vertFree, vertexOK } from './queries';
import { nextFloat, nextInt, type RngState } from './rng';
import { RES, type Action, type Cards, type GameState, type PartialRes, type Seat } from './types';
import { stateFromView, type PlayerView } from './view';

const WEIGHT: Partial<Record<Action['type'], number>> = {
  setup: 1, roll: 1, robber: 1, freeRoad: 5, skipRoads: 0.1,
  city: 40, settlement: 40, buyDev: 6, road: 1,
  playKnight: 3, playRoads: 2, playPlenty: 2, playMono: 1, end: 3,
  ship: 1, freeShip: 3, moveShip: 0.5, pirate: 1,
  improve: 25, wall: 3, knight: 4, promote: 3, activate: 3, moveKnight: 1, chase: 2,
  progress: 4, dropProgress: 1,
}; // prettier-ignore

/** Action types with many options share one weight. */
const SHARED = new Set<Action['type']>(['moveShip', 'pirate', 'moveKnight', 'chase', 'progress', 'knight']);

/** Pick `n` cards to give up, from what we hold most of. */
function shed(s: GameState, me: Seat, n: number): Cards {
  const left = { ...s.players[me]!.res };
  const cards: Cards = {};
  for (let i = 0; i < n; i++) {
    const r = cardKinds(s)
      .filter((x) => left[x]! > 0)
      .sort((a, b) => left[b]! - left[a]!)[0]!;
    left[r]!--;
    cards[r] = (cards[r] ?? 0) + 1;
  }
  return cards;
}

/** The bot's move, or null if it has nothing to do right now. */
export function botMove(v: PlayerView, rng: RngState): Action | null {
  const me = v.me;
  if (me == null || v.phase !== 'play') return null;
  const s = stateFromView(v);
  const need = mustDiscard(s, me);
  if (need) return { type: 'discard', cards: shed(s, me, need) };
  // Cities & Knights choices: discards are free-form; anything else, pick one of the options.
  if (v.stage === 'ck') {
    const due = ckDiscardDue(s, me);
    if (due) return { type: 'choose', cards: shed(s, me, due) };
    const opts = legalActions(s, me).filter((a) => a.type === 'choose');
    return opts.length ? opts[nextInt(rng, opts.length)]! : null;
  }
  // Gold: take whatever the bank has most of.
  const gold = goldDue(s, me);
  if (gold) {
    const bank = { ...v.bank };
    const cards: PartialRes = {};
    for (let i = 0; i < gold; i++) {
      const r = RES.filter((x) => bank[x] > 0).sort((a, b) => bank[b] - bank[a])[0]!;
      bank[r]--;
      cards[r] = (cards[r] ?? 0) + 1;
    }
    return { type: 'chooseGold', cards };
  }
  if (v.stage === 'gold') return null;
  if (v.stage === 'treasure') {
    if (!treasureDue(s, me)) return null;
    const opts = legalActions(s, me);
    return opts[nextInt(rng, opts.length)] ?? null;
  }
  // Answer trade offers aimed at us: decline (a weak, polite bot).
  for (const o of v.offers) {
    if (o.from !== me && o.from === v.turn && o.resp[me] == null)
      return { type: 'respond', id: o.id, yes: false };
  }
  if (v.turn !== me) return null;
  // Never asks for undos or the dice back, and never changes the rules.
  const acts = legalActions(s, me).filter(
    (a) => !['respond', 'confirm', 'cancel', ...TABLE_TALK].includes(a.type),
  );
  if (!acts.length) return null;

  const res = v.hand!.res;
  const g = geo(s);
  const noSpots = legalSettlements(s, me).length === 0;
  const useful = new Set<string>();
  for (const cost of [COST.city, COST.settlement, COST.dev, COST.road] as PartialRes[]) {
    if (has(res, cost)) break;
    for (const give of cardKinds(s)) {
      if (res[give]! - ((cost as Cards)[give] ?? 0) < rateFor(s, me, give)) continue;
      for (const get of RES) if (res[get] < (cost[get] ?? 0)) useful.add(`${give}>${get}`);
    }
    if (useful.size) break;
  }
  const spot = (x: number) => vertFree(s, x) && vertexOK(s, x);
  const per: Record<string, number> = {};
  const key = (a: Action) => (a.type === 'progress' ? `progress:${a.card}` : a.type);
  for (const a of acts) if (SHARED.has(a.type)) per[key(a)] = (per[key(a)] ?? 0) + 1;
  const threat = !!v.ck && v.ck.barb >= 3;
  const w = acts.map((a) => {
    if (threat && a.type === 'activate') return 30;
    if (SHARED.has(a.type)) return (WEIGHT[a.type] ?? 1) / per[key(a)]!;
    if (a.type === 'bank') return useful.has(`${a.give}>${a.get}`) ? 30 : 0;
    if (a.type === 'road' || a.type === 'freeRoad' || a.type === 'ship' || a.type === 'freeShip') {
      const E = g.edges[a.e]!;
      const reach = spot(E.a) || spot(E.b);
      if (noSpots && reach) return 40;
      // With nowhere to build on land, sail out to explore.
      if (noSpots && (a.type === 'ship' || a.type === 'freeShip')) return 15;
      return 0.3;
    }
    if (a.type === 'setup' && a.ship) return 0.2;
    if (a.type === 'robber') return a.victim != null ? 3 : 1;
    return WEIGHT[a.type] ?? 1;
  });
  const sum = w.reduce((x, y) => x + y, 0);
  if (sum <= 0) return acts[nextInt(rng, acts.length)]!;
  let x = nextFloat(rng) * sum;
  for (let i = 0; i < acts.length; i++) {
    x -= w[i]!;
    if (x < 0) return acts[i]!;
  }
  return acts[acts.length - 1]!;
}
