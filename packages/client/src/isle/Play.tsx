/*
 * The new game screen (docs/isle.md 14, 15), for laptops and monitors: the race to the target and
 * the awards across the top, the seats in turn order down the left, the board in the middle, the
 * last rolls and what happened since your turn on the right, and your hand along the bottom with
 * the one big button. It lays out the same parts as the standard screen (the board, the prompt's
 * buttons, the sheets, the log), so every move goes through exactly the same code.
 */

import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './play.css';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  isLogNote,
  stateFromView,
  type Cards,
  type Color,
  type GameEvent,
  type PlayerView,
  type Seat,
} from '@settlers/engine';
import type { DiceInfo, LogItem, RoomInfo } from '@settlers/server/protocol';
import {
  CARD_COLOR,
  CARD_LABEL,
  PCOL,
  PEDGE,
  PROGRESS_LABEL,
  TRACK_COLOR,
  TRACK_LABEL,
  TRACK_ORDER,
  dieSVG,
  eventDieSVG,
} from '../art';
import { BarbarianChip } from '../ck';
import { RollDice } from '../dice';
import { handRisk } from '../handrisk';
import { RULE_HELP, settingOn } from '../help';
import { MusicButton } from '../music';
import { client, type Status } from '../net';
import { EVENT_WORD, RULE_LABEL, nameOf, routeName } from '../text';
import {
  andList,
  awards,
  cardsLine,
  didOf,
  lastRolls,
  race,
  recapSince,
  rollNews,
  type Award,
  type Roll,
  type RollNews,
  type TurnRecap,
  momentsIn,
  type MomentData,
} from './story';

/** A button the prompt offers (the standard screen's prompt buttons, unchanged). */
export interface PromptButton {
  label: string;
  on: () => void;
  primary?: boolean;
  testid?: string;
  off?: string;
  badge?: number;
  warn?: string;
  kind?: 'trade' | 'bank' | 'card';
}

export interface IsleProps {
  v: PlayerView;
  room: RoomInfo;
  log: LogItem[];
  status: Status;
  busy: boolean;
  dice: DiceInfo | null;
  /** The board with its overlays, the banners, the sheets, the offers, the log with table talk. */
  board: ReactNode;
  banners: ReactNode;
  sheets: ReactNode;
  offers: ReactNode;
  talk: ReactNode;
  /** What to do now, and its buttons. */
  pm: { title: string; sub: string; mine?: boolean; buttons?: PromptButton[] };
  canRoll: boolean;
  rollRef: React.MutableRefObject<(() => void) | null>;
  /** Cards a roll just gave you. */
  gains: { n: number; cards: Cards } | null;
  /** Your cards, what you can build, Science · Trade · Politics, and the cards you can play. */
  boxes: Record<'hand' | 'build' | 'improve' | 'play', ReactNode> | null;
  connected: (p: Seat) => boolean;
  cpuLevel: (p: Seat) => string | null;
  onMenu: () => void;
  onDice: () => void;
  onMusic: () => void;
}

/** A player's colour as CSS variables. */
const pc = (c: Color): CSSProperties =>
  ({ ['--pc' as string]: PCOL[c], ['--pe' as string]: PEDGE(c) }) as CSSProperties;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const initial = (nick: string) => (nick.trim()[0] ?? '?').toUpperCase();

/** A player's token: their colour and initial (never colour alone, docs/isle.md 12). */
function Token({ v, p, size = 30 }: { v: PlayerView; p: Seat; size?: number }) {
  const pl = v.players[p]!;
  return (
    <span className="ip-token" style={{ ...pc(pl.color), width: size, height: size, fontSize: size * 0.5 }}>
      {initial(pl.nick)}
    </span>
  );
}

/* ---------- Top: the race and the awards ---------- */

function RaceTrack({ v }: { v: PlayerView }) {
  const rs = race(v);
  const max = Math.max(v.winVP, ...rs.map((r) => r.pts));
  // Points just scored pop a "+n" over the token for a moment.
  const was = useRef<number[] | null>(null);
  const [pops, setPops] = useState<{ p: Seat; n: number; k: number }[]>([]);
  const key = rs.map((r) => r.pts).join(',');
  useEffect(() => {
    const prev = was.current;
    was.current = rs.map((r) => r.pts);
    if (!prev) return;
    const up = rs
      .filter((r) => r.pts > (prev[r.p] ?? r.pts))
      .map((r) => ({ p: r.p, n: r.pts - prev[r.p]!, k: Date.now() }));
    if (!up.length) return;
    setPops((x) => [...x, ...up]);
    // Each pop goes on its own, even when points change again before it's gone.
    window.setTimeout(() => setPops((x) => x.filter((y) => !up.includes(y))), 2200);
  }, [key]);
  const spaces = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <div className="ip-race" data-testid="race" aria-label={`Race to ${v.winVP} points`}>
      <div className="ip-track">
        {spaces.map((i) => (
          <span
            key={i}
            className={`ip-space${i >= v.winVP - 2 && i < v.winVP ? ' hot' : ''}${i === v.winVP ? ' goal' : ''}`}
            style={{ left: `${(i / max) * 100}%` }}
          >
            {i === v.winVP ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4 15V2M4 2.5h9l-2.5 3 2.5 3H4"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              i
            )}
          </span>
        ))}
        {rs.map((r) => {
          const same = rs.filter((x) => x.pts === r.pts);
          const k = same.indexOf(r);
          return (
            <span
              key={r.p}
              className={`ip-racer${r.lead ? ' lead' : ''}${r.p === v.me ? ' me' : ''}${r.p === v.turn && v.phase === 'play' ? ' turn' : ''}`}
              style={{
                left: `${(Math.min(r.pts, max) / max) * 100}%`,
                ['--k' as string]: k,
                ['--n' as string]: same.length,
              }}
              data-seat={r.p}
              data-pts={r.pts}
              data-testid={`racer-${r.p}`}
              title={`${nameOf(v, r.p)}: ${r.pts} of ${v.winVP} points${r.near && r.pts < v.winVP ? ` (${v.winVP - r.pts} from winning)` : ''}`}
            >
              {r.lead ? (
                <svg className="ip-crown" viewBox="0 0 20 12" aria-label="Leader">
                  <path
                    d="M1 11 2.5 2l5 5L10 0l2.5 7 5-5L19 11Z"
                    fill="#ffd23f"
                    stroke="#7a5200"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
              <Token v={v} p={r.p} size={28} />
              {pops
                .filter((x) => x.p === r.p)
                .map((x) => (
                  <b key={x.k} className="ip-plus">
                    +{x.n}
                  </b>
                ))}
            </span>
          );
        })}
      </div>
      <span className="ip-goal" data-testid="goal" title={`First to ${v.winVP} points wins`}>
        First to <b data-testid="win-target">{v.winVP}</b>
      </span>
    </div>
  );
}

const AWARD_ICON: Record<string, string> = {
  longest:
    '<rect x="3" y="12" width="26" height="8" rx="4" fill="#d9a066" stroke="#3b2a1a" stroke-width="2" transform="rotate(-18 16 16)"/>',
  largest:
    '<path d="M8 25 22 7M18 6l6 0 0 6M6 20l6 6M5 27l3-3" stroke="#3b2a1a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  gate: '<path d="M6 28V12a10 10 0 0 1 20 0v16h-5V13a5 5 0 0 0-10 0v15Z" fill="currentColor" stroke="#3b2a1a" stroke-width="2" stroke-linejoin="round"/>',
};

function awardText(v: PlayerView, a: Award): string {
  const lines = [`${a.label}: ${a.holder != null ? nameOf(v, a.holder) : 'nobody yet'}`];
  if (a.first) lines.push(`First: ${nameOf(v, a.first.p)}, turn ${a.first.turn}`);
  if (a.last && a.last.from != null)
    lines.push(
      a.last.to != null
        ? `${nameOf(v, a.last.to)} took it from ${nameOf(v, a.last.from)} on turn ${a.last.turn}`
        : `${nameOf(v, a.last.from)} lost it on turn ${a.last.turn}`,
    );
  return lines.join('\n');
}

function AwardShelf({ v, log }: { v: PlayerView; log: LogItem[] }) {
  const list = useMemo(() => awards(v, log), [v, log]);
  return (
    <div className="ip-awards" data-testid="awards">
      {list.map((a) => {
        // Changed hands this turn or the one before: "from" stays under it.
        const fresh = a.last != null && a.last.from != null && v.turnN - a.last.turn <= 1;
        const track = a.key !== 'longest' && a.key !== 'largest';
        return (
          <span
            key={a.key}
            className={`ip-award${a.holder != null ? ' held' : ''}${fresh ? ' fresh' : ''}`}
            title={awardText(v, a)}
            data-award={a.key}
            data-holder={a.holder ?? ''}
            style={track ? { color: TRACK_COLOR[a.key as 'trade'] } : undefined}
          >
            <svg
              viewBox="0 0 32 32"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: AWARD_ICON[track ? 'gate' : a.key]! }}
            />
            <span className="ip-award-txt">
              <small>
                {track
                  ? TRACK_LABEL[a.key as 'trade']
                  : a.key === 'longest'
                    ? routeName(v).replace(/^Longest /, '')
                    : 'Army'}
              </small>
              {a.holder != null ? (
                <b style={pc(v.players[a.holder]!.color)}>
                  <i />
                  {nameOf(v, a.holder)}
                </b>
              ) : (
                <b className="none">—</b>
              )}
              {fresh ? <em>from {nameOf(v, a.last!.from)}</em> : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ---------- Left: the seats ---------- */

const DOING: Record<string, string> = {
  setup: 'Placing',
  preroll: 'About to roll',
  discard: 'Discarding',
  robber: 'Moving the robber',
  roads: 'Building',
  main: 'Playing',
  gold: 'Choosing gold',
  ck: 'Choosing',
  treasure: 'Treasure',
};

function SeatCard({
  v,
  p,
  connected,
  level,
  bubble,
}: {
  v: PlayerView;
  p: Seat;
  connected: boolean;
  level: string | null;
  bubble: string | null;
}) {
  const pl = v.players[p]!;
  const r = race(v)[p]!;
  const s = stateFromView(v);
  const turn = p === v.turn && v.phase === 'play';
  const next =
    v.phase === 'play' && (v.turn + 1) % v.players.length === p && p === v.me && v.stage !== 'setup';
  const risk = handRisk(v, s, p, pl.resCount);
  const knights = v.ck ? v.ck.knights.filter((k) => k && k.p === p) : [];
  const strength = knights.reduce((a, k) => a + (k!.on ? k!.lvl : 0), 0);
  const metros = v.ck
    ? TRACK_ORDER.filter((t) => {
        const at = v.ck!.metro[t];
        return at != null && v.verts[at]?.[0] === p;
      })
    : [];
  return (
    <div
      className={`ip-seat${turn ? ' turn' : ''}${p === v.me ? ' me' : ''}${connected ? '' : ' away'}`}
      style={pc(pl.color)}
      data-seat={p}
      data-testid={`seat-${p}`}
    >
      {turn ? (
        <span className="ip-seat-tag" data-testid="seat-turn">
          {p === v.me ? 'Your turn' : DOING[v.stage]}
        </span>
      ) : next ? (
        <span className="ip-seat-tag next">You’re next</span>
      ) : null}
      <div className="ip-seat-head">
        <Token v={v} p={p} size={38} />
        <span className="ip-seat-name">
          <b>{pl.nick}</b>
          <small>
            {p === v.me ? 'you' : level ? `CPU · ${level}` : connected ? '' : 'away'}
            {v.discard?.[p] != null ? ' · discarding' : ''}
          </small>
        </span>
        <span className="ip-seat-pts" title={`${r.pts} of ${v.winVP} points`}>
          <b>{r.pts}</b>
          <small>/{v.winVP}</small>
        </span>
      </div>
      <div className="ip-seat-stats">
        <span
          className={`ip-stat cards${risk && !risk.calm ? ' over' : ''}`}
          title={risk?.text ?? `${pl.resCount} cards in hand`}
          data-testid={`cards-${p}`}
        >
          <svg viewBox="0 0 20 26" aria-hidden="true">
            <rect x="2" y="2" width="16" height="22" rx="3" />
          </svg>
          <b>{pl.resCount}</b>
        </span>
        {v.ck ? (
          <span className="ip-stat prog" title="Progress cards, by deck" data-testid={`progress-${p}`}>
            {TRACK_ORDER.map((t) => (
              <span
                key={t}
                className="ip-pcard"
                style={{ ['--c' as string]: TRACK_COLOR[t] }}
                data-pcol={t}
                title={`${TRACK_LABEL[t]}: ${v.ck!.colors[p]![t]}`}
              >
                <b>{v.ck!.colors[p]![t]}</b>
              </span>
            ))}
          </span>
        ) : (
          <span className="ip-stat dev" title={`${pl.devCount} development cards`}>
            <svg viewBox="0 0 20 26" aria-hidden="true">
              <rect x="2" y="2" width="16" height="22" rx="3" />
              <path d="M10 8v10M5 13h10" />
            </svg>
            <b>{pl.devCount}</b>
          </span>
        )}
        <span
          className="ip-stat"
          title={
            v.ck
              ? `Active knight strength ${strength}, ${knights.length} knights`
              : `${pl.knights} knights played`
          }
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 20V12Q5 4 12 4Q19 4 19 12V20Z" />
            <path d="M8 12h8" stroke="#fff" strokeWidth="2" />
          </svg>
          <b>{v.ck ? strength : pl.knights}</b>
        </span>
        <span className="ip-stat" title={`Longest road: ${pl.roadLen}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="9" width="20" height="6" rx="3" transform="rotate(-20 12 12)" />
          </svg>
          <b>{pl.roadLen}</b>
        </span>
      </div>
      {v.ck ? (
        <div className="ip-seat-lvls" title="Science · Trade · Politics">
          {TRACK_ORDER.map((t) => (
            <span
              key={t}
              className={`ip-lvl${metros.includes(t) ? ' metro' : ''}`}
              style={{ ['--c' as string]: TRACK_COLOR[t] }}
            >
              {Array.from({ length: 5 }, (_, i) => (
                <i key={i} className={i < v.ck!.lvl[p]![t] ? 'on' : ''} />
              ))}
              {metros.includes(t) ? (
                <svg
                  viewBox="0 0 32 32"
                  aria-label={`${TRACK_LABEL[t]} metropolis`}
                  dangerouslySetInnerHTML={{ __html: AWARD_ICON.gate! }}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {v.longest === p || v.largest === p ? (
        <div className="ip-seat-badges">
          {v.longest === p ? <span>{routeName(v)}</span> : null}
          {v.largest === p ? <span>Largest Army</span> : null}
        </div>
      ) : null}
      {bubble ? (
        <div className="ip-bubble" key={bubble} data-testid={`bubble-${p}`}>
          {bubble}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Right: the last rolls and the recap ---------- */

function DiceFaces({ r, size }: { r: Roll; size: number }) {
  return (
    <span
      className="ip-dice"
      style={{ ['--ds' as string]: `${size}px` }}
      dangerouslySetInnerHTML={{
        __html: dieSVG(r.d[0], 'yellow') + dieSVG(r.d[1], 'red') + (r.e ? eventDieSVG(r.e) : ''),
      }}
    />
  );
}

function LastRolls({ v, log }: { v: PlayerView; log: LogItem[] }) {
  const rolls = useMemo(() => lastRolls(log, 5), [log]);
  return (
    <section className="ip-card ip-rolls" data-testid="last-rolls" aria-label="Last rolls">
      <h3>Last rolls</h3>
      {rolls.length ? (
        <ol>
          {rolls.map((r, i) => {
            const sum = r.d[0] + r.d[1];
            return (
              <li
                key={r.seq}
                className={i === 0 ? 'first' : ''}
                style={pc(v.players[r.p]!.color)}
                data-sum={sum}
                data-seat={r.p}
                title={`${nameOf(v, r.p)} rolled ${r.d[0]} + ${r.d[1]} = ${sum}${r.e ? ` (${EVENT_WORD[r.e]})` : ''}`}
              >
                <Token v={v} p={r.p} size={i === 0 ? 30 : 22} />
                {i === 0 ? <DiceFaces r={r} size={30} /> : null}
                <b className={`ip-sum${sum === 7 ? ' seven' : sum === 6 || sum === 8 ? ' hot' : ''}`}>
                  {sum}
                </b>
                {i > 0 && r.e ? <i className={`ip-ev ev-${r.e}`} title={EVENT_WORD[r.e]} /> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="ip-none">No rolls yet.</p>
      )}
    </section>
  );
}

function RecapLine({ v, t }: { v: PlayerView; t: TurnRecap }) {
  const sum = t.roll ? t.roll.d[0] + t.roll.d[1] : null;
  const got = cardsLine(t.got);
  const lost = cardsLine(t.lost);
  return (
    <li style={pc(v.players[t.p]!.color)} data-seat={t.p}>
      <Token v={v} p={t.p} size={26} />
      <div>
        <b className="who">{nameOf(v, t.p)}</b>
        {sum != null ? (
          <span
            className={`ip-sum small${sum === 7 ? ' seven' : ''}`}
            title={t.roll!.e ? EVENT_WORD[t.roll!.e] : undefined}
          >
            {sum}
          </span>
        ) : null}
        {got ? <span className="ip-got">You got {got}</span> : null}
        {lost ? <span className="ip-lost">You lost {lost}</span> : null}
        <span className="ip-did">
          {t.did.length ? andList(t.did) : sum != null ? 'nothing else' : 'nothing yet'}
        </span>
        {t.news.map((n) => (
          <span key={n} className="ip-news">
            {n}
          </span>
        ))}
      </div>
    </li>
  );
}

function Recap({
  v,
  log,
  open,
  setOpen,
}: {
  v: PlayerView;
  log: LogItem[];
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  const list = useMemo(() => recapSince(log, v), [log, v]);
  if (v.me == null || !list.length) return null;
  const mineNow = v.turn === v.me && v.phase === 'play';
  return (
    <section className={`ip-card ip-recap${open ? ' open' : ''}${mineNow ? ' now' : ''}`} data-testid="recap">
      <button type="button" className="ip-recap-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3>Since your last turn</h3>
        <small>{list.length === 1 ? '1 turn' : `${list.length} turns`}</small>
        <span className="chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <>
          <ol>
            {list.map((t, i) => (
              <RecapLine key={i} v={v} t={t} />
            ))}
          </ol>
          <button type="button" className="ip-gotit" onClick={() => setOpen(false)} data-testid="recap-close">
            Got it
          </button>
        </>
      ) : null}
    </section>
  );
}

/* ---------- Middle: the roll, the moments, your turn ---------- */

function RollShow({ v, news }: { v: PlayerView; news: RollNews }) {
  const pl = v.players[news.p]!;
  const seven = news.sum === 7;
  return (
    <div
      className={`ip-rollshow${seven ? ' seven' : ''}`}
      style={pc(pl.color)}
      data-testid="roll-show"
      data-sum={news.sum}
      aria-live="polite"
    >
      <div className="ip-rollshow-who">
        <Token v={v} p={news.p} size={34} />
        <span>
          {nameOf(v, news.p)} rolled{news.redo ? ' again' : ''}
        </span>
      </div>
      <div className="ip-rollshow-dice">
        <DiceFaces r={news} size={64} />
        <b className="ip-rollshow-sum">{news.sum}</b>
      </div>
      {news.e ? (
        <div
          className="ip-rollshow-ev"
          style={news.e !== 'ship' ? { color: TRACK_COLOR[news.e] } : undefined}
        >
          {news.e === 'ship'
            ? 'The barbarians sail closer'
            : `${EVENT_WORD[news.e]} gate: ${TRACK_LABEL[news.e]} cards`}
        </div>
      ) : null}
      {seven ? <div className="ip-rollshow-seven">The robber’s coming!</div> : null}
      <div className="ip-rollshow-got">
        {news.got.length ? (
          news.got.map((g) => (
            <span
              key={g.p}
              className={`ip-gotchip${g.p === v.me ? ' me' : ''}`}
              style={pc(v.players[g.p]!.color)}
            >
              <i />
              {nameOf(v, g.p)}
              {Object.entries(g.cards).map(([k, n]) => (
                <em key={k} style={{ ['--c' as string]: CARD_COLOR[k as keyof typeof CARD_COLOR] }}>
                  +{n} {CARD_LABEL[k as keyof typeof CARD_LABEL]}
                </em>
              ))}
              {g.gold ? <em className="gold">+{g.gold} gold to pick</em> : null}
            </span>
          ))
        ) : seven ? null : (
          <span className="ip-gotchip none">Nobody got anything</span>
        )}
      </div>
    </div>
  );
}

interface Moment extends MomentData {
  key: number;
}

/* ---------- The screen ---------- */

export function IslePlay(props: IsleProps) {
  const { v, room, log, busy, pm } = props;
  const me = v.me;
  const mine = me != null && v.turn === me && v.phase === 'play';
  const cur = v.players[v.turn]!;
  const my = room.mySettings;

  // The roll just made, for 2½ seconds (clicks go through).
  const [show, setShow] = useState<{ news: RollNews; k: number } | null>(null);
  // The big moments, one at a time.
  const [moments, setMoments] = useState<Moment[]>([]);
  // What each seat just did, for a few seconds.
  const [bubbles, setBubbles] = useState<Record<number, { text: string; k: number }>>({});
  useEffect(
    () =>
      client.onFresh(({ items, after }) => {
        if (!after) return;
        const news = rollNews(items, after);
        if (news) setShow({ news, k: Date.now() });
        const ms = momentsIn(after, items);
        if (ms.length)
          setMoments((x) => [...x, ...ms.map((m, i) => ({ ...m, key: Date.now() + i }))].slice(-6));
        const evs = items.flatMap((it) => (it.k === 'ev' && !isLogNote(it.e) ? [it.e] : []));
        const next: Record<number, { text: string; k: number }> = {};
        after.players.forEach((_, p) => {
          const did = didOf(after, p, evs);
          if (did.length) next[p] = { text: andList(did), k: Date.now() };
        });
        if (Object.keys(next).length) setBubbles((b) => ({ ...b, ...next }));
      }),
    [],
  );
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => setShow(null), reduced() ? 2000 : 2600);
    return () => window.clearTimeout(t);
  }, [show?.k]);
  useEffect(() => {
    if (!moments.length || show) return;
    const t = window.setTimeout(() => setMoments((x) => x.slice(1)), moments.length > 2 ? 1800 : 2800);
    return () => window.clearTimeout(t);
  }, [moments[0]?.key, !!show]);
  const bubbleKey = Object.values(bubbles)
    .map((b) => b.k)
    .join(',');
  useEffect(() => {
    if (!bubbleKey) return;
    const t = window.setTimeout(() => {
      const now = Date.now();
      setBubbles((b) => Object.fromEntries(Object.entries(b).filter(([, x]) => now - x.k < 4500)));
    }, 4600);
    return () => window.clearTimeout(t);
  }, [bubbleKey]);

  // Your turn: "Your turn!" across the middle, the recap opens; the tab's title says so.
  const myTurnKey = mine && v.stage !== 'setup' ? v.turnN : null;
  const [splash, setSplash] = useState(false);
  const [recapOpen, setRecapOpen] = useState(mine);
  const seenTurn = useRef<number | null>(myTurnKey);
  useEffect(() => {
    if (myTurnKey == null || seenTurn.current === myTurnKey) return;
    seenTurn.current = myTurnKey;
    setSplash(true);
    setRecapOpen(true);
    const t = window.setTimeout(() => setSplash(false), reduced() ? 1200 : 1700);
    return () => window.clearTimeout(t);
  }, [myTurnKey]);
  useEffect(() => {
    const base = 'Settlers';
    document.title = mine ? `● Your turn · ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [mine]);

  // The prompt's buttons: trading sits by your cards, the turn's main button is the big one, the
  // rest stay with what to do now, over the board.
  const buttons = pm.buttons ?? [];
  const trade = buttons.filter((b) => b.testid === 'trade' || b.testid === 'trade-bank');
  const big = buttons.find((b) => b.primary && b.testid !== 'confirm-place' && !trade.includes(b));
  const rest = buttons.filter((b) => !trade.includes(b) && b !== big);
  const btn = (b: PromptButton, cls = '') => (
    <button
      key={b.label}
      className={`ip-btn${b.primary ? ' primary' : ''}${cls}`}
      disabled={busy || b.off != null}
      title={b.off ?? b.warn}
      onClick={b.on}
      data-testid={b.testid}
    >
      {b.label}
      {b.warn ? (
        <span className="ip-warn" title={b.warn} data-testid={`${b.testid}-warn`} aria-label={b.warn}>
          ⚠
        </span>
      ) : null}
      {b.badge ? (
        <span className="ip-badge" data-testid={`${b.testid}-badge`}>
          {b.badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className={`isle-play${mine ? ' mine' : ''}`} style={pc(cur.color)} data-testid="isle-play">
      <div className="ip-frame" aria-hidden="true" />
      <header className="ip-top">
        <button type="button" className="ip-menu" onClick={props.onMenu} title="Room menu" aria-label="Menu">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span>
            <small>Room</small>
            {room.code}
          </span>
        </button>
        <RaceTrack v={v} />
        <AwardShelf v={v} log={log} />
        <div className="ip-tools">
          {v.ck ? <BarbarianChip v={v} /> : null}
          <span
            className={`sync ${props.status === 'live' ? (busy ? 'busy' : 'live') : props.status === 'offline' ? 'off' : 'busy'}`}
            title={props.status}
            data-testid="sync"
          />
          <MusicButton onOpen={props.onMusic} />
          {props.dice ? (
            <button type="button" className="ip-tool" onClick={props.onDice} data-testid="open-dice">
              Dice stats
            </button>
          ) : null}
        </div>
      </header>

      <aside className="ip-seats" aria-label="Players">
        {v.players.map((_, p) => (
          <SeatCard
            key={p}
            v={v}
            p={p}
            connected={props.connected(p)}
            level={props.cpuLevel(p)}
            bubble={bubbles[p]?.text ?? null}
          />
        ))}
      </aside>

      <main className="ip-main">
        <div className="ip-banners">{props.banners}</div>
        {props.board}
        <div className={`ip-prompt${pm.mine ? ' mine' : ''}`} data-testid="prompt" aria-live="polite">
          {props.gains ? (
            <div className="ip-gains" key={props.gains.n} data-testid="gain-flash">
              You got
              {Object.entries(props.gains.cards).map(([k, n]) => (
                <em key={k} style={{ ['--c' as string]: CARD_COLOR[k as keyof typeof CARD_COLOR] }}>
                  +{n} {CARD_LABEL[k as keyof typeof CARD_LABEL]}
                </em>
              ))}
            </div>
          ) : null}
          <div className="ip-prompt-text">
            <strong>{pm.title}</strong>
            {pm.sub ? <span>{pm.sub}</span> : null}
          </div>
          {rest.length ? <div className="ip-prompt-acts">{rest.map((b) => btn(b))}</div> : null}
        </div>
        {show ? <RollShow key={show.k} v={v} news={show.news} /> : null}
        {!show && moments[0] ? (
          <div
            className="ip-moment"
            key={moments[0].key}
            style={moments[0].seat != null ? pc(v.players[moments[0].seat]!.color) : undefined}
            data-testid="moment"
          >
            {moments[0].seat != null ? <Token v={v} p={moments[0].seat} size={34} /> : null}
            <span>
              <b>{moments[0].title}</b>
              {moments[0].detail ? <small>{moments[0].detail}</small> : null}
            </span>
          </div>
        ) : null}
        {splash ? (
          <div className="ip-splash" data-testid="your-turn" aria-live="assertive">
            Your turn!
          </div>
        ) : null}
      </main>

      <aside className="ip-side">
        <LastRolls v={v} log={log} />
        <Recap v={v} log={log} open={recapOpen} setOpen={setRecapOpen} />
        <section className="ip-card ip-talk">{props.talk}</section>
      </aside>

      <footer className="ip-tray" aria-label="Your hand">
        <div className="ip-offers">{props.offers}</div>
        {props.boxes ? (
          <>
            <div className="ip-hand">{props.boxes.hand}</div>
            {trade.length ? (
              <div className="ip-trade" aria-label="Trade">
                {trade.map((b) => btn(b, ` trade ${b.testid}`))}
              </div>
            ) : null}
            <div className="ip-build">{props.boxes.build}</div>
            {props.boxes.improve ? <div className="ip-improve">{props.boxes.improve}</div> : null}
            <div className="ip-cards">{props.boxes.play}</div>
          </>
        ) : (
          <div className="ip-watch">You’re watching.</div>
        )}
        <div className="ip-go">
          <RollDice
            dice={v.dice}
            {...(v.ck ? { event: v.ck.event } : {})}
            canRoll={props.canRoll}
            onRoll={() => client.act({ type: 'roll' })}
            sound={settingOn(my, 'gameSounds')}
            rollRef={props.rollRef}
          />
          {big ? (
            <button
              className={`ip-big${big.testid === 'end' ? ' end' : ''}`}
              disabled={busy || big.off != null}
              title={big.off ?? big.warn}
              onClick={big.on}
              data-testid={big.testid}
            >
              {big.label}
              {big.warn ? (
                <span
                  className="ip-warn"
                  title={big.warn}
                  data-testid={`${big.testid}-warn`}
                  aria-label={big.warn}
                >
                  ⚠
                </span>
              ) : null}
            </button>
          ) : (
            <div className="ip-waiting" style={pc(cur.color)} data-testid="waiting">
              {v.phase === 'over' ? (
                <b>{pm.title}</b>
              ) : (
                <>
                  <Token v={v} p={v.turn} size={30} />
                  <span>
                    <b>{mine ? 'Your turn' : `${cur.nick} is playing`}</b>
                    <small>{DOING[v.stage]}</small>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </footer>

      {props.sheets}
    </div>
  );
}
