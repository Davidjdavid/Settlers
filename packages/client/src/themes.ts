/*
 * Art styles (3 October): how the board looks on your screen. Classic, Pixel, Wooden, Flat and
 * Night. A style changes only how things are drawn (tiles, sea, beaches, number tokens, harbors,
 * pieces), never what's where, and it's yours alone: saved on your profile, nobody else's screen
 * changes. Classic draws exactly what the board drew before styles existed.
 *
 * The board's drawing functions build SVG strings synchronously, so the style in use is a module
 * value, set by the board (and the map board) before it draws.
 */

import type { Terrain } from '@settlers/engine';
import { GLYPH, K, TILE_COLOR, edgeOf, f1, hexPts } from './art';

export const STYLES = ['classic', 'pixel', 'wooden', 'flat', 'night'] as const;
export type ArtStyle = (typeof STYLES)[number];
export const STYLE_LABEL: Record<ArtStyle, string> = {
  classic: 'Classic',
  pixel: 'Pixel',
  wooden: 'Wooden',
  flat: 'Flat',
  night: 'Night',
};
export const STYLE_HELP: Record<ArtStyle, string> = {
  classic: 'The standard look.',
  pixel: 'Pixel art: blocky tiles, chunky pieces and pixel numbers, with boats on the water.',
  wooden: 'Like the box: a wooden frame, painted tiles on grainy paper and wooden number discs.',
  flat: 'Simple bold shapes and big numbers. The easiest to read on a phone or across a room.',
  night: 'Dark tiles and glowing pieces and numbers. Easy on the eyes late at night.',
};

export interface Theme {
  id: ArtStyle;
  tile: Record<Terrain, string>;
  /** Each terrain's picture (24×24, centred), drawn a few times on its tile. */
  glyph: Record<Terrain, string>;
  /** Pictures scattered round the tile, or one above the number. */
  decor: 'scatter' | 'single';
  /** Extra attributes on each picture (a filter, an opacity). */
  glyphAttr: (t: Terrain) => string;
  /** Definitions (patterns, filters, gradients) and the sea behind the island. */
  seaDefs: string;
  sea: (box: string) => string;
  /** A sea hex's own outline, and anything drawn on it (pixel boats). */
  seaHex: (cx: number, cy: number, i: number) => string;
  beach: [string, string];
  hexStroke: string;
  hexStrokeW: number;
  innerRing: string | null;
  /** Drawn over the finished tiles (wood grain). */
  overlay: (vb: number[]) => string;
  /** A number token. */
  token: (cx: number, cy: number, n: number) => string;
  /** Text on the board (harbor ratios). */
  text: (x: number, y: number, s: string, size: number, color: string, weight?: number) => string;
  /** The outline round a piece in this colour. */
  edge: (color: string) => string;
  /** Wrapped round every piece (night's glow). */
  piecesOpen: string;
  piecesClose: string;
  /** The whole board drawn without smoothing (pixel art). */
  crisp: boolean;
}

/* ---------- Pixel art helpers ---------- */

/** A sprite from rows of characters: each character is a palette colour ('.' is empty). */
function sprite(rows: string[], pal: Record<string, string>, px = 2.6): string {
  const w = rows[0]!.length;
  const h = rows.length;
  const x0 = (-w * px) / 2;
  const y0 = (-h * px) / 2;
  let out = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x]!;
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      if (c !== '.')
        out += `<rect x="${f1(x0 + x * px)}" y="${f1(y0 + y * px)}" width="${f1(run * px + 0.05)}" height="${f1(px + 0.05)}" fill="${pal[c]}"/>`;
      x += run;
    }
  });
  return out;
}

/** A 3×5 pixel font: digits and the colon of "3:1". */
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
  '?': ['111', '001', '011', '000', '010'],
};
/** Text in the pixel font, centred on x, y; `size` is the height of a character. */
export function pixelText(x: number, y: number, s: string, size: number, color: string): string {
  const p = size / 5;
  const chars = [...s].map((c) => DIGITS[c]);
  const width = chars.reduce((a, g) => a + (g ? g[0]!.length : 3) * p, 0) + (chars.length - 1) * p;
  let cx = x - width / 2;
  let out = '';
  for (const g of chars) {
    if (!g) {
      cx += 4 * p;
      continue;
    }
    g.forEach((row, r) =>
      [...row].forEach((bit, c) => {
        if (bit === '1')
          out += `<rect x="${f1(cx + c * p)}" y="${f1(y - size / 2 + r * p)}" width="${f1(p + 0.05)}" height="${f1(p + 0.05)}" fill="${color}"/>`;
      }),
    );
    cx += (g[0]!.length + 1) * p;
  }
  return `<g class="ptext" shape-rendering="crispEdges">${out}</g>`;
}

const PIXEL_GLYPH: Record<Terrain, string> = {
  wood: sprite(['...gg...', '..gGgg..', '.gggGgg.', '..gggg..', '.gGgggg.', 'gggggGgg', '...bb...', '...bb...'], { g: '#1d5e2c', G: '#3f9a4c', b: '#5a3a1c' }), // prettier-ignore
  brick: sprite(['rrrr.rrr', 'RRRR.RRR', '........', 'rr.rrrr.', 'RR.RRRR.', '........', 'rrrr.rrr', 'RRRR.RRR'], { r: '#9c3418', R: '#6a200f' }), // prettier-ignore
  sheep: sprite(['........', '..wwww..', '.wwwwwwk', 'wwwwwwkk', '.wwwwww.', '..k..k..', '..k..k..', '........'], { w: '#ffffff', k: '#2a2a2a' }), // prettier-ignore
  wheat: sprite(['..y.y...', '.yYyYy..', '..yYy...', '.yYyYy..', '..yyy...', '...s....', '..s.s...', '.s...s..'], { y: '#a8730f', Y: '#6e4a08', s: '#8a5a14' }), // prettier-ignore
  ore: sprite(['....w...', '...www..', '..wgggw.', '..ggggg.', '.gggggg.', '.gggGggg', 'ggggGggg', 'gggggggg'], { w: '#ffffff', g: '#4a525c', G: '#2c3138' }), // prettier-ignore
  gold: sprite(['..yyyy..', '.yYYYYy.', '.yYyyYy.', '.yYYYYy.', '..yyyy..', '.yyyyyy.', 'yYYYYYYy', '.yyyyyy.'], { y: '#ffe066', Y: '#a87c08' }), // prettier-ignore
  desert: sprite(['...g....', '...g..g.', 'g..g..g.', 'g..gggg.', 'gggg....', '...g....', '...g....', '..ggg...'], { g: '#4f7a2a' }), // prettier-ignore
  fog: sprite(['........', '..ww....', '.wwww.w.', 'wwwwwwww', 'wwwwwwww', '.wwwwww.', '........', '........'], { w: '#dfe7ea' }), // prettier-ignore
  sea: sprite(['........', '.w...w..', 'w.w.w.w.', '........'], { w: '#cfe6ff' }),
};
const PIXEL_BOAT = sprite(['....w...', '....ww..', '....www.', '....w...', 'bbbbbbbb', '.bbbbbb.'], { w: '#f4f1e8', b: '#6b4523' }, 2.2); // prettier-ignore

/* ---------- The styles ---------- */

const classicToken = (cx: number, cy: number, n: number): string => {
  const red = n === 6 || n === 8;
  const pips = 6 - Math.abs(7 - n);
  let dots = '';
  for (let k = 0; k < pips; k++) {
    const x = cx + (k - (pips - 1) / 2) * 0.085 * K;
    dots += `<circle cx="${f1(x)}" cy="${f1(cy + 0.19 * K)}" r="${0.032 * K}" fill="${red ? '#b3261e' : '#28343a'}"/>`;
  }
  return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="url(#tokshade)" stroke="rgba(10,27,35,.45)" stroke-width="2"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#b3261e' : '#1d2a30'}">${n}</text>${dots}`;
};
const plainText = (x: number, y: number, s: string, size: number, color: string, weight = 400) =>
  `<text x="${f1(x)}" y="${f1(y)}" text-anchor="middle" dominant-baseline="central" font-size="${f1(size)}" fill="${color}"${weight !== 400 ? ` font-weight="${weight}"` : ''}>${s}</text>`;
const glyphSymbols = (g: Record<Terrain, string>) =>
  Object.entries(g)
    .map(([k, v]) => `<symbol id="g-${k}" viewBox="-12 -12 24 24">${v}</symbol>`)
    .join('');
const pips = (cx: number, cy: number, n: number, color: string, square = false) => {
  const count = 6 - Math.abs(7 - n);
  let out = '';
  for (let k = 0; k < count; k++) {
    const x = cx + (k - (count - 1) / 2) * 0.085 * K;
    out += square
      ? `<rect x="${f1(x - 0.028 * K)}" y="${f1(cy - 0.028 * K)}" width="${f1(0.056 * K)}" height="${f1(0.056 * K)}" fill="${color}"/>`
      : `<circle cx="${f1(x)}" cy="${f1(cy)}" r="${0.032 * K}" fill="${color}"/>`;
  }
  return out;
};

const classic: Theme = {
  id: 'classic',
  tile: TILE_COLOR,
  glyph: GLYPH,
  decor: 'scatter',
  glyphAttr: (t) => ` opacity="${t === 'desert' ? 0.7 : 0.85}"`,
  seaDefs: `<pattern id="waves" width="54" height="26" patternUnits="userSpaceOnUse"><path d="M2 15q12.5-9 25 0t25 0" fill="none" stroke="#2a7183" stroke-width="2" stroke-linecap="round" opacity=".55"/></pattern>${glyphSymbols(GLYPH)}<radialGradient id="tokshade" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadfc2"/></radialGradient>`,
  sea: (box) =>
    `<rect ${box} fill="#12404f"/><rect ${box} fill="url(#waves)"/><rect ${box} fill="none" stroke="#1d5767" stroke-width="2"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(255,255,255,.025)" stroke="rgba(160,215,225,.16)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['#d9c69a', '#c9b382'],
  hexStroke: 'rgba(10,27,35,.35)',
  hexStrokeW: 2,
  innerRing: 'rgba(255,255,255,.08)',
  overlay: () => '',
  token: classicToken,
  text: plainText,
  edge: edgeOf,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const PIXEL_TILE: Record<Terrain, string> = {
  wood: '#3e9a48',
  brick: '#d0603f',
  sheep: '#94d556',
  wheat: '#f2c94c',
  ore: '#a3acb6',
  desert: '#ead39a',
  gold: '#d9a520',
  sea: '#3f6fd8',
  fog: '#77848c',
};
const pixel: Theme = {
  id: 'pixel',
  tile: PIXEL_TILE,
  glyph: PIXEL_GLYPH,
  decor: 'scatter',
  glyphAttr: () => '',
  seaDefs: `<pattern id="pxwaves" width="48" height="30" patternUnits="userSpaceOnUse"><rect x="4" y="6" width="10" height="3" fill="#8fb4ff" opacity=".55"/><rect x="28" y="20" width="12" height="3" fill="#8fb4ff" opacity=".45"/></pattern>${glyphSymbols(PIXEL_GLYPH)}<symbol id="px-boat" viewBox="-12 -12 24 24">${PIXEL_BOAT}</symbol>`,
  sea: (box) =>
    `<rect ${box.replace(/rx="[^"]*"/, 'rx="0"')} fill="#2f5ec8"/><rect ${box.replace(/rx="[^"]*"/, 'rx="0"')} fill="url(#pxwaves)"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="#3f6fd8" stroke="#2a52ad" stroke-width="3" data-sea="${i}"/>` +
    (i % 5 === 2
      ? `<use href="#px-boat" x="${f1(cx - 0.3 * K)}" y="${f1(cy - 0.3 * K)}" width="${f1(0.6 * K)}" height="${f1(0.6 * K)}"/>`
      : `<use href="#g-sea" x="${f1(cx - 0.3 * K)}" y="${f1(cy - 0.2 * K)}" width="${f1(0.6 * K)}" height="${f1(0.4 * K)}" opacity=".8"/>`),
  beach: ['#f0dc9c', '#c9a85a'],
  hexStroke: '#1b2633',
  hexStrokeW: 3,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    const s = 0.62 * K;
    return `<rect x="${f1(cx - s / 2)}" y="${f1(cy - s / 2)}" width="${f1(s)}" height="${f1(s)}" fill="#f6e8c3" stroke="#1b2633" stroke-width="3"/>${pixelText(cx, cy - 0.06 * K, String(n), 0.24 * K, red ? '#c0261b' : '#1d2a30')}${pips(cx, cy + 0.19 * K, n, red ? '#c0261b' : '#1d2a30', true)}`;
  },
  text: (x, y, s, size, color) => pixelText(x, y, s, size * 0.8, color),
  edge: () => '#1b2633',
  piecesOpen: '<g shape-rendering="crispEdges">',
  piecesClose: '</g>',
  crisp: true,
};

const WOOD_TILE: Record<Terrain, string> = {
  wood: '#4f7f3c',
  brick: '#b8633d',
  sheep: '#a7c66a',
  wheat: '#dcb556',
  ore: '#8e928c',
  desert: '#dcc794',
  gold: '#b98a2a',
  sea: '#4f7f88',
  fog: '#7b8183',
};
const wooden: Theme = {
  id: 'wooden',
  tile: WOOD_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphAttr: (t) => ` opacity="${t === 'desert' ? 0.65 : 0.75}"`,
  seaDefs: `<pattern id="inkwaves" width="60" height="30" patternUnits="userSpaceOnUse"><path d="M3 17q13-9 27 0t27 0" fill="none" stroke="#2f5560" stroke-width="2" stroke-linecap="round" opacity=".5"/></pattern>${glyphSymbols(GLYPH)}<radialGradient id="woodtok" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#f2d9a6"/><stop offset=".7" stop-color="#d8b07a"/><stop offset="1" stop-color="#b98a52"/></radialGradient><filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="3"/><feColorMatrix type="saturate" values="0"/></filter><linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a30"/><stop offset=".5" stop-color="#6e4421"/><stop offset="1" stop-color="#8a5a30"/></linearGradient>`,
  sea: (box) =>
    `<rect ${box} fill="#5b8a92"/><rect ${box} fill="url(#inkwaves)"/><rect ${box} fill="none" stroke="#5a3a1c" stroke-width="6"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(255,255,255,.03)" stroke="rgba(40,60,60,.18)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['url(#frame)', '#c79c62'],
  hexStroke: 'rgba(60,35,15,.6)',
  hexStrokeW: 2.5,
  innerRing: null,
  overlay: (vb) =>
    `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" filter="url(#grain)" opacity=".13" style="mix-blend-mode:multiply" pointer-events="none"/>`,
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="url(#woodtok)" stroke="#5a3a1c" stroke-width="2.5"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.27 * K}" fill="none" stroke="#8a6034" stroke-width="1" opacity=".5"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#9a2216' : '#3a2410'}" font-family="Georgia, 'Times New Roman', serif" font-weight="700">${n}</text>${pips(cx, cy + 0.19 * K, n, red ? '#9a2216' : '#3a2410')}`;
  },
  text: (x, y, s, size, color, weight) =>
    plainText(x, y, s, size, color, weight).replace(
      '<text ',
      `<text font-family="Georgia, 'Times New Roman', serif" `,
    ),
  edge: () => '#3b2410',
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const FLAT_TILE: Record<Terrain, string> = {
  wood: '#2e9e5b',
  brick: '#e2703f',
  sheep: '#a6dc5a',
  wheat: '#f6c945',
  ore: '#8f9bab',
  desert: '#efe2bd',
  gold: '#e2a917',
  sea: '#2f86c9',
  fog: '#7d8a92',
};
const flat: Theme = {
  id: 'flat',
  tile: FLAT_TILE,
  glyph: GLYPH,
  decor: 'single',
  glyphAttr: () => ' opacity=".9"',
  seaDefs: glyphSymbols(GLYPH),
  sea: (box) => `<rect ${box} fill="#2479b8"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['#f4ecd6', '#f4ecd6'],
  hexStroke: '#ffffff',
  hexStrokeW: 4,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.36 * K}" fill="#ffffff"/><text x="${f1(cx)}" y="${f1(cy - 0.04 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.32 : 0.38) * K}" fill="${red ? '#e53935' : '#263238'}" font-family="system-ui, sans-serif" font-weight="800">${n}</text>${pips(cx, cy + 0.22 * K, n, red ? '#e53935' : '#263238')}`;
  },
  text: (x, y, s, size, color) =>
    plainText(x, y, s, size, color, 800).replace('<text ', '<text font-family="system-ui, sans-serif" '),
  edge: edgeOf,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const NIGHT_TILE: Record<Terrain, string> = {
  wood: '#1f5137',
  brick: '#743222',
  sheep: '#4b6e2a',
  wheat: '#7f6320',
  ore: '#414a56',
  desert: '#5d5342',
  gold: '#80600f',
  sea: '#0a1a2e',
  fog: '#323b42',
};
/** Night's outline round every piece: light, so dark colours stand out on dark tiles. */
export const NIGHT_EDGE = '#f4ecd6';
const night: Theme = {
  id: 'night',
  tile: NIGHT_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphAttr: () => ' filter="url(#nightglyph)" opacity=".75"',
  seaDefs: `<pattern id="stars" width="70" height="56" patternUnits="userSpaceOnUse"><circle cx="9" cy="11" r="1.3" fill="#b9c8ff" opacity=".7"/><circle cx="44" cy="31" r="1" fill="#b9c8ff" opacity=".55"/><circle cx="61" cy="6" r=".9" fill="#ffe7a8" opacity=".6"/><path d="M14 46q10-6 20 0t20 0" fill="none" stroke="#1d3a5c" stroke-width="2" stroke-linecap="round" opacity=".6"/></pattern>${glyphSymbols(GLYPH)}<filter id="nightglyph"><feFlood flood-color="#f3e2b0"/><feComposite in2="SourceAlpha" operator="in"/></filter><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b"/><feFlood flood-color="#ffd98a" flood-opacity=".55"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  sea: (box) =>
    `<rect ${box} fill="#050c18"/><rect ${box} fill="url(#stars)"/><rect ${box} fill="none" stroke="#1d3a5c" stroke-width="2"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(80,120,200,.04)" stroke="rgba(140,170,255,.14)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['#2b2a33', '#1f1e27'],
  hexStroke: 'rgba(255,214,140,.4)',
  hexStrokeW: 2,
  innerRing: 'rgba(255,220,150,.12)',
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="#131b2a" stroke="#ffd27a" stroke-width="2"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#ff8a78' : '#ffe7a8'}">${n}</text>${pips(cx, cy + 0.19 * K, n, red ? '#ff8a78' : '#ffe7a8')}`;
  },
  text: plainText,
  edge: () => NIGHT_EDGE,
  piecesOpen: '<g filter="url(#glow)">',
  piecesClose: '</g>',
  crisp: false,
};

export const THEMES: Record<ArtStyle, Theme> = { classic, pixel, wooden, flat, night };

let current: Theme = classic;
/** The style the board draws in now. */
export const T = (): Theme => current;
/** Set the style before drawing (an unknown or missing style is Classic). */
export function useStyle(s: string | null | undefined): ArtStyle {
  const id = (STYLES as readonly string[]).includes(s ?? '') ? (s as ArtStyle) : 'classic';
  current = THEMES[id];
  return id;
}

/** Board colours, for checks: every piece colour against every tile and the water. */
export const GROUNDS: Record<ArtStyle, Record<string, string>> = {
  classic: { ...TILE_COLOR, water: '#12404f' },
  pixel: { ...PIXEL_TILE, water: '#2f5ec8' },
  wooden: { ...WOOD_TILE, water: '#5b8a92' },
  flat: { ...FLAT_TILE, water: '#2479b8' },
  night: { ...NIGHT_TILE, water: '#050c18' },
};
/** Styles whose pieces stand out by a light outline rather than by their colour (night). */
export const OUTLINED: readonly ArtStyle[] = ['night'];
