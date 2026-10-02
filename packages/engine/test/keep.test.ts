import { describe, expect, it } from 'vitest';
import {
  KEEP_MAX, TABLE_TALK, checkInvariants, geo, keepMinTarget, legalActions, legalSettlements, totalVP, viewFor,
  type GameState, type Seat,
} from '../src/index'; // prettier-ignore
import { act, emptyBoard, place, reject, setHand } from './helpers';

/** Seat 0 on 9 points (3 cities, 3 settlements, a road at each), one settlement from winning. */
function nearWin(cpus: Seat[] = []): GameState {
  let s = emptyBoard(3);
  s.players.forEach((pl, i) => {
    if (cpus.includes(i)) pl.cpu = true;
    else delete pl.cpu;
  });
  const g = geo(s);
  const used = new Set<number>();
  const corners: number[] = [];
  for (let v = 0; v < g.verts.length && corners.length < 6; v++) {
    if (used.has(v) || g.verts[v]!.adj.some((u) => used.has(u))) continue;
    corners.push(v);
    used.add(v);
  }
  s = place(s, 0, { cities: corners.slice(0, 3), settlements: corners.slice(3) });
  s = place(s, 0, { roads: corners.slice(0, 5).map((v) => g.verts[v]!.edges[0]!) });
  // Two roads from the last settlement, so a new settlement two steps away is legal.
  const v0 = corners[5]!;
  for (const e of g.verts[v0]!.edges) {
    const E = g.edges[e]!;
    const u = E.a === v0 ? E.b : E.a;
    const f = g.verts[u]!.edges.find((x) => x !== e)!;
    const t = place(s, 0, { roads: [e, f] });
    if (legalSettlements(t, 0).length) {
      s = t;
      break;
    }
  }
  expect(totalVP(s, 0)).toBe(9);
  expect(checkInvariants(s)).toEqual([]);
  return setHand(s, 0, { wood: 2, brick: 2, sheep: 2, wheat: 2 });
}

/** Build the winning settlement. */
function win(s: GameState): GameState {
  const v = legalSettlements(s, 0)[0]!;
  const r = act(s, 0, { type: 'settlement', v });
  expect(r.state.phase).toBe('over');
  expect(r.events.find((e) => e.k === 'win')).toEqual({ k: 'win', p: 0, vp: 10 });
  return r.state;
}

describe('Keep playing (SPEC 8.9)', () => {
  it('everyone agrees: play resumes where it stopped, to a target above every score', () => {
    const over = win(nearWin());
    expect(keepMinTarget(over)).toBe(11);
    expect(legalActions(over, 1)).toEqual([{ type: 'askKeep', target: 12 }]);
    expect(reject(over, 1, { type: 'askKeep', target: 10 })).toMatch(/from 11/);
    expect(reject(over, 1, { type: 'askKeep', target: KEEP_MAX + 1 })).toMatch(/to 99/);
    let s = act(over, 1, { type: 'askKeep', target: 12 }).state;
    expect(s.phase).toBe('over');
    expect(s.keep).toEqual({
      first: { p: 0, vp: 10, target: 10, seq: over.seq },
      on: false,
      ask: { p: 1, target: 12, ok: [1] },
      wins: [],
    });
    expect(legalActions(s, 1)).toEqual([{ type: 'cancelKeep' }]);
    expect(legalActions(s, 0).map((a) => a.type)).toEqual(['answerKeep', 'answerKeep']);
    expect(reject(s, 1, { type: 'answerKeep', yes: true })).toMatch(/already/);
    s = act(s, 0, { type: 'answerKeep', yes: true }).state;
    expect(s.phase).toBe('over');
    const r = act(s, 2, { type: 'answerKeep', yes: true });
    s = r.state;
    expect(r.events.at(-1)).toEqual({ k: 'keepPlaying', target: 12, from: 10 });
    // Exactly where it stopped: the winner's turn, main phase, nothing else changed.
    expect(s.phase).toBe('play');
    expect(s.winner).toBeNull();
    expect(s.config.winVP).toBe(12);
    expect([s.turn, s.stage, s.turnN]).toEqual([over.turn, over.stage, over.turnN]);
    expect(s.verts).toEqual(over.verts);
    expect(s.keep).toMatchObject({ on: true, wins: [] });
    expect(s.keep!.ask).toBeUndefined();
    expect(checkInvariants(s)).toEqual([]);
    // Everyone sees the new target and the first win.
    expect(viewFor(s, 2).winVP).toBe(12);
    expect(viewFor(s, 2).keep!.first.p).toBe(0);
  });

  it('the next win is an overtime win; the first win stays the result', () => {
    let s = win(nearWin());
    s = act(s, 1, { type: 'askKeep', target: 11 }).state;
    s = act(s, 0, { type: 'answerKeep', yes: true }).state;
    s = act(s, 2, { type: 'answerKeep', yes: true }).state;
    s = setHand(s, 0, { wood: 2, brick: 2, sheep: 2, wheat: 2, ore: 3 });
    // A city on the last settlement: 11 points.
    const v = s.verts.findIndex((b) => b && b[0] === 0 && b[1] === 1);
    const r = act(s, 0, { type: 'city', v });
    expect(r.state.phase).toBe('over');
    expect(r.events.find((e) => e.k === 'win')).toEqual({ k: 'win', p: 0, vp: 11, overtime: true });
    expect(r.state.keep!.first).toMatchObject({ p: 0, vp: 10, target: 10 });
    expect(r.state.keep!.wins).toEqual([{ p: 0, vp: 11, target: 11, seq: r.state.seq }]);
    expect(checkInvariants(r.state)).toEqual([]);
    // And it can go on again.
    expect(legalActions(r.state, 2)).toEqual([{ type: 'askKeep', target: 13 }]);
  });

  it('one "no" ends the game as it was; the asker can withdraw', () => {
    const over = win(nearWin());
    let s = act(over, 1, { type: 'askKeep', target: 12 }).state;
    s = act(s, 0, { type: 'answerKeep', yes: false }).state;
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(s.keep!.ask).toBeUndefined();
    expect(s.keep!.on).toBe(false);
    s = act(s, 2, { type: 'askKeep', target: 14 }).state;
    expect(reject(s, 1, { type: 'cancelKeep' })).toMatch(/haven’t asked/);
    s = act(s, 2, { type: 'cancelKeep' }).state;
    expect(s.keep!.ask).toBeUndefined();
    expect(reject(s, 0, { type: 'answerKeep', yes: true })).toMatch(/Nobody asked/);
  });

  it('CPUs agree at once', () => {
    const s = act(win(nearWin([1, 2])), 0, { type: 'askKeep', target: 12 }).state;
    expect(s.phase).toBe('play');
    expect(s.config.winVP).toBe(12);
  });

  it('only after a win, and bots and CPUs never ask', () => {
    const s = nearWin();
    expect(reject(s, 0, { type: 'askKeep', target: 12 })).toMatch(/isn’t over/);
    for (const t of ['askKeep', 'answerKeep', 'cancelKeep'] as const) expect(TABLE_TALK).toContain(t);
  });
});
