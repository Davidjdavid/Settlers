/*
 * What stands out in a game's dice (SPEC 13.3), in sentences people want to read: streaks, hot
 * and cold numbers, sevens, and whether the spread looks like fair dice, each with how often that
 * happens. Pure, so every number can be tested.
 */

import type { RollEntry } from '@settlers/engine';

/** Chance of each total with two dice. */
export const ODDS = (t: number) => (6 - Math.abs(t - 7)) / 36;

const NUMBER_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => NUMBER_WORD[n] ?? String(n);
/** "a 7", "an 8", "an 11". */
const aTotal = (t: number) => (t === 8 || t === 11 ? `an ${t}` : `a ${t}`);
/** "about 6 expected", or "under 1 expected". */
const expected = (x: number) => (x < 1 ? 'under 1 expected' : `about ${Math.round(x)} expected`);

/** Chance of at least one run of `k` or more successes in a row, in `n` tries with chance `p` each. */
export function runChance(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  // ways[j]: chance of no run of k yet, ending in a run of exactly j successes.
  let ways = new Array<number>(k).fill(0);
  ways[0] = 1;
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(k).fill(0);
    for (let j = 0; j < k; j++) {
      next[0]! += ways[j]! * (1 - p);
      if (j + 1 < k) next[j + 1]! += ways[j]! * p;
    }
    ways = next;
  }
  return 1 - ways.reduce((a, b) => a + b, 0);
}

/** Chance of `k` or more (or, with `below`, `k` or fewer) successes in `n` tries with chance `p`. */
export function binomTail(n: number, k: number, p: number, below = false): number {
  let sum = 0;
  let term = Math.pow(1 - p, n); // P(X = 0)
  for (let i = 0; i <= n; i++) {
    if (below ? i <= k : i >= k) sum += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.min(1, sum);
}

/**
 * Chi-square test of the totals against two dice: the chance a fair game's spread is at least this
 * uneven. Ten degrees of freedom (11 totals), so the tail has a closed form.
 */
export function fairChance(dice: readonly number[]): number {
  const n = dice.slice(2, 13).reduce((a, b) => a + (b ?? 0), 0);
  if (!n) return 1;
  let x = 0;
  for (let t = 2; t <= 12; t++) {
    const e = n * ODDS(t);
    x += ((dice[t] ?? 0) - e) ** 2 / e;
  }
  return chiTail10(x);
}

/** Chance a chi-square value with 10 degrees of freedom is at least x: e^(-x/2) Σ_{i<5} (x/2)^i / i!. */
export function chiTail10(x: number): number {
  const h = x / 2;
  let term = 1;
  let sum = 1;
  for (let i = 1; i < 5; i++) {
    term *= h / i;
    sum += term;
  }
  return Math.min(1, Math.exp(-h) * sum);
}

/** "about 1 game in 40", "about 1 in 3 games", "most games". */
export function howOften(p: number): string {
  if (p >= 0.5) return 'most games';
  if (p >= 0.15) return `about ${Math.round(p * 10)} games in 10`;
  return `about 1 game in ${Math.max(2, Math.round(1 / p))}`;
}

export interface Streak {
  t: number;
  len: number;
  /** Positions (1-based) in the list of rolls it's counted over. */
  from: number;
  to: number;
  /** How often a run at least this long of this total happens over that many rolls. */
  chance: number;
}

/** The most surprising run of one total in a sequence of totals. */
export function bestStreak(totals: readonly number[]): Streak | null {
  let best: Streak | null = null;
  for (let i = 0; i < totals.length;) {
    let j = i;
    while (j + 1 < totals.length && totals[j + 1] === totals[i]) j++;
    const t = totals[i]!;
    const len = j - i + 1;
    if (len >= 2) {
      const chance = runChance(totals.length, len, ODDS(t));
      if (!best || chance < best.chance) best = { t, len, from: i + 1, to: j + 1, chance };
    }
    i = j + 1;
  }
  return best;
}

export interface Fact {
  k: 'streak' | 'mine' | 'hot' | 'cold' | 'dry' | 'sevens' | 'fair';
  text: string;
}

/** Only things that happen in fewer than this share of games are called out. */
const NOTABLE = 0.3;

/** What stands out, most interesting first. `names[p]` is how to name each seat ("You" for yours). */
export function diceFacts(list: readonly RollEntry[], names: readonly string[]): Fact[] {
  const out: (Fact & { score: number })[] = [];
  const rolls = list.filter((r) => !r.set);
  const totals = rolls.map((r) => r.d[0] + r.d[1]);
  const n = totals.length;
  if (!n) return [{ k: 'fair', text: 'No rolls yet.' }];
  const dice = new Array<number>(13).fill(0);
  for (const t of totals) dice[t]!++;

  // Streaks in a row, overall.
  const all = bestStreak(totals);
  if (all && all.chance < NOTABLE)
    out.push({
      k: 'streak',
      score: all.chance,
      text: `${word(all.len)[0]!.toUpperCase()}${word(all.len).slice(1)} ${all.t}s in a row (rolls ${all.from}–${all.to}). That happens in ${howOften(all.chance)} with ${n} rolls.`,
    });
  // ...and on one player's own turns (a 7 rolled again counts once: the turn's roll).
  let mine: { p: number; s: Streak; n: number } | null = null;
  names.forEach((_, p) => {
    const own = list.filter((r) => r.p === p && !r.set && !r.again).map((r) => r.d[0] + r.d[1]);
    const s = bestStreak(own);
    if (s && s.len >= 3 && (!mine || s.chance < mine.s.chance)) mine = { p, s, n: own.length };
  });
  const m = mine as { p: number; s: Streak; n: number } | null;
  if (m && m.s.chance < NOTABLE)
    out.push({
      k: 'mine',
      score: m.s.chance,
      text: `${names[m.p]} rolled ${aTotal(m.s.t)} on ${word(m.s.len)} turns running. For someone with ${m.n} rolls that happens in ${howOften(m.s.chance)}.`,
    });

  // Hot and cold numbers (from 20 rolls on).
  if (n >= 20) {
    let hot: { t: number; p: number } | null = null;
    let cold: { t: number; p: number } | null = null;
    for (let t = 2; t <= 12; t++) {
      const up = binomTail(n, dice[t]!, ODDS(t));
      const down = binomTail(n, dice[t]!, ODDS(t), true);
      if (dice[t]! > n * ODDS(t) && (!hot || up < hot.p)) hot = { t, p: up };
      if (dice[t]! < n * ODDS(t) && (!cold || down < cold.p)) cold = { t, p: down };
    }
    const h = hot as { t: number; p: number } | null;
    const c = cold as { t: number; p: number } | null;
    if (h && h.p < 0.1)
      out.push({
        k: 'hot',
        score: h.p,
        text: `${h.t}s are hot: ${dice[h.t]} so far, ${expected(n * ODDS(h.t))}.`,
      });
    if (c && c.p < 0.1)
      out.push({
        k: 'cold',
        score: c.p,
        text: `${c.t}s are cold: ${dice[c.t]} so far, ${expected(n * ODDS(c.t))}.`,
      });
  }
  // A number missing for a long time.
  let dry: { t: number; gap: number; p: number } | null = null;
  for (let t = 2; t <= 12; t++) {
    const last = totals.lastIndexOf(t);
    const gap = n - 1 - last;
    const p = Math.pow(1 - ODDS(t), gap);
    if (p < 0.1 && (!dry || p < dry.p)) dry = { t, gap, p };
  }
  const d = dry as { t: number; gap: number; p: number } | null;
  if (d)
    out.push({
      k: 'dry',
      score: d.p,
      text: `No ${d.t} for ${d.gap} rolls${totals.includes(d.t) ? '' : ' (none yet)'}. A wait that long happens about 1 time in ${Math.round(1 / d.p)}.`,
    });

  out.sort((a, b) => a.score - b.score);
  const facts: Fact[] = out.map(({ k, text }) => ({ k, text }));

  // Sevens, always.
  const sevens = dice[7]!;
  const by = names.map((_, p) => list.filter((r) => r.p === p && !r.set && r.d[0] + r.d[1] === 7).length);
  const top = Math.max(...by);
  const leaders = by.flatMap((k, p) => (k === top ? [p] : []));
  facts.push({
    k: 'sevens',
    text:
      `Sevens: ${sevens} so far, ${expected(n / 6)}.` +
      (top > 0 && leaders.length === 1
        ? ` Most by ${names[leaders[0]!]}: ${top} of ${list.filter((r) => r.p === leaders[0] && !r.set).length} rolls.`
        : ''),
  });

  // Do they look fair?
  if (n < 36)
    facts.push({
      k: 'fair',
      text: `Too early to say how fair the dice look: that takes about 36 rolls (${n} so far).`,
    });
  else {
    const p = fairChance(dice);
    facts.push({
      k: 'fair',
      text:
        p >= 0.1
          ? `The dice look normal: a spread at least this uneven turns up in ${howOften(p)}.`
          : `The spread is unusual: it turns up in ${howOften(p)}. Every die is still rolled by the server’s secure random generator.`,
    });
  }
  return facts;
}
