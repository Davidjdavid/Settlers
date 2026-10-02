/*
 * The game log and table talk (SPEC 8.10). It opens at the newest entry and follows new ones;
 * scrolled up, it stops following and offers "3 new ↓". Each turn starts with a divider: the
 * player in their colour and their roll. Names, cards and warnings are drawn in their colours,
 * always with words (and icons for cards), so colour is never the only signal. The log scrolls
 * inside itself only: it never moves the page.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isLogNote, type PlayerView, type Seat, type Track } from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { CARD_COLOR, PCOL, TRACK_LABEL, cardIcon } from './art';
import { cardTextColor, nameColor } from './logcolors';
import { itemKey } from './net';
import { eventLines, segText, type Line, type Seg } from './text';

type Row =
  | { k: 'turn'; key: string; p: Seat; dice?: [number, number]; ev?: 'ship' | Track }
  | { k: 'line'; key: string; line: Line }
  | { k: 'chat'; key: string; it: Extract<LogItem, { k: 'chat' }> }
  | { k: 'sys'; key: string; text: string };

/** The log's rows: lines for events, with each turn's roll folded into its divider. */
export function logRows(v: PlayerView, log: LogItem[]): Row[] {
  const rows: Row[] = [];
  let turn: Extract<Row, { k: 'turn' }> | null = null;
  const used = new Map<string, number>();
  for (const it of log) {
    // Keys stay the same as the log grows; two identical events in one move get a count.
    const base = itemKey(it);
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
    eventLines(v, e).forEach((line, i) => rows.push({ k: 'line', key: `${key}#${i}`, line }));
  }
  return rows;
}

/** A player's name in their colour, or in normal text with a dot in their colour. */
function Name({ v, p, text }: { v: PlayerView; p: Seat | null; text: string }) {
  const color = p == null ? undefined : v.players[p]?.color;
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

function Part({ v, s }: { v: PlayerView; s: Seg }) {
  if (typeof s === 'string') return <>{s}</>;
  if ('p' in s) return <Name v={v} p={s.p} text={segText(v, s)} />;
  if ('c' in s)
    return (
      <span className="cd" style={{ color: cardTextColor(s.c) }} data-card={s.c}>
        <i
          className="ci"
          style={{ background: CARD_COLOR[s.c] }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: cardIcon(s.c) }}
        />
        {segText(v, s)}
      </span>
    );
  if ('hidden' in s)
    return (
      <span className="cd hid">
        <i className="ci" aria-hidden="true" />
        {segText(v, s)}
      </span>
    );
  return <span className="warn">{s.warn}</span>;
}

const EV_TEXT = (f: 'ship' | Track) => (f === 'ship' ? 'barbarian ship' : `${TRACK_LABEL[f]} gate`);

function TurnRow({ v, r }: { v: PlayerView; r: Extract<Row, { k: 'turn' }> }) {
  const sum = r.dice ? r.dice[0] + r.dice[1] : 0;
  return (
    <div className="sep" data-turn={r.p}>
      <span>
        <Name v={v} p={r.p} text={v.players[r.p]?.nick ?? 'Someone'} />
        {r.dice ? (
          <>
            {' · rolled '}
            {r.dice[0]} + {r.dice[1]} = {sum === 7 ? <span className="warn">7</span> : <b>{sum}</b>}
            {r.ev ? <span className={r.ev === 'ship' ? 'warn' : undefined}> · {EV_TEXT(r.ev)}</span> : null}
          </>
        ) : null}
      </span>
    </div>
  );
}

export function Log({ v, log }: { v: PlayerView; log: LogItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => logRows(v, log), [v, log]);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  // Rows already shown, so new ones can highlight (none on the first draw).
  const known = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (known.current) for (const r of rows) if (!known.current.has(r.key)) fresh.add(r.key);

  useLayoutEffect(() => {
    const el = box.current;
    const prev = known.current;
    known.current = new Set(rows.map((r) => r.key));
    // Counted by key: the log keeps its newest 800 items, so its length can stay the same.
    const added = prev ? rows.filter((r) => !prev.has(r.key)).length : 0;
    if (!el) return;
    if (follow) el.scrollTop = el.scrollHeight;
    else if (added) setUnseen((n) => n + added);
  }, [rows]);

  const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const bottom = atBottom(el);
    if (bottom !== follow) setFollow(bottom);
    if (bottom && unseen) setUnseen(0);
  };
  const jump = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollow(true);
    setUnseen(0);
  };

  return (
    <div className="logwrap">
      <div className="log" ref={box} data-testid="log" onScroll={onScroll} role="log" aria-live="polite">
        {rows.map((r) => {
          const f = fresh.has(r.key) ? ' fresh' : '';
          if (r.k === 'turn') return <TurnRow key={r.key} v={v} r={r} />;
          if (r.k === 'sys')
            return (
              <div key={r.key} className={`e big${f}`}>
                {r.text}
              </div>
            );
          if (r.k === 'chat') {
            const seat = v.players.findIndex((p) => p.pid === r.it.pid);
            return (
              <div
                key={r.key}
                className={`e chat${r.it.cpu ? ' cpu' : ''}${f}`}
                data-cpu={r.it.cpu ? 1 : undefined}
              >
                <Name v={v} p={seat >= 0 ? seat : null} text={r.it.nick} />
                {r.it.cpu ? <span className="cputag">CPU</span> : null}: {r.it.text}
              </div>
            );
          }
          const l = r.line;
          return (
            <div key={r.key} className={`e${l.big ? ' big' : ''}${l.bad ? ' bad' : ''}${f}`}>
              {l.parts.map((s, i) => (
                <Part key={i} v={v} s={s} />
              ))}
            </div>
          );
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
