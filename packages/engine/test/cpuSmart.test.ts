import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HARD, MEDIUM, SCENARIOS, cpuMove, cpuObserve, eventsFor, geo, newCpuMemo, newGame, pips,
  seedRng, viewFor, type Action, type CpuBrain, type CpuMemo, type CpuOptions, type GameState, type Seat,
} from '../src/index'; // prettier-ignore
import { cpuGame } from './cpuSim';
import { act, emptyBoard, place, setHand } from './helpers';
import { seatsFor } from './simulate';

const ON: CpuOptions = { trading: true, oneOffer: true };
const OFF: CpuOptions = { trading: false, oneOffer: true };

const move = (s: GameState, p: Seat, brain: CpuBrain = MEDIUM, opts = ON, m = newCpuMemo(), seed = 'x') =>
  cpuMove(viewFor(s, p), seedRng(seed), m, brain, opts);

/** An empty classic board, seat 0 to move in its main phase; `cpus` are CPU seats. */
function table(n: number, cpus: Seat[]): GameState {
  const s = emptyBoard(n);
  s.players.forEach((pl, i) => {
    if (cpus.includes(i)) pl.cpu = true;
    else delete pl.cpu;
  });
  return s;
}

/** Corners far apart (no two adjacent), for placing buildings directly. */
function spread(s: GameState, count: number, avoid: number[] = []): number[] {
  const g = geo(s);
  const out: number[] = [];
  const near = new Set(avoid.flatMap((v) => [v, ...g.verts[v]!.adj]));
  for (let v = 0; v < g.verts.length && out.length < count; v++) {
    if (near.has(v)) continue;
    out.push(v);
    near.add(v);
    for (const u of g.verts[v]!.adj) near.add(u);
  }
  return out;
}

/* ---------- The CPU code can only see its own screen (docs/bot-medium-hard.md §1.1) ---------- */

const FORBIDDEN_NAMES = [
  'viewFor',
  'eventsFor',
  'eventFor',
  'newGame',
  'applyAction',
  'seedRng',
  'perturbHidden',
];

/** Problems with a CPU source file's imports: anything that could reach the real game. */
export function importProblems(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
    const names = m[2]!.split(',').map((x) => x.trim().replace(/^type\s+/, ''));
    for (const n of names) if (FORBIDDEN_NAMES.includes(n)) bad.push(`imports ${n}`);
    if (/(^|\/)rules$/.test(m[3]!) || m[3]!.startsWith('node:')) bad.push(`imports from ${m[3]}`);
  }
  if (/Math\.random|Date\.now|new Date/.test(src)) bad.push('uses the clock or Math.random');
  return bad;
}

describe('CPU players see only their own view', () => {
  it('no CPU file imports the game state, viewFor, the rules or the game’s random numbers', () => {
    const dir = new URL('../src/cpu/', import.meta.url);
    const files = [
      new URL('../src/cpu.ts', import.meta.url),
      ...readdirSync(dir).map((f) => new URL(f, dir)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) expect(importProblems(readFileSync(f, 'utf8')), String(f)).toEqual([]);
  });

  it('the import check catches a planted import', () => {
    expect(importProblems(`import { stateFromView, viewFor } from '../view';`)).toEqual(['imports viewFor']);
    expect(importProblems(`import { applyAction } from '../rules';`)).toHaveLength(2);
    expect(importProblems(`const x = Math.random();`)).toHaveLength(1);
  });

  for (const [name, brain] of [
    ['Medium', MEDIUM],
    ['Hard', HARD],
  ] as const) {
    for (const mode of ['classic', 'seafarers', 'ck', 'full'] as const) {
      it(`${name} makes the same move when everything it can't see changes (${mode})`, () => {
        const map =
          mode === 'seafarers' || mode === 'full' ? { map: SCENARIOS['heading-for-new-shores']! } : {};
        const modules =
          mode === 'ck'
            ? { modules: ['citiesKnights' as const] }
            : mode === 'full'
              ? { modules: ['seafarers' as const, 'citiesKnights' as const] }
              : {};
        const n = 4;
        const r = cpuGame(`nocheat-${name}-${mode}`, n, n, {
          ...map,
          ...modules,
          ...(mode === 'ck' ? { winVP: 10 } : mode === 'full' ? { winVP: 12 } : {}),
          brains: [brain, brain, 'bot', brain],
          hiddenRate: 1,
          maxTurns: 1500,
        });
        expect(r.errors).toEqual([]);
        expect(r.finished).toBe(true);
        expect(r.checked.hidden).toBeGreaterThan(100);
      });
    }
  }
});

/* ---------- Trading with people (§1.2, §2.6) ---------- */

describe('Medium trading', () => {
  /** Seat 1 (Medium) has a settlement and is one ore short of a city; seat 0 offers it ore. */
  function offered(give: Record<string, number>, want: Record<string, number>, seat0VP = 0) {
    let s = table(3, [1]);
    const [v1, ...rest] = spread(s, 1 + seat0VP / 2);
    s = place(s, 1, { settlements: [v1!] });
    if (seat0VP) s = place(s, 0, { cities: rest });
    s = setHand(s, 1, { wheat: 2, ore: 2, sheep: 2 });
    s = setHand(s, 0, { ore: 2, wood: 2 });
    s = act(s, 0, { type: 'offer', give, want }).state;
    return s;
  }

  it('accepts a fair offer that helps its next build', () => {
    const s = offered({ ore: 1 }, { sheep: 1 });
    expect(move(s, 1)).toEqual({ type: 'respond', id: s.offers[0]!.id, yes: true });
  });

  it('declines when CPU trading is off', () => {
    const s = offered({ ore: 1 }, { sheep: 1 });
    expect(move(s, 1, MEDIUM, OFF)).toEqual({ type: 'respond', id: s.offers[0]!.id, yes: false });
  });

  it('declines an offer that asks more than it gives', () => {
    const s = offered({ ore: 1 }, { sheep: 2 });
    expect(move(s, 1)).toMatchObject({ type: 'respond', yes: false });
  });

  it('declines an offer that doesn’t help', () => {
    const s = offered({ wood: 1 }, { sheep: 1 });
    expect(move(s, 1)).toMatchObject({ type: 'respond', yes: false });
  });

  it('never trades with someone within 2 points of winning', () => {
    const s = offered({ ore: 1 }, { sheep: 1 }, 8);
    expect(viewFor(s, 1).players[0]!.publicVP).toBe(8);
    expect(move(s, 1)).toMatchObject({ type: 'respond', yes: false });
  });

  it('a custom CPU that never trades declines', () => {
    const s = offered({ ore: 1 }, { sheep: 1 });
    expect(move(s, 1, { ...MEDIUM, trading: 'never' })).toMatchObject({ type: 'respond', yes: false });
  });

  /** Seat 0 (Medium) to move, one ore short of a city with sheep to spare. */
  function short() {
    let s = table(3, [0]);
    s = place(s, 0, { settlements: [spread(s, 1)[0]!] });
    return setHand(s, 0, { wheat: 2, ore: 2, sheep: 3 });
  }

  it('offers once per turn, to everyone, and withdraws it when everyone says no', () => {
    let s = short();
    const memo = newCpuMemo();
    const offer = move(s, 0, MEDIUM, ON, memo);
    expect(offer).toEqual({ type: 'offer', give: { sheep: 2 }, want: { ore: 1 } });
    s = act(s, 0, offer!).state;
    const id = s.offers[0]!.id;
    // Waiting for answers.
    expect(move(s, 0, MEDIUM, ON, memo)).toBeNull();
    s = act(s, 1, { type: 'respond', id, yes: false }).state;
    s = act(s, 2, { type: 'respond', id, yes: false }).state;
    expect(move(s, 0, MEDIUM, ON, memo)).toEqual({ type: 'cancel', id });
    s = act(s, 0, { type: 'cancel', id }).state;
    // No second offer this turn: it ends.
    expect(move(s, 0, MEDIUM, ON, memo)).toEqual({ type: 'end' });
    // With "one offer per turn" off it still never repeats the same offer.
    expect(move(s, 0, MEDIUM, { ...ON, oneOffer: false }, memo)).toEqual({ type: 'end' });
  });

  it('takes the first acceptable answer, and gives up waiting when told to', () => {
    let s = short();
    const memo = newCpuMemo();
    s = act(s, 0, move(s, 0, MEDIUM, ON, memo)!).state;
    const id = s.offers[0]!.id;
    expect(move(s, 0, MEDIUM, { ...ON, offerTimeout: true }, memo)).toEqual({ type: 'cancel', id });
    s = setHand(s, 2, { ore: 1 });
    s = act(s, 2, { type: 'respond', id, yes: true }).state;
    expect(move(s, 0, MEDIUM, ON, memo)).toEqual({ type: 'confirm', id, with: 2 });
  });

  it('makes no offer with CPU trading off', () => {
    const s = short();
    expect(move(s, 0, MEDIUM, OFF)).toEqual({ type: 'end' });
  });
});

/* ---------- The robber (D1) ---------- */

describe('The robber', () => {
  /** Seat 0 (the CPU) places the robber; seat 2 is ahead with `lead` cities. */
  function robbing(lead: number) {
    let s = table(4, [0]);
    s.stage = 'robber';
    s.robberReturn = 'main';
    const vs = spread(s, 3 + lead);
    s = place(s, 0, { settlements: [vs[0]!] });
    s = place(s, 1, { settlements: [vs[1]!] });
    s = place(s, 2, { cities: vs.slice(2, 2 + lead) });
    s = place(s, 3, { settlements: [vs[2 + lead]!] });
    for (const p of [1, 2, 3]) s = setHand(s, p, { wood: 2 });
    return s;
  }
  const owners = (s: GameState, h: number) =>
    new Set(geo(s).hexVerts[h]!.flatMap((v) => (s.verts[v] ? [s.verts[v]![0]] : [])));

  it('Medium robs nobody while no one is within 3 points of winning', () => {
    const s = robbing(2); // seat 2 has 4 points
    const a = move(s, 0) as Extract<Action, { type: 'robber' }>;
    expect(a.type).toBe('robber');
    expect(owners(s, a.hex).size).toBe(0);
  });

  it('Medium goes after whoever is ahead once someone is close', () => {
    const s = robbing(4); // seat 2 has 8 points
    const a = move(s, 0) as Extract<Action, { type: 'robber' }>;
    expect(owners(s, a.hex).has(2)).toBe(true);
    expect(owners(s, a.hex).has(0)).toBe(false);
    expect(a.victim).toBe(2);
  });

  it('Hard always goes after the leader', () => {
    const s = robbing(2);
    const a = move(s, 0, HARD) as Extract<Action, { type: 'robber' }>;
    expect(owners(s, a.hex).has(2)).toBe(true);
    expect(a.victim).toBe(2);
  });

  it('a gentle custom CPU never robs anyone it can avoid', () => {
    const s = robbing(4);
    const a = move(s, 0, { ...HARD, robber: 'gentle' }) as Extract<Action, { type: 'robber' }>;
    expect(owners(s, a.hex).size).toBe(0);
  });
});

/* ---------- Starting spots (§2.1) ---------- */

describe('Starting spots', () => {
  it('Medium and Hard start on rich corners, not random ones', () => {
    for (const brain of [MEDIUM, HARD]) {
      for (let i = 0; i < 10; i++) {
        const s = newGame(
          `setup-${i}`,
          seatsFor(3).map((x, k) => (k === 0 ? { ...x, cpu: true } : x)),
        );
        const g = geo(s);
        const pipsAt = (v: number) =>
          g.verts[v]!.hexes.reduce((a, h) => a + (h === s.board.robber ? 0 : pips(s.board.hexes[h]!.n)), 0);
        const all = g.verts.map((_, v) => pipsAt(v)).sort((a, b) => b - a);
        const a = move(s, s.turn, brain) as Extract<Action, { type: 'setup' }>;
        expect(a.type).toBe('setup');
        // Among the top tenth of corners by pips.
        expect(pipsAt(a.v)).toBeGreaterThanOrEqual(all[Math.floor(all.length / 10)]!);
      }
    }
  });
});

/* ---------- Hard's card counting (§3.1) ---------- */

describe('Hard counts cards', () => {
  it('knows production, and spreads a steal it didn’t see over the victim’s likely hand', () => {
    let s = table(3, [0]);
    const vs = spread(s, 3);
    s = place(s, 1, { settlements: [vs[0]!] });
    s = place(s, 2, { settlements: [vs[1]!] });
    const memo: CpuMemo = newCpuMemo();
    const seen = (events: Parameters<typeof eventsFor>[0]) =>
      cpuObserve(memo, viewFor(s, 0), eventsFor(events, 0), HARD);
    // Seat 1 is dealt 2 wood and 2 brick in plain view.
    s = setHand(s, 1, { wood: 2, brick: 2 });
    seen([{ k: 'produce', gains: { 1: { wood: 2, brick: 2 } }, short: [] }]);
    expect(memo.guess![1]).toMatchObject({ wood: 2, brick: 2 });
    // Seat 2 steals one of them; seat 0 doesn't see which.
    s = setHand(s, 1, { wood: 1, brick: 2 });
    s = setHand(s, 2, { wood: 1 });
    const steal = { k: 'steal' as const, p: 2, from: 1, r: 'wood' as const };
    expect(eventsFor([steal], 0)[0]).toMatchObject({ r: null });
    seen([steal]);
    expect(memo.guess![1]!.wood).toBeCloseTo(1.5);
    expect(memo.guess![1]!.brick).toBeCloseTo(1.5);
    expect(memo.guess![2]!.wood).toBeCloseTo(0.5);
    expect(memo.guess![2]!.brick).toBeCloseTo(0.5);
    // Seat 1 builds a road in plain view: a wood and a brick leave its hand. Whichever card was
    // stolen, one card is left: a wood or a brick, equally likely.
    s = setHand(s, 1, { brick: 1 });
    seen([{ k: 'build', p: 1, what: 'road', at: 0 }]);
    expect(memo.guess![1]!.wood).toBeCloseTo(0.5);
    expect(memo.guess![1]!.brick).toBeCloseTo(0.5);
  });

  it('a whole game with Hard keeps every guess equal to the public card counts', () => {
    const r = cpuGame('hard-count', 4, 4, { brains: [HARD, MEDIUM, HARD, MEDIUM], maxTurns: 600 });
    expect(r.errors).toEqual([]);
  });
});

/* ---------- Whole games ---------- */

describe('Medium and Hard play whole games legally', () => {
  for (const [label, brains] of [
    ['Medium vs bots', [MEDIUM, 'bot', MEDIUM]],
    ['Hard vs bots', [HARD, 'bot', HARD, 'bot']],
    ['every CPU', ['easy', MEDIUM, HARD, { ...MEDIUM, style: 'cards', focus: 'chase', trading: 'generous' }]],
  ] as const) {
    it(label, () => {
      for (let i = 0; i < 3; i++) {
        const r = cpuGame(`whole-${label}-${i}`, brains.length, brains.length, {
          brains: brains as unknown as CpuBrain[],
          maxTurns: 1000,
        });
        expect(r.errors).toEqual([]);
        expect(r.finished).toBe(true);
      }
    });
  }

  it('a Medium move is never rejected after a test bot’s offer on its turn', () => {
    // cpuGame fails on any rejected move; bots offer trades now and then on every turn.
    const r = cpuGame('offers', 3, 3, { brains: ['bot', MEDIUM, 'bot'], maxTurns: 1000 });
    expect(r.errors).toEqual([]);
    expect(r.checked.accepted + r.checked.offersDeclined).toBeGreaterThan(0);
  });
});
