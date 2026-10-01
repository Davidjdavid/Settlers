/* Shared types for game state, actions and events. Everything here is plain JSON. */

export const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RES)[number];
/** Land that produces nothing is `desert`; `gold` produces a resource of the owner's choice. */
export type Terrain = Resource | 'desert' | 'gold' | 'sea' | 'fog';
export const isResource = (t: string): t is Resource => (RES as readonly string[]).includes(t);
/** Known land: anything you can build next to. Sea and undiscovered fog are not land. */
export const isLand = (t: Terrain) => t !== 'sea' && t !== 'fog';
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
export type EdgePiece = 'road' | 'ship';
export const MODULES = ['seafarers'] as const;
export type ModuleId = (typeof MODULES)[number];

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
  /** Hex index of the robber, or -1 when it is off the board. */
  robber: number;
  /** Seafarers: hex index of the pirate, or -1 when it is off the board. */
  pirate?: number;
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
  /** Pieces left in supply. `ship` only exists with Seafarers. */
  pieces: { road: number; settlement: number; city: number; ship?: number };
}

/** `gold`: players owed gold-field resources are choosing them (Seafarers). */
export type Stage = 'setup' | 'preroll' | 'discard' | 'robber' | 'main' | 'roads' | 'gold';

export interface Offer {
  id: number;
  from: Seat;
  give: ResCounts;
  want: ResCounts;
  /** Responses: 1 = accepted, 0 = declined. */
  resp: Record<number, 0 | 1>;
}

/** House rules: each is off unless set. */
export interface HouseRules {
  /** A 7 rolled during any player's first turn is rolled again. */
  no7FirstRound?: boolean;
  /** The bank trades 3:1 for everyone (2:1 harbors still apply). */
  bank3to1?: boolean;
  /** Seafarers: no limit on ship moves per turn. */
  freeShipMoves?: boolean;
}

/**
 * Everything that defines how a game is played. Saved with the game. Fields other than winVP
 * are only present when used, so a classic base game's config is exactly { winVP: 10 }.
 */
export interface GameConfig {
  winVP: number;
  /** Expansion modules on top of the base rules. */
  modules?: ModuleId[];
  /** The map or scenario (a copy of its data file, so saved games never depend on files changing). */
  map?: import('./map').MapData;
  houseRules?: HouseRules;
}

/** Seafarers state. Only present when the seafarers module is on. */
export interface SeaState {
  /** Ship owner per edge. */
  ships: (Seat | null)[];
  /** Edges of ships built this turn (they can't move). */
  builtThisTurn: number[];
  /** Ship moves made this turn. */
  movesThisTurn: number;
  /** Per player: the hexes of each home island (where they started). */
  home: number[][][];
  /** Per player: the hexes of each island they've earned the new-island bonus for. */
  bonus: number[][][];
  /** Per player: special victory points (new islands etc.). Public. */
  specialVP: number[];
  /** Gold-field resources owed per seat, and the stage to return to when all are chosen. */
  gold: { owed: Record<number, number>; back: Stage } | null;
  /** Fog stacks still face down, in draw order. Server-only. */
  fog: { terrain: Terrain[]; numbers: number[] };
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
  /** Seafarers state; absent without Seafarers. */
  sea?: SeaState;
}

/* ---------- Actions (what a seat asks to do) ---------- */

export type Action =
  /** Setup placement: a settlement plus a road on `e`, or a ship when `ship` is true (Seafarers). */
  | { type: 'setup'; v: number; e: number; ship?: boolean }
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
  | { type: 'cancel'; id: number }
  /* Seafarers */
  | { type: 'ship'; e: number }
  | { type: 'freeShip'; e: number }
  | { type: 'moveShip'; from: number; to: number }
  | { type: 'pirate'; hex: number; victim?: Seat | null }
  | { type: 'chooseGold'; cards: PartialRes };

export type ActionType = Action['type'];

/* ---------- Events (what happened; drive animations and the log) ---------- */

export type GameEvent =
  | { k: 'start'; players: number }
  | { k: 'setup'; p: Seat; v: number; e: number; got: PartialRes | null; ship?: boolean }
  | { k: 'turn'; p: Seat }
  /** `redo`: a 7 that is rolled again because of the no-7s-in-the-first-round house rule. */
  | { k: 'roll'; p: Seat; d: [number, number]; redo?: boolean }
  | { k: 'produce'; gains: Record<number, PartialRes>; short: Resource[] }
  | { k: 'mustDiscard'; need: Record<number, number> }
  | { k: 'discard'; p: Seat; c: ResCounts }
  | { k: 'robber'; p: Seat; h: number; victim: Seat | null }
  /** `r` is null for seats that may not see which card was stolen. */
  | { k: 'steal'; p: Seat; from: Seat; r: Resource | null }
  | { k: 'build'; p: Seat; what: PieceKind | 'ship'; at: number; free?: boolean }
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
  | { k: 'win'; p: Seat; vp: number }
  /* Seafarers */
  | { k: 'moveShip'; p: Seat; from: number; to: number }
  | { k: 'pirate'; p: Seat; h: number; victim: Seat | null }
  /** Gold-field resources owed, to be chosen. */
  | { k: 'goldOwed'; owed: Record<number, number> }
  | { k: 'gold'; p: Seat; got: PartialRes }
  /** A fog hex was discovered. `got` is the discoverer's reward (gold is chosen separately). */
  | { k: 'discover'; p: Seat; h: number; t: Terrain; n: number; got: PartialRes | null }
  | { k: 'islandBonus'; p: Seat; vp: number };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };
