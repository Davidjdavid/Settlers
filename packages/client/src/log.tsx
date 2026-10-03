/*
 * The game log and table talk (SPEC 8.10). It opens at the newest entry and follows new ones;
 * scrolled up, it stops following and offers "3 new ↓". Each turn starts with a divider: the
 * player in their colour and their roll. Names, cards and warnings are drawn in their colours,
 * always with words (and icons for cards), so colour is never the only signal. The log scrolls
 * inside itself only: it never moves the page.
 *
 * It's drawn on every update in every browser, so it's kept cheap: each entry's lines are worked
 * out once, rows that haven't changed aren't drawn again, and only the newest rows are on the
 * page until you ask for earlier ones. While you're scrolled up, rows stop leaving the top.
 */

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  isLogNote,
  type GameEvent,
  type LogNote,
  type PlayerView,
  type Seat,
  type Track,
} from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { CARD_COLOR, PCOL, cardIcon } from './art';
import { cardTextColor, nameColor } from './logcolors';
import { itemKey } from './net';
import { EVENT_WORD, eventLines, segText, type EventDieText, type Line, type Seg, type Who } from './text';

type Row =
  | { k: 'turn'; key: string; p: Seat; dice?: [number, number]; ev?: 'ship' | Track }
  | { k: 'line'; key: string; line: Line }
  | { k: 'chat'; key: string; it: Extract<LogItem, { k: 'chat' }> }
  | { k: 'sys'; key: string; text: string };

/** Each log item's key, worked out once (items are kept as the log grows). */
const KEYS = new WeakMap<LogItem, string>();

/** Rows shown at first; "Show earlier" adds this many more each time. */
export const LOG_PAGE = 150;

/**
 * The log's rows: lines for events, with each turn's roll folded into its divider. `lines`
 * gives an event's lines (cached by the log, so each is worked out once).
 */
export function logRows(
  log: LogItem[],
  lines: (key: string, e: GameEvent | LogNote) => Extract<Row, { k: 'line' }>[],
): Row[] {
  const rows: Row[] = [];
  let turn: Extract<Row, { k: 'turn' }> | null = null;
  const used = new Map<string, number>();
  for (const it of log) {
    // Keys stay the same as the log grows; two identical events in one move get a count.
    let base = KEYS.get(it);
    if (base === undefined) KEYS.set(it, (base = itemKey(it)));
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    const key = n ? `${base}~${n}` : base;
    if (it.k === 'chat') {
      rows.push({ k: 'chat', key, it });
      continue;
    }
    if (it.k === 'sys') {
      rows.push({ k: 'sys', key, text: it.text });
      continue;
    }
    const e = it.e;
    if (!isLogNote(e)) {
      if (e.k === 'turn') {
        turn = { k: 'turn', key, p: e.p };
        rows.push(turn);
        continue;
      }
      if (e.k === 'roll' && !e.redo && turn && turn.p === e.p && !turn.dice) {
        turn.dice = e.d;
        continue;
      }
      if (e.k === 'eventDie' && turn?.dice && !turn.ev) {
        turn.ev = e.face;
        continue;
      }
    }
    rows.push(...lines(key, e));
  }
  return rows;
}

/** A player's name in their colour, or in normal text with a dot in their colour. */
function Name({ who, p, text }: { who: Who; p: Seat | null; text: string }) {
  const color = p == null ? undefined : who.players[p]?.color;
  if (!color) return <b className="nm">{text}</b>;
  const ink = nameColor(color);
  return ink ? (
    <b className="nm" style={{ color: ink }} data-p={p}>
      {text}
    </b>
  ) : (
    <b className="nm" data-p={p}>
      <i className="pdot" style={{ background: PCOL[color] }} aria-hidden="true" />
      {text}
    </b>
  );
}

function Part({ who, s }: { who: Who; s: Seg }) {
  if (typeof s === 'string') return <>{s}</>;
  if ('p' in s) return <Name who={who} p={s.p} text={segText(who, s)} />;
  if ('c' in s)
    return (
      <span className="cd" style={{ color: cardTextColor(s.c) }} data-card={s.c}>
        <i
          className="ci"
          style={{ background: CARD_COLOR[s.c] }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: cardIcon(s.c) }}
        />
        {segText(who, s)}
      </span>
    );
  if ('hidden' in s)
    return (
      <span className="cd hid">
        <i className="ci" aria-hidden="true" />
        {segText(who, s)}
      </span>
    );
  return <span className="warn">{s.warn}</span>;
}

const TurnRow = memo(function TurnRow({
  who,
  p,
  dice,
  ev,
  mode,
}: {
  who: Who;
  p: Seat;
  dice?: [number, number] | undefined;
  ev?: 'ship' | Track | undefined;
  mode?: EventDieText | undefined;
}) {
  const sum = dice ? dice[0] + dice[1] : 0;
  // The event die's colour beside the total ("9 blue"), before it ("blue 9"), or left out.
  const word = ev && mode !== 'off' ? EVENT_WORD[ev] : null;
  const wordEl = word ? (
    <span className={ev === 'ship' ? 'warn' : 'evword'} data-ev={ev}>
      {word}
    </span>
  ) : null;
  const total = sum === 7 ? <span className="warn">7</span> : <b>{sum}</b>;
  return (
    <div className="sep" data-turn={p}>
      <span>
        <Name who={who} p={p} text={who.players[p]?.nick ?? 'Someone'} />
        {dice ? (
          <>
            {' · rolled '}
            {dice[0]} + {dice[1]} ={' '}
            {mode === 'before' && wordEl ? (
              <>
                {wordEl} {total}
              </>
            ) : (
              <>
                {total}
                {wordEl ? <> {wordEl}</> : null}
              </>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
});

const LineRow = memo(function LineRow({ who, line, fresh }: { who: Who; line: Line; fresh: boolean }) {
  return (
    <div className={`e${line.big ? ' big' : ''}${line.bad ? ' bad' : ''}${fresh ? ' fresh' : ''}`}>
      {line.parts.map((s, i) => (
        <Part key={i} who={who} s={s} />
      ))}
    </div>
  );
});

const ChatRow = memo(function ChatRow({
  who,
  it,
  fresh,
}: {
  who: Who;
  it: Extract<LogItem, { k: 'chat' }>;
  fresh: boolean;
}) {
  const seat = who.players.findIndex((p) => p.pid === it.pid);
  return (
    <div
      className={`e chat${it.cpu ? ' cpu' : ''}${fresh ? ' fresh' : ''}`}
      data-cpu={it.cpu ? 1 : undefined}
    >
      <Name who={who} p={seat >= 0 ? seat : null} text={it.nick} />
      {it.cpu ? <span className="cputag">CPU</span> : null}: {it.text}
    </div>
  );
});

const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 24;

export function Log({
  v,
  log,
  dieText,
}: {
  v: PlayerView;
  log: LogItem[];
  dieText?: EventDieText | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Who's who changes rarely (a rename, a new seat); the rows only need that, not the whole view.
  const whoKey = JSON.stringify([v.me, v.players.map((p) => [p.pid, p.nick, p.color])]);
  const who = useMemo<Who>(
    () => ({ me: v.me, players: v.players.map((p) => ({ pid: p.pid, nick: p.nick, color: p.color })) }),
    [whoKey],
  );
  // Each entry's lines, worked out once (again only when who's who changes).
  const cache = useRef<{ who: Who; rows: Map<string, Extract<Row, { k: 'line' }>[]> } | null>(null);
  if (cache.current?.who !== who) cache.current = { who, rows: new Map() };
  const rows = useMemo(
    () =>
      logRows(log, (key, e) => {
        const c = cache.current!.rows;
        let r = c.get(key);
        if (!r) {
          r = eventLines(v, e).map((line, i) => ({ k: 'line' as const, key: `${key}#${i}`, line }));
          c.set(key, r);
        }
        return r;
      }),
    [log, who],
  );
  const [show, setShow] = useState(LOG_PAGE);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  // Rows already shown, so new ones can highlight (none on the first draw).
  const known = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (known.current) for (const r of rows) if (!known.current.has(r.key)) fresh.add(r.key);
  // The newest row on the page after the last update, and (while the reader is scrolled up) the
  // first: the window then keeps its start, so nothing moves under someone reading.
  const lastRow = useRef<Element | null>(null);
  const firstKey = useRef<string | null>(null);

  // The first row drawn last time: while the reader is scrolled up, the window keeps it.
  const drawnFirst = useRef<string | null>(null);
  let start = Math.max(0, rows.length - show);
  // Scrolled up, read from the page itself: the scroll event may not have arrived before new rows
  // did, and dropping a row off the top then would move what's being read.
  const reading = box.current ? !atBottom(box.current) : false;
  const keep = firstKey.current ?? (reading ? drawnFirst.current : null);
  if (keep) {
    const i = rows.findIndex((r) => r.key === keep);
    if (i >= 0) start = Math.min(start, i);
  }
  const shown = rows.slice(start);

  useLayoutEffect(() => {
    const el = box.current;
    const prev = known.current;
    known.current = new Set(rows.map((r) => r.key));
    // Counted by key: the log keeps its newest 800 items, so its length can stay the same.
    const added = prev ? rows.filter((r) => !prev.has(r.key)).length : 0;
    if (!el) return;
    // Following means the reader could see the newest row before these came in. Read from the
    // page itself (a scroll the browser hasn't reported yet still counts), and from that row,
    // not the log's height: rows leaving the top move everything up.
    const was = lastRow.current;
    const wasAtBottom =
      !prev ||
      !was?.isConnected ||
      was.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 24;
    if (wasAtBottom) {
      el.scrollTop = el.scrollHeight;
      firstKey.current = null;
      if (!follow) setFollow(true);
      if (unseen) setUnseen(0);
    } else {
      firstKey.current ??= shown[0]?.key ?? null;
      if (follow) setFollow(false);
      if (added) setUnseen((n) => n + added);
    }
    lastRow.current = el.lastElementChild;
    drawnFirst.current = shown[0]?.key ?? null;
  }, [rows]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const bottom = atBottom(el);
    if (bottom) firstKey.current = null;
    else firstKey.current ??= shown[0]?.key ?? null;
    if (bottom !== follow) setFollow(bottom);
    if (bottom && unseen) setUnseen(0);
  };
  const jump = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    firstKey.current = null;
    setFollow(true);
    setUnseen(0);
  };
  const earlier = () => {
    // Earlier rows go above; the reader stays where they are, so the window keeps this start.
    const from = Math.max(0, start - LOG_PAGE);
    firstKey.current = rows[from]?.key ?? null;
    setShow(rows.length - from);
  };

  return (
    <div className="logwrap">
      <div className="log" ref={box} data-testid="log" onScroll={onScroll} role="log" aria-live="polite">
        {start > 0 ? (
          <button
            type="button"
            className="btn small ghost logmore"
            data-testid="log-earlier"
            onClick={earlier}
          >
            Show earlier entries
          </button>
        ) : null}
        {shown.map((r) => {
          const f = fresh.has(r.key);
          if (r.k === 'turn')
            return <TurnRow key={r.key} who={who} p={r.p} dice={r.dice} ev={r.ev} mode={dieText} />;
          if (r.k === 'sys')
            return (
              <div key={r.key} className={`e big${f ? ' fresh' : ''}`}>
                {r.text}
              </div>
            );
          if (r.k === 'chat') return <ChatRow key={r.key} who={who} it={r.it} fresh={f} />;
          return <LineRow key={r.key} who={who} line={r.line} fresh={f} />;
        })}
      </div>
      {!follow && unseen > 0 ? (
        <button type="button" className="lognew" onClick={jump} data-testid="log-new">
          {unseen} new ↓
        </button>
      ) : null}
    </div>
  );
}
