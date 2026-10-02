/*
 * The WebSocket protocol between browser and server. Client messages are validated with
 * zod; anything that doesn't match is rejected. The client imports these types only.
 */

import { z } from 'zod';
import type {
  Color,
  CpuLevel,
  GameEvent,
  LogNote,
  GameStats,
  GenRules,
  MapData,
  Persona,
  PlayerView,
} from '@settlers/engine';

const RES = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore']);
const CARD = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore', 'paper', 'cloth', 'coin']);
const TRACK = z.enum(['trade', 'politics', 'science']);
const PROGRESS = z.enum([
  'commercialHarbor', 'masterMerchant', 'merchant', 'merchantFleet', 'resourceMonopoly', 'tradeMonopoly',
  'alchemist', 'crane', 'engineer', 'inventor', 'irrigation', 'medicine', 'mining', 'printer', 'roadBuilding', 'smith',
  'bishop', 'constitution', 'deserter', 'diplomat', 'intrigue', 'saboteur', 'spy', 'warlord', 'wedding',
]); // prettier-ignore
const COLOR = z.enum([
  'red', 'blue', 'white', 'orange', 'purple', 'black', 'pink', 'yellow', 'gray',
  'teal', 'cyan', 'brown', 'magenta', 'lavender', 'mint',
]); // prettier-ignore
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
  z.strictObject({ type: z.literal('treasurePick'), cards }),
  z.strictObject({ type: z.literal('treasureDeck'), track: TRACK }),
  z.strictObject({ type: z.literal('askBack') }),
  z.strictObject({ type: z.literal('handBack') }),
  z.strictObject({ type: z.literal('refuseBack') }),
  z.strictObject({ type: z.literal('askUndo') }),
  z.strictObject({ type: z.literal('answerUndo'), yes: z.boolean() }),
  z.strictObject({ type: z.literal('cancelUndo') }),
  // Keep playing after a win (SPEC 8.9).
  z.strictObject({ type: z.literal('askKeep'), target: z.number().int().min(3).max(99) }),
  z.strictObject({ type: z.literal('answerKeep'), yes: z.boolean() }),
  z.strictObject({ type: z.literal('cancelKeep') }),
  z.strictObject({
    type: z.literal('setRule'),
    rule: z.enum([
      'winVP', 'no7FirstRound', 'bank3to1', 'freeShipMoves', 'rerollBeforeAttack', 'noDiscardBeforeAttack',
      'barbarianDelay', 'handBack', 'handBackSetup', 'undo',
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
  scenario: z.enum([
    'classic',
    'heading-for-new-shores',
    'fog-islands',
    'four-islands',
    'treasure-fog',
    'classic-isles',
  ]),
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
    /** Asking to undo a move (SPEC 5.10); on unless set to false. */
    undo: z.boolean().optional(),
  }),
  /** CPU chatter in table talk (SPEC 5.14); on unless set to false. */
  cpuChat: z.boolean().optional(),
  /** The bank (SPEC 8.1): limited unless 'unlimited'. Locked when the game starts. */
  bank: z.enum(['limited', 'unlimited']).optional(),
  /** CPUs trade with people (docs/bot-medium-hard.md §1.2); on unless set to false. */
  cpuTrading: z.boolean().optional(),
  /** At most one offer per CPU per turn; on unless set to false. */
  cpuOneOffer: z.boolean().optional(),
});

/** Personal confirmation settings (SPEC 4.3), saved under your nickname. Missing means on. */
/** Every sound the game makes (SPEC 9.4), each with its own switch, volume and style. */
export const SOUND_IDS = [
  'turn', 'dice', 'cards', 'steal', 'road', 'settlement', 'city', 'shipMove', 'robber', 'buyCard',
  'playCard', 'trade', 'discard', 'knight', 'barbarians', 'horn', 'sad', 'defended', 'award', 'chat',
  'fanfare',
] as const; // prettier-ignore
export type SoundId = (typeof SOUND_IDS)[number];
const SoundPrefSchema = z.strictObject({
  on: z.boolean().optional(),
  vol: z.number().min(0).max(1).optional(),
  style: z.number().int().min(0).max(4).optional(),
});
export const SoundsSchema = z.strictObject({
  master: z.number().min(0).max(1).optional(),
  each: z.partialRecord(z.enum(SOUND_IDS), SoundPrefSchema).optional(),
});
export type SoundPrefs = z.infer<typeof SoundsSchema>;

/** SPEC 11: one box's place on the game screen (docked to an edge, floating, or hidden). */
const PlaceSchema = z.strictObject({
  dock: z.enum(['left', 'right', 'top', 'bottom', 'float']),
  order: z.number().int().min(0).max(99),
  hidden: z.boolean().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  w: z.number().min(0).max(1).optional(),
});
const LayoutSchema = z.strictObject({
  v: z.literal(1),
  panels: z.partialRecord(
    z.enum(['players', 'talk', 'hand', 'build', 'improve', 'play', 'barbarians']),
    PlaceSchema,
  ),
});

export const SettingsSchema = z.strictObject({
  confirmPlace: z.boolean().optional(),
  confirmPlaceTouch: z.boolean().optional(),
  confirmEnd: z.boolean().optional(),
  confirmCard: z.boolean().optional(),
  confirmTrade: z.boolean().optional(),
  /** SPEC 5.9: the sound when you need to act, other game sounds, a browser notification (off unless true). */
  turnSound: z.boolean().optional(),
  gameSounds: z.boolean().optional(),
  browserNotify: z.boolean().optional(),
  /** SPEC 5.8: show every score's breakdown all the time (off unless true). */
  showBreakdown: z.boolean().optional(),
  /** SPEC 9.1: also show the dice in the board's top-right corner (off unless true). */
  diceCorner: z.boolean().optional(),
  /** SPEC 9.4: master volume, and each sound's switch, volume and style. */
  sounds: SoundsSchema.optional(),
  /** SPEC 9.5: the dice statistics pinned to a corner of the board, full or as a strip. */
  dicePin: z
    .strictObject({ corner: z.enum(['tl', 'tr', 'bl', 'br']), small: z.boolean().optional() })
    .optional(),
  /** Knights: the event die's colour with a roll, "9 blue" (default), "blue 9" or left out. */
  eventDieText: z.enum(['after', 'before', 'off']).optional(),
  /** Table talk's size: folded to its title, short, normal (default) or tall. */
  talk: z.enum(['min', 'short', 'normal', 'tall']).optional(),
  /** SPEC 11: your own screen layout, one per kind of screen (none: the standard screen). */
  layout: z
    .strictObject({
      laptop: LayoutSchema.optional(),
      tablet: LayoutSchema.optional(),
      phone: LayoutSchema.optional(),
    })
    .optional(),
});
export type PlayerSettings = z.infer<typeof SettingsSchema>;
export type RoomOptions = z.infer<typeof OptionsSchema>;
export const DEFAULT_OPTIONS: RoomOptions = { scenario: 'classic', winVP: 10, houseRules: {} };

/* ---------- Maps (docs/maps.md 3) and generator presets (5.18) ---------- */

const TERRAIN = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold', 'desert', 'sea', 'fog']);
const PORT = z.enum(['any', 'wood', 'brick', 'sheep', 'wheat', 'ore']);
const coord = z.number().int().min(-30).max(30);
const at = z.tuple([coord, coord]);
const token = z
  .number()
  .int()
  .min(2)
  .max(12)
  .refine((n) => n !== 7);
const many = z.number().int().min(0).max(200);
const mapName = z.string().trim().min(1).max(40);

const TileSetSchema = z.strictObject({
  terrain: z.partialRecord(TERRAIN, many),
  numbers: z.record(z.string().regex(/^\d{1,2}$/), many),
  harbors: z.partialRecord(PORT, many),
});

export const MapSchema = z.strictObject({
  format: z.literal(1),
  id: z.string().min(1).max(60),
  name: mapName,
  modules: z.array(z.enum(['seafarers'])).max(1),
  players: z.array(z.number().int().min(2).max(4)).min(1).max(3),
  winVP: z.number().int().min(3).max(30),
  specialVP: z.strictObject({ newIsland: z.number().int().min(0).max(5).optional() }).optional(),
  hexes: z
    .array(
      z.strictObject({
        q: coord,
        r: coord,
        t: z.union([TERRAIN, z.literal('random')]),
        pool: z.string().min(1).max(20).optional(),
        n: z.union([token, z.literal('random')]).optional(),
        lock: z.strictObject({ t: z.boolean().optional(), n: z.boolean().optional() }).optional(),
        region: z.string().min(1).max(20).optional(),
      }),
    )
    .max(120),
  pools: z
    .record(
      z.string().min(1).max(20),
      z.strictObject({ terrain: z.array(TERRAIN).max(120), numbers: z.array(token).max(120) }),
    )
    .optional(),
  harbors: z
    .array(
      z.strictObject({
        q: coord,
        r: coord,
        side: z.number().int().min(0).max(5),
        t: z.union([PORT, z.literal('random')]),
        lock: z.boolean().optional(),
      }),
    )
    .max(60),
  harborPool: z.array(PORT).max(60).optional(),
  fog: z.strictObject({ terrain: z.array(TERRAIN).max(120), numbers: z.array(token).max(120) }).optional(),
  numberRules: z
    .strictObject({ noAdjacentRed: z.boolean().optional(), noAdjacentSame: z.boolean().optional() })
    .optional(),
  start: z.union([z.literal('all'), z.array(at).max(120)]).optional(),
  robber: z.union([z.literal('desert'), at, z.null()]),
  pirate: z.union([at, z.null()]).optional(),
  /** Treasure spots (docs/rules/treasures.md): a hex side each. */
  treasures: z
    .array(z.strictObject({ q: coord, r: coord, side: z.number().int().min(0).max(5) }))
    .max(40)
    .optional(),
  set: TileSetSchema.optional(),
  /** SPEC 10.4: regions, each with its own tile set. */
  regions: z
    .record(z.string().min(1).max(20), z.strictObject({ name: mapName, set: TileSetSchema }))
    .refine((r) => Object.keys(r).length <= 12, 'at most 12 regions')
    .optional(),
  made: z
    .strictObject({
      by: z.string().max(40).optional(),
      at: z.number().int().optional(),
      generator: z
        .strictObject({
          preset: z.string().max(40),
          seed: z.string().max(40),
          rules: z.lazy(() => GenRulesSchema).optional(),
        })
        .optional(),
      edited: z.array(z.string().max(40)).max(20).optional(),
    })
    .optional(),
});

const limit = (lo: number, hi: number) => z.number().int().min(lo).max(hi).nullable();
/** A custom CPU's id, and its personality (docs/bot-medium-hard.md §5.2). */
const CPU_ID = z.string().regex(/^c-[A-Za-z0-9-]{1,40}$/);
export const PersonaSchema = z.strictObject({
  base: z.enum(['medium', 'hard']),
  robber: z.enum(['gentle', 'late', 'leader']),
  trading: z.enum(['never', 'fair', 'generous', 'shrewd']),
  style: z.enum(['cities', 'settlements', 'cards', 'balanced']),
  focus: z.enum(['ignore', 'normal', 'chase']),
  timing: z.enum(['soon', 'hold']),
  chatter: z.enum(['off', 'quiet', 'chatty']),
}) satisfies z.ZodType<Persona>;

export const GenRulesSchema = z.strictObject({
  pips: z.record(z.string().regex(/^\d{1,2}$/), z.number().int().min(0).max(10)),
  redApart: z.boolean(),
  harborGood: z.enum(['off', '68', '5689']),
  harborNoRed: z.boolean(),
  bestSpot: limit(0, 30),
  badSpot: limit(0, 30),
  badSpotDesert: z.boolean(),
  twoTwelveApart: z.boolean(),
  noLowClusters: z.boolean(),
  sameApart: z.boolean(),
  clump: limit(0, 19),
  balance: limit(0, 100),
  fairness: limit(0, 30),
  fairPlayers: limit(2, 4),
  desert: z.enum(['center', 'edge', 'random', 'none']),
  harbors: z.enum(['standard', 'random']),
  numbers: z.enum(['spiral', 'random']),
});

/** Edits made on the pre-game table's board (docs/pregame.md 1.2). */
const side = z.strictObject({ at, side: z.number().int().min(0).max(5) });
export const TableEditSchema = z.discriminatedUnion('k', [
  z.strictObject({ k: z.literal('terrain'), at, t: TERRAIN }),
  z.strictObject({ k: z.literal('number'), at, n: token }),
  z.strictObject({ k: z.literal('harbor'), at, side: z.number().int().min(0).max(5), t: PORT }),
  z.strictObject({ k: z.literal('swapTile'), a: at, b: at }),
  z.strictObject({ k: z.literal('swapNumber'), a: at, b: at }),
  z.strictObject({ k: z.literal('moveHarbor'), from: side, to: side }),
  z.strictObject({ k: z.literal('lock'), at, what: z.enum(['t', 'n']), on: z.boolean() }),
  z.strictObject({ k: z.literal('lockHarbor'), at, side: z.number().int().min(0).max(5), on: z.boolean() }),
]);

const pidSchema = z.string().min(1).max(40);
export const TableOpSchema = z.discriminatedUnion('k', [
  /** The standard board, a saved map (`id`), or the generator with a preset (`preset`). */
  z.strictObject({
    k: z.literal('source'),
    source: z.enum(['default', 'saved', 'generated']),
    id: z.string().max(60).optional(),
    preset: z.string().max(60).optional(),
  }),
  z.strictObject({ k: z.literal('reroll') }),
  z.strictObject({ k: z.literal('seed'), seed: z.string().regex(/^[A-Za-z0-9-]{1,40}$/) }),
  z.strictObject({ k: z.literal('back') }),
  z.strictObject({ k: z.literal('forward') }),
  z.strictObject({ k: z.literal('edit'), op: TableEditSchema }),
  z.strictObject({ k: z.literal('ready'), on: z.boolean() }),
  z.strictObject({ k: z.literal('circle'), order: z.array(pidSchema).min(1).max(4) }),
  z.strictObject({ k: z.literal('shuffle') }),
  z.strictObject({ k: z.literal('firstMode'), mode: z.enum(['roll', 'random', 'pick']) }),
  z.strictObject({ k: z.literal('pickFirst'), pid: pidSchema }),
  z.strictObject({ k: z.literal('roll') }),
  z.strictObject({ k: z.literal('autoRoll') }),
]);
export type TableOp = z.infer<typeof TableOpSchema>;

const roomCode = z.string().regex(/^[A-Z0-9]{4,8}$/);
const nick = z.string().min(1).max(40);

export const ClientMsgSchema = z.discriminatedUnion('t', [
  /** Attach to a room; with a token, resume your seat. */
  z.strictObject({ t: z.literal('hello'), room: roomCode, token: z.string().max(100).optional() }),
  z.strictObject({ t: z.literal('create') }),
  /** Sit down as one of the profiles (SPEC 5.1). Your own seat back if it's already at the table. */
  /** `move`: your own seat is open on another screen; move it here (SPEC 4.6). */
  z.strictObject({
    t: z.literal('join'),
    profile: z.string().min(1).max(60),
    color: COLOR,
    move: z.literal(true).optional(),
  }),
  /** Profiles: the list, a new one, merging a typo into the right one. Allowed outside rooms. */
  z.strictObject({ t: z.literal('profiles') }),
  z.strictObject({ t: z.literal('newProfile'), name: nick, color: COLOR }),
  z.strictObject({ t: z.literal('mergeProfiles'), from: z.string().max(60), into: z.string().max(60) }),
  /** Delete a profile from the list (the Stats page). Not while it's at a table. */
  z.strictObject({ t: z.literal('deleteProfile'), id: z.string().max(60) }),
  /** Saved games (SPEC 5.7). */
  z.strictObject({ t: z.literal('saved') }),
  z.strictObject({ t: z.literal('resume'), game: z.string().max(60) }),
  z.strictObject({ t: z.literal('deleteSaved'), game: z.string().max(60) }),
  /** Stats (SPEC 5.6): someone's record (a profile id, or cpu:easy etc.), or one game. */
  z.strictObject({ t: z.literal('stats'), who: z.string().max(60) }),
  z.strictObject({ t: z.literal('gameStats'), game: z.string().max(60) }),
  /** Maps (docs/maps.md 4.4) and presets (5.18), shared by everyone. Allowed outside rooms. */
  z.strictObject({ t: z.literal('maps') }),
  z.strictObject({ t: z.literal('getMap'), id: z.string().max(60) }),
  z.strictObject({ t: z.literal('saveMap'), map: MapSchema, by: z.string().max(40).optional() }),
  z.strictObject({ t: z.literal('importMap'), map: MapSchema, by: z.string().max(40).optional() }),
  z.strictObject({ t: z.literal('renameMap'), id: z.string().max(60), name: mapName }),
  z.strictObject({ t: z.literal('duplicateMap'), id: z.string().max(60), by: z.string().max(40).optional() }),
  z.strictObject({ t: z.literal('deleteMap'), id: z.string().max(60) }),
  z.strictObject({ t: z.literal('presets') }),
  z.strictObject({
    t: z.literal('savePreset'),
    id: z.string().max(60).optional(),
    name: mapName,
    rules: GenRulesSchema,
    by: z.string().max(40).optional(),
  }),
  z.strictObject({ t: z.literal('deletePreset'), id: z.string().max(60) }),
  /** Custom CPUs (docs/bot-medium-hard.md §5.2), shared by everyone. */
  z.strictObject({ t: z.literal('cpus') }),
  z.strictObject({
    t: z.literal('saveCpu'),
    id: CPU_ID.optional(),
    name: z.string().trim().min(1).max(24),
    persona: PersonaSchema,
    by: z.string().max(40).optional(),
  }),
  z.strictObject({ t: z.literal('deleteCpu'), id: CPU_ID }),
  /** CPU chatter on or off for this room (SPEC 5.14), any time, by anyone seated. */
  z.strictObject({ t: z.literal('setCpuChat'), on: z.boolean() }),
  /** The pre-game table: board, seating, Ready and who goes first (docs/pregame.md). Lobby only. */
  z.strictObject({ t: z.literal('table'), op: TableOpSchema }),
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
    /** Easy, Medium, Hard, or a custom CPU's id. */
    level: z.union([z.enum(['easy', 'medium', 'hard']), CPU_ID]).optional(),
  }),
  z.strictObject({ t: z.literal('removeCpu'), pid: z.string().max(40) }),
  /** Lobby only: scenario, points to win and house rules for the next game. */
  z.strictObject({ t: z.literal('setOptions'), options: OptionsSchema }),
  /** Save your personal settings (you must be seated; they're kept under your nickname). */
  z.strictObject({ t: z.literal('saveSettings'), settings: SettingsSchema }),
  /** `id` makes resends after a dropped connection safe: an id is applied at most once. */
  z.strictObject({ t: z.literal('act'), id: z.string().min(1).max(64), action: ActionSchema }),
  z.strictObject({ t: z.literal('chat'), text: z.string().min(1).max(240) }),
  /** End the game (reset) or "Save and quit" (quit): asks everyone first, then confirm. */
  z.strictObject({ t: z.literal('resetRequest'), kind: z.enum(['reset', 'quit']).optional() }),
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
  /** A CPU player, and how good it is: a built-in level or a custom CPU's id, and its name. */
  cpu?: boolean;
  level?: CpuLevel | string;
  levelName?: string;
  /** The person's profile. */
  profile?: string;
}

export interface ProfileInfo {
  id: string;
  name: string;
  color: Color;
  /** Someone is connected with it right now. */
  inUse: boolean;
}

/** Dice so far this game (SPEC 5.4), public. */
export interface DiceInfo {
  /** Times each total 2–12 was rolled (index = total). */
  dice: number[];
  /** Rolls since each total last came up (index = total). */
  gap: number[];
  /** Rolls by seat. */
  rolls: number[];
  /** Event die faces (C&K). */
  events: Record<string, number>;
  chosen: number;
}

/** A game in the saved list (SPEC 5.7). */
export interface SavedGame {
  id: string;
  players: { name: string; color: Color; cpu?: boolean; vp: number }[];
  lastAt: number;
  mode: 'base' | 'seafarers' | 'knights' | 'full';
  /** Tiles, for the map preview. */
  hexes: { q: number; r: number; t: string; n: number }[];
  /** The room it's open in right now, if any. */
  room: string | null;
}

/** One player's line on the Stats page (SPEC 5.6). */
export interface PlayerRecord {
  wins: number;
  games: number;
  byMode: Record<string, { wins: number; games: number }>;
  avgPoints: number;
  vs: { who: string; name: string; wins: number; losses: number }[];
  got: Record<string, number>;
  lost: Record<string, number>;
  robs: number;
  robbed: number;
  luck: { got: number; expected: number };
  dice: number[];
  events: Record<string, number>;
  streak: { current: number; best: number };
  /** Wins after keep playing (SPEC 8.9); they never count as wins above. */
  overtime: number;
  past: {
    id: string;
    at: number;
    mode: string;
    /** Points as they stood at the game's (first) win. */
    players: { name: string; color: Color; vp: number; won: boolean }[];
    /** Overtime wins in that game, with the target each reached. */
    overtime?: { name: string; target: number }[];
  }[];
}

/** A finished game's stats with names (SPEC 5.5). */
export interface GameStatsInfo {
  id: string;
  at: number;
  mode: string;
  players: { name: string; color: Color; cpu?: boolean }[];
  /** Seat order in the stats (the game's seat order). */
  stats: GameStats;
  hexes: { q: number; r: number; t: string; n: number }[];
}

/** A map in the map list. */
export interface MapInfo {
  id: string;
  name: string;
  by: string | null;
  createdAt: number;
  updatedAt: number;
  players: number[];
  seafarers: boolean;
  /** Tiles, for the small preview ('random' = blank). */
  hexes: { q: number; r: number; t: string; n: number }[];
}

/** A custom CPU (docs/bot-medium-hard.md §5.2). */
export interface CpuInfo {
  id: string;
  name: string;
  persona: Persona;
  by: string | null;
}

/** A generator preset; built-in ones can't be changed or deleted. */
export interface PresetInfo {
  id: string;
  name: string;
  rules: GenRules;
  builtIn: boolean;
  by: string | null;
}

/** The pre-game table as everyone sees it (lobby only). */
export interface TableInfo {
  board: {
    map: MapData;
    source:
      | { kind: 'default' }
      | { kind: 'saved'; id: string; name: string }
      | { kind: 'generated'; preset: string; presetName: string };
    seed: string;
    edited: string[];
  };
  /** Position in the board history, and how many boards it holds. */
  at: number;
  count: number;
  /** Who's ready (CPUs always are). */
  ready: string[];
  /** Seats in turn order around the table. */
  circle: string[];
  first: {
    mode: 'roll' | 'random' | 'pick';
    pid: string | null;
    roll: {
      round: number;
      rolling: string[];
      rolls: Record<string, [number, number]>;
      winner: string | null;
    } | null;
  };
  /** The last change: "Bob rerolled". */
  last: { who: string; what: string; at: number } | null;
  /** Why this board can't be played with these seats, if it can't. */
  problem: string | null;
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
  pendingReset: { pid: string; nick: string; expiresAt: number; kind: 'reset' | 'quit' } | null;
  /** Your profile, if you're seated. */
  myProfile: string | null;
  /** The pre-game table, before a game starts. */
  table?: TableInfo;
}

export type LogItem =
  /** A game event, or a note about one (the robber's blocked cards, SPEC 8.10). */
  | { k: 'ev'; seq: number; at: number; e: GameEvent | LogNote }
  | { k: 'chat'; id: number; at: number; pid: string; nick: string; text: string; cpu?: true }
  | { k: 'sys'; id: number; at: number; text: string };

export type ServerMsg =
  /** You joined or resumed a seat. Store the token; it is your key to the seat. */
  | { t: 'seat'; room: string; pid: string; token: string }
  /** Full state: replace everything you have. `dice`: this game's dice so far; `stats` once it's over. */
  | { t: 'sync'; room: RoomInfo; game: PlayerView | null; log: LogItem[]; dice?: DiceInfo; stats?: GameStats }
  /** Something changed: new state plus new log items to animate. */
  | {
      t: 'update';
      room: RoomInfo;
      game: PlayerView | null;
      log: LogItem[];
      dice?: DiceInfo;
      stats?: GameStats;
    }
  | { t: 'profiles'; list: ProfileInfo[] }
  /** A profile was just made for you. */
  | { t: 'profile'; profile: ProfileInfo }
  | { t: 'saved'; list: SavedGame[] }
  | { t: 'stats'; who: string; name: string; record: PlayerRecord }
  | { t: 'gameStats'; game: GameStatsInfo }
  | { t: 'maps'; list: MapInfo[] }
  /** One map, to open in the editor; `saved` when it was just saved (the editor takes its id). */
  | { t: 'map'; map: MapData; info: MapInfo; saved?: boolean }
  | { t: 'presets'; list: PresetInfo[] }
  | { t: 'cpus'; list: CpuInfo[] }
  /** The room was closed ("Save and quit"); go back to the start screen. */
  | { t: 'closed'; text: string }
  | { t: 'ack'; id: string; ok: boolean; error?: string }
  | { t: 'error'; text: string }
  | { t: 'notice'; kind: 'info' | 'warn'; text: string }
  | { t: 'pong' };
