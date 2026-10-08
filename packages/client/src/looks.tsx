/*
 * Looks (SPEC 13.6): the whole screen in a different style, the board's tiles included. A look
 * changes only how things are drawn, never what's where or what a click does; it's yours alone,
 * saved on your profile, and can be switched any time from the top bar.
 */

import type { PlayerView } from '@settlers/engine';
import type { LogItem, PlayerSettings } from '@settlers/server/protocol';
import { PCOL } from './art';
import { pointsOf } from './moments';
import { client } from './net';
import { Sheet } from './Sheets';
import { eventLines, lineText } from './text';
import type { ArtStyle } from './themes';

export type Look = NonNullable<PlayerSettings['look']>;

export const LOOKS: { id: Look; label: string; blurb: string; board: ArtStyle | null }[] = [
  {
    id: 'original',
    label: 'Original',
    blurb: 'The screen as it was, with your own board style.',
    board: null,
  },
  {
    id: 'nintendo',
    label: 'Toybox',
    blurb: 'Bright, round and bouncy: chunky buttons that squash when pressed, on a sky-blue table.',
    board: 'toybox',
  },
  {
    id: 'gamenight',
    label: 'Game Night',
    blurb: 'A real board on a wooden table, your cards fanned in your hand, player mats and tumbling dice.',
    board: 'tabletop',
  },
  {
    id: 'broadcast',
    label: 'Live Broadcast',
    blurb: 'A sports broadcast: a scoreboard along the top, a ticker of what’s happening and a points graph.',
    board: 'broadcast',
  },
  {
    id: 'universe',
    label: 'Painted',
    blurb:
      'Painted tiles on sandy edges, ribbon banners for the players and a red hand bar along the bottom.',
    board: 'painted',
  },
];

/** The look in a player's settings (the original when unset or unknown). */
export function lookOf(s: PlayerSettings | null | undefined): Look {
  const id = s?.look;
  return LOOKS.some((l) => l.id === id) ? id! : 'original';
}

/** The board style a look draws in: its own, or (the original) the player's board style. */
export function boardStyleFor(look: Look, own: string | undefined): string | undefined {
  return LOOKS.find((l) => l.id === look)?.board ?? own;
}

/** Black or white text, whichever reads better on a ribbon of player colour `hex` (darkened 15%). */
export function inkOn(hex: string): string {
  const lin = (i: number) => {
    const c = (parseInt(hex.slice(i, i + 2), 16) / 255) * 0.85;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  // Contrast with white is 1.05 / (l + 0.05); with near-black (#1b1208, l ≈ 0.007) (l + 0.05) / 0.057.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.057 ? '#ffffff' : '#1b1208';
}

/**
 * Everyone's points at each turn this tab has seen, for the broadcast look's graph. Kept for the
 * tab (sessionStorage) so a reload doesn't wipe it; a turn number going back (a new game) drops the
 * turns after it. Only points everyone can see, so nothing hidden is drawn.
 */
type Seen = { key: string; rows: [number, number[]][] };
let seen: Seen | null = null;
const SEEN_KEY = 'settlers.pointsSeen';
export function notePoints(key: string, v: PlayerView): Seen {
  if (!seen) {
    try {
      seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null;
    } catch {
      seen = null;
    }
  }
  if (!seen || seen.key !== key || !Array.isArray(seen.rows)) seen = { key, rows: [] };
  const pts = v.players.map((_, p) => pointsOf(v, p));
  const rows = seen.rows.filter(([t]) => t < v.turnN);
  const same = seen.rows.find(([t]) => t === v.turnN);
  if (rows.length === seen.rows.length - 1 && same && same[1].join() === pts.join()) return seen;
  seen = { key, rows: [...rows, [v.turnN, pts]] };
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* private window: kept for this page only */
  }
  return seen;
}

/** Picking a look, from the top bar. */
export function LookSheet({ mine, onClose }: { mine: PlayerSettings | null; onClose: () => void }) {
  const now = lookOf(mine);
  return (
    <Sheet
      title="Look"
      sub="How the whole screen looks, for you alone. Change it any time."
      onClose={onClose}
      foot={
        <button className="btn" onClick={onClose} data-testid="look-close">
          Done
        </button>
      }
    >
      <div className="looklist" role="radiogroup" aria-label="Look">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={now === l.id}
            className={`lookpick${now === l.id ? ' on' : ''}`}
            data-testid={`look-${l.id}`}
            data-look-preview={l.id}
            onClick={() =>
              client.saveSettings({ ...(client.state.room?.mySettings ?? mine ?? {}), look: l.id })
            }
          >
            <span className="lookswatch" aria-hidden="true" />
            <b>{l.label}</b>
            <span>{l.blurb}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** The broadcast look's scoreboard strip along the top and its news ticker (SPEC 13.6). */
export function BroadcastExtras({ v, log }: { v: PlayerView; log: readonly LogItem[] }) {
  const lines: string[] = [];
  for (let i = log.length - 1; i >= 0 && lines.length < 8; i--) {
    const it = log[i]!;
    if (it.k !== 'ev') continue;
    for (const l of eventLines(v, it.e)) lines.push(lineText(v, l));
  }
  return (
    <>
      <div className="bc-board" data-testid="bc-board" aria-hidden="true">
        {v.players.map((p, i) => (
          <span
            key={p.pid}
            className={`bc-team${i === v.turn ? ' on' : ''}`}
            style={{ ['--pc' as string]: PCOL[p.color] }}
          >
            <i />
            <span>{p.nick}</span>
            <b>{pointsOf(v, i)}</b>
          </span>
        ))}
      </div>
      <div className="bc-ticker" data-testid="bc-ticker" aria-hidden="true">
        <b>Latest</b>
        <span className="bc-roll">{lines.join('   •   ')}</span>
      </div>
    </>
  );
}

/** The broadcast look's momentum graph: everyone's points over the turns this tab has seen. */
export function BroadcastGraph({ v, code }: { v: PlayerView; code: string }) {
  const rows = notePoints(code, v).rows;
  if (rows.length < 2) return null;
  const W = 300;
  const H = 90;
  const max = Math.max(v.winVP, ...rows.flatMap(([, pts]) => pts));
  const x = (i: number) => (i / (rows.length - 1)) * (W - 8) + 4;
  const y = (n: number) => H - 6 - (n / max) * (H - 14);
  return (
    <section className="box bc-graph" aria-label="Momentum" data-testid="bc-graph">
      <span className="eyebrow">Momentum</span>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points over the game">
        <line
          x1="0"
          x2={W}
          y1={y(v.winVP)}
          y2={y(v.winVP)}
          stroke="#ff3b5c"
          strokeDasharray="4 4"
          opacity=".6"
        />
        {v.players.map((p, i) => (
          <polyline
            key={p.pid}
            fill="none"
            stroke={PCOL[p.color]}
            strokeWidth="2.5"
            strokeLinejoin="round"
            points={rows.map(([, pts], k) => `${x(k).toFixed(1)},${y(pts[i] ?? 0).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
    </section>
  );
}
