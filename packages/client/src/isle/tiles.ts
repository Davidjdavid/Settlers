/*
 * Isle tiles (docs/isle.md 3): each land tile is a thick toy block with a little scene on top,
 * drawn in a hex of radius 1 (pointy top) and kept clear in the middle for the number token.
 * The scenes are SVG symbols, a few variants each so neighbours don't look stamped.
 */

import type { Terrain } from '@settlers/engine';

export const f2 = (n: number) => Math.round(n * 1000) / 1000;

/** A pointy-topped hexagon of radius r with rounded corners, as a path. */
export function rhex(cx: number, cy: number, r: number, round = 0.12): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const k = Math.min(0.45, round / r);
  let d = '';
  for (let i = 0; i < 6; i++) {
    const p = pts[i]!;
    const prev = pts[(i + 5) % 6]!;
    const next = pts[(i + 1) % 6]!;
    const a = [p[0] + (prev[0] - p[0]) * k, p[1] + (prev[1] - p[1]) * k];
    const b = [p[0] + (next[0] - p[0]) * k, p[1] + (next[1] - p[1]) * k];
    d += `${i ? 'L' : 'M'}${f2(a[0]!)} ${f2(a[1]!)}Q${f2(p[0])} ${f2(p[1])} ${f2(b[0]!)} ${f2(b[1]!)}`;
  }
  return d + 'Z';
}

/** A small seeded random generator, so a tile always looks the same. */
export function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each terrain's top (light, dark) and side colour. */
export const GROUND: Record<string, { top: [string, string]; side: string; edge: string }> = {
  wood: { top: ['#8fd36b', '#55ab45'], side: '#3c7c33', edge: '#2f6a2a' },
  sheep: { top: ['#d4f285', '#99d35a'], side: '#6aa53c', edge: '#568c30' },
  wheat: { top: ['#ffe58a', '#f6bb34'], side: '#c98a1b', edge: '#a87214' },
  brick: { top: ['#f6a77a', '#d9673f'], side: '#a8462b', edge: '#8c3a24' },
  ore: { top: ['#d3dbe6', '#9ba7b8'], side: '#6e7a8c', edge: '#5b6676' },
  desert: { top: ['#fbecbd', '#ecd08c'], side: '#c7a35b', edge: '#ad8b47' },
  gold: { top: ['#74604b', '#463729'], side: '#2c2219', edge: '#1f1811' },
  fog: { top: ['#f4f7fa', '#d3dde6'], side: '#a2b2c1', edge: '#8a9baa' },
};

/* ---------- Little things ---------- */

const shadow = (x: number, y: number, rx: number, ry: number, o = 0.22) =>
  `<ellipse cx="${f2(x)}" cy="${f2(y)}" rx="${f2(rx)}" ry="${f2(ry)}" fill="#0b2a14" opacity="${o}"/>`;

/** A round leafy tree. */
function tree(x: number, y: number, s: number, tone = 0): string {
  const c = [
    ['#3f9f4a', '#6fd067', '#2a7a37'],
    ['#2f8f45', '#5cc25f', '#1f6a31'],
    ['#4aa84a', '#86da6a', '#2f7f35'],
  ][tone % 3]!;
  return (
    shadow(x + 0.02 * s, y + 0.11 * s, 0.13 * s, 0.05 * s) +
    `<rect x="${f2(x - 0.018 * s)}" y="${f2(y + 0.02 * s)}" width="${f2(0.036 * s)}" height="${f2(0.08 * s)}" rx="${f2(0.01 * s)}" fill="#7a4b2a"/>` +
    `<circle cx="${f2(x)}" cy="${f2(y - 0.03 * s)}" r="${f2(0.115 * s)}" fill="${c[2]}"/>` +
    `<circle cx="${f2(x - 0.008 * s)}" cy="${f2(y - 0.045 * s)}" r="${f2(0.1 * s)}" fill="${c[0]}"/>` +
    `<circle cx="${f2(x - 0.035 * s)}" cy="${f2(y - 0.075 * s)}" r="${f2(0.045 * s)}" fill="${c[1]}" opacity=".9"/>`
  );
}

/** A pine tree. */
function pine(x: number, y: number, s: number): string {
  const t = (w: number, y0: number, h: number, fill: string) =>
    `<path d="M${f2(x - w)} ${f2(y0)}Q${f2(x)} ${f2(y0 + 0.02 * s)} ${f2(x + w)} ${f2(y0)}L${f2(x + 0.01 * s)} ${f2(y0 - h)}Q${f2(x)} ${f2(y0 - h - 0.015 * s)} ${f2(x - 0.01 * s)} ${f2(y0 - h)}Z" fill="${fill}"/>`;
  return (
    shadow(x + 0.02 * s, y + 0.07 * s, 0.1 * s, 0.04 * s) +
    `<rect x="${f2(x - 0.014 * s)}" y="${f2(y + 0.01 * s)}" width="${f2(0.028 * s)}" height="${f2(0.06 * s)}" fill="#6b4024"/>` +
    t(0.1 * s, y + 0.03 * s, 0.13 * s, '#226f3a') +
    t(0.08 * s, y - 0.04 * s, 0.12 * s, '#2e8a46') +
    t(0.055 * s, y - 0.1 * s, 0.1 * s, '#3fa556')
  );
}

/** A fluffy sheep facing left or right. */
function sheep(x: number, y: number, s: number, flip = false): string {
  const d = flip ? -1 : 1;
  const wool = [
    [-0.05, 0],
    [0, -0.025],
    [0.05, 0],
    [0.025, 0.025],
    [-0.025, 0.025],
    [0, 0.01],
  ];
  return (
    `<g class="sheep">` +
    shadow(x, y + 0.075 * s, 0.1 * s, 0.03 * s, 0.25) +
    [-0.04, -0.015, 0.02, 0.045]
      .map(
        (lx) =>
          `<rect x="${f2(x + lx * s * d - 0.006 * s)}" y="${f2(y + 0.03 * s)}" width="${f2(0.012 * s)}" height="${f2(0.045 * s)}" rx="${f2(0.005 * s)}" fill="#3a3348"/>`,
      )
      .join('') +
    wool
      .map(
        ([wx, wy]) =>
          `<circle cx="${f2(x + wx! * s)}" cy="${f2(y + wy! * s)}" r="${f2(0.036 * s)}" fill="#f4f1ea"/>`,
      )
      .join('') +
    `<circle cx="${f2(x - 0.015 * s)}" cy="${f2(y - 0.02 * s)}" r="${f2(0.02 * s)}" fill="#ffffff"/>` +
    `<ellipse cx="${f2(x + 0.075 * s * d)}" cy="${f2(y - 0.01 * s)}" rx="${f2(0.03 * s)}" ry="${f2(0.026 * s)}" fill="#3a3348"/>` +
    `<ellipse cx="${f2(x + 0.06 * s * d)}" cy="${f2(y - 0.035 * s)}" rx="${f2(0.017 * s)}" ry="${f2(0.009 * s)}" fill="#3a3348" transform="rotate(${-25 * d} ${f2(x + 0.06 * s * d)} ${f2(y - 0.035 * s)})"/>` +
    `<circle cx="${f2(x + 0.083 * s * d)}" cy="${f2(y - 0.016 * s)}" r="${f2(0.005 * s)}" fill="#ffffff"/>` +
    `</g>`
  );
}

const flower = (x: number, y: number, c: string) =>
  `<circle cx="${f2(x)}" cy="${f2(y)}" r=".018" fill="${c}"/><circle cx="${f2(x)}" cy="${f2(y)}" r=".007" fill="#ffd54a"/>`;

const tuft = (x: number, y: number, c: string) =>
  `<path d="M${f2(x - 0.025)} ${f2(y)}l.012 -.035l.01 .03l.01 -.045l.008 .05l.012 -.03l.008 .03" fill="none" stroke="${c}" stroke-width=".012" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A wooden fence segment. */
function fence(x1: number, y1: number, x2: number, y2: number): string {
  const posts = [0, 0.5, 1]
    .map((t) => {
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      return `<rect x="${f2(x - 0.012)}" y="${f2(y - 0.06)}" width=".024" height=".075" rx=".006" fill="#8a5a33"/>`;
    })
    .join('');
  return (
    `<path d="M${f2(x1)} ${f2(y1 - 0.045)}L${f2(x2)} ${f2(y2 - 0.045)}M${f2(x1)} ${f2(y1 - 0.018)}L${f2(x2)} ${f2(y2 - 0.018)}" stroke="#a87445" stroke-width=".016" stroke-linecap="round"/>` +
    posts
  );
}

/** A haystack. */
const haystack = (x: number, y: number, s: number) =>
  shadow(x + 0.02 * s, y + 0.04 * s, 0.12 * s, 0.035 * s, 0.2) +
  `<path d="M${f2(x - 0.11 * s)} ${f2(y + 0.04 * s)}Q${f2(x - 0.1 * s)} ${f2(y - 0.12 * s)} ${f2(x)} ${f2(y - 0.13 * s)}Q${f2(x + 0.1 * s)} ${f2(y - 0.12 * s)} ${f2(x + 0.11 * s)} ${f2(y + 0.04 * s)}Z" fill="#f9cf4a" stroke="#d99a1c" stroke-width=".012"/>` +
  `<path d="M${f2(x - 0.07 * s)} ${f2(y - 0.06 * s)}q.04 .02 .08 0M${f2(x - 0.09 * s)} ${f2(y - 0.01 * s)}q.06 .025 .12 0" fill="none" stroke="#d99a1c" stroke-width=".01" stroke-linecap="round"/>`;

/** A little windmill. */
const windmill = (x: number, y: number, s: number) =>
  shadow(x + 0.02 * s, y + 0.06 * s, 0.09 * s, 0.03 * s, 0.22) +
  `<path d="M${f2(x - 0.055 * s)} ${f2(y + 0.06 * s)}L${f2(x - 0.035 * s)} ${f2(y - 0.09 * s)}H${f2(x + 0.035 * s)}L${f2(x + 0.055 * s)} ${f2(y + 0.06 * s)}Z" fill="#fff6e8" stroke="#c9a77d" stroke-width=".01"/>` +
  `<path d="M${f2(x - 0.05 * s)} ${f2(y - 0.085 * s)}L${f2(x)} ${f2(y - 0.14 * s)}L${f2(x + 0.05 * s)} ${f2(y - 0.085 * s)}Z" fill="#e2553f"/>` +
  `<rect x="${f2(x - 0.015 * s)}" y="${f2(y + 0.02 * s)}" width="${f2(0.03 * s)}" height="${f2(0.04 * s)}" rx=".008" fill="#8a5a33"/>` +
  `<g transform="translate(${f2(x)} ${f2(y - 0.07 * s)})"><g class="blades">${[0, 90, 180, 270]
    .map(
      (a) =>
        `<rect x="${f2(-0.012 * s)}" y="${f2(-0.12 * s)}" width="${f2(0.024 * s)}" height="${f2(0.11 * s)}" rx=".006" fill="#fffaf0" stroke="#b08a5c" stroke-width=".008" transform="rotate(${a})"/>`,
    )
    .join('')}<circle r="${f2(0.012 * s)}" fill="#8a5a33"/></g></g>`;

/** Bricks stacked in a little pile. */
function bricks(x: number, y: number, s: number): string {
  const b = (bx: number, by: number) =>
    `<rect x="${f2(x + bx * s)}" y="${f2(y + by * s)}" width="${f2(0.07 * s)}" height="${f2(0.035 * s)}" rx=".006" fill="#c4492c" stroke="#7e2a17" stroke-width=".008"/><rect x="${f2(x + bx * s + 0.008)}" y="${f2(y + by * s + 0.005)}" width="${f2(0.05 * s)}" height=".008" rx=".004" fill="#e7805e" opacity=".8"/>`;
  return (
    shadow(x + 0.04 * s, y + 0.075 * s, 0.13 * s, 0.035 * s, 0.25) +
    b(-0.07, 0.035) +
    b(0, 0.035) +
    b(0.07, 0.035) +
    b(-0.035, 0) +
    b(0.035, 0) +
    b(0, -0.035)
  );
}

/** A clay kiln with smoke. */
const kiln = (x: number, y: number, s: number) =>
  shadow(x + 0.02 * s, y + 0.07 * s, 0.12 * s, 0.035 * s, 0.25) +
  `<path d="M${f2(x - 0.1 * s)} ${f2(y + 0.07 * s)}Q${f2(x - 0.1 * s)} ${f2(y - 0.09 * s)} ${f2(x)} ${f2(y - 0.1 * s)}Q${f2(x + 0.1 * s)} ${f2(y - 0.09 * s)} ${f2(x + 0.1 * s)} ${f2(y + 0.07 * s)}Z" fill="#b8573a" stroke="#7e2f1c" stroke-width=".012"/>` +
  `<path d="M${f2(x - 0.035 * s)} ${f2(y + 0.07 * s)}V${f2(y + 0.015 * s)}Q${f2(x)} ${f2(y - 0.03 * s)} ${f2(x + 0.035 * s)} ${f2(y + 0.015 * s)}V${f2(y + 0.07 * s)}Z" fill="#3a1d14"/>` +
  `<path d="M${f2(x - 0.02 * s)} ${f2(y + 0.06 * s)}q.02 -.03 .04 0" fill="#ff9a3c"/>` +
  `<g class="smoke"><circle cx="${f2(x + 0.02 * s)}" cy="${f2(y - 0.15 * s)}" r="${f2(0.025 * s)}" fill="#fff" opacity=".7"/><circle cx="${f2(x + 0.05 * s)}" cy="${f2(y - 0.2 * s)}" r="${f2(0.035 * s)}" fill="#fff" opacity=".5"/></g>`;

/** A rocky peak with snow. */
function peak(x: number, y: number, w: number, h: number, snow = true): string {
  const top = y - h;
  const l = x - w / 2;
  const r = x + w / 2;
  const ridge = x + w * 0.06;
  return (
    shadow(x + 0.03, y + 0.02, w * 0.55, w * 0.12, 0.25) +
    `<path d="M${f2(l)} ${f2(y)}L${f2(x - w * 0.05)} ${f2(top + 0.015)}Q${f2(x)} ${f2(top - 0.01)} ${f2(x + w * 0.05)} ${f2(top + 0.015)}L${f2(r)} ${f2(y)}Z" fill="#8e9bb0"/>` +
    `<path d="M${f2(l)} ${f2(y)}L${f2(x - w * 0.05)} ${f2(top + 0.015)}Q${f2(x - 0.005)} ${f2(top)} ${f2(ridge)} ${f2(top + 0.03)}L${f2(x - w * 0.02)} ${f2(y)}Z" fill="#c3cddb"/>` +
    (snow
      ? `<path d="M${f2(x - w * 0.16)} ${f2(top + h * 0.3)}L${f2(x - w * 0.05)} ${f2(top + 0.015)}Q${f2(x)} ${f2(top - 0.01)} ${f2(x + w * 0.05)} ${f2(top + 0.015)}L${f2(x + w * 0.17)} ${f2(top + h * 0.32)}L${f2(x + w * 0.09)} ${f2(top + h * 0.25)}L${f2(x + w * 0.03)} ${f2(top + h * 0.34)}L${f2(x - w * 0.05)} ${f2(top + h * 0.24)}Z" fill="#ffffff"/>`
      : '')
  );
}

/** A blue-violet ore crystal cluster. */
const crystals = (x: number, y: number, s: number) =>
  shadow(x + 0.01 * s, y + 0.03 * s, 0.08 * s, 0.025 * s, 0.25) +
  [
    [-0.04, 0.6, -14],
    [0, 1, 0],
    [0.04, 0.7, 16],
  ]
    .map(
      ([dx, k, rot]) =>
        `<g transform="translate(${f2(x + dx! * s)} ${f2(y)}) rotate(${rot})"><path d="M${f2(-0.025 * s)} 0V${f2(-0.08 * s * k!)}L0 ${f2(-0.11 * s * k!)}L${f2(0.025 * s)} ${f2(-0.08 * s * k!)}V0Z" fill="#7a83e8" stroke="#3d43a3" stroke-width=".008"/><path d="M${f2(-0.025 * s)} ${f2(-0.08 * s * k!)}L0 ${f2(-0.11 * s * k!)}V0H${f2(-0.025 * s)}Z" fill="#a9b2ff"/></g>`,
    )
    .join('');

/** A cactus. */
const cactus = (x: number, y: number, s: number) =>
  shadow(x + 0.02 * s, y + 0.02 * s, 0.07 * s, 0.025 * s, 0.25) +
  `<path d="M${f2(x)} ${f2(y)}V${f2(y - 0.16 * s)}" stroke="#3f9a4a" stroke-width="${f2(0.045 * s)}" stroke-linecap="round"/>` +
  `<path d="M${f2(x - 0.05 * s)} ${f2(y - 0.1 * s)}V${f2(y - 0.06 * s)}Q${f2(x - 0.05 * s)} ${f2(y - 0.04 * s)} ${f2(x)} ${f2(y - 0.045 * s)}M${f2(x + 0.05 * s)} ${f2(y - 0.13 * s)}V${f2(y - 0.09 * s)}Q${f2(x + 0.05 * s)} ${f2(y - 0.07 * s)} ${f2(x)} ${f2(y - 0.075 * s)}" fill="none" stroke="#3f9a4a" stroke-width="${f2(0.03 * s)}" stroke-linecap="round"/>` +
  `<path d="M${f2(x - 0.008 * s)} ${f2(y - 0.15 * s)}V${f2(y - 0.02 * s)}" stroke="#6cc66a" stroke-width="${f2(0.012 * s)}" stroke-linecap="round"/>` +
  `<circle cx="${f2(x)}" cy="${f2(y - 0.185 * s)}" r="${f2(0.014 * s)}" fill="#ff7aa8"/>`;

const rock = (x: number, y: number, s: number, c = '#b9a27a') =>
  `<path d="M${f2(x - 0.04 * s)} ${f2(y)}Q${f2(x - 0.04 * s)} ${f2(y - 0.04 * s)} ${f2(x)} ${f2(y - 0.045 * s)}Q${f2(x + 0.045 * s)} ${f2(y - 0.035 * s)} ${f2(x + 0.04 * s)} ${f2(y)}Z" fill="${c}" stroke="#00000033" stroke-width=".008"/>`;

/** A gold nugget with a glint. */
const nugget = (x: number, y: number, s: number) =>
  `<path d="M${f2(x - 0.05 * s)} ${f2(y)}L${f2(x - 0.035 * s)} ${f2(y - 0.035 * s)}L${f2(x + 0.005 * s)} ${f2(y - 0.05 * s)}L${f2(x + 0.045 * s)} ${f2(y - 0.03 * s)}L${f2(x + 0.05 * s)} ${f2(y + 0.005 * s)}L${f2(x + 0.01 * s)} ${f2(y + 0.02 * s)}Z" fill="#ffd23f" stroke="#a5700c" stroke-width=".01" stroke-linejoin="round"/>` +
  `<path d="M${f2(x - 0.035 * s)} ${f2(y - 0.03 * s)}L${f2(x + 0.005 * s)} ${f2(y - 0.045 * s)}L${f2(x + 0.002 * s)} ${f2(y - 0.012 * s)}Z" fill="#fff3a6"/>`;

const sparkle = (x: number, y: number, s: number, cls = 'twinkle') =>
  `<path class="${cls}" d="M${f2(x)} ${f2(y - 0.05 * s)}Q${f2(x + 0.006 * s)} ${f2(y - 0.006 * s)} ${f2(x + 0.05 * s)} ${f2(y)}Q${f2(x + 0.006 * s)} ${f2(y + 0.006 * s)} ${f2(x)} ${f2(y + 0.05 * s)}Q${f2(x - 0.006 * s)} ${f2(y + 0.006 * s)} ${f2(x - 0.05 * s)} ${f2(y)}Q${f2(x - 0.006 * s)} ${f2(y - 0.006 * s)} ${f2(x)} ${f2(y - 0.05 * s)}Z" fill="#fffbe0"/>`;

/** A puffy cloud. */
const cloud = (x: number, y: number, s: number) =>
  `<g opacity=".95">${[
    [-0.08, 0.01, 0.06],
    [-0.02, -0.03, 0.08],
    [0.06, -0.01, 0.065],
    [0.1, 0.02, 0.045],
    [0, 0.03, 0.06],
  ]
    .map(
      ([dx, dy, r]) =>
        `<circle cx="${f2(x + dx! * s)}" cy="${f2(y + dy! * s)}" r="${f2(r! * s)}" fill="#ffffff"/>`,
    )
    .join('')}</g>`;

/* ---------- The scenes ---------- */

/** Spots round the middle, clear of the number token, at angle (degrees) and radius. */
const at = (deg: number, r: number): [number, number] => [
  Math.cos((deg * Math.PI) / 180) * r,
  Math.sin((deg * Math.PI) / 180) * r,
];

function forestArt(v: number): string {
  const R = rand(101 + v * 7);
  const spots: [number, number, number][] = [];
  const ring = [-150, -110, -70, -30, 10, 50, 90, 130, 170];
  ring.forEach((d, i) => {
    const rr = 0.55 + (i % 2) * 0.13 + R() * 0.04;
    const [x, y] = at(d + (R() - 0.5) * 12 + v * 9, rr);
    spots.push([x, y, 1.15 + R() * 0.35]);
  });
  spots.sort((a, b) => a[1] - b[1]);
  return spots
    .map(([x, y, s], i) => ((i + v) % 4 === 1 ? pine(x, y, s * 1.2) : tree(x, y, s * 1.4, i + v)))
    .join('');
}

function pastureArt(v: number): string {
  const R = rand(211 + v * 13);
  let out = '';
  for (let i = 0; i < 14; i++) {
    const [x, y] = at(R() * 360, 0.42 + R() * 0.38);
    out += tuft(x, y, '#5fa83a');
  }
  for (let i = 0; i < 8; i++) {
    const [x, y] = at(R() * 360, 0.45 + R() * 0.35);
    out += flower(x, y, i % 2 ? '#ffffff' : '#ff9ec4');
  }
  out += v % 2 ? fence(-0.62, 0.32, -0.3, 0.6) : fence(0.3, -0.62, 0.66, -0.36);
  const flock: [number, number, boolean][] =
    v % 2
      ? [
          [-0.4, -0.42, false],
          [0.52, -0.1, true],
          [0.16, 0.58, true],
        ]
      : [
          [-0.55, 0.12, false],
          [0.44, 0.4, true],
          [-0.12, -0.6, false],
        ];
  flock.sort((a, b) => a[1] - b[1]);
  for (const [x, y, f] of flock) out += sheep(x, y, 1.75, f);
  return out;
}

function fieldsArt(v: number): string {
  let out = '';
  // Rows of wheat sweeping across the field.
  for (let i = -6; i <= 6; i++) {
    const y = i * 0.13;
    out += `<path d="M-1 ${f2(y + 0.18)}Q0 ${f2(y - 0.1)} 1 ${f2(y + 0.18)}" fill="none" stroke="#e8a21f" stroke-width=".035" stroke-linecap="round" opacity=".55"/>`;
    out += `<path d="M-1 ${f2(y + 0.21)}Q0 ${f2(y - 0.07)} 1 ${f2(y + 0.21)}" fill="none" stroke="#fff1a8" stroke-width=".014" stroke-linecap="round" opacity=".7"/>`;
  }
  const R = rand(307 + v * 5);
  for (let i = 0; i < 16; i++) {
    const [x, y] = at(R() * 360, 0.42 + R() * 0.38);
    out += `<path d="M${f2(x)} ${f2(y)}l0 -.05" stroke="#c98612" stroke-width=".012" stroke-linecap="round"/><ellipse cx="${f2(x)}" cy="${f2(y - 0.06)}" rx=".012" ry=".022" fill="#f6c443" stroke="#c98612" stroke-width=".006"/>`;
  }
  out +=
    v % 2
      ? windmill(-0.5, -0.28, 2.1) + haystack(0.5, 0.44, 1.6)
      : haystack(-0.5, 0.42, 1.6) + windmill(0.5, -0.26, 2.1);
  return out;
}

function hillsArt(v: number): string {
  let out = '';
  // Terraces of red clay.
  for (let i = 0; i < 5; i++) {
    const y = -0.62 + i * 0.3;
    out += `<path d="M-1 ${f2(y)}Q-.3 ${f2(y - 0.1)} .2 ${f2(y + 0.02)}T1 ${f2(y - 0.04)}" fill="none" stroke="#ffc7a2" stroke-width=".03" stroke-linecap="round" opacity=".45"/>`;
    out += `<path d="M-1 ${f2(y + 0.04)}Q-.3 ${f2(y - 0.06)} .2 ${f2(y + 0.06)}T1 ${f2(y)}" fill="none" stroke="#a9442a" stroke-width=".02" stroke-linecap="round" opacity=".35"/>`;
  }
  const R = rand(401 + v * 3);
  for (let i = 0; i < 4; i++) {
    const [x, y] = at(R() * 360, 0.5 + R() * 0.25);
    out += `<ellipse cx="${f2(x)}" cy="${f2(y)}" rx=".06" ry=".028" fill="#7a2e1b" opacity=".45"/>`;
  }
  out +=
    v % 2
      ? kiln(0.48, -0.3, 2.1) + bricks(-0.52, 0.34, 1.8)
      : bricks(0.48, 0.36, 1.8) + kiln(-0.48, -0.28, 2.1);
  return out;
}

function mountainsArt(v: number): string {
  let out = '';
  out +=
    v % 2
      ? peak(0.05, -0.42, 0.5, 0.42, false) + peak(-0.45, -0.05, 0.72, 0.72) + peak(0.47, -0.12, 0.62, 0.62)
      : peak(-0.02, -0.44, 0.48, 0.4, false) + peak(0.45, -0.05, 0.72, 0.72) + peak(-0.47, -0.12, 0.6, 0.58);
  out += crystals(v % 2 ? 0.42 : -0.42, 0.56, 1.9) + crystals(v % 2 ? -0.48 : 0.5, 0.42, 1.4);
  out += rock(0.08, 0.66, 1.2, '#7d899b') + rock(-0.2, 0.6, 0.9, '#8995a7');
  return out;
}

function desertArt(v: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const y = -0.5 + i * 0.32;
    out += `<path d="M-1 ${f2(y)}Q-.4 ${f2(y - 0.12)} .1 ${f2(y)}T1 ${f2(y - 0.02)}" fill="none" stroke="#fff6d8" stroke-width=".035" stroke-linecap="round" opacity=".8"/>`;
    out += `<path d="M-1 ${f2(y + 0.05)}Q-.4 ${f2(y - 0.07)} .1 ${f2(y + 0.05)}T1 ${f2(y + 0.03)}" fill="none" stroke="#d2ad62" stroke-width=".018" stroke-linecap="round" opacity=".6"/>`;
  }
  out += cactus(v % 2 ? 0.5 : -0.52, -0.12, 2.2) + cactus(v % 2 ? -0.44 : 0.46, 0.56, 1.6);
  out += rock(0.1, -0.62, 1.3) + rock(-0.6, 0.2, 1) + rock(0.62, 0.15, 0.8);
  return out;
}

function goldArt(v: number): string {
  let out = '';
  const R = rand(509 + v * 11);
  // Rock strata.
  for (let i = 0; i < 4; i++) {
    const y = -0.55 + i * 0.36;
    out += `<path d="M-1 ${f2(y)}Q-.2 ${f2(y + 0.1)} .3 ${f2(y - 0.02)}T1 ${f2(y + 0.05)}" fill="none" stroke="#8a7155" stroke-width=".03" stroke-linecap="round" opacity=".5"/>`;
  }
  // A mine entrance.
  const [mx, my] = v % 2 ? [-0.42, -0.3] : [0.42, -0.3];
  out +=
    `<path d="M${f2(mx - 0.13)} ${f2(my + 0.1)}V${f2(my - 0.02)}Q${f2(mx)} ${f2(my - 0.17)} ${f2(mx + 0.13)} ${f2(my - 0.02)}V${f2(my + 0.1)}Z" fill="#1b130c"/>` +
    `<path d="M${f2(mx - 0.13)} ${f2(my + 0.1)}V${f2(my - 0.02)}Q${f2(mx)} ${f2(my - 0.17)} ${f2(mx + 0.13)} ${f2(my - 0.02)}V${f2(my + 0.1)}" fill="none" stroke="#a87445" stroke-width=".035"/>` +
    `<path d="M${f2(mx - 0.1)} ${f2(my + 0.1)}H${f2(mx + 0.1)}" stroke="#6b4a2a" stroke-width=".02"/>`;
  for (let i = 0; i < 9; i++) {
    const [x, y] = at(R() * 360, 0.45 + R() * 0.33);
    if (Math.hypot(x - mx, y - my) < 0.2) continue;
    out += nugget(x, y, 1.4 + R() * 0.8);
  }
  for (let i = 0; i < 5; i++) {
    const [x, y] = at(R() * 360, 0.42 + R() * 0.38);
    out += sparkle(x, y, 1.2 + R() * 0.7, i % 2 ? 'twinkle' : 'twinkle late');
  }
  return out;
}

function fogArt(v: number): string {
  return (
    cloud(-0.38, -0.3, 1.8 + v * 0.1) +
    cloud(0.4, 0.05, 1.6) +
    cloud(-0.2, 0.45, 1.5) +
    `<circle r=".27" fill="#ffffff" opacity=".85"/><text y=".1" text-anchor="middle" font-family="'Baloo 2', sans-serif" font-weight="800" font-size=".38" fill="#8a9bb0">?</text>`
  );
}

const ART: Record<string, (v: number) => string> = {
  wood: forestArt,
  sheep: pastureArt,
  wheat: fieldsArt,
  brick: hillsArt,
  ore: mountainsArt,
  desert: desertArt,
  gold: goldArt,
  fog: fogArt,
};

export const VARIANTS = 2;

/** The <defs> for every tile: gradients, a clip for the top face, and each scene as a symbol. */
export function tileDefs(): string {
  let out = '';
  for (const [t, g] of Object.entries(GROUND)) {
    out += `<linearGradient id="ig-${t}" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${g.top[0]}"/><stop offset="1" stop-color="${g.top[1]}"/></linearGradient>`;
  }
  out += `<radialGradient id="ig-shine" cx=".35" cy=".25" r=".8"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".55" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`;
  out += `<linearGradient id="ig-bevel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".75"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".1"/><stop offset="1" stop-color="#000000" stop-opacity=".18"/></linearGradient>`;
  out += `<clipPath id="ic-top" clipPathUnits="userSpaceOnUse"><path d="${rhex(0, 0, 0.93, 0.13)}"/></clipPath>`;
  for (const t of Object.keys(ART))
    for (let v = 0; v < VARIANTS; v++)
      out += `<symbol id="ia-${t}-${v}" viewBox="-1 -1 2 2" overflow="visible"><g clip-path="url(#ic-top)">${ART[t]!(v)}</g></symbol>`;
  return out;
}

/** One land tile at (cx, cy), radius R: its side, top, scene and shine. */
export function tileSVG(t: Terrain, cx: number, cy: number, R: number, variant: number, i: number): string {
  const g = GROUND[t] ?? GROUND.desert!;
  const depth = 0.14 * R;
  return (
    `<g class="itile" data-h="${i}" data-t="${t}" style="--cx:${f2(cx)}px;--cy:${f2(cy)}px">` +
    `<path d="${rhex(cx, cy + depth, 0.93 * R, 0.13 * R)}" fill="${g.side}"/>` +
    `<path d="${rhex(cx, cy + depth * 0.55, 0.93 * R, 0.13 * R)}" fill="${g.side}" stroke="${g.edge}" stroke-width="${f2(0.012 * R)}"/>` +
    `<path d="${rhex(cx, cy, 0.93 * R, 0.13 * R)}" fill="url(#ig-${t})"/>` +
    `<use href="#ia-${t}-${variant % VARIANTS}" x="${f2(cx - R)}" y="${f2(cy - R)}" width="${f2(2 * R)}" height="${f2(2 * R)}"/>` +
    `<path d="${rhex(cx, cy, 0.93 * R, 0.13 * R)}" fill="url(#ig-shine)"/>` +
    `<path d="${rhex(cx, cy, 0.9 * R, 0.11 * R)}" fill="none" stroke="url(#ig-bevel)" stroke-width="${f2(0.035 * R)}"/>` +
    `</g>`
  );
}
