/*
 * What each seat is allowed to see. Views are built from an allowlist of fields, never by
 * deleting secrets from a copy, so a new state field stays private until it is added here.
 */

import { cloneJson } from './clone';
import { PROGRESS_VP } from './types';
import { mods } from './modules/api';
import type { CKView } from './modules/citiesKnights';
import { deckCount, devCount, publicVP, total, totalVP } from './queries';
import type {
  Board, Building, Color, DevCounts, GameEvent, GameState, Hand, HouseRules, ModuleId, Offer, Seat, Stage,
} from './types'; // prettier-ignore

export interface PublicPlayer {
  pid: string;
  color: Color;
  nick: string;
  resCount: number;
  devCount: number;
  knights: number;
  played: { road: number; plenty: number; mono: number };
  pieces: { road: number; settlement: number; city: number; ship?: number };
  roadLen: number;
  publicVP: number;
  /** Only filled in once the game is over. */
  vpCards: number | null;
  /** A CPU player. */
  cpu?: true;
}

export interface PrivateHand {
  res: Hand;
  dev: DevCounts;
  fresh: DevCounts;
  vpCards: number;
  totalVP: number;
}

export interface PlayerView {
  /** The viewer's seat, or null for a spectator. */
  me: Seat | null;
  seq: number;
  phase: 'play' | 'over';
  stage: Stage;
  winVP: number;
  board: Board;
  verts: (Building | null)[];
  edges: (Seat | null)[];
  players: PublicPlayer[];
  hand: PrivateHand | null;
  bank: Hand;
  deckCount: number;
  turn: Seat;
  turnN: number;
  setupI: number;
  dice: [number, number] | null;
  discard: Record<number, number> | null;
  freeRoads: number;
  devPlayed: boolean;
  longest: Seat | null;
  largest: Seat | null;
  offers: Offer[];
  winner: Seat | null;
  /** Rules in force: expansions, house rules, and the map's public rules. */
  rules: {
    modules: ModuleId[];
    houseRules: HouseRules;
    mapId: string;
    mapName: string;
    /** Starting-area hexes as q,r, or 'all'. */
    start: 'all' | [number, number][];
    newIslandVP: number;
  };
  /** A turn that can be handed back (who ended it, whether they asked). */
  back?: { from: Seat; asked: boolean; refused: boolean };
  /** Seafarers (public parts only). */
  sea?: SeaView;
  /** Cities & Knights (public parts, plus the viewer's own cards). */
  ck?: CKView;
}

export interface SeaView {
  ships: (Seat | null)[];
  builtThisTurn: number[];
  movesThisTurn: number;
  specialVP: number[];
  home: number[][][];
  bonus: number[][][];
  gold: { owed: Record<number, number>; back: Stage } | null;
  /** How many fog tiles are still face down (their contents stay secret). */
  fogLeft: number;
}

export function viewFor(s: GameState, seat: Seat | null): PlayerView {
  const me = seat != null && seat >= 0 && seat < s.players.length ? seat : null;
  const over = s.phase === 'over';
  const mine = me != null ? s.players[me]! : null;
  const v: PlayerView = cloneJson({
    me,
    seq: s.seq,
    phase: s.phase,
    stage: s.stage,
    winVP: s.config.winVP,
    board: s.board,
    verts: s.verts,
    edges: s.edges,
    players: s.players.map((pl, i): PublicPlayer => ({
      pid: pl.pid,
      color: pl.color,
      nick: pl.nick,
      resCount: total(pl.res),
      devCount: devCount(pl),
      knights: pl.knights,
      played: pl.played,
      pieces: pl.pieces,
      roadLen: s.roadLens[i] ?? 0,
      publicVP: publicVP(s, i),
      vpCards: over ? pl.vpCards : null,
      ...(pl.cpu ? { cpu: true as const } : {}),
    })),
    hand: mine
      ? { res: mine.res, dev: mine.dev, fresh: mine.fresh, vpCards: mine.vpCards, totalVP: totalVP(s, me!) }
      : null,
    bank: s.bank,
    deckCount: deckCount(s),
    turn: s.turn,
    turnN: s.turnN,
    setupI: s.setupI,
    dice: s.dice,
    discard: s.discard,
    freeRoads: s.freeRoads,
    devPlayed: s.devPlayed,
    longest: s.longest,
    largest: s.largest,
    offers: s.offers,
    winner: s.winner,
    rules: {
      modules: s.config.modules ?? [],
      houseRules: s.config.houseRules ?? {},
      mapId: s.config.map?.id ?? 'classic',
      mapName: s.config.map?.name ?? 'Classic',
      start: s.config.map?.start ?? 'all',
      newIslandVP: s.config.map?.specialVP?.newIsland ?? 0,
    },
  } satisfies PlayerView);
  if (s.back) v.back = { from: s.back.from, asked: s.back.asked, refused: s.back.refused };
  for (const m of mods(s)) m.view?.(s, me, v);
  return v;
}

/** Redact one event for a seat (null = spectator). */
export function eventFor(e: GameEvent, seat: Seat | null): GameEvent {
  switch (e.k) {
    case 'steal':
      return seat === e.p || seat === e.from ? { ...e } : { ...e, r: null };
    case 'buyDev':
      return seat === e.p ? { ...e } : { ...e, card: null };
    case 'draw':
      return seat === e.p || (e.card && PROGRESS_VP.includes(e.card)) ? { ...e } : { ...e, card: null };
    case 'give':
      return seat === e.from || seat === e.to ? cloneJson(e) : { ...e, cards: null };
    case 'spy':
      return seat === e.p || seat === e.from ? { ...e } : { ...e, card: null };
    default:
      return cloneJson(e);
  }
}

export function eventsFor(events: GameEvent[], seat: Seat | null): GameEvent[] {
  return events.map((e) => eventFor(e, seat));
}

/**
 * A GameState rebuilt from a view, for running engine queries (legal spots, rates) in the
 * client. Hidden information is filled with placeholders: other players' cards all count as
 * wood, the deck as knights. Good for your own legal moves; never for deciding outcomes.
 */
export function stateFromView(v: PlayerView): GameState {
  const zero = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const noDev = { knight: 0, road: 0, plenty: 0, mono: 0 };
  const config: GameState['config'] = { winVP: v.winVP };
  if (v.rules.modules.length) config.modules = v.rules.modules.slice();
  if (Object.keys(v.rules.houseRules).length) config.houseRules = { ...v.rules.houseRules };
  if (v.rules.mapId !== 'classic') {
    // Only the public parts of the map matter for legal-move checks.
    config.map = {
      format: 1, id: v.rules.mapId, name: v.rules.mapName, modules: v.rules.modules.slice(), players: [],
      winVP: v.winVP, hexes: [], harbors: [], robber: null, start: v.rules.start,
      specialVP: { newIsland: v.rules.newIslandVP },
    }; // prettier-ignore
  }
  const s: GameState = cloneJson({
    v: 1,
    config,
    rng: [0, 0, 0, 0],
    seq: v.seq,
    phase: v.phase,
    stage: v.stage,
    board: v.board,
    verts: v.verts,
    edges: v.edges,
    players: v.players.map((p, i) => {
      const mine = i === v.me && v.hand;
      return {
        pid: p.pid,
        color: p.color,
        nick: p.nick,
        res: mine ? v.hand!.res : { ...zero, wood: p.resCount },
        dev: mine ? v.hand!.dev : noDev,
        fresh: mine ? v.hand!.fresh : noDev,
        vpCards: mine ? v.hand!.vpCards : 0,
        knights: p.knights,
        played: p.played,
        pieces: p.pieces,
        ...(p.cpu ? { cpu: true as const } : {}),
      };
    }),
    bank: v.bank,
    deck: { knight: v.deckCount, road: 0, plenty: 0, mono: 0, vp: 0 },
    turn: v.turn,
    turnN: v.turnN,
    setupI: v.setupI,
    dice: v.dice,
    discard: v.discard,
    robberReturn: v.stage === 'robber' || v.stage === 'discard' ? 'main' : null,
    freeRoads: v.freeRoads,
    roadsReturn: v.stage === 'roads' ? 'main' : null,
    devPlayed: v.devPlayed,
    longest: v.longest,
    largest: v.largest,
    roadLens: v.players.map((p) => p.roadLen),
    offers: v.offers,
    offerN: 0,
    winner: v.winner,
  } satisfies GameState);
  // The turn to restore is server-only; legal moves only need to know a hand-back is possible.
  if (v.back) s.back = { ...v.back, state: null };
  for (const m of mods(s)) m.fromView?.(v, s);
  return s;
}
