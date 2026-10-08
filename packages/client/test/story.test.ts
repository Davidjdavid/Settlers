import { describe, expect, it } from 'vitest';
import {
  COLORS,
  applyAction,
  botMove,
  cardKinds,
  eventsFor,
  geo,
  legalActions,
  mustDiscard,
  newGame,
  TABLE_TALK,
  robberAwake,
  seedRng,
  viewFor,
  type Action,
  type Card,
  type Cards,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Seat,
} from '@settlers/engine';
import type { LogItem } from '@settlers/server/protocol';
import { act, emptyBoard, place, rigDice, setHand } from '../../engine/test/helpers';
import {
  awards,
  didOf,
  lastRolls,
  momentsIn,
  race,
  recapSince,
  sinceYourTurn,
  rollNews,
  waitingFor,
} from '../src/isle/story';

/**
 * A bot game, keeping each seat's log as the server sends it. `each` sees the state, the move's
 * events and every seat's log after each move.
 */
function play(
  seed: string,
  config: Partial<GameConfig>,
  n: number,
  each: (s: GameState, evs: GameEvent[], logs: LogItem[][]) => void,
) {
  let s = newGame(
    seed,
    ['Ann', 'Bob', 'Cat', 'Dan'].slice(0, n).map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
    config,
  );
  const logs: LogItem[][] = s.players.map(() => []);
  const rng = seedRng(`${seed}-bots`);
  for (let step = 0; step < 4000 && s.phase === 'play'; step++) {
    let moved = false;
    for (let p = 0; p < s.players.length && !moved; p++) {
      const a = botMove(viewFor(s, p), rng);
      const r = a && applyAction(s, p, a);
      if (!r || !r.ok) continue;
      s = r.state;
      moved = true;
      for (let q = 0; q < s.players.length; q++)
        for (const e of eventsFor(r.events, q)) logs[q]!.push({ k: 'ev', seq: s.seq, at: 0, e });
      each(s, r.events, logs);
    }
    if (!moved) break;
  }
  return s;
}

const MODES: [string, Partial<GameConfig>, number][] = [
  ['classic', {}, 3],
  ['Seafarers', { modules: ['seafarers'], winVP: 14 }, 4],
  ['Cities & Knights', { modules: ['citiesKnights'], winVP: 13 }, 4],
];

describe('the last rolls and the roll announcement (docs/isle.md 6)', () => {
  for (const [name, config, n] of MODES)
    it(`${name}: every roll, newest first, with who got what`, () => {
      const rolls: { p: Seat; d: [number, number] }[] = [];
      let announced = 0;
      let sevens = 0;
      play(`rolls-${name}`, config, n, (s, evs, logs) => {
        const r = evs.findLast((e): e is Extract<GameEvent, { k: 'roll' }> => e.k === 'roll' && !e.redo);
        for (let q = 0; q < n; q++) {
          const v = viewFor(s, q);
          const items = logs[q]!.filter((it) => it.k === 'ev' && it.seq === s.seq);
          const news = rollNews(items, v);
          if (!r) {
            expect(news).toBeNull();
            continue;
          }
          announced++;
          expect(news).toMatchObject({ p: r.p, d: r.d, sum: r.d[0] + r.d[1] });
          // Who got what: exactly the production, you first.
          const want = new Map<number, Cards>();
          for (const e of evs)
            if (e.k === 'produce' || e.k === 'commodities')
              for (const [p, c] of Object.entries(e.gains))
                for (const [k, x] of Object.entries(c as Cards))
                  if (x)
                    want.set(Number(p), {
                      ...want.get(Number(p)),
                      [k]: (want.get(Number(p))?.[k as Card] ?? 0) + x,
                    });
          const cards = new Map(
            news!.got.filter((g) => Object.keys(g.cards).length).map((g) => [g.p, g.cards]),
          );
          expect(cards).toEqual(want);
          if (news!.got.some((g) => g.p === q)) expect(news!.got[0]!.p).toBe(q);
          if (config.modules?.includes('citiesKnights')) expect(news!.e).toBeDefined();
          // A 7: the robber only when it's awake (Knights: after the first attack), and who discards.
          if (r.d[0] + r.d[1] === 7) {
            sevens++;
            expect(news!.seven!.robber).toBe(robberAwake(s));
            const must = evs.find((e) => e.k === 'mustDiscard');
            expect(news!.seven!.discard).toEqual(
              must && must.k === 'mustDiscard' ? Object.keys(must.need).map(Number) : [],
            );
          } else expect(news!.seven).toBeNull();
        }
        if (r) rolls.unshift({ p: r.p, d: r.d });
        // The last five, newest first, the same on every screen.
        for (let q = 0; q < n; q++)
          expect(lastRolls(logs[q]!, 5).map(({ p, d }) => ({ p, d }))).toEqual(rolls.slice(0, 5));
      });
      expect(announced).toBeGreaterThan(20 * n);
      expect(sevens).toBeGreaterThan(2);
    });
});

describe('since your last turn (docs/isle.md 7)', () => {
  for (const [name, config, n] of MODES)
    it(`${name}: one entry per turn since yours, and what you got and lost adds up to your hand`, () => {
      const atEnd: (Cards | null)[] = Array(n).fill(null);
      const roll: Map<number, [number, number]> = new Map();
      const turns: Seat[] = [];
      let checked = 0;
      const hand = (s: GameState, p: Seat): Cards =>
        Object.fromEntries(cardKinds(s).map((k) => [k, s.players[p]!.res[k] ?? 0]));
      play(`recap-${name}`, config, n, (s, evs, logs) => {
        const r = evs.findLast((e): e is Extract<GameEvent, { k: 'roll' }> => e.k === 'roll' && !e.redo);
        if (r) roll.set(turns.length - 1, r.d);
        const t = evs.find((e): e is Extract<GameEvent, { k: 'turn' }> => e.k === 'turn');
        if (t && s.phase === 'play') {
          // The player whose turn just ended: their hand from here on is what the recap explains
          // (ending a turn changes no hands).
          if (turns.length) atEnd[turns[turns.length - 1]!] = hand(s, turns[turns.length - 1]!);
          turns.push(t.p);
          const q = t.p;
          const v = viewFor(s, q);
          const recap = recapSince(logs[q]!, v);
          // Whose turns: everyone else's since this player's last turn, in order.
          const mine = turns.slice(0, -1).lastIndexOf(q);
          const since = turns.slice(mine + 1, -1).slice(-8);
          expect(recap.map((x) => x.p)).toEqual(since);
          recap.forEach((x, i) => {
            const at = turns.length - 1 - since.length + i;
            expect(x.roll?.d ?? null).toEqual(roll.get(at) ?? null);
          });
          if (atEnd[q] && mine >= 0 && turns.length - 1 - mine <= 8) {
            const net: Record<string, number> = {};
            for (const x of recap) {
              for (const [k, c] of Object.entries(x.got)) net[k] = (net[k] ?? 0) + (c ?? 0);
              for (const [k, c] of Object.entries(x.lost)) net[k] = (net[k] ?? 0) - (c ?? 0);
            }
            const now = hand(s, q);
            for (const k of cardKinds(s))
              expect(net[k] ?? 0, `${k} for seat ${q}`).toBe(now[k]! - atEnd[q]![k]!);
            checked++;
          }
        }
      });
      expect(checked).toBeGreaterThan(10 * n);
    });

  /** Seat 0 to play with undo on and cards to spend; seats 1 and 2 named. */
  function table(): GameState {
    let s = emptyBoard(3);
    s.config = { ...s.config, houseRules: { undo: true, undoTurn: true, handBack: true } };
    s.stage = 'preroll';
    const g = geo(s);
    s = place(s, 0, { settlements: [0], roads: [g.verts[0]!.edges[0]!] });
    s = place(s, 1, { settlements: [30], roads: [g.verts[30]!.edges[0]!] });
    s.players.forEach((pl, i) => (pl.nick = `P${i}`));
    s = setHand(s, 1, { wood: 4, brick: 4, sheep: 2, wheat: 2, ore: 2 });
    return setHand(s, 0, { wood: 4, brick: 4, sheep: 2, wheat: 2, ore: 2 });
  }
  function game() {
    let s = rigDice(table(), 5);
    // The turn began before these moves.
    const logs: LogItem[][] = [0, 1, 2].map(() => [{ k: 'ev', seq: 0, at: 0, e: { k: 'turn', p: 0 } }]);
    const step = (p: Seat, a: Action) => {
      const r = act(s, p, a);
      s = r.state;
      for (let q = 0; q < 3; q++)
        for (const e of eventsFor(r.events, q)) logs[q]!.push({ k: 'ev', seq: s.seq, at: 0, e });
    };
    const road = (p: Seat) => legalActions(s, p).find((a) => a.type === 'road')!;
    return { step, s: () => s, logs, road, rig: () => (s = rigDice(s, 5)) };
  }

  it('leaves out a move undone, and everything after the roll when a whole turn is undone', () => {
    const g = game();
    g.step(0, { type: 'roll' });
    g.step(0, g.road(0));
    g.step(0, g.road(0));
    g.step(0, { type: 'askUndo' });
    g.step(1, { type: 'answerUndo', yes: true });
    g.step(2, { type: 'answerUndo', yes: true });
    g.step(0, { type: 'end' });
    // P2 hasn't had a turn: P0's, then P1's just begun.
    let v = viewFor(g.s(), 2);
    expect(recapSince(g.logs[2]!, v).map((x) => x.did)).toEqual([['built a road'], []]);
    // P1 builds two roads, then takes the whole turn back and builds one.
    g.rig();
    g.step(1, { type: 'roll' });
    g.step(1, g.road(1));
    g.step(1, g.road(1));
    g.step(1, { type: 'askUndo', turn: true });
    g.step(0, { type: 'answerUndo', yes: true });
    g.step(2, { type: 'answerUndo', yes: true });
    g.step(1, g.road(1));
    v = viewFor(g.s(), 2);
    expect(recapSince(g.logs[2]!, v).map((x) => [x.p, x.did])).toEqual([
      [0, ['built a road']],
      [1, ['built a road']],
    ]);
    // Both rolls stay.
    expect(recapSince(g.logs[2]!, v).map((x) => x.roll?.d.reduce((a, b) => a + b))).toEqual([5, 5]);
  });

  it('a turn handed back is the same turn going on', () => {
    const g = game();
    g.step(0, { type: 'roll' });
    g.step(0, g.road(0));
    g.step(0, { type: 'end' });
    g.step(0, { type: 'askBack' });
    g.step(1, { type: 'handBack' });
    g.step(0, g.road(0));
    // P2's screen (on P0's turn): one turn of P0's, with both roads.
    const v = viewFor(g.s(), 2);
    expect(recapSince(g.logs[2]!, v).map((x) => [x.p, x.did])).toEqual([[0, ['built 2 roads']]]);
  });

  it('the bubbles by the seats: each other player’s latest turn in words, never yours', () => {
    const g = game();
    g.step(0, { type: 'roll' });
    g.step(0, g.road(0));
    g.step(0, { type: 'end' });
    // P1 rolls and does nothing yet: no bubble for P1, P0's road stays.
    g.rig();
    g.step(1, { type: 'roll' });
    expect(sinceYourTurn(g.logs[2]!, viewFor(g.s(), 2))).toEqual({ 0: 'built a road' });
    g.step(1, g.road(1));
    g.step(1, g.road(1));
    expect(sinceYourTurn(g.logs[2]!, viewFor(g.s(), 2))).toEqual({ 0: 'built a road', 1: 'built 2 roads' });
    // Never your own: P1's screen shows only P0's.
    expect(sinceYourTurn(g.logs[1]!, viewFor(g.s(), 1))).toEqual({ 0: 'built a road' });
    g.step(1, { type: 'end' });
    // P2's turn: still both, until they play again.
    expect(sinceYourTurn(g.logs[2]!, viewFor(g.s(), 2))).toEqual({ 0: 'built a road', 1: 'built 2 roads' });
    g.rig();
    g.step(2, { type: 'roll' });
    g.step(2, { type: 'end' });
    // P0's turn again: P0's own road has gone from P0's screen, P1's and P2's turns are there
    // (P2 did nothing but roll: no bubble).
    expect(sinceYourTurn(g.logs[0]!, viewFor(g.s(), 0))).toEqual({ 1: 'built 2 roads' });
    // P1's screen: P0's turn was before P1's own, so only P2's (nothing) is left.
    expect(sinceYourTurn(g.logs[1]!, viewFor(g.s(), 1))).toEqual({});
  });
});

describe('what a player did, in a few words', () => {
  it('counts pieces, scoring ones first, then cards and trades', () => {
    const v = viewFor(
      newGame(
        'did',
        [0, 1, 2].map((i) => ({ pid: `p${i}`, nick: `P${i}`, color: COLORS[i]! })),
      ),
      1,
    );
    const evs: GameEvent[] = [
      { k: 'build', p: 0, what: 'road', at: 1 },
      { k: 'build', p: 0, what: 'road', at: 2 },
      { k: 'build', p: 0, what: 'city', at: 3 },
      { k: 'buyDev', p: 0, card: null },
      { k: 'trade', a: 0, b: 1, give: { wood: 1 }, want: { ore: 1 } },
      { k: 'bank', p: 0, give: 'wheat', n: 4, get: 'ore' },
      { k: 'steal', p: 0, from: 1, r: 'ore' },
      { k: 'longest', p: 0, n: 5, from: 2 },
    ];
    expect(didOf(v, 0, evs)).toEqual([
      'built a city and 2 roads',
      'bought a development card',
      'traded with you',
      'traded with the bank',
      'stole 1 Ore from you',
      `took Longest Road from ${v.players[2]!.nick}`,
    ]);
  });
});

describe('the race to the target (docs/isle.md 5)', () => {
  it('places with ties, the leader only when alone in front, close to winning, your hidden points', () => {
    let s = newGame(
      'race',
      [0, 1, 2, 3].map((i) => ({ pid: `p${i}`, nick: `P${i}`, color: COLORS[i]! })),
    );
    s = structuredClone(s);
    const v = viewFor(s, 0);
    const set = (pts: number[], mine: number) => {
      pts.forEach((x, i) => (v.players[i]!.publicVP = x));
      v.hand!.totalVP = mine;
    };
    set([3, 5, 5, 8], 3);
    expect(race(v).map((r) => [r.place, r.lead, r.near])).toEqual([
      [4, false, false],
      [2, false, false],
      [2, false, false],
      [1, true, true],
    ]);
    // Seat 0 holds 2 hidden points: only its own screen counts them.
    set([3, 5, 5, 8], 5);
    expect(race(v)[0]).toMatchObject({ pts: 5, place: 2 });
    set([8, 5, 2, 8], 8);
    expect(race(v).filter((r) => r.lead)).toEqual([]);
    expect(race(v).map((r) => r.place)).toEqual([1, 3, 4, 1]);
  });
});

describe('the awards shelf (docs/isle.md 14)', () => {
  for (const [name, config, n] of MODES)
    it(`${name}: the last change in the log is who holds it now, on every screen`, () => {
      let changes = 0;
      const seen = new Set<string>();
      // The turn each award last changed hands, from the game itself.
      const at = new Map<string, number>();
      play(`awards-${name}`, config, n, (s, evs, logs) => {
        for (const e of evs)
          if (e.k === 'longest' || e.k === 'largest') at.set(e.k, s.turnN);
          else if (e.k === 'metropolis') at.set(e.track, s.turnN);
        for (let q = 0; q < n; q++) {
          const v = viewFor(s, q);
          const list = awards(v, logs[q]!);
          expect(list.map((a) => a.key)).toEqual(
            config.modules?.includes('citiesKnights')
              ? ['longest', 'science', 'trade', 'politics']
              : ['longest', 'largest'],
          );
          for (const a of list) {
            if (a.last) {
              expect(a.last.to, a.key).toBe(a.holder);
              expect(a.last.turn, a.key).toBe(at.get(a.key));
              expect(a.first).toBeDefined();
              if (q === 0 && !seen.has(`${a.key}:${a.last.turn}:${a.last.to}`)) {
                seen.add(`${a.key}:${a.last.turn}:${a.last.to}`);
                changes++;
              }
            } else expect(a.holder, a.key).toBeNull();
          }
        }
        // A log cut short (the server sends the latest events): the same turns, no "first".
        const v = viewFor(s, 0);
        const cut = logs[0]!.slice(Math.floor(logs[0]!.length / 2));
        const firstTurn = cut.findIndex((it) => it.k === 'ev' && it.e.k === 'turn');
        for (const a of awards(v, cut.slice(firstTurn))) {
          expect(a.first).toBeUndefined();
          if (a.last) expect(a.last.turn, a.key).toBe(at.get(a.key));
        }
      });
      expect(changes).toBeGreaterThan(1);
    });
});

describe('moments: the big things, as they happen (docs/isle.md 14)', () => {
  const v = viewFor(
    newGame(
      'moments',
      [0, 1, 2].map((i) => ({ pid: `p${i}`, nick: `P${i}`, color: COLORS[i]! })),
    ),
    1,
  );
  const items = (evs: GameEvent[]): LogItem[] => evs.map((e, i) => ({ k: 'ev', seq: i, at: 0, e }));
  const n = (p: number) => v.players[p]!.nick;
  it('awards changing hands say from whom; a steal only when you are in it', () => {
    const got = momentsIn(
      v,
      items([
        { k: 'longest', p: 0, n: 6, from: 1 },
        { k: 'steal', p: 0, from: 2, r: null },
        { k: 'steal', p: 2, from: 1, r: 'ore' },
        { k: 'largest', p: 2, n: 3, from: null },
      ]),
    );
    expect(got.map((m) => [m.title, m.detail])).toEqual([
      [`${n(0)} took Longest Road`, 'from you · 6 long'],
      [`${n(2)} stole 1 Ore from you`, undefined],
      [`${n(2)} took Largest Army`, '3 knights'],
    ]);
  });
  it('a rule says which and what it means; a progress card only on its owner’s screen', () => {
    const got = momentsIn(
      v,
      items([
        { k: 'rule', p: 0, rule: 'bank3to1', value: true },
        { k: 'draw', p: 1, track: 'science', card: 'alchemist' },
        { k: 'draw', p: 2, track: 'trade', card: null },
        { k: 'metropolis', p: 2, track: 'trade', v: 5, from: 1 },
      ]),
    );
    expect(got.map((m) => m.title)).toEqual([
      `${n(0)} changed “3:1 bank trades for everyone”: turned on`,
      'You drew a Science card: Alchemist',
      `${n(2)} got the Trade metropolis`,
    ]);
    expect(got[0]!.detail).toMatch(/^Everyone trades with the bank at 3:1/);
    expect(got[2]!.detail).toBe('taken from you');
  });
});

describe('who the game is waiting for (docs/isle.md 4)', () => {
  for (const [name, config, n] of [
    ...MODES,
    ['Full game', { modules: ['seafarers', 'citiesKnights'], winVP: 16 }, 4] as [
      string,
      Partial<GameConfig>,
      number,
    ],
  ])
    it(`${name}: exactly the players with a move to make, on every screen`, () => {
      const stages = new Set<string>();
      play(`waiting-${name}`, config, n, (s) => {
        // Who has a real move (offers and answers to them never hold the game up). Discards
        // aren't listed as moves (any cards will do): mustDiscard says who owes one.
        const movers = s.players
          .map((_, p) => p)
          .filter(
            (p) =>
              mustDiscard(s, p) > 0 ||
              // Card choices (Saboteur, Wedding, Master Merchant…) aren't listed either.
              (s.stage === 'ck' &&
                s.ck!.owe.some((o) => o.p === p && ['discard', 'give', 'take'].includes(o.k))) ||
              legalActions(s, p).some(
                (a) =>
                  !TABLE_TALK.includes(a.type) && !['offer', 'respond', 'cancel', 'confirm'].includes(a.type),
              ),
          );
        for (let q = 0; q < n; q++) {
          const w = waitingFor(viewFor(s, q));
          const who = [...new Set(w.flatMap((x) => x.who))].sort();
          expect(who, `${s.stage}: ${JSON.stringify(w)}`).toEqual(movers.sort());
          for (const x of w) expect(x.what).toMatch(/^[a-z]/);
        }
        stages.add(s.stage);
      });
      expect(stages.size).toBeGreaterThan(3);
    });

  it('an undo that could be asked for waits on nobody; once asked, on everyone else', () => {
    let checked = 0;
    play('waiting-undo', { houseRules: { undo: true } }, 3, (s) => {
      if (!s.undo || s.undo.asked || checked >= 5) return;
      for (let q = 0; q < 3; q++)
        expect(waitingFor(viewFor(s, q)).filter((w) => /undo/.test(w.what))).toEqual([]);
      const r = applyAction(s, s.undo.p, { type: 'askUndo' });
      if (!r.ok) throw new Error(r.error);
      const others = [0, 1, 2].filter((p) => p !== s.undo!.p);
      for (let q = 0; q < 3; q++)
        expect(
          waitingFor(viewFor(r.state, q))
            .filter((w) => /request to undo/.test(w.what))
            .flatMap((w) => w.who)
            .sort(),
        ).toEqual(others);
      checked++;
    });
    expect(checked).toBe(5);
  });
});
