import { describe, expect, it } from 'vitest';
import {
  StatsFold,
  applyAction,
  bestTile,
  geo,
  legalActions,
  type Action,
  type GameState,
} from '../src/index';
import { emptyBoard, place, rigDice, setHand } from './helpers';

/** Play moves through a fold, like the server does. */
function run(s0: GameState, moves: [number, Action][]) {
  const fold = new StatsFold(s0);
  let s = s0;
  for (const [p, a] of moves) {
    const r = applyAction(s, p, a);
    if (!r.ok) throw new Error(r.error);
    fold.step(s, p, a, r.events, r.state);
    s = r.state;
  }
  return { s, st: fold.st };
}

describe('game stats (SPEC 5.5)', () => {
  it('a roll: dice chart, production credited to its tile', () => {
    let s = emptyBoard(3);
    const g = geo(s);
    // Seat 0 has one settlement, on the corner of a tile numbered 8.
    const h = s.board.hexes.findIndex((x) => x.n === 8);
    const v = g.hexVerts[h]!.find((x) =>
      g.verts[x]!.hexes.every((y) => y === h || s.board.hexes[y]!.n !== 8),
    )!;
    s = place(s, 0, { settlements: [v], roads: [g.verts[v]!.edges[0]!] });
    s.stage = 'preroll';
    s = rigDice(s, 8);
    const { st } = run(s, [[0, { type: 'roll' }]]);
    expect(st.dice[8]).toBe(1);
    expect(st.rollLog).toEqual([{ p: 0, t: 8 }]);
    expect(st.players[0]!.rolls).toBe(1);
    expect(st.players[0]!.got.production).toEqual({ [s.board.hexes[h]!.t]: 1 });
    expect(bestTile(st.players[0]!)).toEqual([h, 1]);
  });

  it('a steal: who robbed whom, and the card moves from robbed to steal', () => {
    let s = emptyBoard(3);
    const g = geo(s);
    s = place(s, 1, { settlements: [20], roads: [g.verts[20]!.edges[0]!] });
    s = setHand(s, 1, { ore: 1 });
    s.stage = 'robber';
    s.robberReturn = 'main';
    const a = legalActions(s, 0).find((x) => x.type === 'robber' && x.victim === 1)!;
    const { st } = run(s, [[0, a]]);
    expect(st.players[0]!.robs).toBe(1);
    expect(st.players[1]!.robbed).toBe(1);
    expect(st.players[1]!.robbedBy).toEqual([1, 0, 0]);
    expect(st.players[0]!.got.steal).toEqual({ ore: 1 });
    expect(st.players[1]!.lost.robbed).toEqual({ ore: 1 });
  });

  it('building spends cards; an undo takes the stats back too', () => {
    let s = emptyBoard(3);
    s.config = { ...s.config, houseRules: { undo: true } };
    const g = geo(s);
    s = place(s, 0, { settlements: [0], roads: [g.verts[0]!.edges[0]!] });
    s = setHand(s, 0, { wood: 1, brick: 1 });
    const road = legalActions(s, 0).find((x) => x.type === 'road')!;
    const built = run(s, [[0, road]]);
    expect(built.st.players[0]!.lost.build).toEqual({ wood: 1, brick: 1 });
    expect(built.st.players[0]!.built.road).toBe(1);
    const undone = run(s, [
      [0, road],
      [0, { type: 'askUndo' }],
      [1, { type: 'answerUndo', yes: true }],
      [2, { type: 'answerUndo', yes: true }],
    ]);
    expect(undone.s.edges.filter((x) => x === 0)).toHaveLength(1);
    expect(undone.st.players[0]!.lost.build).toEqual({});
    expect(undone.st.players[0]!.built.road).toBeUndefined();
  });
});
