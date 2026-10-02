import { describe, expect, it } from 'vitest';
import { cardWarning, geo, newGame, viewFor, type GameState } from '../src/index';
import { emptyBoard, place, setHand } from './helpers';
import { seatsFor } from './simulate';

/** A Cities & Knights game with nothing placed, seat 0 in its main phase. */
function ck(): GameState {
  const s = structuredClone(newGame('warn', seatsFor(3), { modules: ['citiesKnights'], winVP: 13 }));
  s.stage = 'main';
  s.turnN = 5;
  s.setupI = 6;
  s.dice = [3, 4];
  return s;
}

describe('Cards that would do nothing warn first (SPEC 8.11 D4)', () => {
  it('Knight: only when no robber spot blocks or robs anyone', () => {
    let s = emptyBoard(3);
    s = place(s, 0, { settlements: [0] });
    expect(cardWarning(viewFor(s, 0), { type: 'playKnight' })).toMatch(/no robber spot/);
    const far = geo(s).hexVerts[10]![0]!;
    s = place(s, 1, { settlements: [far] });
    expect(cardWarning(viewFor(s, 0), { type: 'playKnight' })).toBeNull();
  });

  it('Monopoly: only when nobody else holds a card', () => {
    let s = emptyBoard(3);
    expect(cardWarning(viewFor(s, 0), { type: 'playMono', r: 'ore' })).toMatch(/nobody else holds/);
    s = setHand(s, 2, { wood: 1 });
    // Whether they hold ore is secret: any card at all means no warning.
    expect(cardWarning(viewFor(s, 0), { type: 'playMono', r: 'ore' })).toBeNull();
  });

  it('Road Building: only when there is no space', () => {
    const s = emptyBoard(3);
    s.players[0]!.pieces.road = 0;
    expect(cardWarning(viewFor(s, 0), { type: 'playRoads' })).toMatch(/no space/);
  });

  it('Smith: only when no knight can be promoted', () => {
    const s = ck();
    expect(cardWarning(viewFor(s, 0), { type: 'progress', card: 'smith' })).toMatch(/none of your knights/);
    s.ck!.knights[5] = { p: 0, lvl: 1, on: false };
    expect(cardWarning(viewFor(s, 0), { type: 'progress', card: 'smith', vs: [5] })).toBeNull();
  });

  it('Merchant Fleet: only with fewer than 2 of that card', () => {
    let s = setHand(ck(), 0, { wood: 1 });
    const play = { type: 'progress' as const, card: 'merchantFleet' as const, r: 'wood' as const };
    expect(cardWarning(viewFor(s, 0), play)).toMatch(/fewer than 2 wood/);
    s = setHand(s, 0, { wood: 2 });
    expect(cardWarning(viewFor(s, 0), play)).toBeNull();
  });

  it('other moves never warn', () => {
    expect(cardWarning(viewFor(emptyBoard(3), 0), { type: 'end' })).toBeNull();
  });
});
