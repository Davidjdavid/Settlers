/*
 * Random-game simulator. Plays full games with a seeded random agent and checks, after every
 * action: invariants, that every legal action is accepted, that the input state is not
 * mutated, that views leak nothing, and that the whole game replays identically.
 */

import {
  COST, DEV_TYPES, RES, TRACKS, applyAction, cardKinds, ckDiscardDue, cloneJson, checkTransition, devCount, eventsFor, firstOwe, geo, goldDue, legalRoads, legalSettlements, legalShips, progressColors, vertFree, vertexOK, checkInvariants, legalActions, mustDiscard, newGame, nextFloat, nextInt, rateFor, seedRng, shuffle, total,
  PROGRESS, viewFor, waitingOn, type Action, type Cards, type GameConfig, type GameEvent, type GameState, type HouseRules, type MapData, type ModuleId, type NewPlayer, type PartialRes, type Progress, type RngState, type Seat,
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
  /** Play on this map (default: the classic board). */
  map?: MapData;
  houseRules?: HouseRules;
  /** Modules (default: the map's). */
  modules?: ModuleId[];
  winVP?: number;
}

export function configFor(opts: SimOptions): Partial<GameConfig> {
  const c: Partial<GameConfig> = {};
  if (opts.map) c.map = opts.map;
  if (opts.modules) c.modules = opts.modules;
  if (opts.winVP) c.winVP = opts.winVP;
  if (opts.houseRules && Object.keys(opts.houseRules).length) c.houseRules = opts.houseRules;
  return c;
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
  improve: 25, wall: 4, knight: 6, promote: 4, activate: 5, moveKnight: 1.5, chase: 3,
  dropProgress: 1, progress: 4, choose: 1,
}; // prettier-ignore

function randomCards(s: GameState, p: Seat, need: number, rng: RngState): Cards {
  const left = { ...s.players[p]!.res };
  const cards: Cards = {};
  for (let i = 0; i < need; i++) {
    const pool = cardKinds(s).filter((r) => left[r]! > 0);
    const r = pick(rng, pool);
    left[r]!--;
    cards[r] = (cards[r] ?? 0) + 1;
  }
  return cards;
}

function randomDiscard(s: GameState, p: Seat, rng: RngState): Action {
  return { type: 'discard', cards: randomCards(s, p, mustDiscard(s, p), rng) };
}

export function randomOffer(s: GameState, p: Seat, rng: RngState): Action | null {
  const res = s.players[p]!.res;
  const haves = cardKinds(s).filter((r) => res[r]! > 0);
  if (!haves.length) return null;
  const give = pick(rng, haves);
  const wants = cardKinds(s).filter((r) => r !== give);
  return {
    type: 'offer',
    give: { [give]: 1 + nextInt(rng, Math.min(2, res[give]!)) },
    want: { [pick(rng, wants)]: 1 },
  };
}

/** Bank trades that move the player toward something they want to build. */
function usefulBank(s: GameState, p: Seat): Set<string> {
  const res = s.players[p]!.res;
  const out = new Set<string>();
  const goals = (s.ck ? [COST.city, COST.settlement, { sheep: 1, ore: 1 }, COST.road] : [COST.city, COST.settlement, COST.dev, COST.road]) as PartialRes[]; // prettier-ignore
  for (const cost of goals) {
    const missing = RES.filter((r) => res[r] < (cost[r] ?? 0));
    if (!missing.length) return out; // can already afford the best target
    for (const give of cardKinds(s)) {
      if (res[give]! - ((cost as Cards)[give] ?? 0) < rateFor(s, p, give)) continue;
      for (const get of missing) out.add(`${give}>${get}`);
    }
    if (out.size) return out;
  }
  return out;
}

/** Roads and ships (paid or free) that reach a corner where a settlement could go. */
function piecesToSpots(s: GameState, p: Seat): Set<number> {
  const g = geo(s);
  const out = new Set<number>();
  if (legalSettlements(s, p).length) return out; // already have somewhere to build
  const spot = (v: number) => vertFree(s, v) && vertexOK(s, v);
  const edges = s.sea ? [...legalRoads(s, p), ...legalShips(s, p)] : legalRoads(s, p);
  for (const e of edges) {
    const E = g.edges[e]!;
    if (spot(E.a) || spot(E.b)) out.add(e);
  }
  return out;
}

function randomGold(s: GameState, p: Seat, rng: RngState): Action {
  const bank = { ...s.bank };
  const cards: Cards = {};
  for (let i = 0; i < goldDue(s, p); i++) {
    const r = pick(
      rng,
      RES.filter((x) => bank[x] > 0),
    );
    bank[r]--;
    cards[r] = (cards[r] ?? 0) + 1;
  }
  return { type: 'chooseGold', cards };
}

function weighted(
  rng: RngState,
  acts: Action[],
  useful: Set<string>,
  spotRoads: Set<number>,
  threat = false,
): Action {
  // Types with many options (ship moves, pirate spots) share their weight instead of multiplying it.
  const explore = !spotRoads.size && !acts.some((a) => a.type === 'settlement');
  const per: Partial<Record<string, number>> = {};
  const key = (a: Action) => (a.type === 'progress' ? `progress:${a.card}` : a.type);
  for (const a of acts) if (SHARED.has(a.type)) per[key(a)] = (per[key(a)] ?? 0) + 1;
  const w = acts.map((a) => {
    // With the barbarians close, knights matter (Cities & Knights).
    if (threat && a.type === 'activate') return 30;
    if (threat && a.type === 'knight') return 20 / per[key(a)]!;
    if (SHARED.has(a.type)) return WEIGHT[a.type] / per[key(a)]!;
    if (a.type === 'bank') return useful.has(`${a.give}>${a.get}`) ? 30 : 0.1;
    if (a.type === 'road' || a.type === 'freeRoad') return spotRoads.has(a.e) ? 40 : 0.5;
    // Ships reaching a building spot are best; with nowhere left to build, explore by sea.
    if (a.type === 'ship' || a.type === 'freeShip') return spotRoads.has(a.e) ? 40 : explore ? 25 : 0.5;
    if (a.type === 'setup' && a.ship) return 0.3;
    return WEIGHT[a.type];
  });
  let x = nextFloat(rng) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < acts.length; i++) {
    x -= w[i]!;
    if (x < 0) return acts[i]!;
  }
  return acts[acts.length - 1]!;
}

const SHARED = new Set<Action['type']>([
  'moveShip',
  'pirate',
  'moveKnight',
  'chase',
  'progress',
  'knight',
  'choose',
]);

/** Choose who acts next and what they do. */
function chooseMove(s: GameState, rng: RngState): [Seat, Action] {
  if (s.stage === 'discard') {
    const p = pick(rng, waitingOn(s));
    return [p, randomDiscard(s, p, rng)];
  }
  if (s.stage === 'ck') {
    const p = pick(rng, waitingOn(s));
    const due = ckDiscardDue(s, p);
    if (due) return [p, { type: 'choose', cards: randomCards(s, p, due, rng) }];
    return [p, pick(rng, legalActions(s, p))];
  }
  if (s.stage === 'gold') {
    const p = pick(rng, waitingOn(s));
    return [p, randomGold(s, p, rng)];
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
      main || s.stage === 'roads' ? piecesToSpots(s, p) : new Set(),
      !!s.ck && s.ck.barb >= 3,
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
    { type: 'improve', track: 'nope' },
    { type: 'progress', card: 'printer' },
    { type: 'progress', card: 'smith', vs: [1, 1] },
    { type: 'choose', cards: { coin: -2 } },
    { type: 'moveKnight', from: -1, to: 3 },
    { type: 'roll' },
    { type: 'end' },
    null,
  ];
  return [nextInt(rng, s.players.length + 2) - 1, pick(rng, junk) as Action];
}

/** Random placement-type actions (most are illegal) for checking the reducer rejects them. */
function randomCandidates(s: GameState, rng: RngState): [Seat, Action][] {
  const nE = s.edges.length;
  const nV = s.verts.length;
  const nH = s.board.hexes.length;
  const out: [Seat, Action][] = [];
  for (let i = 0; i < 12; i++) {
    const p = chance(rng, 0.7) ? s.turn : nextInt(rng, s.players.length);
    const e = nextInt(rng, nE);
    const v = nextInt(rng, nV);
    const h = nextInt(rng, nH);
    const cands: Action[] = [
      { type: 'road', e },
      { type: 'settlement', v },
      { type: 'city', v },
      { type: 'robber', hex: h },
      { type: 'freeRoad', e },
      { type: 'setup', v, e: geo(s).verts[v]!.edges[0]! },
    ];
    if (s.ck) {
      const mine = s.ck.knights.flatMap((k, x) => (k && k.p === p ? [x] : []));
      const kv = mine.length && chance(rng, 0.8) ? pick(rng, mine) : v;
      cands.push(
        { type: 'knight', v },
        { type: 'wall', v },
        { type: 'promote', v: kv },
        { type: 'activate', v: kv },
        { type: 'moveKnight', from: kv, to: v },
        { type: 'chase', v: kv, hex: h },
        { type: 'improve', track: pick(rng, TRACKS) },
        { type: 'improve', track: pick(rng, TRACKS), v },
      );
    }
    if (s.sea) {
      const mine = s.sea.ships.flatMap((o, x) => (o === p ? [x] : []));
      const from = mine.length && chance(rng, 0.8) ? pick(rng, mine) : nextInt(rng, nE);
      cands.push(
        { type: 'ship', e },
        { type: 'freeShip', e },
        { type: 'moveShip', from, to: e },
        { type: 'pirate', hex: h },
        { type: 'setup', v, e: geo(s).verts[v]!.edges[0]!, ship: true },
      );
    }
    out.push([p, pick(rng, cands)]);
  }
  return out;
}

/** A copy of `s` with everything `seat` cannot see changed: other hands, dev cards, deck order. */
export function perturbHidden(s: GameState, seat: Seat, rng: RngState, decks = true): GameState {
  const t = cloneJson(s);
  if (t.sea) {
    // Fog stays secret: a different stack of the same size must look the same.
    const terr = ['sea', 'gold', ...RES, 'desert'] as const;
    t.sea.fog = {
      terrain: t.sea.fog.terrain.map(() => pick(rng, terr)),
      numbers: t.sea.fog.numbers.map(() => 2 + nextInt(rng, 11)),
    };
  }
  if (t.ck) {
    // Deck order is secret; so are other players' progress cards (only their colours show),
    // except what this seat may see while choosing (Spy, Master Merchant).
    const o = firstOwe(s, seat);
    const seen = o?.k === 'spy' || o?.k === 'take' ? o.from : null;
    if (decks) for (const tr of TRACKS) t.ck.decks[tr] = shuffle(t.ck.decks[tr], rng);
    t.players.forEach((_, i) => {
      if (i === seat || (i === seen && o?.k === 'spy')) return;
      const col = progressColors(s, i);
      t.ck!.hands[i] = TRACKS.flatMap((tr) =>
        Array.from(
          { length: col[tr] },
          () =>
            pick(
              rng,
              Object.keys(PROGRESS[tr]).filter((k) => k !== 'printer' && k !== 'constitution'),
            ) as Progress,
        ),
      );
    });
  }
  const deckSize = Object.values(t.deck).reduce((a, b) => a + b, 0);
  t.deck = { knight: 0, road: 0, plenty: 0, mono: 0, vp: 0 };
  for (let i = 0; i < deckSize; i++) t.deck[pick(rng, DEV_TYPES)]++;
  const o = t.ck ? firstOwe(s, seat) : null;
  t.players.forEach((pl, i) => {
    if (i === seat || (o?.k === 'take' && o.from === i)) return;
    const n = total(pl.res);
    const kinds = cardKinds(s);
    for (const k of kinds) pl.res[k] = 0;
    for (let k = 0; k < n; k++) pl.res[pick(rng, kinds)]!++;
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
const EVENT_LEAK_TYPES = new Set<Action['type']>([
  'roll',
  'robber',
  'buyDev',
  'pirate',
  'chase',
  'progress',
  'choose',
]);

/**
 * Cards whose effect shows what other players hold, as at the table: monopolies (how many each
 * gave) and Commercial Harbor (who has a commodity to give back).
 */
function revealsByDesign(s: GameState, p: Seat, a: Action): boolean {
  if (a.type === 'progress')
    return ['resourceMonopoly', 'tradeMonopoly', 'commercialHarbor'].includes(a.card);
  return a.type === 'choose' && firstOwe(s, p)?.k === 'harbor';
}

/** Replaying the action with hidden info changed must give `seat` the same events. */
function eventLeakCheck(
  s: GameState,
  p: Seat,
  a: Action,
  events: GameEvent[],
  seat: Seat,
  rng: RngState,
): string | null {
  if (seat === p || revealsByDesign(s, p, a)) return null;
  // The deck stays as it is: a player's own draw shows them the top card, by design.
  const t = perturbHidden(s, seat, rng, false);
  // The acting player's hand stays as it was, so the action is still legal.
  t.players[p] = cloneJson(s.players[p]!);
  if (t.ck) t.ck.hands[p] = s.ck!.hands[p]!.slice();
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
  const config = configFor(opts);
  let s = newGame(seed, seatsFor(nPlayers), config);
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
      // ...and nothing outside the list may be accepted (handler and list must agree).
      for (const [cp, ca] of randomCandidates(s, rng)) {
        // A robber/pirate move without a victim is shorthand for the only possible victim.
        const key = (a: Action) =>
          JSON.stringify(
            a.type === 'robber' || a.type === 'pirate' || a.type === 'chase'
              ? { ...a, victim: undefined }
              : a,
          );
        const listed = legalActions(s, cp).some((a) => key(a) === key(ca));
        if (!listed && applyAction(s, cp, ca).ok)
          fail(`accepted an unlisted action for ${cp}: ${JSON.stringify(ca)}`);
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
    // Steals and dev draws are checked every time; rolls (very frequent) on sampled steps.
    if (EVENT_LEAK_TYPES.has(a.type) && (a.type !== 'roll' || chance(rng, deep * 3))) {
      const leak = eventLeakCheck(s, p, a, r.events, (p + 1 + nextInt(rng, nPlayers - 1)) % nPlayers, rng);
      if (leak) fail(leak);
    }
    const prev = s;
    s = r.state;
    log.push([p, a]);
    const bad = [...checkInvariants(s, prev), ...checkTransition(prev, s)];
    if (bad.length) bad.forEach((b) => fail(`after ${JSON.stringify(a)}: ${b}`));
  }

  const finished = s.phase === 'over';
  if (!finished && !errors.length) fail(`game did not finish within ${maxTurns} turns`);

  // Determinism: replaying the log from the seed gives the identical state.
  if (!errors.length) {
    let t = newGame(seed, seatsFor(nPlayers), config);
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
