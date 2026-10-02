/*
 * Text colours for the game log (SPEC 8.10): player names and cards in their own colours, each
 * lightened just enough for 4.5:1 contrast against the log's background. A player colour that
 * is too dark, or too close to normal text, to work as a name (black, white, gray) shows the
 * name in normal text with a dot in their colour. test/logcolors.test.ts checks every colour.
 */

import type { Card, Color } from '@settlers/engine';
import { CARD_COLOR, PCOL } from './art';

/** The log's background: --panel in styles.css (the test checks they match). */
export const LOG_BG = '#0f2630';
export const MIN_CONTRAST = 4.5;

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => lin(x / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const hex2 = (x: number) => Math.round(x).toString(16).padStart(2, '0');

/** The colour mixed towards white just enough to read on `bg` (with a little to spare). */
export function readable(hex: string, bg = LOG_BG): string {
  const c = rgb(hex);
  for (let t = 0; t <= 1; t += 0.02) {
    const m = `#${c.map((x) => hex2(x + (255 - x) * t)).join('')}`;
    if (contrast(m, bg) >= MIN_CONTRAST + 0.1) return m;
  }
  return '#ffffff';
}

/** Player colours shown as a dot beside a name in normal text. */
export const DOT_COLORS: readonly Color[] = ['black', 'white', 'gray'];

const names = new Map<Color, string | null>();
/** The text colour for a player's name, or null for normal text with a dot. */
export function nameColor(c: Color): string | null {
  if (!names.has(c)) names.set(c, DOT_COLORS.includes(c) ? null : readable(PCOL[c]));
  return names.get(c)!;
}

const cards = new Map<Card, string>();
/** The text colour for a card's name and amount; its icon keeps the card colour itself. */
export function cardTextColor(c: Card): string {
  if (!cards.has(c)) cards.set(c, readable(CARD_COLOR[c]));
  return cards.get(c)!;
}
