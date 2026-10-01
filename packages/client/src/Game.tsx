/* The game table: board, prompt, hand and actions, players, log. */

import { useEffect, useRef, useState } from 'react';
import {
  COMS, COST, DEV_PLAY, KNIGHT_COST, SHIP_COST, WALL_COST, goldDue, has, legalActions, RES, stateFromView,
  type Action, type DevPlayable, type PlayerView, type Progress, type Seat,
} from '@settlers/engine'; // prettier-ignore
import type { LogItem, RoomInfo } from '@settlers/server/protocol';
import {
  BRAND_SVG, CARD_COLOR, CARD_LABEL, DEV_HELP, DEV_LABEL, PCOL, PROGRESS_HELP, PROGRESS_LABEL, RES_LABEL, TILE_COLOR, TRACK_COLOR,
  TRACK_LABEL, cardIcon,
} from './art'; // prettier-ignore
import { Board, NO_TARGETS, type Ghost, type Targets } from './Board';
import { settingOn } from './help';
import { AskSheet, RulesSheet, SettingsSheet } from './settings';
import { Dice } from './anim';
import { client, getStored, type Status } from './net';
import {
  Chips, ConfirmTwice, DiscardSheet, GoldSheet, MenuSheet, MonoSheet, PieceSheet, PlentySheet, TradeSheet,
  VictimSheet,
} from './Sheets'; // prettier-ignore
import { eventText, listNames, nameOf, routeName } from './text';
import {
  BOARD_OWES, BarbarianBox, CardParamSheet, EventDie, ImproveRow, KnightSheet, OweSheet, PlayerCK, ProgressRow,
  myOwe, owePrompt, paramOf,
} from './ck'; // prettier-ignore

type Play = Extract<Action, { type: 'progress' }>;
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
type SheetState =
  | null
  | { k: 'trade' }
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
  | { k: 'rules' };

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
}: {
  v: PlayerView;
  room: RoomInfo;
  log: LogItem[];
  status: Status;
  pending: number;
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
        if (kind === 'vs')
          targets = {
            ...NO_TARGETS,
            verts: uniq(open.flatMap((a) => a.vs!.filter((x) => !card.picks.includes(x)))),
          };
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
    if (kind === 'vs') {
      const full = card.plays.find((p) => p.vs!.length === 2 && picks.every((y) => p.vs!.includes(y)));
      if (picks.length === 2 && full) return place(full, touch, done);
      return setCard({ ...card, picks });
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
  const playProgress = (c: Progress, plays: Play[]) => {
    const kind = paramOf(plays);
    if (kind === 'none')
      return ask(
        'confirmCard',
        { title: `Play ${PROGRESS_LABEL[c]}?`, sub: PROGRESS_HELP[c], yes: 'Play it' },
        () => void client.act(plays[0]!),
      );
    if (kind === 'to' || kind === 'r' || kind === 'd') return setSheet({ k: 'cardParam', card: c, plays });
    setCard({ card: c, plays, picks: [] });
    setMode('card');
  };
  const improve = (opts: Action[]) => {
    if (opts.length === 1) return void client.act(opts[0]!);
    setMetroOpts(opts);
    setMode('metro');
  };
  const play = (c: DevPlayable) => {
    const now = (a: Action) =>
      ask(
        'confirmCard',
        { title: `Play ${DEV_LABEL[c]}?`, sub: DEV_HELP[c], yes: 'Play it' },
        () => void client.act(a),
      );
    if (c === 'knight') now({ type: 'playKnight' });
    if (c === 'road') now({ type: 'playRoads' });
    if (c === 'plenty') setSheet({ k: 'plenty' });
    if (c === 'mono') setSheet({ k: 'mono' });
  };

  const endTurn = () =>
    ask(
      'confirmEnd',
      {
        title: 'End your turn?',
        sub: v.rules.houseRules.handBack
          ? 'If you end too soon, you can ask for the dice back until the next player does anything.'
          : undefined,
        yes: 'End turn',
      },
      () => void client.act({ type: 'end' }),
    );

  /* ---------- Prompt ---------- */
  const cur = nameOf(v, v.turn);
  const sum = v.dice ? v.dice[0] + v.dice[1] : 0;
  let pm: {
    title: string;
    sub: string;
    mine?: boolean;
    buttons?: { label: string; on: () => void; primary?: boolean; testid?: string }[];
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
            {
              label: 'Roll dice',
              on: () => void client.act({ type: 'roll' }),
              primary: true,
              testid: 'roll',
            },
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
    const buttons: { label: string; on: () => void; primary?: boolean; testid?: string }[] = [];
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
    const smithOne =
      mode === 'card' && card?.card === 'smith' && card.picks.length === 1
        ? card.plays.find((a) => a.vs!.length === 1 && a.vs![0] === card.picks[0])
        : undefined;
    pm = mode
      ? {
          title: (cardText ?? MODE_TEXT[mode])[0],
          sub: (cardText ?? MODE_TEXT[mode])[1],
          mine: true,
          buttons: [
            ...(smithOne
              ? [
                  {
                    label: 'Promote just this one',
                    on: () => doAct(smithOne, () => setMode(null)),
                    primary: true,
                  },
                ]
              : []),
            { label: 'Cancel', on: () => setMode(null) },
          ],
        }
      : {
          title: `You rolled ${sum}`,
          sub: 'Build, trade, or play a card. End your turn when you’re done.',
          mine: true,
          buttons: [
            { label: 'Trade', on: () => setSheet({ k: 'trade' }), testid: 'trade' },
            { label: 'End turn', on: endTurn, primary: true, testid: 'end' },
          ],
        };
  } else {
    // CPU players never trade with people (docs/bot.md), so don't offer.
    const tradable = me != null && !v.players[v.turn]!.cpu;
    pm = {
      title: `${cur}’s turn`,
      sub: tradable ? `${cur} rolled ${sum}. You can offer them a trade.` : `${cur} rolled ${sum}.`,
      buttons: tradable ? [{ label: 'Offer a trade', on: () => setSheet({ k: 'trade' }) }] : [],
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
        <div className="spacer" />
        <span
          className={`sync ${status === 'live' ? (busy ? 'busy' : 'live') : status === 'offline' ? 'off' : 'busy'}`}
          title={status}
          data-testid="sync"
        />
        <Dice dice={v.dice} />
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
                <span>You asked to end this game. Everyone has been warned.</span>
                <span className="acts">
                  <button className="btn small danger" onClick={() => client.resetConfirm()}>
                    Yes, end the game
                  </button>
                  <button className="btn small" onClick={() => client.resetCancel()}>
                    Never mind
                  </button>
                </span>
              </>
            ) : (
              <>
                <span>{pr.nick} wants to end this game and start a new one.</span>
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
              {disconnected.length ? ' Left the game? Enter the same name to get your seat back.' : ''}
            </span>
            {disconnected.length ? <RejoinForm /> : null}
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
            pending={placing?.ghosts}
          />
          {v.phase === 'over' && !hideOver ? (
            <div className="overlay">
              <GameOver v={v} onHide={() => setHideOver(true)} />
            </div>
          ) : null}
        </div>
        <div className={`prompt${pm.mine ? ' mine' : ''}`} aria-live="polite" data-testid="prompt">
          <div className="msg">
            <strong>{pm.title}</strong>
            {pm.sub ? <span>{pm.sub}</span> : null}
          </div>
          {pm.buttons?.length ? (
            <div className="acts">
              {pm.buttons.map((b) => (
                <button
                  key={b.label}
                  className={`btn${b.primary ? ' primary' : ''}`}
                  disabled={busy}
                  onClick={b.on}
                  data-testid={b.testid}
                >
                  {b.label}
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
          <span className="eyebrow">Players</span>
          <div className="players">
            {v.players.map((p, i) => (
              <div
                key={p.pid}
                className={`player${i === v.turn && v.phase === 'play' ? ' turn' : ''}${connected(i) ? '' : ' away'}`}
                data-seat={i}
              >
                <span className="pc">
                  <svg viewBox="-15 -15 30 30" aria-hidden="true">
                    <path d="M-10 9V-2L0-11 10-2V9Z" fill={PCOL[p.color]} stroke="#0b1418" strokeWidth="2" />
                  </svg>
                </span>
                <span className="nm">
                  <span>{p.nick}</span>
                  {i === me ? <span className="you">you</span> : null}
                  {p.cpu ? <span className="you">CPU</span> : null}
                  {v.discard?.[i] != null ? <span className="tag wait">discarding</span> : null}
                  <span
                    className={`online${connected(i) ? '' : ' away'}`}
                    title={connected(i) ? 'Connected' : 'Disconnected'}
                  />
                </span>
                <span className="vp">
                  {i === me && v.hand ? v.hand.totalVP : p.publicVP + (p.vpCards ?? 0)}
                  <small>VP</small>
                </span>
                <span className="stats">
                  <span>
                    <b data-testid={`cards-${i}`}>{p.resCount}</b> cards
                  </span>
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
            {RES.map((r) => (
              <span key={r} title={RES_LABEL[r]}>
                <i
                  style={{
                    display: 'inline-block',
                    width: 9,
                    height: 13,
                    borderRadius: 2,
                    background: TILE_COLOR[r],
                  }}
                />{' '}
                {v.bank[r]}
              </span>
            ))}
            {v.ck ? null : <span>Dev deck {v.deckCount}</span>}
          </div>
        </section>
        <section className="box" aria-label="Table talk">
          <span className="eyebrow">Table talk</span>
          <Log v={v} log={log} />
          <ChatForm />
        </section>
      </aside>

      {sheet?.k === 'trade' ? <TradeSheet v={v} onClose={() => setSheet(null)} /> : null}
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
        />
      ) : null}
      {sheet?.k === 'settings' ? (
        <SettingsSheet mine={room.mySettings} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.k === 'rules' ? <RulesSheet v={v} onClose={() => setSheet(null)} /> : null}
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
function RejoinForm() {
  const [nick, setNick] = useState(() => getStored('settlers.nick') ?? '');
  return (
    <form
      className="acts"
      onSubmit={(e) => {
        e.preventDefault();
        if (nick.trim()) client.join(nick.trim(), 'red');
      }}
    >
      <input
        className="text rejoin-nick"
        value={nick}
        maxLength={18}
        placeholder="Your name"
        aria-label="Your name"
        data-testid="rejoin-nick"
        onChange={(e) => setNick(e.target.value)}
      />
      <button className="btn small primary" type="submit" data-testid="rejoin">
        Rejoin
      </button>
    </form>
  );
}

function GameOver({ v, onHide }: { v: PlayerView; onHide: () => void }) {
  const total = (i: number) => v.players[i]!.publicVP + (v.players[i]!.vpCards ?? 0);
  const order = v.players.map((_, i) => i).sort((a, b) => total(b) - total(a));
  return (
    <div className="card" role="dialog" aria-label="Game over" data-testid="game-over">
      <h2>{v.me === v.winner ? 'You win!' : `${nameOf(v, v.winner)} wins!`}</h2>
      <p className="lede">Final scores, hidden victory cards included.</p>
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
      <div className="row">
        {v.me != null ? (
          <button className="btn primary" onClick={() => client.resetRequest()}>
            New game, same players
          </button>
        ) : null}
        <button className="btn ghost" onClick={onHide}>
          Look at the board
        </button>
      </div>
    </div>
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
  const main = mine && v.stage === 'main' && !busy;
  const can = (t: Action['type']) => props.acts.some((a) => a.type === t);
  const builds = [
    { k: 'road' as const, label: 'Road', cost: COST.road, left: pieces.road },
    { k: 'settlement' as const, label: 'Settlement', cost: COST.settlement, left: pieces.settlement },
    { k: 'city' as const, label: 'City', cost: COST.city, left: pieces.city },
    ...(sea ? [{ k: 'ship' as const, label: 'Ship', cost: SHIP_COST, left: pieces.ship ?? 0 }] : []),
    ...(ck
      ? [
          { k: 'knight' as const, label: 'Knight', cost: KNIGHT_COST, left: can('knight') ? 1 : 0 },
          { k: 'wall' as const, label: 'City wall', cost: WALL_COST, left: can('wall') ? 1 : 0 },
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
          {Object.values(hand.res).reduce((a, b) => a + b, 0)} cards · {hand.totalVP} points
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
              {b.label}
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

function Log({ v, log }: { v: PlayerView; log: LogItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div className="log" ref={box} data-testid="log">
      {log.map((it, i) => {
        if (it.k === 'chat')
          return (
            <div key={`c${it.id}`} className="e chat">
              <b>{it.nick}:</b> {it.text}
            </div>
          );
        if (it.k === 'sys')
          return (
            <div key={`c${it.id}`} className="e big">
              {it.text}
            </div>
          );
        const t = eventText(v, it.e);
        if (!t) return null;
        if (t.sep)
          return (
            <div key={i} className="sep">
              {t.text}
            </div>
          );
        return (
          <div key={i} className={`e${t.big ? ' big' : ''}`}>
            {t.text}
          </div>
        );
      })}
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
