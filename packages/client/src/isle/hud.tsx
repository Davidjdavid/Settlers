/*
 * The Isle screen around the board (docs/isle.md 4): the other players' seats, your tray, the dice
 * dock with the last rolls, the action buttons and the barbarians.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { Color, Track } from '@settlers/engine';
import { Avatar, faceFor } from './avatar';
import { CARD_TINT, ICOL, OUTLINE, iconSVG } from './pieces';

/** A player's colours as CSS variables. */
export const pc = (c: Color): CSSProperties =>
  ({
    ['--pc' as string]: ICOL[c].fill,
    ['--pd' as string]: ICOL[c].dark,
    ['--pl' as string]: ICOL[c].light,
    ['--pi' as string]: ICOL[c].ink,
  }) as CSSProperties;

/* ---------- Small icons ---------- */

export const Star = ({ size = 56 }: { size?: number }) => (
  <svg className="istar" viewBox="-30 -30 60 60" width={size} height={size} aria-hidden="true">
    <path
      d="M0-26 7.6-9.2 26-7.8 12-4.4 16.4 21 0 11 -16.4 21 -12-4.4 -26-7.8 -7.6-9.2Z"
      transform="translate(0 2) scale(1.04)"
      fill="#c98a00"
      stroke={OUTLINE}
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M0-26 7.6-9.2 26-7.8 12-4.4 16.4 21 0 11 -16.4 21 -12-4.4 -26-7.8 -7.6-9.2Z"
      fill="#ffd23f"
      stroke={OUTLINE}
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path d="M-6-16 0-23 3-15Z" fill="#fff6c2" />
  </svg>
);

export const CardBack = () => (
  <svg viewBox="0 0 20 26" width="15" height="19" aria-hidden="true">
    <rect x="1.5" y="1.5" width="17" height="23" rx="3.5" fill="#5b7cf0" stroke={OUTLINE} strokeWidth="2" />
    <rect x="5" y="5" width="10" height="16" rx="2" fill="none" stroke="#c3d0ff" strokeWidth="1.6" />
  </svg>
);

export const Helmet = () => (
  <svg viewBox="-12 -12 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M-9 6V0Q-9-10 0-10Q9-10 9 0V6Z"
      fill="#c9ccd6"
      stroke={OUTLINE}
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M-5 0H5" stroke={OUTLINE} strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export const RoadIco = () => (
  <svg viewBox="-12 -12 24 24" width="18" height="18" aria-hidden="true">
    <rect
      x="-10"
      y="-3.5"
      width="20"
      height="7"
      rx="3.5"
      fill="#d9a066"
      stroke={OUTLINE}
      strokeWidth="2"
      transform="rotate(-25)"
    />
  </svg>
);

/* ---------- Seats ---------- */

export interface SeatData {
  seat: number;
  nick: string;
  color: Color;
  vp: number;
  cards: number;
  knights: number;
  road: number;
  badges: string[];
  /** Knights levels: Science, Trade, Politics. */
  lvl?: Record<Track, number>;
  cpu?: string;
  away?: boolean;
}

export function Seat({
  d,
  pos,
  turn,
  doing,
  win,
  bubble,
  gain,
}: {
  d: SeatData;
  pos: string;
  turn: boolean;
  /** What they're doing, on their turn ("Rolling…"). */
  doing?: string;
  win: number;
  /** A chat message or reaction over the seat. */
  bubble?: ReactNode;
  /** Cards they just got ("+1"). */
  gain?: ReactNode;
}) {
  return (
    <div className={`iseat pos-${pos}${turn ? ' turn' : ''}`} style={pc(d.color)} data-seat={d.seat}>
      {turn ? <div className="iseat-tag">{doing ?? 'Their turn'}</div> : null}
      <div className="iseat-av">
        <Avatar face={faceFor(d.nick)} color={d.color} size={76} />
      </div>
      <div className="iseat-plate">
        <div className="iseat-name">{d.nick}</div>
        <div className="iseat-stats">
          <span className="ist" title={`${d.cards} cards in hand`}>
            <CardBack />
            <b>{d.cards}</b>
          </span>
          <span className="ist" title={`Knights: strength ${d.knights}`}>
            <Helmet />
            <b>{d.knights}</b>
          </span>
          <span className="ist" title={`Longest road: ${d.road}`}>
            <RoadIco />
            <b>{d.road}</b>
          </span>
        </div>
        {d.lvl ? <Levels lvl={d.lvl} /> : null}
      </div>
      <div className="iseat-star" title={`${d.vp} of ${win} points`}>
        <Star size={58} />
        <b>{d.vp}</b>
      </div>
      {d.badges.length ? (
        <div className="iseat-badges">
          {d.badges.map((b) => (
            <span key={b} className="ibadge">
              {b}
            </span>
          ))}
        </div>
      ) : null}
      {bubble ? <div className="ibubble">{bubble}</div> : null}
      {gain ? <div className="igain">{gain}</div> : null}
    </div>
  );
}

const TRACK_C: Record<Track, string> = { science: '#3fb34f', trade: '#f2b81c', politics: '#3b82f6' };

/** Science, Trade and Politics levels as three little columns of pips. */
export function Levels({ lvl }: { lvl: Record<Track, number> }) {
  return (
    <div className="ilevels" aria-label="Science, Trade, Politics">
      {(['science', 'trade', 'politics'] as Track[]).map((t) => (
        <span key={t} className="ilv" style={{ ['--tc' as string]: TRACK_C[t] }} title={`${t} ${lvl[t]}`}>
          {Array.from({ length: 5 }, (_, i) => (
            <i key={i} className={i < lvl[t] ? 'on' : ''} />
          ))}
        </span>
      ))}
    </div>
  );
}

/* ---------- Cards ---------- */

export function CardTile({ k, n, label, fresh }: { k: string; n: number; label: string; fresh?: number }) {
  const t = CARD_TINT[k]!;
  return (
    <div
      className={`icard${n ? '' : ' none'}${fresh ? ' fresh' : ''}`}
      style={{ ['--bg' as string]: t.bg, ['--deep' as string]: t.deep }}
      title={`${n} ${label}`}
      data-card={k}
    >
      <span className="icard-face" dangerouslySetInnerHTML={{ __html: iconSVG(k) }} />
      <span className="icard-label">{label}</span>
      <b className="icard-n">{n}</b>
      {fresh ? <span className="icard-plus">+{fresh}</span> : null}
    </div>
  );
}

/* ---------- Dice ---------- */

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
}; // prettier-ignore

export function Die({ n, color, size = 44 }: { n: number; color: 'yellow' | 'red'; size?: number }) {
  const face = color === 'yellow' ? '#ffd23f' : '#ef4136';
  const side = color === 'yellow' ? '#d69e00' : '#a8231b';
  const pip = color === 'yellow' ? OUTLINE : '#ffffff';
  return (
    <svg
      className={`idie idie-${color}`}
      viewBox="-13 -13 26 27"
      width={size}
      height={size}
      aria-hidden="true"
      data-face={n}
    >
      <rect x="-11" y="-9" width="22" height="22" rx="6" fill={side} stroke={OUTLINE} strokeWidth="1.8" />
      <rect x="-11" y="-11" width="22" height="22" rx="6" fill={face} stroke={OUTLINE} strokeWidth="1.8" />
      <rect x="-8" y="-9" width="10" height="3" rx="1.5" fill="#ffffff" opacity=".45" />
      {(PIPS[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x * 5.2} cy={y * 5.2} r="2.3" fill={pip} />
      ))}
    </svg>
  );
}

export type EventFace = 'ship' | Track;
const EVENT_ICON: Record<EventFace, ReactNode> = {
  ship: (
    <path
      d="M-7 1H7L4 6H-4Z M-1 1V-8L5-2H-1"
      fill="#3a3348"
      stroke={OUTLINE}
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  science: (
    <path
      d="M-3-8H3M-2-8V-2L-6 6H6L2-2V-8"
      fill="#ffffff"
      stroke={OUTLINE}
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
  trade: <circle r="6" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.6" />,
  politics: (
    <path
      d="M-7 5V-4L-3 0 0-6 3 0 7-4V5Z"
      fill="#ffffff"
      stroke={OUTLINE}
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
};
export const EVENT_WORD: Record<EventFace, string> = {
  ship: 'ship',
  science: 'green',
  trade: 'yellow',
  politics: 'blue',
};

export function EventDie({ face, size = 44 }: { face: EventFace; size?: number }) {
  const bg = face === 'ship' ? '#f1ece2' : TRACK_C[face];
  return (
    <svg
      className="idie idie-event"
      viewBox="-13 -13 26 27"
      width={size}
      height={size}
      aria-hidden="true"
      data-face={face}
    >
      <rect
        x="-11"
        y="-9"
        width="22"
        height="22"
        rx="6"
        fill="#00000040"
        stroke={OUTLINE}
        strokeWidth="1.8"
      />
      <rect x="-11" y="-11" width="22" height="22" rx="6" fill={bg} stroke={OUTLINE} strokeWidth="1.8" />
      <g transform="translate(0 1)">{EVENT_ICON[face]}</g>
    </svg>
  );
}

export interface RollData {
  p: number;
  nick: string;
  color: Color;
  d: [number, number];
  e?: EventFace;
}

/** The last rolls, newest first: the newest with its dice, the rest as numbered chips. */
export function LastRolls({ rolls }: { rolls: RollData[] }) {
  const [head, ...rest] = rolls;
  if (!head) return null;
  const sum = (r: RollData) => r.d[0] + r.d[1];
  return (
    <div className="irolls" aria-label="Last rolls">
      <div className="irolls-head" style={pc(head.color)}>
        <span className="irolls-who">
          <Avatar face={faceFor(head.nick)} color={head.color} size={30} />
          {head.nick}
        </span>
        <span className="irolls-dice">
          <Die n={head.d[0]} color="yellow" size={34} />
          <Die n={head.d[1]} color="red" size={34} />
          {head.e ? <EventDie face={head.e} size={34} /> : null}
        </span>
        <b className={`irolls-sum${sum(head) === 7 ? ' seven' : ''}`}>{sum(head)}</b>
      </div>
      <div className="irolls-rest">
        {rest.map((r, i) => (
          <span
            key={i}
            className={`irchip${sum(r) === 7 ? ' seven' : ''}`}
            style={pc(r.color)}
            title={`${r.nick} rolled ${sum(r)}`}
          >
            <i>{r.nick === 'You' ? 'You' : r.nick[0]}</i>
            <b>{sum(r)}</b>
            {r.e && r.e !== 'ship' ? <em style={{ background: TRACK_C[r.e] }} /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Buttons ---------- */

const ICONS: Record<string, ReactNode> = {
  roll: (
    <g>
      <rect
        x="-15"
        y="-12"
        width="18"
        height="18"
        rx="5"
        fill="#fff"
        stroke={OUTLINE}
        strokeWidth="2.4"
        transform="rotate(-14 -6 -3)"
      />
      <rect
        x="-1"
        y="-5"
        width="18"
        height="18"
        rx="5"
        fill="#ef4136"
        stroke={OUTLINE}
        strokeWidth="2.4"
        transform="rotate(12 8 4)"
      />
      <circle cx="-9" cy="-6" r="1.9" fill={OUTLINE} />
      <circle cx="-3" cy="1" r="1.9" fill={OUTLINE} />
      <circle cx="5" cy="1" r="1.9" fill="#fff" />
      <circle cx="11" cy="7" r="1.9" fill="#fff" />
      <circle cx="8" cy="4" r="1.9" fill="#fff" />
    </g>
  ),
  end: (
    <path
      d="M-12 0H8M1-8 10 0 1 8"
      fill="none"
      stroke={OUTLINE}
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  build: (
    <g>
      <rect
        x="-3"
        y="-4"
        width="6"
        height="20"
        rx="2.5"
        fill="#c48a52"
        stroke={OUTLINE}
        strokeWidth="2.2"
        transform="rotate(35)"
      />
      <path
        d="M-14-6 4-15 9-10 -9-1Z"
        fill="#9aa3b5"
        stroke={OUTLINE}
        strokeWidth="2.2"
        strokeLinejoin="round"
        transform="rotate(10)"
      />
    </g>
  ),
  trade: (
    <g fill="none" stroke={OUTLINE} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-11-4H9M3-10 9-4 3 2" />
      <path d="M11 6H-9M-3 0-9 6-3 12" />
    </g>
  ),
  cards: (
    <g>
      <rect
        x="-12"
        y="-11"
        width="15"
        height="21"
        rx="3"
        fill="#ffe17a"
        stroke={OUTLINE}
        strokeWidth="2.2"
        transform="rotate(-12)"
      />
      <rect
        x="-3"
        y="-10"
        width="15"
        height="21"
        rx="3"
        fill="#86b4ff"
        stroke={OUTLINE}
        strokeWidth="2.2"
        transform="rotate(10)"
      />
    </g>
  ),
  menu: <path d="M-9-6H9M-9 0H9M-9 6H9" stroke={OUTLINE} strokeWidth="3" strokeLinecap="round" />,
  log: (
    <g>
      <path
        d="M-10-8Q-10-11-6-11H8Q10-11 10-8V5Q10 8 7 8H-2L-8 12V8Q-10 8-10 5Z"
        fill="#fff"
        stroke={OUTLINE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M-5-4H5M-5 1H2" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
};

export function BigButton({
  kind,
  label,
  main,
  waiting,
  badge,
  off,
}: {
  kind: string;
  label: string;
  main?: boolean;
  /** Bobs gently: it's what the game waits for. */
  waiting?: boolean;
  badge?: number;
  off?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ibtn${main ? ' main' : ''}${waiting ? ' waiting' : ''}${off ? ' off' : ''}`}
      data-kind={kind}
      aria-label={label}
    >
      <span className="ibtn-disc">
        <svg viewBox="-20 -20 40 40" aria-hidden="true">
          {ICONS[kind]}
        </svg>
        {badge ? <b className="ibtn-badge">{badge}</b> : null}
      </span>
      <span className="ibtn-label">{label}</span>
    </button>
  );
}

export function RoundButton({ kind, label }: { kind: string; label: string }) {
  return (
    <button type="button" className="iround" aria-label={label} title={label}>
      <svg viewBox="-20 -20 40 40" aria-hidden="true">
        {ICONS[kind]}
      </svg>
    </button>
  );
}

/* ---------- Barbarians ---------- */

export function Barbarians({ at, strength, defense }: { at: number; strength: number; defense: number }) {
  const left = 7 - at;
  return (
    <div className={`ibarb${left <= 2 ? ' near' : ''}`} aria-label={`Barbarians: ${left} to go`}>
      <svg viewBox="0 0 230 44" width="230" height="44" aria-hidden="true">
        <path
          d="M14 30Q60 8 110 26T206 22"
          fill="none"
          stroke="#bfe6ff"
          strokeWidth="4"
          strokeDasharray="1 11"
          strokeLinecap="round"
        />
        {Array.from({ length: 7 }, (_, i) => {
          const x = 14 + i * 29;
          const y = 30 - Math.sin((i / 6) * Math.PI) * 10;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i < at ? 4 : 5.5}
              fill={i < at ? '#7aa7c7' : '#ffffff'}
              stroke={OUTLINE}
              strokeWidth="2"
            />
          );
        })}
        <g
          transform={`translate(${14 + Math.min(at, 6) * 29} ${30 - Math.sin((Math.min(at, 6) / 6) * Math.PI) * 10 - 10})`}
        >
          <path
            d="M-13 4H13L8 12H-8Z"
            fill="#4a3b5c"
            stroke={OUTLINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M0 4V-14L11 0H0" fill="#f6efe0" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
          <path d="M-1-14V4" stroke={OUTLINE} strokeWidth="2" />
          <path
            d="M-1-12H-10L-1-6"
            fill="#ef4136"
            stroke={OUTLINE}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(214 18)">
          <path
            d="M-10 14V-4H-6V-8H-2V-4H2V-8H6V-4H10V14Z"
            fill="#f2e6cf"
            stroke={OUTLINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <rect x="-3" y="5" width="6" height="9" rx="3" fill={OUTLINE} />
        </g>
      </svg>
      <div className="ibarb-txt">
        <b>{left}</b> to go
        <span className={`ibarb-vs${strength > defense ? ' bad' : ''}`}>
          <i>⚔ {strength}</i> vs <i>🛡 {defense}</i>
        </span>
      </div>
    </div>
  );
}
