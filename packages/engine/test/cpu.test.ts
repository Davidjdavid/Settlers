import { describe, expect, it } from 'vitest';
import {
  SCENARIOS, applyAction, cpuMove, geo, newCpuMemo, newGame, seedRng, viewFor, type Action, type CpuMemo,
  type GameState, type Seat,
} from '../src/index'; // prettier-ignore
import { cpuGame } from './cpuSim';
import { emptyBoard, setHand } from './helpers';
import { seatsFor } from './simulate';

/** A classic board in seat 0's main phase; `cpus` are CPU seats. */
function table(n: number, cpus: Seat[], stage: GameState['stage'] = 'main'): GameState {
  const s = emptyBoard(n);
  s.players.forEach((pl, i) => {
    if (cpus.includes(i)) pl.cpu = true;
    else delete pl.cpu;
  });
  s.stage = stage;
  return s;
}

/** Fill every corner with seat `owner` (the distance rule doesn't matter for these choices). */
function fill(s: GameState, owner: Seat) {
  s.verts = s.verts.map(() => [owner, 1]);
}

/** Memory for the board's current turn (emptyBoard starts at turn 1). */
const memo = (build = false): CpuMemo => ({ turnN: 1, buildTurn: build, built: false });
const move = (s: GameState, p: Seat, seed = 'x', m = memo()) => cpuMove(viewFor(s, p), seedRng(seed), m);
const ownersAround = (s: GameState, h: number) =>
  new Set(geo(s).hexVerts[h]!.flatMap((v) => (s.verts[v] ? [s.verts[v]![0]] : [])));

describe('CPU player: the robber', () => {
  it('goes to an empty hex when there is one', () => {
    for (let i = 0; i < 20; i++) {
      const s = table(3, [0], 'robber');
      s.robberReturn = 'main';
      const g = geo(s);
      // Seat 1 on every corner of the first 9 hexes; the rest are empty.
      for (let h = 0; h < 9; h++) for (const v of g.hexVerts[h]!) s.verts[v] = [1, 1];
      const a = move(s, 0, `r${i}`) as Extract<Action, { type: 'robber' }>;
      expect(a.type).toBe('robber');
      expect(ownersAround(s, a.hex).size).toBe(0);
    }
  });

  it('with no empty hex, goes to a hex only it uses', () => {
    const s = table(3, [0], 'robber');
    s.robberReturn = 'main';
    fill(s, 1);
    const h = 9;
    for (const v of geo(s).hexVerts[h]!) s.verts[v] = [0, 1];
    s.board.robber = 0;
    const a = move(s, 0) as Extract<Action, { type: 'robber' }>;
    expect(a.hex).toBe(h);
  });

  it('otherwise, its own hex shared with the fewest players', () => {
    const s = table(4, [0], 'robber');
    s.robberReturn = 'main';
    fill(s, 1);
    const g = geo(s);
    const v = g.hexVerts[9]![0]!;
    s.verts[v] = [0, 1];
    const mine = g.verts[v]!.hexes;
    // Every hex of seat 0's but one also has seats 2 and 3.
    const [easy, ...busy] = mine;
    for (const h of busy) {
      const others = g.hexVerts[h]!.filter((x) => !g.hexVerts[easy!]!.includes(x) && x !== v);
      s.verts[others[0]!] = [2, 1];
      s.verts[others[1]!] = [3, 1];
    }
    s.board.robber = g.hexes.findIndex((_, i) => !mine.includes(i));
    for (const seat of [1, 2, 3]) Object.assign(s, setHand(s, seat, { wood: 1 }));
    const a = move(s, 0) as Extract<Action, { type: 'robber' }>;
    expect(a.hex).toBe(easy);
    expect(a.victim ?? 1).toBe(1);
  });

  it('robs a CPU rather than a human when both are next to the robber', () => {
    const s = table(4, [0, 2], 'robber');
    s.robberReturn = 'main';
    fill(s, 1);
    const g = geo(s);
    const H = 9;
    const [v1, , v3] = g.hexVerts[H]!;
    s.verts[v1!] = [0, 1];
    s.verts[v3!] = [2, 1];
    // Seat 0's other hexes also have seat 3, so H (with CPU seat 2) is the best spot.
    for (const h of g.verts[v1!]!.hexes) {
      if (h === H) continue;
      const x = g.hexVerts[h]!.find((u) => !g.hexVerts[H]!.includes(u))!;
      s.verts[x] = [3, 1];
    }
    s.board.robber = g.hexes.findIndex((_, i) => !g.verts[v1!]!.hexes.includes(i));
    let t = s;
    for (const seat of [1, 2, 3]) t = setHand(t, seat, { wood: 2 });
    for (let i = 0; i < 10; i++) {
      const a = move(t, 0, `v${i}`) as Extract<Action, { type: 'robber' }>;
      expect(a.hex).toBe(H);
      expect(a.victim).toBe(2);
    }
  });

  it('plays a Knight only when the robber can go where nobody is robbed', () => {
    const s = table(3, [0], 'preroll');
    s.players[0]!.dev.knight = 1;
    s.deck.knight--;
    fill(s, 1); // every hex has a human
    for (let i = 0; i < 20; i++) expect(move(s, 0, `k${i}`)?.type).toBe('roll');
    const t = structuredClone(s);
    t.verts = t.verts.map(() => null); // now everything is empty
    const kinds = new Set(Array.from({ length: 20 }, (_, i) => move(t, 0, `k${i}`)?.type));
    expect(kinds.has('playKnight')).toBe(true);
  });

  it('judges the pirate by the same tiers (Seafarers)', () => {
    const s = structuredClone(newGame('cpu-sea', seatsFor(3), { map: SCENARIOS['heading-for-new-shores']! }));
    s.players[0]!.cpu = true;
    s.stage = 'robber';
    s.robberReturn = 'main';
    s.turnN = 5;
    s.setupI = 6;
    fill(s, 1); // every land hex is occupied by a human; open sea is empty
    const a = move(s, 0)!;
    expect(a.type).toBe('pirate');
  });
});

describe('CPU player: trading and the hand limit', () => {
  it('declines every offer and never offers', () => {
    let s = table(3, [1]);
    s = setHand(s, 0, { wood: 2 });
    s = setHand(s, 1, { ore: 3 });
    const r = applyAction(s, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 } });
    if (!r.ok) throw new Error(r.error);
    expect(move(r.state, 1)).toEqual({ type: 'respond', id: 1, yes: false });
  });

  it('trades with the bank at the end of its turn until under its limit, when it can', () => {
    let s = table(3, [0]);
    s = setHand(s, 0, { wood: 9 });
    const a = move(s, 0);
    expect(a).toMatchObject({ type: 'bank', give: 'wood' });
    // Two of each resource: over the limit, but no 4:1 trade possible, so it ends its turn.
    s = setHand(s, 0, { wood: 2, brick: 2, sheep: 2, wheat: 1, ore: 1 });
    s.players[0]!.pieces.city = 0; // nothing to build toward
    expect(move(s, 0)?.type).toBe('end');
  });

  it('builds only on its build turns, and trades toward a city then', () => {
    let s = table(3, [0]);
    const v = 10;
    s.verts[v] = [0, 1];
    s.edges[geo(s).verts[v]!.edges[0]!] = 0;
    s = setHand(s, 0, { wheat: 2, ore: 3 });
    expect(move(s, 0, 'b', memo(false))?.type).toBe('end');
    expect(move(s, 0, 'b', memo(true))).toEqual({ type: 'city', v });
    s = setHand(s, 0, { wheat: 2, ore: 2, brick: 4 });
    expect(move(s, 0, 'b', memo(true))).toMatchObject({ type: 'bank', give: 'brick', get: 'ore' });
  });
});

describe('CPU player: cards and knights', () => {
  it('never plays Monopoly', () => {
    const s = table(3, [0]);
    s.players[0]!.dev.mono = 1;
    s.deck.mono--;
    for (let i = 0; i < 20; i++) expect(move(s, 0, `m${i}`)?.type).not.toBe('playMono');
  });

  it('in Cities & Knights: activates knights, never plays a nasty card, leaves a human’s merchant alone', () => {
    const s = structuredClone(newGame('cpu-ck', seatsFor(3), { modules: ['citiesKnights'], winVP: 13 }));
    s.players[0]!.cpu = true;
    s.stage = 'main';
    s.turnN = 5;
    s.setupI = 6;
    const v = 10;
    s.verts[v] = [0, 2];
    s.edges[geo(s).verts[v]!.edges[0]!] = 0;
    const kv = geo(s).edges[geo(s).verts[v]!.edges[0]!]!;
    const spot = kv.a === v ? kv.b : kv.a;
    s.ck!.knights[spot] = { p: 0, lvl: 1, on: false };
    s.players[0]!.res.wheat = 1;
    s.bank.wheat--;
    expect(move(s, 0)).toEqual({ type: 'activate', v: spot });
    // Hand of cards it must never play, and a merchant held by a human.
    const t = structuredClone(s);
    t.ck!.knights[spot]!.on = true;
    const nasty = ['bishop', 'spy', 'wedding', 'saboteur', 'resourceMonopoly', 'merchant'] as const;
    for (const c of nasty) {
      const d = t.ck!.decks[c === 'resourceMonopoly' || c === 'merchant' ? 'trade' : 'politics'];
      d.splice(d.indexOf(c), 1);
      t.ck!.hands[0]!.push(c);
    }
    t.ck!.attacks = 1;
    t.ck!.merchant = { h: geo(t).verts[v]!.hexes[0]!, p: 1 };
    for (let i = 0; i < 20; i++) {
      const a = move(t, 0, `c${i}`);
      expect(a?.type === 'progress' ? a.card : null).toBeNull();
    }
  });
});

describe('CPU player: whole games', () => {
  it.each([
    ['classic', {}],
    ['Seafarers', { map: SCENARIOS['heading-for-new-shores']! }],
    ['Cities & Knights', { modules: ['citiesKnights' as const], winVP: 13 }],
    [
      'C&K + Seafarers',
      {
        map: SCENARIOS['heading-for-new-shores']!,
        modules: ['seafarers' as const, 'citiesKnights' as const],
        winVP: 17,
      },
    ],
  ])('plays %s games legally, following its rules', (_name, opts) => {
    for (let i = 0; i < 6; i++) {
      const r = cpuGame(`cpu-unit-${_name}-${i}`, 3 + (i % 2), 1 + (i % 2), { ...opts, maxTurns: 5000 });
      expect(r.errors).toEqual([]);
      expect(r.finished).toBe(true);
    }
  });

  it('loses most games against the basic test bot', () => {
    let three = 0;
    let two = 0;
    for (let i = 0; i < 150; i++) if (cpuGame(`cpu-lose3-${i}`, 3, 1, { hiddenRate: 0 }).cpuWon) three++;
    for (let i = 0; i < 150; i++) if (cpuGame(`cpu-lose2-${i}`, 2, 1, { hiddenRate: 0 }).cpuWon) two++;
    // A fair share would be 1 in 3 and 1 in 2.
    expect(three / 150).toBeLessThan(0.2);
    expect(two / 150).toBeLessThan(0.35);
  }, 120000);

  it('keeps nothing between calls except its memo', () => {
    const s = newGame(
      'cpu-memo',
      seatsFor(3).map((x, i) => (i === 0 ? { ...x, cpu: true } : x)),
    );
    const cpu = s.players.findIndex((p) => p.cpu);
    const a = cpuMove(viewFor(s, cpu), seedRng('m'), newCpuMemo());
    const b = cpuMove(viewFor(s, cpu), seedRng('m'), newCpuMemo());
    expect(a).toEqual(b);
  });
});
