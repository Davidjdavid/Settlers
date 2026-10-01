/* Base-game rules. A typed port of the prototype's reducer, with seeded randomness and events. */

import { cloneJson } from './clone';
import { generateBaseBoard } from './board';
import {
  BANK_EACH, COST, DEV_COUNTS, PIECES, deckCount, geo, has, legalRoads, rateFor, robberVictims, roadLen,
  roadOK, settlementOK, snakeOrder, total, totalVP, vertFree, zeroRes,
} from './queries'; // prettier-ignore
import { nextInt, seedRng, shuffle, type RngState } from './rng';
import {
  COLORS, DEV_PLAY, DEV_TYPES, RES, type Action, type ApplyResult, type Color, type DevCounts, type GameConfig,
  type GameEvent, type GameState, type PartialRes, type Player, type Resource, type ResCounts, type Seat,
} from './types'; // prettier-ignore

/** Bump when a rules change would replay saved games differently. */
export const ENGINE_VERSION = 1;

export interface NewPlayer {
  pid: string;
  color: Color;
  nick: string;
}

const zeroDev = (): DevCounts => ({ knight: 0, road: 0, plenty: 0, mono: 0 });

/** Start a game. Turn order is shuffled from the seed. */
export function newGame(seed: string, seats: NewPlayer[], config: Partial<GameConfig> = {}): GameState {
  if (seats.length < 2 || seats.length > 4) throw new Error('A game needs 2 to 4 players');
  const colors = new Set(seats.map((x) => x.color));
  if (colors.size !== seats.length || seats.some((x) => !COLORS.includes(x.color))) {
    throw new Error('Each player needs a different color');
  }
  const rng: RngState = seedRng(seed);
  const order = shuffle(seats.slice(), rng);
  const board = generateBaseBoard(rng);
  const g = geo({ board } as GameState);
  return {
    v: 1,
    config: { winVP: 10, ...config },
    rng,
    seq: 0,
    phase: 'play',
    stage: 'setup',
    board,
    verts: new Array(g.verts.length).fill(null),
    edges: new Array(g.edges.length).fill(null),
    players: order.map((x): Player => ({
      pid: x.pid,
      color: x.color,
      nick: x.nick,
      res: zeroRes(),
      dev: zeroDev(),
      fresh: zeroDev(),
      vpCards: 0,
      knights: 0,
      played: { road: 0, plenty: 0, mono: 0 },
      pieces: { ...PIECES },
    })),
    bank: { wood: BANK_EACH, brick: BANK_EACH, sheep: BANK_EACH, wheat: BANK_EACH, ore: BANK_EACH },
    deck: { ...DEV_COUNTS },
    turn: 0,
    turnN: 0,
    setupI: 0,
    dice: null,
    discard: null,
    robberReturn: null,
    freeRoads: 0,
    roadsReturn: null,
    devPlayed: false,
    longest: null,
    largest: null,
    roadLens: order.map(() => 0),
    offers: [],
    offerN: 0,
    winner: null,
  };
}

/** Apply one action for `seat`. Never mutates `s0`. */
export function applyAction(s0: GameState, seat: Seat, action: Action): ApplyResult {
  const s = cloneJson(s0);
  const events: GameEvent[] = [];
  let error: string | null;
  try {
    error = reduce(s, seat, action, events);
  } catch (e) {
    error = `Something went wrong (${e instanceof Error ? e.message : String(e)})`;
  }
  if (error) return { ok: false, error };
  s.seq = s0.seq + 1;
  return { ok: true, state: s, events };
}

/* ---------- Input checks (actions arrive from the network) ---------- */

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isRes = (x: unknown): x is Resource => typeof x === 'string' && (RES as readonly string[]).includes(x);

function cleanCounts(obj: unknown): ResCounts | null {
  const out = zeroRes();
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!isRes(k)) return null;
    const n = o[k];
    if (n === undefined || n === 0) continue;
    if (!isInt(n) || n < 0 || n > BANK_EACH * 5) return null;
    out[k] = n;
  }
  return out;
}

/* ---------- Mutating helpers (only ever applied to the clone) ---------- */

function gain(s: GameState, p: Seat, r: Resource, n: number) {
  s.players[p]!.res[r] += n;
  s.bank[r] -= n;
}

function pay(s: GameState, p: Seat, cost: PartialRes) {
  for (const r of RES) {
    const n = cost[r] || 0;
    s.players[p]!.res[r] -= n;
    s.bank[r] += n;
  }
}

function updateLongest(s: GameState, events: GameEvent[]) {
  const lens = s.players.map((_, p) => roadLen(s, p));
  s.roadLens = lens;
  const max = Math.max(...lens);
  const prev = s.longest;
  let holder: Seat | null;
  if (max < 5) holder = null;
  else if (prev != null && lens[prev] === max) holder = prev;
  else {
    const top = lens.flatMap((l, p) => (l === max ? [p] : []));
    holder = top.length === 1 ? top[0]! : null;
  }
  if (holder !== prev) {
    s.longest = holder;
    events.push({ k: 'longest', p: holder, n: holder != null ? lens[holder]! : 0, from: prev });
  }
}

function updateLargest(s: GameState, p: Seat, events: GameEvent[]) {
  const k = s.players[p]!.knights;
  if (k < 3 || s.largest === p) return;
  if (s.largest == null || k > s.players[s.largest]!.knights) {
    const from = s.largest;
    s.largest = p;
    events.push({ k: 'largest', p, n: k, from });
  }
}

/** A player can only win on their own turn. */
function checkWin(s: GameState, events: GameEvent[]) {
  if (s.phase !== 'play' || s.stage === 'setup') return;
  const p = s.turn;
  const vp = totalVP(s, p);
  if (vp >= s.config.winVP) {
    s.phase = 'over';
    s.winner = p;
    s.offers = [];
    events.push({ k: 'win', p, vp });
  }
}

function produce(s: GameState, roll: number): { gains: Record<number, PartialRes>; short: Resource[] } {
  const g = geo(s);
  const owed = s.players.map(() => zeroRes());
  s.board.hexes.forEach((h, hi) => {
    if (h.n !== roll || hi === s.board.robber || h.t === 'desert') return;
    for (const v of g.hexVerts[hi]!) {
      const b = s.verts[v];
      if (b) owed[b[0]]![h.t] += b[1];
    }
  });
  const gains: Record<number, PartialRes> = {};
  const short: Resource[] = [];
  for (const r of RES) {
    const need = owed.reduce((a, o) => a + o[r], 0);
    if (!need) continue;
    const who = owed.flatMap((o, p) => (o[r] ? [p] : []));
    if (need <= s.bank[r]) {
      for (const p of who) {
        gain(s, p, r, owed[p]![r]);
        (gains[p] ??= {})[r] = owed[p]![r];
      }
    } else if (who.length === 1 && s.bank[r] > 0) {
      // Only one player is owed this resource: they get what's left.
      const p = who[0]!;
      const n = s.bank[r];
      gain(s, p, r, n);
      (gains[p] ??= {})[r] = n;
      short.push(r);
    } else {
      short.push(r);
    }
  }
  return { gains, short };
}

function stealRandom(s: GameState, from: Seat, to: Seat): Resource | null {
  const pool: Resource[] = [];
  for (const r of RES) for (let i = 0; i < s.players[from]!.res[r]; i++) pool.push(r);
  if (!pool.length) return null;
  const r = pool[nextInt(s.rng, pool.length)]!;
  s.players[from]!.res[r]--;
  s.players[to]!.res[r]++;
  return r;
}

function doTrade(
  s: GameState,
  a: Seat,
  b: Seat,
  giveA: ResCounts,
  wantA: ResCounts,
  events: GameEvent[],
): string | null {
  if (!has(s.players[a]!.res, giveA)) return 'The offer no longer has those cards';
  if (!has(s.players[b]!.res, wantA)) return 'The other side no longer has those cards';
  for (const r of RES) {
    s.players[a]!.res[r] += wantA[r] - giveA[r];
    s.players[b]!.res[r] += giveA[r] - wantA[r];
  }
  events.push({ k: 'trade', a, b, give: giveA, want: wantA });
  return null;
}

const notMain = (s: GameState) =>
  s.stage === 'preroll' ? 'Roll the dice first' : 'Finish what you’re doing first';

/* ---------- The reducer. Returns an error message, or null on success. ---------- */

function reduce(s: GameState, p: Seat, a: Action, events: GameEvent[]): string | null {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return 'Unknown action';
  if (s.phase === 'over') return 'This game is over';
  if (!isInt(p) || p < 0 || p >= s.players.length) return 'You are not in this game';
  const g = geo(s);
  const me = s.players[p]!;
  const myTurn = s.turn === p;

  switch (a.type) {
    case 'setup': {
      if (s.stage !== 'setup') return 'Setup is finished';
      if (!myTurn) return 'Wait for your turn';
      const { v, e } = a;
      if (!isInt(v) || v < 0 || v >= g.verts.length || !vertFree(s, v)) {
        return 'Settlements need a free corner with no neighbor next to it';
      }
      if (!isInt(e) || !g.verts[v]!.edges.includes(e) || s.edges[e] != null) {
        return 'The road must touch your new settlement';
      }
      s.verts[v] = [p, 1];
      me.pieces.settlement--;
      s.edges[e] = p;
      me.pieces.road--;
      let got: PartialRes | null = null;
      if (s.setupI >= s.players.length) {
        // Second settlement pays out its neighbors.
        got = {};
        for (const h of g.verts[v]!.hexes) {
          const t = s.board.hexes[h]!.t;
          if (t !== 'desert' && s.bank[t] > 0) {
            gain(s, p, t, 1);
            got[t] = (got[t] || 0) + 1;
          }
        }
      }
      events.push({ k: 'setup', p, v, e, got });
      s.setupI++;
      const order = snakeOrder(s.players.length);
      if (s.setupI >= order.length) {
        s.stage = 'preroll';
        s.turn = 0;
        s.turnN = 1;
        events.push({ k: 'turn', p: 0 });
      } else {
        s.turn = order[s.setupI]!;
      }
      s.roadLens = s.players.map((_, i) => roadLen(s, i));
      return null;
    }

    case 'roll': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'preroll') return s.stage === 'setup' ? 'Finish setup first' : 'You already rolled';
      const d1 = 1 + nextInt(s.rng, 6);
      const d2 = 1 + nextInt(s.rng, 6);
      s.dice = [d1, d2];
      events.push({ k: 'roll', p, d: [d1, d2] });
      if (d1 + d2 === 7) {
        const need: Record<number, number> = {};
        s.players.forEach((pl, i) => {
          const t = total(pl.res);
          if (t > 7) need[i] = Math.floor(t / 2);
        });
        s.robberReturn = 'main';
        if (Object.keys(need).length) {
          s.discard = need;
          s.stage = 'discard';
          events.push({ k: 'mustDiscard', need });
        } else {
          s.stage = 'robber';
        }
      } else {
        const out = produce(s, d1 + d2);
        events.push({ k: 'produce', gains: out.gains, short: out.short });
        s.stage = 'main';
      }
      return null;
    }

    case 'discard': {
      const need = s.discard?.[p];
      if (s.stage !== 'discard' || need == null) return 'You don’t need to discard';
      const c = cleanCounts(a.cards);
      if (!c) return 'Pick cards to discard';
      if (total(c) !== need) return `Choose exactly ${need} cards to discard`;
      if (!has(me.res, c)) return 'You don’t have those cards';
      pay(s, p, c);
      delete s.discard![p];
      events.push({ k: 'discard', p, c });
      if (!Object.keys(s.discard!).length) {
        s.discard = null;
        s.stage = 'robber';
      }
      return null;
    }

    case 'robber': {
      if (!myTurn || s.stage !== 'robber') return 'You can’t move the robber now';
      const h = a.hex;
      if (!isInt(h) || h < 0 || h >= s.board.hexes.length) return 'Pick a tile';
      if (h === s.board.robber) return 'Move the robber to a different tile';
      const victims = robberVictims(s, p, h);
      let victim: Seat | null = null;
      if (victims.length) {
        victim = victims.length === 1 && a.victim == null ? victims[0]! : (a.victim ?? -1);
        if (!victims.includes(victim)) return 'Choose who to steal from';
      }
      s.board.robber = h;
      events.push({ k: 'robber', p, h, victim });
      if (victim != null) {
        const r = stealRandom(s, victim, p);
        events.push({ k: 'steal', p, from: victim, r });
      }
      s.stage = s.robberReturn ?? 'main';
      s.robberReturn = null;
      return null;
    }

    case 'end': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'main') return notMain(s);
      for (const k of DEV_PLAY) {
        me.dev[k] += me.fresh[k];
        me.fresh[k] = 0;
      }
      s.offers = [];
      s.devPlayed = false;
      s.turn = (s.turn + 1) % s.players.length;
      s.stage = 'preroll';
      s.turnN++;
      events.push({ k: 'turn', p: s.turn });
      checkWin(s, events);
      return null;
    }

    case 'road': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'main') return notMain(s);
      if (!has(me.res, COST.road)) return 'A road costs 1 wood and 1 brick';
      if (me.pieces.road <= 0) return 'You have no roads left';
      if (!roadOK(s, p, a.e)) return 'Roads must connect to your own roads or buildings';
      pay(s, p, COST.road);
      s.edges[a.e] = p;
      me.pieces.road--;
      events.push({ k: 'build', p, what: 'road', at: a.e });
      updateLongest(s, events);
      checkWin(s, events);
      return null;
    }

    case 'settlement': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'main') return notMain(s);
      if (!has(me.res, COST.settlement)) return 'A settlement costs wood, brick, sheep and wheat';
      if (me.pieces.settlement <= 0) return 'You have no settlements left — upgrade one to a city';
      if (!settlementOK(s, p, a.v)) return 'Settlements need your road and no neighbor next door';
      pay(s, p, COST.settlement);
      s.verts[a.v] = [p, 1];
      me.pieces.settlement--;
      events.push({ k: 'build', p, what: 'settlement', at: a.v });
      updateLongest(s, events);
      checkWin(s, events);
      return null;
    }

    case 'city': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'main') return notMain(s);
      if (!has(me.res, COST.city)) return 'A city costs 2 wheat and 3 ore';
      if (me.pieces.city <= 0) return 'You have no cities left';
      const b = isInt(a.v) ? s.verts[a.v] : null;
      if (!b || b[0] !== p || b[1] !== 1) return 'Cities replace one of your settlements';
      pay(s, p, COST.city);
      s.verts[a.v] = [p, 2];
      me.pieces.city--;
      me.pieces.settlement++;
      events.push({ k: 'build', p, what: 'city', at: a.v });
      checkWin(s, events);
      return null;
    }

    case 'buyDev': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'main') return notMain(s);
      if (!has(me.res, COST.dev)) return 'A development card costs sheep, wheat and ore';
      const left = deckCount(s);
      if (!left) return 'The development deck is empty';
      pay(s, p, COST.dev);
      let x = nextInt(s.rng, left);
      let card = DEV_TYPES[0] as (typeof DEV_TYPES)[number];
      for (const k of DEV_TYPES) {
        if (x < s.deck[k]) {
          card = k;
          break;
        }
        x -= s.deck[k];
      }
      s.deck[card]--;
      if (card === 'vp') me.vpCards++;
      else me.fresh[card]++;
      events.push({ k: 'buyDev', p, card });
      checkWin(s, events);
      return null;
    }

    case 'playKnight':
    case 'playRoads':
    case 'playPlenty':
    case 'playMono': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'preroll' && s.stage !== 'main') return 'You can’t play a card right now';
      if (s.devPlayed) return 'You can play one development card per turn';
      const c = (
        { playKnight: 'knight', playRoads: 'road', playPlenty: 'plenty', playMono: 'mono' } as const
      )[a.type];
      if (me.dev[c] <= 0) {
        return me.fresh[c] > 0
          ? 'Cards bought this turn can be played next turn'
          : 'You don’t have that card';
      }
      const back = s.stage;
      if (a.type === 'playKnight') {
        me.dev.knight--;
        me.knights++;
        s.devPlayed = true;
        events.push({ k: 'playDev', p, card: c });
        updateLargest(s, p, events);
        s.robberReturn = back;
        s.stage = 'robber';
        checkWin(s, events);
        return null;
      }
      if (a.type === 'playRoads') {
        const n = Math.min(2, me.pieces.road);
        if (!n || !legalRoads(s, p).length) return 'You have nowhere to build a road';
        me.dev.road--;
        me.played.road++;
        s.devPlayed = true;
        s.freeRoads = n;
        s.roadsReturn = back;
        s.stage = 'roads';
        events.push({ k: 'playDev', p, card: c });
        return null;
      }
      if (a.type === 'playPlenty') {
        const picks = [a.r1, a.r2];
        if (!picks.every(isRes)) return 'Pick two resources';
        const need: PartialRes = {};
        for (const r of picks) need[r] = (need[r] || 0) + 1;
        if (!has(s.bank, need)) return 'The bank doesn’t have those';
        me.dev.plenty--;
        me.played.plenty++;
        s.devPlayed = true;
        for (const r of picks) gain(s, p, r, 1);
        events.push({ k: 'playDev', p, card: c });
        events.push({ k: 'plenty', p, got: need });
        return null;
      }
      {
        const r = a.r;
        if (!isRes(r)) return 'Pick a resource';
        me.dev.mono--;
        me.played.mono++;
        s.devPlayed = true;
        const from: Record<number, number> = {};
        s.players.forEach((pl, i) => {
          if (i === p || !pl.res[r]) return;
          from[i] = pl.res[r];
          me.res[r] += pl.res[r];
          pl.res[r] = 0;
        });
        events.push({ k: 'playDev', p, card: c });
        events.push({ k: 'mono', p, r, from });
        return null;
      }
    }

    case 'freeRoad': {
      if (!myTurn || s.stage !== 'roads') return 'You have no free roads to place';
      if (me.pieces.road <= 0) return 'You have no roads left';
      if (!roadOK(s, p, a.e)) return 'Roads must connect to your own roads or buildings';
      s.edges[a.e] = p;
      me.pieces.road--;
      s.freeRoads--;
      events.push({ k: 'build', p, what: 'road', at: a.e, free: true });
      updateLongest(s, events);
      if (s.freeRoads <= 0 || me.pieces.road <= 0 || !legalRoads(s, p).length) {
        s.stage = s.roadsReturn ?? 'main';
        s.freeRoads = 0;
        s.roadsReturn = null;
      }
      checkWin(s, events);
      return null;
    }

    case 'skipRoads': {
      if (!myTurn || s.stage !== 'roads') return 'You have no free roads to place';
      s.stage = s.roadsReturn ?? 'main';
      s.freeRoads = 0;
      s.roadsReturn = null;
      return null;
    }

    case 'bank': {
      if (!myTurn) return 'Trade with the bank on your own turn';
      if (s.stage !== 'main') return notMain(s);
      const { give, get } = a;
      if (!isRes(give) || !isRes(get) || give === get) return 'Pick two different resources';
      const rate = rateFor(s, p, give);
      if (me.res[give] < rate) return `You need ${rate} ${give} for this trade`;
      if (s.bank[get] < 1) return `The bank is out of ${get}`;
      me.res[give] -= rate;
      s.bank[give] += rate;
      gain(s, p, get, 1);
      events.push({ k: 'bank', p, give, n: rate, get });
      return null;
    }

    case 'offer': {
      if (s.stage !== 'main') return 'Trading opens after the roll';
      const give = cleanCounts(a.give);
      const want = cleanCounts(a.want);
      if (!give || !want || !total(give) || !total(want)) return 'Choose what you give and what you want';
      if (RES.some((r) => give[r] && want[r])) return 'You can’t give and ask for the same resource';
      if (!has(me.res, give)) return 'You don’t have those cards';
      s.offers = s.offers.filter((o) => o.from !== p);
      s.offerN++;
      const offer = { id: s.offerN, from: p, give, want, resp: {} };
      s.offers.push(offer);
      events.push({ k: 'offer', offer: cloneJson(offer) });
      return null;
    }

    case 'respond': {
      const o = s.offers.find((x) => x.id === a.id);
      if (!o) return 'That offer is gone';
      if (s.stage !== 'main') return 'Finish what you’re doing first';
      if (o.from === p) return 'That’s your own offer';
      const yes = a.yes === true;
      if (o.from === s.turn) {
        // Offer from the current player: record the answer; they confirm later.
        if (yes && !has(me.res, o.want)) return 'You don’t have what they asked for';
        o.resp[p] = yes ? 1 : 0;
        events.push({ k: 'respond', id: o.id, p, yes });
        return null;
      }
      // Offer to the current player from someone else: accepting trades at once.
      if (!myTurn) return 'Only the player whose turn it is can take this offer';
      if (!yes) {
        o.resp[p] = 0;
        events.push({ k: 'respond', id: o.id, p, yes });
        return null;
      }
      if (!has(s.players[o.from]!.res, o.give)) return 'They no longer have the cards they offered';
      if (!has(me.res, o.want)) return 'You don’t have the cards they asked for';
      const err = doTrade(s, o.from, p, o.give, o.want, events);
      if (err) return err;
      s.offers = s.offers.filter((x) => x.id !== o.id);
      return null;
    }

    case 'confirm': {
      const o = s.offers.find((x) => x.id === a.id);
      if (!o) return 'That offer is gone';
      if (o.from !== p || !myTurn) return 'Only the player who made the offer can confirm it';
      if (s.stage !== 'main') return 'Finish what you’re doing first';
      const w = a.with;
      if (!isInt(w) || o.resp[w] !== 1) return 'They haven’t accepted this offer';
      if (!has(me.res, o.give))
        return 'You no longer have the cards you offered. Withdraw it or make a new offer.';
      if (!has(s.players[w]!.res, o.want)) return 'They no longer have the cards you asked for';
      const err = doTrade(s, p, w, o.give, o.want, events);
      if (err) return err;
      s.offers = s.offers.filter((x) => x.id !== o.id);
      return null;
    }

    case 'cancel': {
      const o = s.offers.find((x) => x.id === a.id);
      if (!o) return 'That offer is gone';
      if (o.from !== p) return 'You can only withdraw your own offer';
      s.offers = s.offers.filter((x) => x.id !== o.id);
      events.push({ k: 'cancelOffer', id: o.id });
      return null;
    }

    default:
      return 'Unknown action';
  }
}
