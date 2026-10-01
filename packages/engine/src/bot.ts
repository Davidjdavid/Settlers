/*
 * A simple bot that chooses a move from its own view only, so it can't cheat. Used by the
 * end-to-end test, and the starting point for the deliberately weak CPU player.
 */

import { legalActions, mustDiscard } from './legal';
import { goldDue } from './modules/seafarers';
import { COST, geo, has, legalSettlements, rateFor, vertFree, vertexOK } from './queries';
import { nextFloat, nextInt, type RngState } from './rng';
import { RES, type Action, type PartialRes } from './types';
import { stateFromView, type PlayerView } from './view';

const WEIGHT: Partial<Record<Action['type'], number>> = {
  setup: 1, roll: 1, robber: 1, freeRoad: 5, skipRoads: 0.1,
  city: 40, settlement: 40, buyDev: 6, road: 1,
  playKnight: 3, playRoads: 2, playPlenty: 2, playMono: 1, end: 3,
  ship: 1, freeShip: 3, moveShip: 0.5, pirate: 1,
}; // prettier-ignore

/** The bot's move, or null if it has nothing to do right now. */
export function botMove(v: PlayerView, rng: RngState): Action | null {
  const me = v.me;
  if (me == null || v.phase !== 'play') return null;
  const s = stateFromView(v);
  const need = mustDiscard(s, me);
  if (need) {
    const left = { ...v.hand!.res };
    const cards: PartialRes = {};
    for (let i = 0; i < need; i++) {
      const r = RES.filter((x) => left[x] > 0).sort((a, b) => left[b] - left[a])[0]!;
      left[r]--;
      cards[r] = (cards[r] ?? 0) + 1;
    }
    return { type: 'discard', cards };
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
  // Answer trade offers aimed at us: decline (a weak, polite bot).
  for (const o of v.offers) {
    if (o.from !== me && o.from === v.turn && o.resp[me] == null)
      return { type: 'respond', id: o.id, yes: false };
  }
  if (v.turn !== me) return null;
  const acts = legalActions(s, me).filter((a) => !['respond', 'confirm', 'cancel'].includes(a.type));
  if (!acts.length) return null;

  const res = v.hand!.res;
  const g = geo(s);
  const noSpots = legalSettlements(s, me).length === 0;
  const useful = new Set<string>();
  for (const cost of [COST.city, COST.settlement, COST.dev, COST.road] as PartialRes[]) {
    if (has(res, cost)) break;
    for (const give of RES) {
      if (res[give] - (cost[give] ?? 0) < rateFor(s, me, give)) continue;
      for (const get of RES) if (res[get] < (cost[get] ?? 0)) useful.add(`${give}>${get}`);
    }
    if (useful.size) break;
  }
  const spot = (x: number) => vertFree(s, x) && vertexOK(s, x);
  const moves = acts.filter((a) => a.type === 'moveShip' || a.type === 'pirate').length || 1;
  const w = acts.map((a) => {
    if (a.type === 'bank') return useful.has(`${a.give}>${a.get}`) ? 30 : 0;
    if (a.type === 'road' || a.type === 'freeRoad' || a.type === 'ship' || a.type === 'freeShip') {
      const E = g.edges[a.e]!;
      const reach = spot(E.a) || spot(E.b);
      if (noSpots && reach) return 40;
      // With nowhere to build on land, sail out to explore.
      if (noSpots && (a.type === 'ship' || a.type === 'freeShip')) return 15;
      return 0.3;
    }
    if (a.type === 'moveShip' || a.type === 'pirate') return (WEIGHT[a.type] ?? 1) / moves;
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
