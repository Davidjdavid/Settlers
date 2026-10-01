/* The game table: board, prompt, hand and actions, players, log. */

import { useEffect, useRef, useState } from 'react';
import {
  COMS, COST, DEV_PLAY, KNIGHT_COST, SHIP_COST, WALL_COST, goldDue, has, legalActions, RES, stateFromView,
  type Action, type DevPlayable, type PlayerView, type Progress, type Seat,
} from '@settlers/engine'; // prettier-ignore
import type { LogItem, RoomInfo } from '@settlers/server/protocol';
import {
  BRAND_SVG, CARD_COLOR, CARD_LABEL, DEV_HELP, DEV_LABEL, PCOL, PROGRESS_LABEL, RES_LABEL, TILE_COLOR, TRACK_COLOR,
  TRACK_LABEL, cardIcon,
} from './art'; // prettier-ignore
import { Board, NO_TARGETS, type Targets } from './Board';
import { Dice } from './anim';
import { client, type Status } from './net';
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
  | { k: 'claim'; seat: number; nick: string };

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
  const me = v.me;
  const mine = me != null && v.turn === me && v.phase === 'play';
  const s = stateFromView(v);
  const busy = pending > 0;

  // Drop UI modes that no longer apply after the state changes.
  useEffect(() => {
    if (!mine || v.stage !== 'main') setMode(null);
    if (!mine || v.stage !== 'setup') setSel(null);
    setMoveFrom(null);
  }, [mine, v.stage, v.seq]);
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
  /** Play a progress card once its targets are picked (or show which picks remain). */
  const cardPick = (x: number) => {
    if (!card) return;
    const kind = paramOf(card.plays);
    const picks = [...card.picks, x];
    const done = () => setMode(null);
    if (kind === 'v') return doAct({ type: 'progress', card: card.card, v: x }, done);
    if (kind === 'h') return doAct({ type: 'progress', card: card.card, h: x }, done);
    if (kind === 'e') return doAct({ type: 'progress', card: card.card, e: x }, done);
    if (kind === 'hh') {
      if (picks.length < 2) return setCard({ ...card, picks });
      const a = card.plays.find(
        (p) => (p.h === picks[0] && p.h2 === picks[1]) || (p.h === picks[1] && p.h2 === picks[0]),
      );
      if (a) doAct(a, done);
      return;
    }
    if (kind === 'vs') {
      const full = card.plays.find((p) => p.vs!.length === 2 && picks.every((y) => p.vs!.includes(y)));
      if (picks.length === 2 && full) return doAct(full, done);
      return setCard({ ...card, picks });
    }
  };
  const onVert = (x: number) => {
    if (owe && BOARD_OWES.has(owe.k)) return doAct({ type: 'choose', v: x });
    if (!mine) return;
    if (v.stage === 'setup') setSel(x);
    else if (mode === 'settlement') doAct({ type: 'settlement', v: x }, () => setMode(null));
    else if (mode === 'city') doAct({ type: 'city', v: x }, () => setMode(null));
    else if (mode === 'knight') doAct({ type: 'knight', v: x }, () => setMode(null));
    else if (mode === 'wall') doAct({ type: 'wall', v: x }, () => setMode(null));
    else if (mode === 'metro') {
      const a = metroOpts.find((m) => m.type === 'improve' && m.v === x);
      if (a) doAct(a, () => setMode(null));
    } else if (mode === 'knights') setSheet({ k: 'knightAct', at: x });
    else if (mode === 'kmove' && kFrom != null)
      doAct({ type: 'moveKnight', from: kFrom, to: x }, () => setMode(null));
    else if (mode === 'card') cardPick(x);
  };
  const onEdge = (e: number) => {
    if (owe && BOARD_OWES.has(owe.k)) return doAct({ type: 'choose', e });
    if (mode === 'card') return cardPick(e);
    if (!mine) return;
    if (mode === 'move' && moveFrom == null) return setMoveFrom(e);
    const options = edgeActs(e);
    const done = () => {
      setSel(null);
      if (v.stage === 'main') setMode(null);
    };
    if (options.length === 1) doAct(options[0]!, done);
    else if (options.length > 1) setSheet({ k: 'piece', options });
  };
  const onHex = (h: number) => {
    if (mine && mode === 'card') return cardPick(h);
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
      else if (here[0]) doAct(here[0], () => setMode(null));
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
    else if (here[0]) doAct(here[0]);
  };

  const canPlay = (c: DevPlayable) =>
    acts.some(
      (a) =>
        a.type === { knight: 'playKnight', road: 'playRoads', plenty: 'playPlenty', mono: 'playMono' }[c],
    );
  /** Start playing a progress card: at once, in a sheet, or by picking on the board. */
  const playProgress = (c: Progress, plays: Play[]) => {
    const kind = paramOf(plays);
    if (kind === 'none') return void client.act(plays[0]!);
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
    if (c === 'knight') void client.act({ type: 'playKnight' });
    if (c === 'road') void client.act({ type: 'playRoads' });
    if (c === 'plenty') setSheet({ k: 'plenty' });
    if (c === 'mono') setSheet({ k: 'mono' });
  };

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
            { label: 'End turn', on: () => void client.act({ type: 'end' }), primary: true, testid: 'end' },
          ],
        };
  } else {
    pm = {
      title: `${cur}’s turn`,
      sub: me != null ? `${cur} rolled ${sum}. You can offer them a trade.` : `${cur} rolled ${sum}.`,
      buttons: me != null ? [{ label: 'Offer a trade', on: () => setSheet({ k: 'trade' }) }] : [],
    };
  }

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
        {me == null && v.phase === 'play' ? (
          <div className="banner">
            <span>
              You’re watching.{disconnected.length ? ' Lost your seat? Take over a disconnected one:' : ''}
            </span>
            <span className="acts">
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
        <Offers v={v} busy={busy} />
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
        />
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

function Offers({ v, busy }: { v: PlayerView; busy: boolean }) {
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
                          onClick={() => void client.act({ type: 'confirm', id: o.id, with: w })}
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
                    onClick={() => void client.act({ type: 'respond', id: o.id, yes: true })}
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
