/*
 * The WebSocket protocol between browser and server. Client messages are validated with
 * zod; anything that doesn't match is rejected. The client imports these types only.
 */

import { z } from 'zod';
import type { Color, GameEvent, PlayerView } from '@settlers/engine';

const RES = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore']);
const CARD = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore', 'paper', 'cloth', 'coin']);
const TRACK = z.enum(['trade', 'politics', 'science']);
const PROGRESS = z.enum([
  'commercialHarbor', 'masterMerchant', 'merchant', 'merchantFleet', 'resourceMonopoly', 'tradeMonopoly',
  'alchemist', 'crane', 'engineer', 'inventor', 'irrigation', 'medicine', 'mining', 'printer', 'roadBuilding', 'smith',
  'bishop', 'constitution', 'deserter', 'diplomat', 'intrigue', 'saboteur', 'spy', 'warlord', 'wedding',
]); // prettier-ignore
const COLOR = z.enum(['red', 'blue', 'white', 'orange', 'purple', 'black', 'pink', 'yellow', 'gray']);
const count = z.number().int().min(0).max(95);
/** Card counts. Commodities only mean something in Cities & Knights; the engine checks. */
const cards = z.strictObject({
  wood: count.optional(),
  brick: count.optional(),
  sheep: count.optional(),
  wheat: count.optional(),
  ore: count.optional(),
  paper: count.optional(),
  cloth: count.optional(),
  coin: count.optional(),
});
const idx = z.number().int().min(0).max(999);
const die = z.number().int().min(1).max(6);

export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('setup'), v: idx, e: idx, ship: z.boolean().optional() }),
  z.strictObject({ type: z.literal('roll') }),
  z.strictObject({ type: z.literal('discard'), cards }),
  z.strictObject({ type: z.literal('robber'), hex: idx, victim: idx.nullable().optional() }),
  z.strictObject({ type: z.literal('end') }),
  z.strictObject({ type: z.literal('road'), e: idx }),
  z.strictObject({ type: z.literal('settlement'), v: idx }),
  z.strictObject({ type: z.literal('city'), v: idx }),
  z.strictObject({ type: z.literal('buyDev') }),
  z.strictObject({ type: z.literal('playKnight') }),
  z.strictObject({ type: z.literal('playRoads') }),
  z.strictObject({ type: z.literal('playPlenty'), r1: RES, r2: RES }),
  z.strictObject({ type: z.literal('playMono'), r: RES }),
  z.strictObject({ type: z.literal('freeRoad'), e: idx }),
  z.strictObject({ type: z.literal('skipRoads') }),
  z.strictObject({ type: z.literal('bank'), give: CARD, get: CARD }),
  z.strictObject({ type: z.literal('offer'), give: cards, want: cards }),
  z.strictObject({ type: z.literal('respond'), id: idx.max(1e6), yes: z.boolean() }),
  z.strictObject({ type: z.literal('confirm'), id: idx.max(1e6), with: idx }),
  z.strictObject({ type: z.literal('cancel'), id: idx.max(1e6) }),
  z.strictObject({ type: z.literal('ship'), e: idx }),
  z.strictObject({ type: z.literal('freeShip'), e: idx }),
  z.strictObject({ type: z.literal('moveShip'), from: idx, to: idx }),
  z.strictObject({ type: z.literal('pirate'), hex: idx, victim: idx.nullable().optional() }),
  z.strictObject({ type: z.literal('chooseGold'), cards }),
  z.strictObject({ type: z.literal('askBack') }),
  z.strictObject({ type: z.literal('handBack') }),
  z.strictObject({ type: z.literal('refuseBack') }),
  z.strictObject({
    type: z.literal('setRule'),
    rule: z.enum([
      'winVP', 'no7FirstRound', 'bank3to1', 'freeShipMoves', 'rerollBeforeAttack', 'noDiscardBeforeAttack',
      'barbarianDelay', 'handBack', 'handBackSetup',
    ]), // prettier-ignore
    value: z.union([z.boolean(), z.number().int().min(0).max(30)]),
  }),
  z.strictObject({ type: z.literal('improve'), track: TRACK, v: idx.optional() }),
  z.strictObject({ type: z.literal('wall'), v: idx }),
  z.strictObject({ type: z.literal('knight'), v: idx }),
  z.strictObject({ type: z.literal('promote'), v: idx }),
  z.strictObject({ type: z.literal('activate'), v: idx }),
  z.strictObject({ type: z.literal('moveKnight'), from: idx, to: idx }),
  z.strictObject({ type: z.literal('chase'), v: idx, hex: idx, victim: idx.nullable().optional() }),
  z.strictObject({ type: z.literal('dropProgress'), card: PROGRESS }),
  z.strictObject({
    type: z.literal('progress'),
    card: PROGRESS,
    d: z.tuple([die, die]).optional(),
    v: idx.optional(),
    vs: z.array(idx).max(2).optional(),
    h: idx.optional(),
    h2: idx.optional(),
    e: idx.optional(),
    to: idx.optional(),
    r: CARD.optional(),
  }),
  z.strictObject({
    type: z.literal('choose'),
    v: idx.optional(),
    e: idx.optional(),
    track: TRACK.optional(),
    card: PROGRESS.optional(),
    r: CARD.optional(),
    cards: cards.optional(),
    to: idx.optional(),
    skip: z.boolean().optional(),
  }),
]);

export const OptionsSchema = z.strictObject({
  scenario: z.enum(['classic', 'heading-for-new-shores']),
  /** Cities & Knights on top of the scenario. */
  ck: z.boolean().optional(),
  winVP: z.number().int().min(5).max(30),
  houseRules: z.strictObject({
    no7FirstRound: z.boolean().optional(),
    bank3to1: z.boolean().optional(),
    freeShipMoves: z.boolean().optional(),
    rerollBeforeAttack: z.boolean().optional(),
    noDiscardBeforeAttack: z.boolean().optional(),
    barbarianDelay: z.number().int().min(0).max(10).optional(),
    /** Handing the dice back; on unless set to false. */
    handBack: z.boolean().optional(),
    handBackSetup: z.boolean().optional(),
  }),
});

/** Personal confirmation settings (SPEC 4.3), saved under your nickname. Missing means on. */
export const SettingsSchema = z.strictObject({
  confirmPlace: z.boolean().optional(),
  confirmPlaceTouch: z.boolean().optional(),
  confirmEnd: z.boolean().optional(),
  confirmCard: z.boolean().optional(),
  confirmTrade: z.boolean().optional(),
});
export type PlayerSettings = z.infer<typeof SettingsSchema>;
export type RoomOptions = z.infer<typeof OptionsSchema>;
export const DEFAULT_OPTIONS: RoomOptions = { scenario: 'classic', winVP: 10, houseRules: {} };

const roomCode = z.string().regex(/^[A-Z0-9]{4,8}$/);
const nick = z.string().min(1).max(40);

export const ClientMsgSchema = z.discriminatedUnion('t', [
  /** Attach to a room; with a token, resume your seat. */
  z.strictObject({ t: z.literal('hello'), room: roomCode, token: z.string().max(100).optional() }),
  z.strictObject({ t: z.literal('create') }),
  z.strictObject({ t: z.literal('join'), nick, color: COLOR }),
  z.strictObject({ t: z.literal('setColor'), color: COLOR }),
  z.strictObject({ t: z.literal('leave') }),
  z.strictObject({ t: z.literal('start') }),
  /** Lobby only: add a CPU player (any seated player), rename/recolour or remove one (anyone). */
  z.strictObject({ t: z.literal('addCpu') }),
  z.strictObject({
    t: z.literal('editCpu'),
    pid: z.string().max(40),
    nick: nick.optional(),
    color: COLOR.optional(),
  }),
  z.strictObject({ t: z.literal('removeCpu'), pid: z.string().max(40) }),
  /** Lobby only: scenario, points to win and house rules for the next game. */
  z.strictObject({ t: z.literal('setOptions'), options: OptionsSchema }),
  /** Save your personal settings (you must be seated; they're kept under your nickname). */
  z.strictObject({ t: z.literal('saveSettings'), settings: SettingsSchema }),
  /** `id` makes resends after a dropped connection safe: an id is applied at most once. */
  z.strictObject({ t: z.literal('act'), id: z.string().min(1).max(64), action: ActionSchema }),
  z.strictObject({ t: z.literal('chat'), text: z.string().min(1).max(240) }),
  z.strictObject({ t: z.literal('resetRequest') }),
  z.strictObject({ t: z.literal('resetConfirm') }),
  z.strictObject({ t: z.literal('resetCancel') }),
  z.strictObject({ t: z.literal('claim'), seat: z.number().int().min(0).max(3) }),
  z.strictObject({ t: z.literal('ping') }),
]);

export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export interface SeatInfo {
  pid: string;
  nick: string;
  color: Color;
  connected: boolean;
  /** A CPU player. */
  cpu?: boolean;
}

export interface RoomInfo {
  code: string;
  seats: SeatInfo[];
  /** Your seat's pid, or null if you are watching. */
  me: string | null;
  phase: 'lobby' | 'play' | 'over';
  /** Options for the next game (shown in the lobby). */
  options: RoomOptions;
  /** Your personal settings, if you're seated (missing fields mean on). */
  mySettings: PlayerSettings | null;
  pendingReset: { pid: string; nick: string; expiresAt: number } | null;
}

export type LogItem =
  | { k: 'ev'; seq: number; at: number; e: GameEvent }
  | { k: 'chat'; id: number; at: number; pid: string; nick: string; text: string }
  | { k: 'sys'; id: number; at: number; text: string };

export type ServerMsg =
  /** You joined or resumed a seat. Store the token; it is your key to the seat. */
  | { t: 'seat'; room: string; pid: string; token: string }
  /** Full state: replace everything you have. */
  | { t: 'sync'; room: RoomInfo; game: PlayerView | null; log: LogItem[] }
  /** Something changed: new state plus new log items to animate. */
  | { t: 'update'; room: RoomInfo; game: PlayerView | null; log: LogItem[] }
  | { t: 'ack'; id: string; ok: boolean; error?: string }
  | { t: 'error'; text: string }
  | { t: 'notice'; kind: 'info' | 'warn'; text: string }
  | { t: 'pong' };
