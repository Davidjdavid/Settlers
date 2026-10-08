import { describe, expect, it } from 'vitest';
import { checkInvariants, geo, rateFor, type Action, type GameState } from '../src/index';
import { act, emptyBoard, place, reject, setHand } from './helpers';
import { canonical } from './simulate';

/** Seat 0's main phase, with a settlement on a wheat 2:1 harbor (so wheat goes 2 for 1, the rest 4). */
function table(): GameState {
  let s = emptyBoard(3);
  s.config = { ...s.config, houseRules: { undo: true } };
  const g = geo(s);
  const port = s.board.ports.find((pt) => pt.t === 'wheat')!;
  const v = g.edges[port.e]!.a;
  s = place(s, 0, { settlements: [v], roads: [g.verts[v]!.edges[0]!] });
  return setHand(s, 0, { wood: 1, brick: 0, sheep: 8, wheat: 4, ore: 3 });
}
const basket = (give: Record<string, number>, get: Record<string, number>): Action =>
  ({ type: 'bankTrade', give, get }) as Action;

describe('several bank trades in one move (SPEC 13.2)', () => {
  it('any mix at your rates, exactly as the single trades one after another', () => {
    const s = table();
    expect(rateFor(s, 0, 'wheat')).toBe(2);
    expect(rateFor(s, 0, 'sheep')).toBe(4);
    const r = act(s, 0, basket({ wheat: 4, sheep: 8 }, { brick: 2, ore: 1, wood: 1 }));
    expect(r.state.players[0]!.res).toMatchObject({ wood: 2, brick: 2, sheep: 0, wheat: 0, ore: 4 });
    // One bank event per trade.
    expect(r.events).toEqual([
      { k: 'bank', p: 0, give: 'sheep', n: 4, get: 'wood' },
      { k: 'bank', p: 0, give: 'sheep', n: 4, get: 'brick' },
      { k: 'bank', p: 0, give: 'wheat', n: 2, get: 'brick' },
      { k: 'bank', p: 0, give: 'wheat', n: 2, get: 'ore' },
    ]);
    // The same as those single trades.
    let t = s;
    for (const e of r.events)
      if (e.k === 'bank') t = act(t, 0, { type: 'bank', give: e.give, get: e.get }).state;
    expect(canonical({ ...r.state, undo: null, seq: 0 })).toBe(canonical({ ...t, undo: null, seq: 0 }));
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('refuses a trade that doesn’t add up', () => {
    const s = table();
    expect(reject(s, 0, basket({ sheep: 6 }, { ore: 1 }))).toMatch(/4 at a time/);
    expect(reject(s, 0, basket({ sheep: 8 }, { ore: 1 }))).toMatch(/enough for 2 cards, not 1/);
    expect(reject(s, 0, basket({ wheat: 2 }, { ore: 2 }))).toMatch(/enough for 1 card, not 2/);
    expect(reject(s, 0, basket({ ore: 4 }, { brick: 1 }))).toMatch(/You need 4 ore/);
    expect(reject(s, 0, basket({ wheat: 2, ore: 0 }, { wheat: 1 }))).toMatch(/same card/);
    expect(reject(s, 0, basket({}, { ore: 1 }))).toMatch(/Choose/);
    expect(reject(s, 0, basket({ wheat: 2 }, {}))).toMatch(/Choose/);
    expect(reject(s, 0, basket({ wheat: -2 }, { ore: 1 }))).toMatch(/Choose/);
    expect(reject(s, 0, basket({ gold: 2 } as never, { ore: 1 }))).toMatch(/Choose/);
    expect(reject(s, 1, basket({ wheat: 2 }, { ore: 1 }))).toMatch(/own turn/);
    const out = structuredClone(s);
    out.players[1]!.res.ore += out.bank.ore;
    out.bank.ore = 0;
    expect(reject(out, 0, basket({ wheat: 2 }, { ore: 1 }))).toMatch(/out of ore/);
    const pre = structuredClone(s);
    pre.stage = 'preroll';
    expect(reject(pre, 0, basket({ wheat: 2 }, { ore: 1 }))).toBeTruthy();
  });

  it('can be undone like a bank trade', () => {
    const s = table();
    const r = act(s, 0, basket({ wheat: 4 }, { brick: 1, ore: 1 }));
    expect(r.state.undo?.p).toBe(0);
    let t = act(r.state, 0, { type: 'askUndo' }).state;
    t = act(t, 1, { type: 'answerUndo', yes: true }).state;
    t = act(t, 2, { type: 'answerUndo', yes: true }).state;
    expect(t.players).toEqual(s.players);
    expect(t.bank).toEqual(s.bank);
  });
});
