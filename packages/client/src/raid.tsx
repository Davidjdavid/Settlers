/*
 * The barbarians' attack (SPEC 9.2): a moment everyone sees. Whoever lost a city gets a banner
 * that stays until they close it, saying which city and what it means; everyone else sees what
 * happened for a few seconds.
 */

import { useEffect } from 'react';
import { geometryFor, type GameEvent, type PlayerView } from '@settlers/engine';
import { PCOL } from './art';

type Attack = Extract<GameEvent, { k: 'attack' }>;
type CityLost = Extract<GameEvent, { k: 'cityLost' }>;
export interface Raid {
  attack: Attack;
  lost: CityLost[];
}

const nameOf = (v: PlayerView, p: number) => (p === v.me ? 'You' : v.players[p]!.nick);
const list = (xs: string[]) =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** "the ore 6 and wheat 9": the producing tiles around a corner. */
export function cornerPlace(v: PlayerView, corner: number): string {
  const g = geometryFor(v.board.hexes);
  const tiles = g.verts[corner]!.hexes.map((h) => v.board.hexes[h]!)
    .filter((h) => h.n > 0)
    .map((h) => `${h.t} ${h.n}`);
  return tiles.length ? `the ${list(tiles)}` : 'the coast';
}

export function RaidNotice({ v, raid, onClose }: { v: PlayerView; raid: Raid; onClose: () => void }) {
  const a = raid.attack;
  const won = a.strength > a.defense;
  const mine = raid.lost.filter((l) => l.p === v.me);
  const hasCity = v.verts.some((b) => b && b[0] === v.me && b[1] === 2);
  // Only a banner about your own city stays until you close it.
  useEffect(() => {
    if (mine.length) return;
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [raid]);
  return (
    <div
      className={`overlay raid${won ? ' lost' : ' held'}`}
      role="alertdialog"
      aria-label="The barbarians attacked"
      data-testid="raid"
    >
      <div className="raidcard">
        <div className="raidship" aria-hidden="true">
          ⛵
        </div>
        <h3>{won ? 'The barbarians won!' : 'The knights drove off the barbarians!'}</h3>
        <p className="sub">
          Barbarians {a.strength} against knights {a.defense}.
        </p>
        {mine.length ? (
          <p className="mine" data-testid="raid-mine">
            The barbarians pillaged your {mine.length === 1 ? 'city' : 'cities'} on{' '}
            {list(mine.map((l) => cornerPlace(v, l.v)))}.{' '}
            {mine.length === 1 ? 'It’s a settlement now.' : 'They’re settlements now.'}
            {!hasCity ? ' You need a city again before you can buy city improvements.' : ''}
          </p>
        ) : null}
        {raid.lost
          .filter((l) => l.p !== v.me)
          .map((l, i) => (
            <p key={i}>
              <span className="dot" style={{ background: PCOL[v.players[l.p]!.color] }} />
              {nameOf(v, l.p)} lost the city on {cornerPlace(v, l.v)}.
            </p>
          ))}
        {a.losers
          .filter((p) => !raid.lost.some((l) => l.p === p))
          .map((p) => (
            <p key={`c${p}`} data-testid="raid-choosing">
              {p === v.me ? 'You have' : `${nameOf(v, p)} has`} to choose which city to lose.
            </p>
          ))}
        {won && !a.losers.length ? <p>Nobody had a city the barbarians could take.</p> : null}
        {!won && a.defender != null ? (
          <p>
            {nameOf(v, a.defender)} {a.defender === v.me ? 'are' : 'is'} Defender of Catan: +1 point.
          </p>
        ) : null}
        {!won && a.tied.length ? (
          <p>{list(a.tied.map((p) => nameOf(v, p)))} each draw a progress card.</p>
        ) : null}
        <p className="hint">Every knight is inactive now. Activate them again with wheat.</p>
        <button className="btn primary" onClick={onClose} data-testid="raid-ok">
          OK
        </button>
      </div>
    </div>
  );
}
