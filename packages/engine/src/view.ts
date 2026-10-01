/*
 * What each seat is allowed to see. Views are built from an allowlist of fields, never by
 * deleting secrets from a copy, so a new state field stays private until it is added here.
 */

import { cloneJson } from './clone';
import { deckCount, devCount, publicVP, total, totalVP } from './queries';
import type {
  Board, Building, Color, DevCounts, GameEvent, GameState, Offer, ResCounts, Seat, Stage,
} from './types'; // prettier-ignore

export interface PublicPlayer {
  pid: string;
  color: Color;
  nick: string;
  resCount: number;
  devCount: number;
  knights: number;
  played: { road: number; plenty: number; mono: number };
  pieces: { road: number; settlement: number; city: number };
  roadLen: number;
  publicVP: number;
  /** Only filled in once the game is over. */
  vpCards: number | null;
}

export interface PrivateHand {
  res: ResCounts;
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
  bank: ResCounts;
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
}

export function viewFor(s: GameState, seat: Seat | null): PlayerView {
  const me = seat != null && seat >= 0 && seat < s.players.length ? seat : null;
  const over = s.phase === 'over';
  const mine = me != null ? s.players[me]! : null;
  return cloneJson({
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
  });
}

/** Redact one event for a seat (null = spectator). */
export function eventFor(e: GameEvent, seat: Seat | null): GameEvent {
  switch (e.k) {
    case 'steal':
      return seat === e.p || seat === e.from ? { ...e } : { ...e, r: null };
    case 'buyDev':
      return seat === e.p ? { ...e } : { ...e, card: null };
    default:
      return cloneJson(e);
  }
}

export function eventsFor(events: GameEvent[], seat: Seat | null): GameEvent[] {
  return events.map((e) => eventFor(e, seat));
}
