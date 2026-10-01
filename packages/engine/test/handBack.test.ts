import { describe, expect, it } from 'vitest';
import {
  applyAction, checkInvariants, cpuMove, legalActions, newCpuMemo, newGame, seedRng, viewFor, type Action,
  type GameState, type HouseRules,
} from '../src/index'; // prettier-ignore
import { act, emptyBoard, reject, rigDice, setHand } from './helpers';
import { canonical, seatsFor } from './simulate';

/** A game in seat 0's main phase with hand-back on. */
function table(houseRules: HouseRules = { handBack: true }): GameState {
  const s = emptyBoard(3);
  s.config = { ...s.config, houseRules };
  return s;
}

/** Everything but the move count and the rules. */
const same = (s: GameState) => canonical({ ...s, seq: 0, config: null, back: null });

describe('handing the dice back', () => {
  it('restores the previous turn exactly: roll, cards, fresh cards, card played, offers', () => {
    let s = table();
    s = setHand(s, 0, { wood: 2, ore: 1, sheep: 1, wheat: 1 });
    s.players[0]!.fresh.knight = 1; // bought this turn
    s.deck.knight--;
    s.devPlayed = true;
    s = act(s, 0, { type: 'offer', give: { wood: 1 }, want: { brick: 1 } }).state;
    const before = s;
    s = act(s, 0, { type: 'end' }).state;
    expect(s.turn).toBe(1);
    expect(s.players[0]!.dev.knight).toBe(1); // now playable for the new turn…
    expect(viewFor(s, 2).back).toEqual({ from: 0, asked: false, refused: false });
    // …until the dice come back.
    s = act(s, 0, { type: 'askBack' }).state;
    const r = act(s, 1, { type: 'handBack' });
    expect(r.events).toEqual([{ k: 'handBack', p: 1, to: 0 }]);
    expect(same(r.state)).toBe(same(before));
    expect(r.state.players[0]!.fresh.knight).toBe(1);
    expect(r.state.devPlayed).toBe(true);
    expect(r.state.dice).toEqual(before.dice);
    expect(r.state.offers).toHaveLength(1);
    expect(r.state.back).toBeUndefined();
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('the new player can hand back without being asked, and can say no once', () => {
    let s = act(table(), 0, { type: 'end' }).state;
    expect(legalActions(s, 1)).toContainEqual({ type: 'handBack' });
    expect(legalActions(s, 1)).not.toContainEqual({ type: 'refuseBack' });
    s = act(s, 0, { type: 'askBack' }).state;
    expect(reject(s, 0, { type: 'askBack' })).toMatch(/already asked/);
    s = act(s, 1, { type: 'refuseBack' }).state;
    expect(reject(s, 0, { type: 'askBack' })).toMatch(/said no/);
    expect(legalActions(s, 0)).not.toContainEqual({ type: 'askBack' });
    // Still possible to change their mind and hand back unasked.
    expect(act(s, 1, { type: 'handBack' }).state.turn).toBe(0);
  });

  it('is refused after the new player rolls, plays a card or does anything else', () => {
    const ended = act(table(), 0, { type: 'end' }).state;
    // Rolled.
    const rolled = act(rigDice(ended, 5), 1, { type: 'roll' }).state;
    expect(rolled.back).toBeUndefined();
    expect(reject(rolled, 0, { type: 'askBack' })).toMatch(/can’t ask/);
    expect(reject(rolled, 1, { type: 'handBack' })).toMatch(/nothing to hand back/);
    // Played a card before rolling.
    const k = structuredClone(ended);
    k.players[1]!.dev.knight = 1;
    k.deck.knight--;
    const played = act(k, 1, { type: 'playKnight' }).state;
    expect(played.back).toBeUndefined();
    expect(legalActions(played, 1).some((a) => a.type === 'handBack')).toBe(false);
  });

  it('only the player just before may ask, and only one step back', () => {
    let s = act(table(), 0, { type: 'end' }).state;
    expect(reject(s, 2, { type: 'askBack' })).toMatch(/can’t ask/);
    expect(reject(s, 2, { type: 'handBack' })).toMatch(/Only the player with the dice/);
    s = act(rigDice(s, 5), 1, { type: 'roll' }).state;
    s = act(s, 1, { type: 'end' }).state;
    expect(s.back!.from).toBe(1);
    s = act(s, 2, { type: 'handBack' }).state;
    expect(s.turn).toBe(1);
    // Seat 1's turn is back; seat 0's earlier turn is gone for good.
    expect(s.back).toBeUndefined();
  });

  it('needs the rule; during setup only with the setup option', () => {
    expect(act(table({}), 0, { type: 'end' }).state.back).toBeUndefined();
    const setup = (houseRules: HouseRules) => {
      const g = newGame('hb-setup', seatsFor(3), { houseRules });
      return act(g, g.turn, legalActions(g, g.turn)[0]!).state;
    };
    expect(setup({ handBack: true }).back).toBeUndefined();
    const s = setup({ handBack: true, handBackSetup: true });
    expect(s.back?.from).toBe(0);
    const back = act(s, s.turn, { type: 'handBack' }).state;
    expect(back.verts.every((b) => !b)).toBe(true);
    expect(back.turn).toBe(0);
  });

  it('a CPU always hands the dice back when asked', () => {
    let s = table();
    s.players[1]!.cpu = true;
    s = act(s, 0, { type: 'end' }).state;
    expect(cpuMove(viewFor(s, 1), seedRng('x'), newCpuMemo())?.type).toBe('roll');
    s = act(s, 0, { type: 'askBack' }).state;
    expect(cpuMove(viewFor(s, 1), seedRng('x'), newCpuMemo())).toEqual({ type: 'handBack' });
  });

  it('the turn to restore is never in anyone’s view', () => {
    let s = table();
    s = setHand(s, 0, { ore: 3 });
    s = act(s, 0, { type: 'end' }).state;
    for (const seat of [0, 1, 2, null]) expect(JSON.stringify(viewFor(s, seat))).not.toContain('"state"');
  });
});

describe('changing game rules mid-game', () => {
  it('only on your turn; recorded as a move, so the game replays the same', () => {
    const g0 = newGame('rules', seatsFor(3));
    let s = g0;
    const log: [number, Action][] = [];
    const go = (p: number, a: Action) => {
      log.push([p, a]);
      s = act(s, p, a).state;
    };
    while (s.stage === 'setup') go(s.turn, legalActions(s, s.turn)[0]!);
    expect(reject(s, (s.turn + 1) % 3, { type: 'setRule', rule: 'bank3to1', value: true })).toMatch(
      /your turn/,
    );
    const r = applyAction(s, s.turn, { type: 'setRule', rule: 'bank3to1', value: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.events).toEqual([{ k: 'rule', p: s.turn, rule: 'bank3to1', value: true }]);
    go(s.turn, { type: 'setRule', rule: 'bank3to1', value: true });
    go(s.turn, { type: 'setRule', rule: 'winVP', value: 12 });
    expect(s.config).toEqual({ winVP: 12, houseRules: { bank3to1: true } });
    go(s.turn, { type: 'setRule', rule: 'bank3to1', value: false });
    expect(s.config).toEqual({ winVP: 12 });
    // Replay from the seed gives the same game.
    let t = newGame('rules', seatsFor(3));
    for (const [p, a] of log) t = act(t, p, a).state;
    expect(JSON.stringify(t)).toBe(JSON.stringify(s));
  });

  it('refuses rules for other expansions, bad values, and points at or below the top score', () => {
    const s = table({});
    expect(reject(s, 0, { type: 'setRule', rule: 'freeShipMoves', value: true })).toMatch(/Seafarers/);
    expect(reject(s, 0, { type: 'setRule', rule: 'barbarianDelay', value: 2 })).toMatch(/Cities & Knights/);
    expect(reject(s, 0, { type: 'setRule', rule: 'bank3to1', value: 3 })).toMatch(/valid/);
    s.verts[0] = [1, 2];
    s.verts[10] = [1, 2];
    s.verts[20] = [1, 2]; // seat 1 has 6 points
    expect(reject(s, 0, { type: 'setRule', rule: 'winVP', value: 6 })).toMatch(/more than 6/);
    expect(act(s, 0, { type: 'setRule', rule: 'winVP', value: 7 }).state.config.winVP).toBe(7);
  });

  it('turning hand-back off cancels a pending one, and the restored turn keeps the new rules', () => {
    let s = act(table(), 0, { type: 'end' }).state;
    s = act(s, 1, { type: 'setRule', rule: 'bank3to1', value: true }).state;
    expect(s.back).toBeDefined(); // a rule change isn't a move that ends the chance
    const back = act(s, 1, { type: 'handBack' }).state;
    expect(back.config.houseRules).toEqual({ handBack: true, bank3to1: true });
    expect(act(s, 1, { type: 'setRule', rule: 'handBack', value: false }).state.back).toBeUndefined();
  });
});
