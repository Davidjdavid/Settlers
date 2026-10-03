/* Detailed explanations for every switch (SPEC 4.3), shown on hover or tap of a "?". */

import type { RuleKey } from '@settlers/engine';
import type { PlayerSettings } from '@settlers/server/protocol';

/** The on/off switches (sounds and the pinned dice have their own pages). */
export type SettingKey = Exclude<
  keyof PlayerSettings,
  'sounds' | 'dicePin' | 'layout' | 'eventDieText' | 'talk'
>;

export const SETTING_LABEL: Record<SettingKey, string> = {
  confirmPlace: 'Confirm before placing a piece (mouse)',
  confirmPlaceTouch: 'Confirm before placing a piece (touch screens)',
  confirmEnd: 'Confirm before ending my turn',
  confirmCard: 'Confirm before playing a card',
  confirmTrade: 'Confirm before accepting a trade',
  turnSound: 'Sound when it’s my turn or I need to act',
  gameSounds: 'Other game sounds',
  browserNotify: 'Notify me when the tab is in the background',
  showBreakdown: 'Always show what scores are made of',
  diceCorner: 'Also show the dice in the board’s top-right corner',
  noCpuTrades: 'Turn down every trade a CPU offers me',
};

export const SETTING_HELP: Record<SettingKey, string> = {
  confirmPlace:
    'With a mouse, pointing at a spot always shows a see-through preview of the piece. When this is on, clicking the spot only marks it, and nothing is placed until you press Confirm (or Cancel to pick again). When it is off, a click places the piece at once. This covers roads, ships, settlements, cities, knights, walls, the robber, the pirate and the merchant.',
  confirmPlaceTouch:
    'On phones and tablets there is no pointing, so the first tap shows the preview with Confirm and Cancel buttons, and nothing is placed until you press Confirm. Turn this off if you would rather a tap placed the piece at once.',
  confirmEnd:
    'Asks “End your turn?” before passing the dice, so a stray tap on End turn doesn’t cost you your turn. (If you do end too soon, you can still ask for the dice back until the next player does anything.)',
  confirmCard:
    'Asks before playing a development or progress card (for example “Play Knight?”), showing what the card does, so you never play one by accident.',
  confirmTrade:
    'Shows the trade and asks before you accept someone’s offer, or before you complete a trade someone accepted from you. Bank trades are not affected.',
  turnSound:
    'A short chime, only for you, when your turn starts or the game is waiting on you: a starting placement, a discard, a trade offered to you, gold or a Cities & Knights choice, or someone asking for the dice back or an undo.',
  gameSounds:
    'Every other sound: the dice rolling (for everyone, whoever rolls), building, and the fanfare when someone wins. The turn chime has its own switch above.',
  browserNotify:
    'When it’s your move and this tab is in the background, your browser shows a notification. Switching this on asks your browser for permission. Off by default.',
  showBreakdown:
    'Every player’s score shows what it’s made of all the time, for example “5 = 3 settlements (3) + Longest Road (2)”. When off, tap or hover a score to see it.',
  diceCorner:
    'The last roll also shows in the top-right corner of the board, so you can see it while looking at the board: both number dice and, in Knights games, the event die. Off by default.',
  noCpuTrades:
    'When a CPU offers a trade, your screen answers No for you at once, so its offers never wait on you. Trades from people are not affected, and you can still offer trades to CPUs yourself. Off by default.',
};

export const RULE_HELP: Record<RuleKey, string> = {
  winVP:
    'How many victory points win the game. During a game it can only be set above the highest score at the table, so nobody wins by surprise.',
  no7FirstRound:
    'While it is anyone’s first turn, a 7 is rolled again (you see the 7, then the new roll). Nobody loses cards or gets robbed before they’ve had a turn.',
  bank3to1:
    'Everyone trades with the bank at 3:1, as if they had a 3:1 harbor. 2:1 harbors still give 2:1 for their resource. With Cities & Knights it also applies to commodities.',
  freeShipMoves:
    'Seafarers: you may move any number of ships each turn instead of one. The other ship rules stay: only a ship at the open end of a route moves, never one built this turn, never one next to the pirate.',
  rerollBeforeAttack:
    'Cities & Knights: until the barbarians have attacked once, a 7 is rolled again, so nobody discards and the robber stays put early on. Only the production dice are rolled again; the event die is rolled once.',
  noDiscardBeforeAttack:
    'Cities & Knights: until the barbarians have attacked once, a 7 does nothing at all: no discards (and the robber sleeps anyway). Ignored if “Re-roll 7s” is on.',
  barbarianDelay:
    'Cities & Knights: for this many full rounds the event die isn’t rolled, so the barbarian ship doesn’t move and nobody draws progress cards. 0 means they start at once.',
  handBack:
    'After you end your turn you can ask “Wait, give the dice back” until the next player does anything (rolls, plays a card or anything else). They choose to hand them back or not, and can hand them back without being asked. Your turn comes back exactly as it was: same roll, same cards, cards bought that turn still not playable. Only one step back. A CPU always hands back.',
  undo: 'Right after your own move you can ask to undo it. Everyone else at the table has to agree (CPUs always do), and one “no” cancels it. Only your most recent move, only before anyone else acts, and never a roll, a steal, a card drawn or played, or anything else that showed something hidden.',
  handBackSetup:
    'Also allows handing the dice back after a starting settlement and road are placed, so the player who just placed can take it back. When off, starting placements are final.',
};

/** A "?" that shows a detailed explanation on hover, or on tap (focus) on touch screens. */
export function Help({ text }: { text: string }) {
  return (
    <span className="help" tabIndex={0} role="button" aria-label="What does this do?">
      ?
      <span className="helptext" role="tooltip">
        {text}
      </span>
    </span>
  );
}

/** Is a personal setting on? Missing means on. */
export const settingOn = (s: PlayerSettings | null | undefined, k: SettingKey) =>
  OFF_BY_DEFAULT.includes(k) ? s?.[k] === true : s?.[k] !== false;

/** Settings that are off unless switched on. */
export const OFF_BY_DEFAULT: SettingKey[] = ['browserNotify', 'showBreakdown', 'diceCorner', 'noCpuTrades'];
