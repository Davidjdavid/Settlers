/* Base-game rules. A typed port of the prototype's reducer, with seeded randomness and events.
 * Expansion modules extend it through the hooks in modules/api.ts. */

import classicMap from '../maps/classic.json';
import { cloneJson } from './clone';
import { boardFromMap, type MapData } from './map';
import { mods, type Ctx } from './modules/api';
import './modules';
import {
  afterFreePiece, checkWin, cleanCounts, continueRoll, finishFreePieces, finishRobber, gain, isInt, isRes, pay,
  stealRandom, updateLargest, updateLongest,
} from './ops'; // prettier-ignore
import {
  BANK_EACH, UNLIMITED, COST, DEV_COUNTS, PIECES, canPlaceFreePiece, cardKinds, deckCount, devCardsOn, freePieceSupply, geo, has,
  keepMinTarget, publicVP, rateFor, roadEdgeOK, roadOK, robberAwake, robberHexOK, robberVictims, routeLen, totalVP, settlementOK, setupVertOK, snakeOrder, total,
  vertFree, vertexOK, zeroRes,
} from './queries'; // prettier-ignore
import { nextInt, seedRng, shuffle, type RngState } from './rng';
import {
  COLORS, DEV_PLAY, DEV_TYPES, RES, RULE_KEYS, isResource, type Action, type ApplyResult, type Card, type Color, type DevCounts,
  type GameConfig, type GameEvent, type GameState, type Hand, type KeepPlaying, type PartialRes, type Player, type Seat,
} from './types'; // prettier-ignore

/** Bump when a rules change would replay saved games differently. */
// 2: rolls use dice supplied by the server (SPEC 5.3). Games saved by version 1 have rolls
// without dice, which still roll from the game's PRNG exactly as before.
export const ENGINE_VERSION = 2;

/** The error when a roll needs more server dice than it was given (a long run of re-rolled 7s). */
export const NEED_DICE = 'More dice needed';
class NeedDice extends Error {}

export const CLASSIC_MAP = classicMap as MapData;

export interface NewPlayer {
  pid: string;
  color: Color;
  nick: string;
  cpu?: boolean;
}

const zeroDev = (): DevCounts => ({ knight: 0, road: 0, plenty: 0, mono: 0 });

/**
 * Start a game. Turn order is shuffled from the seed, or the seats' own order with
 * `config.order: 'given'`. Without `config.map` this is the classic
 * board, and the config stays exactly { winVP } so classic games replay as they always have.
 */
export function newGame(seed: string, seats: NewPlayer[], config: Partial<GameConfig> = {}): GameState {
  const map = config.map ?? CLASSIC_MAP;
  if (!map.players.includes(seats.length)) {
    throw new Error(`${map.name} is for ${map.players.join(', ')} players`);
  }
  const colors = new Set(seats.map((x) => x.color));
  if (colors.size !== seats.length || seats.some((x) => !COLORS.includes(x.color))) {
    throw new Error('Each player needs a different color');
  }
  const cfg: GameConfig = { winVP: config.map ? map.winVP : 10, ...config };
  if (config.map && !config.modules && map.modules.length) cfg.modules = map.modules;
  // A map with treasure spots plays with treasures, in every mode (docs/rules/treasures.md D8).
  if (map.treasures?.length && !cfg.modules?.includes('treasures'))
    cfg.modules = [...(cfg.modules ?? []), 'treasures'];
  for (const m of mods({ config: cfg })) {
    if (m.players && !m.players.includes(seats.length))
      throw new Error(`This game is for ${m.players.join(' or ')} players`);
  }
  const rng: RngState = seedRng(seed);
  const order = config.order === 'given' ? seats.slice() : shuffle(seats.slice(), rng);
  const { board, fog } = boardFromMap(map, rng);
  const g = geo({ board } as GameState);
  const s: GameState = {
    v: 1,
    config: cfg,
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
      ...(x.cpu ? { cpu: true as const } : {}),
    })),
    bank: Object.fromEntries(
      RES.map((r) => [r, config.bank === 'unlimited' ? UNLIMITED : BANK_EACH]),
    ) as Hand,
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
  for (const m of mods(s)) m.init?.(s, fog);
  return s;
}

/** Apply one action for `seat`. Never mutates `s0`. */
export function applyAction(s0: GameState, seat: Seat, action: Action): ApplyResult {
  const s = cloneJson(s0);
  const events: GameEvent[] = [];
  let error: string | null;
  try {
    error = reduce(s, seat, action, events);
  } catch (e) {
    if (e instanceof NeedDice) error = NEED_DICE;
    else error = `Something went wrong (${e instanceof Error ? e.message : String(e)})`;
  }
  if (error) return { ok: false, error };
  if (s.phase === 'play') {
    const ms = mods(s).filter((m) => m.afterAction);
    if (ms.length) {
      const x: Ctx = {
        s, p: seat, me: s.players[seat]!, myTurn: s.turn === seat, events,
        die: () => { throw new Error('no dice after a move'); },
      }; // prettier-ignore
      for (const m of ms) m.afterAction!(x);
    }
  }
  keepForHandBack(s0, s, seat, action);
  keepForUndo(s0, s, seat, action, events);
  s.seq = s0.seq + 1;
  return { ok: true, state: s, events };
}

/** Actions that leave a pending hand-back alone. */
const BACK_ACTIONS = new Set<Action['type']>([
  'askBack', 'handBack', 'refuseBack', 'setRule', 'askUndo', 'answerUndo', 'cancelUndo',
]); // prettier-ignore

/** Moves that can be undone (SPEC 5.10), as long as they revealed nothing hidden. */
const UNDOABLE = new Set<Action['type']>([
  'setup', 'road', 'ship', 'settlement', 'city', 'freeRoad', 'freeShip', 'moveShip', 'robber', 'pirate',
  'knight', 'wall', 'promote', 'activate', 'moveKnight', 'improve', 'bank',
]); // prettier-ignore
/** Events that mean a move showed something hidden (or can't be taken back), so no undo. */
const REVEALING = new Set<GameEvent['k']>([
  'roll', 'produce', 'steal', 'buyDev', 'draw', 'discover', 'spy', 'give', 'gold', 'goldOwed', 'win', 'trade',
  'eventDie', 'attack', 'treasure', 'treasureDev', 'treasureGot',
]); // prettier-ignore
const UNDO_ACTIONS = new Set<Action['type']>(['askUndo', 'answerUndo', 'cancelUndo']);

/**
 * Undo (SPEC 5.10): after an undoable move, keep the game as it was before it until anyone
 * makes another move. Games without the rule never get it.
 */
function keepForUndo(s0: GameState, s: GameState, p: Seat, a: Action, events: GameEvent[]) {
  if (UNDO_ACTIONS.has(a.type)) return;
  if (
    s.phase === 'play' &&
    s.config.houseRules?.undo &&
    UNDOABLE.has(a.type) &&
    !events.some((e) => REVEALING.has(e.k))
  ) {
    const { undo: _old, ...before } = s0;
    void _old;
    s.undo = { p, asked: false, ok: [], state: cloneJson(before) };
  } else delete s.undo;
}

/** Everyone else has said yes (people answer; CPUs always agree): put the game back. */
function undoIfAgreed(s: GameState, events: GameEvent[]) {
  const u = s.undo!;
  const others = s.players.map((_, i) => i).filter((i) => i !== u.p);
  if (!others.every((i) => u.ok.includes(i))) return;
  const config = s.config;
  const before = u.state!;
  for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
  Object.assign(s, before, { config });
  events.push({ k: 'undo', p: u.p });
}

/**
 * Handing the dice back (SPEC 4.4): ending a turn (or, if allowed, a starting placement) keeps
 * the game as it was before, until the next move by anyone. Games without the rule never get it.
 */
function keepForHandBack(s0: GameState, s: GameState, p: Seat, a: Action) {
  if (BACK_ACTIONS.has(a.type)) return;
  const hr = s.config.houseRules;
  if (s.phase === 'play' && hr?.handBack && (a.type === 'end' || (a.type === 'setup' && hr.handBackSetup))) {
    const { back: _old, undo: _undo, ...before } = s0;
    void _old;
    void _undo;
    s.back = { from: p, asked: false, refused: false, state: cloneJson(before) };
  } else delete s.back;
}

/** Change one game rule (SPEC 4.5). Returns an error or null. */
function setRule(
  s: GameState,
  p: Seat,
  a: Extract<Action, { type: 'setRule' }>,
  events: GameEvent[],
): string | null {
  const { rule, value } = a;
  if (!(RULE_KEYS as readonly string[]).includes(rule)) return 'Unknown rule';
  const sea = mods(s).some((m) => m.id === 'seafarers');
  const ck = mods(s).some((m) => m.id === 'citiesKnights');
  if (rule === 'freeShipMoves' && !sea) return 'That rule is for Seafarers';
  if ((rule === 'rerollBeforeAttack' || rule === 'noDiscardBeforeAttack' || rule === 'barbarianDelay') && !ck)
    return 'That rule is for Cities & Knights';
  for (const m of mods(s)) {
    const why = m.ruleChangeBlock?.(s, rule, value);
    if (why) return why;
  }
  if (rule === 'winVP') {
    if (!isInt(value) || value < 3 || value > 30) return 'Points to win must be 3 to 30';
    const top = Math.max(totalVP(s, p), ...s.players.map((_, i) => publicVP(s, i)));
    if (value <= top) return `Points to win must be more than ${top}, the top score`;
    s.config.winVP = value;
  } else {
    if (rule === 'barbarianDelay' ? !isInt(value) || value < 0 || value > 10 : typeof value !== 'boolean')
      return 'That isn’t a valid setting';
    const hr = { ...(s.config.houseRules ?? {}) } as Record<string, unknown>;
    if (value === false || value === 0) delete hr[rule];
    else hr[rule] = value;
    if (Object.keys(hr).length) s.config.houseRules = hr;
    else delete s.config.houseRules;
    if (rule === 'handBack' && !value) delete s.back;
    if (rule === 'undo' && !value) delete s.undo;
  }
  events.push({ k: 'rule', p, rule, value });
  return null;
}

function doTrade(
  s: GameState,
  a: Seat,
  b: Seat,
  giveA: Hand,
  wantA: Hand,
  events: GameEvent[],
): string | null {
  if (!has(s.players[a]!.res, giveA)) return 'The offer no longer has those cards';
  if (!has(s.players[b]!.res, wantA)) return 'The other side no longer has those cards';
  for (const r of cardKinds(s)) {
    s.players[a]!.res[r]! += (wantA[r] ?? 0) - (giveA[r] ?? 0);
    s.players[b]!.res[r]! += (giveA[r] ?? 0) - (wantA[r] ?? 0);
  }
  events.push({ k: 'trade', a, b, give: giveA, want: wantA });
  return null;
}

const notMain = (s: GameState) =>
  s.stage === 'preroll' ? 'Roll the dice first' : 'Finish what you’re doing first';

/* ---------- Keep playing after a win (SPEC 8.9) ---------- */

/** The highest target anyone may pick: well above any real game. */
export const KEEP_MAX = 99;

function keepPlaying(
  s: GameState,
  p: Seat,
  a: Extract<Action, { type: 'askKeep' | 'answerKeep' | 'cancelKeep' }>,
  events: GameEvent[],
): string | null {
  if (s.phase !== 'over' || s.winner == null) return 'The game isn’t over';
  const k = s.keep;
  switch (a.type) {
    case 'askKeep': {
      if (k?.ask) return 'Someone already asked';
      const t = a.target;
      if (!isInt(t) || t < keepMinTarget(s) || t > KEEP_MAX)
        return `Pick a target from ${keepMinTarget(s)} to ${KEEP_MAX}`;
      const keep: KeepPlaying = k ?? {
        first: { p: s.winner, vp: totalVP(s, s.winner), target: s.config.winVP, seq: s.seq },
        on: false,
        wins: [],
      };
      // CPUs always agree.
      keep.ask = { p, target: t, ok: [p, ...s.players.flatMap((pl, i) => (i !== p && pl.cpu ? [i] : []))] };
      s.keep = keep;
      events.push({ k: 'askKeep', p, target: t });
      resumeIfAgreed(s, events);
      return null;
    }
    case 'answerKeep': {
      if (!k?.ask) return 'Nobody asked to keep playing';
      if (k.ask.ok.includes(p)) return 'You already said yes';
      if (typeof a.yes !== 'boolean') return 'Say yes or no';
      events.push({ k: 'answerKeep', p, yes: a.yes });
      if (!a.yes) {
        delete k.ask;
        return null;
      }
      k.ask.ok.push(p);
      resumeIfAgreed(s, events);
      return null;
    }
    case 'cancelKeep': {
      if (!k?.ask || k.ask.p !== p) return 'You haven’t asked to keep playing';
      delete k.ask;
      events.push({ k: 'cancelKeep', p });
      return null;
    }
  }
}

/** Everyone has agreed: play on from exactly where the game stopped, to the new target. */
function resumeIfAgreed(s: GameState, events: GameEvent[]) {
  const k = s.keep!;
  const ask = k.ask!;
  if (!s.players.every((_, i) => ask.ok.includes(i))) return;
  delete k.ask;
  k.on = true;
  events.push({ k: 'keepPlaying', target: ask.target, from: s.config.winVP });
  s.config.winVP = ask.target;
  s.phase = 'play';
  s.winner = null;
}

/* ---------- The reducer. Returns an error message, or null on success. ---------- */

function reduce(s: GameState, p: Seat, a: Action, events: GameEvent[]): string | null {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return 'Unknown action';
  if (!isInt(p) || p < 0 || p >= s.players.length) return 'You are not in this game';
  if (a.type === 'askKeep' || a.type === 'answerKeep' || a.type === 'cancelKeep')
    return keepPlaying(s, p, a, events);
  if (s.phase === 'over') return 'This game is over';
  const g = geo(s);
  const me = s.players[p]!;
  const myTurn = s.turn === p;
  const given = a.type === 'roll' ? a.dice : undefined;
  const used = { number: 0, event: 0 };
  const die = (kind: 'number' | 'event'): number => {
    if (!given) return 1 + nextInt(s.rng, 6);
    const v = (kind === 'number' ? given.d : given.e)?.[used[kind]++];
    if (v === undefined) throw new NeedDice();
    return v;
  };
  const x: Ctx = { s, p, me, myTurn, events, die };

  // Expansion actions first; a module returns undefined for actions that aren't its own.
  for (const m of mods(s)) {
    const r = m.reduce?.(x, a);
    if (r !== undefined) return r;
  }

  switch (a.type) {
    case 'askBack': {
      const b = s.back;
      if (!b || p !== b.from || p === s.turn) return 'You can’t ask for the dice now';
      if (b.refused) return 'They said no this turn';
      if (b.asked) return 'You already asked';
      b.asked = true;
      events.push({ k: 'askBack', p });
      return null;
    }
    case 'refuseBack': {
      const b = s.back;
      if (!b || !myTurn || !b.asked) return 'Nobody asked for the dice';
      b.asked = false;
      b.refused = true;
      events.push({ k: 'refuseBack', p });
      return null;
    }
    case 'handBack': {
      const b = s.back;
      if (!b?.state) return 'There’s nothing to hand back';
      if (!myTurn) return 'Only the player with the dice can hand them back';
      // Everything as it was, except the rules, which stay as they are now.
      const config = s.config;
      const before = b.state;
      for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
      Object.assign(s, before, { config });
      events.push({ k: 'handBack', p, to: b.from });
      return null;
    }
    case 'askUndo': {
      const u = s.undo;
      if (!u?.state || u.p !== p) return 'There’s nothing of yours to undo';
      if (u.asked) return 'You already asked';
      u.asked = true;
      // CPUs always agree.
      u.ok = s.players.flatMap((pl, i) => (i !== p && pl.cpu ? [i] : []));
      events.push({ k: 'askUndo', p });
      undoIfAgreed(s, events);
      return null;
    }
    case 'answerUndo': {
      const u = s.undo;
      if (!u?.asked || u.p === p) return 'Nobody asked you to undo anything';
      if (u.ok.includes(p)) return 'You already said yes';
      if (typeof a.yes !== 'boolean') return 'Say yes or no';
      events.push({ k: 'answerUndo', p, yes: a.yes });
      if (!a.yes) {
        delete s.undo;
        return null;
      }
      u.ok.push(p);
      undoIfAgreed(s, events);
      return null;
    }
    case 'cancelUndo': {
      const u = s.undo;
      if (!u?.asked || u.p !== p) return 'You haven’t asked to undo';
      u.asked = false;
      u.ok = [];
      events.push({ k: 'cancelUndo', p });
      return null;
    }
    case 'setRule':
      if (!myTurn) return 'Change the rules on your turn';
      return setRule(s, p, a, events);

    case 'setup': {
      if (s.stage !== 'setup') return 'Setup is finished';
      if (!myTurn) return 'Wait for your turn';
      const { v, e } = a;
      if (!isInt(v) || v < 0 || v >= g.verts.length || !setupVertOK(s, v)) {
        // Say why when the only problem is the scenario's starting area.
        if (isInt(v) && v >= 0 && v < g.verts.length && vertFree(s, v) && vertexOK(s, v))
          return 'Starting settlements go on the starting island';
        return 'Settlements need a free corner with no neighbor next to it';
      }
      if (!isInt(e) || !g.verts[v]!.edges.includes(e)) return 'The road must touch your new settlement';
      const second = s.setupI >= s.players.length;
      const size = mods(s).some((m) => m.setupCity?.(s, second)) ? 2 : 1;
      if (a.ship) {
        const place = mods(s).find((m) => m.placeSetupPiece);
        if (!place) return 'Ships need the Seafarers expansion';
        s.verts[v] = [p, size];
        const err = place.placeSetupPiece!(x, v, e);
        if (err) return err;
      } else {
        if (!roadEdgeOK(s, e)) return 'The road must touch your new settlement';
        s.verts[v] = [p, size];
        s.edges[e] = p;
        me.pieces.road--;
      }
      if (size === 2) me.pieces.city--;
      else me.pieces.settlement--;
      let got: PartialRes | null = null;
      if (second) {
        // The second settlement (or city) pays out its neighbors.
        got = {};
        for (const h of g.verts[v]!.hexes) {
          const t = s.board.hexes[h]!.t;
          if (isResource(t) && s.bank[t] > 0) {
            gain(s, p, t, 1);
            got[t] = (got[t] || 0) + 1;
          }
        }
      }
      events.push(a.ship ? { k: 'setup', p, v, e, got, ship: true } : { k: 'setup', p, v, e, got });
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
      s.roadLens = s.players.map((_, i) => routeLen(s, i));
      if (!a.ship) for (const m of mods(s)) m.afterRoad?.(x, e);
      for (const m of mods(s)) m.afterSetupSettlement?.(x, v, second, e, !!a.ship);
      return null;
    }

    case 'roll': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'preroll') return s.stage === 'setup' ? 'Finish setup first' : 'You already rolled';
      if (given !== undefined) {
        const ok = (xs: unknown, max: number) =>
          Array.isArray(xs) && xs.length <= max && xs.every((v) => isInt(v) && v >= 1 && v <= 6);
        if (
          !given ||
          typeof given !== 'object' ||
          !ok(given.d, 64) ||
          (given.e !== undefined && !ok(given.e, 4))
        )
          return 'Those aren’t dice';
      }
      const fixed = mods(s).reduce<[number, number] | null>((d, m) => d ?? m.fixedDice?.(s) ?? null, null);
      let d1: number;
      let d2: number;
      if (fixed) [d1, d2] = fixed;
      else {
        d1 = die('number');
        d2 = die('number');
        // House rules: no 7s while it is anyone's first turn (or while a module says so); the 7
        // is shown, then rolled again.
        const again = () =>
          (s.config.houseRules?.no7FirstRound && s.turnN <= s.players.length) ||
          mods(s).some((m) => m.rerollSeven?.(s));
        while (d1 + d2 === 7 && again()) {
          events.push({ k: 'roll', p, d: [d1, d2], redo: true });
          d1 = die('number');
          d2 = die('number');
        }
      }
      s.dice = [d1, d2];
      events.push({ k: 'roll', p, d: [d1, d2] });
      let held = false;
      for (const m of mods(s)) if (m.afterRoll?.(x)) held = true;
      if (!held) continueRoll(x);
      checkWin(s, events);
      return null;
    }

    case 'discard': {
      const need = s.discard?.[p];
      if (s.stage !== 'discard' || need == null) return 'You don’t need to discard';
      const c = cleanCounts(a.cards, cardKinds(s));
      if (!c) return 'Pick cards to discard';
      if (total(c) !== need) return `Choose exactly ${need} cards to discard`;
      if (!has(me.res, c)) return 'You don’t have those cards';
      pay(s, p, c);
      delete s.discard![p];
      events.push({ k: 'discard', p, c });
      if (!Object.keys(s.discard!).length) {
        s.discard = null;
        s.stage = 'robber';
        if (!robberAwake(s)) finishRobber(s);
      }
      return null;
    }

    case 'robber': {
      if (!myTurn || s.stage !== 'robber') return 'You can’t move the robber now';
      const h = a.hex;
      if (!isInt(h) || h < 0 || h >= s.board.hexes.length) return 'Pick a tile';
      if (h === s.board.robber) return 'Move the robber to a different tile';
      if (!robberHexOK(s, h)) return 'The robber can only go on land';
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
      finishRobber(s);
      return null;
    }

    case 'end': {
      if (!myTurn) return 'Wait for your turn';
      if (s.stage !== 'main') return notMain(s);
      for (const m of mods(s)) {
        const why = m.endTurnBlock?.(s, p);
        if (why) return why;
      }
      for (const k of DEV_PLAY) {
        me.dev[k] += me.fresh[k];
        me.fresh[k] = 0;
      }
      s.offers = [];
      s.devPlayed = false;
      for (const m of mods(s)) m.onTurnEnd?.(s);
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
      for (const m of mods(s)) m.afterRoad?.(x, a.e);
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
      for (const m of mods(s)) m.afterSettlement?.(x, a.v);
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
      if (!devCardsOn(s)) return 'There are no development cards in this game';
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
      if (!devCardsOn(s)) return 'There are no development cards in this game';
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
        const n = Math.min(2, freePieceSupply(s, p));
        if (!n || !canPlaceFreePiece(s, p)) return 'You have nowhere to build a road';
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
      events.push({ k: 'build', p, what: 'road', at: a.e, free: true });
      updateLongest(s, events);
      afterFreePiece(x);
      for (const m of mods(s)) m.afterRoad?.(x, a.e);
      checkWin(s, events);
      return null;
    }

    case 'skipRoads': {
      if (!myTurn || s.stage !== 'roads') return 'You have no free roads to place';
      finishFreePieces(s);
      return null;
    }

    case 'bank': {
      if (!myTurn) return 'Trade with the bank on your own turn';
      if (s.stage !== 'main') return notMain(s);
      const give = a.give as Card;
      const get = a.get as Card;
      const kinds = cardKinds(s);
      if (!kinds.includes(give) || !kinds.includes(get) || give === get) return 'Pick two different cards';
      const rate = rateFor(s, p, give);
      if (me.res[give]! < rate) return `You need ${rate} ${give} for this trade`;
      if (s.bank[get]! < 1) return `The bank is out of ${get}`;
      me.res[give]! -= rate;
      s.bank[give]! += rate;
      gain(s, p, get, 1);
      events.push({ k: 'bank', p, give, n: rate, get });
      return null;
    }

    case 'offer': {
      if (s.stage !== 'main') return 'Trading opens after the roll';
      const give = cleanCounts(a.give, cardKinds(s));
      const want = cleanCounts(a.want, cardKinds(s));
      if (!give || !want || !total(give) || !total(want)) return 'Choose what you give and what you want';
      if (cardKinds(s).some((r) => give[r] && want[r])) return 'You can’t give and ask for the same resource';
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
