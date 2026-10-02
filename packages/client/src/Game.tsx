/* The game table: board, prompt, hand and actions, players, log. */

import { useEffect, useRef, useState } from 'react';
import {
  COMS, COST, DEV_PLAY, KEEP_MAX, KNIGHT_COST, SHIP_COST, WALL_COST, cardKinds, cardWarning, goldDue, handLimit, has,
  isLogNote, keepMinTarget, legalActions,
  piecesLeft, rateFor, RES, stateFromView, vpBreakdown, type Action, type Card, type DevPlayable, type GameStats, type PlayerView, type Progress, type Seat, type VPPart,
} from '@settlers/engine'; // prettier-ignore
import type { DiceInfo, LogItem, RoomInfo } from '@settlers/server/protocol';
import {
  BRAND_SVG, CARD_COLOR, CARD_LABEL, DEV_HELP, DEV_LABEL, PCOL, PEDGE, PROGRESS_HELP, PROGRESS_LABEL, RES_LABEL, TILE_COLOR, TRACK_COLOR,
  TRACK_LABEL, cardIcon,
} from './art'; // prettier-ignore
import { Board, NO_TARGETS, type Ghost, type Targets } from './Board';
import { settingOn } from './help';
import { AskSheet, RulesSheet, SettingsSheet } from './settings';
import { RollDice } from './dice';
import { RaidNotice, type Raid } from './raid';
import { DicePanel, GameStatsView } from './stats';
import { play as playSound, notify } from './sound';
import { Celebration } from './celebrate';
import { client, getStored, type Status } from './net';
import {
  Chips, ConfirmTwice, DiscardSheet, GoldSheet, MenuSheet, MonoSheet, PieceSheet, PlentySheet, TradeSheet,
  VictimSheet,
} from './Sheets'; // prettier-ignore
import { listNames, nameOf, routeName } from './text';
import { Log } from './log';
import {
  BOARD_OWES, BarbarianBox, CardParamSheet, EventDie, ImproveRow, KnightSheet, OweSheet, PlayerCK, ProgressRow,
  myOwe, owePrompt, paramOf,
} from './ck'; // prettier-ignore

type Play = Extract<Action, { type: 'progress' }>;

/** Icons for the trade and card buttons (SPEC 8.6). */
const ACT_ICON: Record<'trade' | 'bank' | 'card', string> = {
  trade:
    '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 7h12l-3-3M17 13H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bank: '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 2 2 6v2h16V6zM4 9v6M8 9v6M12 9v6M16 9v6M2 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  card: '<svg viewBox="0 0 20 20" width="16" height="16"><rect x="5" y="2" width="10" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 7h4M8 10h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
type Mode =
  | null
  | 'road'
  | 'settlement'
  | 'city'
  | 'ship'
  | 'move'
  /* Cities & Knights */
  | 'knight'
  | 'wall'
  | 'knights'
  | 'kmove'
  | 'chase'
  | 'metro'
  | 'card';
/** A button in the prompt bar: `off` greys it out and says why; `badge` counts things waiting. */
type PromptButton = {
  label: string;
  on: () => void;
  primary?: boolean;
  testid?: string;
  off?: string;
  badge?: number;
  /** A warning shown beside the button (it never blocks). */
  warn?: string;
  kind?: 'trade' | 'bank' | 'card';
};
type SheetState =
  | null
  | { k: 'trade'; tab?: 'players' | 'bank' }
  | { k: 'discard' }
  | { k: 'plenty' }
  | { k: 'mono' }
  | { k: 'victim'; hex: number; victims: Seat[]; kind: 'robber' | 'pirate'; make?: (p: Seat) => Action }
  | { k: 'knightAct'; at: number }
  | { k: 'owe' }
  | { k: 'cardParam'; card: Progress; plays: Play[] }
  | { k: 'piece'; options: Action[] }
  | { k: 'gold' }
  | { k: 'menu' }
  | { k: 'endGame' }
  | { k: 'claim'; seat: number; nick: string }
  | { k: 'ask'; title: string; sub?: string; yes: string; onYes: () => void; body?: React.ReactNode }
  | { k: 'settings' }
  | { k: 'rules' }
  | { k: 'dice' }
  | { k: 'quit' };

/** The see-through pieces that show what an action would place (SPEC 4.3). */
function ghostsOf(a: Action): Ghost[] {
  switch (a.type) {
    case 'setup':
      return [
        { kind: 'settlement', at: a.v },
        { kind: a.ship ? 'ship' : 'road', at: a.e },
      ];
    case 'settlement':
    case 'city':
    case 'knight':
    case 'wall':
      return [{ kind: a.type, at: a.v }];
    case 'road':
    case 'freeRoad':
      return [{ kind: 'road', at: a.e }];
    case 'ship':
    case 'freeShip':
      return [{ kind: 'ship', at: a.e }];
    case 'moveShip':
      return [{ kind: 'ship', at: a.to }];
    case 'moveKnight':
      return [{ kind: 'knight', at: a.to }];
    case 'robber':
    case 'chase':
      return [{ kind: 'robber', at: a.hex }];
    case 'pirate':
      return [{ kind: 'pirate', at: a.hex }];
    case 'improve':
      return a.v != null ? [{ kind: 'mark', at: a.v }] : [];
    case 'choose':
      return a.v != null ? [{ kind: 'mark', at: a.v }] : a.e != null ? [{ kind: 'markEdge', at: a.e }] : [];
    case 'progress': {
      const out: Ghost[] = [];
      if (a.v != null) out.push({ kind: 'mark', at: a.v });
      for (const x of a.vs ?? []) out.push({ kind: 'mark', at: x });
      if (a.e != null) out.push({ kind: 'markEdge', at: a.e });
      for (const h of [a.h, a.h2])
        if (h != null)
          out.push({
            kind: a.card === 'bishop' ? 'robber' : a.card === 'merchant' ? 'merchant' : 'markHex',
            at: h,
          });
      return out;
    }
    default:
      return [];
  }
}

const KNIGHT_LEVEL = ['', 'Basic', 'Strong', 'Mighty'];
/** The Smith play promoting exactly these knights, if there is one. */
const smithPlay = (plays: Play[], picks: number[]) =>
  picks.length
    ? plays.find((a) => a.vs!.length === picks.length && picks.every((x) => a.vs!.includes(x)))
    : undefined;
/** Smith picks to start with: every knight that can be promoted, when that's 2 or fewer. */
const smithStart = (plays: Play[]): number[] => {
  const ks = [...new Set(plays.flatMap((a) => a.vs!))];
  return ks.length <= 2 && smithPlay(plays, ks) ? ks : [];
};

const MODE_TEXT: Record<Exclude<Mode, null>, [string, string]> = {
  ship: ['Choose where to build a ship', 'Ships sail from your settlements and other ships.'],
  move: ['Choose a ship to move, then where it goes', 'Only the ship at the open end of a route can move.'],
  road: ['Choose where to build a road', 'Roads join your own roads or buildings.'],
  settlement: [
    'Choose where to build a settlement',
    'It needs your road and an empty corner with no neighbor.',
  ],
  city: ['Choose a settlement to upgrade', 'A city produces 2 cards instead of 1.'],
  knight: ['Choose where to put a knight', 'Knights go on an empty corner next to your road.'],
  wall: ['Choose a city for the wall', 'Each wall lets you hold 2 more cards when a 7 is rolled.'],
  knights: ['Choose one of your knights', 'Activate, promote, move it, or chase the robber.'],
  kmove: ['Choose where the knight goes', 'Along your roads, to an empty corner or onto a weaker knight.'],
  chase: ['Choose where the robber goes', 'You steal a card from someone next to it.'],
  metro: ['Choose a city for the metropolis', 'It is worth 2 more points and the barbarians can’t touch it.'],
  card: ['Choose where', ''],
};

export function Game({
  v,
  room,
  log,
  status,
  pending,
  dice,
  stats,
}: {
  v: PlayerView;
  room: RoomInfo;
  log: LogItem[];
  status: Status;
  pending: number;
  dice?: DiceInfo | null;
  stats?: GameStats | null;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [moveFrom, setMoveFrom] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  // Cities & Knights: the knight being moved or chasing, the card being played, the track being raised.
  const [kFrom, setKFrom] = useState<number | null>(null);
  const [card, setCard] = useState<{ card: Progress; plays: Play[]; picks: number[] } | null>(null);
  const [metroOpts, setMetroOpts] = useState<Action[]>([]);
  const [hideOver, setHideOver] = useState(false);
  // The win celebration plays once, when the game ends while you're watching (SPEC 5.13).
  const [celebrating, setCelebrating] = useState(false);
  const wasPlaying = useRef(v.phase === 'play');
  useEffect(() => {
    if (v.phase === 'over' && wasPlaying.current) {
      setCelebrating(true);
      if (settingOn(room.mySettings, 'gameSounds')) playSound('fanfare');
    }
    wasPlaying.current = v.phase === 'play';
    // Keep playing (SPEC 8.9): the next win shows the end screen again.
    if (v.phase === 'play') setHideOver(false);
  }, [v.phase]);
  // A piece waiting for Confirm (SPEC 4.3).
  const [placing, setPlacing] = useState<{ a: Action; ghosts: Ghost[]; after?: () => void } | null>(null);
  const me = v.me;
  const mine = me != null && v.turn === me && v.phase === 'play';
  const s = stateFromView(v);
  const busy = pending > 0;

  // Drop UI modes that no longer apply after the state changes.
  useEffect(() => {
    if (!mine || v.stage !== 'main') setMode(null);
    if (!mine || v.stage !== 'setup') setSel(null);
    setMoveFrom(null);
    setPlacing(null);
  }, [mine, v.stage, v.seq]);
  useEffect(() => setPlacing(null), [mode, sel, moveFrom, kFrom]);
  useEffect(() => {
    if (mode !== 'kmove' && mode !== 'chase') setKFrom(null);
    if (mode !== 'card') setCard(null);
  }, [mode]);
  useEffect(() => {
    if (v.phase === 'play') setHideOver(false);
  }, [v.phase]);
  useEffect(() => {
    if (mode !== 'move') setMoveFrom(null);
  }, [mode]);
  // Pop the gold sheet open when you're owed gold.
  const goldOwed = me != null ? goldDue(s, me) : 0;
  useEffect(() => {
    if (goldOwed) setSheet({ k: 'gold' });
    else setSheet((x) => (x?.k === 'gold' ? null : x));
  }, [goldOwed]);
  // Pop the discard sheet open automatically when you owe a discard.
  const owes = me != null && v.stage === 'discard' && v.discard?.[me] != null;
  useEffect(() => {
    if (owes) setSheet({ k: 'discard' });
    else setSheet((x) => (x?.k === 'discard' ? null : x));
  }, [owes]);

  // Cities & Knights choices owed: board picks glow; others open their sheet.
  const owe = myOwe(v);
  const oweKey = owe ? `${v.seq}:${JSON.stringify(owe)}` : '';
  useEffect(() => {
    if (owe && !BOARD_OWES.has(owe.k)) setSheet({ k: 'owe' });
    else setSheet((x) => (x?.k === 'owe' ? null : x));
  }, [oweKey]);

  /* ---------- Board targets: whatever the engine says this seat can do ---------- */
  const myActs = me != null && !busy && v.phase === 'play' ? legalActions(s, me) : [];
  const acts = mine ? myActs : [];
  const owed = myActs.filter((a): a is Extract<Action, { type: 'choose' }> => a.type === 'choose');
  const edgeActs = (e: number): Action[] => {
    if (v.stage === 'setup') return acts.filter((a) => a.type === 'setup' && a.v === sel && a.e === e);
    if (v.stage === 'roads')
      return acts.filter((a) => (a.type === 'freeRoad' || a.type === 'freeShip') && a.e === e);
    if (v.stage !== 'main') return [];
    if (mode === 'road') return acts.filter((a) => a.type === 'road' && a.e === e);
    if (mode === 'ship') return acts.filter((a) => a.type === 'ship' && a.e === e);
    if (mode === 'move' && moveFrom != null)
      return acts.filter((a) => a.type === 'moveShip' && a.from === moveFrom && a.to === e);
    return [];
  };
  const uniq = (xs: number[]) => [...new Set(xs)];
  let targets: Targets = NO_TARGETS;
  if (acts.length) {
    if (v.stage === 'setup') {
      const verts = uniq(acts.flatMap((a) => (a.type === 'setup' ? [a.v] : [])));
      targets =
        sel == null
          ? { ...NO_TARGETS, verts }
          : {
              verts: verts.filter((x) => x !== sel),
              edges: uniq(acts.flatMap((a) => (a.type === 'setup' && a.v === sel ? [a.e] : []))),
              hexes: [],
              ghost: sel,
              dimVerts: true,
            };
    } else if (v.stage === 'robber') {
      targets = {
        ...NO_TARGETS,
        hexes: uniq(acts.flatMap((a) => (a.type === 'robber' || a.type === 'pirate' ? [a.hex] : []))),
      };
    } else if (v.stage === 'roads') {
      targets = {
        ...NO_TARGETS,
        edges: uniq(acts.flatMap((a) => (a.type === 'freeRoad' || a.type === 'freeShip' ? [a.e] : []))),
      };
    } else if (v.stage === 'main' && mode) {
      if (mode === 'knight' || mode === 'wall')
        targets = { ...NO_TARGETS, verts: acts.flatMap((a) => (a.type === mode ? [a.v] : [])) };
      if (mode === 'metro')
        targets = {
          ...NO_TARGETS,
          verts: metroOpts.flatMap((a) => (a.type === 'improve' && a.v != null ? [a.v] : [])),
        };
      if (mode === 'knights')
        targets = {
          ...NO_TARGETS,
          verts: uniq(
            acts.flatMap((a) =>
              a.type === 'activate' || a.type === 'promote' || a.type === 'chase'
                ? [a.v]
                : a.type === 'moveKnight'
                  ? [a.from]
                  : [],
            ),
          ),
        };
      if (mode === 'kmove')
        targets = {
          ...NO_TARGETS,
          verts: acts.flatMap((a) => (a.type === 'moveKnight' && a.from === kFrom ? [a.to] : [])),
          ghostVert: kFrom,
        };
      if (mode === 'chase')
        targets = {
          ...NO_TARGETS,
          hexes: uniq(acts.flatMap((a) => (a.type === 'chase' && a.v === kFrom ? [a.hex] : []))),
        };
      if (mode === 'card' && card) {
        const kind = paramOf(card.plays);
        const open = card.plays.filter((a) => {
          if (kind === 'vs') return card.picks.every((x) => a.vs!.includes(x));
          if (kind === 'hh') return card.picks.every((x) => a.h === x || a.h2 === x);
          return true;
        });
        if (kind === 'v') targets = { ...NO_TARGETS, verts: uniq(open.map((a) => a.v!)) };
        // Smith: every knight that can be promoted lights up; a picked one can be tapped off.
        if (kind === 'vs') targets = { ...NO_TARGETS, verts: uniq(card.plays.flatMap((a) => a.vs!)) };
        if (kind === 'h') targets = { ...NO_TARGETS, hexes: uniq(open.map((a) => a.h!)) };
        if (kind === 'hh')
          targets = {
            ...NO_TARGETS,
            hexes: uniq(open.flatMap((a) => [a.h!, a.h2!].filter((x) => !card.picks.includes(x)))),
          };
        if (kind === 'e') targets = { ...NO_TARGETS, edges: uniq(open.map((a) => a.e!)) };
      }
      if (mode === 'road' || mode === 'ship') {
        targets = { ...NO_TARGETS, edges: uniq(acts.flatMap((a) => (a.type === mode ? [a.e] : []))) };
      }
      if (mode === 'settlement')
        targets = { ...NO_TARGETS, verts: acts.flatMap((a) => (a.type === 'settlement' ? [a.v] : [])) };
      if (mode === 'city')
        targets = { ...NO_TARGETS, verts: acts.flatMap((a) => (a.type === 'city' ? [a.v] : [])) };
      if (mode === 'move') {
        targets =
          moveFrom == null
            ? { ...NO_TARGETS, edges: uniq(acts.flatMap((a) => (a.type === 'moveShip' ? [a.from] : []))) }
            : {
                ...NO_TARGETS,
                edges: uniq(
                  acts.flatMap((a) => (a.type === 'moveShip' && a.from === moveFrom ? [a.to] : [])),
                ),
                ghostEdge: moveFrom,
              };
      }
    }
  }

  // Choices owed that are made on the board.
  if (owe && BOARD_OWES.has(owe.k) && owed.length) {
    targets = {
      ...NO_TARGETS,
      verts: uniq(owed.flatMap((a) => (a.v != null ? [a.v] : []))),
      edges: uniq(owed.flatMap((a) => (a.e != null ? [a.e] : []))),
    };
  }

  const doAct = (a: Action, after?: () => void) => void client.act(a).then((r) => r.ok && after?.());
  const my = room.mySettings;
  /** Place a piece: at once, or after Confirm if that setting is on for this kind of pointer. */
  const place = (a: Action, touch: boolean, after?: () => void) => {
    if (settingOn(my, touch ? 'confirmPlaceTouch' : 'confirmPlace'))
      setPlacing({ a, ghosts: ghostsOf(a), after });
    else doAct(a, after);
  };
  /** Ask first if this confirmation setting is on. */
  const ask = (
    k: 'confirmEnd' | 'confirmCard' | 'confirmTrade',
    q: { title: string; sub?: string; yes: string; body?: React.ReactNode },
    go: () => void,
  ) => (settingOn(my, k) ? setSheet({ k: 'ask', ...q, onYes: go }) : go());
  /** Play a progress card once its targets are picked (or show which picks remain). */
  const cardPick = (x: number, touch: boolean) => {
    if (!card) return;
    const kind = paramOf(card.plays);
    const picks = [...card.picks, x];
    const done = () => setMode(null);
    if (kind === 'v') return place({ type: 'progress', card: card.card, v: x }, touch, done);
    if (kind === 'h') return place({ type: 'progress', card: card.card, h: x }, touch, done);
    if (kind === 'e') return place({ type: 'progress', card: card.card, e: x }, touch, done);
    if (kind === 'hh') {
      if (picks.length < 2) return setCard({ ...card, picks });
      const a = card.plays.find(
        (p) => (p.h === picks[0] && p.h2 === picks[1]) || (p.h === picks[1] && p.h2 === picks[0]),
      );
      if (a) place(a, touch, done);
      return;
    }
    // Smith (SPEC 8.8): taps pick or unpick knights; nothing happens until the Upgrade button.
    if (kind === 'vs') {
      let next = card.picks.includes(x) ? card.picks.filter((y) => y !== x) : picks.slice(-2);
      if (next.length === 2 && !smithPlay(card.plays, next)) next = [x];
      return setCard({ ...card, picks: next });
    }
  };
  const onVert = (x: number, touch: boolean) => {
    setPlacing(null);
    if (owe && BOARD_OWES.has(owe.k)) return place({ type: 'choose', v: x }, touch);
    if (!mine) return;
    const done = () => setMode(null);
    if (v.stage === 'setup') setSel(x);
    else if (mode === 'settlement') place({ type: 'settlement', v: x }, touch, done);
    else if (mode === 'city') place({ type: 'city', v: x }, touch, done);
    else if (mode === 'knight') place({ type: 'knight', v: x }, touch, done);
    else if (mode === 'wall') place({ type: 'wall', v: x }, touch, done);
    else if (mode === 'metro') {
      const a = metroOpts.find((m) => m.type === 'improve' && m.v === x);
      if (a) place(a, touch, done);
    } else if (mode === 'knights') setSheet({ k: 'knightAct', at: x });
    else if (mode === 'kmove' && kFrom != null)
      place({ type: 'moveKnight', from: kFrom, to: x }, touch, done);
    else if (mode === 'card') cardPick(x, touch);
  };
  const onEdge = (e: number, touch: boolean) => {
    setPlacing(null);
    if (owe && BOARD_OWES.has(owe.k)) return place({ type: 'choose', e }, touch);
    if (mode === 'card') return cardPick(e, touch);
    if (!mine) return;
    if (mode === 'move' && moveFrom == null) return setMoveFrom(e);
    const options = edgeActs(e);
    const done = () => {
      setSel(null);
      if (v.stage === 'main') setMode(null);
    };
    if (options.length === 1) place(options[0]!, touch, done);
    else if (options.length > 1) setSheet({ k: 'piece', options });
  };
  const onHex = (h: number, touch: boolean) => {
    setPlacing(null);
    if (mine && mode === 'card') return cardPick(h, touch);
    if (mine && mode === 'chase' && kFrom != null) {
      const here = acts.filter(
        (a): a is Extract<Action, { type: 'chase' }> => a.type === 'chase' && a.v === kFrom && a.hex === h,
      );
      const victims = uniq(here.flatMap((a) => (a.victim != null ? [a.victim] : [])));
      if (victims.length > 1)
        setSheet({
          k: 'victim',
          hex: h,
          victims,
          kind: 'robber',
          make: (p) => ({ type: 'chase', v: kFrom, hex: h, victim: p }),
        });
      else if (here[0]) place(here[0], touch, () => setMode(null));
      return;
    }
    if (!mine || v.stage !== 'robber') return;
    const here = acts.filter((a) => (a.type === 'robber' || a.type === 'pirate') && a.hex === h);
    const kind = here[0]?.type === 'pirate' ? 'pirate' : 'robber';
    const victims = uniq(
      here.flatMap((a) =>
        (a.type === 'robber' || a.type === 'pirate') && a.victim != null ? [a.victim] : [],
      ),
    );
    if (victims.length > 1) setSheet({ k: 'victim', hex: h, victims, kind });
    else if (here[0]) place(here[0], touch);
  };

  /** What tapping a spot would place, for the preview under the mouse. */
  const previewAt = (t: 'v' | 'e' | 'h', id: number): Ghost[] => {
    if (owe && BOARD_OWES.has(owe.k)) return [{ kind: t === 'v' ? 'mark' : 'markEdge', at: id }];
    if (!mine) return [];
    if (mode === 'card' && card) {
      if (t === 'v') return [{ kind: 'mark', at: id }];
      if (t === 'e') return [{ kind: 'markEdge', at: id }];
      return [
        {
          kind: card.card === 'bishop' ? 'robber' : card.card === 'merchant' ? 'merchant' : 'markHex',
          at: id,
        },
      ];
    }
    if (t === 'v') {
      if (v.stage === 'setup') return [{ kind: 'settlement', at: id }];
      if (mode === 'settlement' || mode === 'city' || mode === 'knight' || mode === 'wall')
        return [{ kind: mode, at: id }];
      if (mode === 'kmove') return [{ kind: 'knight', at: id }];
      return [{ kind: 'mark', at: id }];
    }
    if (t === 'e') {
      if (mode === 'move' && moveFrom == null) return [{ kind: 'markEdge', at: id }];
      const a = edgeActs(id)[0];
      return a ? ghostsOf(a).filter((x) => x.kind !== 'settlement') : [];
    }
    if (mode === 'chase') return [{ kind: 'robber', at: id }];
    const a = acts.find((x) => (x.type === 'robber' || x.type === 'pirate') && x.hex === id);
    return a ? ghostsOf(a) : [];
  };

  const canPlay = (c: DevPlayable) =>
    acts.some(
      (a) =>
        a.type === { knight: 'playKnight', road: 'playRoads', plenty: 'playPlenty', mono: 'playMono' }[c],
    );
  /** Start playing a progress card: at once, in a sheet, or by picking on the board. */
  /**
   * A card that wouldn't do anything right now always asks first, saying why (SPEC 8.11 D4);
   * otherwise the card confirmation setting decides.
   */
  const askCard = (a: Action, q: { title: string; sub?: string; yes: string }, go: () => void) => {
    const w = cardWarning(v, a);
    if (w) setSheet({ k: 'ask', title: q.title, sub: `${w}.`, yes: 'Play it anyway', onYes: go });
    else ask('confirmCard', q, go);
  };
  const playProgress = (c: Progress, plays: Play[]) => {
    const kind = paramOf(plays);
    if (kind === 'none')
      return askCard(
        plays[0]!,
        { title: `Play ${PROGRESS_LABEL[c]}?`, sub: PROGRESS_HELP[c], yes: 'Play it' },
        () => void client.act(plays[0]!),
      );
    if (kind === 'to' || kind === 'r' || kind === 'd') return setSheet({ k: 'cardParam', card: c, plays });
    setCard({ card: c, plays, picks: kind === 'vs' ? smithStart(plays) : [] });
    setMode('card');
  };
  const improve = (opts: Action[]) => {
    if (opts.length === 1) return void client.act(opts[0]!);
    setMetroOpts(opts);
    setMode('metro');
  };
  const play = (c: DevPlayable) => {
    const now = (a: Action) =>
      askCard(
        a,
        { title: `Play ${DEV_LABEL[c]}?`, sub: DEV_HELP[c], yes: 'Play it' },
        () => void client.act(a),
      );
    if (c === 'knight') now({ type: 'playKnight' });
    if (c === 'road') now({ type: 'playRoads' });
    if (c === 'plenty') setSheet({ k: 'plenty' });
    if (c === 'mono') setSheet({ k: 'mono' });
  };

  /**
   * The Smith (SPEC 8.8): the picks with their new levels and one button for all of them. Using
   * only 1 of 2 possible upgrades has its own button and asks first. Cancel keeps the card.
   */
  const smithPrompt = (c: { plays: Play[]; picks: number[] }) => {
    const ks = uniq(c.plays.flatMap((a) => a.vs!));
    const pairs = c.plays.some((a) => a.vs!.length === 2);
    const done = () => setMode(null);
    const lvl = (x: number) => v.ck!.knights[x]?.lvl ?? 1;
    const sub = c.picks.length
      ? c.picks
          .map((x) => `${KNIGHT_LEVEL[lvl(x)]} knight → ${KNIGHT_LEVEL[lvl(x) + 1]!.toLowerCase()}`)
          .join(' · ')
      : 'Tap the knights to promote. Nothing changes until you press Upgrade.';
    const buttons: PromptButton[] = [];
    const both = smithPlay(c.plays, c.picks);
    if (both && c.picks.length === 2)
      buttons.push({
        label: ks.length <= 2 ? 'Upgrade both knights' : 'Upgrade these 2',
        on: () => doAct(both, done),
        primary: true,
        testid: 'smith-go',
      });
    else if (both && !pairs)
      buttons.push({
        label: 'Upgrade knight',
        on: () => doAct(both, done),
        primary: true,
        testid: 'smith-go',
      });
    else if (both)
      buttons.push({
        label: 'Use only 1 upgrade',
        testid: 'smith-one',
        on: () =>
          setSheet({
            k: 'ask',
            title: 'Use only 1 of your 2 upgrades?',
            sub: 'The Smith promotes up to 2 knights. The other upgrade is lost.',
            yes: 'Use only 1',
            onYes: () => doAct(both, done),
          }),
      });
    const title =
      ks.length > 2 && c.picks.length < 2
        ? `Smith: pick ${c.picks.length ? 'a second knight' : '2 knights'} to promote`
        : `Smith: promote ${c.picks.length === 2 ? 'both knights' : 'your knight'}?`;
    return { title, sub, buttons };
  };
  // The Smith's picks, drawn at their new level until Upgrade or Cancel.
  const smithGhosts: Ghost[] | undefined =
    mode === 'card' && card && paramOf(card.plays) === 'vs' && card.picks.length
      ? card.picks.map((x) => ({ kind: 'knight', at: x, lvl: (v.ck!.knights[x]?.lvl ?? 1) + 1 }))
      : undefined;

  // The Roll button and the dice do exactly the same thing (SPEC 5.3).
  const rollRef = useRef<(() => void) | null>(null);
  const canRoll = mine && v.stage === 'preroll' && acts.some((a) => a.type === 'roll') && !busy;

  // Ending your turn over the hand limit (SPEC 8.4): a warning by End turn, never a block.
  const myRisk =
    me != null && v.hand
      ? handRisk(
          v,
          stateFromView(v),
          me,
          Object.values(v.hand.res).reduce((a, b) => a + b, 0),
        )
      : null;
  const endWarn = myRisk && !myRisk.calm ? myRisk.text : undefined;
  const endTurn = () =>
    ask(
      'confirmEnd',
      {
        title: 'End your turn?',
        sub:
          [
            endWarn,
            v.rules.houseRules.handBack
              ? 'If you end too soon, you can ask for the dice back until the next player does anything.'
              : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined,
        yes: 'End turn',
      },
      () => void client.act({ type: 'end' }),
    );

  /* ---------- Prompt ---------- */
  const cur = nameOf(v, v.turn);

  // Trading (SPEC 8.6): two buttons, the bank's showing your best rate, from the rules engine.
  const bankRate = (() => {
    if (me == null || !v.hand) return 'Bank';
    const st = stateFromView(v);
    let best = Infinity;
    let cards: Card[] = [];
    for (const k of cardKinds(st)) {
      const r = rateFor(st, me, k);
      if (r < best) [best, cards] = [r, [k]];
      else if (r === best) cards.push(k);
    }
    const all = cards.length === cardKinds(st).length;
    return all || cards.length > 2
      ? `Bank · ${best}:1`
      : `Bank · ${best}:1 ${cards.map((k) => CARD_LABEL[k]).join(', ')}`;
  })();
  const waitingOffers =
    me == null ? 0 : v.offers.filter((o) => o.from !== me && o.resp[me] == null && (o.from === v.turn || v.turn === me)).length; // prettier-ignore
  const tradeButtons = (players: string | null, bank: string | null): PromptButton[] => [
    {
      label: 'Trade with players',
      on: () => setSheet({ k: 'trade', tab: 'players' }),
      testid: 'trade',
      kind: 'trade',
      ...(players ? { off: players } : {}),
      ...(waitingOffers ? { badge: waitingOffers } : {}),
    },
    {
      label: bankRate,
      on: () => setSheet({ k: 'trade', tab: 'bank' }),
      testid: 'trade-bank',
      kind: 'bank',
      ...(bank ? { off: bank } : {}),
    },
  ];
  // Before the roll (SPEC 8.7): a reminder of cards you may play first.
  const alchemist = (v.ck?.hand ?? []).includes('alchemist') && !v.ck?.alchemy;
  const alchemistPlays = acts.filter((a): a is Play => a.type === 'progress' && a.card === 'alchemist');
  const rollNow = () => {
    if (alchemist && alchemistPlays.length)
      return ask(
        'confirmCard',
        {
          title: 'Roll without using your Alchemist?',
          sub: 'You can play it now to choose both dice.',
          yes: 'Roll',
        },
        () => rollRef.current?.(),
      );
    rollRef.current?.();
  };
  const sum = v.dice ? v.dice[0] + v.dice[1] : 0;
  let pm: {
    title: string;
    sub: string;
    mine?: boolean;
    buttons?: PromptButton[];
  };
  if (v.phase === 'over') {
    pm = {
      title: v.winner === me ? 'You win!' : `${nameOf(v, v.winner)} wins!`,
      sub: '',
      mine: v.winner === me,
    };
  } else if (v.stage === 'setup') {
    const round = v.setupI < v.players.length ? 1 : 2;
    if (mine) {
      pm =
        sel == null
          ? {
              title: `Place your ${round === 1 ? 'first' : 'second'} settlement`,
              sub:
                round === 2 ? 'This one collects a card from each tile it touches.' : 'Tap a glowing corner.',
              mine: true,
            }
          : {
              title: 'Now place a road next to it',
              sub: 'Tap a glowing edge, or another corner to move the settlement.',
              mine: true,
              buttons: [{ label: 'Back', on: () => setSel(null) }],
            };
    } else
      pm = {
        title: `${cur} is placing a settlement`,
        sub: `Setup round ${round} of 2. The order snakes back in round 2.`,
      };
  } else if (v.stage === 'preroll') {
    pm = mine
      ? {
          title: 'Your turn: roll the dice',
          sub: DEV_PLAY.some(canPlay)
            ? 'You can play a development card before you roll.'
            : 'Tiles matching the roll produce cards.',
          mine: true,
          buttons: [
            ...(alchemistPlays.length
              ? [
                  {
                    label: 'Play Alchemist',
                    on: () => playProgress('alchemist', alchemistPlays),
                    testid: 'play-alchemist',
                    kind: 'card' as const,
                  },
                ]
              : []),
            ...(canPlay('knight')
              ? [
                  {
                    label: 'Play Knight',
                    on: () => play('knight'),
                    testid: 'preroll-knight',
                    kind: 'card' as const,
                  },
                ]
              : []),
            {
              label: 'Roll dice',
              on: rollNow,
              primary: true,
              testid: 'roll',
            },
            ...tradeButtons('Roll the dice first', 'Roll the dice first'),
          ],
        }
      : { title: `${cur} is about to roll`, sub: '' };
  } else if (v.stage === 'discard') {
    const waiting = Object.keys(v.discard ?? {}).map(Number);
    pm = owes
      ? {
          title: `A 7! Discard ${v.discard![me!]} cards`,
          sub: 'Anyone holding more than 7 cards gives back half.',
          mine: true,
          buttons: [{ label: 'Choose cards', on: () => setSheet({ k: 'discard' }), primary: true }],
        }
      : { title: 'A 7 was rolled', sub: `Waiting for ${listNames(v, waiting)} to discard.` };
  } else if (v.stage === 'gold') {
    const waiting = Object.keys(v.sea?.gold?.owed ?? {}).map(Number);
    pm = goldOwed
      ? {
          title: `Gold! Pick ${goldOwed} resource${goldOwed === 1 ? '' : 's'}`,
          sub: 'A gold field pays any resource you like.',
          mine: true,
          buttons: [{ label: 'Choose', on: () => setSheet({ k: 'gold' }), primary: true }],
        }
      : { title: 'Gold!', sub: `Waiting for ${listNames(v, waiting)} to pick resources.` };
  } else if (v.stage === 'robber') {
    const sea = v.rules.modules.includes('seafarers');
    pm = mine
      ? {
          title: sea ? 'Move the robber or the pirate' : 'Move the robber',
          sub: sea
            ? 'Tap a land tile for the robber, or a sea tile for the pirate. You steal from someone next to it.'
            : 'Tap any other tile. It stops producing, and you steal a card from someone next to it.',
          mine: true,
        }
      : { title: `${cur} is moving the ${sea ? 'robber or pirate' : 'robber'}`, sub: '' };
  } else if (v.stage === 'roads') {
    pm = mine
      ? {
          title: `Place ${v.freeRoads} free ${v.rules.modules.includes('seafarers') ? 'road or ship' : 'road'}${v.freeRoads === 1 ? '' : 's'}`,
          sub: 'Road Building: tap a glowing edge.',
          mine: true,
          buttons: [{ label: 'Done', on: () => void client.act({ type: 'skipRoads' }) }],
        }
      : { title: `${cur} is placing free roads`, sub: '' };
  } else if (v.stage === 'ck') {
    const op = owePrompt(v, owe);
    const buttons: PromptButton[] = [];
    if (owe && !BOARD_OWES.has(owe.k))
      buttons.push({ label: 'Choose', on: () => setSheet({ k: 'owe' }), primary: true });
    if (owe && owed.some((a) => a.skip))
      buttons.push({ label: 'Skip', on: () => void client.act({ type: 'choose', skip: true }) });
    pm = { ...op, buttons };
  } else if (mine) {
    const cardText: [string, string] | null =
      mode === 'card' && card
        ? [
            `${PROGRESS_LABEL[card.card]}: ${{ v: 'tap a corner', vs: 'tap up to 2 knights', h: 'tap a tile', hh: card.picks.length ? 'tap the second tile' : 'tap the first tile', e: 'tap a road', none: '', to: '', r: '', d: '' }[paramOf(card.plays)]}`,
            '',
          ]
        : null;
    const smith = mode === 'card' && card && paramOf(card.plays) === 'vs' ? smithPrompt(card) : null;
    pm = mode
      ? {
          title: smith?.title ?? (cardText ?? MODE_TEXT[mode])[0],
          sub: smith?.sub ?? (cardText ?? MODE_TEXT[mode])[1],
          mine: true,
          buttons: [
            ...(smith?.buttons ?? []),
            { label: 'Cancel', on: () => setMode(null), testid: 'cancel' },
          ],
        }
      : {
          title: `You rolled ${sum}`,
          sub: 'Build, trade, or play a card. End your turn when you’re done.',
          mine: true,
          buttons: [
            ...tradeButtons(null, null),
            {
              label: 'End turn',
              on: endTurn,
              primary: true,
              testid: 'end',
              ...(endWarn ? { warn: endWarn } : {}),
            },
          ],
        };
  } else {
    // Easy CPUs never trade with people (docs/bot.md), nor any CPU with "CPU trading" off.
    const turnSeat = room.seats.find((x) => x.pid === v.players[v.turn]!.pid);
    const tradable =
      me != null &&
      (!v.players[v.turn]!.cpu ||
        ((turnSeat?.level ?? 'easy') !== 'easy' && room.options.cpuTrading !== false));
    const why =
      me == null
        ? null
        : v.stage !== 'main'
          ? `Wait for ${cur} to roll`
          : tradable
            ? null
            : room.options.cpuTrading === false
              ? 'CPU trading is off'
              : `${cur} doesn’t trade`;
    pm = {
      title: `${cur}’s turn`,
      sub: tradable ? `${cur} rolled ${sum}. You can offer them a trade.` : `${cur} rolled ${sum}.`,
      buttons: me == null ? [] : tradeButtons(why, 'Only on your turn'),
    };
  }

  // Hand the dice back (SPEC 4.4).
  const canAskBack = myActs.some((a) => a.type === 'askBack');
  const canHandBack = myActs.some((a) => a.type === 'handBack');
  const backFrom = v.back ? nameOf(v, v.back.from) : '';
  if (canAskBack)
    pm = {
      ...pm,
      buttons: [
        ...(pm.buttons ?? []),
        {
          label: 'Wait, give the dice back',
          on: () => void client.act({ type: 'askBack' }),
          testid: 'ask-back',
        },
      ],
    };
  else if (v.back && v.back.from === me && v.back.asked && !v.back.refused)
    pm = { ...pm, sub: `You asked ${cur} for the dice back.` };
  else if (v.back && v.back.from === me && v.back.refused) pm = { ...pm, sub: `${cur} kept the dice.` };
  if (canHandBack && !v.back?.asked)
    pm = {
      ...pm,
      buttons: [
        ...(pm.buttons ?? []),
        {
          label: `Hand the dice back to ${backFrom}`,
          on: () => void client.act({ type: 'handBack' }),
          testid: 'hand-back',
        },
      ],
    };
  // Undo (SPEC 5.10): ask right after your own move; everyone else answers.
  if (myActs.some((a) => a.type === 'askUndo'))
    pm = {
      ...pm,
      buttons: [
        ...(pm.buttons ?? []),
        { label: 'Undo', on: () => void client.act({ type: 'askUndo' }), testid: 'undo' },
      ],
    };
  if (myActs.some((a) => a.type === 'cancelUndo'))
    pm = {
      ...pm,
      sub: `Waiting for everyone to agree to undo your last move${v.undo?.ok.length ? ` (${listNames(v, v.undo.ok)} agreed)` : ''}.`,
      buttons: [
        ...(pm.buttons ?? []),
        { label: 'Withdraw undo', on: () => void client.act({ type: 'cancelUndo' }), testid: 'undo-cancel' },
      ],
    };
  const answerUndo = myActs.some((a) => a.type === 'answerUndo');

  // The turn sound (SPEC 5.9): only for the player the game is waiting on, once per thing to do.
  const needs: [string, string][] = [];
  if (me != null && v.phase === 'play') {
    if (mine && v.stage === 'setup') needs.push([`setup:${v.setupI}`, 'Place your settlement']);
    if (mine && v.stage === 'preroll') needs.push([`turn:${v.turnN}`, 'Your turn']);
    if (owes) needs.push([`discard:${v.turnN}`, 'Discard cards']);
    if (goldOwed) needs.push([`gold:${v.turnN}:${v.seq}`, 'Pick your gold']);
    if (owe) needs.push([`owe:${oweKey}`, 'A choice is waiting for you']);
    for (const o of v.offers)
      if (o.from !== me && o.resp[me] == null && (o.from === v.turn || v.turn === me))
        needs.push([`offer:${o.id}`, `${nameOf(v, o.from)} offered a trade`]);
    if (canHandBack && v.back?.asked) needs.push([`back:${v.turnN}`, `${backFrom} asks for the dice back`]);
    if (answerUndo && v.undo)
      needs.push([`undo:${v.turnN}:${v.undo.p}`, `${nameOf(v, v.undo.p)} asks to undo`]);
  }
  const needKey = needs.map((x) => x[0]).join('|');
  const heard = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Anything already waiting when the page opened doesn't chime.
    if (!heard.current) {
      heard.current = new Set(needs.map((x) => x[0]));
      return;
    }
    const fresh = needs.filter(([k]) => !heard.current!.has(k));
    for (const [k] of fresh) heard.current.add(k);
    if (!fresh.length) return;
    if (settingOn(my, 'turnSound')) playSound('turn');
    if (settingOn(my, 'browserNotify')) notify(fresh[0]![1]);
  }, [needKey]);
  // The barbarians' attack (SPEC 9.2): a notice everyone sees, the sad tune for whoever lost a
  // city and the horn for everyone else. A city chosen later (from several) joins the notice.
  const [raid, setRaid] = useState<Raid | null>(null);
  const lastAttack = useRef<Raid['attack'] | null>(null);
  useEffect(
    () =>
      client.onFresh(({ items, after }) => {
        const evs = items.flatMap((it) => (it.k === 'ev' && !isLogNote(it.e) ? [it.e] : []));
        const attack = evs.find((e): e is Raid['attack'] => e.k === 'attack');
        const lost = evs.filter((e): e is Raid['lost'][number] => e.k === 'cityLost');
        if (attack) {
          lastAttack.current = attack;
          setRaid({ attack, lost });
          if (settingOn(client.state.room?.mySettings, 'gameSounds'))
            playSound(after?.me != null && attack.losers.includes(after.me) ? 'sad' : 'horn');
        } else if (lost.length && lastAttack.current) {
          const at = lastAttack.current;
          setRaid((r) => ({ attack: at, lost: [...(r?.lost ?? []), ...lost] }));
        }
      }),
    [],
  );
  // Building sounds for everyone (game sounds switch).
  useEffect(
    () =>
      client.onFresh(({ items }) => {
        if (!settingOn(client.state.room?.mySettings, 'gameSounds')) return;
        if (items.some((it) => it.k === 'ev' && ['build', 'knight', 'wall', 'setup'].includes(it.e.k)))
          playSound('build');
      }),
    [],
  );

  // A piece waiting for Confirm takes over the prompt.
  if (placing)
    pm = {
      title: 'Place it here?',
      sub: 'Nothing is placed until you confirm. Tap another spot to move it.',
      mine: true,
      buttons: [
        {
          label: 'Confirm',
          primary: true,
          testid: 'confirm-place',
          on: () => {
            const p = placing;
            setPlacing(null);
            doAct(p.a, p.after);
          },
        },
        { label: 'Cancel', on: () => setPlacing(null), testid: 'cancel-place' },
      ],
    };

  const connected = (p: Seat) => room.seats.find((x) => x.pid === v.players[p]!.pid)?.connected ?? false;
  const pr = room.pendingReset;
  const myPid = room.me;
  const disconnected = room.seats.map((x, i) => ({ ...x, i })).filter((x) => !x.connected);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span dangerouslySetInnerHTML={{ __html: BRAND_SVG }} style={{ display: 'contents' }} />
          <span>Settlers</span>
        </div>
        <div className="turnchip" data-testid="turnchip">
          {v.phase === 'over' ? (
            <>
              <span className="dot" style={{ background: PCOL[v.players[v.winner!]!.color] }} />
              <span className="label">{nameOf(v, v.winner)} won</span>
            </>
          ) : (
            <>
              <span className="dot" style={{ background: PCOL[v.players[v.turn]!.color] }} />
              <span className="label">{mine ? 'Your turn' : cur}</span>
              <span className="sub">
                {
                  {
                    setup: 'setup',
                    preroll: 'to roll',
                    discard: 'discarding',
                    robber: 'robber',
                    roads: 'building',
                    main: 'playing',
                    gold: 'choosing gold',
                    ck: 'choosing',
                  }[v.stage]
                }
              </span>
            </>
          )}
        </div>
        <button className="turnchip roomchip" onClick={() => setSheet({ k: 'menu' })} title="Room menu">
          <span className="sub">Room</span>
          <span className="label">{room.code}</span>
        </button>
        {/* SPEC 8.5: the target, always on screen (raised by Keep playing). */}
        <span className="turnchip goalchip" data-testid="goal" title={`First to ${v.winVP} points wins`}>
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path
              d="M3 13V1.5M3 2h8l-2 3 2 3H3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sub">First to</span>
          <span className="label">{v.winVP}</span>
        </span>
        <div className="spacer" />
        <span
          className={`sync ${status === 'live' ? (busy ? 'busy' : 'live') : status === 'offline' ? 'off' : 'busy'}`}
          title={status}
          data-testid="sync"
        />
        {dice ? (
          <button className="btn small ghost" onClick={() => setSheet({ k: 'dice' })} data-testid="open-dice">
            Dice<span className="wide-only"> stats</span>
          </button>
        ) : null}
        <EventDie v={v} />
        <button className="iconbtn" type="button" aria-label="Menu" onClick={() => setSheet({ k: 'menu' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <main className="main">
        {pr ? (
          <div className="banner" data-testid="reset-banner">
            {pr.pid === myPid ? (
              <>
                <span>
                  {pr.kind === 'quit'
                    ? 'You asked to save the game and stop for tonight. Everyone has been told.'
                    : 'You asked to end this game. Everyone has been warned.'}
                </span>
                <span className="acts">
                  <button
                    className={`btn small${pr.kind === 'quit' ? ' primary' : ' danger'}`}
                    onClick={() => client.resetConfirm()}
                    data-testid="reset-confirm"
                  >
                    {pr.kind === 'quit' ? 'Yes, save and quit' : 'Yes, end the game'}
                  </button>
                  <button className="btn small" onClick={() => client.resetCancel()}>
                    Never mind
                  </button>
                </span>
              </>
            ) : (
              <>
                <span>
                  {pr.kind === 'quit'
                    ? `${pr.nick} wants to save the game and stop for tonight.`
                    : `${pr.nick} wants to end this game and start a new one.`}
                </span>
                {myPid ? (
                  <span className="acts">
                    <button className="btn small primary" onClick={() => client.resetCancel()}>
                      Keep playing
                    </button>
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {answerUndo && v.undo ? (
          <div className="banner" data-testid="undo-banner">
            <span>{nameOf(v, v.undo.p)} asks to undo their last move.</span>
            <span className="acts">
              <button
                className="btn small primary"
                disabled={busy}
                data-testid="undo-yes"
                onClick={() => void client.act({ type: 'answerUndo', yes: true })}
              >
                OK, undo it
              </button>
              <button
                className="btn small"
                disabled={busy}
                data-testid="undo-no"
                onClick={() => void client.act({ type: 'answerUndo', yes: false })}
              >
                No
              </button>
            </span>
          </div>
        ) : null}
        {canHandBack && v.back?.asked ? (
          <div className="banner" data-testid="back-banner">
            <span>{backFrom} asks for the dice back. Their turn would come back exactly as it was.</span>
            <span className="acts">
              <button
                className="btn small primary"
                disabled={busy}
                data-testid="hand-back"
                onClick={() => void client.act({ type: 'handBack' })}
              >
                Hand them back
              </button>
              {myActs.some((a) => a.type === 'refuseBack') ? (
                <button
                  className="btn small"
                  disabled={busy}
                  data-testid="refuse-back"
                  onClick={() => void client.act({ type: 'refuseBack' })}
                >
                  Keep them
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {me == null && v.phase === 'play' ? (
          <div className="banner">
            <span>
              You’re watching.
              {disconnected.length ? ' Left the game? Pick your name to get your seat back.' : ''}
            </span>
            {disconnected.length ? <RejoinForm room={room} /> : null}
            <span className="acts">
              {disconnected.length ? <span className="hint">Or take over a seat:</span> : null}
              {disconnected.map((x) => (
                <button
                  key={x.pid}
                  className="btn small"
                  onClick={() => setSheet({ k: 'claim', seat: x.i, nick: x.nick })}
                >
                  {x.nick}
                </button>
              ))}
            </span>
          </div>
        ) : null}
        <div className="board-wrap">
          <Board
            view={v}
            targets={targets}
            myColor={me != null ? PCOL[v.players[me]!.color] : null}
            onVert={onVert}
            onEdge={onEdge}
            onHex={onHex}
            preview={previewAt}
            pending={placing?.ghosts ?? smithGhosts}
            flash={raid?.lost.map((l) => l.v)}
          />
          {/* Hidden while you still pick which city to lose: the prompt says so, and the board stays clear. */}
          {raid && !(me != null && raid.attack.losers.includes(me) && !raid.lost.some((l) => l.p === me)) ? (
            <RaidNotice v={v} raid={raid} onClose={() => setRaid(null)} />
          ) : null}
          {settingOn(my, 'diceCorner') ? (
            <RollDice
              dice={v.dice}
              {...(v.ck ? { event: v.ck.event } : {})}
              canRoll={false}
              onRoll={() => {}}
              sound={false}
              corner
            />
          ) : null}
          {celebrating ? (
            <Celebration
              color={PCOL[v.players[v.winner!]!.color]}
              text={`${v.winner === me ? 'You win' : `${nameOf(v, v.winner)} wins`}${v.keep?.on ? ' in overtime' : ''}!`}
              onDone={() => setCelebrating(false)}
            />
          ) : v.phase === 'over' && !hideOver ? (
            <div className="overlay endoverlay">
              <GameOver v={v} stats={stats ?? null} onHide={() => setHideOver(true)} />
            </div>
          ) : null}
        </div>
        <div className={`prompt${pm.mine ? ' mine' : ''}`} aria-live="polite" data-testid="prompt">
          <RollDice
            dice={v.dice}
            {...(v.ck ? { event: v.ck.event } : {})}
            canRoll={canRoll}
            onRoll={() => client.act({ type: 'roll' })}
            sound={settingOn(my, 'gameSounds')}
            rollRef={rollRef}
          />
          <div className="msg">
            <strong>{pm.title}</strong>
            {pm.sub ? <span>{pm.sub}</span> : null}
          </div>
          {pm.buttons?.length ? (
            <div className="acts">
              {pm.buttons.map((b) => (
                <button
                  key={b.label}
                  className={`btn${b.primary ? ' primary' : ''}${b.kind ? ` actbtn ${b.kind}btn` : ''}`}
                  disabled={busy || b.off != null}
                  title={b.off}
                  onClick={b.on}
                  data-testid={b.testid}
                >
                  {b.kind ? (
                    <span
                      className="acticon"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: ACT_ICON[b.kind] }}
                    />
                  ) : null}
                  {b.label}
                  {b.warn ? (
                    <span
                      className="endwarn"
                      title={b.warn}
                      data-testid={`${b.testid}-warn`}
                      aria-label={b.warn}
                    >
                      ⚠
                    </span>
                  ) : null}
                  {b.badge ? (
                    <span className="badge" data-testid={`${b.testid}-badge`}>
                      {b.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </main>

      <section className="dock-wrap" aria-label="Your cards and actions">
        <Offers v={v} busy={busy} ask={(q, go) => ask('confirmTrade', q, go)} />
        {me != null && v.hand ? (
          <Tray
            v={v}
            mine={mine}
            busy={busy}
            mode={mode}
            setMode={setMode}
            canPlay={canPlay}
            play={play}
            canMove={acts.some((a) => a.type === 'moveShip')}
            acts={acts}
            onImprove={improve}
            onPlayProgress={playProgress}
          />
        ) : null}
      </section>

      <aside className="side">
        {v.ck ? <BarbarianBox v={v} /> : null}
        <section className="box" aria-label="Players">
          <span className="eyebrow">
            Players · first to <b data-testid="win-target">{v.winVP}</b> points
          </span>
          <div className="players">
            {v.players.map((p, i) => (
              <div
                key={p.pid}
                className={`player${i === v.turn && v.phase === 'play' ? ' turn' : ''}${connected(i) ? '' : ' away'}`}
                data-seat={i}
              >
                <span className="pc">
                  <svg viewBox="-15 -15 30 30" aria-hidden="true">
                    <path
                      d="M-10 9V-2L0-11 10-2V9Z"
                      fill={PCOL[p.color]}
                      stroke={PEDGE(p.color)}
                      strokeWidth="2"
                    />
                  </svg>
                </span>
                <span className="nm">
                  <span>{p.nick}</span>
                  {i === me ? <span className="you">you</span> : null}
                  {p.cpu ? (
                    <span className="you" data-testid="cpu-tag">
                      CPU · {room.seats.find((x) => x.pid === p.pid)?.levelName ?? 'Easy'}
                    </span>
                  ) : null}
                  {v.discard?.[i] != null ? <span className="tag wait">discarding</span> : null}
                  <span
                    className={`online${connected(i) ? '' : ' away'}`}
                    title={connected(i) ? 'Connected' : 'Disconnected'}
                  />
                </span>
                <Score v={v} s={s} p={i} always={settingOn(my, 'showBreakdown')} />
                <PiecesLeft s={s} p={i} color={p.color} />
                <span className="stats">
                  <HandCount v={v} s={s} p={i} n={p.resCount} testid={`cards-${i}`} />
                  {v.ck ? null : (
                    <>
                      <span>
                        <b>{p.devCount}</b> dev
                      </span>
                      <span>
                        <b>{p.knights}</b> knights
                      </span>
                    </>
                  )}
                  <span>
                    <b>{p.roadLen}</b> road
                  </span>
                </span>
                {v.ck ? <PlayerCK v={v} p={i} /> : null}
                {(() => {
                  const metros = v.ck
                    ? (Object.entries(v.ck.metro) as [keyof typeof TRACK_COLOR, number | null][]).filter(
                        ([, at]) => at != null && v.verts[at]?.[0] === i,
                      )
                    : [];
                  const merchant = v.ck?.merchant?.p === i;
                  if (!(v.longest === i || v.largest === i || metros.length || merchant)) return null;
                  return (
                    <span className="badges">
                      {v.longest === i ? <span className="badge">{routeName(v)}</span> : null}
                      {v.largest === i ? <span className="badge">Largest Army</span> : null}
                      {metros.map(([t]) => (
                        <span key={t} className="badge" style={{ borderColor: TRACK_COLOR[t] }}>
                          {TRACK_LABEL[t]} metropolis
                        </span>
                      ))}
                      {merchant ? <span className="badge">Merchant</span> : null}
                    </span>
                  );
                })()}
              </div>
            ))}
          </div>
          <div className="bankline" data-bank>
            <span>Bank:</span>
            {/* SPEC 8.1: every resource and commodity in play; ∞ when it never runs out. */}
            {[...RES, ...(v.ck ? COMS : [])].map((r) => {
              const unlimited =
                v.rules.bank === 'unlimited' ||
                (!RES.includes(r as (typeof RES)[number]) && v.rules.bank !== 'limited');
              return (
                <span key={r} title={CARD_LABEL[r]} data-testid={`bank-${r}`}>
                  <i
                    style={{
                      display: 'inline-block',
                      width: 9,
                      height: 13,
                      borderRadius: 2,
                      background: CARD_COLOR[r],
                    }}
                  />{' '}
                  {unlimited ? '∞' : v.bank[r]}
                </span>
              );
            })}
            {v.ck ? null : <span>Dev deck {v.deckCount}</span>}
          </div>
        </section>
        <section className="box" aria-label="Table talk">
          <span className="eyebrow">Table talk</span>
          <Log v={v} log={log} />
          <ChatForm />
        </section>
      </aside>

      {sheet?.k === 'trade' ? (
        <TradeSheet v={v} tab={sheet.tab ?? 'players'} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'discard' && owes ? <DiscardSheet v={v} onClose={() => setSheet(null)} /> : null}
      {sheet?.k === 'plenty' ? <PlentySheet v={v} onClose={() => setSheet(null)} /> : null}
      {sheet?.k === 'gold' && goldOwed ? (
        <GoldSheet v={v} due={goldOwed} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'piece' ? (
        <PieceSheet
          options={sheet.options}
          onPick={(a) => {
            setSheet(null);
            void client.act(a).then((r) => {
              if (!r.ok) return;
              setSel(null);
              if (v.stage === 'main') setMode(null);
            });
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.k === 'mono' ? <MonoSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.k === 'victim' ? (
        <VictimSheet
          v={v}
          hex={sheet.hex}
          victims={sheet.victims}
          kind={sheet.kind}
          make={sheet.make}
          onClose={() => {
            setSheet(null);
            if (mode === 'chase') setMode(null);
          }}
        />
      ) : null}
      {sheet?.k === 'knightAct' ? (
        <KnightSheet
          v={v}
          at={sheet.at}
          acts={acts}
          onMove={() => {
            setMode('kmove');
            setKFrom(sheet.at);
          }}
          onChase={() => {
            setMode('chase');
            setKFrom(sheet.at);
          }}
          onClose={() => {
            setSheet(null);
            if (mode === 'knights') setMode(null);
          }}
        />
      ) : null}
      {sheet?.k === 'owe' && owe && !BOARD_OWES.has(owe.k) ? (
        <OweSheet v={v} o={owe} opts={owed} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'cardParam' ? (
        <CardParamSheet v={v} card={sheet.card} plays={sheet.plays} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'menu' ? (
        <MenuSheet
          v={v}
          code={room.code}
          onClose={() => setSheet(null)}
          onEndGame={() => setSheet({ k: 'endGame' })}
          onSettings={me != null ? () => setSheet({ k: 'settings' }) : undefined}
          onRules={() => setSheet({ k: 'rules' })}
          onQuit={me != null && v.phase === 'play' ? () => setSheet({ k: 'quit' }) : undefined}
        />
      ) : null}
      {sheet?.k === 'settings' ? (
        <SettingsSheet mine={room.mySettings} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'rules' ? <RulesSheet v={v} room={room} onClose={() => setSheet(null)} /> : null}
      {sheet?.k === 'dice' && dice ? (
        <DicePanel dice={dice} names={v.players.map((_, i) => nameOf(v, i))} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'quit' ? (
        <ConfirmTwice
          title="Save and quit?"
          first="The game is saved after every move. This ends tonight’s session for everyone; you can resume it from Saved Games."
          second="Everyone will be asked first and can stop you. Then you confirm once more from the banner."
          action="Ask everyone"
          onConfirm={() => client.resetRequest('quit')}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.k === 'ask' ? (
        <AskSheet
          title={sheet.title}
          sub={sheet.sub}
          yes={sheet.yes}
          onYes={sheet.onYes}
          onClose={() => setSheet(null)}
        >
          {sheet.body}
        </AskSheet>
      ) : null}
      {sheet?.k === 'endGame' ? (
        <ConfirmTwice
          title="End this game?"
          first="The game in progress will end for everyone. You can’t undo this."
          second="Everyone will get a warning and can stop you. Then you confirm once more from the banner."
          action="Warn everyone"
          onConfirm={() => client.resetRequest()}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.k === 'claim' ? (
        <ConfirmTwice
          title={`Take over ${sheet.nick}’s seat?`}
          first={`Only do this if you are ${sheet.nick} on a new device, or everyone agrees.`}
          second={`Everyone will be told that someone took over ${sheet.nick}’s seat. ${sheet.nick}’s old device will stop working.`}
          action="Take the seat"
          onConfirm={() => client.claim(sheet.seat)}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

/** Rejoin by nickname (SPEC 4.6): the same name gets a disconnected seat straight back. */
function RejoinForm({ room }: { room: RoomInfo }) {
  // Rejoin by picking your name (SPEC 4.6, 5.1): only seats nobody is using.
  const away = room.seats.filter((x) => !x.cpu && !x.connected && x.profile);
  return (
    <span className="acts">
      {away.map((x) => (
        <button
          key={x.pid}
          className="btn small primary"
          data-testid="rejoin"
          data-name={x.nick}
          onClick={() => client.join(x.profile!, x.color)}
        >
          I’m {x.nick}
        </button>
      ))}
    </span>
  );
}

function GameOver({ v, stats, onHide }: { v: PlayerView; stats: GameStats | null; onHide: () => void }) {
  const total = (i: number) => v.players[i]!.publicVP + (v.players[i]!.vpCards ?? 0);
  const order = v.players.map((_, i) => i).sort((a, b) => total(b) - total(a));
  return (
    <div className="card endcard" role="dialog" aria-label="Game over" data-testid="game-over">
      <h2>
        {v.me === v.winner ? 'You win' : `${nameOf(v, v.winner)} wins`}
        {v.keep?.on ? ' in overtime!' : '!'}
      </h2>
      <p className="lede">
        {v.keep?.on
          ? `First to ${v.winVP} in overtime. The game’s result stays ${nameOf(v, v.keep.first.p)}’s first win to ${v.keep.first.target}.`
          : 'Final scores, hidden victory cards included.'}
      </p>
      <div className="seats" style={{ gridTemplateColumns: '1fr' }}>
        {order.map((i) => (
          <div className="seat" key={i}>
            <span className="dot" style={{ background: PCOL[v.players[i]!.color] }} />
            <span className="nm">{nameOf(v, i)}</span>
            {v.players[i]!.vpCards ? <span className="you">({v.players[i]!.vpCards} from cards)</span> : null}
            <b style={{ marginLeft: 'auto' }}>{total(i)}</b>
          </div>
        ))}
      </div>
      <KeepPlaying v={v} />
      <div className="row">
        {v.me != null ? (
          <button className="btn primary" onClick={() => client.rematch()} data-testid="rematch">
            Rematch
          </button>
        ) : null}
        <button className="btn ghost" onClick={onHide}>
          Look at the board
        </button>
      </div>
      {stats ? (
        <GameStatsView
          stats={stats}
          names={v.players.map((_, i) => nameOf(v, i))}
          colors={v.players.map((p) => p.color)}
          hexes={v.board.hexes}
        />
      ) : null}
    </div>
  );
}

/**
 * Keep playing (SPEC 8.9): pick a new target and ask; everyone else says yes or no (CPUs agree
 * on their own). One "no" ends the game normally.
 */
function KeepPlaying({ v }: { v: PlayerView }) {
  const min = keepMinTarget(stateFromView(v));
  const [target, setTarget] = useState(Math.max(v.winVP + 2, min));
  const [picking, setPicking] = useState(false);
  const me = v.me;
  if (me == null) return null;
  const ask = v.keep?.ask;
  if (ask) {
    const waiting = v.players.map((_, i) => i).filter((i) => !ask.ok.includes(i));
    const mine = !ask.ok.includes(me);
    return (
      <div className="keepbox" data-testid="keep-ask">
        <p>
          <b>{nameOf(v, ask.p)}</b> {ask.p === me ? 'asked' : 'asks'} to keep playing: first to{' '}
          <b>{ask.target}</b> wins in overtime. Waiting for {listNames(v, waiting)}.
        </p>
        <div className="row">
          {mine ? (
            <>
              <button
                className="btn primary"
                onClick={() => void client.act({ type: 'answerKeep', yes: true })}
                data-testid="keep-yes"
              >
                Keep playing
              </button>
              <button
                className="btn"
                onClick={() => void client.act({ type: 'answerKeep', yes: false })}
                data-testid="keep-no"
              >
                No, we’re done
              </button>
            </>
          ) : ask.p === me ? (
            <button
              className="btn"
              onClick={() => void client.act({ type: 'cancelKeep' })}
              data-testid="keep-cancel"
            >
              Withdraw
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (!picking)
    return (
      <button className="btn keepbtn" onClick={() => setPicking(true)} data-testid="keep-playing">
        Keep playing
      </button>
    );
  return (
    <div className="keepbox" data-testid="keep-pick">
      <p>Play on to a new target. Everyone has to agree; the first win still counts as the result.</p>
      <div className="row" style={{ alignItems: 'center' }}>
        <span>First to</span>
        <div className="ctl">
          <button
            type="button"
            aria-label="Lower target"
            disabled={target <= min}
            onClick={() => setTarget(target - 1)}
          >
            −
          </button>
          <output data-testid="keep-target">{target}</output>
          <button
            type="button"
            aria-label="Higher target"
            disabled={target >= KEEP_MAX}
            onClick={() => setTarget(target + 1)}
          >
            +
          </button>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            void client.act({ type: 'askKeep', target });
            setPicking(false);
          }}
          data-testid="keep-ask-go"
        >
          Ask everyone
        </button>
        <button className="btn ghost" onClick={() => setPicking(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const VP_TEXT: Record<VPPart['k'], [string, string]> = {
  settlement: ['settlement', 'settlements'],
  city: ['city', 'cities'],
  longest: ['Longest Road', 'Longest Road'],
  largest: ['Largest Army', 'Largest Army'],
  vpCards: ['victory point card', 'victory point cards'],
  island: ['island bonus', 'island bonuses'],
  metropolis: ['metropolis', 'metropolises'],
  defender: ['Defender of Catan', 'Defender of Catan'],
  merchant: ['merchant', 'merchant'],
  progress: ['progress card', 'progress cards'],
};

/** "5 = 3 settlements (3) + Longest Road (2)" (SPEC 5.8). */
export function breakdownText(parts: VPPart[]): string {
  const sum = parts.reduce((a, x) => a + x.vp, 0);
  if (!parts.length) return '0';
  const each = parts.map((x) => {
    const [one, many] = VP_TEXT[x.k];
    const what = x.k === 'longest' || x.k === 'largest' ? one : `${x.n} ${x.n === 1 ? one : many}`;
    return `${what}${x.hidden ? ', hidden' : ''} (${x.vp})`;
  });
  return `${sum} = ${each.join(' + ')}`;
}

/** A player's score; tap or hover for what it's made of, and how many points they still need. */
function Score({
  v,
  s,
  p,
  always,
}: {
  v: PlayerView;
  s: ReturnType<typeof stateFromView>;
  p: Seat;
  always: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parts = vpBreakdown(s, p, p === v.me || v.phase === 'over');
  const shown = p === v.me && v.hand ? v.hand.totalVP : v.players[p]!.publicVP + (v.players[p]!.vpCards ?? 0);
  const text = breakdownText(parts);
  const need = Math.max(0, v.winVP - shown);
  return (
    <span className="vpwrap">
      <button
        type="button"
        className="vp"
        title={text}
        aria-expanded={open || always}
        onClick={() => setOpen(!open)}
        data-testid={`score-${p}`}
        data-score={shown}
      >
        {shown}
        <small>/ {v.winVP}</small>
      </button>
      {open || always ? (
        <span className="breakdown" data-testid={`breakdown-${p}`}>
          {text}
          {v.phase === 'play' ? <span className="need"> · needs {need} more</span> : null}
        </span>
      ) : null}
    </span>
  );
}

const PIECE_NAME: Record<string, string> = {
  road: 'Roads',
  settlement: 'Settlements',
  city: 'Cities',
  ship: 'Ships',
  knight1: 'Basic knights',
  knight2: 'Strong knights',
  knight3: 'Mighty knights',
  wall: 'City walls',
};

/** A tiny icon for a piece in the supply. */
function PieceIcon({ k, color }: { k: string; color: string }) {
  const f = PCOL[color as 'red'];
  const e = PEDGE(color as 'red');
  const body = (() => {
    switch (k) {
      case 'road':
        return <rect x={-8} y={-2.5} width={16} height={5} rx={2} fill={f} stroke={e} strokeWidth={1.2} />;
      case 'settlement':
        return <path d="M-6 6V-1L0-7 6-1V6Z" fill={f} stroke={e} strokeWidth={1.2} />;
      case 'city':
        return <path d="M-8 6V-2L-4-6 0-2V-1H8V6Z" fill={f} stroke={e} strokeWidth={1.2} />;
      case 'ship':
        return (
          <g>
            <path d="M-8 1H8L5 6H-5Z" fill={f} stroke={e} strokeWidth={1.2} />
            <path d="M0 0V-8L5-2Z" fill="#f4ecd6" stroke="#0b1418" strokeWidth={1} />
          </g>
        );
      case 'wall':
        return (
          <path d="M-8 6V-1H-5V-4H-2V-1H2V-4H5V-1H8V6Z" fill="#8b8172" stroke="#0b1418" strokeWidth={1.2} />
        );
      default: {
        const lvl = Number(k.slice(-1));
        return (
          <g>
            <path d="M-6-5Q0-8 6-5V0Q6 5 0 7Q-6 5-6 0Z" fill={f} stroke={e} strokeWidth={1.2} />
            {[...Array(lvl)].map((_, i) => (
              <circle
                key={i}
                cx={(i - (lvl - 1) / 2) * 3.4}
                cy={0}
                r={1.2}
                fill={color === 'black' ? '#e8eaec' : '#0b1418'}
              />
            ))}
          </g>
        );
      }
    }
  })();
  return (
    <svg viewBox="-9 -9 18 18" width={16} height={16} aria-hidden="true">
      {body}
    </svg>
  );
}

/** How many of each piece a player has left (SPEC 5.11); 0 shows red. */
function PiecesLeft({ s, p, color }: { s: ReturnType<typeof stateFromView>; p: Seat; color: string }) {
  const left = piecesLeft(s, p);
  return (
    <span className="piecesleft" data-testid={`pieces-${p}`}>
      {Object.entries(left).map(([k, n]) => (
        <span
          key={k}
          className={`pl${n === 0 ? ' out' : ''}`}
          data-kind={k}
          data-n={n}
          title={`${PIECE_NAME[k]}: ${n} left`}
        >
          <PieceIcon k={k} color={color} />
          {n}
        </span>
      ))}
    </span>
  );
}

function Offers({
  v,
  busy,
  ask,
}: {
  v: PlayerView;
  busy: boolean;
  ask: (q: { title: string; sub?: string; yes: string; body?: React.ReactNode }, go: () => void) => void;
}) {
  if (v.phase !== 'play' || v.stage !== 'main' || !v.offers.length) return null;
  const me = v.me;
  return (
    <div className="offers">
      {v.offers.map((o) => {
        const fromCur = o.from === v.turn;
        const acceptors = v.players.map((_, i) => i).filter((i) => i !== o.from && o.resp[i] === 1);
        const myRes = v.hand?.res;
        return (
          <div className="offer" key={o.id} data-testid="offer">
            <div className="line">
              <span className="who">{nameOf(v, o.from)}</span> {o.from === me ? 'offer' : 'offers'}{' '}
              <Chips c={o.give} /> <span>for</span> <Chips c={o.want} />
              {!fromCur ? <span className="sub">to {v.turn === me ? 'you' : nameOf(v, v.turn)}</span> : null}
            </div>
            {fromCur ? (
              <div className="resp">
                {v.players
                  .map((_, i) => i)
                  .filter((i) => i !== o.from)
                  .map((i) => (
                    <span key={i}>
                      {nameOf(v, i)}:{' '}
                      {o.resp[i] === 1 ? (
                        <b className="ok">accepts</b>
                      ) : o.resp[i] === 0 ? (
                        <b className="no">declines</b>
                      ) : (
                        'deciding'
                      )}
                    </span>
                  ))}
              </div>
            ) : null}
            <div className="row">
              {me === o.from ? (
                <>
                  {fromCur && me === v.turn
                    ? acceptors.map((w) => (
                        <button
                          key={w}
                          className="btn small primary"
                          disabled={busy}
                          onClick={() =>
                            ask(
                              {
                                title: `Trade with ${nameOf(v, w)}?`,
                                yes: 'Trade',
                                body: (
                                  <p className="tradeq">
                                    You give <Chips c={o.give} /> and get <Chips c={o.want} />
                                  </p>
                                ),
                              },
                              () => void client.act({ type: 'confirm', id: o.id, with: w }),
                            )
                          }
                        >
                          Trade with {nameOf(v, w)}
                        </button>
                      ))
                    : null}
                  <button
                    className="btn small ghost"
                    disabled={busy}
                    onClick={() => void client.act({ type: 'cancel', id: o.id })}
                  >
                    Withdraw
                  </button>
                </>
              ) : me != null && (fromCur || v.turn === me) && o.resp[me] == null ? (
                <>
                  <button
                    className="btn small primary"
                    disabled={busy || !myRes || !has(myRes, o.want)}
                    onClick={() =>
                      ask(
                        {
                          title: fromCur
                            ? `Accept ${nameOf(v, o.from)}’s offer?`
                            : `Trade with ${nameOf(v, o.from)}?`,
                          sub: fromCur ? `${nameOf(v, o.from)} still chooses who to trade with.` : undefined,
                          yes: fromCur ? 'Accept' : 'Trade',
                          body: (
                            <p className="tradeq">
                              You give <Chips c={o.want} /> and get <Chips c={o.give} />
                            </p>
                          ),
                        },
                        () => void client.act({ type: 'respond', id: o.id, yes: true }),
                      )
                    }
                  >
                    {fromCur ? 'Accept' : 'Trade'}
                  </button>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => void client.act({ type: 'respond', id: o.id, yes: false })}
                  >
                    Decline
                  </button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Over the hand limit (SPEC 8.4): who would discard how many on a 7, and why that limit. */
export function handRisk(
  v: PlayerView,
  s: ReturnType<typeof stateFromView>,
  p: Seat,
  n: number,
): { text: string; calm: boolean } | null {
  const limit = handLimit(s, p);
  if (n <= limit) return null;
  const lose = Math.floor(n / 2);
  const you = p === v.me;
  const walls = (limit - 7) / 2;
  // With "no discards before the first attack", nobody discards yet (D2): a calm note instead.
  if (v.rules.houseRules.noDiscardBeforeAttack && v.ck && v.ck.attacks === 0)
    return {
      calm: true,
      text: `${n} cards: a 7 would cost ${you ? 'you' : nameOf(v, p)} ${lose}, but nobody discards until the barbarians have attacked`,
    };
  const why = walls
    ? `: 7, plus ${2 * walls} for ${you ? 'your' : 'their'} city wall${walls > 1 ? 's' : ''}`
    : '';
  return {
    calm: false,
    text: `${n} cards. If a 7 is rolled, ${you ? 'you’ll' : `${nameOf(v, p)} will`} discard ${lose} (half, rounded down). ${you ? 'Your' : 'Their'} limit is ${limit}${why}.`,
  };
}

/** A card count that turns red, with a warning, over the hand limit; hover explains it. */
function HandCount(props: {
  v: PlayerView;
  s: ReturnType<typeof stateFromView>;
  p: Seat;
  n: number;
  testid: string;
}) {
  const risk = handRisk(props.v, props.s, props.p, props.n);
  return (
    <span
      className={`handcount${risk ? (risk.calm ? ' calm' : ' over') : ''}`}
      title={risk?.text}
      data-testid={props.testid}
      data-over={risk && !risk.calm ? 1 : undefined}
    >
      {risk && !risk.calm ? (
        <svg viewBox="0 0 16 16" width="13" height="13" aria-label="Over the hand limit" role="img">
          <path d="M8 1.5 15 14H1z" fill="currentColor" />
          <path d="M8 6v4M8 11.6v.4" stroke="#1a0d0d" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : null}
      <b>{props.n}</b> cards
    </span>
  );
}

function Tray(props: {
  v: PlayerView;
  mine: boolean;
  busy: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  canPlay: (c: DevPlayable) => boolean;
  play: (c: DevPlayable) => void;
  canMove: boolean;
  acts: Action[];
  onImprove: (opts: Action[]) => void;
  onPlayProgress: (c: Progress, plays: Play[]) => void;
}) {
  const { v, mine, busy } = props;
  const sea = v.rules.modules.includes('seafarers');
  const ck = !!v.ck;
  const me = v.me!;
  const hand = v.hand!;
  const pieces = v.players[me]!.pieces;
  const left = piecesLeft(stateFromView(v), me);
  const main = mine && v.stage === 'main' && !busy;
  const can = (t: Action['type']) => props.acts.some((a) => a.type === t);
  const builds = [
    { k: 'road' as const, label: 'Road', cost: COST.road, left: pieces.road },
    { k: 'settlement' as const, label: 'Settlement', cost: COST.settlement, left: pieces.settlement },
    { k: 'city' as const, label: 'City', cost: COST.city, left: pieces.city },
    ...(sea ? [{ k: 'ship' as const, label: 'Ship', cost: SHIP_COST, left: pieces.ship ?? 0 }] : []),
    ...(ck
      ? [
          {
            k: 'knight' as const,
            label: 'Knight',
            cost: KNIGHT_COST,
            left: can('knight') ? (left.knight1 ?? 0) : 0,
          },
          {
            k: 'wall' as const,
            label: 'City wall',
            cost: WALL_COST,
            left: can('wall') ? (left.wall ?? 0) : 0,
          },
        ]
      : [{ k: 'dev' as const, label: 'Dev card', cost: COST.dev, left: v.deckCount }]),
  ];
  const devs = [
    ...DEV_PLAY.map((c) => ({ c, n: hand.dev[c], fresh: hand.fresh[c] })),
    { c: 'vp' as const, n: hand.vpCards, fresh: 0 },
  ].filter((d) => d.n + d.fresh > 0);
  return (
    <div className="tray">
      <div className="traytitle">
        <span className="eyebrow">Your hand</span>
        <span className="handmeta">
          <HandCount
            v={v}
            s={stateFromView(v)}
            p={v.me!}
            n={Object.values(hand.res).reduce((a, b) => a + b, 0)}
            testid="hand-count"
          />{' '}
          · {hand.totalVP} points
        </span>
      </div>
      <div className="hand" data-testid="hand">
        {(ck ? [...RES, ...COMS] : RES).map((r) => (
          <div
            key={r}
            className={`rcard${hand.res[r] ? '' : ' zero'}${(COMS as readonly string[]).includes(r) ? ' com' : ''}`}
            style={{ ['--c' as string]: CARD_COLOR[r] }}
            title={CARD_LABEL[r]}
            data-res={r}
            data-n={hand.res[r] ?? 0}
          >
            <span dangerouslySetInnerHTML={{ __html: cardIcon(r) }} style={{ display: 'contents' }} />
            <span className="n">{hand.res[r] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="build">
        {builds.map((b) => {
          const ok = main && has(hand.res, b.cost) && b.left > 0;
          return (
            <button
              key={b.k}
              className={`btn bbtn${props.mode === b.k ? ' on' : ''}`}
              disabled={!ok}
              title={
                b.k === 'knight'
                  ? 'Basic knight. Activate it with 1 wheat.'
                  : b.k === 'wall'
                    ? '+2 to your hand limit on a 7'
                    : undefined
              }
              data-testid={`build-${b.k}`}
              onClick={() => {
                if (b.k === 'dev') void client.act({ type: 'buyDev' });
                else props.setMode(props.mode === b.k ? null : b.k);
              }}
            >
              <span>
                {b.label}
                {b.k !== 'dev' ? (
                  <span
                    className={`left${(b.k === 'knight' ? left.knight1 : b.k === 'wall' ? left.wall : b.left) === 0 ? ' out' : ''}`}
                  >
                    {' '}
                    · {b.k === 'knight' ? left.knight1 : b.k === 'wall' ? left.wall : b.left} left
                  </span>
                ) : null}
              </span>
              <span className="cost">
                {Object.entries(b.cost).flatMap(([r, n]) =>
                  Array.from({ length: n ?? 0 }, (_, i) => (
                    <i key={`${r}${i}`} style={{ ['--c' as string]: TILE_COLOR[r as 'wood'] }} />
                  )),
                )}
              </span>
            </button>
          );
        })}
        {sea ? (
          <button
            className={`btn bbtn${props.mode === 'move' ? ' on' : ''}`}
            disabled={!main || !props.canMove}
            data-testid="move-ship"
            onClick={() => props.setMode(props.mode === 'move' ? null : 'move')}
            title="Move the ship at the open end of a route"
          >
            Move ship
            <span className="cost" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {v.rules.houseRules.freeShipMoves
                ? 'any number'
                : v.sea && v.sea.movesThisTurn
                  ? 'used'
                  : 'once a turn'}
            </span>
          </button>
        ) : null}
      </div>
      {ck ? (
        <>
          <div className="build">
            <button
              className={`btn bbtn${props.mode === 'knights' ? ' on' : ''}`}
              disabled={
                !main || !['activate', 'promote', 'moveKnight', 'chase'].some((t) => can(t as Action['type']))
              }
              data-testid="knights"
              onClick={() => props.setMode(props.mode === 'knights' ? null : 'knights')}
            >
              Knights
              <span className="cost" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                activate · promote · move
              </span>
            </button>
          </div>
          <ImproveRow v={v} acts={props.acts} busy={busy} onImprove={(_t, opts) => props.onImprove(opts)} />
          <ProgressRow
            v={v}
            acts={props.acts}
            busy={busy}
            onPlay={props.onPlayProgress}
            onDrop={(c) => void client.act({ type: 'dropProgress', card: c })}
          />
        </>
      ) : null}
      {devs.length ? (
        <div className="devrow">
          {devs.map((d) => (
            <div key={d.c} className={`devcard${d.c === 'vp' ? ' vp' : ''}`} title={DEV_HELP[d.c]}>
              <span>
                <span className="t">{DEV_LABEL[d.c]}</span>{' '}
                <span className="c">
                  ×{d.n + d.fresh}
                  {d.fresh ? ` (${d.fresh} new)` : ''}
                </span>
              </span>
              {d.c !== 'vp' ? (
                <button
                  className="btn small"
                  disabled={busy || !props.canPlay(d.c)}
                  onClick={() => props.play(d.c as DevPlayable)}
                  data-testid={`play-${d.c}`}
                >
                  Play
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChatForm() {
  const [text, setText] = useState('');
  return (
    <form
      className="chatform"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) client.chat(text.trim());
        setText('');
      }}
    >
      <input
        className="text"
        maxLength={240}
        placeholder="Say something to the table"
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn small" type="submit">
        Send
      </button>
    </form>
  );
}
