/*
 * Game statistics (SPEC 5.4–5.6), worked out only from a game's moves: replay the moves through
 * the engine and add up what each one did. Nothing is stored that can't be rebuilt this way.
 *
 * Card flows are exact by construction: for every move, each player's hand before and after is
 * compared, and every change is explained by the move's events (production, a trade, a steal…).
 * Anything an event doesn't explain is counted in `unexplained`, which the simulator requires to be 0.
 */

import { cloneJson } from './clone';
import { mods } from './modules/api';
import { COM_OF, EVENT_FACES } from './modules/citiesKnights';
import { cardKinds, geo, totalVP, vpBreakdown } from './queries';
import { applyAction, newGame, type NewPlayer } from './rules';
import {
  isResource,
  type Action,
  type Card,
  type Cards,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Resource,
  type Seat,
  type VPPart,
} from './types';

/** Where cards came from. */
export const GAIN_SOURCES = ['production', 'trade', 'bank', 'steal', 'cards', 'start'] as const;
export type GainSource = (typeof GAIN_SOURCES)[number];
/** Where cards went. */
export const LOSS_SOURCES = ['robbed', 'discard', 'taken', 'trade', 'bank', 'build'] as const;
export type LossSource = (typeof LOSS_SOURCES)[number];

export interface PlayerStats {
  got: Record<GainSource, Cards>;
  lost: Record<LossSource, Cards>;
  /** Times this player stole from someone, and was stolen from, and from whom (by seat). */
  robs: number;
  robbed: number;
  robbedBy: number[];
  /** Development cards bought / progress cards drawn, and cards played, by type. */
  bought: Record<string, number>;
  played: Record<string, number>;
  /** Pieces placed, by kind (road, settlement, city, ship, knight, wall, promote, activate…). */
  built: Record<string, number>;
  longestRoad: number;
  trades: { players: number; bank: number };
  /** Production by tile (hex index → cards). */
  tiles: Record<number, number>;
  /** Cards produced, and the average the dice would have given (SPEC 5.4 luck). */
  luck: { got: number; expected: number };
  rolls: number;
  points: VPPart[];
  /** Cards that changed hands with no event to explain it. Always 0 (checked by the simulator). */
  unexplained: number;
}

export interface GameStats {
  /** How many times each total 2–12 was rolled (index = total), chosen Alchemist rolls excluded. */
  dice: number[];
  /** The order totals came in, with who rolled them (for "no 8 in 20 rolls"). */
  rollLog: { p: Seat; t: number }[];
  /** Rolls set by the Alchemist (not random, so not in `dice`). */
  chosen: number;
  /** Event die faces (Cities & Knights). */
  events: Record<string, number>;
  /** Each player's total points at the end of each round of turns (index = turn number). */
  pointsByTurn: number[][];
  players: PlayerStats[];
  turns: number;
  winner: Seat | null;
}

const odds = (t: number) => (6 - Math.abs(t - 7)) / 36;

function emptyPlayer(n: number): PlayerStats {
  const rec = <K extends string>(keys: readonly K[]) =>
    Object.fromEntries(keys.map((k) => [k, {}])) as Record<K, Cards>;
  return {
    got: rec(GAIN_SOURCES),
    lost: rec(LOSS_SOURCES),
    robs: 0,
    robbed: 0,
    robbedBy: new Array<number>(n).fill(0),
    bought: {},
    played: {},
    built: {},
    longestRoad: 0,
    trades: { players: 0, bank: 0 },
    tiles: {},
    luck: { got: 0, expected: 0 },
    rolls: 0,
    points: [],
    unexplained: 0,
  };
}

export function emptyStats(n: number): GameStats {
  return {
    dice: new Array<number>(13).fill(0),
    rollLog: [],
    chosen: 0,
    events: {},
    pointsByTurn: [],
    players: Array.from({ length: n }, () => emptyPlayer(n)),
    turns: 0,
    winner: null,
  };
}

const add = (c: Cards, r: Card, n: number) => {
  if (n) c[r] = (c[r] ?? 0) + n;
};
const bump = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};

/** What every tile would pay each player on a roll of `sum` (resources, commodities, gold), before shortages. */
export function payouts(s: GameState, sum: number): { h: number; p: Seat; card: Card | 'gold'; n: number }[] {
  const g = geo(s);
  const yieldOf = mods(s).find((m) => m.yieldOf)?.yieldOf;
  const ck = !!s.ck;
  const out: { h: number; p: Seat; card: Card | 'gold'; n: number }[] = [];
  s.board.hexes.forEach((h, hi) => {
    if (h.n !== sum || hi === s.board.robber) return;
    for (const v of g.hexVerts[hi]!) {
      const b = s.verts[v];
      if (!b) continue;
      if (h.t === 'gold') out.push({ h: hi, p: b[0], card: 'gold', n: b[1] });
      else if (isResource(h.t)) {
        out.push({ h: hi, p: b[0], card: h.t, n: yieldOf ? yieldOf(s, h.t, b[1]) : b[1] });
        const com = COM_OF[h.t as Resource];
        if (ck && com && b[1] === 2) out.push({ h: hi, p: b[0], card: com, n: 1 });
      }
    }
  });
  return out;
}

/** Moves that spend cards on something (the rest of a hand change is explained by events). */
const SPENDING = new Set<Action['type']>([
  'road', 'settlement', 'city', 'buyDev', 'ship', 'knight', 'wall', 'promote', 'activate', 'improve', 'progress',
  'choose',
]); // prettier-ignore

/**
 * Adds up a game one move at a time. `step` takes the state before and after each move; the
 * whole fold is plain JSON, so it can be saved and picked up again.
 */
type Saved = { st: GameStats; gold: StatsFold['gold']; keep: { undo?: Saved; back?: Saved } };

export class StatsFold {
  st: GameStats;
  /** Stats as they were before a move that may still be undone or handed back. */
  private keep: { undo?: Saved; back?: Saved } = {};
  /** Gold still to be picked, per player: where it came from. */
  gold: Record<number, { src: GainSource; h: number | null; n: number }[]> = {};

  constructor(s0: GameState) {
    this.st = emptyStats(s0.players.length);
  }

  step(prev: GameState, p: Seat, a: Action, events: GameEvent[], next: GameState) {
    // What to go back to. The engine's snapshots hold no undo, and a hand-back's holds no
    // hand-back either, so these never nest more than one level.
    const base = cloneJson({ st: this.st, gold: this.gold });
    const forUndo: Saved = { ...base, keep: this.keep.back ? { back: this.keep.back } : {} };
    const forBack: Saved = { ...base, keep: {} };
    // An undo or hand-back puts the game back as it was, so the stats go back too.
    const back = events.find((e) => e.k === 'undo' || e.k === 'handBack');
    if (back) {
      const saved = back.k === 'undo' ? this.keep.undo : this.keep.back;
      if (!saved) throw new Error(`stats: nothing kept for ${back.k}`);
      this.st = saved.st;
      this.gold = saved.gold;
      this.keep = saved.keep;
      return;
    }
    this.apply(prev, p, a, events, next);
    // Keep what we'll need if this move is later undone or handed back (mirrors the engine).
    const meta = ['askUndo', 'answerUndo', 'cancelUndo', 'askBack', 'refuseBack', 'setRule'].includes(a.type);
    if (!meta) {
      this.keep = {};
      if (next.undo) this.keep.undo = forUndo;
      if (next.back) this.keep.back = forBack;
    } else {
      if (!next.undo) delete this.keep.undo;
      if (!next.back) delete this.keep.back;
    }
  }

  private apply(prev: GameState, p: Seat, a: Action, events: GameEvent[], next: GameState) {
    const st = this.st;
    const n = next.players.length;
    const P = st.players;
    const kinds = cardKinds(next);
    // Explained changes to each hand, by card.
    const explained = next.players.map(() => ({}) as Cards);
    const gain = (q: Seat, src: GainSource, cards: Cards | Partial<Record<Card, number>>) => {
      for (const [r, k] of Object.entries(cards) as [Card, number][]) {
        add(P[q]!.got[src], r, k);
        add(explained[q]!, r, k);
      }
    };
    const lose = (q: Seat, src: LossSource, cards: Cards | Partial<Record<Card, number>>) => {
      for (const [r, k] of Object.entries(cards) as [Card, number][]) {
        add(P[q]!.lost[src], r, k);
        add(explained[q]!, r, -k);
      }
    };
    const roll = events.find((e) => e.k === 'roll' && !e.redo);
    const rollSum =
      roll && roll.k === 'roll' ? roll.d[0] + roll.d[1] : prev.dice ? prev.dice[0] + prev.dice[1] : 0;

    if (a.type === 'roll') {
      P[p]!.rolls++;
      const chosen = !!prev.ck?.alchemy;
      if (chosen) st.chosen++;
      for (const e of events)
        if (e.k === 'roll' && !chosen) {
          st.dice[e.d[0] + e.d[1]]!++;
          st.rollLog.push({ p, t: e.d[0] + e.d[1] });
        }
      // Luck: what these buildings would have produced, on average, from this roll.
      if (!chosen)
        for (let t = 2; t <= 12; t++) {
          if (t === 7) continue;
          for (const x of payouts(prev, t)) P[x.p]!.luck.expected += odds(t) * x.n;
        }
    }

    for (const e of events) {
      switch (e.k) {
        case 'setup':
          if (e.got) gain(e.p, 'start', e.got);
          bump(P[e.p]!.built, 'settlement');
          bump(P[e.p]!.built, e.ship ? 'ship' : 'road');
          break;
        case 'produce':
        case 'commodities': {
          const gains = e.gains as Record<number, Cards>;
          for (const [q, cards] of Object.entries(gains)) {
            gain(Number(q), 'production', cards);
            P[Number(q)]!.luck.got += Object.values(cards).reduce((x, y) => x + (y ?? 0), 0);
          }
          this.tiles(next, rollSum, gains, e.k === 'produce' ? 'resource' : 'commodity');
          break;
        }
        case 'goldOwed': {
          const src: GainSource =
            a.type === 'setup' ? 'start' : events.some((x) => x.k === 'discover') ? 'cards' : 'production';
          const byHex = src === 'production' ? payouts(next, rollSum).filter((x) => x.card === 'gold') : [];
          for (const [q, k] of Object.entries(e.owed)) {
            const list = (this.gold[Number(q)] ??= []);
            const mine = byHex.filter((x) => x.p === Number(q));
            if (mine.length) for (const x of mine) list.push({ src, h: x.h, n: x.n });
            else list.push({ src, h: null, n: k });
          }
          break;
        }
        case 'gold': {
          let left = Object.values(e.got).reduce((x, y) => x + (y ?? 0), 0);
          const list = this.gold[e.p] ?? [];
          // Picks are credited to where the gold came from, oldest first.
          const srcOf: { src: GainSource; n: number }[] = [];
          for (const x of list) {
            if (!left) break;
            const k = Math.min(left, x.n);
            srcOf.push({ src: x.src, n: k });
            if (x.h != null) P[e.p]!.tiles[x.h] = (P[e.p]!.tiles[x.h] ?? 0) + k;
            if (x.src === 'production') P[e.p]!.luck.got += k;
            left -= k;
          }
          if (left) srcOf.push({ src: 'production', n: left });
          delete this.gold[e.p];
          // Split the picked cards across the sources in order.
          const picked = Object.entries(e.got).flatMap(([r, k]) => new Array<Card>(k ?? 0).fill(r as Card));
          let i = 0;
          for (const x of srcOf) {
            const cards: Cards = {};
            for (let j = 0; j < x.n; j++) add(cards, picked[i++]!, 1);
            gain(e.p, x.src, cards);
          }
          break;
        }
        case 'discover':
          if (e.got) gain(e.p, 'cards', e.got);
          break;
        case 'discard':
          lose(e.p, 'discard', e.c);
          break;
        case 'steal':
          P[e.p]!.robs++;
          P[e.from]!.robbed++;
          P[e.from]!.robbedBy[e.p]!++;
          if (e.r && (kinds as readonly string[]).includes(e.r)) {
            gain(e.p, 'steal', { [e.r]: 1 });
            lose(e.from, 'robbed', { [e.r]: 1 });
          }
          break;
        case 'plenty':
          gain(e.p, 'cards', e.got);
          break;
        case 'mono':
          for (const [q, k] of Object.entries(e.from)) {
            lose(Number(q), 'taken', { [e.r]: k });
            gain(e.p, 'cards', { [e.r]: k });
          }
          break;
        case 'gain': {
          gain(e.p, 'cards', e.cards);
          const from = e.from ?? {};
          const types = Object.keys(e.cards) as Card[];
          for (const [q, k] of Object.entries(from)) {
            if (types.length === 1) lose(Number(q), 'taken', { [types[0]!]: k });
            else if (Object.keys(from).length === 1) lose(Number(q), 'taken', e.cards);
          }
          break;
        }
        case 'give':
          if (e.cards) {
            lose(e.from, 'taken', e.cards);
            gain(e.to, 'cards', e.cards);
          }
          break;
        case 'aqueduct':
          gain(e.p, 'cards', { [e.r]: 1 });
          break;
        case 'bank':
          lose(e.p, 'bank', { [e.give]: e.n });
          gain(e.p, 'bank', { [e.get]: 1 });
          P[e.p]!.trades.bank++;
          break;
        case 'trade':
          lose(e.a, 'trade', e.give);
          gain(e.a, 'trade', e.want);
          lose(e.b, 'trade', e.want);
          gain(e.b, 'trade', e.give);
          P[e.a]!.trades.players++;
          P[e.b]!.trades.players++;
          break;
        case 'build':
          bump(P[e.p]!.built, e.what);
          break;
        case 'knight':
        case 'wall':
        case 'promote':
        case 'activate':
        case 'metropolis':
          bump(P[e.p]!.built, e.k);
          break;
        case 'moveShip':
          bump(P[e.p]!.built, 'shipMoved');
          break;
        case 'buyDev':
          bump(P[e.p]!.bought, e.card ?? 'unknown');
          break;
        case 'draw':
          bump(P[e.p]!.bought, e.card ?? 'unknown');
          break;
        case 'playDev':
          bump(P[e.p]!.played, e.card);
          break;
        case 'progress':
          bump(P[e.p]!.played, e.card);
          break;
        case 'eventDie':
          bump(st.events, e.face);
          break;
        case 'win':
          st.winner = e.p;
          break;
      }
    }

    // Whatever an event didn't explain: spent on building on a building move, otherwise "other".
    for (let q = 0; q < n; q++) {
      for (const r of kinds) {
        const d = (next.players[q]!.res[r] ?? 0) - (prev.players[q]!.res[r] ?? 0) - (explained[q]![r] ?? 0);
        if (!d) continue;
        if (d < 0 && q === p && SPENDING.has(a.type)) add(P[q]!.lost.build, r, -d);
        else P[q]!.unexplained += Math.abs(d);
      }
      P[q]!.longestRoad = Math.max(P[q]!.longestRoad, next.roadLens[q] ?? 0);
    }

    // Points: the chart gets a column per turn; the breakdown is kept current.
    if (next.turnN !== prev.turnN || next.phase === 'over' || st.pointsByTurn.length === 0) {
      st.pointsByTurn[next.turnN] = next.players.map((_, q) => totalVP(next, q));
    }
    st.turns = next.turnN;
    next.players.forEach((_, q) => (P[q]!.points = vpBreakdown(next, q, true)));
    if (next.phase === 'over') st.winner = next.winner;
  }

  /** Credit production to the tiles that paid it (shortages: whatever the bank had, in tile order). */
  private tiles(s: GameState, sum: number, gains: Record<number, Cards>, kind: 'resource' | 'commodity') {
    const pay = payouts(s, sum).filter(
      (x) => x.card !== 'gold' && (kind === 'resource') === isResource(x.card),
    );
    for (const [qs, cards] of Object.entries(gains)) {
      const q = Number(qs);
      for (const [r, k] of Object.entries(cards) as [Card, number][]) {
        let left = k;
        for (const x of pay) {
          if (!left) break;
          if (x.p !== q || x.card !== r) continue;
          const take = Math.min(left, x.n);
          this.st.players[q]!.tiles[x.h] = (this.st.players[q]!.tiles[x.h] ?? 0) + take;
          left -= take;
        }
        if (left) this.st.players[q]!.tiles[-1] = (this.st.players[q]!.tiles[-1] ?? 0) + left;
      }
    }
  }
}

/** Rebuild a game's stats from scratch from its moves (the source of truth). */
export function statsFromLog(
  seed: string,
  players: NewPlayer[],
  config: Partial<GameConfig>,
  log: { seat: Seat; action: Action }[],
): { stats: GameStats; state: GameState } {
  let s = newGame(seed, players, config);
  const fold = new StatsFold(s);
  for (const { seat, action } of log) {
    const r = applyAction(s, seat, action);
    if (!r.ok) throw new Error(`move ${s.seq + 1} no longer applies: ${r.error}`);
    fold.step(s, seat, action, r.events, r.state);
    s = r.state;
  }
  return { stats: fold.st, state: s };
}

/** A player's most productive tile: [hex, cards], or null. */
export function bestTile(ps: PlayerStats): [number, number] | null {
  let best: [number, number] | null = null;
  for (const [h, k] of Object.entries(ps.tiles))
    if (Number(h) >= 0 && (!best || k > best[1])) best = [Number(h), k];
  return best;
}

/** Totals of a card record. */
export const sumCards = (c: Cards) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);

export { EVENT_FACES };
