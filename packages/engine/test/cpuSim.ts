/*
 * CPU games: CPU seats (docs/bot.md) against the basic test bot. Besides the usual invariants,
 * every CPU move is checked against the CPU's rules: no player trades, the robber and pirate
 * placement tiers, stealing, cards it must never play, and the hand limit at the end of its turn.
 */

import {
  applyAction, botMove, checkInvariants, checkTransition, cpuMove, geo, handLimit,
  legalActions, newCpuMemo, newGame, nextFloat, nextInt, robberVictims, seedRng, total, viewFor, type Action,
  type CpuMemo, type GameState, type RngState, type Seat,
} from '../src/index'; // prettier-ignore
import { configFor, perturbHidden, randomOffer, seatsFor, type SimOptions } from './simulate';

export interface CpuResult {
  seed: string;
  ok: boolean;
  finished: boolean;
  turns: number;
  actions: number;
  /** Did a CPU win? */
  cpuWon: boolean;
  errors: string[];
  /** How many CPU moves of interest were checked. */
  checked: { moves: number; robber: number; ends: number; offersDeclined: number; hidden: number };
}

/** Progress cards the CPU must never play (docs/bot.md §6.2). */
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

/** Check the robber or pirate spot a CPU chose against the tiers. Returns an error or null. */
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

export function cpuGame(
  seed: string,
  n: number,
  cpus: number,
  opts: SimOptions & { hiddenRate?: number } = {},
): CpuResult {
  const maxTurns = opts.maxTurns ?? 3000;
  const rng: RngState = seedRng(`cpu-agent:${seed}`);
  const seats = seatsFor(n).map((x, i) => (i < cpus ? { ...x, cpu: true } : x));
  let s = newGame(seed, seats, configFor(opts));
  const memo: CpuMemo[] = s.players.map(() => newCpuMemo());
  const errors: string[] = [];
  const checked = { moves: 0, robber: 0, ends: 0, offersDeclined: 0, hidden: 0 };
  const fail = (m: string) => errors.push(`seq ${s.seq} turn ${s.turnN}: ${m}`);
  // A Knight card a CPU played: its robber move must rob nobody.
  let knightBy: Seat | null = null;
  let actions = 0;

  for (let guard = 0; s.phase === 'play' && s.turnN <= maxTurns && !errors.length; guard++) {
    if (guard > maxTurns * 300) {
      fail('too many actions');
      break;
    }
    // Now and then a test bot offers a trade, so CPUs have offers to decline.
    if (s.stage === 'main' && nextFloat(rng) < 0.04) {
      const p = nextInt(rng, n);
      if (!s.players[p]!.cpu && !s.offers.some((o) => o.from === p)) {
        const offer = randomOffer(s, p, rng);
        const r = offer && applyAction(s, p, offer);
        if (r && r.ok) {
          s = r.state;
          actions++;
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
      !s.players[back.from]!.cpu &&
      s.players[s.turn]!.cpu &&
      nextFloat(rng) < 0.5
    ) {
      const r = applyAction(s, back.from, { type: 'askBack' });
      if (r.ok) {
        s = r.state;
        actions++;
        continue;
      }
    }
    let mover: Seat | null = null;
    let a: Action | null = null;
    for (let p = 0; p < n && !a; p++) {
      if (s.players[p]!.cpu) {
        const before = { rng: [...rng] as RngState, memo: { ...memo[p]! } };
        a = cpuMove(viewFor(s, p), rng, memo[p]!);
        // Its decision may not depend on what it can't see.
        if (a && nextFloat(rng) < (opts.hiddenRate ?? 0.05)) {
          const t = perturbHidden(s, p, seedRng(`${seed}:${s.seq}`));
          const again = cpuMove(viewFor(t, p), before.rng, before.memo);
          if (JSON.stringify(again) !== JSON.stringify(a))
            fail(`CPU move depends on hidden information: ${JSON.stringify(a)} vs ${JSON.stringify(again)}`);
          checked.hidden++;
        }
      } else a = botMove(viewFor(s, p), rng);
      if (a) mover = p;
    }
    if (!a || mover == null) {
      fail(`nobody can move at stage ${s.stage}`);
      break;
    }
    const p = mover;
    const cpu = !!s.players[p]!.cpu;
    if (cpu) {
      checked.moves++;
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
      if (s.back?.asked && s.turn === p && a.type !== 'handBack')
        fail(`CPU kept the dice when asked: ${a.type}`);
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
      if (a.type === 'end') {
        checked.ends++;
        if (total(s.players[p]!.res) > handLimit(s, p) && legalActions(s, p).some((x) => x.type === 'bank'))
          fail(
            `CPU ended its turn over its hand limit with a bank trade possible (${total(s.players[p]!.res)} cards)`,
          );
      }
    }
    const r = applyAction(s, p, a);
    if (!r.ok) {
      fail(`${cpu ? 'CPU' : 'bot'} move rejected: ${JSON.stringify(a)} -> ${r.error}`);
      break;
    }
    const prev = s;
    s = r.state;
    actions++;
    for (const b of [...checkInvariants(s, prev), ...checkTransition(prev, s)])
      fail(`after ${JSON.stringify(a)}: ${b}`);
  }
  if (s.phase !== 'over' && !errors.length) fail(`game did not finish within ${maxTurns} turns`);
  return {
    seed,
    ok: errors.length === 0,
    finished: s.phase === 'over',
    turns: s.turnN,
    actions,
    cpuWon: s.winner != null && !!s.players[s.winner]!.cpu,
    errors,
    checked,
  };
}
