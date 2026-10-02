/*
 * Display size (SPEC 5.12): Small to Extra large, remembered on this device. The whole page is
 * zoomed and its layouts follow the space actually left (container queries on #root), so text,
 * cards, buttons and panels grow together and nothing overflows.
 */

import { getStored, setStored } from './net';

export const SIZES = { small: 0.875, medium: 1, large: 1.15, xl: 1.3 } as const;
export type Size = keyof typeof SIZES;
export const SIZE_LABEL: Record<Size, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  xl: 'Extra large',
};

export function currentSize(): Size {
  const s = getStored('settlers.size');
  return s && s in SIZES ? (s as Size) : 'medium';
}

export function applySize(size: Size = currentSize()) {
  setStored('settlers.size', size);
  document.documentElement.style.setProperty('zoom', String(SIZES[size]));
  // Window-height units grow with the zoom; layouts that fit the window divide by it.
  document.documentElement.style.setProperty('--zoom', String(SIZES[size]));
  document.documentElement.dataset.size = size;
}
