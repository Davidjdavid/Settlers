/*
 * Isle pieces and icons (docs/isle.md 3): chunky toy pieces with a dark outline, so they read on
 * every tile, and one icon for each card, drawn the same way everywhere (board, cards, seats).
 */

import type { Color } from '@settlers/engine';
import { f2 } from './tiles';

/** Player colours, brighter for the toy look, each with a dark and a light shade. */
export const ICOL: Record<Color, { fill: string; dark: string; light: string; ink: string }> = {
  red: { fill: '#ec4a3c', dark: '#a8261c', light: '#ff8a7c', ink: '#ffffff' },
  blue: { fill: '#3b7ff2', dark: '#1d4fb0', light: '#86b4ff', ink: '#ffffff' },
  white: { fill: '#f6f4ee', dark: '#b9b3a3', light: '#ffffff', ink: '#2a2f45' },
  orange: { fill: '#ff8d1f', dark: '#c25a00', light: '#ffc07a', ink: '#ffffff' },
  purple: { fill: '#9b5de5', dark: '#6531a8', light: '#c9a6ff', ink: '#ffffff' },
  black: { fill: '#3a3d4a', dark: '#16171e', light: '#6b6f80', ink: '#ffffff' },
  pink: { fill: '#ff8fcf', dark: '#d1499a', light: '#ffc3e6', ink: '#2a2f45' },
  yellow: { fill: '#ffd93b', dark: '#c9a200', light: '#fff08f', ink: '#2a2f45' },
  gray: { fill: '#a3a8a0', dark: '#6d7269', light: '#cfd3cc', ink: '#2a2f45' },
  teal: { fill: '#1fb5a5', dark: '#0e7c71', light: '#6fe0d4', ink: '#ffffff' },
  cyan: { fill: '#4fdcff', dark: '#1597bd', light: '#a6eeff', ink: '#2a2f45' },
  brown: { fill: '#9a6236', dark: '#61391b', light: '#cf9a6c', ink: '#ffffff' },
  magenta: { fill: '#e2349a', dark: '#9c1463', light: '#ff8bc9', ink: '#ffffff' },
  lavender: { fill: '#c7b6ff', dark: '#8a74d6', light: '#e8e0ff', ink: '#2a2f45' },
  mint: { fill: '#8ff2c6', dark: '#3fb487', light: '#cffae6', ink: '#2a2f45' },
};

export const OUTLINE = '#262a40';

/* ---------- Pieces (board units: R is a hex's radius in px) ---------- */

/** A road plank between two points. */
export function roadSVG(x1: number, y1: number, x2: number, y2: number, c: Color, R: number): string {
  const k = ICOL[c];
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const w = 0.15 * R;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const d = 0.045 * R;
  return (
    `<g transform="translate(${f2(cx)} ${f2(cy)}) rotate(${f2(ang)})">` +
    `<rect x="${f2(-len / 2)}" y="${f2(-w / 2 + d)}" width="${f2(len)}" height="${f2(w)}" rx="${f2(w / 2)}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${f2(0.03 * R)}"/>` +
    `<rect x="${f2(-len / 2)}" y="${f2(-w / 2)}" width="${f2(len)}" height="${f2(w)}" rx="${f2(w / 2)}" fill="${k.fill}" stroke="${OUTLINE}" stroke-width="${f2(0.03 * R)}"/>` +
    `<rect x="${f2(-len / 2 + w * 0.5)}" y="${f2(-w * 0.28)}" width="${f2(len - w)}" height="${f2(w * 0.22)}" rx="${f2(w * 0.11)}" fill="${k.light}" opacity=".8"/>` +
    `</g>`
  );
}

/** A little house. */
export function settlementSVG(x: number, y: number, c: Color, R: number): string {
  const k = ICOL[c];
  const s = R / 100;
  const o = f2(3 * s);
  const P = (pts: number[][]) => pts.map(([a, b]) => `${f2(x + a! * s)} ${f2(y + b! * s)}`).join(' ');
  return (
    `<ellipse cx="${f2(x + 2 * s)}" cy="${f2(y + 15 * s)}" rx="${f2(19 * s)}" ry="${f2(6 * s)}" fill="#000" opacity=".25"/>` +
    // Side wall (darker), then the front with its gable.
    `<polygon points="${P([
      [4, -4],
      [16, -10],
      [16, 10],
      [4, 15],
    ])}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-14, -4],
      [-5, -14],
      [4, -4],
      [4, 15],
      [-14, 15],
    ])}" fill="${k.fill}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    // Roof: front slope and the long side.
    `<polygon points="${P([
      [-5, -14],
      [8, -21],
      [19, -10],
      [4, -4],
    ])}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-5, -14],
      [8, -21],
      [10, -19],
      [-3, -12],
    ])}" fill="${k.light}" opacity=".7"/>` +
    // Door.
    `<rect x="${f2(x - 8 * s)}" y="${f2(y + 3 * s)}" width="${f2(6 * s)}" height="${f2(12 * s)}" rx="${f2(3 * s)}" fill="${OUTLINE}" opacity=".85"/>`
  );
}

/** A town hall with a tower and a flag. */
export function citySVG(x: number, y: number, c: Color, R: number): string {
  const k = ICOL[c];
  const s = R / 100;
  const o = f2(3 * s);
  const P = (pts: number[][]) => pts.map(([a, b]) => `${f2(x + a! * s)} ${f2(y + b! * s)}`).join(' ');
  return (
    `<ellipse cx="${f2(x + 2 * s)}" cy="${f2(y + 19 * s)}" rx="${f2(27 * s)}" ry="${f2(7 * s)}" fill="#000" opacity=".25"/>` +
    // The hall.
    `<polygon points="${P([
      [6, -2],
      [22, -8],
      [22, 12],
      [6, 19],
    ])}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-6, -2],
      [6, -2],
      [6, 19],
      [-6, 19],
    ])}" fill="${k.fill}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-6, -2],
      [6, -10],
      [24, -8],
      [6, -2],
    ])}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    // The tower.
    `<polygon points="${P([
      [-22, -10],
      [-8, -10],
      [-8, 19],
      [-22, 19],
    ])}" fill="${k.fill}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-8, -10],
      [-2, -13],
      [-2, 17],
      [-8, 19],
    ])}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-24, -10],
      [-14, -27],
      [-1, -13],
      [-8, -10],
    ])}" fill="${k.dark}" stroke="${OUTLINE}" stroke-width="${o}" stroke-linejoin="round"/>` +
    `<polygon points="${P([
      [-24, -10],
      [-14, -27],
      [-12, -24],
      [-20, -10],
    ])}" fill="${k.light}" opacity=".7"/>` +
    // Flag.
    `<path d="M${f2(x - 14 * s)} ${f2(y - 27 * s)}V${f2(y - 38 * s)}" stroke="${OUTLINE}" stroke-width="${f2(2.4 * s)}" stroke-linecap="round"/>` +
    `<path d="M${f2(x - 14 * s)} ${f2(y - 38 * s)}l${f2(10 * s)} ${f2(3 * s)}l${f2(-10 * s)} ${f2(3 * s)}Z" fill="#ffd54a" stroke="${OUTLINE}" stroke-width="${f2(1.5 * s)}" stroke-linejoin="round"/>` +
    // Windows and the door.
    `<rect x="${f2(x - 18 * s)}" y="${f2(y - 4 * s)}" width="${f2(6 * s)}" height="${f2(7 * s)}" rx="${f2(2 * s)}" fill="#fff4c2" stroke="${OUTLINE}" stroke-width="${f2(1.6 * s)}"/>` +
    `<rect x="${f2(x - 3 * s)}" y="${f2(y + 7 * s)}" width="${f2(6 * s)}" height="${f2(12 * s)}" rx="${f2(3 * s)}" fill="${OUTLINE}" opacity=".85"/>`
  );
}

/** A toy sailboat along an edge. */
export function shipSVG(x: number, y: number, ang: number, c: Color, R: number): string {
  const k = ICOL[c];
  const s = R / 100;
  return (
    `<g transform="translate(${f2(x)} ${f2(y)})">` +
    `<ellipse cx="0" cy="${f2(12 * s)}" rx="${f2(26 * s)}" ry="${f2(6 * s)}" fill="#0a3f6b" opacity=".3"/>` +
    `<path d="M${f2(-26 * s)} ${f2(0)}H${f2(26 * s)}L${f2(17 * s)} ${f2(12 * s)}H${f2(-17 * s)}Z" fill="${k.fill}" stroke="${OUTLINE}" stroke-width="${f2(3 * s)}" stroke-linejoin="round"/>` +
    `<path d="M${f2(-22 * s)} ${f2(5 * s)}H${f2(22 * s)}" stroke="${k.dark}" stroke-width="${f2(3 * s)}"/>` +
    `<path d="M${f2(-1 * s)} 0V${f2(-34 * s)}" stroke="${OUTLINE}" stroke-width="${f2(2.6 * s)}" stroke-linecap="round"/>` +
    `<path d="M${f2(2 * s)} ${f2(-32 * s)}Q${f2(22 * s)} ${f2(-18 * s)} ${f2(18 * s)} ${f2(-3 * s)}H${f2(2 * s)}Z" fill="#ffffff" stroke="${OUTLINE}" stroke-width="${f2(2.4 * s)}" stroke-linejoin="round"/>` +
    `<path d="M${f2(-4 * s)} ${f2(-28 * s)}Q${f2(-18 * s)} ${f2(-16 * s)} ${f2(-15 * s)} ${f2(-3 * s)}H${f2(-4 * s)}Z" fill="${k.light}" stroke="${OUTLINE}" stroke-width="${f2(2.4 * s)}" stroke-linejoin="round"/>` +
    `</g>` +
    (ang ? '' : '')
  );
}

/** A knight: a round helmet in the owner's colour with 1-3 stars; asleep (Zz) until activated. */
export function knightSVG(x: number, y: number, c: Color, lvl: number, on: boolean, R: number): string {
  const k = ICOL[c];
  const s = (R / 100) * (lvl >= 3 ? 1.18 : lvl === 2 ? 1.08 : 1);
  const star = (sx: number) =>
    `<path transform="translate(${f2(x + sx * s)} ${f2(y + 15 * s)}) scale(${f2(s * 0.55)})" d="M0-9 2.6-3 9-2.8 4-1.2 5.6 6.5 0 2.4-5.6 6.5-4-1.2-9-2.8-2.6-3Z" fill="#ffd54a" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
  const n = Math.max(1, Math.min(3, lvl));
  const stars = Array.from({ length: n }, (_, i) => star((i - (n - 1) / 2) * 11)).join('');
  return (
    `<g class="iknight${on ? ' on' : ''}">` +
    (on
      ? `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(24 * s)}" fill="#ffe27a" opacity=".55" class="kglow"/>`
      : '') +
    `<ellipse cx="${f2(x + 2 * s)}" cy="${f2(y + 15 * s)}" rx="${f2(17 * s)}" ry="${f2(5 * s)}" fill="#000" opacity=".25"/>` +
    // Helmet: dome, brim and visor slit.
    `<path d="M${f2(x - 16 * s)} ${f2(y + 8 * s)}V${f2(y - 2 * s)}Q${f2(x - 16 * s)} ${f2(y - 19 * s)} ${f2(x)} ${f2(y - 19 * s)}Q${f2(x + 16 * s)} ${f2(y - 19 * s)} ${f2(x + 16 * s)} ${f2(y - 2 * s)}V${f2(y + 8 * s)}Z" fill="${on ? k.fill : '#c9ccd6'}" stroke="${OUTLINE}" stroke-width="${f2(3 * s)}" stroke-linejoin="round"/>` +
    `<path d="M${f2(x - 10 * s)} ${f2(y - 1 * s)}H${f2(x + 10 * s)}" stroke="${OUTLINE}" stroke-width="${f2(3.4 * s)}" stroke-linecap="round"/>` +
    `<path d="M${f2(x)} ${f2(y - 19 * s)}V${f2(y + 8 * s)}" stroke="${on ? k.dark : '#9a9eab'}" stroke-width="${f2(2.4 * s)}" opacity=".6"/>` +
    `<path d="M${f2(x - 9 * s)} ${f2(y - 13 * s)}Q${f2(x - 4 * s)} ${f2(y - 17 * s)} ${f2(x + 2 * s)} ${f2(y - 16 * s)}" fill="none" stroke="#fff" stroke-width="${f2(2.6 * s)}" stroke-linecap="round" opacity=".7"/>` +
    // Plume in the owner's colour, so a sleeping knight still shows whose it is.
    `<path d="M${f2(x)} ${f2(y - 19 * s)}Q${f2(x + 6 * s)} ${f2(y - 31 * s)} ${f2(x + 16 * s)} ${f2(y - 27 * s)}Q${f2(x + 8 * s)} ${f2(y - 24 * s)} ${f2(x + 4 * s)} ${f2(y - 18 * s)}Z" fill="${k.fill}" stroke="${OUTLINE}" stroke-width="${f2(2 * s)}" stroke-linejoin="round"/>` +
    stars +
    (on
      ? ''
      : `<text x="${f2(x + 17 * s)}" y="${f2(y - 14 * s)}" font-family="'Baloo 2', sans-serif" font-weight="800" font-size="${f2(13 * s)}" fill="#ffffff" stroke="${OUTLINE}" stroke-width="${f2(3 * s)}" paint-order="stroke" class="zz">z</text>`) +
    `</g>`
  );
}

/** A city wall: a ring of stones under the city. */
export function wallSVG(x: number, y: number, R: number): string {
  const s = R / 100;
  return `<path d="M${f2(x - 30 * s)} ${f2(y + 18 * s)}Q${f2(x)} ${f2(y + 34 * s)} ${f2(x + 30 * s)} ${f2(y + 18 * s)}" fill="none" stroke="${OUTLINE}" stroke-width="${f2(13 * s)}" stroke-linecap="round"/><path d="M${f2(x - 30 * s)} ${f2(y + 18 * s)}Q${f2(x)} ${f2(y + 34 * s)} ${f2(x + 30 * s)} ${f2(y + 18 * s)}" fill="none" stroke="#c4c0b4" stroke-width="${f2(8 * s)}" stroke-linecap="round" stroke-dasharray="${f2(7 * s)} ${f2(2 * s)}"/>`;
}

/** The robber: a grumpy hooded blob. */
export function robberSVG(x: number, y: number, R: number): string {
  const s = R / 100;
  return (
    `<g class="irobber">` +
    `<ellipse cx="${f2(x + 2 * s)}" cy="${f2(y + 26 * s)}" rx="${f2(22 * s)}" ry="${f2(7 * s)}" fill="#000" opacity=".3"/>` +
    `<path d="M${f2(x - 20 * s)} ${f2(y + 26 * s)}Q${f2(x - 24 * s)} ${f2(y - 8 * s)} ${f2(x - 12 * s)} ${f2(y - 24 * s)}Q${f2(x)} ${f2(y - 40 * s)} ${f2(x + 12 * s)} ${f2(y - 24 * s)}Q${f2(x + 24 * s)} ${f2(y - 8 * s)} ${f2(x + 20 * s)} ${f2(y + 26 * s)}Q${f2(x)} ${f2(y + 31 * s)} ${f2(x - 20 * s)} ${f2(y + 26 * s)}Z" fill="#3d3456" stroke="${OUTLINE}" stroke-width="${f2(3 * s)}"/>` +
    `<path d="M${f2(x - 12 * s)} ${f2(y - 22 * s)}Q${f2(x)} ${f2(y - 35 * s)} ${f2(x + 8 * s)} ${f2(y - 28 * s)}" fill="none" stroke="#6a5d8f" stroke-width="${f2(3 * s)}" stroke-linecap="round"/>` +
    `<ellipse cx="${f2(x)}" cy="${f2(y - 8 * s)}" rx="${f2(13 * s)}" ry="${f2(10 * s)}" fill="#1c1729"/>` +
    `<ellipse cx="${f2(x - 5 * s)}" cy="${f2(y - 7 * s)}" rx="${f2(3.2 * s)}" ry="${f2(4 * s)}" fill="#fff6b0"/>` +
    `<ellipse cx="${f2(x + 5 * s)}" cy="${f2(y - 7 * s)}" rx="${f2(3.2 * s)}" ry="${f2(4 * s)}" fill="#fff6b0"/>` +
    `<path d="M${f2(x - 9 * s)} ${f2(y - 14 * s)}L${f2(x - 2 * s)} ${f2(y - 11 * s)}M${f2(x + 9 * s)} ${f2(y - 14 * s)}L${f2(x + 2 * s)} ${f2(y - 11 * s)}" stroke="#fff6b0" stroke-width="${f2(2 * s)}" stroke-linecap="round"/>` +
    `</g>`
  );
}

/** The pirate ship. */
export function pirateSVG(x: number, y: number, R: number): string {
  const s = R / 100;
  return (
    `<g class="ipirate"><ellipse cx="${f2(x)}" cy="${f2(y + 14 * s)}" rx="${f2(32 * s)}" ry="${f2(7 * s)}" fill="#062b4a" opacity=".35"/>` +
    `<path d="M${f2(x - 32 * s)} ${f2(y)}H${f2(x + 32 * s)}L${f2(x + 20 * s)} ${f2(y + 15 * s)}H${f2(x - 20 * s)}Z" fill="#2c2738" stroke="${OUTLINE}" stroke-width="${f2(3 * s)}" stroke-linejoin="round"/>` +
    `<path d="M${f2(x)} ${f2(y)}V${f2(y - 40 * s)}" stroke="${OUTLINE}" stroke-width="${f2(3 * s)}"/>` +
    `<path d="M${f2(x + 2 * s)} ${f2(y - 37 * s)}H${f2(x + 24 * s)}V${f2(y - 8 * s)}H${f2(x + 2 * s)}Z" fill="#1d1a26" stroke="${OUTLINE}" stroke-width="${f2(2.4 * s)}"/>` +
    `<circle cx="${f2(x + 13 * s)}" cy="${f2(y - 25 * s)}" r="${f2(5 * s)}" fill="#fff"/><path d="M${f2(x + 8 * s)} ${f2(y - 15 * s)}L${f2(x + 18 * s)} ${f2(y - 19 * s)}M${f2(x + 8 * s)} ${f2(y - 19 * s)}L${f2(x + 18 * s)} ${f2(y - 15 * s)}" stroke="#fff" stroke-width="${f2(2 * s)}" stroke-linecap="round"/>` +
    `</g>`
  );
}

/* ---------- Card icons (in a box of -1..1) ---------- */

export const ICON: Record<string, string> = {
  wood: '<ellipse cx="0" cy=".62" rx=".7" ry=".14" fill="#000" opacity=".18"/><rect x="-.72" y="-.05" width="1.3" height=".5" rx=".25" fill="#9a5d33" stroke="#4e2a12" stroke-width=".07"/><ellipse cx=".58" cy=".2" rx=".17" ry=".25" fill="#e7b57d" stroke="#4e2a12" stroke-width=".07"/><ellipse cx=".58" cy=".2" rx=".07" ry=".1" fill="none" stroke="#b07a46" stroke-width=".05"/><rect x="-.55" y="-.45" width="1.15" height=".45" rx=".22" fill="#b06c3c" stroke="#4e2a12" stroke-width=".07"/><ellipse cx=".46" cy="-.23" rx=".15" ry=".22" fill="#f0c48e" stroke="#4e2a12" stroke-width=".07"/><path d="M-.6 .28h.6M-.4 -.22h.5" stroke="#6d3c1b" stroke-width=".05" stroke-linecap="round" opacity=".6"/><circle cx="-.25" cy="-.7" r=".22" fill="#5cc25f" stroke="#1f6a31" stroke-width=".06"/><path d="M-.25 -.48v.06" stroke="#4e2a12" stroke-width=".07"/>',
  brick:
    '<ellipse cx="0" cy=".66" rx=".75" ry=".13" fill="#000" opacity=".18"/>' +
    [
      [-0.72, 0.22],
      [-0.02, 0.22],
      [-0.37, -0.18],
      [0.33, -0.18],
      [-0.02, -0.58],
    ]
      .map(
        ([x, y]) =>
          `<rect x="${x}" y="${y}" width=".66" height=".38" rx=".07" fill="#d4512f" stroke="#6e2412" stroke-width=".07"/><rect x="${x! + 0.08}" y="${y! + 0.06}" width=".45" height=".08" rx=".04" fill="#f08a64" opacity=".8"/>`,
      )
      .join(''),
  sheep:
    '<ellipse cx="0" cy=".7" rx=".65" ry=".12" fill="#000" opacity=".18"/><path d="M-.35 .35v.32M-.12 .4v.3M.18 .4v.3M.38 .35v.3" stroke="#3a3348" stroke-width=".1" stroke-linecap="round"/>' +
    [
      [-0.38, 0],
      [-0.1, -0.2],
      [0.22, -0.15],
      [0.38, 0.12],
      [0.05, 0.22],
      [-0.25, 0.25],
      [0, 0],
    ]
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r=".27" fill="#f7f4ec" stroke="#cfc7b6" stroke-width=".04"/>`,
      )
      .join('') +
    '<ellipse cx="-.55" cy="-.12" rx=".24" ry=".2" fill="#3a3348"/><ellipse cx="-.62" cy="-.32" rx=".13" ry=".06" fill="#3a3348" transform="rotate(30 -.62 -.32)"/><circle cx="-.6" cy="-.14" r=".045" fill="#fff"/>',
  wheat:
    '<ellipse cx="0" cy=".74" rx=".5" ry=".1" fill="#000" opacity=".18"/>' +
    [-0.3, 0, 0.3]
      .map(
        (dx, i) =>
          `<g transform="rotate(${(i - 1) * 18} 0 .7)"><path d="M${dx} .72V-.2" stroke="#c98612" stroke-width=".07" stroke-linecap="round"/>${[
            -0.65, -0.45, -0.25, -0.05,
          ]
            .map(
              (y) =>
                `<ellipse cx="${dx - 0.08}" cy="${y}" rx=".08" ry=".14" fill="#f6c443" stroke="#b07208" stroke-width=".04" transform="rotate(-25 ${dx - 0.08} ${y})"/><ellipse cx="${dx + 0.08}" cy="${y}" rx=".08" ry=".14" fill="#ffd968" stroke="#b07208" stroke-width=".04" transform="rotate(25 ${dx + 0.08} ${y})"/>`,
            )
            .join('')}</g>`,
      )
      .join('') +
    '<rect x="-.35" y=".2" width=".7" height=".14" rx=".07" fill="#e2553f" stroke="#8c2a1c" stroke-width=".04"/>',
  ore: '<ellipse cx="0" cy=".68" rx=".75" ry=".13" fill="#000" opacity=".18"/><path d="M-.8 .55L-.55 -.2L-.15 -.45L.35 -.35L.75 .1L.65 .55Z" fill="#8e9bb0" stroke="#3e4757" stroke-width=".07" stroke-linejoin="round"/><path d="M-.8 .55L-.55 -.2L-.15 -.45L-.05 .1L-.2 .55Z" fill="#c3cddb"/><path d="M.05 .45V-.05L.22 -.3L.39 -.05V.45Z" fill="#7a83e8" stroke="#3d43a3" stroke-width=".05"/><path d="M.05 -.05L.22 -.3V.45H.05Z" fill="#a9b2ff"/><path d="M.42 .45V.1L.55 -.08L.68 .1V.45Z" fill="#7a83e8" stroke="#3d43a3" stroke-width=".05"/>',
  paper:
    '<ellipse cx="0" cy=".72" rx=".6" ry=".1" fill="#000" opacity=".18"/><rect x="-.55" y="-.62" width="1.1" height="1.25" rx=".1" fill="#fff8e1" stroke="#7a6232" stroke-width=".07"/><path d="M-.35 -.3h.7M-.35 -.05h.7M-.35 .2h.45" stroke="#b39b62" stroke-width=".07" stroke-linecap="round"/><circle cx=".3" cy=".38" r=".14" fill="#3fa34d" stroke="#1f6a31" stroke-width=".05"/>',
  cloth:
    '<ellipse cx="0" cy=".7" rx=".7" ry=".12" fill="#000" opacity=".18"/><path d="M-.75 -.35Q-.4 -.55 0 -.35T.75 -.35V.45Q.4 .25 0 .45T-.75 .45Z" fill="#d07ad6" stroke="#5c2a63" stroke-width=".07" stroke-linejoin="round"/><path d="M-.75 .05Q-.4 -.15 0 .05T.75 .05" fill="none" stroke="#f3c4f6" stroke-width=".07"/><ellipse cx="-.75" cy=".05" rx=".12" ry=".4" fill="#a9479f" stroke="#5c2a63" stroke-width=".06"/>',
  coin: '<ellipse cx="0" cy=".72" rx=".55" ry=".1" fill="#000" opacity=".18"/><circle cx="0" cy=".05" r=".6" fill="#e4e9ee" stroke="#3f4954" stroke-width=".08"/><circle cx="0" cy=".05" r=".42" fill="none" stroke="#5d6873" stroke-width=".05"/><path d="M-.32 -.18a.45 .45 0 0 1 .28 -.2" fill="none" stroke="#fff" stroke-width=".09" stroke-linecap="round"/><path d="M0 -.15v.4M-.13 .05h.26" stroke="#3f4954" stroke-width=".08" stroke-linecap="round"/>',
};

/** An icon as a standalone SVG string (for HTML). */
export const iconSVG = (k: string, cls = 'ico') =>
  `<svg class="${cls}" viewBox="-1 -1 2 2" aria-hidden="true">${ICON[k] ?? ''}</svg>`;

/** The colour of each card. */
export const CARD_TINT: Record<string, { bg: string; deep: string }> = {
  wood: { bg: '#7fcf62', deep: '#3e8f3a' },
  brick: { bg: '#f59a6c', deep: '#c0502c' },
  sheep: { bg: '#cdf08a', deep: '#79b64a' },
  wheat: { bg: '#ffe17a', deep: '#e0a524' },
  ore: { bg: '#c7cfdc', deep: '#7c889b' },
  paper: { bg: '#f7edc9', deep: '#c4ab6a' },
  cloth: { bg: '#efc3f2', deep: '#a65aab' },
  coin: { bg: '#e7ecf1', deep: '#8b96a3' },
};
