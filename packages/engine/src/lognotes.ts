/*
 * Log notes (SPEC 8.10): facts the game log shows that a move's events don't carry, worked out
 * from the state just after the move. They are not game events: applyAction never makes them,
 * so saved games replay with exactly the events they were saved with. The server adds the notes
 * to the log when it applies a move and when it replays a saved game. They hold only public
 * information (the board and the dice), so every player gets them as they are.
 */

import { COM_OF } from './modules/citiesKnights';
import { mods } from './modules/api';
import { geo } from './queries';
import { isResource, type Card, type GameEvent, type GameState, type Seat } from './types';

export type LogNote =
  /** The robber stood on a tile that rolled: what each player would have got from it. */
  { k: 'blocked'; h: number; lost: Record<Seat, Partial<Record<Card, number>>> };

export const isLogNote = (e: GameEvent | LogNote): e is LogNote => e.k === 'blocked';

/** Notes for a move, given the state after it and its events. */
export function logNotes(s: GameState, events: readonly GameEvent[]): LogNote[] {
  const out: LogNote[] = [];
  // A roll that produced (not a 7): the robber didn't move during it, nor did any building
  // change after production, so the state after the move shows what it blocked.
  if (events.some((e) => e.k === 'produce') && s.dice) {
    const h = s.board.robber;
    const hex = h >= 0 ? s.board.hexes[h] : undefined;
    if (hex && isResource(hex.t) && hex.n === s.dice[0] + s.dice[1]) {
      const yieldOf = mods(s).find((m) => m.yieldOf)?.yieldOf;
      const com = s.ck ? COM_OF[hex.t] : undefined;
      const lost: Record<Seat, Partial<Record<Card, number>>> = {};
      for (const v of geo(s).hexVerts[h]!) {
        const b = s.verts[v];
        if (!b) continue;
        const got = (lost[b[0]] ??= {});
        got[hex.t] = (got[hex.t] ?? 0) + (yieldOf ? yieldOf(s, hex.t, b[1]) : b[1]);
        if (com && b[1] === 2) got[com] = (got[com] ?? 0) + 1;
      }
      if (Object.keys(lost).length) out.push({ k: 'blocked', h, lost });
    }
  }
  return out;
}
