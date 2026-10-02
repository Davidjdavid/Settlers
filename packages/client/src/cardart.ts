/*
 * A small picture for every progress card and development card, shown on the card beside its
 * description ("Cards to play"). Line drawings on a 24×24 grid in the current text colour, so a
 * card's track colour (or the dev card's) shows through around them.
 */

import type { DevType, Progress } from '@settlers/engine';

const ART: Record<Progress | DevType, string> = {
  // Trade
  commercialHarbor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M4 14a8 6 0 0 0 16 0"/>',
  masterMerchant:
    '<rect x="3" y="6" width="9" height="13" rx="1.5"/><rect x="12" y="4" width="9" height="13" rx="1.5"/><path d="M14.5 10.5h4M16.5 8.5v4"/>',
  merchant: '<path d="M3 10 5 4h14l2 6M3 10h18M5 10v10h14V10M10 20v-5h4v5"/>',
  merchantFleet: '<path d="M3 16h18l-3 4H6zM12 3v13M12 4l6 9h-6M12 6l-5 7h5"/>',
  resourceMonopoly:
    '<path d="M12 20V9M12 9c-3 0-4-3-4-5 3 0 4 2 4 5zM12 9c3 0 4-3 4-5-3 0-4 2-4 5zM12 14c-3 0-4-3-4-5 3 0 4 2 4 5zM12 14c3 0 4-3 4-5-3 0-4 2-4 5z"/><path d="M3 12h2M19 12h2"/>',
  tradeMonopoly:
    '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3 3 7 3s7-1.3 7-3v-5"/>',
  // Science
  alchemist: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9"/>',
  crane: '<path d="M6 21V4h12M6 4l-3 4M6 8l6-4M16 4v7M14 11h4v3h-4zM3 21h7"/>',
  engineer:
    '<path d="M3 20V8h18v12zM3 12h18M3 16h18M8 8v4M15 8v4M11 12v4M18 12v4M8 16v4M15 16v4M3 8V5h3v3M10.5 8V5h3v3M18 8V5h3v3"/>',
  inventor:
    '<path d="M9 18h6M10 21h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-.9.8-1.5 1.8-1.5 3.5h-4c0-1.7-.6-2.7-1.5-3.5zM12 2v1M4 9H3M21 9h-1"/>',
  irrigation: '<path d="M12 3s-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10zM10 14a2 2 0 0 0 2 2"/>',
  medicine: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  mining: '<path d="M4 7c4-4 12-4 16 0M12 5 6 21M8.5 15l2.5 1"/>',
  printer: '<path d="M5 4h10l4 4v12H5zM15 4v4h4M8 11h8M8 14h8M8 17h5"/>',
  roadBuilding: '<path d="M8 21 10 3M16 21 14 3M12 5v2M12 10v3M12 16v3"/>',
  smith: '<path d="M4 13h13a3 3 0 0 0 3-3H8V8H4zM8 13l-2 5h12l-2-5M9 18v3M15 18v3M14 3l3 3-3 3M17 6h3"/>',
  // Politics
  bishop: '<path d="M7 21h10M8 21l-1-9 5-9 5 9-1 9M10.5 9h3M12 7.5v3"/>',
  constitution:
    '<path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M6 4a2 2 0 0 0-2 2v2h2M9 9h7M9 12h7M9 15h4"/>',
  deserter: '<path d="M5 12a7 7 0 0 1 14 0v3H5zM5 15h14M12 5v4M15 19l5 0M18 17l2 2-2 2"/>',
  diplomat: '<path d="M3 12h4l3-3 3 3 2-2 3 3h3M7 12l3 3 3-1 2 2M3 8h4M17 8h4"/>',
  intrigue:
    '<path d="M4 8c3-2 13-2 16 0 0 5-3 8-5 8-1.5 0-2-2-3-2s-1.5 2-3 2c-2 0-5-3-5-8zM8 10.5h2M14 10.5h2"/>',
  saboteur:
    '<circle cx="10" cy="14" r="6"/><path d="M14 9l2-2M16 7c1-2 3-2 4-1M19 3v1M21 5h-1M20 2.5l.5.5"/>',
  spy: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  warlord: '<path d="M5 19 17 7M14 4h6v6M5 15l4 4M3 21l3-3"/>',
  wedding: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M13 5l2-2 2 2-2 2z"/>',
  // Development cards
  knight: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM12 7v10M8 11h8"/>',
  road: '<path d="M8 21 10 3M16 21 14 3M12 5v2M12 10v3M12 16v3"/>',
  plenty:
    '<rect x="3" y="7" width="8" height="12" rx="1.5"/><rect x="13" y="5" width="8" height="12" rx="1.5"/><path d="M7 11v4M5 13h4M17 9v4M15 11h4"/>',
  mono: '<path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10zM4 20h16"/>',
  vp: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};

/** The card's picture as an SVG string. */
export function cardArt(c: Progress | DevType): string {
  return `<svg class="cardart" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ART[c]}</svg>`;
}

export const ARTS = Object.keys(ART) as (Progress | DevType)[];
