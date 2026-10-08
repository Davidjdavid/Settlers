import { describe, expect, it } from 'vitest';
import { COLORS, CVD_COLORS } from '@settlers/engine';
import { CARD_COLOR, PCOL, TILE_COLOR } from '../src/art';
import { VISIONS, diff } from '../src/colorcheck';
import { GROUNDS as STYLE_GROUNDS, STYLES, THEMES } from '../src/themes';

/** Everything a piece can stand on: every tile colour and the water around the island. */
const GROUNDS = { ...TILE_COLOR, water: '#12404f' };

describe('piece colours (SPEC 4.2)', () => {
  it('every colour stands out on every tile, with every kind of vision', () => {
    const bad: string[] = [];
    for (const c of CVD_COLORS)
      for (const [t, hex] of Object.entries(GROUNDS))
        for (const v of VISIONS) {
          const d = diff(PCOL[c], hex, v);
          if (d < 8) bad.push(`${c} on ${t} (${v}): ${d.toFixed(1)}`);
        }
    expect(bad).toEqual([]);
  });

  it('every pair of colours is clearly different, with every kind of vision', () => {
    const bad: string[] = [];
    const COLORS = CVD_COLORS;
    for (let i = 0; i < COLORS.length; i++)
      for (let j = i + 1; j < COLORS.length; j++)
        for (const v of VISIONS) {
          const d = diff(PCOL[COLORS[i]!], PCOL[COLORS[j]!], v);
          if (d < 12) bad.push(`${COLORS[i]}/${COLORS[j]} (${v}): ${d.toFixed(1)}`);
        }
    expect(bad).toEqual([]);
  });

  it('the extra colours (2 October) stand out on every tile and from each other, for normal vision', () => {
    const bad: string[] = [];
    const extra = COLORS.filter((c) => !(CVD_COLORS as readonly string[]).includes(c));
    for (const c of extra)
      for (const [t, hex] of Object.entries(GROUNDS)) {
        const d = diff(PCOL[c], hex);
        if (d < 8) bad.push(`${c} on ${t}: ${d.toFixed(1)}`);
      }
    for (const c of extra)
      for (const o of COLORS) {
        if (o === c) continue;
        const d = diff(PCOL[c], PCOL[o]);
        if (d < 10) bad.push(`${c}/${o}: ${d.toFixed(1)}`);
      }
    expect(bad).toEqual([]);
  });

  it('the colour difference measure behaves (sanity checks)', () => {
    expect(diff('#ff0000', '#ff0000')).toBe(0);
    // Red and green look alike to protanopes and deuteranopes, not to normal vision.
    expect(diff('#d62728', '#2ca02c')).toBeGreaterThan(40);
    expect(diff('#d62728', '#2ca02c', 'deutan')).toBeLessThan(diff('#d62728', '#2ca02c'));
    expect(diff('#000000', '#ffffff')).toBeGreaterThan(99);
  });

  it('in every board style, every piece stands out from every tile: by its colour or its outline', () => {
    // The drawn styles outline every piece in a dark (or, at night, light) line, so a piece whose
    // colour is near a tile's still has a clear edge; Classic must pass on colour alone (above).
    const bad: string[] = [];
    for (const s of STYLES)
      for (const c of COLORS)
        for (const [t, hex] of Object.entries(STYLE_GROUNDS[s]))
          for (const v of (CVD_COLORS as readonly string[]).includes(c) ? VISIONS : (['normal'] as const)) {
            const fill = diff(PCOL[c], hex, v);
            const edge = diff(THEMES[s].edge(PCOL[c]), hex, v);
            if (s === 'classic' ? fill < 8 : fill < 8 && edge < 30)
              bad.push(`${s}: ${c} on ${t} (${v}): colour ${fill.toFixed(1)}, outline ${edge.toFixed(1)}`);
          }
    expect(bad).toEqual([]);
  });
});

describe('card colours (SPEC 13.2)', () => {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const sat = (h: string) => Math.max(...rgb(h)) - Math.min(...rgb(h));
  it('the coin is silver: grey, and plainly different from ore beside it', () => {
    expect(sat(CARD_COLOR.coin)).toBeLessThan(0.12);
    for (const vision of VISIONS)
      expect(diff(CARD_COLOR.coin, CARD_COLOR.ore, vision), vision).toBeGreaterThan(20);
  });
});
