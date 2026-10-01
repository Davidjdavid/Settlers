import { describe, expect, it } from 'vitest';
import {
  BASE_COORDS, checkInvariants, generateBaseBoard, geo, geometryFor, legalActions, newGame, numbersOK, roadLen,
  seedRng, snakeOrder, totalVP, type GameState,
} from '../src/index'; // prettier-ignore
import { act, afterSetup, edgePath, emptyBoard, place, reject, rigDice, setHand } from './helpers';
import { seatsFor } from './simulate';

describe('board', () => {
  it('has standard geometry', () => {
    const g = geometryFor(BASE_COORDS);
    expect(g.hexes).toHaveLength(19);
    expect(g.verts).toHaveLength(54);
    expect(g.edges).toHaveLength(72);
    expect(g.coast).toHaveLength(30);
  });

  it('generates legal boards', () => {
    for (let i = 0; i < 200; i++) {
      const b = generateBaseBoard(seedRng(`board-${i}`));
      const counts: Record<string, number> = {};
      for (const h of b.hexes) counts[h.t] = (counts[h.t] ?? 0) + 1;
      expect(counts).toEqual({ wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 });
      expect(b.hexes[b.robber]!.t).toBe('desert');
      expect(
        numbersOK(
          geometryFor(BASE_COORDS),
          b.hexes.map((h) => h.n),
        ),
      ).toBe(true);
      expect(new Set(b.ports.map((p) => p.e)).size).toBe(9);
      expect(b.ports.filter((p) => p.t === 'any')).toHaveLength(4);
    }
  });

  it('is deterministic for a seed', () => {
    expect(newGame('same', seatsFor(3))).toEqual(newGame('same', seatsFor(3)));
    expect(newGame('a', seatsFor(3)).board).not.toEqual(newGame('b', seatsFor(3)).board);
  });
});

describe('new game', () => {
  it('rejects bad seat lists', () => {
    expect(() => newGame('x', seatsFor(1))).toThrow();
    expect(() => newGame('x', [...seatsFor(4), { pid: 'p4', color: 'orange', nick: 'E' }])).toThrow();
    expect(() =>
      newGame('x', [
        { pid: 'a', color: 'red', nick: 'A' },
        { pid: 'b', color: 'red', nick: 'B' },
      ]),
    ).toThrow();
  });

  it('shuffles turn order from the seed', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++)
      orders.add(
        newGame(`order-${i}`, seatsFor(3))
          .players.map((p) => p.pid)
          .join(),
      );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('setup', () => {
  it('runs a snake draft and pays out the second settlement', () => {
    let s = newGame('setup', seatsFor(3));
    const order: number[] = [];
    while (s.stage === 'setup') {
      order.push(s.turn);
      const a = legalActions(s, s.turn)[0]!;
      const second = s.setupI >= 3;
      const r = act(s, s.turn, a);
      const ev = r.events.find((e) => e.k === 'setup')!;
      if (ev.k !== 'setup') throw new Error();
      if (second) expect(ev.got).not.toBeNull();
      else expect(ev.got).toBeNull();
      s = r.state;
    }
    expect(order).toEqual(snakeOrder(3));
    expect(s.stage).toBe('preroll');
    expect(s.turn).toBe(0);
  });

  it('enforces the distance rule and road placement', () => {
    let s = newGame('dist', seatsFor(2));
    const g = geo(s);
    const v = 10;
    s = act(s, 0, { type: 'setup', v, e: g.verts[v]!.edges[0]! }).state;
    const nb = g.verts[v]!.adj[0]!;
    expect(reject(s, 1, { type: 'setup', v: nb, e: g.verts[nb]!.edges[0]! })).toMatch(/free corner/);
    const far = 40;
    const notTouching = g.edges.findIndex((E) => E.a !== far && E.b !== far);
    expect(reject(s, 1, { type: 'setup', v: far, e: notTouching })).toMatch(/touch/);
    expect(reject(s, 0, { type: 'setup', v: far, e: g.verts[far]!.edges[0]! })).toMatch(/turn/);
  });
});

describe('rolling and production', () => {
  it('pays settlements 1 and cities 2', () => {
    let s = emptyBoard(2);
    s.stage = 'preroll';
    const hex = s.board.hexes.findIndex((h, i) => h.n === 8 && i !== s.board.robber);
    const [v1, , v3] = geo(s).hexVerts[hex]!;
    s = place(s, 0, { settlements: [v1!], roads: [geo(s).verts[v1!]!.edges[0]!] });
    s = place(s, 1, { cities: [v3!], roads: [geo(s).verts[v3!]!.edges[0]!] });
    const t = s.board.hexes[hex]!.t as 'wood';
    const before0 = s.players[0]!.res[t];
    const before1 = s.players[1]!.res[t];
    s = act(rigDice(s, 8), 0, { type: 'roll' }).state;
    expect(s.players[0]!.res[t]).toBeGreaterThanOrEqual(before0 + 1);
    expect(s.players[1]!.res[t]).toBeGreaterThanOrEqual(before1 + 2);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('applies the bank shortage rule', () => {
    let s = emptyBoard(2);
    s.stage = 'preroll';
    const hex = s.board.hexes.findIndex((h, i) => h.n === 6 && i !== s.board.robber);
    const t = s.board.hexes[hex]!.t as 'wood';
    const [v1, , v3] = geo(s).hexVerts[hex]!;
    s = place(s, 0, { cities: [v1!], roads: [geo(s).verts[v1!]!.edges[0]!] });
    s = place(s, 1, { settlements: [v3!], roads: [geo(s).verts[v3!]!.edges[0]!] });
    // Bank has 2 left; owed 3 in total to two players: nobody gets any.
    s = setHand(s, 0, { [t]: 17 });
    const r = act(rigDice(s, 6), 0, { type: 'roll' });
    expect(r.state.players[0]!.res[t]).toBe(17);
    expect(r.state.players[1]!.res[t]).toBe(0);
    expect(r.events).toContainEqual(expect.objectContaining({ k: 'produce', short: [t] }));

    // Only one player owed: they get what's left.
    let u = place(emptyBoard(2), 0, { cities: [v1!], roads: [geo(s).verts[v1!]!.edges[0]!] });
    u.stage = 'preroll';
    u = setHand(u, 1, { [t]: 18 });
    u = act(rigDice(u, 6), 0, { type: 'roll' }).state;
    expect(u.players[0]!.res[t]).toBe(1);
    expect(u.bank[t]).toBe(0);
  });

  it('robber hex produces nothing', () => {
    let s = emptyBoard(2);
    s.stage = 'preroll';
    const hex = s.board.hexes.findIndex((h) => h.n === 5);
    const v = geo(s).hexVerts[hex]![0]!;
    s = place(s, 0, { settlements: [v], roads: [geo(s).verts[v]!.edges[0]!] });
    s.board.robber = hex;
    s = act(rigDice(s, 5), 0, { type: 'roll' }).state;
    expect(s.players[0]!.res[s.board.hexes[hex]!.t as 'wood']).toBe(0);
  });
});

describe('seven, discards and the robber', () => {
  function sevenState(): GameState {
    let s = afterSetup(3);
    s = setHand(s, 0, { wood: 5, brick: 4 }); // 9 -> discard 4
    s = setHand(s, 1, { ore: 7 }); // 7 -> no discard
    s = setHand(s, 2, { sheep: 8, wheat: 3 }); // 11 -> discard 5
    return act(rigDice(s, 7), 0, { type: 'roll' }).state;
  }

  it('makes everyone over 7 discard half, simultaneously', () => {
    let s = sevenState();
    expect(s.stage).toBe('discard');
    expect(s.discard).toEqual({ 0: 4, 2: 5 });
    expect(reject(s, 1, { type: 'discard', cards: { ore: 3 } })).toMatch(/don’t need/);
    expect(reject(s, 2, { type: 'discard', cards: { sheep: 4 } })).toMatch(/exactly 5/);
    expect(reject(s, 2, { type: 'discard', cards: { wheat: 5 } })).toMatch(/don’t have/);
    expect(reject(s, 0, { type: 'robber', hex: 0 })).toMatch(/robber/);
    const r = act(s, 2, { type: 'discard', cards: { sheep: 4, wheat: 1 } });
    expect(r.events).toContainEqual({
      k: 'discard',
      p: 2,
      c: { wood: 0, brick: 0, sheep: 4, wheat: 1, ore: 0 },
    });
    s = act(r.state, 0, { type: 'discard', cards: { wood: 2, brick: 2 } }).state;
    expect(s.stage).toBe('robber');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('must move the robber and steal from an adjacent player with cards', () => {
    let s = sevenState();
    s = act(s, 2, { type: 'discard', cards: { sheep: 5 } }).state;
    s = act(s, 0, { type: 'discard', cards: { wood: 4 } }).state;
    expect(reject(s, 0, { type: 'robber', hex: s.board.robber })).toMatch(/different/);
    const robs = legalActions(s, 0).filter((a) => a.type === 'robber' && a.victim != null);
    const a = robs[0]!;
    if (a.type !== 'robber') throw new Error();
    const r = act(s, 0, a);
    const steal = r.events.find((e) => e.k === 'steal')!;
    expect(steal).toMatchObject({ p: 0, from: a.victim });
    expect(r.state.stage).toBe('main');
    expect(totalHand(r.state, 0)).toBe(totalHand(s, 0) + 1);
  });
});

const totalHand = (s: GameState, p: number) => Object.values(s.players[p]!.res).reduce((a, b) => a + b, 0);

describe('building', () => {
  it('requires resources, connection and the distance rule', () => {
    let s = afterSetup(2);
    s = act(rigDice(s, 2), 0, { type: 'roll' }).state;
    s = setHand(s, 0, {});
    expect(reject(s, 0, { type: 'road', e: 0 })).toMatch(/costs/);
    s = setHand(s, 0, { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 });
    const notMine = geo(s).edges.findIndex(
      (_, e) => !legalActions(s, 0).some((a) => a.type === 'road' && a.e === e) && s.edges[e] == null,
    );
    expect(reject(s, 0, { type: 'road', e: notMine })).toMatch(/connect/);
    expect(reject(s, 1, { type: 'road', e: 0 })).toMatch(/turn/);
    const city = s.verts.findIndex((b) => b && b[0] === 0);
    s = act(s, 0, { type: 'city', v: city }).state;
    expect(s.verts[city]).toEqual([0, 2]);
    expect(s.players[0]!.pieces).toMatchObject({ settlement: 4, city: 3 });
    expect(checkInvariants(s)).toEqual([]);
  });

  it('roads cannot pass through an opponent building', () => {
    let s = emptyBoard(2);
    const { edges, verts } = edgePath(s, 0, 2);
    s = place(s, 0, { settlements: [verts[0]!], roads: [edges[0]!] });
    s = place(s, 1, {
      settlements: [verts[1]!],
      roads: [geo(s).verts[verts[1]!]!.edges.find((e) => e !== edges[0] && e !== edges[1])!],
    });
    s = setHand(s, 0, { wood: 1, brick: 1 });
    expect(reject(s, 0, { type: 'road', e: edges[1]! })).toMatch(/connect/);
  });
});

describe('longest road', () => {
  it('needs 5, ties keep the holder, breaking it can leave nobody', () => {
    let s = emptyBoard(3);
    const a = edgePath(s, 0, 6);
    s = place(s, 0, { settlements: [a.verts[0]!], roads: a.edges.slice(0, 4) });
    s = setHand(s, 0, { wood: 2, brick: 2 });
    s = act(s, 0, { type: 'road', e: a.edges[4]! }).state;
    expect(roadLen(s, 0)).toBe(5);
    expect(s.longest).toBe(0);

    // Player 1 builds an equal road elsewhere: player 0 keeps it.
    const used = new Set(a.verts.flatMap((v) => [v, ...geo(s).verts[v]!.adj]));
    const startB = geo(s).verts.findIndex((_, v) => !used.has(v) && edgePathSafe(s, v, 6, used));
    const b = edgePath(s, startB, 6, used);
    s = place(s, 1, { settlements: [b.verts[0]!], roads: b.edges.slice(0, 4) });
    s.turn = 1;
    s = setHand(s, 1, { wood: 2, brick: 2 });
    s = act(s, 1, { type: 'road', e: b.edges[4]! }).state;
    expect(roadLen(s, 1)).toBe(5);
    expect(s.longest).toBe(0);

    // Player 1 goes to 6 and takes it.
    s = act(s, 1, { type: 'road', e: b.edges[5]! }).state;
    expect(s.longest).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('passes when a settlement breaks the road, and nobody holds it on a tie', () => {
    // Find a 7-road for player 0 with a middle corner that player 1 can reach by a 2-road spur.
    const base = emptyBoard(2);
    const g = geo(base);
    let found: { a: ReturnType<typeof edgePath>; mid: number; spur: number[]; home: number } | null = null;
    for (let start = 0; start < g.verts.length && !found; start++) {
      if (!edgePathSafe(base, start, 7, new Set())) continue;
      const a = edgePath(base, start, 7);
      for (const i of [3, 4]) {
        const mid = a.verts[i]!;
        for (const e1 of g.verts[mid]!.edges) {
          if (a.edges.includes(e1)) continue;
          const w = g.edges[e1]!.a === mid ? g.edges[e1]!.b : g.edges[e1]!.a;
          for (const e2 of g.verts[w]!.edges) {
            const x = g.edges[e2]!.a === w ? g.edges[e2]!.b : g.edges[e2]!.a;
            if (x === mid || a.verts.includes(x) || g.verts[x]!.adj.some((u) => a.verts.includes(u)))
              continue;
            found = { a, mid, spur: [e2, e1], home: x };
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
    }
    if (!found) throw new Error('no suitable position on the board');
    const { a, mid, spur, home } = found;
    let s = place(base, 0, { settlements: [a.verts[0]!], roads: a.edges });
    s = place(s, 1, { settlements: [home], roads: spur });
    s.longest = 0;
    s.turn = 1;
    s = setHand(s, 1, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
    const r = act(s, 1, { type: 'settlement', v: mid });
    expect(roadLen(r.state, 0)).toBeLessThan(5);
    expect(r.state.longest).toBe(null);
    expect(r.events).toContainEqual({ k: 'longest', p: null, n: 0, from: 0 });
    expect(checkInvariants(r.state)).toEqual([]);
  });
});

function edgePathSafe(s: GameState, v: number, len: number, avoid: Set<number>): boolean {
  try {
    edgePath(s, v, len, avoid);
    return true;
  } catch {
    return false;
  }
}

describe('development cards', () => {
  function mainWith(devs: Partial<Record<'knight' | 'road' | 'plenty' | 'mono', number>>): GameState {
    let s = afterSetup(3);
    s = act(rigDice(s, 2), 0, { type: 'roll' }).state;
    for (const [k, n] of Object.entries(devs)) {
      s.players[0]!.dev[k as 'knight'] += n;
      s.deck[k as 'knight'] -= n;
    }
    return s;
  }

  it('one per turn, not the turn it was bought', () => {
    let s = mainWith({});
    s = setHand(s, 0, { sheep: 1, wheat: 1, ore: 1 });
    s.deck = { knight: 1, road: 0, plenty: 0, mono: 0, vp: 0 };
    const bought = act(s, 0, { type: 'buyDev' });
    expect(bought.events).toEqual([{ k: 'buyDev', p: 0, card: 'knight' }]);
    expect(reject(bought.state, 0, { type: 'playKnight' })).toMatch(/next turn/);
    // It becomes playable once the turn passes.
    const next = act(bought.state, 0, { type: 'end' }).state;
    expect(next.players[0]!.dev.knight).toBe(1);

    s = mainWith({ knight: 2 });
    s = act(s, 0, { type: 'playKnight' }).state;
    expect(s.stage).toBe('robber');
    const rob = legalActions(s, 0).find((a) => a.type === 'robber')!;
    s = act(s, 0, rob).state;
    expect(reject(s, 0, { type: 'playKnight' })).toMatch(/one development card/);
  });

  it('knight can be played before rolling and returns to preroll', () => {
    let s = afterSetup(2);
    s.players[0]!.dev.knight = 1;
    s.deck.knight--;
    s = act(s, 0, { type: 'playKnight' }).state;
    s = act(
      s,
      0,
      legalActions(s, 0).find((a) => a.type === 'robber')!,
    ).state;
    expect(s.stage).toBe('preroll');
  });

  it('largest army at 3 knights, must beat the holder', () => {
    let s = mainWith({ knight: 3 });
    for (let i = 0; i < 3; i++) {
      s = act(s, 0, { type: 'playKnight' }).state;
      s = act(
        s,
        0,
        legalActions(s, 0).find((a) => a.type === 'robber')!,
      ).state;
      s.devPlayed = false;
    }
    expect(s.largest).toBe(0);
    s.players[1]!.knights = 3;
    s.players[1]!.dev.knight = 1;
    s.deck.knight -= 4; // keep dev cards conserved: 3 played + 1 held by player 1
    s.turn = 1;
    s.stage = 'main';
    s = act(s, 1, { type: 'playKnight' }).state;
    expect(s.largest).toBe(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('road building, year of plenty and monopoly', () => {
    let s = mainWith({ road: 1 });
    s = act(s, 0, { type: 'playRoads' }).state;
    expect(s.stage).toBe('roads');
    s = act(
      s,
      0,
      legalActions(s, 0).find((a) => a.type === 'freeRoad')!,
    ).state;
    s = act(
      s,
      0,
      legalActions(s, 0).find((a) => a.type === 'freeRoad')!,
    ).state;
    expect(s.stage).toBe('main');
    expect(s.players[0]!.pieces.road).toBe(11);

    s = mainWith({ plenty: 1 });
    const ore0 = s.players[0]!.res.ore;
    s = act(s, 0, { type: 'playPlenty', r1: 'ore', r2: 'ore' }).state;
    expect(s.players[0]!.res.ore).toBe(ore0 + 2);

    s = mainWith({ mono: 1 });
    s = setHand(setHand(setHand(s, 0, {}), 1, { wheat: 3 }), 2, { wheat: 2, ore: 1 });
    const r = act(s, 0, { type: 'playMono', r: 'wheat' });
    expect(r.state.players[0]!.res.wheat).toBe(5);
    expect(r.state.players[2]!.res).toMatchObject({ wheat: 0, ore: 1 });
    expect(r.events).toContainEqual({ k: 'mono', p: 0, r: 'wheat', from: { 1: 3, 2: 2 } });
  });
});

describe('trading', () => {
  function main(): GameState {
    let s = afterSetup(3);
    s = act(rigDice(s, 2), 0, { type: 'roll' }).state;
    s = setHand(s, 0, { wood: 4, brick: 1 });
    s = setHand(s, 1, { ore: 2 });
    s = setHand(s, 2, { ore: 1, sheep: 1 });
    return s;
  }

  it('bank trades at 4:1 without ports', () => {
    let s = main();
    s.board.ports = [];
    s = act(s, 0, { type: 'bank', give: 'wood', get: 'ore' }).state;
    expect(s.players[0]!.res).toMatchObject({ wood: 0, ore: 1 });
    expect(reject(s, 0, { type: 'bank', give: 'brick', get: 'ore' })).toMatch(/need 4/);
  });

  it('ports give 3:1 and 2:1', () => {
    let s = main();
    const g = geo(s);
    const port = s.board.ports.find((p) => p.t === 'wood')!;
    const v = g.edges[port.e]!.a;
    s = place(s, 0, { settlements: [v], roads: [port.e] });
    s = setHand(s, 0, { wood: 2 });
    s = act(s, 0, { type: 'bank', give: 'wood', get: 'ore' }).state;
    expect(s.players[0]!.res).toMatchObject({ wood: 0, ore: 1 });
  });

  it('offer, accept, confirm', () => {
    let s = main();
    s = act(s, 0, { type: 'offer', give: { wood: 2 }, want: { ore: 1 } }).state;
    const id = s.offers[0]!.id;
    expect(reject(s, 0, { type: 'confirm', id, with: 1 })).toMatch(/haven’t accepted/);
    s = act(s, 1, { type: 'respond', id, yes: true }).state;
    s = act(s, 2, { type: 'respond', id, yes: false }).state;
    expect(reject(s, 0, { type: 'confirm', id, with: 2 })).toMatch(/haven’t accepted/);
    const r = act(s, 0, { type: 'confirm', id, with: 1 });
    expect(r.state.players[0]!.res).toMatchObject({ wood: 2, ore: 1 });
    expect(r.state.players[1]!.res).toMatchObject({ wood: 2, ore: 1 });
    expect(r.state.offers).toEqual([]);
  });

  it('other players can offer to the current player', () => {
    let s = main();
    s = act(s, 2, { type: 'offer', give: { sheep: 1 }, want: { wood: 1 } }).state;
    const id = s.offers[0]!.id;
    expect(reject(s, 1, { type: 'respond', id, yes: true })).toMatch(/whose turn/);
    s = act(s, 0, { type: 'respond', id, yes: true }).state;
    expect(s.players[2]!.res).toMatchObject({ sheep: 0, wood: 1 });
  });

  it('rejects bad offers and trades outside the main phase', () => {
    let s = main();
    expect(reject(s, 0, { type: 'offer', give: { wood: 1 }, want: { wood: 1 } })).toMatch(/same resource/);
    expect(reject(s, 0, { type: 'offer', give: { ore: 1 }, want: { wood: 1 } })).toMatch(/don’t have/);
    expect(reject(s, 0, { type: 'offer', give: { wood: -1 }, want: { ore: 1 } })).toMatch(/Choose/);
    s = act(s, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 } }).state;
    s.players[0]!.dev.knight = 1;
    s.deck.knight--;
    s = act(s, 0, { type: 'playKnight' }).state;
    expect(reject(s, 1, { type: 'respond', id: s.offers[0]!.id, yes: true })).toMatch(/Finish/);
  });

  it('offers clear at end of turn', () => {
    let s = main();
    s = act(s, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 } }).state;
    s = act(s, 0, { type: 'end' }).state;
    expect(s.offers).toEqual([]);
  });
});

describe('winning', () => {
  it('a player wins on their own turn at 10 VP', () => {
    let s = afterSetup(2);
    s = act(rigDice(s, 2), 0, { type: 'roll' }).state;
    // 2 settlements + 7 VP cards = 9; the last card in the deck is a VP card.
    s.players[0]!.vpCards = 7;
    s.deck = { knight: 0, road: 0, plenty: 0, mono: 0, vp: 1 };
    s = setHand(s, 0, { sheep: 1, wheat: 1, ore: 1 });
    expect(totalVP(s, 0)).toBe(9);
    const r = act(s, 0, { type: 'buyDev' });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(0);
    expect(r.events.at(-1)).toMatchObject({ k: 'win', p: 0, vp: 10 });
    expect(reject(r.state, 1, { type: 'roll' })).toMatch(/over/);
  });

  it('a player at 10 on someone else’s turn wins when their turn starts', () => {
    let s = afterSetup(2);
    s = act(rigDice(s, 2), 0, { type: 'roll' }).state;
    s.players[1]!.vpCards = 8; // 2 settlements + 8
    s.deck.vp = 0;
    const r = act(s, 0, { type: 'end' });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(1);
  });
});
