/*
 * Emblems (docs/isle.md 9): each person picks one, and it marks them on the new screen in a disc
 * of their colour. Letters didn't work: people at the table share first letters. Flat, simple
 * glyphs in one style, drawn on a 24×24 grid in the disc's ink colour.
 */

import type { CSSProperties } from 'react';
import type { Color } from '@settlers/engine';
import { EMBLEMS, type Emblem } from '@settlers/server/protocol';
import { PCOL, PEDGE } from './art';

export { EMBLEMS, type Emblem };

export const EMBLEM_LABEL: Record<Emblem, string> = {
  anchor: 'Anchor',
  wheat: 'Wheat',
  crown: 'Crown',
  star: 'Star',
  shield: 'Shield',
  sword: 'Sword',
  tower: 'Tower',
  sail: 'Sail',
  sun: 'Sun',
  moon: 'Moon',
  leaf: 'Leaf',
  flame: 'Flame',
  key: 'Key',
  bird: 'Bird',
  mountain: 'Mountain',
  gem: 'Gem',
};

const S =
  'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

const GLYPH: Record<Emblem, string> = {
  anchor: `<circle cx="12" cy="4.8" r="2.3" ${S}/><path d="M12 7.1V20.5M7.5 10.5h9M4 13.5c.6 4.2 3.9 7 8 7s7.4-2.8 8-7" ${S}/>`,
  wheat:
    '<path d="M12 22V9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    [4.5, 9, 13.5]
      .map(
        (y) =>
          `<path d="M11.6 ${y + 4.2}C8.4 ${y + 4.2} 6.6 ${y + 2} 6.6 ${y}c3.2 0 5 2.2 5 4.2Z" fill="currentColor"/>` +
          `<path d="M12.4 ${y + 4.2}c3.2 0 5-2.2 5-4.2-3.2 0-5 2.2-5 4.2Z" fill="currentColor"/>`,
      )
      .join('') +
    '<path d="M12 1.5c1.3 1.2 1.3 3.3 0 4.6-1.3-1.3-1.3-3.4 0-4.6Z" fill="currentColor"/>',
  crown:
    '<path d="M3 18.5 2 7.5l5.5 4.3L12 4.5l4.5 7.3L22 7.5l-1 11Z" fill="currentColor"/><rect x="3" y="19.8" width="18" height="2.4" rx="1" fill="currentColor"/>',
  star: '<path d="M12 2.2l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8Z" fill="currentColor"/>',
  shield:
    '<path d="M12 2 20.5 5v6.5c0 5.2-3.6 8.9-8.5 10.5C7.1 20.4 3.5 16.7 3.5 11.5V5Z" fill="currentColor"/>',
  sword: `<path d="M19.5 2.5 21.5 4.5 10 16l-2-2Z" fill="currentColor"/><path d="M5.5 12.5l6 6M3 21l4.5-4.5" ${S}/>`,
  tower:
    '<path d="M5 22V10H4V3.5h3.2v2.2h2.2V3.5h5.2v2.2h2.2V3.5H20V10h-1v12h-4.8v-4.5a2.2 2.2 0 0 0-4.4 0V22Z" fill="currentColor"/>',
  sail: '<path d="M11 2.5v13.5H4Z" fill="currentColor"/><path d="M13 4.5c3.8 2.8 6 7 6 11.5h-6Z" fill="currentColor"/><path d="M2.5 18h19l-3 4h-13Z" fill="currentColor"/>',
  sun:
    '<circle cx="12" cy="12" r="4.6" fill="currentColor"/>' +
    `<path d="M12 1.8v2.8M12 19.4v2.8M1.8 12h2.8M19.4 12h2.8M4.8 4.8l2 2M17.2 17.2l2 2M4.8 19.2l2-2M17.2 6.8l2-2" ${S}/>`,
  moon: '<path d="M15 2.5a9.5 9.5 0 1 0 6.5 15.5A8 8 0 0 1 15 2.5Z" fill="currentColor"/>',
  leaf: '<path d="M20.5 3C9.5 3 3.5 8.5 3.5 15.5c0 1.6.3 3 .9 4.3C6 14 10 10.3 15 8.7c-4.3 2.6-7.4 6.4-8.9 12.2 8.4-.3 14.4-6.3 14.4-17.9Z" fill="currentColor"/>',
  flame:
    '<path d="M12 1.5c1.2 4.3 6.5 6.4 6.5 12.8a6.5 6.5 0 0 1-13 0c0-3.3 1.6-5.4 3.3-7 .3 2.1 1.3 3.5 2.6 4.3C11.2 8.8 10.3 5.1 12 1.5Z" fill="currentColor"/>',
  key: `<circle cx="7" cy="12" r="4" ${S}/><path d="M11 12h10.5M17.5 12v3.5M21 12v3" ${S}/>`,
  bird: '<path d="M2 9.5c3.2-.4 5.6.6 7.5 2.6.9-3.8 4-6.6 8-6.6 1.7 0 3 .5 4.5 1.4l-2.6 1c.5 1 .8 2 .8 3.1 0 5-4.3 8.5-9.6 8.5-3 0-5.4-1.2-7-3.2 2.6.1 4.6-.6 6-2-3.6-.3-6.3-2.3-7.6-4.8Z" fill="currentColor"/>',
  mountain: '<path d="M1.5 20.5 9 6.5l4.2 7 2.8-4 6.5 11Z" fill="currentColor"/>',
  gem:
    '<path d="M6.5 3.5h11l4.5 6L12 21.5 2 9.5Z" fill="currentColor"/>' +
    '<path d="M2.5 9.5h19M9 3.8 7.5 9.5 12 21M15 3.8l1.5 5.7L12 21" fill="none" stroke="var(--em-cut)" stroke-width="1.2" stroke-linejoin="round"/>',
};

/** Dark or white writing on a colour, whichever reads better. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // The contrast with white against the contrast with the dark ink (#1f2440, luminance ~0.02).
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.07 ? '#fff' : '#1f2440';
}

/** Just the glyph, in the current text colour. */
export function EmblemGlyph({ emblem, size = 16 }: { emblem: Emblem; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: GLYPH[emblem] }}
    />
  );
}

/** A player's mark: their emblem in a disc of their colour, with their name for screen readers. */
export function EmblemBadge({
  emblem,
  color,
  size = 28,
  label,
}: {
  emblem: Emblem;
  color: Color;
  size?: number;
  label?: string;
}) {
  const ink = inkOn(PCOL[color]);
  return (
    <span
      className="emblem"
      role="img"
      aria-label={label ?? EMBLEM_LABEL[emblem]}
      data-emblem={emblem}
      style={
        {
          width: size,
          height: size,
          background: PCOL[color],
          color: ink,
          boxShadow: `inset 0 0 0 ${Math.max(1.5, size / 16)}px ${PEDGE(color)}`,
          '--em-cut': PCOL[color],
        } as CSSProperties
      }
    >
      <EmblemGlyph emblem={emblem} size={Math.round(size * 0.62)} />
    </span>
  );
}
