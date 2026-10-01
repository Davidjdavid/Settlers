/* The game table: board, prompt, hand and actions, players, log. */

import { useEffect, useRef, useState } from 'react';
import {
  COST, DEV_PLAY, SHIP_COST, goldDue, has, legalActions, RES, stateFromView, type Action, type DevPlayable,
  type PlayerView, type Seat,
} from '@settlers/engine'; // prettier-ignore
import type { LogItem, RoomInfo } from '@settlers/server/protocol';
import { BRAND_SVG, DEV_HELP, DEV_LABEL, PCOL, RES_LABEL, TILE_COLOR, iconSVG } from './art';
import { Board, NO_TARGETS, type Targets } from './Board';
import { Dice } from './anim';
import { client, type Status } from './net';
import {
  Chips, ConfirmTwice, DiscardSheet, GoldSheet, MenuSheet, MonoSheet, PieceSheet, PlentySheet, TradeSheet,
  VictimSheet,
} from './Sheets'; // prettier-ignore
import { eventText, listNames, nameOf, routeName } from './text';

type Mode = null | 'road' | 'settlement' | 'city' | 'ship' | 'move';
type SheetState =
  | null
  | { k: 'trade' }
  | { k: 'discard' }
  | { k: 'plenty' }
  | { k: 'mono' }
  | { k: 'victim'; hex: number; victims: Seat[]; kind: 'robber' | 'pirate' }
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

  /* ---------- Board targets: whatever the engine says this seat can do ---------- */
  const acts = mine && !busy ? legalActions(s, me) : [];
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

  const doAct = (a: Action, after?: () => void) => void client.act(a).then((r) => r.ok && after?.());
  const onVert = (x: number) => {
    if (!mine) return;
    if (v.stage === 'setup') setSel(x);
    else if (mode === 'settlement') doAct({ type: 'settlement', v: x }, () => setMode(null));
    else if (mode === 'city') doAct({ type: 'city', v: x }, () => setMode(null));
  };
  const onEdge = (e: number) => {
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
  } else if (mine) {
    pm = mode
      ? {
          title: MODE_TEXT[mode][0],
          sub: MODE_TEXT[mode][1],
          mine: true,
          buttons: [{ label: 'Cancel', on: () => setMode(null) }],
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
          />
        ) : null}
      </section>

      <aside className="side">
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
                  <span>
                    <b>{p.devCount}</b> dev
                  </span>
                  <span>
                    <b>{p.knights}</b> knights
                  </span>
                  <span>
                    <b>{p.roadLen}</b> road
                  </span>
                </span>
                {v.longest === i || v.largest === i ? (
                  <span className="badges">
                    {v.longest === i ? <span className="badge">{routeName(v)}</span> : null}
                    {v.largest === i ? <span className="badge">Largest Army</span> : null}
                  </span>
                ) : null}
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
            <span>Dev deck {v.deckCount}</span>
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
          onClose={() => setSheet(null)}
        />
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
}) {
  const { v, mine, busy } = props;
  const sea = v.rules.modules.includes('seafarers');
  const me = v.me!;
  const hand = v.hand!;
  const pieces = v.players[me]!.pieces;
  const main = mine && v.stage === 'main' && !busy;
  const builds = [
    { k: 'road' as const, label: 'Road', cost: COST.road, left: pieces.road },
    { k: 'settlement' as const, label: 'Settlement', cost: COST.settlement, left: pieces.settlement },
    { k: 'city' as const, label: 'City', cost: COST.city, left: pieces.city },
    ...(sea ? [{ k: 'ship' as const, label: 'Ship', cost: SHIP_COST, left: pieces.ship ?? 0 }] : []),
    { k: 'dev' as const, label: 'Dev card', cost: COST.dev, left: v.deckCount },
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
        {RES.map((r) => (
          <div
            key={r}
            className={`rcard${hand.res[r] ? '' : ' zero'}`}
            style={{ ['--c' as string]: TILE_COLOR[r] }}
            title={RES_LABEL[r]}
            data-res={r}
            data-n={hand.res[r]}
          >
            <span dangerouslySetInnerHTML={{ __html: iconSVG(r) }} style={{ display: 'contents' }} />
            <span className="n">{hand.res[r]}</span>
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
