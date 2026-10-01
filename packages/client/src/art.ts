/* Colors, glyphs and shapes, ported from the prototype. Board units: K pixels per hex radius. */

import type { Color, DevType, Resource, Terrain } from '@settlers/engine';

export const K = 60;
export const RES_LABEL: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};
export const TILE_COLOR: Record<Terrain, string> = {
  wood: '#2f7a4b',
  brick: '#c0623a',
  sheep: '#95c94e',
  wheat: '#e9b94a',
  ore: '#7e8a99',
  desert: '#d7c69c',
  gold: '#d9a521',
  sea: '#1f5f73',
  fog: '#5d6b73',
};
export const PCOL: Record<Color, string> = {
  red: '#e5484d',
  blue: '#3b82f6',
  white: '#f1ede4',
  purple: '#a970ff',
  orange: '#f28a2e',
};
export const PNAME: Record<Color, string> = {
  red: 'Red',
  blue: 'Blue',
  white: 'White',
  purple: 'Purple',
  orange: 'Orange',
};
export const DEV_LABEL: Record<DevType, string> = {
  knight: 'Knight',
  road: 'Road Building',
  plenty: 'Year of Plenty',
  mono: 'Monopoly',
  vp: 'Victory Point',
};
export const DEV_HELP: Record<DevType, string> = {
  knight: 'Move the robber and steal a card. 3+ knights can earn Largest Army.',
  road: 'Build 2 roads for free.',
  plenty: 'Take any 2 resources from the bank.',
  mono: 'Name a resource. Everyone else hands you all of theirs.',
  vp: 'Worth 1 point. Hidden from the others until someone wins.',
};

/* Glyphs in a 24-unit box centred on 0,0. */
export const GLYPH: Record<Terrain, string> = {
  wood: '<path d="M0-11 6.6-1.6H3.2L8.2 6H-8.2l5-7.6h-3.4z" fill="#123b22"/><path d="M0-11 6.6-1.6H3.2L8.2 6H0z" fill="#0b2b17" opacity=".5"/><rect x="-1.6" y="6" width="3.2" height="5" rx=".8" fill="#4d311b"/>',
  brick:
    '<g fill="#7e3418"><rect x="-10.5" y="1.5" width="10" height="6" rx="1"/><rect x=".5" y="1.5" width="10" height="6" rx="1"/><rect x="-5" y="-5.5" width="10" height="6" rx="1"/></g><g fill="#f0b08c" opacity=".5"><rect x="-9.3" y="2.6" width="7.6" height="1.3" rx=".6"/><rect x="1.7" y="2.6" width="7.6" height="1.3" rx=".6"/><rect x="-3.8" y="-4.4" width="7.6" height="1.3" rx=".6"/></g>',
  sheep:
    '<ellipse cx="-1" cy="0" rx="8.4" ry="5.8" fill="#fbf8ee"/><circle cx="-5" cy="-3.6" r="3.3" fill="#fbf8ee"/><circle cx="1.8" cy="-4.2" r="3.4" fill="#fbf8ee"/><ellipse cx="8" cy="-1.6" rx="3" ry="3.6" fill="#262626"/><rect x="-6" y="4.8" width="2" height="5.2" rx="1" fill="#262626"/><rect x="2.4" y="4.8" width="2" height="5.2" rx="1" fill="#262626"/>',
  wheat:
    '<path d="M0 11V-6" stroke="#7a500b" stroke-width="1.6" stroke-linecap="round"/><g fill="#7a500b"><ellipse cx="0" cy="-9" rx="1.7" ry="3"/><ellipse cx="-2.6" cy="-4.6" rx="1.6" ry="3" transform="rotate(-35 -2.6 -4.6)"/><ellipse cx="2.6" cy="-4.6" rx="1.6" ry="3" transform="rotate(35 2.6 -4.6)"/><ellipse cx="-2.6" cy="-.2" rx="1.6" ry="3" transform="rotate(-35 -2.6 -.2)"/><ellipse cx="2.6" cy="-.2" rx="1.6" ry="3" transform="rotate(35 2.6 -.2)"/><ellipse cx="-2.6" cy="4.2" rx="1.6" ry="3" transform="rotate(-35 -2.6 4.2)"/><ellipse cx="2.6" cy="4.2" rx="1.6" ry="3" transform="rotate(35 2.6 4.2)"/></g>',
  ore: '<path d="M-11 9-3.5-6l3.5 5 4.5-9L11 9z" fill="#363e49"/><path d="m4.5-10 2.6 5.2-2.6-1.4-2.4 1.6zM-3.5-6l1.9 3.8-1.9-.9-1.8 1z" fill="#f5f7fa"/>',
  gold: '<g fill="#7a5200"><path d="M-9 6h18l-3-6h-12z"/><path d="M-6 0h12l-2.5-5h-7z" opacity=".85"/></g><path d="M-3-5h6l-1.2-3.5h-3.6z" fill="#fff4c2"/>',
  sea: '<path d="M-10 2q5-4 10 0t10 0M-10 7q5-4 10 0t10 0" fill="none" stroke="#9fd3df" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>',
  fog: '<g fill="#c6d0d4" opacity=".9"><circle cx="-4" cy="1" r="4"/><circle cx="2" cy="-1" r="5"/><circle cx="6" cy="3" r="3.5"/><rect x="-8" y="2" width="17" height="4" rx="2"/></g>',
  desert:
    '<g fill="#6f7f3f"><path d="M-2 11V-8a2 2 0 0 1 4 0v19z"/><path d="M2 1h3.5A1.5 1.5 0 0 0 7-.5V-5a1.5 1.5 0 0 1 3 0v4.5A4.5 4.5 0 0 1 5.5 4H2z"/><path d="M-2 4h-3a4 4 0 0 1-4-4v-2.5a1.5 1.5 0 0 1 3 0V0a1 1 0 0 0 1 1h3z"/></g>',
};
export const iconSVG = (r: Terrain) => `<svg viewBox="-12 -12 24 24" aria-hidden="true">${GLYPH[r]}</svg>`;

export const f1 = (n: number) => Math.round(n * 10) / 10;

export function hexPts(cx: number, cy: number, r: number): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    out.push(`${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`);
  }
  return out.join(' ');
}

export function settlementPath(x: number, y: number, s = 1): string {
  const w = 0.17 * K * s;
  return `M${f1(x - w)} ${f1(y + 0.14 * K * s)}V${f1(y - 0.04 * K * s)}L${f1(x)} ${f1(y - 0.21 * K * s)}L${f1(x + w)} ${f1(y - 0.04 * K * s)}V${f1(y + 0.14 * K * s)}Z`;
}

export function cityPath(x: number, y: number): string {
  const P = [[-0.27, 0.16], [-0.27, -0.1], [-0.135, -0.25], [0, -0.1], [0, -0.02], [0.27, -0.02], [0.27, 0.16]] as const; // prettier-ignore
  return 'M' + P.map(([a, b]) => `${f1(x + a * K)} ${f1(y + b * K)}`).join('L') + 'Z';
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
}; // prettier-ignore

export function dieSVG(n: number): string {
  const pips = (PIPS[n] ?? [])
    .map(([x, y]) => `<circle cx="${x * 4.4}" cy="${y * 4.4}" r="1.85" fill="#1b2328"/>`)
    .join('');
  return `<svg class="die" viewBox="-10 -10 20 20" aria-hidden="true" data-face="${n}"><rect x="-9" y="-9" width="18" height="18" rx="4" fill="#f4ecd6" stroke="#0a1b23" stroke-width="1"/>${pips}</svg>`;
}

export const BRAND_SVG =
  '<svg viewBox="-12 -12 24 24" aria-hidden="true"><polygon points="0,-11 9.5,-5.5 9.5,5.5 0,11 -9.5,5.5 -9.5,-5.5" fill="#e9b94a" stroke="#0a1b23" stroke-width="1.5"/><polygon points="0,-11 9.5,-5.5 0,0" fill="#2f7a4b"/><polygon points="9.5,-5.5 9.5,5.5 0,0" fill="#c0623a"/><polygon points="0,11 -9.5,5.5 0,0" fill="#95c94e"/><polygon points="-9.5,5.5 -9.5,-5.5 0,0" fill="#7e8a99"/></svg>';
