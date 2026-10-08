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
import {
  PIXEL_BOAT,
  PIXEL_GLYPH,
  pixelBuilding,
  pixelRoad,
  pixelTextures,
  sprite,
  pixelTile,
  pixelTokenBox,
  shade,
} from './pixelart';

export const STYLES = [
  'classic',
  'pixel',
  'wooden',
  'flat',
  'night',
  'crayon',
  'smash',
  'platformer',
  'american',
  'pikmin',
] as const;
export type ArtStyle = (typeof STYLES)[number];
export const STYLE_LABEL: Record<ArtStyle, string> = {
  classic: 'Classic',
  pixel: 'Pixel',
  wooden: 'Wooden',
  flat: 'Flat',
  night: 'Night',
  crayon: 'Crayon',
  smash: 'Smash',
  platformer: 'Platformer',
  american: 'American',
  pikmin: 'Pikmin',
};
export const STYLE_HELP: Record<ArtStyle, string> = {
  classic: 'The standard look.',
  pixel: 'Pixel art: blocky tiles, chunky pieces and pixel numbers, with boats on the water.',
  wooden: 'Like the box: a wooden frame, painted tiles on grainy paper and wooden number discs.',
  flat: 'Simple bold shapes and big numbers. The easiest to read on a phone or across a room.',
  night: 'Dark tiles and glowing pieces and numbers. Easy on the eyes late at night.',
  crayon: 'Drawn with crayons on paper: waxy hatched colour, wobbly outlines and hand-written numbers.',
  smash:
    'A fighting-game stage: floating platforms with neon edges over a cosmic sky, and numbers as damage percentages that get hotter the more often they roll.',
  platformer:
    'A retro platformer: islands of grass-topped blocks floating in a bright sky with clouds and green pipes, numbers on golden blocks.',
  american:
    'Stars and stripes: a starry navy sea with fireworks, red-and-white shores and navy badges for the numbers.',
  pikmin:
    'A tiny explorer in a giant garden: a lily-pad pond, big leaves and flowers, little sprout creatures, and the numbers on round pellets.',
};

export interface Theme {
  id: ArtStyle;
  tile: Record<Terrain, string>;
  /** Each terrain's picture (24×24, centred), drawn a few times on its tile. */
  glyph: Record<Terrain, string>;
  /** Pictures scattered round the tile, or one above the number. */
  decor: 'scatter' | 'single';
  /** A tile drawn as a whole little landscape instead of scattered pictures (pixel). */
  tileArt: ((t: Terrain, cx: number, cy: number, i: number) => string) | null;
  /** How big the pictures are, against the classic size. */
  glyphScale: number;
  /** Extra attributes on each picture (a filter, an opacity). */
  glyphAttr: (t: Terrain) => string;
  /** Definitions (patterns, filters, gradients) and the sea behind the island. */
  seaDefs: string;
  sea: (box: string) => string;
  /** A sea hex's own outline, and anything drawn on it (pixel boats); `plain` (a harbor there): no boats. */
  seaHex: (cx: number, cy: number, i: number, plain?: boolean) => string;
  beach: [string, string];
  /** A tile's outline colour. */
  hexStroke: (t: Terrain) => string;
  hexStrokeW: number;
  /** A texture drawn over a tile's colour (pixel ground), as a fill. */
  tileTexture: (t: Terrain) => string | null;
  /** Pieces drawn the style's own way (pixel); null draws the usual shapes. */
  building: ((kind: 'settlement' | 'city', x: number, y: number, color: string) => string) | null;
  road: ((x1: number, y1: number, x2: number, y2: number, color: string) => string) | null;
  innerRing: string | null;
  /** Drawn over the finished tiles (wood grain). */
  overlay: (vb: number[]) => string;
  /** A number token. */
  token: (cx: number, cy: number, n: number) => string;
  /** A harbor's 3:1 disc, in the style (the ratio written on it). */
  port: (x: number, y: number, label: string) => string;
  /** Text on the board (harbor ratios). */
  text: (x: number, y: number, s: string, size: number, color: string, weight?: number) => string;
  /** The outline round a piece in this colour. */
  edge: (color: string) => string;
  /** Drawn under the filtered board (crayon's paper). */
  underlay: (box: string) => string;
  /** A filter on the whole board's tiles and sea (crayon's wobble and wax). */
  boardFilter: string | null;
  /** Wrapped round every piece (night's glow). */
  piecesOpen: string;
  piecesClose: string;
  /** The whole board drawn without smoothing (pixel art). */
  crisp: boolean;
}

/* ---------- Pixel art helpers ---------- */

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

/* ---------- The styles ---------- */

const classicToken = (cx: number, cy: number, n: number): string => {
  const red = n === 6 || n === 8;
  const pips = 6 - Math.abs(7 - n);
  let dots = '';
  for (let k = 0; k < pips; k++) {
    const x = cx + (k - (pips - 1) / 2) * 0.085 * K;
    dots += `<circle cx="${f1(x)}" cy="${f1(cy + 0.19 * K)}" r="${0.032 * K}" fill="${red ? '#b3261e' : '#28343a'}"/>`;
  }
  return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="url(#tokshade)" stroke="rgba(10,27,35,.45)" stroke-width="2"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#b3261e' : '#1d2a30'}">${n}</text><g data-pips="${pips}">${dots}</g>`;
};
const plainText = (x: number, y: number, s: string, size: number, color: string, weight = 400) =>
  `<text x="${f1(x)}" y="${f1(y)}" text-anchor="middle" dominant-baseline="central" font-size="${f1(size)}" fill="${color}"${weight !== 400 ? ` font-weight="${weight}"` : ''}>${s}</text>`;
const glyphSymbols = (g: Record<Terrain, string>) =>
  Object.entries(g)
    .map(([k, v]) => `<symbol id="g-${k}" viewBox="-12 -12 24 24">${v}</symbol>`)
    .join('');
const pips = (cx: number, cy: number, n: number, color: string, square = false) => {
  const count = 6 - Math.abs(7 - n);
  let out = `<g data-pips="${count}">`;
  for (let k = 0; k < count; k++) {
    const x = cx + (k - (count - 1) / 2) * 0.085 * K;
    out += square
      ? `<rect x="${f1(x - 0.028 * K)}" y="${f1(cy - 0.028 * K)}" width="${f1(0.056 * K)}" height="${f1(0.056 * K)}" fill="${color}"/>`
      : `<circle cx="${f1(x)}" cy="${f1(cy)}" r="${0.032 * K}" fill="${color}"/>`;
  }
  return `${out}</g>`;
};

/** Pips on a small dark bar under a token, for styles whose token has no room for them. */
const pipStrip = (cx: number, y: number, n: number, bg: string, dot: string) => {
  const count = 6 - Math.abs(7 - n);
  const w = (count - 1) * 0.085 * K + 0.1 * K;
  return `<rect x="${f1(cx - w / 2)}" y="${f1(y - 0.055 * K)}" width="${f1(w)}" height="${f1(0.11 * K)}" rx="${f1(0.055 * K)}" fill="${bg}"/>${pips(cx, y, n, dot)}`;
};

/** A harbor disc: a round marker with its ratio in the style's lettering. */
const disc =
  (fill: string, stroke: string, ink: string, sw = 2.5) =>
  (x: number, y: number, label: string) =>
    `<circle cx="${f1(x)}" cy="${f1(y)}" r="${0.3 * K}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
    T().text(x, y, label, 0.2 * K, ink);

const classic: Theme = {
  id: 'classic',
  tile: TILE_COLOR,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1,
  tileArt: null,
  glyphAttr: (t) => ` opacity="${t === 'desert' ? 0.7 : 0.85}"`,
  seaDefs: `<pattern id="waves" width="54" height="26" patternUnits="userSpaceOnUse"><path d="M2 15q12.5-9 25 0t25 0" fill="none" stroke="#2a7183" stroke-width="2" stroke-linecap="round" opacity=".55"/></pattern>${glyphSymbols(GLYPH)}<radialGradient id="tokshade" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadfc2"/></radialGradient>`,
  sea: (box) =>
    `<rect ${box} fill="#12404f"/><rect ${box} fill="url(#waves)"/><rect ${box} fill="none" stroke="#1d5767" stroke-width="2"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(255,255,255,.025)" stroke="rgba(160,215,225,.16)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['#d9c69a', '#c9b382'],
  hexStroke: () => 'rgba(10,27,35,.35)',
  hexStrokeW: 2,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: 'rgba(255,255,255,.08)',
  overlay: () => '',
  token: classicToken,
  port: disc('#f4ecd6', '#0a1b23', '#1b2a30'),
  text: plainText,
  edge: edgeOf,
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const PIXEL_TILE: Record<Terrain, string> = {
  wood: '#4aa04f',
  brick: '#d76b45',
  sheep: '#9bd85d',
  wheat: '#f0c65a',
  ore: '#9aa4b0',
  desert: '#e9d49c',
  gold: '#5b4a3a',
  sea: '#3d6fd6',
  fog: '#7a8890',
};
const pixel: Theme = {
  id: 'pixel',
  tile: PIXEL_TILE,
  glyph: PIXEL_GLYPH,
  decor: 'scatter',
  glyphScale: 1.35,
  tileArt: pixelTile,
  glyphAttr: () => '',
  seaDefs: `<pattern id="pxwaves" width="64" height="40" patternUnits="userSpaceOnUse"><rect x="4" y="8" width="12" height="3" fill="#7ea6ff" opacity=".6"/><rect x="8" y="5" width="4" height="3" fill="#bcd2ff" opacity=".6"/><rect x="36" y="27" width="14" height="3" fill="#7ea6ff" opacity=".5"/><rect x="41" y="24" width="4" height="3" fill="#bcd2ff" opacity=".5"/></pattern>${pixelTextures(PIXEL_TILE)}${glyphSymbols(PIXEL_GLYPH)}<symbol id="px-boat" viewBox="-12 -12 24 24">${PIXEL_BOAT}</symbol>`,
  sea: (box) =>
    `<rect ${box.replace(/rx="[^"]*"/, 'rx="0"')} fill="#2c5bc4"/><rect ${box.replace(/rx="[^"]*"/, 'rx="0"')} fill="url(#pxwaves)"/>`,
  seaHex: (cx, cy, i, plain) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="#3a69d0" stroke="#2650b0" stroke-width="3" data-sea="${i}"/><polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="url(#tx-sea)" pointer-events="none"/>` +
    (plain
      ? ''
      : i % 5 === 2
        ? `<use href="#px-boat" x="${f1(cx - 0.34 * K)}" y="${f1(cy - 0.34 * K)}" width="${f1(0.68 * K)}" height="${f1(0.68 * K)}"/>`
        : `<use href="#g-sea" x="${f1(cx - 0.32 * K)}" y="${f1(cy - 0.12 * K)}" width="${f1(0.64 * K)}" height="${f1(0.64 * K)}" opacity=".85"/>`),
  beach: ['#f3dea0', '#c49a52'],
  hexStroke: (t) => shade(PIXEL_TILE[t], -0.55),
  hexStrokeW: 3,
  tileTexture: (t) => `url(#tx-${t})`,
  building: pixelBuilding,
  road: pixelRoad,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `${pixelTokenBox(cx, cy)}${pixelText(cx, cy - 0.06 * K, String(n), 0.24 * K, red ? '#c0261b' : '#1d2a30')}${pips(cx, cy + 0.19 * K, n, red ? '#c0261b' : '#1d2a30', true)}`;
  },
  port: (x, y, label) => `${pixelTokenBox(x, y)}${pixelText(x, y, label, 0.16 * K, '#1d2a30')}`,
  text: (x, y, s, size, color) => pixelText(x, y, s, size * 0.8, color),
  edge: () => '#141821',
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const WOOD_TILE: Record<Terrain, string> = {
  wood: '#4f7f3c',
  brick: '#b8633d',
  sheep: '#a7c66a',
  wheat: '#dcb556',
  ore: '#8e928c',
  desert: '#dcc794',
  gold: '#5c4a33',
  sea: '#4f7f88',
  fog: '#7b8183',
};
const wooden: Theme = {
  id: 'wooden',
  tile: WOOD_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1,
  tileArt: null,
  glyphAttr: (t) => ` opacity="${t === 'desert' ? 0.65 : 0.75}"`,
  seaDefs: `<pattern id="inkwaves" width="60" height="30" patternUnits="userSpaceOnUse"><path d="M3 17q13-9 27 0t27 0" fill="none" stroke="#2f5560" stroke-width="2" stroke-linecap="round" opacity=".5"/></pattern>${glyphSymbols(GLYPH)}<radialGradient id="woodtok" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#f2d9a6"/><stop offset=".7" stop-color="#d8b07a"/><stop offset="1" stop-color="#b98a52"/></radialGradient><filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="3"/><feColorMatrix type="saturate" values="0"/></filter><linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a30"/><stop offset=".5" stop-color="#6e4421"/><stop offset="1" stop-color="#8a5a30"/></linearGradient>`,
  sea: (box) =>
    `<rect ${box} fill="#5b8a92"/><rect ${box} fill="url(#inkwaves)"/><rect ${box} fill="none" stroke="#5a3a1c" stroke-width="6"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(255,255,255,.03)" stroke="rgba(40,60,60,.18)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['url(#frame)', '#c79c62'],
  hexStroke: () => 'rgba(60,35,15,.6)',
  hexStrokeW: 2.5,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: null,
  overlay: (vb) =>
    `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" filter="url(#grain)" opacity=".13" style="mix-blend-mode:multiply" pointer-events="none"/>`,
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="url(#woodtok)" stroke="#5a3a1c" stroke-width="2.5"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.27 * K}" fill="none" stroke="#8a6034" stroke-width="1" opacity=".5"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#9a2216' : '#3a2410'}" font-family="Georgia, 'Times New Roman', serif" font-weight="700">${n}</text>${pips(cx, cy + 0.19 * K, n, red ? '#9a2216' : '#3a2410')}`;
  },
  port: disc('url(#woodtok)', '#5a3a1c', '#3a2410'),
  text: (x, y, s, size, color, weight) =>
    plainText(x, y, s, size, color, weight).replace(
      '<text ',
      `<text font-family="Georgia, 'Times New Roman', serif" `,
    ),
  edge: () => '#3b2410',
  underlay: () => '',
  boardFilter: null,
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
  gold: '#4a3f36',
  sea: '#2f86c9',
  fog: '#7d8a92',
};
const flat: Theme = {
  id: 'flat',
  tile: FLAT_TILE,
  glyph: GLYPH,
  decor: 'single',
  glyphScale: 1,
  tileArt: null,
  glyphAttr: () => ' opacity=".9"',
  seaDefs: glyphSymbols(GLYPH),
  sea: (box) => `<rect ${box} fill="#2479b8"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['#e7d8ae', '#d8c591'],
  hexStroke: (t) => shade(FLAT_TILE[t], -0.28),
  hexStrokeW: 2.5,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.36 * K}" fill="#ffffff"/><text x="${f1(cx)}" y="${f1(cy - 0.04 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.32 : 0.38) * K}" fill="${red ? '#e53935' : '#263238'}" font-family="system-ui, sans-serif" font-weight="800">${n}</text>${pips(cx, cy + 0.22 * K, n, red ? '#e53935' : '#263238')}`;
  },
  port: disc('#ffffff', 'none', '#263238', 0),
  text: (x, y, s, size, color) =>
    plainText(x, y, s, size, color, 800).replace('<text ', '<text font-family="system-ui, sans-serif" '),
  edge: edgeOf,
  underlay: () => '',
  boardFilter: null,
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
  gold: '#122027',
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
  glyphScale: 1,
  tileArt: null,
  glyphAttr: () => ' filter="url(#nightglyph)" opacity=".75"',
  seaDefs: `<pattern id="stars" width="70" height="56" patternUnits="userSpaceOnUse"><circle cx="9" cy="11" r="1.3" fill="#b9c8ff" opacity=".7"/><circle cx="44" cy="31" r="1" fill="#b9c8ff" opacity=".55"/><circle cx="61" cy="6" r=".9" fill="#ffe7a8" opacity=".6"/><path d="M14 46q10-6 20 0t20 0" fill="none" stroke="#1d3a5c" stroke-width="2" stroke-linecap="round" opacity=".6"/></pattern>${glyphSymbols(GLYPH)}<filter id="nightglyph"><feFlood flood-color="#f3e2b0"/><feComposite in2="SourceAlpha" operator="in"/></filter><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b"/><feFlood flood-color="#ffd98a" flood-opacity=".55"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  sea: (box) =>
    `<rect ${box} fill="#050c18"/><rect ${box} fill="url(#stars)"/><rect ${box} fill="none" stroke="#1d3a5c" stroke-width="2"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(80,120,200,.04)" stroke="rgba(140,170,255,.14)" stroke-width="1.5" data-sea="${i}"/>`,
  beach: ['#2b2a33', '#1f1e27'],
  hexStroke: () => 'rgba(255,214,140,.4)',
  hexStrokeW: 2,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: 'rgba(255,220,150,.12)',
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="#131b2a" stroke="#ffd27a" stroke-width="2"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#ff8a78' : '#ffe7a8'}">${n}</text>${pips(cx, cy + 0.19 * K, n, red ? '#ff8a78' : '#ffe7a8')}`;
  },
  port: disc('#131b2a', '#ffd27a', '#ffe7a8', 2),
  text: plainText,
  edge: () => NIGHT_EDGE,
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '<g filter="url(#glow)">',
  piecesClose: '</g>',
  crisp: false,
};

const CRAYON_TILE: Record<Terrain, string> = {
  wood: '#3f8f4a',
  brick: '#d4683f',
  sheep: '#9ccf55',
  wheat: '#f1c33f',
  ore: '#8d96a3',
  desert: '#e6d3a0',
  gold: '#6a5640',
  sea: '#4a8fd8',
  fog: '#9aa4aa',
};
/** Crayon hatching for a colour: strokes in a darker shade over a lighter wash. */
const hatch = (id: string, color: string, angle: number) =>
  `<pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><rect width="9" height="9" fill="${shade(color, 0.35)}"/><path d="M0 2h9M0 6.5h9" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/><path d="M0 4.3h9" stroke="${shade(color, -0.15)}" stroke-width="1.2" opacity=".6"/></pattern>`;
const handFont = `font-family="'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive"`;
const crayon: Theme = {
  id: 'crayon',
  tile: CRAYON_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1.1,
  tileArt: null,
  glyphAttr: () => ' opacity=".9"',
  seaDefs: `${glyphSymbols(GLYPH)}${(Object.keys(CRAYON_TILE) as Terrain[]).map((t, i) => hatch(`hatch-${t}`, CRAYON_TILE[t], 30 + (i % 3) * 25)).join('')}${hatch('hatch-water', '#4a8fd8', -20)}<filter id="crayonpc" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="4" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter><filter id="crayonfx" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="7" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="2" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.35" result="m"/><feComposite in="d" in2="m" operator="in"/></filter>`,
  sea: (box) =>
    `<rect ${box.replace(/rx="[^"]*"/, 'rx="18"')} fill="#fbf6e9"/><rect ${box.replace(/rx="[^"]*"/, 'rx="18"')} fill="url(#hatch-water)" opacity=".85"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="#2f6fb8" stroke-width="1.5" opacity=".35" data-sea="${i}"/>`,
  beach: ['#5a4a3a', '#efe0b8'],
  hexStroke: (t) => shade(CRAYON_TILE[t], -0.45),
  hexStrokeW: 3,
  tileTexture: (t) => `url(#hatch-${t})`,
  building: null,
  road: null,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="#fffaf0" stroke="#3a3a3a" stroke-width="2.5"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.29 : 0.33) * K}" fill="${red ? '#d0281c' : '#2b2b2b'}" font-weight="700" ${handFont}>${n}</text>${pips(cx, cy + 0.2 * K, n, red ? '#d0281c' : '#2b2b2b')}`;
  },
  port: disc('#fffaf0', '#3a3a3a', '#2b2b2b'),
  text: (x, y, s, size, color) =>
    plainText(x, y, s, size, color, 700).replace('<text ', `<text ${handFont} `),
  edge: () => '#2b2b2b',
  underlay: (box) => `<rect ${box.replace(/rx="[^"]*"/, 'rx="18"')} fill="#fbf6e9"/>`,
  boardFilter: 'url(#crayonfx)',
  piecesOpen: '<g filter="url(#crayonpc)">',
  piecesClose: '</g>',
  crisp: false,
};

const SMASH_TILE: Record<Terrain, string> = {
  wood: '#2f8a4c',
  brick: '#cf5a36',
  sheep: '#8ccf4c',
  wheat: '#f0bf3a',
  ore: '#8c95a8',
  desert: '#d8c494',
  gold: '#3d3326',
  sea: '#1a1240',
  fog: '#5a5a7a',
};
/** Damage colours: hotter the more often a number rolls. */
const HEAT = ['#ffffff', '#ffffff', '#ffe14d', '#ffb347', '#ff7a3d', '#ff2d2d'];
const smash: Theme = {
  id: 'smash',
  tile: SMASH_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1,
  tileArt: null,
  glyphAttr: () => ' opacity=".8"',
  seaDefs: `${glyphSymbols(GLYPH)}<radialGradient id="stage" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#5a2a9a"/><stop offset=".45" stop-color="#22105a"/><stop offset="1" stop-color="#07051a"/></radialGradient><pattern id="rays" width="400" height="400" patternUnits="userSpaceOnUse"><path d="M200 200L0 0h60zM200 200L400 40v60zM200 200L300 400h-60zM200 200L0 260v60z" fill="#b48cff" opacity=".07"/></pattern><pattern id="sparks" width="90" height="70" patternUnits="userSpaceOnUse"><circle cx="12" cy="14" r="1.4" fill="#fff" opacity=".8"/><circle cx="61" cy="40" r="1" fill="#cfe8ff" opacity=".7"/><circle cx="80" cy="8" r="1.8" fill="#ffd6ff" opacity=".6"/></pattern><linearGradient id="platform" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f72"/><stop offset="1" stop-color="#14162a"/></linearGradient>`,
  sea: (box) =>
    `<rect ${box} fill="url(#stage)"/><rect ${box} fill="url(#rays)"/><rect ${box} fill="url(#sparks)"/><rect ${box} fill="none" stroke="#7a5cff" stroke-width="2" opacity=".6"/>`,
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="#7a5cff" stroke-width="1.2" opacity=".18" data-sea="${i}"/>`,
  beach: ['url(#platform)', '#1b1d33'],
  hexStroke: () => '#6ff3ff',
  hexStrokeW: 2.5,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: 'rgba(255,255,255,.18)',
  overlay: () => '',
  token: (cx, cy, n) => {
    const heat = HEAT[6 - Math.abs(7 - n)]!;
    const style = `font-family="'Arial Black', 'Arial', sans-serif" font-weight="900" font-style="italic" paint-order="stroke" stroke="#0b0b14" stroke-linejoin="round"`;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.36 * K}" fill="#0b0b14" opacity=".55"/><text x="${f1(cx - 0.04 * K)}" y="${f1(cy)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.3 : 0.36) * K}" fill="${heat}" stroke-width="5" ${style}>${n}</text><text x="${f1(cx + (n >= 10 ? 0.25 : 0.19) * K)}" y="${f1(cy + 0.1 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${0.16 * K}" fill="${heat}" stroke-width="3" ${style}>%</text>${pipStrip(cx, cy + 0.43 * K, n, 'rgba(11,11,20,.85)', heat)}`;
  },
  port: disc('rgba(11,11,20,.75)', '#6ff3ff', '#ffffff', 2),
  text: (x, y, s, size, color) =>
    plainText(x, y, s, size, color, 900).replace(
      '<text ',
      `<text font-family="'Arial Black', 'Arial', sans-serif" font-style="italic" `,
    ),
  edge: () => '#ffffff',
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

/** The sea's box (x, y, width, height) from its attributes, for styles that draw a scene in it. */
function boxOf(box: string): [number, number, number, number] {
  const n = (k: string) => Number(new RegExp(`${k}="([^"]*)"`).exec(box)![1]);
  return [n('x'), n('y'), n('width'), n('height')];
}

const PLAT_TILE: Record<Terrain, string> = {
  wood: '#2fa14a',
  brick: '#d0582a',
  sheep: '#84d64a',
  wheat: '#f6c93c',
  ore: '#a3aab8',
  desert: '#f2d596',
  gold: '#5a4632',
  sea: '#62b2ff',
  fog: '#b4bccd',
};
/** A cartoon cloud: three puffs on a flat base, outlined. */
const puff = (x: number, y: number, s: number) =>
  `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s})"><path d="M-30 10a12 12 0 0 1 4-21a16 16 0 0 1 28-6a14 14 0 0 1 24 8a11 11 0 0 1 4 19z" fill="#fff" stroke="#1a1a2e" stroke-width="2.4" stroke-linejoin="round"/><path d="M-22 6h40" stroke="#cfe6ff" stroke-width="3" stroke-linecap="round"/></g>`;
/** A rolling hill with a few darker spots. */
const hill = (x: number, base: number, w: number, h: number, fill: string) =>
  `<path d="M${f1(x - w / 2)} ${f1(base)}C${f1(x - w / 2)} ${f1(base - h)} ${f1(x + w / 2)} ${f1(base - h)} ${f1(x + w / 2)} ${f1(base)}Z" fill="${fill}" stroke="#14301a" stroke-width="2.5"/><ellipse cx="${f1(x - w * 0.12)}" cy="${f1(base - h * 0.55)}" rx="${f1(w * 0.04)}" ry="${f1(h * 0.09)}" fill="#14301a" opacity=".35"/><ellipse cx="${f1(x + w * 0.14)}" cy="${f1(base - h * 0.42)}" rx="${f1(w * 0.035)}" ry="${f1(h * 0.08)}" fill="#14301a" opacity=".35"/>`;
/** A green warp pipe standing on the ground. */
const pipe = (x: number, ground: number, h: number) =>
  `<g><rect x="${f1(x - 18)}" y="${f1(ground - h)}" width="36" height="${f1(h)}" fill="#22b14c" stroke="#0b3b18" stroke-width="2.5"/><rect x="${f1(x - 13)}" y="${f1(ground - h)}" width="6" height="${f1(h)}" fill="#7be08f"/><rect x="${f1(x - 24)}" y="${f1(ground - h - 16)}" width="48" height="18" rx="2" fill="#22b14c" stroke="#0b3b18" stroke-width="2.5"/><rect x="${f1(x - 19)}" y="${f1(ground - h - 14)}" width="7" height="14" fill="#7be08f"/></g>`;
/** A floating question-style block. */
const qblock = (x: number, y: number, s = 30, mark = '?') =>
  `<g><rect x="${f1(x - s / 2)}" y="${f1(y - s / 2)}" width="${s}" height="${s}" rx="3" fill="#ffc21a" stroke="#3a1e00" stroke-width="2.5"/><rect x="${f1(x - s / 2 + 2)}" y="${f1(y - s / 2 + 2)}" width="${s - 4}" height="4" fill="#ffe58a"/><rect x="${f1(x - s / 2 + 2)}" y="${f1(y + s / 2 - 6)}" width="${s - 4}" height="4" fill="#d97b00"/>${[
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
    .map(
      ([a, b]) =>
        `<circle cx="${f1(x + a! * (s / 2 - 5))}" cy="${f1(y + b! * (s / 2 - 5))}" r="1.8" fill="#3a1e00"/>`,
    )
    .join(
      '',
    )}<text x="${f1(x)}" y="${f1(y + 1)}" text-anchor="middle" dominant-baseline="central" font-size="${f1(s * 0.62)}" font-weight="900" fill="#fff" stroke="#3a1e00" stroke-width="2.5" paint-order="stroke" font-family="'Arial Black', Arial, sans-serif">${mark}</text></g>`;
const brickRow = (x: number, y: number, n: number) =>
  Array.from(
    { length: n },
    (_, k) =>
      `<rect x="${f1(x + k * 30)}" y="${f1(y)}" width="30" height="30" fill="#c84c0c" stroke="#3a1e00" stroke-width="2.5"/><path d="M${f1(x + k * 30)} ${f1(y + 15)}h30M${f1(x + k * 30 + 15)} ${f1(y)}v15" stroke="#3a1e00" stroke-width="1.6"/>`,
  ).join('');
const coin = (x: number, y: number) =>
  `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="7" ry="10" fill="#ffd21f" stroke="#7a4a00" stroke-width="2"/><rect x="${f1(x - 1.5)}" y="${f1(y - 5)}" width="3" height="10" rx="1.5" fill="#fff3b0"/>`;
const platformer: Theme = {
  id: 'platformer',
  tile: PLAT_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1.1,
  tileArt: null,
  glyphAttr: () => '',
  seaDefs: `${glyphSymbols(GLYPH)}<linearGradient id="plsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa8ff"/><stop offset="1" stop-color="#b8e4ff"/></linearGradient><pattern id="plground" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#c8641e"/><path d="M0 20h40M20 0v20M0 40h40M10 20v20M30 20v20" stroke="#5a2a08" stroke-width="2"/><path d="M2 2h14M22 22h14" stroke="#f0a060" stroke-width="2"/></pattern><pattern id="pldirt" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#a8581e"/><circle cx="4" cy="5" r="1.6" fill="#7a3a10"/><circle cx="12" cy="11" r="1.4" fill="#d08040"/></pattern>`,
  sea: (box) => {
    const [x, y, w, h] = boxOf(box);
    const ground = y + h - 40;
    // A side-scrolling stage: sky, clouds, hills, floating blocks and coins, pipes on brick ground.
    return [
      `<rect ${box} fill="url(#plsky)"/>`,
      `<g clip-path="inset(0 round 18px)">`,
      hill(x + w * 0.18, ground, w * 0.42, h * 0.32, '#5fcf5a'),
      hill(x + w * 0.78, ground, w * 0.5, h * 0.24, '#4cbf4c'),
      hill(x + w * 0.5, ground, w * 0.3, h * 0.16, '#79db5c'),
      puff(x + w * 0.14, y + h * 0.1, 1.1),
      puff(x + w * 0.62, y + h * 0.07, 0.9),
      puff(x + w * 0.88, y + h * 0.18, 1.2),
      puff(x + w * 0.36, y + h * 0.22, 0.8),
      brickRow(x + w * 0.06, y + h * 0.36, 2) +
        qblock(x + w * 0.06 + 75, y + h * 0.36 + 15) +
        brickRow(x + w * 0.06 + 90, y + h * 0.36, 1),
      qblock(x + w * 0.9, y + h * 0.45),
      coin(x + w * 0.84, y + h * 0.33) + coin(x + w * 0.88, y + h * 0.31) + coin(x + w * 0.92, y + h * 0.33),
      coin(x + w * 0.08, y + h * 0.62) + coin(x + w * 0.11, y + h * 0.6),
      pipe(x + w * 0.1, ground, h * 0.1),
      pipe(x + w * 0.92, ground, h * 0.16),
      `<rect x="${x}" y="${f1(ground)}" width="${w}" height="40" fill="url(#plground)"/><path d="M${x} ${f1(ground)}h${w}" stroke="#3a1e00" stroke-width="3"/>`,
      `</g>`,
      `<rect ${box} fill="none" stroke="#1a1a2e" stroke-width="3"/>`,
    ].join('');
  },
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="#ffffff" stroke-width="1" opacity=".18" data-sea="${i}"/>`,
  beach: ['url(#pldirt)', '#3cbf3c'],
  hexStroke: () => '#1a1a2e',
  hexStrokeW: 2.5,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: 'rgba(255,255,255,.22)',
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    const s = 0.6 * K;
    return `<rect x="${f1(cx - s / 2)}" y="${f1(cy - s / 2)}" width="${f1(s)}" height="${f1(s)}" rx="4" fill="#ffc21a" stroke="#3a1e00" stroke-width="2.5"/><rect x="${f1(cx - s / 2 + 2)}" y="${f1(cy - s / 2 + 2)}" width="${f1(s - 4)}" height="4" fill="#ffe58a"/><rect x="${f1(cx - s / 2 + 2)}" y="${f1(cy + s / 2 - 6)}" width="${f1(s - 4)}" height="4" fill="#d97b00"/>${[
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]
      .map(
        ([a, b]) =>
          `<circle cx="${f1(cx + a! * (s / 2 - 6))}" cy="${f1(cy + b! * (s / 2 - 6))}" r="2" fill="#3a1e00"/>`,
      )
      .join(
        '',
      )}<text x="${f1(cx)}" y="${f1(cy - 0.02 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.32) * K}" font-weight="900" fill="${red ? '#ff3b30' : '#ffffff'}" stroke="#3a1e00" stroke-width="4" paint-order="stroke" font-family="'Arial Black', Arial, sans-serif">${n}</text>${pipStrip(cx, cy + 0.42 * K, n, '#3a1e00', red ? '#ff6a5c' : '#ffd84a')}`;
  },
  port: (x, y, label) => qblock(x, y, 0.5 * K, label),
  text: (x, y, s, size, color) =>
    plainText(x, y, s, size, color, 900).replace(
      '<text ',
      `<text font-family="'Arial Black', Arial, sans-serif" `,
    ),
  edge: () => '#1a1a2e',
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const USA_TILE: Record<Terrain, string> = {
  wood: '#2e7d4a',
  brick: '#b8452e',
  sheep: '#8cc152',
  wheat: '#e8b84a',
  ore: '#8a94a6',
  desert: '#e4d2a4',
  gold: '#4f4234',
  sea: '#1b2f6b',
  fog: '#6b7486',
};
/** A five-pointed star of radius r at x, y. */
const star = (x: number, y: number, r: number, fill: string, extra = '') => {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rr = k % 2 ? r * 0.42 : r;
    pts.push(`${f1(x + Math.cos(a) * rr)},${f1(y + Math.sin(a) * rr)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"${extra}/>`;
};
/** A firework: rays and sparks in one colour. */
const firework = (x: number, y: number, color: string, r = 22) => {
  let out = '';
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI / 8) * k;
    out += `<line x1="${f1(x + Math.cos(a) * r * 0.3)}" y1="${f1(y + Math.sin(a) * r * 0.3)}" x2="${f1(x + Math.cos(a) * r)}" y2="${f1(y + Math.sin(a) * r)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/><circle cx="${f1(x + Math.cos(a) * (r + 4))}" cy="${f1(y + Math.sin(a) * (r + 4))}" r="1.6" fill="${color}"/>`;
  }
  return out + `<circle cx="${f1(x)}" cy="${f1(y)}" r="3" fill="#fff"/>`;
};
const american: Theme = {
  id: 'american',
  tile: USA_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1,
  tileArt: null,
  glyphAttr: (t) => ` opacity="${t === 'desert' ? 0.7 : 0.85}"`,
  seaDefs: `${glyphSymbols(GLYPH)}<linearGradient id="flagwave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".25" stop-color="#fff" stop-opacity=".1"/><stop offset=".5" stop-color="#000" stop-opacity=".16"/><stop offset=".75" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient><pattern id="tilestars" width="36" height="32" patternUnits="userSpaceOnUse">${star(8, 9, 3, 'rgba(255,255,255,.2)')}${star(26, 25, 3, 'rgba(255,255,255,.2)')}</pattern>`,
  sea: (box) => {
    const [x, y, w, h] = boxOf(box);
    // The whole board on a big waving flag: 13 stripes, a starry canton, bunting along the top.
    const sh = h / 13;
    let out = `<g clip-path="inset(0 round 18px)">`;
    for (let k = 0; k < 13; k++)
      out += `<rect x="${x}" y="${f1(y + k * sh)}" width="${w}" height="${f1(sh + 0.5)}" fill="${k % 2 ? '#f4efe6' : '#a3162b'}"/>`;
    const cw = w * 0.42;
    const ch = sh * 7;
    out += `<rect x="${x}" y="${y}" width="${f1(cw)}" height="${f1(ch)}" fill="#14275e"/>`;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < (r % 2 ? 5 : 6); c++)
        out += star(
          x + (c + (r % 2 ? 1 : 0.5)) * (cw / 6),
          y + (r + 0.6) * (ch / 9.4),
          Math.min(cw, ch) * 0.035,
          '#ffffff',
        );
    out += `<rect ${box} fill="url(#flagwave)"/><rect ${box} fill="#0a1a44" opacity=".28"/>`;
    // Bunting: swags of red, white and blue along the top.
    const n = 8;
    for (let k = 0; k < n; k++) {
      const x0 = x + (k * w) / n;
      const x1 = x0 + w / n;
      const d = h * 0.05;
      out += `<path d="M${f1(x0)} ${f1(y)}Q${f1((x0 + x1) / 2)} ${f1(y + d * 2.2)} ${f1(x1)} ${f1(y)}Z" fill="#14275e"/><path d="M${f1(x0)} ${f1(y)}Q${f1((x0 + x1) / 2)} ${f1(y + d * 1.5)} ${f1(x1)} ${f1(y)}Z" fill="#f4efe6"/><path d="M${f1(x0)} ${f1(y)}Q${f1((x0 + x1) / 2)} ${f1(y + d * 0.8)} ${f1(x1)} ${f1(y)}Z" fill="#c8102e"/><circle cx="${f1(x0)}" cy="${f1(y + 2)}" r="4" fill="#ffd54a"/>`;
    }
    out +=
      firework(x + w * 0.9, y + h * 0.2, '#ffd54a', 30) +
      firework(x + w * 0.1, y + h * 0.8, '#ffffff', 26) +
      firework(x + w * 0.88, y + h * 0.82, '#6fa8ff', 24);
    return `${out}</g><rect ${box} fill="none" stroke="#c8102e" stroke-width="5"/>`;
  },
  seaHex: (cx, cy, i) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="#ffffff" stroke-width="1" opacity=".14" data-sea="${i}"/>`,
  beach: ['#f4efe6', '#14275e'],
  hexStroke: () => '#0a1a44',
  hexStrokeW: 2.5,
  tileTexture: () => 'url(#tilestars)',
  building: null,
  road: null,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    const red = n === 6 || n === 8;
    return `${star(cx, cy + 2, 0.42 * K, 'rgba(0,0,0,.3)')}${star(cx, cy, 0.42 * K, '#ffffff', ' stroke="#14275e" stroke-width="2.5" stroke-linejoin="round"')}<text x="${f1(cx)}" y="${f1(cy + 0.04 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.34) * K}"${n >= 10 ? ' letter-spacing="-1"' : ''} fill="${red ? '#c8102e' : '#14275e'}" font-family="Rockwell, 'Roboto Slab', Georgia, serif" font-weight="900">${n}</text>${pipStrip(cx, cy + 0.45 * K, n, '#14275e', red ? '#ff6b7d' : '#ffffff')}`;
  },
  port: disc('#ffffff', '#14275e', '#14275e', 3),
  text: (x, y, s, size, color) => plainText(x, y, s, size, color, 800),
  edge: () => '#0a1a44',
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

const PIK_TILE: Record<Terrain, string> = {
  wood: '#3f8f3a',
  brick: '#b86a3e',
  sheep: '#86c94a',
  wheat: '#d9c25a',
  ore: '#8d8f86',
  desert: '#d8c08c',
  gold: '#5b4b38',
  sea: '#3c8f8a',
  fog: '#7b8a7e',
};
const leaf = (x: number, y: number, rot: number, s: number) =>
  `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${rot}) scale(${s})"><path d="M0 0C6-10 18-10 26 0C18 10 6 10 0 0Z" fill="#4caf50" stroke="#1f5e24" stroke-width="1.4"/><path d="M1 0H24" stroke="#1f5e24" stroke-width="1" opacity=".7"/></g>`;
const bloom = (x: number, y: number, petal: string) =>
  [0, 72, 144, 216, 288]
    .map((a) => {
      const r = (Math.PI / 180) * a;
      return `<circle cx="${f1(x + Math.cos(r) * 4.2)}" cy="${f1(y + Math.sin(r) * 4.2)}" r="3.6" fill="${petal}" stroke="#5a3a3a" stroke-width=".6"/>`;
    })
    .join('') + `<circle cx="${f1(x)}" cy="${f1(y)}" r="2.6" fill="#ffd54a"/>`;
/** A little sprout creature: a coloured body and a stem with a leaf, bud or flower on top. */
const sprout = (x: number, y: number, body: string, top: 'leaf' | 'bud' | 'flower') =>
  `<g transform="translate(${f1(x)} ${f1(y)}) scale(1.5)"><path d="M0-9V-19" stroke="#2e7d32" stroke-width="1.6"/>${
    top === 'leaf'
      ? '<path d="M0-19c4-5 9-5 11-1c-4 3-8 3-11 1z" fill="#66bb6a" stroke="#1f5e24" stroke-width=".8"/>'
      : top === 'bud'
        ? '<ellipse cx="0" cy="-21" rx="2.6" ry="3.6" fill="#f8bbd0" stroke="#8a4a5a" stroke-width=".8"/>'
        : bloom(0, -21, '#ffffff')
  }<ellipse cx="0" cy="-3" rx="4.2" ry="6.5" fill="${body}" stroke="#2a1a1a" stroke-width="1"/><circle cx="-1.6" cy="-6" r="1.4" fill="#fff"/><circle cx="1.6" cy="-6" r="1.4" fill="#fff"/><circle cx="-1.4" cy="-5.8" r=".7" fill="#111"/><circle cx="1.8" cy="-5.8" r=".7" fill="#111"/><path d="M-2 3.5V8M2 3.5V8" stroke="${body}" stroke-width="1.6" stroke-linecap="round"/></g>`;
const SPROUT_COLORS = ['#e53935', '#fdd835', '#1e88e5'];
const PIK_SPOTS: [number, number][] = [[-0.44, -0.42], [0.44, -0.42], [-0.58, 0.1], [0.58, 0.1], [-0.34, 0.54], [0.36, 0.54]]; // prettier-ignore
const pikmin: Theme = {
  id: 'pikmin',
  tile: PIK_TILE,
  glyph: GLYPH,
  decor: 'scatter',
  glyphScale: 1,
  tileArt: (t, cx, cy, i) => {
    // Fog is a cloud, as in every style: no garden, so it can't pass for land.
    if (t === 'fog')
      return `<use href="#g-fog" x="${f1(cx - 0.45 * K)}" y="${f1(cy - 0.45 * K)}" width="${f1(0.9 * K)}" height="${f1(0.9 * K)}" opacity=".85"/>`;
    let out = '';
    // The resource pictures, then the garden: big leaves, a flower and, on some tiles, sprouts.
    PIK_SPOTS.forEach(([fx, fy], j) => {
      const x = cx + fx * K;
      const y = cy + fy * K;
      if ((i + j) % 3 === 0) out += leaf(x - 10, y, ((i * 37 + j * 61) % 120) - 60, 1.1);
      else {
        const sz = 0.34 * K;
        out += `<use href="#g-${t}" x="${f1(x - sz / 2)}" y="${f1(y - sz / 2)}" width="${f1(sz)}" height="${f1(sz)}" opacity=".85"/>`;
      }
    });
    out += bloom(cx + 0.18 * K, cy - 0.72 * K, ['#f48fb1', '#ffffff', '#ce93d8'][i % 3]!);
    if (i % 3 === 0)
      out += sprout(
        cx - 0.3 * K,
        cy + 0.55 * K,
        SPROUT_COLORS[i % 9 === 0 ? 0 : i % 2 ? 1 : 2]!,
        (['leaf', 'bud', 'flower'] as const)[i % 3]!,
      );
    // Kept inside the tile's outline.
    return `<clipPath id="pkc-${i}"><polygon points="${hexPts(cx, cy, 0.93 * K)}"/></clipPath><g clip-path="url(#pkc-${i})">${out}</g>`;
  },
  glyphAttr: () => ' opacity=".85"',
  seaDefs: `${glyphSymbols(GLYPH)}<pattern id="ripples" width="70" height="44" patternUnits="userSpaceOnUse"><ellipse cx="18" cy="14" rx="10" ry="3.5" fill="none" stroke="#8fd3cc" stroke-width="1.4" opacity=".5"/><ellipse cx="52" cy="34" rx="7" ry="2.5" fill="none" stroke="#8fd3cc" stroke-width="1.2" opacity=".4"/></pattern><pattern id="soil" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#6b4a2b"/><circle cx="4" cy="5" r="1.6" fill="#8a6440"/><circle cx="13" cy="12" r="1.3" fill="#4e341c"/><circle cx="10" cy="3" r="1" fill="#9a7550"/></pattern>`,
  sea: (box) => `<rect ${box} fill="#2f7f7a"/><rect ${box} fill="url(#ripples)"/>`,
  seaHex: (cx, cy, i, plain) =>
    `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="none" stroke="#bfe9e4" stroke-width="1" opacity=".12" data-sea="${i}"/>` +
    (!plain && i % 4 === 1
      ? `<g transform="translate(${f1(cx)} ${f1(cy)}) rotate(${(i * 47) % 360})"><path d="M0 0L${f1(0.36 * K)} -6A${f1(0.37 * K)} ${f1(0.37 * K)} 0 1 0 ${f1(0.36 * K)} 6Z" fill="#5fae4f" stroke="#2f6b2a" stroke-width="1.6"/></g>${i % 8 === 1 ? bloom(cx + 8, cy - 6, '#f8bbd0') : ''}`
      : ''),
  beach: ['url(#soil)', '#8a6a3e'],
  hexStroke: () => '#2a3a1a',
  hexStrokeW: 2,
  tileTexture: () => null,
  building: null,
  road: null,
  innerRing: null,
  overlay: () => '',
  token: (cx, cy, n) => {
    // A pellet: red, yellow or blue, with its number.
    const col = n === 6 || n === 8 ? '#e53935' : n === 5 || n === 9 ? '#fbc02d' : '#1e88e5';
    return `<circle cx="${f1(cx)}" cy="${f1(cy + 2)}" r="${0.35 * K}" fill="rgba(0,0,0,.25)"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="${col}" stroke="#2a1a1a" stroke-width="2"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.25 * K}" fill="${shade(col, 0.25)}"/><ellipse cx="${f1(cx - 0.12 * K)}" cy="${f1(cy - 0.18 * K)}" rx="${0.08 * K}" ry="${0.04 * K}" fill="#ffffff" opacity=".7"/><text x="${f1(cx)}" y="${f1(cy)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.25 : 0.29) * K}" fill="#ffffff" stroke="#2a1a1a" stroke-width="3" paint-order="stroke" font-family="system-ui, sans-serif" font-weight="900">${n}</text>${pipStrip(cx, cy + 0.45 * K, n, '#2a1a1a', n === 6 || n === 8 ? '#ff8a80' : '#ffffff')}`;
  },
  port: disc('#e8f5e9', '#2e7d32', '#1f5e24', 2.5),
  text: plainText,
  edge: () => '#2a1a1a',
  underlay: () => '',
  boardFilter: null,
  piecesOpen: '',
  piecesClose: '',
  crisp: false,
};

export const THEMES: Record<ArtStyle, Theme> = {
  classic,
  pixel,
  wooden,
  flat,
  night,
  crayon,
  smash,
  platformer,
  american,
  pikmin,
};

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
  crayon: { ...CRAYON_TILE, water: '#4a8fd8' },
  smash: { ...SMASH_TILE, water: '#22105a' },
  platformer: { ...PLAT_TILE, water: '#62b2ff' },
  american: { ...USA_TILE, water: '#a3162b', water2: '#f4efe6', water3: '#14275e' },
  pikmin: { ...PIK_TILE, water: '#2f7f7a' },
};
/** Styles whose pieces stand out by a light outline rather than by their colour (night). */
export const OUTLINED: readonly ArtStyle[] = ['night', 'smash'];
