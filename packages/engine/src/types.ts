/* Shared types for game state, actions and events. Everything here is plain JSON. */

export const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RES)[number];
export type Terrain = Resource | 'desert';
export type ResCounts = Record<Resource, number>;
export type PartialRes = Partial<ResCounts>;

export const DEV_PLAY = ['knight', 'road', 'plenty', 'mono'] as const;
export type DevPlayable = (typeof DEV_PLAY)[number];
export const DEV_TYPES = ['knight', 'road', 'plenty', 'mono', 'vp'] as const;
export type DevType = (typeof DEV_TYPES)[number];
export type DevCounts = Record<DevPlayable, number>;

export type PortType = Resource | 'any';
export type Seat = number;
export type PieceKind = 'road' | 'settlement' | 'city';

export const COLORS = ['red', 'blue', 'white', 'purple', 'orange'] as const;
export type Color = (typeof COLORS)[number];

/** One hex on the board. `n` is the number token; 0 means none (desert, sea). */
export interface HexData {
  q: number;
  r: number;
  t: Terrain;
  n: number;
}

/** A port sits on a coastal edge, identified by its edge index in the board geometry. */
export interface Port {
  e: number;
  t: PortType;
}

export interface Board {
  hexes: HexData[];
  ports: Port[];
  robber: number;
}

/** A building on a vertex: [owner seat, 1 = settlement | 2 = city]. */
export type Building = [Seat, 1 | 2];

export interface Player {
  /** Opaque id assigned by the server; not a secret. */
  pid: string;
  color: Color;
  nick: string;
  res: ResCounts;
  /** Playable dev cards (bought before this turn). */
  dev: DevCounts;
  /** Dev cards bought this turn; playable from next turn. */
  fresh: DevCounts;
  vpCards: number;
  /** Knights played (public). */
  knights: number;
  /** Non-knight dev cards played (public). */
  played: { road: number; plenty: number; mono: number };
  pieces: Record<PieceKind, number>;
}

export type Stage = 'setup' | 'preroll' | 'discard' | 'robber' | 'main' | 'roads';

export interface Offer {
  id: number;
  from: Seat;
  give: ResCounts;
  want: ResCounts;
  /** Responses: 1 = accepted, 0 = declined. */
  resp: Record<number, 0 | 1>;
}

export interface GameConfig {
  winVP: number;
}

export interface GameState {
  /** State schema version. */
  v: 1;
  config: GameConfig;
  /** PRNG state. Server-only. */
  rng: [number, number, number, number];
  /** Number of actions applied so far. */
  seq: number;
  phase: 'play' | 'over';
  stage: Stage;
  board: Board;
  verts: (Building | null)[];
  edges: (Seat | null)[];
  players: Player[];
  bank: ResCounts;
  /** Remaining dev cards by type. Composition is server-only; the count is public. */
  deck: Record<DevType, number>;
  turn: Seat;
  turnN: number;
  setupI: number;
  dice: [number, number] | null;
  /** Seats that still owe a discard, and how many cards. */
  discard: Record<number, number> | null;
  robberReturn: 'preroll' | 'main' | null;
  freeRoads: number;
  roadsReturn: 'preroll' | 'main' | null;
  devPlayed: boolean;
  longest: Seat | null;
  largest: Seat | null;
  roadLens: number[];
  offers: Offer[];
  offerN: number;
  winner: Seat | null;
}

/* ---------- Actions (what a seat asks to do) ---------- */

export type Action =
  | { type: 'setup'; v: number; e: number }
  | { type: 'roll' }
  | { type: 'discard'; cards: PartialRes }
  | { type: 'robber'; hex: number; victim?: Seat | null }
  | { type: 'end' }
  | { type: 'road'; e: number }
  | { type: 'settlement'; v: number }
  | { type: 'city'; v: number }
  | { type: 'buyDev' }
  | { type: 'playKnight' }
  | { type: 'playRoads' }
  | { type: 'playPlenty'; r1: Resource; r2: Resource }
  | { type: 'playMono'; r: Resource }
  | { type: 'freeRoad'; e: number }
  | { type: 'skipRoads' }
  | { type: 'bank'; give: Resource; get: Resource }
  | { type: 'offer'; give: PartialRes; want: PartialRes }
  | { type: 'respond'; id: number; yes: boolean }
  | { type: 'confirm'; id: number; with: Seat }
  | { type: 'cancel'; id: number };

export type ActionType = Action['type'];

/* ---------- Events (what happened; drive animations and the log) ---------- */

export type GameEvent =
  | { k: 'start'; players: number }
  | { k: 'setup'; p: Seat; v: number; e: number; got: PartialRes | null }
  | { k: 'turn'; p: Seat }
  | { k: 'roll'; p: Seat; d: [number, number] }
  | { k: 'produce'; gains: Record<number, PartialRes>; short: Resource[] }
  | { k: 'mustDiscard'; need: Record<number, number> }
  | { k: 'discard'; p: Seat; c: ResCounts }
  | { k: 'robber'; p: Seat; h: number; victim: Seat | null }
  /** `r` is null for seats that may not see which card was stolen. */
  | { k: 'steal'; p: Seat; from: Seat; r: Resource | null }
  | { k: 'build'; p: Seat; what: PieceKind; at: number; free?: boolean }
  /** `card` is null for everyone but the buyer. */
  | { k: 'buyDev'; p: Seat; card: DevType | null }
  | { k: 'playDev'; p: Seat; card: DevPlayable }
  | { k: 'plenty'; p: Seat; got: PartialRes }
  | { k: 'mono'; p: Seat; r: Resource; from: Record<number, number> }
  | { k: 'bank'; p: Seat; give: Resource; n: number; get: Resource }
  | { k: 'offer'; offer: Offer }
  | { k: 'respond'; id: number; p: Seat; yes: boolean }
  | { k: 'cancelOffer'; id: number }
  | { k: 'trade'; a: Seat; b: Seat; give: ResCounts; want: ResCounts }
  | { k: 'longest'; p: Seat | null; n: number; from: Seat | null }
  | { k: 'largest'; p: Seat; n: number; from: Seat | null }
  | { k: 'win'; p: Seat; vp: number };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };
