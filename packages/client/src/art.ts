/* Colors, glyphs and shapes, ported from the prototype. Board units: K pixels per hex radius. */

import type { Card, Color, Commodity, DevType, Progress, Resource, Terrain, Track } from '@settlers/engine';

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
  gold: '#9c6b12',
  sea: '#1f5f73',
  fog: '#5d6b73',
};
/**
 * Piece colours, chosen so every pair stays clearly different (CIEDE2000 ≥ 12) with normal vision
 * and simulated protanopia, deuteranopia and tritanopia, and every colour stands out on every
 * tile (≥ 8). Checked by test/colors.test.ts; change them only with that test passing.
 */
export const PCOL: Record<Color, string> = {
  red: '#ac130a',
  blue: '#0230c1',
  white: '#f3f4f5',
  orange: '#ee6f15',
  purple: '#a66bd7',
  black: '#191919',
  pink: '#f2a2e4',
  yellow: '#fff023',
  gray: '#9d9f93',
};
/** Outline for pieces of each colour: dark, except a light one for black pieces. */
export const PEDGE = (c: Color) => (c === 'black' ? '#d9dde0' : '#0b1418');
/** The outline for a piece of fill colour `hex`. */
export const edgeOf = (hex: string) => (hex === PCOL.black ? PEDGE('black') : PEDGE('red'));
export const PNAME: Record<Color, string> = {
  red: 'Red',
  blue: 'Blue',
  white: 'White',
  orange: 'Orange',
  purple: 'Purple',
  black: 'Black',
  pink: 'Pink',
  yellow: 'Yellow',
  gray: 'Gray',
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
  gold: '<g fill="#ffd54a" stroke="#5a3c00" stroke-width=".8"><path d="M-9 6h18l-3-6h-12z"/><path d="M-6 0h12l-2.5-5h-7z"/></g><path d="M-3-5h6l-1.2-3.5h-3.6z" fill="#fff6c8"/><g fill="#fffbe6"><path d="M7-9l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M-8-6l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></g>',
  sea: '<path d="M-10 2q5-4 10 0t10 0M-10 7q5-4 10 0t10 0" fill="none" stroke="#9fd3df" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>',
  fog: '<g fill="#c6d0d4" opacity=".9"><circle cx="-4" cy="1" r="4"/><circle cx="2" cy="-1" r="5"/><circle cx="6" cy="3" r="3.5"/><rect x="-8" y="2" width="17" height="4" rx="2"/></g>',
  desert:
    '<g fill="#6f7f3f"><path d="M-2 11V-8a2 2 0 0 1 4 0v19z"/><path d="M2 1h3.5A1.5 1.5 0 0 0 7-.5V-5a1.5 1.5 0 0 1 3 0v4.5A4.5 4.5 0 0 1 5.5 4H2z"/><path d="M-2 4h-3a4 4 0 0 1-4-4v-2.5a1.5 1.5 0 0 1 3 0V0a1 1 0 0 0 1 1h3z"/></g>',
};
export const iconSVG = (r: Terrain) => `<svg viewBox="-12 -12 24 24" aria-hidden="true">${GLYPH[r]}</svg>`;

/* ---------- Cities & Knights ---------- */

export const COM_GLYPH: Record<Commodity, string> = {
  paper:
    '<rect x="-7" y="-9" width="14" height="18" rx="1.5" fill="#fbf4dc" stroke="#6b5a2e" stroke-width="1.2"/><path d="M-4-4h8M-4 0h8M-4 4h5" stroke="#6b5a2e" stroke-width="1.3" stroke-linecap="round"/>',
  cloth:
    '<path d="M-9-6c3-2 6 2 9 0s6-2 9 0v12c-3-2-6 2-9 0s-6-2-9 0z" fill="#e9c7ee" stroke="#5c2a63" stroke-width="1.2"/><path d="M-9-1c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="#5c2a63" stroke-width="1" opacity=".6"/>',
  coin: '<circle r="8.5" fill="#ffd54a" stroke="#6b4a00" stroke-width="1.4"/><circle r="5.5" fill="none" stroke="#6b4a00" stroke-width="1" opacity=".7"/><path d="M0-3v6M-2 0h4" stroke="#6b4a00" stroke-width="1.4" stroke-linecap="round"/>',
};
export const CARD_LABEL: Record<Card, string> = {
  ...RES_LABEL,
  paper: 'Paper',
  cloth: 'Cloth',
  coin: 'Coin',
};
export const CARD_COLOR: Record<Card, string> = {
  wood: TILE_COLOR.wood,
  brick: TILE_COLOR.brick,
  sheep: TILE_COLOR.sheep,
  wheat: TILE_COLOR.wheat,
  ore: TILE_COLOR.ore,
  paper: '#d8c58f',
  cloth: '#a35aa8',
  coin: '#c79a1c',
};
export const cardIcon = (c: Card) =>
  `<svg viewBox="-12 -12 24 24" aria-hidden="true">${c in COM_GLYPH ? COM_GLYPH[c as Commodity] : GLYPH[c as Resource]}</svg>`;

export const TRACK_COLOR: Record<Track, string> = {
  trade: '#e9b94a',
  politics: '#3b82f6',
  science: '#3fa34d',
};
/**
 * The order tracks are shown in everywhere: the same as their commodities in your hand
 * (book, linen, coin), SPEC 9.6. The rules engine keeps its own order, so saved games replay.
 */
export const TRACK_ORDER: readonly Track[] = ['science', 'trade', 'politics'];

/** The event die (C&K): the barbarian ship, or a gate in a track's colour. */
export function eventDieSVG(face: 'ship' | Track | null): string {
  const bg = !face ? '#f4ecd6' : face === 'ship' ? '#1d3b52' : TRACK_COLOR[face];
  const ink = face === 'ship' ? '#f4ecd6' : '#10181c';
  const art = !face
    ? ''
    : face === 'ship'
      ? `<path d="M-6 2h12l-2.5 3.5h-7z" fill="${ink}"/><path d="M-0.4 -6.5v8.2M-0.4 -6.5l5 6h-5z" fill="${ink}" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/>`
      : `<path d="M-5.5 5.5v-7l2-2h7l2 2v7h-3.5v-4a2 2 0 0 0-4 0v4z" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const label = !face ? '' : face === 'ship' ? 'Barbarian ship' : `${TRACK_LABEL[face]} gate`;
  return `<svg class="die eventdie" viewBox="-10 -10 20 20" role="img" aria-label="${label}" data-event="${face ?? ''}"><title>${label}</title><rect x="-9" y="-9" width="18" height="18" rx="4" fill="${bg}" stroke="#0a1b23" stroke-width="1"/>${art}</svg>`;
}

export const TRACK_LABEL: Record<Track, string> = {
  trade: 'Trade',
  politics: 'Politics',
  science: 'Science',
};
/** What level 3 of each track unlocks. */
export const TRACK_ABILITY: Record<Track, string> = {
  trade: 'Trade commodities 2:1 with the bank',
  politics: 'Promote knights to mighty',
  science: 'A roll that gives you nothing gives you a resource of your choice',
};

export const PROGRESS_LABEL: Record<Progress, string> = {
  commercialHarbor: 'Commercial Harbor',
  masterMerchant: 'Master Merchant',
  merchant: 'Merchant',
  merchantFleet: 'Merchant Fleet',
  resourceMonopoly: 'Resource Monopoly',
  tradeMonopoly: 'Trade Monopoly',
  alchemist: 'Alchemist',
  crane: 'Crane',
  engineer: 'Engineer',
  inventor: 'Inventor',
  irrigation: 'Irrigation',
  medicine: 'Medicine',
  mining: 'Mining',
  printer: 'Printer',
  roadBuilding: 'Road Building',
  smith: 'Smith',
  bishop: 'Bishop',
  constitution: 'Constitution',
  deserter: 'Deserter',
  diplomat: 'Diplomat',
  intrigue: 'Intrigue',
  saboteur: 'Saboteur',
  spy: 'Spy',
  warlord: 'Warlord',
  wedding: 'Wedding',
};
export const PROGRESS_HELP: Record<Progress, string> = {
  commercialHarbor:
    'Offer each player with a commodity one of your resources; they give you a commodity back.',
  masterMerchant: 'Look at the hand of a player with more points and take 2 cards.',
  merchant: 'Put the merchant next to your town: 1 point, and 2:1 trades of that tile’s resource.',
  merchantFleet: 'Pick a card: trade it 2:1 with the bank for the rest of this turn.',
  resourceMonopoly: 'Name a resource: everyone gives you 2 of it.',
  tradeMonopoly: 'Name a commodity: everyone gives you 1 of it.',
  alchemist: 'Before you roll: choose both production dice.',
  crane: 'Your next improvement this turn costs 1 commodity less.',
  engineer: 'Build a city wall for free.',
  inventor: 'Swap two number tokens (not 2, 12, 6 or 8).',
  irrigation: 'Take 2 wheat for each field next to your towns.',
  medicine: 'Upgrade a settlement to a city for 2 ore and 1 wheat.',
  mining: 'Take 2 ore for each mountain next to your towns.',
  printer: '1 point.',
  roadBuilding: 'Build 2 roads for free.',
  smith: 'Promote up to 2 knights for free.',
  bishop: 'Move the robber and steal a card from everyone next to it.',
  constitution: '1 point.',
  deserter: 'A player removes one of their knights; you may place one like it.',
  diplomat: 'Remove an open road. If it’s yours, you may build it again elsewhere.',
  intrigue: 'Chase away an opponent’s knight that stands on your road.',
  saboteur: 'Everyone with as many points as you discards half their cards.',
  spy: 'Look at a player’s progress cards and take one.',
  warlord: 'Activate all your knights for free.',
  wedding: 'Everyone with more points than you gives you 2 cards.',
};

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
