import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLORS,
  COMS,
  RES,
  applyAction,
  botMove,
  eventsFor,
  logNotes,
  newGame,
  scenarioMap,
  seedRng,
  viewFor,
  type GameConfig,
  type GameEvent,
  type GameState,
  type LogNote,
} from '@settlers/engine';
import { CARD_LABEL, DEV_LABEL, PROGRESS_LABEL } from '../src/art';
import {
  DOT_COLORS,
  LOG_BG,
  MIN_CONTRAST,
  cardTextColor,
  contrast,
  nameColor,
  readable,
} from '../src/logcolors';
import { eventLines, lineText, rollWithEvent } from '../src/text';

describe('Log colours (SPEC 8.10)', () => {
  it('the log background is the panel colour the page uses', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(new RegExp(`--panel:\\s*${LOG_BG};`, 'i'));
  });

  it('every player name colour reads at 4.5:1; black, white and gray use a dot', () => {
    for (const c of COLORS) {
      const ink = nameColor(c);
      if (DOT_COLORS.includes(c)) expect(ink, c).toBeNull();
      else expect(contrast(ink!, LOG_BG), c).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('every card colour, and the log’s own text colours, read at 4.5:1', () => {
    for (const c of [...RES, ...COMS])
      expect(contrast(cardTextColor(c), LOG_BG), c).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // --ink, --ink-2 (lines), --lantern-2 (big lines), --alarm (warnings).
    for (const c of ['#eef3ef', '#a9bec1', '#ffd27a', '#ff8a75'])
      expect(contrast(c, LOG_BG), c).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('the check catches a colour that is too dark', () => {
    expect(contrast('#0230c1', LOG_BG)).toBeLessThan(MIN_CONTRAST);
    expect(contrast(readable('#0230c1'), LOG_BG)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

/** Play a bot game, giving each seat its own redacted events (and the notes) as the server does. */
function play(
  seed: string,
  config: Partial<GameConfig>,
  each: (seat: number, s: GameState, e: GameEvent | LogNote, raw: GameEvent | LogNote) => void,
) {
  let s = newGame(
    seed,
    ['Ann', 'Bob', 'Cat'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
    config,
  );
  const rng = seedRng(`${seed}-bots`);
  for (let step = 0; step < 4000 && s.phase === 'play'; step++) {
    let moved = false;
    for (let p = 0; p < s.players.length && !moved; p++) {
      const a = botMove(viewFor(s, p), rng);
      if (!a) continue;
      const r = applyAction(s, p, a);
      if (!r.ok) continue;
      s = r.state;
      moved = true;
      const notes = logNotes(s, r.events);
      for (let seat = 0; seat < s.players.length; seat++) {
        const mine = eventsFor(r.events, seat);
        mine.forEach((e, i) => each(seat, s, e, r.events[i]!));
        for (const n of notes) each(seat, s, n, n);
      }
    }
    if (!moved) break;
  }
  return s;
}

describe('Log lines (SPEC 8.10)', () => {
  for (const [name, config] of [
    ['classic', {}],
    ['Seafarers', { map: scenarioMap('heading-for-new-shores', 3) }],
    ['Cities & Knights', { modules: ['citiesKnights'], winVP: 13 }],
  ] as [string, Partial<GameConfig>][]) {
    it(`${name}: every event reads as words, and nobody sees another's hidden cards`, () => {
      const kinds = new Set<string>();
      let blocked = 0;
      const s = play(`log-${name}`, config, (seat, st, e, raw) => {
        const v = viewFor(st, seat);
        for (const l of eventLines(v, e)) {
          const t = lineText(v, l);
          kinds.add(e.k);
          expect(t, JSON.stringify(e)).not.toMatch(/undefined|NaN|null|\[object/);
          expect(t.length).toBeGreaterThan(3);
          if (e.k === 'blocked') blocked++;
          // Hidden cards stay hidden: a steal, a bought card, a drawn progress card, given cards.
          if (raw.k === 'steal' && raw.r && seat !== raw.p && seat !== raw.from)
            expect(t).toMatch(/stole a card from/);
          if (raw.k === 'buyDev' && raw.card && seat !== raw.p) expect(t).not.toContain(DEV_LABEL[raw.card]);
          if (
            raw.k === 'draw' &&
            raw.card &&
            seat !== raw.p &&
            !['printer', 'constitution'].includes(raw.card)
          )
            expect(t).not.toContain(PROGRESS_LABEL[raw.card]);
          if (raw.k === 'give' && raw.cards && seat !== raw.from && seat !== raw.to)
            for (const c of [...RES, ...COMS]) if (raw.cards[c]) expect(t).not.toContain(CARD_LABEL[c]);
        }
      });
      expect(s.phase).toBe('over');
      for (const k of ['turn', 'roll', 'produce', 'build', 'steal']) expect(kinds, k).toContain(k);
      expect(blocked).toBeGreaterThan(0);
    });
  }

  it('Linen, never Cloth', () => {
    const v = viewFor(
      newGame(
        'x',
        [
          { pid: 'a', nick: 'Ann', color: 'red' },
          { pid: 'b', nick: 'Bob', color: 'blue' },
          { pid: 'c', nick: 'Cat', color: 'white' },
        ],
        { modules: ['citiesKnights'], winVP: 13, order: 'given' },
      ),
      0,
    );
    const [l] = eventLines(v, { k: 'aqueduct', p: 1, r: 'wood' });
    expect(lineText(v, l!)).toBe('Bob took 1 Wood (aqueduct)');
    const [g] = eventLines(v, { k: 'gain', p: 1, cards: { cloth: 2 }, from: null });
    expect(lineText(v, g!)).toBe('Bob took 2 Linen from the bank');
  });

  it('reads like the examples', () => {
    const v = viewFor(
      newGame(
        'x',
        ['Alex', 'Sam', 'Joe'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
        { order: 'given' },
      ),
      2,
    );
    const text = (e: GameEvent | LogNote) => eventLines(v, e).map((l) => lineText(v, l));
    expect(text({ k: 'produce', gains: { 0: { brick: 2, ore: 1 }, 1: { sheep: 1 } }, short: [] })).toEqual([
      'Alex got 2 Brick and 1 Ore',
      'Sam got 1 Sheep',
    ]);
    expect(text({ k: 'blocked', h: 0, lost: { 2: { brick: 1 } } })).toEqual([
      'The robber blocked 1 Brick from you',
    ]);
    expect(text({ k: 'trade', a: 0, b: 1, give: { brick: 2 }, want: { ore: 1 } })).toEqual([
      'Alex gave Sam 2 Brick for 1 Ore',
    ]);
    expect(text({ k: 'bank', p: 0, give: 'sheep', n: 4, get: 'wheat' })).toEqual([
      'Alex traded 4 Sheep to the bank for 1 Wheat',
    ]);
    expect(text({ k: 'steal', p: 0, from: 1, r: null })).toEqual(['Alex stole a card from Sam']);
  });
});

describe('the event die with a roll (Knights)', () => {
  it('reads "9 blue", "blue 9" or "9", and the ship is "barbarian"', () => {
    expect(rollWithEvent(9, 'politics', undefined)).toBe('9 blue');
    expect(rollWithEvent(9, 'politics', 'after')).toBe('9 blue');
    expect(rollWithEvent(9, 'politics', 'before')).toBe('blue 9');
    expect(rollWithEvent(9, 'politics', 'off')).toBe('9');
    expect(rollWithEvent(6, 'trade', 'after')).toBe('6 yellow');
    expect(rollWithEvent(6, 'science', 'before')).toBe('green 6');
    expect(rollWithEvent(8, 'ship', 'after')).toBe('8 barbarian');
    expect(rollWithEvent(8, 'ship', 'before')).toBe('barbarian 8');
    expect(rollWithEvent(5, null, 'after')).toBe('5');
  });

  it('its colours in the log are readable (4.5:1)', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    for (const ev of ['trade', 'politics', 'science']) {
      const m = css.match(new RegExp(`\\.evword\\[data-ev='${ev}'\\] \\{\\s*color: (#[0-9a-f]{6})`, 'i'));
      expect(m, ev).toBeTruthy();
      expect(contrast(m![1]!, LOG_BG), ev).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });
});
