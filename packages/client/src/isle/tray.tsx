/* Your tray (docs/isle.md 4): you, your cards, your progress cards and your improvements. */

import type { Color, Track } from '@settlers/engine';
import { Avatar, faceFor } from './avatar';
import { CardTile, Levels, Star, pc } from './hud';

export const RES_NAMES: [string, string][] = [
  ['wood', 'Wood'],
  ['brick', 'Brick'],
  ['sheep', 'Wool'],
  ['wheat', 'Grain'],
  ['ore', 'Ore'],
];
export const COM_NAMES: [string, string][] = [
  ['paper', 'Paper'],
  ['cloth', 'Cloth'],
  ['coin', 'Coin'],
];

const TRACK_OF: Record<string, Track> = {
  alchemist: 'science',
  inventor: 'science',
  crane: 'science',
  engineer: 'science',
  irrigation: 'science',
  medicine: 'science',
  mining: 'science',
  printer: 'science',
  roadBuilding: 'science',
  smith: 'science',
  bishop: 'politics',
  constitution: 'politics',
  deserter: 'politics',
  diplomat: 'politics',
  intrigue: 'politics',
  saboteur: 'politics',
  spy: 'politics',
  warlord: 'politics',
  wedding: 'politics',
  commercialHarbor: 'trade',
  masterMerchant: 'trade',
  merchant: 'trade',
  merchantFleet: 'trade',
  resourceMonopoly: 'trade',
  tradeMonopoly: 'trade',
};
export const PROGRESS_NAME: Record<string, string> = {
  merchantFleet: 'Merchant Fleet',
  smith: 'Smith',
  irrigation: 'Irrigation',
  intrigue: 'Intrigue',
  wedding: 'Wedding',
  mining: 'Mining',
  alchemist: 'Alchemist',
};
const TRACK_C: Record<Track, [string, string]> = {
  science: ['#5fd06c', '#2f8f3c'],
  trade: ['#ffd04a', '#c99400'],
  politics: ['#6aa6ff', '#2d63c9'],
};

/** A progress card standing up in your tray: its colour, a picture and its name. */
export function ProgressCard({ c, playable }: { c: string; playable?: boolean }) {
  const t = TRACK_OF[c] ?? 'science';
  const [bg, deep] = TRACK_C[t];
  return (
    <div
      className={`iprog${playable ? ' ready' : ''}`}
      style={{ ['--bg' as string]: bg, ['--deep' as string]: deep }}
      data-card={c}
    >
      <span className="iprog-art">
        <svg viewBox="-20 -20 40 40" aria-hidden="true">
          {t === 'trade' ? (
            <g>
              <path
                d="M-14 6H14L9 14H-9Z"
                fill="#a8693f"
                stroke="#262a40"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M0 6V-14L12 4H0" fill="#fff" stroke="#262a40" strokeWidth="2" strokeLinejoin="round" />
              <path
                d="M-2 6V-10L-12 4H-2"
                fill="#ffe7a8"
                stroke="#262a40"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </g>
          ) : t === 'politics' ? (
            <path
              d="M-12 8V-6L-5 1 0-10 5 1 12-6V8Z"
              fill="#ffd23f"
              stroke="#262a40"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
          ) : (
            <g>
              <path
                d="M-4-12H4M-3-12V-3L-10 10H10L3-3V-12"
                fill="#e9fff0"
                stroke="#262a40"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <path d="M-7 5H7L10 10H-10Z" fill="#5fd06c" />
            </g>
          )}
        </svg>
      </span>
      <span className="iprog-name">{PROGRESS_NAME[c] ?? c}</span>
    </div>
  );
}

export interface TrayData {
  nick: string;
  color: Color;
  vp: number;
  win: number;
  res: Record<string, number>;
  /** Cards just gained, by kind (they bounce and show +n). */
  fresh?: Record<string, number>;
  progress: string[];
  lvl?: Record<Track, number>;
}

export function Tray({ d, turn }: { d: TrayData; turn: boolean }) {
  return (
    <div className={`itray${turn ? ' turn' : ''}`} style={pc(d.color)}>
      <div className="itray-me">
        <Avatar face={faceFor(d.nick)} color={d.color} size={92} />
        <div className="itray-star">
          <Star size={62} />
          <b>{d.vp}</b>
        </div>
        <span className="itray-of">of {d.win}</span>
      </div>
      <div className="itray-cards">
        {RES_NAMES.map(([k, l]) => (
          <CardTile key={k} k={k} n={d.res[k] ?? 0} label={l} fresh={d.fresh?.[k]} />
        ))}
        <span className="itray-gap" />
        {COM_NAMES.map(([k, l]) => (
          <CardTile key={k} k={k} n={d.res[k] ?? 0} label={l} fresh={d.fresh?.[k]} />
        ))}
      </div>
      {d.progress.length ? (
        <div className="itray-prog">
          {d.progress.map((c, i) => (
            <ProgressCard key={i} c={c} playable={i === 0} />
          ))}
        </div>
      ) : null}
      {d.lvl ? (
        <div className="itray-lv">
          <Levels lvl={d.lvl} />
          <span className="itray-lvl-l">Improve</span>
        </div>
      ) : null}
    </div>
  );
}
