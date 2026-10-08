import { describe, expect, it } from 'vitest';
import {
  eventsFor,
  geo,
  legalActions,
  viewFor,
  type Action,
  type GameState,
  type Seat,
} from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { act, edgePath, emptyBoard, place, setHand } from '../../engine/test/helpers';
import { RULE_HELP } from '../src/help';
import { awardNotes, momentsFor, placesOf, recapFor, shown, type Moment } from '../src/moments';

/** Three players, seat 0 in its main phase with a settlement and cards for a city and roads. */
function table(): GameState {
  let s = emptyBoard(3);
  s.players.forEach((pl, i) => (pl.nick = `P${i}`));
  const g = geo(s);
  s = place(s, 0, { settlements: [0], roads: [g.verts[0]!.edges[0]!] });
  s = place(s, 1, { settlements: [30], roads: [g.verts[30]!.edges[0]!] });
  return setHand(s, 0, { wood: 9, brick: 9, wheat: 4, ore: 6, sheep: 2 });
}

/** One move, as each seat's screen sees it: its log items and its views before and after. */
function seen(s: GameState, p: Seat, a: Action, seat: Seat) {
  const r = act(s, p, a);
  const items: LogItem[] = eventsFor(r.events, seat).map((e) => ({ k: 'ev', seq: r.state.seq, at: 0, e }));
  return { r, items, before: viewFor(s, seat), after: viewFor(r.state, seat) };
}
const titles = (ms: Moment[]) => ms.map((m) => m.title);

describe('big moments (SPEC 13.4)', () => {
  it('a city: who built it and their new total, on everyone’s screen', () => {
    const s = table();
    const city: Action = { type: 'city', v: 0 };
    const other = seen(s, 0, city, 1);
    const ms = momentsFor(other.items, other.before, other.after);
    expect(ms).toContainEqual({
      kind: 'points',
      title: 'P0 built a city',
      detail: '2 points',
      seat: 0,
      big: true,
    });
    expect(titles(ms)).toContain('P0 takes the lead');
    const mine = seen(s, 0, city, 0);
    expect(titles(momentsFor(mine.items, mine.before, mine.after))).toEqual([
      'You built a city',
      'You take the lead',
    ]);
  });

  it('Longest Road changing hands is its own moment, not a second points one', () => {
    let s = table();
    const g = geo(s);
    // Seat 1 holds it with 5 roads; seat 0 builds a sixth.
    const p1 = edgePath(s, 30, 5);
    s = place(s, 1, { roads: p1.edges.slice(1) });
    s.longest = 1;
    s.roadLens = [1, 5, 0];
    const p0 = edgePath(s, 0, 6, new Set(p1.verts));
    s = place(s, 0, { roads: p0.edges.slice(1, 5) });
    s.roadLens = [5, 5, 0];
    const last = p0.edges[5]!;
    expect(legalActions(s, 0)).toContainEqual({ type: 'road', e: last });
    const x = seen(s, 0, { type: 'road', e: last }, 2);
    const ms = momentsFor(x.items, x.before, x.after);
    expect(ms[0]).toEqual({
      kind: 'award',
      title: 'P0 took Longest Road',
      detail: '6 long, from P1',
      seat: 0,
      big: true,
    });
    expect(ms.filter((m) => m.kind === 'points')).toEqual([]);
    expect(awardNotes(x.items, x.after)).toEqual(['Longest Road to P0']);
    void g;
  });

  it('a rule change says what it means', () => {
    const x = seen(table(), 0, { type: 'setRule', rule: 'no7FirstRound', value: true }, 1);
    const [m] = momentsFor(x.items, x.before, x.after);
    expect(m!.title).toBe('P0 turned on “No 7s in the first round”');
    expect(m!.detail).toBe(RULE_HELP.no7FirstRound.split('. ')[0] + '.');
  });

  it('levels: steals between others only with Everything; your own always', () => {
    const steal: Moment = { kind: 'steal', title: 'x', big: false };
    const big: Moment = { kind: 'award', title: 'y', big: true };
    expect(shown([steal, big], 'all')).toEqual([steal, big]);
    expect(shown([steal, big], 'big')).toEqual([big]);
    expect(shown([steal, big], 'off')).toEqual([]);
  });

  it('a hidden victory point counts only on your own screen', () => {
    let s = table();
    s.deck = { knight: 0, vp: 1, road: 0, plenty: 0, mono: 0 };
    s = setHand(s, 0, { sheep: 1, wheat: 1, ore: 1 });
    const mine = seen(s, 0, { type: 'buyDev' }, 0);
    expect(titles(momentsFor(mine.items, mine.before, mine.after))).toContain('You gained 1 point');
    const other = seen(s, 0, { type: 'buyDev' }, 1);
    expect(momentsFor(other.items, other.before, other.after).filter((m) => m.kind === 'points')).toEqual([]);
  });
});

describe('the scoreboard and the round recap (SPEC 13.4)', () => {
  it('places, ties sharing one', () => {
    expect(placesOf([5, 7, 5, 2])).toEqual([2, 1, 2, 4]);
  });

  it('sums up a round, or says nothing when nothing changed', () => {
    const v = viewFor(table(), 1);
    const now = v.players.map((p) => p.publicVP);
    expect(recapFor(3, now, v, [])).toBeNull();
    const start = now.map((n, p) => (p === 0 ? n - 2 : p === 1 ? n - 1 : n));
    expect(recapFor(3, start, v, ['Longest Road to P0'])).toEqual({
      kind: 'recap',
      title: 'Round 3',
      detail: 'P0 +2 · You +1 · Longest Road to P0',
      big: true,
    });
  });
});
