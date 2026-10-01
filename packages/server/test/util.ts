import { TABLE_TALK, legalActions, type Action, type Color, type GameState } from '@settlers/engine';
import type { ClientMsg } from '../src/protocol';
import type { Store } from '../src/store';

/** A join message for the profile with this name, making the profile if there's none yet. */
export function joinAs(store: Store, name: string, color: Color): ClientMsg {
  let p = store.profileByName(name);
  if (!p) {
    p = {
      id: `p-${name.trim().toLowerCase()}`,
      name: name.trim(),
      color: color === 'gray' ? 'red' : color,
      createdAt: 0,
    };
    store.insertProfile(p);
  }
  return { t: 'join', profile: p.id, color };
}

/** Legal moves, without requests between players (undo, the dice back, rule changes). */
export const moves = (s: GameState, p: number): Action[] =>
  legalActions(s, p).filter((a) => !TABLE_TALK.includes(a.type));
