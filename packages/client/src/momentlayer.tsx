/*
 * The big moments across the top of the board (SPEC 13.4): one at a time, each for a couple of
 * seconds, faster when several are waiting. Clicks go through to the board underneath.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@settlers/engine';
import { PCOL } from './art';
import {
  awardNotes,
  momentsFor,
  ordinal,
  pointsOf,
  recapFor,
  roundOf,
  shown,
  type Moment,
  type MomentLevel,
} from './moments';
import { client } from './net';

/** How long a moment stays, alone or with others waiting. */
const STAY = 2600;
const STAY_BUSY = 1500;
/** At most this many waiting; the oldest small ones go first. */
const MAX_WAITING = 6;

export function MomentLayer({ v, level }: { v: PlayerView; level: MomentLevel }) {
  const [queue, setQueue] = useState<(Moment & { id: number })[]>([]);
  const ids = useRef(0);
  const levelRef = useRef(level);
  levelRef.current = level;
  // The round so far: points at its start and awards that changed hands (for the recap).
  const round = useRef<{ n: number; start: number[]; awards: string[]; whole: boolean } | null>(null);
  if (!round.current && v.phase === 'play' && v.turnN >= 1)
    round.current = {
      n: roundOf(v.turnN, v.players.length),
      start: v.players.map((_, p) => pointsOf(v, p)),
      awards: [],
      // Opened mid-round: that round's recap would be missing its start.
      whole: false,
    };

  useEffect(
    () =>
      client.onFresh(({ items, before, after }) => {
        if (!after || after.phase !== 'play') return;
        const lvl = levelRef.current;
        const add: Moment[] = shown(momentsFor(items, before, after), lvl);
        const r = round.current;
        const n = roundOf(after.turnN, after.players.length);
        if (r && n === r.n) r.awards.push(...awardNotes(items, after));
        if (r && n > r.n && before) {
          r.awards.push(...awardNotes(items, after));
          if (r.whole && lvl !== 'off') {
            const recap = recapFor(r.n, r.start, after, r.awards);
            if (recap) add.push(recap);
          }
          round.current = {
            n,
            start: after.players.map((_, p) => pointsOf(after, p)),
            awards: [],
            whole: true,
          };
        } else if (!r && after.turnN >= 1) {
          round.current = {
            n,
            start: after.players.map((_, p) => pointsOf(after, p)),
            awards: [],
            whole: (after.turnN - 1) % after.players.length === 0,
          };
        }
        if (!add.length) return;
        setQueue((q) => {
          let next = [...q, ...add.map((m) => ({ ...m, id: ++ids.current }))];
          while (next.length > MAX_WAITING) {
            const small = next.findIndex((m, i) => i > 0 && !m.big);
            next = next.filter((_, i) => i !== (small > 0 ? small : 1));
          }
          return next;
        });
      }),
    [],
  );

  const head = queue[0];
  useEffect(() => {
    if (!head) return;
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), queue.length > 1 ? STAY_BUSY : STAY);
    return () => window.clearTimeout(t);
  }, [head?.id]);

  if (!head || level === 'off') return null;
  const color = head.seat != null ? v.players[head.seat]?.color : undefined;
  return (
    <div className="moments" aria-live="polite" data-testid="moments">
      <div
        key={head.id}
        className={`moment k-${head.kind}`}
        data-kind={head.kind}
        data-testid="moment"
        style={color ? { ['--pc' as string]: PCOL[color] } : undefined}
      >
        <b className="mt">{head.title}</b>
        {head.detail ? <span className="md">{head.detail}</span> : null}
        {queue.length > 1 ? <span className="mq">+{queue.length - 1}</span> : null}
      </div>
    </div>
  );
}

/**
 * A player's place on the scoreboard (SPEC 13.4): "1st", "2nd"…; it pulses when their points
 * change and shows an arrow for a few seconds when the place changes.
 */
export function Place({ place, points }: { place: number; points: number }) {
  const prev = useRef({ place, points });
  const [mark, setMark] = useState<{ dir: 'up' | 'down' | null; n: number }>({ dir: null, n: 0 });
  useEffect(() => {
    const p = prev.current;
    if (place === p.place && points === p.points) return;
    prev.current = { place, points };
    setMark((m) => ({ dir: place < p.place ? 'up' : place > p.place ? 'down' : null, n: m.n + 1 }));
  }, [place, points]);
  useEffect(() => {
    if (!mark.dir) return;
    const t = window.setTimeout(() => setMark((m) => ({ ...m, dir: null })), 4000);
    return () => window.clearTimeout(t);
  }, [mark.n]);
  return (
    <span
      key={mark.n}
      className={`place p${place}${mark.n ? ' pulse' : ''}`}
      data-testid="place"
      data-place={place}
      data-move={mark.dir ?? undefined}
      title={`${ordinal(place)} place`}
    >
      {ordinal(place)}
      {mark.dir ? (
        <i className={`arrow ${mark.dir}`} aria-label={mark.dir === 'up' ? 'up a place' : 'down a place'}>
          {mark.dir === 'up' ? '▲' : '▼'}
        </i>
      ) : null}
    </span>
  );
}
