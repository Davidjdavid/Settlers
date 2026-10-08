/*
 * The dice statistics pinned on screen (SPEC 9.5): the 2–12 chart (rolled against expected),
 * the last roll and the event die. It starts in the board's top-left corner (the top-right is for
 * the dice, 9.1); drag it to another corner, shrink it to a strip, or unpin it. Where it is and
 * how big is saved on your profile. On a phone it's a thin strip above the hand.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@settlers/engine';
import type { DiceInfo, PlayerSettings } from '@settlers/server/protocol';
import { TRACK_LABEL } from './art';
import { SIZES, currentSize } from './display';
import { client } from './net';

export type DicePinPref = NonNullable<PlayerSettings['dicePin']>;
type Corner = DicePinPref['corner'];

const ODDS = (t: number) => (6 - Math.abs(t - 7)) / 36;
const CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl'];

/** Save where the panel is (null unpins it). */
export function savePin(pin: DicePinPref | null) {
  const { dicePin: _, ...rest } = client.state.room?.mySettings ?? {};
  client.saveSettings(pin ? { ...rest, dicePin: pin } : rest);
}

/** The page's width in layout pixels (the display size zooms the page), kept up to date. */
export function useLayoutWidth(): number {
  const get = () => (typeof window === 'undefined' ? 1280 : window.innerWidth / SIZES[currentSize()]);
  const [w, setW] = useState(get);
  useEffect(() => {
    const on = () => setW(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * Bars for 2–12 with the expected count as a tick, small enough for a corner. Before the first
 * roll there's nothing to count: the expected shape shows faintly, with "No rolls yet" (an empty
 * box looked like the stats hadn't loaded).
 */
function MiniChart({ dice, h }: { dice: number[]; h: number }) {
  const n = dice.reduce((a, b) => a + b, 0);
  if (!n) return <EmptyChart h={h} />;
  const max = Math.max(1, ...dice.slice(2), ...[...Array(11)].map((_, i) => n * ODDS(i + 2)));
  const W = 176;
  const bw = W / 11;
  const label = h > 30;
  const base = label ? h - 11 : h;
  const y = (k: number) => base - (k / max) * (base - 2);
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="minichart" role="img" aria-label={`Dice totals, ${n} rolls`}>
      {[...Array(11)].map((_, i) => {
        const t = i + 2;
        const k = dice[t] ?? 0;
        const x = i * bw;
        return (
          <g key={t} data-total={t} data-n={k}>
            <title>{`${t}: rolled ${k}, expected ${(n * ODDS(t)).toFixed(1)}`}</title>
            {k ? <rect x={x + 2} y={y(k)} width={bw - 4} height={base - y(k)} rx={2} fill="#7fb8c2" /> : null}
            <line
              x1={x + 1}
              x2={x + bw - 1}
              y1={y(n * ODDS(t))}
              y2={y(n * ODDS(t))}
              stroke="var(--ink)"
              strokeWidth={1.5}
            />
            {label ? (
              <text x={x + bw / 2} y={h - 1} textAnchor="middle" fontSize="9" fill="var(--ink-2)">
                {t}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function EmptyChart({ h }: { h: number }) {
  const W = 176;
  const bw = W / 11;
  const label = h > 30;
  const base = label ? h - 11 : h;
  return (
    <svg
      viewBox={`0 0 ${W} ${h}`}
      className="minichart"
      role="img"
      aria-label="Dice totals, no rolls yet"
      data-empty
    >
      {[...Array(11)].map((_, i) => {
        const t = i + 2;
        const top = base - (ODDS(t) / ODDS(7)) * (base - 2);
        return (
          <g key={t} data-total={t} data-n={0}>
            <rect
              x={i * bw + 2}
              y={top}
              width={bw - 4}
              height={base - top}
              rx={2}
              fill="var(--ink-3)"
              opacity={0.18}
            />
            {label ? (
              <text x={i * bw + bw / 2} y={h - 1} textAnchor="middle" fontSize="9" fill="var(--ink-2)">
                {t}
              </text>
            ) : null}
          </g>
        );
      })}
      <text
        x={W / 2}
        y={label ? base / 2 + 4 : h / 2 + 4}
        textAnchor="middle"
        fontSize="11"
        fill="var(--ink-2)"
        data-testid="dice-pin-none"
      >
        No rolls yet
      </text>
    </svg>
  );
}

export function DicePin({
  v,
  dice,
  pin,
  phone,
}: {
  v: PlayerView;
  dice: DiceInfo | null;
  pin: DicePinPref;
  /** A phone: a thin strip above the hand, not on the board. */
  phone?: boolean;
}) {
  const small = phone || !!pin.small;
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const sum = v.dice ? v.dice[0] + v.dice[1] : 0;
  const ev = v.ck?.event;
  const faces = dice?.events ?? {};

  // Drag by the title bar; let go nearest the corner you want.
  const down = (e: React.PointerEvent) => {
    if (phone || (e.target as Element).closest('button')) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (drag?.id === e.pointerId) setDrag({ ...drag, dx: e.clientX - drag.x, dy: e.clientY - drag.y });
  };
  const up = (e: React.PointerEvent) => {
    if (drag?.id !== e.pointerId) return;
    const el = box.current;
    const area = el?.parentElement?.getBoundingClientRect();
    setDrag(null);
    if (!el || !area) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const corner =
      `${cy < area.top + area.height / 2 ? 't' : 'b'}${cx < area.left + area.width / 2 ? 'l' : 'r'}` as Corner;
    if (corner !== pin.corner) savePin({ ...pin, corner });
  };

  return (
    <div
      ref={box}
      className={`dicepin ${phone ? 'phone' : pin.corner}${small ? ' small' : ''}${drag ? ' dragging' : ''}`}
      data-testid="dice-pin"
      data-corner={phone ? 'phone' : pin.corner}
      style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
    >
      <div className="pinbar" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className="t">Dice</span>
        <span className="last" data-testid="dice-pin-last">
          {v.dice ? (
            <>
              {v.dice[0]} + {v.dice[1]} = <b className={sum === 7 ? 'warn' : undefined}>{sum}</b>
            </>
          ) : (
            'no roll yet'
          )}
          {ev ? (
            <span className={ev === 'ship' ? 'warn' : undefined}>
              {' '}
              · {ev === 'ship' ? 'ship' : TRACK_LABEL[ev]}
            </span>
          ) : null}
        </span>
        {phone ? null : (
          <>
            <button
              type="button"
              className="pinbtn"
              aria-label="Move to the next corner"
              title="Move to the next corner (or drag it)"
              data-testid="dice-pin-move"
              onClick={() => savePin({ ...pin, corner: CORNERS[(CORNERS.indexOf(pin.corner) + 1) % 4]! })}
            >
              ⤧
            </button>
            <button
              type="button"
              className="pinbtn"
              aria-label={pin.small ? 'Show the full chart' : 'Shrink to a strip'}
              data-testid="dice-pin-size"
              onClick={() => savePin(pin.small ? { corner: pin.corner } : { ...pin, small: true })}
            >
              {pin.small ? '▢' : '▁'}
            </button>
          </>
        )}
        <button
          type="button"
          className="pinbtn"
          aria-label="Unpin the dice"
          data-testid="dice-pin-off"
          onClick={() => savePin(null)}
        >
          ×
        </button>
      </div>
      <MiniChart dice={dice?.dice ?? []} h={small ? 22 : 64} />
      {!small && v.ck ? (
        <div className="faces" data-testid="dice-pin-faces">
          Ship {faces.ship ?? 0} · Science {faces.science ?? 0} · Trade {faces.trade ?? 0} · Politics{' '}
          {faces.politics ?? 0}
        </div>
      ) : null}
    </div>
  );
}
