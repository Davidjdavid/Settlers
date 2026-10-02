/*
 * CPU games: CPU seats (docs/bot.md, docs/bot-medium-hard.md) against the basic test bot or each
 * other. Besides the usual invariants, every CPU move is checked against its rules:
 * - Easy: no player trades, the robber and pirate placement tiers, stealing, cards it must never
 *   play, and the hand limit at the end of its turn;
 * - Medium and Hard: trading only as the room allows (at most one offer per turn, never the same
 *   offer twice, never with someone about to win), Medium's robber rule before anyone is close,
 *   and the hand limit;
 * - every CPU: the same move when everything it can't see is changed (with the same memory).
 */

import {
  DEFAULT_CPU_OPTIONS, applyAction, botMove, checkInvariants, checkTransition, cloneJson, cpuMove, cpuObserve,
  eventsFor, geo, handLimit, legalActions, newCpuMemo, newGame, nextFloat, nextInt, robberVictims, seedRng, total,
  viewFor, type Action, type CpuBrain, type CpuMemo, type CpuOptions, type GameState, type RngState, type Seat,
} from '../src/index'; // prettier-ignore
import { configFor, perturbHidden, randomOffer, seatsFor, withDice, type SimOptions } from './simulate';

export interface CpuResult {
  seed: string;
  ok: boolean;
  finished: boolean;
  turns: number;
  actions: number;
  /** Did a CPU win? */
  cpuWon: boolean;
  winner: Seat | null;
  /** Who played each seat (after the game's shuffle). */
  brains: (CpuBrain | 'bot')[];
  /** The game as it ended. */
  final: GameState;
  errors: string[];
  /** How many CPU moves of interest were checked. */
  checked: {
    moves: number;
    robber: number;
    ends: number;
    offersDeclined: number;
    hidden: number;
    offers: number;
    accepted: number;
  };
}

/** Progress cards the Easy CPU must never play (docs/bot.md §6.2). */
const NEVER = new Set([
  'alchemist', 'inventor', 'bishop', 'deserter', 'diplomat', 'intrigue', 'saboteur', 'spy', 'wedding',
  'commercialHarbor', 'masterMerchant', 'resourceMonopoly', 'tradeMonopoly',
]); // prettier-ignore

/** Who has a piece next to a robber spot (buildings) or pirate spot (ships). Written independently of cpu.ts. */
function around(s: GameState, type: 'robber' | 'pirate', hex: number): Set<Seat> {
  const g = geo(s);
  const out = new Set<Seat>();
  if (type === 'robber') for (const v of g.hexVerts[hex]!) if (s.verts[v]) out.add(s.verts[v]![0]);
  if (type === 'pirate')
    g.edges.forEach((E, e) => E.hexes.includes(hex) && s.sea?.ships[e] != null && out.add(s.sea.ships[e]!));
  return out;
}

/** Check the robber or pirate spot a CPU chose against Easy's tiers. Returns an error or null. */
function checkSpot(s: GameState, p: Seat, a: Extract<Action, { type: 'robber' | 'pirate' }>): string | null {
  const options = legalActions(s, p).filter(
    (x): x is Extract<Action, { type: 'robber' | 'pirate' }> => x.type === 'robber' || x.type === 'pirate',
  );
  const who = (x: { type: 'robber' | 'pirate'; hex: number }) => around(s, x.type, x.hex);
  const chosen = who(a);
  const empty = options.some((x) => who(x).size === 0);
  const ownOnly = options.some((x) => who(x).size === 1 && who(x).has(p));
  if (empty) return chosen.size === 0 ? null : `robber on an occupied hex when an empty one existed`;
  if (ownOnly) return chosen.size === 1 && chosen.has(p) ? null : `robber not on its own-only hex`;
  const own = options.filter((x) => who(x).has(p));
  if (own.length) {
    const fewest = Math.min(...own.map((x) => who(x).size));
    if (!chosen.has(p)) return 'robber not on one of its own hexes';
    if (chosen.size !== fewest) return `robber on its hex shared by ${chosen.size - 1}, not ${fewest - 1}`;
  }
  return null;
}

/** Public points of q (what every screen shows). */
const publicVP = (s: GameState, q: Seat) => viewFor(s, null).players[q]!.publicVP;

export function cpuGame(
  seed: string,
  n: number,
  cpus: number,
  opts: SimOptions & {
    hiddenRate?: number;
    /**
     * Who plays each player, in the order given to newGame (which shuffles the seats): a CPU
     * brain, or 'bot' (the test bot). Default: `cpus` Easy CPUs first.
     */
    brains?: (CpuBrain | 'bot')[];
    cpuOptions?: CpuOptions;
    /** Tournaments: a game that runs out of turns is a draw, not a failure. */
    unfinishedOK?: boolean;
  } = {},
): CpuResult {
  const maxTurns = opts.maxTurns ?? 3000;
  const rng: RngState = seedRng(`cpu-agent:${seed}`);
  const dice = seedRng(`dice:${seed}`);
  const given: (CpuBrain | 'bot')[] =
    opts.brains ?? Array.from({ length: n }, (_, i) => (i < cpus ? 'easy' : 'bot'));
  const cpuOpts = opts.cpuOptions ?? DEFAULT_CPU_OPTIONS;
  const seats = seatsFor(n).map((x, i) => (given[i] !== 'bot' ? { ...x, cpu: true } : x));
  let s = newGame(seed, seats, configFor(opts));
  // The game shuffles the seats: each player keeps the brain it was given.
  const brains = s.players.map((pl) => given[seats.findIndex((x) => x.pid === pl.pid)]!);
  const memo: CpuMemo[] = s.players.map(() => newCpuMemo());
  const errors: string[] = [];
  const checked = { moves: 0, robber: 0, ends: 0, offersDeclined: 0, hidden: 0, offers: 0, accepted: 0 };
  const fail = (m: string) => errors.push(`seq ${s.seq} turn ${s.turnN}: ${m}`);
  // A Knight card an Easy CPU played: its robber move must rob nobody.
  let knightBy: Seat | null = null;
  // Offers each CPU made this turn (to check "one per turn" and "never twice").
  let offersThisTurn: { turnN: number; keys: string[] } = { turnN: -1, keys: [] };
  let actions = 0;

  const brainOf = (p: Seat) => brains[p]!;
  const move = (t: GameState, p: Seat, r: RngState, m: CpuMemo, timeout = false) => {
    const b = brainOf(p);
    return b === 'bot'
      ? botMove(viewFor(t, p), r)
      : cpuMove(viewFor(t, p), r, m, b, timeout ? { ...cpuOpts, offerTimeout: true } : cpuOpts);
  };

  for (let guard = 0; s.phase === 'play' && s.turnN <= maxTurns && !errors.length; guard++) {
    if (guard > maxTurns * 300) {
      fail('too many actions');
      break;
    }
    // Now and then a test bot offers a trade, so CPUs have offers to answer.
    if (s.stage === 'main' && nextFloat(rng) < 0.04) {
      const p = nextInt(rng, n);
      if (brainOf(p) === 'bot' && !s.offers.some((o) => o.from === p)) {
        const offer = randomOffer(s, p, rng);
        const r = offer && applyAction(s, p, offer);
        if (r && r.ok) {
          s = r.state;
          actions++;
          observeAll(r.events);
          continue;
        }
      }
    }
    // Now and then a test bot that just ended its turn asks a CPU for the dice back.
    const back = s.back;
    if (
      back &&
      !back.asked &&
      !back.refused &&
      back.from !== s.turn &&
      brainOf(back.from) === 'bot' &&
      s.players[s.turn]!.cpu &&
      nextFloat(rng) < 0.5
    ) {
      const r = applyAction(s, back.from, { type: 'askBack' });
      if (r.ok) {
        s = r.state;
        actions++;
        observeAll(r.events);
        continue;
      }
    }
    let mover: Seat | null = null;
    let a: Action | null = null;
    for (const timeout of [false, true]) {
      for (let p = 0; p < n && !a; p++) {
        if (timeout && !(p === s.turn && s.offers.some((o) => o.from === p) && brainOf(p) !== 'bot'))
          continue;
        if (s.players[p]!.cpu) {
          const before = { rng: [...rng] as RngState, memo: cloneJson(memo[p]!) };
          a = move(s, p, rng, memo[p]!, timeout);
          // Its decision may not depend on what it can't see.
          if (a && nextFloat(rng) < (opts.hiddenRate ?? 0.05)) {
            const hide = seedRng(`${seed}:${s.seq}`);
            const t = perturbHidden(s, p, hide);
            // The game's random generator too: it decides steals, shuffles and old games' dice.
            t.rng = [
              nextInt(hide, 1 << 30),
              nextInt(hide, 1 << 30),
              nextInt(hide, 1 << 30),
              1 + nextInt(hide, 1 << 30),
            ];
            const again = move(t, p, before.rng, before.memo, timeout);
            if (JSON.stringify(again) !== JSON.stringify(a))
              fail(
                `CPU move depends on hidden information: ${JSON.stringify(a)} vs ${JSON.stringify(again)}`,
              );
            checked.hidden++;
          }
        } else a = botMove(viewFor(s, p), rng);
        if (a) mover = p;
      }
      if (a) break;
    }
    if (!a || mover == null) {
      fail(`nobody can move at stage ${s.stage}`);
      break;
    }
    const p = mover;
    const brain = brainOf(p);
    if (brain === 'easy') checkEasy(s, p, a);
    else if (brain !== 'bot') checkSmart(s, p, a, brain);
    if (s.players[p]!.cpu) {
      checked.moves++;
      if (s.back?.asked && s.turn === p && a.type !== 'handBack')
        fail(`CPU kept the dice when asked: ${a.type}`);
      if (a.type === 'end') {
        checked.ends++;
        if (total(s.players[p]!.res) > handLimit(s, p) && legalActions(s, p).some((x) => x.type === 'bank'))
          fail(
            `CPU ended its turn over its hand limit with a bank trade possible (${total(s.players[p]!.res)} cards)`,
          );
      }
    }
    const r = applyAction(s, p, withDice(a, dice));
    if (!r.ok) {
      fail(`${s.players[p]!.cpu ? 'CPU' : 'bot'} move rejected: ${JSON.stringify(a)} -> ${r.error}`);
      break;
    }
    const prev = s;
    s = r.state;
    actions++;
    observeAll(r.events);
    for (const b of [...checkInvariants(s, prev), ...checkTransition(prev, s)])
      fail(`after ${JSON.stringify(a)}: ${b}`);
  }
  const finished = s.phase === 'over';
  if (!finished && !errors.length && !opts.unfinishedOK) fail(`game did not finish within ${maxTurns} turns`);
  return {
    seed,
    ok: errors.length === 0,
    finished,
    brains,
    final: s,
    turns: s.turnN,
    actions,
    cpuWon: s.winner != null && !!s.players[s.winner]!.cpu,
    winner: s.winner,
    errors,
    checked,
  };

  /** Every CPU folds what it saw of a move into its memory. */
  function observeAll(events: Parameters<typeof eventsFor>[0]) {
    for (let q = 0; q < n; q++) {
      const b = brainOf(q);
      if (b !== 'bot') cpuObserve(memo[q]!, viewFor(s, q), eventsFor(events, q), b);
    }
  }

  function checkEasy(s: GameState, p: Seat, a: Action) {
    if (a.type === 'offer' || a.type === 'confirm' || a.type === 'cancel')
      fail(`CPU traded with players: ${a.type}`);
    if (a.type === 'respond') {
      if (a.yes) fail('CPU accepted an offer');
      checked.offersDeclined++;
    }
    if (a.type === 'playMono') fail('CPU played Monopoly');
    if (a.type === 'moveKnight' || a.type === 'chase') fail(`CPU used a knight against someone: ${a.type}`);
    if (a.type === 'progress') {
      if (NEVER.has(a.card)) fail(`CPU played ${a.card}`);
      const m = s.ck?.merchant;
      if (a.card === 'merchant' && m && !s.players[m.p]!.cpu) fail('CPU took the merchant from a human');
    }
    if (a.type === 'playKnight') knightBy = p;
    if (a.type === 'robber' || a.type === 'pirate') {
      checked.robber++;
      const err = checkSpot(s, p, a);
      if (err) fail(err);
      const victims =
        a.type === 'robber'
          ? robberVictims(s, p, a.hex)
          : [...around(s, 'pirate', a.hex)].filter((o) => o !== p && total(s.players[o]!.res) > 0);
      if (knightBy === p && victims.length) fail('CPU played a Knight that robs someone');
      const v = a.victim ?? (victims.length === 1 ? victims[0] : null);
      if (v != null && !s.players[v]!.cpu && victims.some((o) => s.players[o]!.cpu))
        fail('CPU robbed a human when it could rob a CPU');
      knightBy = null;
    }
  }

  function checkSmart(s: GameState, p: Seat, a: Action, b: Exclude<CpuBrain, 'easy'>) {
    const tradeOK = cpuOpts.trading && b.trading !== 'never';
    if (a.type === 'offer') {
      checked.offers++;
      if (!tradeOK) fail('CPU offered a trade with trading off');
      if (offersThisTurn.turnN !== s.turnN) offersThisTurn = { turnN: s.turnN, keys: [] };
      const key = `${p}:${JSON.stringify([a.give, a.want])}`;
      if (offersThisTurn.keys.includes(key)) fail('CPU made the same offer twice in a turn');
      const mine = offersThisTurn.keys.filter((k) => k.startsWith(`${p}:`)).length;
      if (cpuOpts.oneOffer && mine >= 1) fail('CPU made a second offer in a turn');
      offersThisTurn.keys.push(key);
      if (b.trading === 'fair' && total(a.give) < total(a.want)) fail('CPU made an unfair offer');
    }
    if ((a.type === 'respond' && a.yes) || a.type === 'confirm') {
      checked.accepted++;
      if (!tradeOK) fail('CPU accepted a trade with trading off');
      const o = s.offers.find((x) => x.id === a.id)!;
      const other = a.type === 'confirm' ? a.with : o.from;
      if (publicVP(s, other) >= s.config.winVP - 2) fail('CPU traded with someone about to win');
      const gets = a.type === 'confirm' ? o.want : o.give;
      const gives = a.type === 'confirm' ? o.give : o.want;
      // Accepting someone else's offer (its own may be 2 for 1, of what it has plenty of).
      if (a.type === 'respond' && b.trading === 'fair' && total(gives) > total(gets))
        fail('CPU accepted an offer that gives more cards than it gets');
    }
    if (a.type === 'respond' && !a.yes) checked.offersDeclined++;
    if ((a.type === 'robber' || a.type === 'pirate') && b.robber !== 'leader') {
      checked.robber++;
      const close = s.players.some((_, q) => publicVP(s, q) >= s.config.winVP - 3);
      if (b.robber === 'gentle' || !close) {
        const err = checkSpot(s, p, a);
        if (err) fail(`${b.base} robber before anyone is close: ${err}`);
      }
    }
  }
}
