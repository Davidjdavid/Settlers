/*
 * The Pixel style's art (3 October): 16-bit-looking sprites, 16×16 with three or four shades and
 * a dark outline added round every shape, pixel ground textures for the tiles, and pixel pieces
 * in each player's colour. Everything is squares (SVG rects), so nothing needs a font or image.
 */

import type { Terrain } from '@settlers/engine';
import { K, f1 } from './art';

/** Rows of palette characters ('.' empty) to rects; `o` is added round shapes as an outline. */
export function sprite(rows: string[], pal: Record<string, string>, px: number, outline = '#141821'): string {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => r.padEnd(w, '.').split(''));
  // The outline: every empty cell touching a filled one (not diagonally).
  if (outline) {
    const filled = (x: number, y: number) =>
      grid[y]?.[x] != null && grid[y]![x] !== '.' && grid[y]![x] !== 'o';
    for (let y = -1; y <= h; y++)
      for (let x = -1; x <= w; x++) {
        if (filled(x, y)) continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          if (y < 0 || y >= h || x < 0 || x >= w) continue;
          grid[y]![x] = 'o';
        }
      }
  }
  const x0 = (-w * px) / 2;
  const y0 = (-h * px) / 2;
  let out = '';
  grid.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x]!;
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      const fill = c === 'o' ? outline : pal[c];
      if (c !== '.' && fill)
        out += `<rect x="${f1(x0 + x * px)}" y="${f1(y0 + y * px)}" width="${f1(run * px + 0.04)}" height="${f1(px + 0.04)}" fill="${fill}"/>`;
      x += run;
    }
  });
  return out;
}

/* ---------- Colours ---------- */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** A colour mixed toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const t = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  return (
    '#' +
    rgb(hex)
      .map((c) => Math.round(c + (t - c) * a))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

/* ---------- Tile pictures (24×24 box, 16×16 sprites) ---------- */

const PX = 1.45;

const TREE = [
  '.......l........',
  '......lmm.......',
  '.....lmmmd......',
  '....lmmmmmd.....',
  '.....mmmmd......',
  '....lmmmmmdd....',
  '...lmmmmmmmdd...',
  '....mmmmmmmd....',
  '...lmmmmmmmmdd..',
  '..lmmmmmmmmmmdd.',
  '.llmmmmmmmmmdddd',
  '...dddddddddd...',
  '......tTT.......',
  '......tTT.......',
  '......tTT.......',
];
const BRICKS = [
  '................',
  'lllllll.lllllll.',
  'mmmmmmm.mmmmmmm.',
  'ddddddd.ddddddd.',
  '................',
  'lll.lllllll.lllo',
  'mmm.mmmmmmm.mmm.',
  'ddd.ddddddd.ddd.',
  '................',
  'lllllll.lllllll.',
  'mmmmmmm.mmmmmmm.',
  'ddddddd.ddddddd.',
];
const SHEEP = [
  '......wwww......',
  '....wwwlwwww....',
  '...wlwwwwwlww...',
  '..wwwwwwwwwwwkk.',
  '..wlwwwwwwlwkkkk',
  '..wwwwwwwwwwkekk',
  '..sswwwwwwwwskk.',
  '...sswwwwwwss...',
  '....ssssssss....',
  '.....k.k..k.k...',
  '.....k.k..k.k...',
];
const WHEAT = [
  '...y...y...y....',
  '..yYy.yYy.yYy...',
  '...yYyyYyyYy....',
  '..yYyyYyyYyy....',
  '...yyYyYyYy.....',
  '....yyyYyy......',
  '......sSs.......',
  '......sSs.......',
  '.....bbbbb......',
  '......sSs.......',
  '.....s.S.s......',
  '....s..S..s.....',
  '...s...S...s....',
];
const MOUNTAIN = [
  '.......ww.......',
  '......wwwg......',
  '.....wwwggg.....',
  '....wwggggdd....',
  '...wwggggggdd...',
  '..wgggggggdddd..',
  '..ggggggddgdddd.',
  '.gggggggddggdddd',
  'ggggggdddddggddd',
  'gggggddddddddddd',
];
const GOLD = [
  '........*.......',
  '.......***......',
  '........*.......',
  '.....yyyy.......',
  '....yWYYYy......',
  '...yWyyyyYy.yyy.',
  '...yYyYYyYyyWYYy',
  '...yYYYYYYyYyyyY',
  '....yyyyyyyYYYYy',
  '..yyyyy....yyyy.',
  '.yWYYYYy........',
  '.yYyyyYy........',
  '..yyyyy.........',
];
const CACTUS = [
  '......gg........',
  '.....glgg.......',
  '.....glgg..gg...',
  '.gg..glgg.glgg..',
  'glgg.glgg.glgg..',
  'glgg.glggggggg..',
  'glgggglggdddd...',
  '.ggggglgg.......',
  '.....glgg.......',
  '.....glgg.......',
  '.....glgg....pp.',
  '..pp.ggdd...pPp.',
];
const CLOUD = [
  '................',
  '.....wwww.......',
  '...wwwwwwww.ww..',
  '..wwwwwwwwwwwww.',
  '.wwwwwwwwwwwwwww',
  '.ssswwwwwwwwssss',
  '..ssssssssssss..',
];
const WAVE = ['..ll......ll....', '.lmml....lmml...', 'm....mmmm....mmm'];
const BOAT = [
  '.......w........',
  '.......ww.......',
  '.......wwW......',
  '.......wwWW.....',
  '.......wwWWW....',
  '.......k........',
  'bbbbbbbbbbbbbbb.',
  '.BbbbbbbbbbbbB..',
  '..BBBBBBBBBBB...',
];

export const PIXEL_GLYPH: Record<Terrain, string> = {
  wood: sprite(TREE, { l: '#7fd36a', m: '#2f8a3e', d: '#1d5e2c', t: '#6e4523', T: '#4a2c14' }, PX),
  brick: sprite(BRICKS, { l: '#ef9a6a', m: '#b8472a', d: '#7a2a15' }, PX),
  sheep: sprite(SHEEP, { w: '#ffffff', l: '#e4e9ee', s: '#c7ced6', k: '#3a3a3a', e: '#ffffff' }, PX),
  wheat: sprite(WHEAT, { y: '#ffe48a', Y: '#d39a1c', s: '#b07a12', S: '#7a520a', b: '#8a4b1c' }, PX),
  ore: sprite(MOUNTAIN, { w: '#ffffff', g: '#9aa3ad', d: '#5a636e' }, PX),
  gold: sprite(GOLD, { y: '#ffd24a', Y: '#c98f0a', W: '#fff6c8', '*': '#ffffff' }, PX),
  desert: sprite(CACTUS, { g: '#3f8a3a', l: '#7ccf62', d: '#2a5e26', p: '#b39b6a', P: '#8a744a' }, PX),
  fog: sprite(CLOUD, { w: '#eef3f5', s: '#b9c6cc' }, PX),
  sea: sprite(WAVE, { l: '#ffffff', m: '#a9ccff' }, PX, ''),
};
export const PIXEL_BOAT = sprite(
  BOAT,
  { w: '#f4f1e8', W: '#d5cfbf', k: '#5a3a1c', b: '#8a5a2b', B: '#5a3a1c' },
  PX,
);

/** Ground textures: a few darker and lighter pixels repeated over a tile. */
export function pixelTextures(tile: Record<Terrain, string>): string {
  const tex = (t: Terrain, cells: [number, number, number][]) =>
    `<pattern id="tx-${t}" width="16" height="16" patternUnits="userSpaceOnUse">${cells
      .map(
        ([x, y, a]) => `<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${shade(tile[t], a)}"/>`,
      )
      .join('')}</pattern>`;
  return [
    tex('wood', [[1, 1, -0.2], [5, 4, 0.15], [3, 6, -0.2], [7, 2, 0.12]]),
    tex('brick', [[0, 1, -0.15], [4, 5, 0.12], [6, 2, -0.15], [2, 6, 0.1]]),
    tex('sheep', [[1, 2, 0.2], [2, 2, -0.15], [5, 5, 0.2], [6, 5, -0.15], [4, 0, 0.15]]),
    tex('wheat', [[1, 1, -0.15], [1, 2, -0.15], [5, 4, -0.15], [5, 5, -0.15], [3, 7, 0.2]]),
    tex('ore', [[2, 1, -0.18], [6, 3, 0.15], [1, 6, 0.12], [5, 6, -0.18]]),
    tex('desert', [[1, 1, -0.12], [6, 2, 0.15], [3, 5, -0.12], [7, 7, 0.1]]),
    tex('gold', [[2, 2, 0.35], [6, 5, -0.2], [4, 7, 0.3]]),
    tex('fog', [[2, 2, 0.1], [6, 6, -0.1]]),
    tex('sea', [[1, 3, 0.15], [2, 3, 0.15], [5, 6, 0.12], [6, 6, 0.12]]),
  ].join(''); // prettier-ignore
}

/* ---------- Pieces in a player's colour ---------- */

const HOUSE = ['...rr...', '..rrrr..', '.rrrrrr.', 'RRRRRRRR', '.wwwwww.', '.wwddww.', '.wwddww.'];
const CITY = [
  '...rr.......',
  '..rrrr......',
  '.rrrrrr.....',
  'RRRRRRRRwwww',
  '.wwwwwwwwwww',
  '.wwkwwddwkww',
  '.wwwwwddwwww',
];

/** A settlement or city as pixels, in the player's colour (wall a lighter tint). */
export function pixelBuilding(kind: 'settlement' | 'city', x: number, y: number, color: string): string {
  const pal = { r: shade(color, 0.25), R: shade(color, -0.25), w: color, d: '#2a1a0c', k: '#ffe9a8' };
  const px = (kind === 'city' ? 0.05 : 0.045) * K;
  return `<g transform="translate(${f1(x)} ${f1(y)})" shape-rendering="crispEdges">${sprite(kind === 'city' ? CITY : HOUSE, pal, px)}</g>`;
}

/** A road as a row of chunky squares along its edge. */
export function pixelRoad(x1: number, y1: number, x2: number, y2: number, color: string): string {
  const n = 7;
  const s = 0.13 * K;
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    out += `<rect x="${f1(x - s / 2 - 1.5)}" y="${f1(y - s / 2 - 1.5)}" width="${f1(s + 3)}" height="${f1(s + 3)}" fill="#141821"/>`;
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    out += `<rect x="${f1(x - s / 2)}" y="${f1(y - s / 2)}" width="${f1(s)}" height="${f1(s)}" fill="${color}"/><rect x="${f1(x - s / 2)}" y="${f1(y - s / 2)}" width="${f1(s)}" height="${f1(s / 3)}" fill="${shade(color, 0.3)}"/>`;
  }
  return `<g shape-rendering="crispEdges">${out}</g>`;
}

/** A number token: a bevelled square (light top-left, dark bottom-right). */
export function pixelTokenBox(cx: number, cy: number): string {
  const s = 0.62 * K;
  const b = 0.05 * K;
  const l = cx - s / 2;
  const t = cy - s / 2;
  return `<g shape-rendering="crispEdges"><rect x="${f1(l - 3)}" y="${f1(t - 3)}" width="${f1(s + 6)}" height="${f1(s + 6)}" fill="#141821"/><rect x="${f1(l)}" y="${f1(t)}" width="${f1(s)}" height="${f1(s)}" fill="#c9b48a"/><rect x="${f1(l)}" y="${f1(t)}" width="${f1(s - b)}" height="${f1(s - b)}" fill="#fff4d6"/><rect x="${f1(l + b)}" y="${f1(t + b)}" width="${f1(s - 2 * b)}" height="${f1(s - 2 * b)}" fill="#f3e2b8"/></g>`;
}
