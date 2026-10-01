/*
 * Random-game simulator. Plays full games with a seeded random agent and checks, after every
 * action: invariants, that every legal action is accepted, that the input state is not
 * mutated, that views leak nothing, and that the whole game replays identically.
 */

import {
  COST, DEV_TYPES, RES, applyAction, checkTransition, devCount, eventsFor, geo, legalRoads, legalSettlements, vertFree, checkInvariants, legalActions, mustDiscard, newGame, nextFloat, nextInt, rateFor, seedRng, total,
  viewFor, waitingOn, type Action, type GameEvent, type GameState, type NewPlayer, type PartialRes, type RngState, type Seat,
} from '../src/index'; // prettier-ignore

export interface SimResult {
  seed: string;
  ok: boolean;
  finished: boolean;
  turns: number;
  actions: number;
  winner: Seat | null;
  errors: string[];
  log: [Seat, Action][];
}

export interface SimOptions {
  /** Max turns before a game counts as stuck. */
  maxTurns?: number;
  /** Fraction of steps on which to run the expensive checks. */
  deepCheckRate?: number;
}

const COLORS = ['red', 'blue', 'white', 'purple'] as const;

export function seatsFor(n: number): NewPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, color: COLORS[i]!, nick: `P${i}` }));
}

const pick = <T>(rng: RngState, arr: readonly T[]): T => arr[nextInt(rng, arr.length)]!;
const chance = (rng: RngState, p: number) => nextFloat(rng) < p;

/** Weight for choosing among the turn player's legal actions. */
const WEIGHT: Record<Action['type'], number> = {
  setup: 1, roll: 1, robber: 1, freeRoad: 5, skipRoads: 0.2,
  city: 40, settlement: 40, buyDev: 6, road: 4,
  playKnight: 3, playRoads: 2, playPlenty: 2, playMono: 1,
  bank: 1.5, end: 3, confirm: 8, cancel: 0.5, respond: 2,
  discard: 1, offer: 1,
  ship: 6, freeShip: 5, moveShip: 1, pirate: 1, chooseGold: 1,
}; // prettier-ignore

function randomDiscard(s: GameState, p: Seat, rng: RngState): Action {
  const need = mustDiscard(s, p);
  const left = { ...s.players[p]!.res };
  const cards: PartialRes = {};
  for (let i = 0; i < need; i++) {
    const pool = RES.filter((r) => left[r] > 0);
    const r = pick(rng, pool);
    left[r]--;
    cards[r] = (cards[r] ?? 0) + 1;
  }
  return { type: 'discard', cards };
}

function randomOffer(s: GameState, p: Seat, rng: RngState): Action | null {
  const res = s.players[p]!.res;
  const haves = RES.filter((r) => res[r] > 0);
  if (!haves.length) return null;
  const give = pick(rng, haves);
  const wants = RES.filter((r) => r !== give);
  return {
    type: 'offer',
    give: { [give]: 1 + nextInt(rng, Math.min(2, res[give])) },
    want: { [pick(rng, wants)]: 1 },
  };
}

/** Bank trades that move the player toward something they want to build. */
function usefulBank(s: GameState, p: Seat): Set<string> {
  const res = s.players[p]!.res;
  const out = new Set<string>();
  for (const cost of [COST.city, COST.settlement, COST.dev, COST.road] as PartialRes[]) {
    const missing = RES.filter((r) => res[r] < (cost[r] ?? 0));
    if (!missing.length) return out; // can already afford the best target
    for (const give of RES) {
      if (res[give] - (cost[give] ?? 0) < rateFor(s, p, give)) continue;
      for (const get of missing) out.add(`${give}>${get}`);
    }
    if (out.size) return out;
  }
  return out;
}

/** Roads (paid or free) that reach a corner where a settlement could go. */
function roadsToSpots(s: GameState, p: Seat): Set<number> {
  const g = geo(s);
  const out = new Set<number>();
  if (legalSettlements(s, p).length) return out; // already have somewhere to build
  for (const e of legalRoads(s, p)) {
    const E = g.edges[e]!;
    if (vertFree(s, E.a) || vertFree(s, E.b)) out.add(e);
  }
  return out;
}

function weighted(rng: RngState, acts: Action[], useful: Set<string>, spotRoads: Set<number>): Action {
  const w = acts.map((a) => {
    if (a.type === 'bank') return useful.has(`${a.give}>${a.get}`) ? 30 : 0.1;
    if (a.type === 'road' || a.type === 'freeRoad') return spotRoads.has(a.e) ? 40 : 0.5;
    return WEIGHT[a.type];
  });
  let x = nextFloat(rng) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < acts.length; i++) {
    x -= w[i]!;
    if (x < 0) return acts[i]!;
  }
  return acts[acts.length - 1]!;
}

/** Choose who acts next and what they do. */
function chooseMove(s: GameState, rng: RngState): [Seat, Action] {
  if (s.stage === 'discard') {
    const p = pick(rng, waitingOn(s));
    return [p, randomDiscard(s, p, rng)];
  }
  // Sometimes let a non-turn player answer or make an offer.
  if (s.stage === 'main' && chance(rng, 0.15)) {
    const others = s.players.map((_, i) => i).filter((i) => i !== s.turn);
    const p = pick(rng, others);
    const acts = legalActions(s, p);
    if (acts.length && chance(rng, 0.8)) return [p, pick(rng, acts)];
    const offer = chance(rng, 0.3) ? randomOffer(s, p, rng) : null;
    if (offer) return [p, offer];
  }
  const p = s.turn;
  if (s.stage === 'main' && !s.offers.some((o) => o.from === p) && chance(rng, 0.05)) {
    const offer = randomOffer(s, p, rng);
    if (offer) return [p, offer];
  }
  const acts = legalActions(s, p).filter((a) => a.type !== 'respond' && a.type !== 'cancel');
  const main = s.stage === 'main';
  return [
    p,
    weighted(
      rng,
      acts,
      main ? usefulBank(s, p) : new Set(),
      main || s.stage === 'roads' ? roadsToSpots(s, p) : new Set(),
    ),
  ];
}

/** Garbage or out-of-turn actions must be rejected cleanly, never crash. */
function fuzzAction(s: GameState, rng: RngState): [Seat, Action] {
  const junk: unknown[] = [
    { type: 'road', e: nextInt(rng, 200) - 50 },
    { type: 'settlement', v: 1.5 },
    { type: 'city', v: nextInt(rng, 60) },
    { type: 'robber', hex: s.board.robber },
    { type: 'discard', cards: { wood: -1 } },
    { type: 'discard', cards: { gold: 1 } },
    { type: 'offer', give: { wood: 99 }, want: { ore: 1 } },
    { type: 'bank', give: 'wood', get: 'wood' },
    { type: 'playPlenty', r1: 'gold', r2: 'ore' },
    { type: 'confirm', id: 9999, with: 0 },
    { type: 'nonsense' },
    { type: 'roll' },
    { type: 'end' },
    null,
  ];
  return [nextInt(rng, s.players.length + 2) - 1, pick(rng, junk) as Action];
}

/** A copy of `s` with everything `seat` cannot see changed: other hands, dev cards, deck order. */
function perturbHidden(s: GameState, seat: Seat, rng: RngState): GameState {
  const t = structuredClone(s);
  const deckSize = Object.values(t.deck).reduce((a, b) => a + b, 0);
  t.deck = { knight: 0, road: 0, plenty: 0, mono: 0, vp: 0 };
  for (let i = 0; i < deckSize; i++) t.deck[pick(rng, DEV_TYPES)]++;
  t.players.forEach((pl, i) => {
    if (i === seat) return;
    const n = total(pl.res);
    pl.res = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    for (let k = 0; k < n; k++) pl.res[pick(rng, RES)]++;
    if (s.phase === 'play') {
      const d = devCount(pl);
      pl.vpCards = 0;
      pl.dev = { knight: 0, road: 0, plenty: 0, mono: 0 };
      pl.fresh = { knight: 0, road: 0, plenty: 0, mono: 0 };
      for (let k = 0; k < d; k++) {
        const c = pick(rng, DEV_TYPES);
        if (c === 'vp') pl.vpCards++;
        else (chance(rng, 0.5) ? pl.dev : pl.fresh)[c]++;
      }
    }
  });
  return t;
}

/** Changing what `seat` can't see must not change their view. */
function leakCheck(s: GameState, seat: Seat, rng: RngState): string | null {
  const t = perturbHidden(s, seat, rng);
  t.rng = [nextInt(rng, 1e9), 1, 2, 3];
  return JSON.stringify(viewFor(s, seat)) === JSON.stringify(viewFor(t, seat))
    ? null
    : `view for seat ${seat} reveals hidden information`;
}

/** Actions whose events must not depend on hidden information (steals, dev draws, dice). */
const EVENT_LEAK_TYPES = new Set<Action['type']>(['roll', 'robber', 'buyDev']);

/** Replaying the action with hidden info changed must give `seat` the same events. */
function eventLeakCheck(
  s: GameState,
  p: Seat,
  a: Action,
  events: GameEvent[],
  seat: Seat,
  rng: RngState,
): string | null {
  if (seat === p) return null;
  const t = perturbHidden(s, seat, rng);
  // The acting player's hand stays as it was, so the action is still legal.
  t.players[p] = structuredClone(s.players[p]!);
  const r = applyAction(t, p, a);
  if (!r.ok) return null;
  // Winning reveals the winner's VP cards by design.
  if (r.state.phase === 'over' || events.some((e) => e.k === 'win')) return null;
  const mine = JSON.stringify(eventsFor(events, seat));
  return mine === JSON.stringify(eventsFor(r.events, seat))
    ? null
    : `events for seat ${seat} reveal hidden information after ${JSON.stringify(a)}: ${mine}`;
}

export function simulate(seed: string, nPlayers: number, opts: SimOptions = {}): SimResult {
  const maxTurns = opts.maxTurns ?? 1500;
  const deep = opts.deepCheckRate ?? 0.03;
  const rng = seedRng(`agent:${seed}`);
  const errors: string[] = [];
  const log: [Seat, Action][] = [];
  let s = newGame(seed, seatsFor(nPlayers));
  const fail = (msg: string) => errors.push(`seq ${s.seq} turn ${s.turnN}: ${msg}`);

  let guard = 0;
  while (s.phase === 'play' && s.turnN <= maxTurns && !errors.length) {
    if (++guard > maxTurns * 200) {
      fail('too many actions without finishing');
      break;
    }

    if (chance(rng, 0.02)) {
      const [fp, fa] = fuzzAction(s, rng);
      const r = applyAction(s, fp, fa);
      if (!r.ok && r.error.startsWith('Something went wrong'))
        fail(`fuzz crashed: ${r.error} ${JSON.stringify(fa)}`);
      if (r.ok) {
        s = r.state;
        log.push([fp, fa]);
      }
    }

    if (chance(rng, deep)) {
      // Every enumerated action must be accepted.
      for (let p = 0; p < nPlayers; p++) {
        for (const a of legalActions(s, p)) {
          const r = applyAction(s, p, a);
          if (!r.ok) fail(`legal action rejected for ${p}: ${JSON.stringify(a)} -> ${r.error}`);
        }
      }
      const leak = leakCheck(s, nextInt(rng, nPlayers), rng);
      if (leak) fail(leak);
    }

    const [p, a] = chooseMove(s, rng);
    const before = chance(rng, deep) ? JSON.stringify(s) : null;
    const r = applyAction(s, p, a);
    if (before && before !== JSON.stringify(s)) fail('applyAction mutated its input');
    if (!r.ok) {
      // Offers are free-form and may legitimately be refused; everything else came from legalActions.
      if (a.type !== 'offer') fail(`chosen action rejected for ${p}: ${JSON.stringify(a)} -> ${r.error}`);
      continue;
    }
    if (EVENT_LEAK_TYPES.has(a.type)) {
      const leak = eventLeakCheck(s, p, a, r.events, (p + 1 + nextInt(rng, nPlayers - 1)) % nPlayers, rng);
      if (leak) fail(leak);
    }
    const prev = s;
    s = r.state;
    log.push([p, a]);
    const bad = [...checkInvariants(s), ...checkTransition(prev, s)];
    if (bad.length) bad.forEach((b) => fail(`after ${JSON.stringify(a)}: ${b}`));
  }

  const finished = s.phase === 'over';
  if (!finished && !errors.length) fail(`game did not finish within ${maxTurns} turns`);

  // Determinism: replaying the log from the seed gives the identical state.
  if (!errors.length) {
    let t = newGame(seed, seatsFor(nPlayers));
    for (const [rp, ra] of log) {
      const r = applyAction(t, rp, ra);
      if (!r.ok) {
        fail(`replay rejected ${JSON.stringify(ra)}: ${r.error}`);
        break;
      }
      t = r.state;
    }
    if (JSON.stringify(t) !== JSON.stringify(s)) fail('replay produced a different state');
  }

  return {
    seed,
    ok: errors.length === 0,
    finished,
    turns: s.turnN,
    actions: log.length,
    winner: s.winner,
    errors,
    log,
  };
}
