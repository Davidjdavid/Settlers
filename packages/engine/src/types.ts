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

/** Cities & Knights commodities. Only cities produce them; the supply is unlimited. */
export const COMS = ['paper', 'cloth', 'coin'] as const;
export type Commodity = (typeof COMS)[number];
export const isCommodity = (t: string): t is Commodity => (COMS as readonly string[]).includes(t);
/** A card in hand: a resource, or (with Cities & Knights) a commodity. */
export type Card = Resource | Commodity;
export type Cards = Partial<Record<Card, number>>;
/** A hand of cards. Commodity keys are only present with Cities & Knights. */
export type Hand = ResCounts & Partial<Record<Commodity, number>>;

/** Cities & Knights improvement tracks, and the commodity each is bought with. */
export const TRACKS = ['trade', 'politics', 'science'] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_COM: Record<Track, Commodity> = { trade: 'cloth', politics: 'coin', science: 'paper' };

/** Progress cards in each deck, with how many of each. */
export const PROGRESS = {
  trade: { commercialHarbor: 2, masterMerchant: 2, merchant: 6, merchantFleet: 2, resourceMonopoly: 4, tradeMonopoly: 2 },
  science: {
    alchemist: 2, crane: 2, engineer: 1, inventor: 2, irrigation: 2, medicine: 2, mining: 2, printer: 1,
    roadBuilding: 2, smith: 2,
  },
  politics: {
    bishop: 2, constitution: 1, deserter: 2, diplomat: 2, intrigue: 2, saboteur: 2, spy: 3, warlord: 2, wedding: 2,
  },
} as const; // prettier-ignore
export type Progress = {
  [T in Track]: keyof (typeof PROGRESS)[T];
}[Track];
export const trackOf = (c: Progress): Track =>
  c in PROGRESS.trade ? 'trade' : c in PROGRESS.science ? 'science' : 'politics';
/** Victory-point progress cards are shown at once and never held. */
export const PROGRESS_VP: readonly Progress[] = ['printer', 'constitution'];

export const DEV_PLAY = ['knight', 'road', 'plenty', 'mono'] as const;
export type DevPlayable = (typeof DEV_PLAY)[number];
export const DEV_TYPES = ['knight', 'road', 'plenty', 'mono', 'vp'] as const;
export type DevType = (typeof DEV_TYPES)[number];
export type DevCounts = Record<DevPlayable, number>;

export type PortType = Resource | 'any';
export type Seat = number;
export type PieceKind = 'road' | 'settlement' | 'city';
export type EdgePiece = 'road' | 'ship';
export const MODULES = ['seafarers', 'citiesKnights'] as const;
export type ModuleId = (typeof MODULES)[number];

export const COLORS = [
  'red',
  'blue',
  'white',
  'orange',
  'purple',
  'black',
  'pink',
  'yellow',
  'gray',
] as const;
/** Colours people can pick; gray is only for CPU players (SPEC 4.2). */
export const PLAYER_COLORS = ['red', 'blue', 'white', 'orange', 'purple', 'black', 'pink', 'yellow'] as const;
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
  res: Hand;
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
  /** A CPU player (docs/bot.md). Public. Absent for people. */
  cpu?: true;
}

/**
 * `gold`: players owed gold-field resources are choosing them (Seafarers).
 * `ck`: players owe Cities & Knights choices (see CKState.owe).
 */
export type Stage = 'setup' | 'preroll' | 'discard' | 'robber' | 'main' | 'roads' | 'gold' | 'ck';

export interface Offer {
  id: number;
  from: Seat;
  give: Hand;
  want: Hand;
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
  /** Cities & Knights: 7s are rolled again until the barbarians have attacked. */
  rerollBeforeAttack?: boolean;
  /** Cities & Knights: a 7 does nothing (no discards) until the barbarians have attacked. */
  noDiscardBeforeAttack?: boolean;
  /** Cities & Knights: the event die isn't rolled for this many rounds. */
  barbarianDelay?: number;
  /** After ending a turn, the dice can be handed back until the next player acts (SPEC 4.4). */
  handBack?: boolean;
  /** ...also after a starting placement. */
  handBackSetup?: boolean;
  /** Players may ask everyone to undo their last move (SPEC 5.10). */
  undo?: boolean;
}

/** Game rules a player may change during their turn (SPEC 4.5). */
export const RULE_KEYS = [
  'winVP', 'no7FirstRound', 'bank3to1', 'freeShipMoves', 'rerollBeforeAttack', 'noDiscardBeforeAttack',
  'barbarianDelay', 'handBack', 'handBackSetup', 'undo',
] as const; // prettier-ignore
export type RuleKey = (typeof RULE_KEYS)[number];

/** A turn that can still be handed back. */
export interface HandBack {
  /** The player who ended the turn (or made the starting placement). */
  from: Seat;
  asked: boolean;
  refused: boolean;
  /** The game as it was before; restored on hand-back. Server-only. */
  state: GameState | null;
}

/** A move that can still be undone, if everyone agrees (SPEC 5.10). */
export interface UndoState {
  /** Whose move it was. */
  p: Seat;
  asked: boolean;
  /** Who has said yes so far (CPUs say yes as soon as it's asked). */
  ok: Seat[];
  /** The game as it was before the move; restored on undo. Server-only. */
  state: GameState | null;
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

/** A Cities & Knights knight. Per-turn flags only ever appear on the turn player's knights. */
export interface Knight {
  p: Seat;
  /** Strength: 1 basic, 2 strong, 3 mighty. */
  lvl: 1 | 2 | 3;
  on: boolean;
  /** Activated this turn: can't act until next turn. */
  fresh?: true;
  /** Promoted this turn. */
  up?: true;
}

/** A Cities & Knights choice a player owes before play continues. */
export type Owe =
  /** Lose a city to the barbarians. */
  | { k: 'loseCity'; p: Seat }
  /** Draw a progress card from a deck of your choice (tie against the barbarians). */
  | { k: 'defenderDraw'; p: Seat }
  /** Put one progress card under its deck (more than 4 on someone else's turn). */
  | { k: 'overflow'; p: Seat }
  /** Aqueduct: take a resource of your choice. */
  | { k: 'aqueduct'; p: Seat }
  /** Place your displaced knight (it is off the board until you do). */
  | { k: 'relocate'; p: Seat; lvl: 1 | 2 | 3; on: boolean; not: number }
  /** Deserter: remove one of your knights. */
  | { k: 'desert'; p: Seat; by: Seat }
  /** Deserter: you may place a knight like the one removed. */
  | { k: 'deserterPlace'; p: Seat; lvl: 1 | 2 | 3; on: boolean }
  /** Wedding: give `n` cards of your choice to `to`. */
  | { k: 'give'; p: Seat; to: Seat; n: number }
  /** Saboteur: discard `n` cards of your choice. */
  | { k: 'discard'; p: Seat; n: number }
  /** Commercial Harbor: offer a resource to each of `left` (or skip them). */
  | { k: 'harbor'; p: Seat; left: Seat[] }
  /** Commercial Harbor: give `to` a commodity for the resource `r` they gave you. */
  | { k: 'harborGive'; p: Seat; to: Seat; r: Resource }
  /** Master Merchant: take `n` cards from `from`'s hand (you can see it). */
  | { k: 'take'; p: Seat; from: Seat; n: number }
  /** Spy: take a progress card from `from` (you can see them). */
  | { k: 'spy'; p: Seat; from: Seat }
  /** Diplomat: you may rebuild your removed road for free. */
  | { k: 'rebuild'; p: Seat };

/** Cities & Knights state. Only present when the citiesKnights module is on. */
export interface CKState {
  /** Improvement levels per player. */
  lvl: Record<Track, number>[];
  /** Vertex of each metropolis (its owner is the city's owner), or null. */
  metro: Record<Track, number | null>;
  /** Vertices of cities with a wall. */
  walls: number[];
  /** Knight per vertex. */
  knights: (Knight | null)[];
  /** Barbarian ship position, 0 to 6 (it attacks on reaching 7). */
  barb: number;
  attacks: number;
  /** Progress decks, top first. Order is server-only; sizes are public. */
  decks: Record<Track, Progress[]>;
  /** Progress cards in each player's hand (private; colour counts public). */
  hands: Progress[][];
  /** Victory-point progress cards on the table. */
  shown: Progress[][];
  /** Defender of Catan cards per player. */
  defender: number[];
  merchant: { h: number; p: Seat } | null;
  /** Merchant Fleet: cards the turn player trades 2:1 this turn. */
  fleet: Card[];
  /** Crane: improvements this turn that cost 1 less. */
  crane: number;
  /** Alchemist: the production dice chosen for this turn's roll. */
  alchemy: [number, number] | null;
  /** The event die on the last roll, or null if it wasn't rolled. */
  event: 'ship' | Track | null;
  /** Choices owed, answered in any order (each player's in sequence). */
  owe: Owe[];
  /** Stage to return to when nothing is owed. */
  back: Stage | null;
  /** What happens when nothing is owed: finish the roll, or just go back. */
  then: 'produce' | null;
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
  bank: Hand;
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
  /** Cities & Knights state; absent without it. */
  ck?: CKState;
  /** A turn that can still be handed back; absent otherwise. */
  back?: HandBack;
  /** The last move, while it can still be undone; absent otherwise. */
  undo?: UndoState;
}

/** Where a player's points come from (SPEC 5.8). */
export type VPSource =
  | 'settlement'
  | 'city'
  | 'longest'
  | 'largest'
  | 'vpCards'
  | 'island'
  | 'metropolis'
  | 'defender'
  | 'merchant'
  | 'progress';
/** `n` of something worth `vp` points in all; `hidden` only for the owner's own VP cards. */
export interface VPPart {
  k: VPSource;
  n: number;
  vp: number;
  hidden?: true;
}

/** Pieces a player has in their supply (SPEC 5.11). knight1–3 are basic, strong and mighty. */
export type SupplyKind = 'road' | 'settlement' | 'city' | 'ship' | 'knight1' | 'knight2' | 'knight3' | 'wall';

/* ---------- Actions (what a seat asks to do) ---------- */

/**
 * Dice rolled by the server (SPEC 5.3): one value from 1 to 6 per die, used in order. `d` are
 * the number dice (two per roll, more if a 7 is rolled again), `e` the event die (Cities &
 * Knights). Players never send these; the server adds them to every roll it accepts.
 */
export interface ServerDice {
  d: number[];
  e?: number[];
}

export type Action =
  /** Setup placement: a settlement plus a road on `e`, or a ship when `ship` is true (Seafarers). */
  | { type: 'setup'; v: number; e: number; ship?: boolean }
  | { type: 'roll'; dice?: ServerDice }
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
  | { type: 'bank'; give: Card; get: Card }
  | { type: 'offer'; give: PartialRes; want: PartialRes }
  | { type: 'respond'; id: number; yes: boolean }
  | { type: 'confirm'; id: number; with: Seat }
  | { type: 'cancel'; id: number }
  /* Seafarers */
  | { type: 'ship'; e: number }
  | { type: 'freeShip'; e: number }
  | { type: 'moveShip'; from: number; to: number }
  | { type: 'pirate'; hex: number; victim?: Seat | null }
  | { type: 'chooseGold'; cards: PartialRes }
  /* Handing the dice back (SPEC 4.4) */
  | { type: 'askBack' }
  | { type: 'handBack' }
  | { type: 'refuseBack' }
  | { type: 'askUndo' }
  | { type: 'answerUndo'; yes: boolean }
  | { type: 'cancelUndo' }
  /** Change a game rule during your turn. */
  | { type: 'setRule'; rule: RuleKey; value: boolean | number }
  /* Cities & Knights */
  | { type: 'improve'; track: Track; v?: number }
  | { type: 'wall'; v: number }
  | { type: 'knight'; v: number }
  | { type: 'promote'; v: number }
  | { type: 'activate'; v: number }
  /** Move an active knight; onto a weaker opponent's knight, this displaces it. */
  | { type: 'moveKnight'; from: number; to: number }
  | { type: 'chase'; v: number; hex: number; victim?: Seat | null }
  /** Put a progress card under its deck (your own turn, holding more than 4). */
  | { type: 'dropProgress'; card: Progress }
  /** Play a progress card. Which fields matter depends on the card (docs/rules/cities-and-knights.md). */
  | {
      type: 'progress';
      card: Progress;
      d?: [number, number];
      v?: number;
      vs?: number[];
      h?: number;
      h2?: number;
      e?: number;
      to?: Seat;
      r?: Card;
    }
  /** Answer the first choice you owe. Which fields matter depends on the choice. */
  | {
      type: 'choose';
      v?: number;
      e?: number;
      track?: Track;
      card?: Progress;
      r?: Card;
      cards?: Cards;
      to?: Seat;
      skip?: boolean;
    };

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
  | { k: 'discard'; p: Seat; c: Hand }
  | { k: 'robber'; p: Seat; h: number; victim: Seat | null }
  /** `r` is null for seats that may not see which card was stolen. */
  | { k: 'steal'; p: Seat; from: Seat; r: Card | null }
  | { k: 'build'; p: Seat; what: PieceKind | 'ship'; at: number; free?: boolean }
  /** `card` is null for everyone but the buyer. */
  | { k: 'buyDev'; p: Seat; card: DevType | null }
  | { k: 'playDev'; p: Seat; card: DevPlayable }
  | { k: 'plenty'; p: Seat; got: PartialRes }
  | { k: 'mono'; p: Seat; r: Resource; from: Record<number, number> }
  | { k: 'bank'; p: Seat; give: Card; n: number; get: Card }
  | { k: 'offer'; offer: Offer }
  | { k: 'respond'; id: number; p: Seat; yes: boolean }
  | { k: 'cancelOffer'; id: number }
  | { k: 'trade'; a: Seat; b: Seat; give: Hand; want: Hand }
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
  | { k: 'islandBonus'; p: Seat; vp: number }
  | { k: 'askBack'; p: Seat }
  | { k: 'handBack'; p: Seat; to: Seat }
  | { k: 'refuseBack'; p: Seat }
  | { k: 'askUndo'; p: Seat }
  | { k: 'answerUndo'; p: Seat; yes: boolean }
  | { k: 'cancelUndo'; p: Seat }
  | { k: 'undo'; p: Seat }
  | { k: 'rule'; p: Seat; rule: RuleKey; value: boolean | number }
  /* Cities & Knights */
  | { k: 'eventDie'; face: 'ship' | Track }
  | { k: 'barbarians'; at: number }
  | {
      k: 'attack';
      strength: number;
      defense: number;
      /** Seats that lose a city (barbarians won). */
      losers: Seat[];
      /** The sole best defender (Catan won), or null. */
      defender: Seat | null;
      /** Tied best defenders, who draw a progress card each. */
      tied: Seat[];
    }
  | { k: 'cityLost'; p: Seat; v: number }
  /** A progress card drawn. `card` is null for others, except victory-point cards. */
  | { k: 'draw'; p: Seat; track: Track; card: Progress | null }
  | { k: 'commodities'; gains: Record<number, Cards> }
  | { k: 'improve'; p: Seat; track: Track; lvl: number }
  | { k: 'metropolis'; p: Seat; track: Track; v: number; from: Seat | null }
  | { k: 'wall'; p: Seat; v: number; free?: boolean }
  | { k: 'knight'; p: Seat; v: number }
  | { k: 'promote'; p: Seat; v: number; lvl: number; free?: boolean }
  | { k: 'activate'; p: Seat; v: number }
  | { k: 'activateAll'; p: Seat; n: number }
  | { k: 'moveKnight'; p: Seat; from: number; to: number; displaced: Seat | null }
  /** A displaced or deserting knight placed again (`to`), or removed (null). */
  | { k: 'relocate'; p: Seat; to: number | null }
  | { k: 'knightRemoved'; p: Seat; v: number }
  | { k: 'chase'; p: Seat; v: number }
  | { k: 'progress'; p: Seat; card: Progress }
  /** A progress card put under its deck. */
  | { k: 'progressBack'; p: Seat; track: Track }
  | { k: 'aqueduct'; p: Seat; r: Resource }
  /** Cards handed over (Wedding, Master Merchant, Commercial Harbor). `cards` is null for others. */
  | { k: 'give'; from: Seat; to: Seat; n: number; cards: Cards | null }
  /** Spy: `card` is null for others; its colour is public. */
  | { k: 'spy'; p: Seat; from: Seat; track: Track; card: Progress | null }
  | { k: 'merchant'; p: Seat; h: number }
  | { k: 'inventor'; p: Seat; h: number; h2: number }
  /** Cards taken from the bank or from players by a progress card. */
  | { k: 'gain'; p: Seat; cards: Cards; from: Record<number, number> | null }
  | { k: 'roadRemoved'; p: Seat; e: number; by: Seat }
  /** Owed choices begin (the UI shows each its sheet). */
  | { k: 'owe'; owe: Owe[] };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };
