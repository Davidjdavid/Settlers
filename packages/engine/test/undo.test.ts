import { describe, expect, it } from 'vitest';
import fogMap from './fixtures/fog-test.json';
import {
  checkInvariants, edgeSides, geo, isLand, legalActions, newGame, viewFor, type GameState, type MapData,
} from '../src/index'; // prettier-ignore
import { act, emptyBoard, place, reject, rigDice, setHand } from './helpers';
import { canonical, seatsFor } from './simulate';

/** Seat 0's main phase, with undo on and a road to build from. */
function table(): GameState {
  let s = emptyBoard(3);
  s.config = { ...s.config, houseRules: { undo: true } };
  const g = geo(s);
  s = place(s, 0, { settlements: [0], roads: [g.verts[0]!.edges[0]!] });
  s = place(s, 1, { settlements: [30], roads: [g.verts[30]!.edges[0]!] });
  s = setHand(s, 1, { wood: 2, ore: 1 });
  return setHand(s, 0, { wood: 3, brick: 3, sheep: 1, wheat: 2, ore: 3 });
}
const road = (s: GameState) => legalActions(s, 0).find((a) => a.type === 'road')!;
/** Everything but the move count and the undo itself. */
const same = (s: GameState) => canonical({ ...s, seq: 0, undo: null });

describe('undo with everyone’s OK (SPEC 5.10)', () => {
  it('approved by every other person: the move is undone exactly', () => {
    const before = table();
    let s = act(before, 0, road(before)).state;
    expect(viewFor(s, 1).undo).toEqual({ p: 0, asked: false, ok: [] });
    s = act(s, 0, { type: 'askUndo' }).state;
    expect(legalActions(s, 1)).toContainEqual({ type: 'answerUndo', yes: true });
    s = act(s, 1, { type: 'answerUndo', yes: true }).state;
    expect(same(s)).not.toBe(same(before)); // still waiting for seat 2
    const r = act(s, 2, { type: 'answerUndo', yes: true });
    expect(r.events.at(-1)).toEqual({ k: 'undo', p: 0 });
    expect(same(r.state)).toBe(same(before));
    expect(r.state.undo).toBeUndefined();
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('denied: one “no” cancels it for good', () => {
    let s = table();
    s = act(s, 0, road(s)).state;
    s = act(s, 0, { type: 'askUndo' }).state;
    s = act(s, 1, { type: 'answerUndo', yes: true }).state;
    const r = act(s, 2, { type: 'answerUndo', yes: false });
    expect(r.state.undo).toBeUndefined();
    expect(r.state.edges.filter((x) => x === 0)).toHaveLength(2); // the new road stays
    expect(reject(r.state, 0, { type: 'askUndo' })).toMatch(/nothing of yours/);
  });

  it('CPUs agree at once; asking can be withdrawn', () => {
    let s = table();
    s.players[1]!.cpu = true;
    const before = s;
    s = act(s, 0, road(s)).state;
    s = act(s, 0, { type: 'askUndo' }).state;
    expect(s.undo!.ok).toEqual([1]);
    s = act(s, 0, { type: 'cancelUndo' }).state;
    expect(s.undo).toMatchObject({ asked: false, ok: [] });
    s.players[2]!.cpu = true;
    const r = act(s, 0, { type: 'askUndo' });
    expect(same(r.state)).toBe(same({ ...before, players: r.state.players }));
    expect(r.state.edges).toEqual(before.edges);
  });

  it('only your most recent move, and only before anyone else acts', () => {
    let s = table();
    s = act(s, 0, road(s)).state;
    expect(reject(s, 1, { type: 'askUndo' })).toMatch(/nothing of yours/);
    expect(reject(s, 1, { type: 'answerUndo', yes: true })).toMatch(/Nobody asked/);
    // Someone else acts (an offer): gone.
    const offered = act(s, 1, { type: 'offer', give: { wood: 1 }, want: { ore: 1 } }).state;
    expect(offered.undo).toBeUndefined();
    // Another move of your own: only that one can be undone now.
    const mid = s;
    s = act(s, 0, road(s)).state;
    expect(same(s.undo!.state!)).toBe(same(mid));
  });

  it('refused after a roll, a steal, buying or playing a card, or ending the turn', () => {
    const base = table();
    const rolled = (() => {
      const t = structuredClone(base);
      t.stage = 'preroll';
      return act(rigDice(t, 5), 0, { type: 'roll' }).state;
    })();
    expect(rolled.undo).toBeUndefined();
    const bought = act(base, 0, { type: 'buyDev' }).state;
    expect(bought.undo).toBeUndefined();
    const k = structuredClone(base);
    k.players[0]!.dev.knight = 1;
    k.deck.knight--;
    const played = act(k, 0, { type: 'playKnight' }).state;
    expect(played.undo).toBeUndefined();
    // Moving the robber: undoable with nobody to rob, not after a steal.
    const robber = (t: GameState) => legalActions(t, 0).filter((a) => a.type === 'robber');
    const steal = robber(played).find((a) => a.type === 'robber' && a.victim === 1)!;
    expect(act(played, 0, steal).state.undo).toBeUndefined();
    const quiet = robber(played).find((a) => a.type === 'robber' && a.victim == null)!;
    expect(act(played, 0, quiet).state.undo?.p).toBe(0);
    expect(act(base, 0, { type: 'end' }).state.undo).toBeUndefined();
  });

  it('refused after discovering fog (Seafarers)', () => {
    let s = structuredClone(
      newGame('sea', seatsFor(3), { map: fogMap as unknown as MapData, houseRules: { undo: true } }),
    );
    s.stage = 'main';
    s.turnN = 5;
    s.setupI = 6;
    s.dice = [3, 4];
    const g = geo(s);
    const v = g.verts.findIndex(
      (V) => V.hexes.some((h) => h < 19) && V.hexes.some((h) => s.board.hexes[h]!.t === 'fog'),
    );
    const e = g.verts[v]!.edges.find((x) => edgeSides(s, x).includes('fog') && edgeSides(s, x).some(isLand))!;
    s = place(s, 0, { settlements: [v] });
    s = setHand(s, 0, { wood: 1, brick: 1 });
    const r = act(s, 0, { type: 'road', e });
    expect(r.events.some((x) => x.k === 'discover')).toBe(true);
    expect(r.state.undo).toBeUndefined();
  });

  it('needs the rule, and the earlier state never reaches anyone’s screen', () => {
    const off = table();
    off.config = { winVP: 10 };
    expect(act(off, 0, road(off)).state.undo).toBeUndefined();
    const s = act(table(), 0, road(table())).state;
    for (const seat of [0, 1, 2, null]) expect(JSON.stringify(viewFor(s, seat))).not.toContain('"state"');
  });
});
