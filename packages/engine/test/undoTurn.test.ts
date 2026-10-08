import { describe, expect, it } from 'vitest';
import fogMap from './fixtures/fog-test.json';
import {
  checkInvariants, edgeSides, geo, isLand, legalActions, newGame, stateFromView, viewFor, StatsFold, type Action,
  type GameEvent, type GameState, type MapData, type Seat,
} from '../src/index'; // prettier-ignore
import { act, emptyBoard, place, reject, rigDice, setHand } from './helpers';
import { canonical, seatsFor } from './simulate';

/** Seat 0 about to roll, with Undo and Undo my turn on, a road to build from and cards to spend. */
function table(rules: object = { undo: true, undoTurn: true }): GameState {
  let s = emptyBoard(3);
  s.config = { ...s.config, houseRules: rules };
  s.stage = 'preroll';
  const g = geo(s);
  s = place(s, 0, { settlements: [0], roads: [g.verts[0]!.edges[0]!] });
  s = place(s, 1, { settlements: [30], roads: [g.verts[30]!.edges[0]!] });
  s = setHand(s, 1, { wood: 2, ore: 1 });
  return setHand(s, 0, { wood: 4, brick: 4, sheep: 2, wheat: 2, ore: 2 });
}
/** Seat 0 has rolled (a 5: nothing for anyone) and is in the main part of the turn. */
const rolled = (s = table()) => act(rigDice(s, 5), 0, { type: 'roll' }).state;
const road = (s: GameState) => legalActions(s, 0).find((a) => a.type === 'road')!;
const askTurn: Action = { type: 'askUndo', turn: true };
/** Everything but the move count, the turn start and the random numbers. */
const same = (s: GameState) => canonical({ ...s, seq: 0, turnStart: null, rng: null, undo: null });
const yes = (s: GameState, p: Seat) => act(s, p, { type: 'answerUndo', yes: true });

describe('undo a whole turn (SPEC 13.2)', () => {
  it('starts once the roll is done, and takes back everything since, even a card bought', () => {
    const start = rolled();
    expect(start.turnStart).toMatchObject({ p: 0, turnN: start.turnN, seq: start.seq, n: 0 });
    expect(viewFor(start, 1).turnUndo).toEqual({ from: start.seq, n: 0 });
    // Nothing done yet: nothing to undo.
    expect(reject(start, 0, askTurn)).toMatch(/Nothing to undo/);
    let s = act(start, 0, road(start)).state;
    // One move that "Undo" covers: that's offered instead.
    expect(legalActions(s, 0)).toContainEqual({ type: 'askUndo' });
    expect(legalActions(s, 0)).not.toContainEqual(askTurn);
    expect(reject(s, 0, askTurn)).toMatch(/last move instead/);
    s = act(s, 0, { type: 'buyDev' }).state;
    expect(s.undo).toBeUndefined(); // buying showed a card: no plain undo
    expect(s.turnStart!.n).toBe(2);
    expect(legalActions(s, 0)).toContainEqual(askTurn);
    expect(legalActions(s, 1)).not.toContainEqual(askTurn); // only on your own turn
    s = act(s, 0, askTurn).state;
    expect(viewFor(s, 2).undo).toEqual({ p: 0, asked: true, ok: [], turn: true });
    expect(legalActions(s, 0)).toEqual(expect.arrayContaining([{ type: 'cancelUndo' }]));
    s = yes(s, 1).state;
    const r = yes(s, 2);
    expect(r.events.at(-1)).toEqual({ k: 'undo', p: 0, turn: true });
    expect(same(r.state)).toBe(same(start));
    expect(r.state.players[0]!.dev).toEqual(start.players[0]!.dev);
    expect(r.state.deck).toEqual(start.deck); // the card is back in the deck
    // The start stays: undo again later in the same turn.
    expect(r.state.turnStart).toMatchObject({ seq: start.seq, n: 0 });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('one “no” cancels; withdrawing, or any other move, cancels too, and it can be asked again', () => {
    let s = rolled();
    s = act(s, 0, road(s)).state;
    s = act(s, 0, road(s)).state;
    const asked = act(s, 0, askTurn).state;
    const no = act(asked, 1, { type: 'answerUndo', yes: false }).state;
    expect(no.undo).toBeUndefined();
    expect(no.edges.filter((x) => x === 0)).toHaveLength(3);
    expect(legalActions(no, 0)).toContainEqual(askTurn);
    const withdrawn = act(asked, 0, { type: 'cancelUndo' }).state;
    expect(withdrawn.undo).toBeUndefined();
    expect(legalActions(withdrawn, 0)).toContainEqual(askTurn);
    const moved = act(asked, 1, { type: 'offer', give: { wood: 1 }, want: { ore: 1 } }).state;
    expect(moved.undo).toBeUndefined();
    expect(moved.turnStart!.n).toBe(3); // the offer is a move of the turn too
    expect(reject(asked, 0, askTurn)).toMatch(/already asked/);
  });

  it('CPUs agree at once', () => {
    const t = table();
    t.players[1]!.cpu = true;
    t.players[2]!.cpu = true;
    let s = rolled(t);
    const start = s;
    s = act(s, 0, road(s)).state;
    s = act(s, 0, road(s)).state;
    const r = act(s, 0, askTurn);
    expect(r.events.map((e) => e.k)).toEqual(['askUndo', 'undo']);
    expect(same(r.state)).toBe(same(start));
  });

  it('a trade with a player and a robber after a Knight are taken back too; the roll stays', () => {
    let s = table();
    s.players[0]!.dev.knight = 1;
    s.deck.knight--;
    s = rolled(s);
    const start = s;
    s = act(s, 0, { type: 'offer', give: { brick: 1 }, want: { ore: 1 } }).state;
    s = act(s, 1, { type: 'respond', id: s.offers[0]!.id, yes: true }).state;
    s = act(s, 0, { type: 'confirm', id: s.offers[0]!.id, with: 1 }).state;
    s = act(s, 0, { type: 'playKnight' }).state;
    const steal = legalActions(s, 0).find((a) => a.type === 'robber' && a.victim === 1)!;
    s = act(s, 0, steal).state;
    expect(s.players[1]!.res).not.toEqual(start.players[1]!.res);
    expect(s.board.robber).not.toBe(start.board.robber);
    s = act(s, 0, askTurn).state;
    s = yes(s, 1).state;
    s = yes(s, 2).state;
    expect(same(s)).toBe(same(start));
    expect(s.dice).toEqual(start.dice);
    expect(s.stage).toBe('main');
    expect(s.players[0]!.dev.knight).toBe(1);
  });

  it('the hidden decks are shuffled, and the random numbers carry on', () => {
    // Seafarers fog: the stack is the same tiles, maybe in another order.
    let s = structuredClone(
      newGame('sea', seatsFor(3), {
        map: fogMap as unknown as MapData,
        houseRules: { undo: true, undoTurn: true },
      }),
    );
    s.stage = 'preroll';
    s.turnN = 5;
    s.setupI = 6;
    const g = geo(s);
    const v = g.verts.findIndex(
      (V) => V.hexes.some((h) => h < 19) && V.hexes.some((h) => s.board.hexes[h]!.t === 'fog'),
    );
    const e = g.verts[v]!.edges.find((x) => edgeSides(s, x).includes('fog') && edgeSides(s, x).some(isLand))!;
    s = place(s, 0, { settlements: [v] });
    s = setHand(s, 0, { wood: 2, brick: 2 });
    s = rolled(s);
    const start = s;
    s = act(s, 0, { type: 'road', e }).state;
    const found = s.board.hexes.filter((h, i) => h.t !== start.board.hexes[i]!.t);
    expect(found.length).toBeGreaterThan(0);
    s = act(s, 0, askTurn).state;
    s = yes(s, 1).state;
    s = yes(s, 2).state;
    expect(s.board.hexes).toEqual(start.board.hexes); // the fog is back
    const sorted = (a: unknown[]) => [...a].map(String).sort();
    expect(sorted(s.sea!.fog.terrain)).toEqual(sorted(start.sea!.fog.terrain));
    expect(sorted(s.sea!.fog.numbers)).toEqual(sorted(start.sea!.fog.numbers));
    expect(s.rng).not.toEqual(start.rng);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('survives handing the dice back', () => {
    let s = table({ undo: true, undoTurn: true, handBack: true });
    s = rolled(s);
    const start = s;
    s = act(s, 0, road(s)).state;
    s = act(s, 0, road(s)).state;
    s = act(s, 0, { type: 'end' }).state;
    expect(s.turnStart).toBeUndefined();
    s = act(s, 0, { type: 'askBack' }).state;
    s = act(s, 1, { type: 'handBack' }).state;
    expect(s.turnStart).toMatchObject({ p: 0, seq: start.seq, n: 2 });
    s = act(s, 0, askTurn).state;
    s = yes(s, 1).state;
    s = yes(s, 2).state;
    expect(same(s)).toBe(same(start));
  });

  it('stats go back with the turn', () => {
    // The fold sees the move that reached the start, then the turn.
    const pre = rigDice(table(), 5);
    const fold = new StatsFold(pre);
    let s = pre;
    const step = (p: Seat, a: Action): GameEvent[] => {
      const r = act(s, p, a);
      fold.step(s, p, a, r.events, r.state);
      s = r.state;
      return r.events;
    };
    step(0, { type: 'roll' });
    const atStart = JSON.stringify(fold.st);
    step(0, road(s));
    step(0, { type: 'buyDev' });
    expect(JSON.stringify(fold.st)).not.toBe(atStart);
    step(0, askTurn);
    step(1, { type: 'answerUndo', yes: true });
    expect(step(2, { type: 'answerUndo', yes: true }).at(-1)).toMatchObject({ k: 'undo', turn: true });
    expect(JSON.stringify(fold.st)).toBe(atStart);
    // And again, after more moves.
    step(0, road(s));
    step(0, road(s));
    step(0, askTurn);
    step(1, { type: 'answerUndo', yes: true });
    step(2, { type: 'answerUndo', yes: true });
    expect(JSON.stringify(fold.st)).toBe(atStart);
  });

  it('needs the rule (with Undo); games without it never get a start, and the start is never sent', () => {
    for (const rules of [{ undo: true }, { undoTurn: true }, {}]) {
      let s = rolled(table(rules));
      s = act(s, 0, road(s)).state;
      expect(s.turnStart).toBeUndefined();
      expect(viewFor(s, 0).turnUndo).toBeUndefined();
      expect(reject(s, 0, askTurn)).toMatch(/nothing of yours/);
    }
    let s = rolled();
    s = act(s, 0, road(s)).state;
    s = act(s, 0, road(s)).state;
    for (const seat of [0, 1, 2, null]) expect(JSON.stringify(viewFor(s, seat))).not.toContain('"state"');
    // Each screen works out its own buttons from its view.
    for (const seat of [0, 1, 2]) {
      const mine = legalActions(stateFromView(viewFor(s, seat)), seat);
      expect(mine.some((a) => a.type === 'askUndo' && a.turn)).toBe(seat === 0);
    }
    // Turning the rule off mid-turn drops the start.
    const off = act(s, 0, { type: 'setRule', rule: 'undoTurn', value: false }).state;
    expect(off.turnStart).toBeUndefined();
    expect(reject(off, 0, askTurn)).toMatch(/nothing of yours/);
  });
});
