/*
 * Rule modules. The base rules are always on; expansions (Seafarers now, Cities & Knights later)
 * plug in through these hook points instead of `if (expansion)` branches in the base rules.
 * A game's modules are listed in config.modules and saved with the game.
 */

import type {
  Action,
  Card,
  GameEvent,
  GameState,
  ModuleId,
  Player,
  Resource,
  Seat,
  SupplyKind,
  VPPart,
} from '../types';
import type { PlayerView } from '../view';

/** What a module's action handler and flow hooks get to work with. All writes go to `s`. */
export interface Ctx {
  s: GameState;
  p: Seat;
  me: Player;
  myTurn: boolean;
  events: GameEvent[];
  /** Roll one die (1–6): the server's dice for this roll, or the game's own PRNG in old games. */
  die: (kind: 'number' | 'event') => number;
}

export interface RuleModule {
  id: ModuleId;

  /** Player counts this module supports (default: whatever the map allows). */
  players?: readonly number[];
  /** Card kinds in hand besides resources (e.g. commodities). */
  cards?: readonly Card[];
  /** No development cards (or Largest Army) in games with this module. */
  noDevCards?: boolean;
  /** Buildings may be left without a road (e.g. a road removed by a card). */
  looseBuildings?: boolean;

  /** Set up the module's state for a new game. */
  init?(s: GameState, fog: { terrain: GameState['board']['hexes'][number]['t'][]; numbers: number[] }): void;

  /* ---------- Placement (combined with AND unless noted) ---------- */
  /** May a road go on edge e at all (ignoring connection)? */
  roadEdgeOK?(s: GameState, e: number): boolean;
  /** May a settlement go on vertex v at all (e.g. it must touch land)? */
  vertexOK?(s: GameState, v: number): boolean;
  /** OR: does p have a non-road piece touching v that lets them settle there? */
  settleSupport?(s: GameState, p: Seat, v: number): boolean;
  /** May a starting settlement go on vertex v? */
  setupVertexOK?(s: GameState, v: number): boolean;
  /** May the robber go on hex h? */
  robberHexOK?(s: GameState, h: number): boolean;
  /** OR: is vertex v taken by a piece that isn't a building (e.g. a knight)? */
  vertexTaken?(s: GameState, v: number): boolean;
  /** OR: does another player's non-building piece at v block p's roads there? */
  blocks?(s: GameState, p: Seat, v: number): boolean;
  /** Is the starting piece placed now (the second if `second`) a city? */
  setupCity?(s: GameState, second: boolean): boolean;

  /* ---------- Scoring ---------- */
  /** Extra public victory points for p (summed across modules). */
  extraVP?(s: GameState, p: Seat): number;
  /** The same points, itemised for the score breakdown (SPEC 5.8). Must add up to extraVP. */
  vpParts?(s: GameState, p: Seat): VPPart[];
  /** Pieces this module adds to a player's supply, with how many are left (SPEC 5.11). */
  piecesLeft?(s: GameState, p: Seat): Partial<Record<SupplyKind, number>>;
  /** Replaces the longest-road length (e.g. roads + ships). */
  routeLen?(s: GameState, p: Seat): number;
  /** How many of resource t a building of `size` (1 settlement, 2 city) produces. */
  yieldOf?(s: GameState, t: Resource, size: 1 | 2): number;
  /** The best bank rate this module gives p for card c, or undefined. */
  rate?(s: GameState, p: Seat, c: Card): number | undefined;
  /** Most cards p can hold when a 7 is rolled (the lowest across modules wins). */
  handLimit?(s: GameState, p: Seat): number;
  /** Is the robber (and pirate) asleep, so a 7 doesn't move it? */
  robberAsleep?(s: GameState): boolean;
  /** Extra free-piece supply for Road Building (e.g. ships). */
  freePieceSupply?(s: GameState, p: Seat): number;
  /** OR: can p place some free piece other than a road right now? */
  canPlaceFreePiece?(s: GameState, p: Seat): boolean;

  /* ---------- Flow ---------- */
  /** Production dice chosen in advance (e.g. Alchemist), or null to roll them. */
  fixedDice?(s: GameState): [number, number] | null;
  /** Should a rolled 7 be rolled again? */
  rerollSeven?(s: GameState): boolean;
  /**
   * After the production dice are rolled, before production. Return true to hold production
   * back; the module then calls continueRoll itself when it's ready.
   */
  afterRoll?(x: Ctx): boolean;
  /** Why a game rule can't change to `value` right now, or null. */
  ruleChangeBlock?(s: GameState, rule: string, value: boolean | number | string): string | null;
  /** Why p can't end their turn yet, or null. */
  endTurnBlock?(s: GameState, p: Seat): string | null;
  /** After normal production on a roll (e.g. gold). */
  afterProduce?(x: Ctx, roll: number): void;
  /** After a starting settlement at v and its piece on e (a ship if `ship`); `second` when it pays out. */
  afterSetupSettlement?(x: Ctx, v: number, second: boolean, e: number, ship: boolean): void;
  /** After a settlement is built during play. */
  afterSettlement?(x: Ctx, v: number): void;
  /** After a road is placed on e (built, free or setup). */
  afterRoad?(x: Ctx, e: number): void;
  /** Place a setup piece other than a road; returns an error or null. */
  placeSetupPiece?(x: Ctx, v: number, e: number): string | null;
  /** After every accepted move (while the game is on), once the move is complete. */
  afterAction?(x: Ctx): void;
  /** At the end of each turn. */
  onTurnEnd?(s: GameState): void;
  /** Seats that must act in a stage this module owns, or undefined if not its stage. */
  waitingOn?(s: GameState): Seat[] | undefined;

  /* ---------- Actions ---------- */
  /** Handle an action. Return undefined if it isn't this module's action. */
  reduce?(x: Ctx, a: Action): string | null | undefined;
  /** Add this module's legal actions for seat p. */
  legal?(s: GameState, p: Seat, out: Action[]): void;

  /* ---------- Checks and views ---------- */
  invariants?(s: GameState): string[];
  transition?(prev: GameState, next: GameState): string[];
  /** Add this module's public fields to a view. */
  view?(s: GameState, seat: Seat | null, v: PlayerView): void;
  /** Rebuild this module's state from a view (placeholders for hidden parts). */
  fromView?(v: PlayerView, s: GameState): void;
}

let registry: Record<ModuleId, () => RuleModule> | null = null;

/** Called once by modules/index.ts. Lazy, so module files can import base queries freely. */
export function registerModules(r: Record<ModuleId, () => RuleModule>) {
  registry = r;
}

const NONE: RuleModule[] = [];
const cache = new WeakMap<object, RuleModule[]>();

/** The active modules for a game, in config order. */
export function mods(s: { config: { modules?: ModuleId[] } }): RuleModule[] {
  const ids = s.config.modules;
  if (!ids || !ids.length) return NONE;
  let m = cache.get(ids);
  if (!m) {
    if (!registry) throw new Error('rule modules not registered');
    m = ids.map((id) => registry![id]());
    cache.set(ids, m);
  }
  return m;
}

export const hasModule = (s: { config: { modules?: ModuleId[] } }, id: ModuleId) =>
  !!s.config.modules?.includes(id);
