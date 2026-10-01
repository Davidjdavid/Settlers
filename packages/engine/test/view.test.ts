import { describe, expect, it } from 'vitest';
import { eventFor, legalActions, viewFor, type GameEvent } from '../src/index';
import { act, afterSetup, rigDice, setHand } from './helpers';

describe('viewFor', () => {
  it('shows your own hand and only counts for others', () => {
    let s = afterSetup(3);
    s = setHand(s, 1, { ore: 3, wheat: 1 });
    s.players[1]!.dev.knight = 1;
    s.players[1]!.vpCards = 1;
    s.deck.knight--;
    s.deck.vp--;
    const v0 = viewFor(s, 0);
    const v1 = viewFor(s, 1);
    expect(v1.hand?.res).toMatchObject({ ore: 3, wheat: 1 });
    expect(v1.hand?.vpCards).toBe(1);
    expect(v0.hand?.res).not.toMatchObject({ ore: 3, wheat: 1 });
    expect(v0.players[1]).toMatchObject({ resCount: 4, devCount: 2, vpCards: null });
    const json = JSON.stringify(v0);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"deck"');
    expect(v0.deckCount).toBe(23);
  });

  it('spectators see no hand', () => {
    expect(viewFor(afterSetup(2), null).hand).toBeNull();
  });

  it('reveals VP cards when the game is over', () => {
    let s = afterSetup(2);
    s = act(rigDice(s, 2), 0, { type: 'roll' }).state;
    s.players[1]!.vpCards = 8;
    s.deck.vp = 0;
    s = act(s, 0, { type: 'end' }).state;
    expect(viewFor(s, 0).players[1]!.vpCards).toBe(8);
  });

  it('does not share state objects with the game', () => {
    const s = afterSetup(2);
    const v = viewFor(s, 0);
    v.board.hexes[0]!.n = 99;
    expect(s.board.hexes[0]!.n).not.toBe(99);
  });
});

describe('event redaction', () => {
  it('steals are visible only to thief and victim', () => {
    const e: GameEvent = { k: 'steal', p: 0, from: 1, r: 'ore' };
    expect(eventFor(e, 0)).toMatchObject({ r: 'ore' });
    expect(eventFor(e, 1)).toMatchObject({ r: 'ore' });
    expect(eventFor(e, 2)).toMatchObject({ r: null });
    expect(eventFor(e, null)).toMatchObject({ r: null });
  });

  it('bought dev cards are visible only to the buyer', () => {
    const e: GameEvent = { k: 'buyDev', p: 2, card: 'vp' };
    expect(eventFor(e, 2)).toMatchObject({ card: 'vp' });
    expect(eventFor(e, 0)).toMatchObject({ card: null });
  });

  it('discards are public', () => {
    let s = afterSetup(2);
    s = setHand(s, 1, { wood: 8 });
    s = act(rigDice(s, 7), 0, { type: 'roll' }).state;
    const r = act(s, 1, { type: 'discard', cards: { wood: 4 } });
    expect(eventFor(r.events[0]!, 0)).toMatchObject({ k: 'discard', p: 1, c: { wood: 4 } });
    expect(legalActions(r.state, 0).some((a) => a.type === 'robber')).toBe(true);
  });
});
