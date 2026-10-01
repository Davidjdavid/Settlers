/*
 * The WebSocket protocol between browser and server. Client messages are validated with
 * zod; anything that doesn't match is rejected. The client imports these types only.
 */

import { z } from 'zod';
import type { Color, GameEvent, PlayerView } from '@settlers/engine';

const RES = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore']);
const COLOR = z.enum(['red', 'blue', 'white', 'purple', 'orange']);
const count = z.number().int().min(0).max(95);
const cards = z.strictObject({
  wood: count.optional(),
  brick: count.optional(),
  sheep: count.optional(),
  wheat: count.optional(),
  ore: count.optional(),
});
const idx = z.number().int().min(0).max(999);

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
  z.strictObject({ type: z.literal('bank'), give: RES, get: RES }),
  z.strictObject({ type: z.literal('offer'), give: cards, want: cards }),
  z.strictObject({ type: z.literal('respond'), id: idx.max(1e6), yes: z.boolean() }),
  z.strictObject({ type: z.literal('confirm'), id: idx.max(1e6), with: idx }),
  z.strictObject({ type: z.literal('cancel'), id: idx.max(1e6) }),
  z.strictObject({ type: z.literal('ship'), e: idx }),
  z.strictObject({ type: z.literal('freeShip'), e: idx }),
  z.strictObject({ type: z.literal('moveShip'), from: idx, to: idx }),
  z.strictObject({ type: z.literal('pirate'), hex: idx, victim: idx.nullable().optional() }),
  z.strictObject({ type: z.literal('chooseGold'), cards }),
]);

export const OptionsSchema = z.strictObject({
  scenario: z.enum(['classic', 'heading-for-new-shores']),
  winVP: z.number().int().min(5).max(30),
  houseRules: z.strictObject({
    no7FirstRound: z.boolean().optional(),
    bank3to1: z.boolean().optional(),
    freeShipMoves: z.boolean().optional(),
  }),
});
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
  /** Lobby only: scenario, points to win and house rules for the next game. */
  z.strictObject({ t: z.literal('setOptions'), options: OptionsSchema }),
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
}

export interface RoomInfo {
  code: string;
  seats: SeatInfo[];
  /** Your seat's pid, or null if you are watching. */
  me: string | null;
  phase: 'lobby' | 'play' | 'over';
  /** Options for the next game (shown in the lobby). */
  options: RoomOptions;
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
