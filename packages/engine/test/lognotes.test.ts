import { describe, expect, it } from 'vitest';
import { geo, logNotes, newGame, type GameState } from '../src/index';
import { act, emptyBoard, place, rigDice } from './helpers';
import { seatsFor } from './simulate';

/** A board with the robber on a numbered tile, seat 1's settlement and seat 2's city on it. */
function blocked(s: GameState, kind: GameState['board']['hexes'][number]['t']) {
  const h = s.board.hexes.findIndex((x) => x.t === kind && x.n !== 7);
  const [a, , c] = geo(s).hexVerts[h]!;
  s = place(s, 1, { settlements: [a!] });
  s = place(s, 2, { cities: [c!] });
  s.board.robber = h;
  s.stage = 'preroll';
  s.turn = 0;
  s.dice = null;
  return { s: rigDice(s, s.board.hexes[h]!.n), h };
}

describe('Log notes (SPEC 8.10)', () => {
  it('a roll on the robber’s tile notes what each player would have got', () => {
    const { s, h } = blocked(emptyBoard(3), 'brick');
    const r = act(s, 0, { type: 'roll' });
    expect(logNotes(r.state, r.events)).toEqual([
      { k: 'blocked', h, lost: { 1: { brick: 1 }, 2: { brick: 2 } } },
    ]);
  });

  it('nothing when the robber’s tile didn’t roll, or on a 7', () => {
    const { s, h } = blocked(emptyBoard(3), 'brick');
    const other = s.board.hexes.find((x, i) => i !== h && x.n !== 7 && x.n !== s.board.hexes[h]!.n)!;
    const r = act(rigDice(s, other.n), 0, { type: 'roll' });
    expect(logNotes(r.state, r.events)).toEqual([]);
    const seven = act(rigDice(s, 7), 0, { type: 'roll' });
    expect(logNotes(seven.state, seven.events)).toEqual([]);
  });

  it('Cities & Knights: a city loses its commodity too', () => {
    const ck = structuredClone(newGame('notes', seatsFor(3), { modules: ['citiesKnights'], winVP: 13 }));
    Object.assign(ck, { stage: 'main', turnN: 5, setupI: 6 });
    // No event die surprises: the barbarians start late.
    ck.config.houseRules = { barbarianDelay: 99 };
    const { s, h } = blocked(ck, 'ore');
    const r = act(s, 0, { type: 'roll' });
    expect(r.events.some((e) => e.k === 'produce')).toBe(true);
    expect(logNotes(r.state, r.events)).toEqual([
      { k: 'blocked', h, lost: { 1: { ore: 1 }, 2: { ore: 1, coin: 1 } } },
    ]);
  });
});
