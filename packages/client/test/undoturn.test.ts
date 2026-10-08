import { describe, expect, it } from 'vitest';
import {
  eventsFor,
  geo,
  legalActions,
  viewFor,
  type Action,
  type GameEvent,
  type GameState,
  type Seat,
} from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { act, emptyBoard, place, rigDice, setHand } from '../../engine/test/helpers';
import { logRows } from '../src/log';
import { bankLines, eventLines, lineText, turnUndoSummary } from '../src/text';

/** Seat 0 about to roll with undo on, cards to spend and a road to build from. */
function table(): GameState {
  let s = emptyBoard(3);
  s.config = { ...s.config, houseRules: { undo: true, undoTurn: true } };
  s.stage = 'preroll';
  const g = geo(s);
  s = place(s, 0, { settlements: [0], roads: [g.verts[0]!.edges[0]!] });
  // Names by seat (the engine seats players in an order from the seed).
  s.players.forEach((pl, i) => (pl.nick = `P${i}`));
  return setHand(s, 0, { wood: 4, brick: 4, sheep: 2, wheat: 2, ore: 2 });
}

/** Play moves, keeping each seat's log as the server sends it. */
function game() {
  let s = rigDice(table(), 5);
  const logs: LogItem[][] = [[], [], []];
  const step = (p: Seat, a: Action) => {
    const r = act(s, p, a);
    s = r.state;
    for (let q = 0; q < 3; q++)
      for (const e of eventsFor(r.events, q)) logs[q]!.push({ k: 'ev', seq: s.seq, at: 0, e });
  };
  return { step, s: () => s, logs };
}
const road = (s: GameState) => legalActions(s, 0).find((a) => a.type === 'road')!;

describe('what “Undo my turn” takes back (SPEC 13.2)', () => {
  it('lists every move since the roll and who saw what', () => {
    const g = game();
    g.step(0, { type: 'roll' });
    g.step(0, road(g.s()));
    g.step(0, { type: 'buyDev' });
    g.step(0, { type: 'askUndo', turn: true });
    const v = viewFor(g.s(), 1);
    const { lines, seen } = turnUndoSummary(v, g.logs[1]!);
    expect(lines.map((l) => lineText(v, l))).toEqual(['P0 built a road', 'P0 bought a development card']);
    expect(seen).toEqual(['P0 saw the card they bought']);
    // The buyer's own screen says "You".
    const mine = turnUndoSummary(viewFor(g.s(), 0), g.logs[0]!);
    expect(mine.seen).toEqual(['You saw the card you bought']);
  });

  it('leaves out moves already undone, and starts again after a whole turn was undone', () => {
    const g = game();
    g.step(0, { type: 'roll' });
    g.step(0, road(g.s()));
    g.step(0, road(g.s()));
    g.step(0, { type: 'askUndo' });
    g.step(1, { type: 'answerUndo', yes: true });
    g.step(2, { type: 'answerUndo', yes: true });
    g.step(0, { type: 'buyDev' });
    g.step(0, { type: 'askUndo', turn: true });
    let v = viewFor(g.s(), 2);
    expect(turnUndoSummary(v, g.logs[2]!).lines.map((l) => lineText(v, l))).toEqual([
      'P0 built a road',
      'P0 bought a development card',
    ]);
    g.step(1, { type: 'answerUndo', yes: true });
    g.step(2, { type: 'answerUndo', yes: true });
    g.step(0, road(g.s()));
    g.step(0, road(g.s()));
    g.step(0, { type: 'askUndo', turn: true });
    v = viewFor(g.s(), 2);
    expect(turnUndoSummary(v, g.logs[2]!).lines).toHaveLength(2);
    expect(turnUndoSummary(v, g.logs[2]!).seen).toEqual([]);
  });

  it('the log says what happened', () => {
    const v = viewFor(table(), 1);
    const text = (e: GameEvent) => eventLines(v, e).map((l) => lineText(v, l));
    expect(text({ k: 'askUndo', p: 0, turn: true })).toEqual(['P0 asked to undo their whole turn']);
    expect(text({ k: 'undo', p: 0, turn: true })).toEqual([
      'P0’s turn was undone, back to just after the roll',
    ]);
    expect(text({ k: 'undo', p: 0 })).toEqual(['P0’s last move was undone']);
  });
});

describe('several bank trades in one move (SPEC 13.2)', () => {
  it('show as one line in the log', () => {
    const v = viewFor(table(), 1);
    const evs = [
      { k: 'bank', p: 0, give: 'sheep', n: 4, get: 'brick' },
      { k: 'bank', p: 0, give: 'sheep', n: 4, get: 'brick' },
      { k: 'bank', p: 0, give: 'wheat', n: 4, get: 'ore' },
    ] as const;
    expect(lineText(v, bankLines([...evs])[0]!)).toBe(
      'P0 traded 8 Sheep and 4 Wheat to the bank for 2 Brick and 1 Ore',
    );
    const log: LogItem[] = [
      ...evs.map((e) => ({ k: 'ev' as const, seq: 9, at: 0, e })),
      // A single trade in the next move stays its own line.
      { k: 'ev', seq: 10, at: 0, e: { k: 'bank', p: 0, give: 'ore', n: 4, get: 'wood' } },
    ];
    const rows = logRows(log, (key, e) =>
      eventLines(v, e).map((line, i) => ({ k: 'line', key: `${key}#${i}`, line })),
    );
    expect(rows.map((r) => (r.k === 'line' ? lineText(v, r.line) : r.k))).toEqual([
      'P0 traded 8 Sheep and 4 Wheat to the bank for 2 Brick and 1 Ore',
      'P0 traded 4 Ore to the bank for 1 Wood',
    ]);
  });
});
