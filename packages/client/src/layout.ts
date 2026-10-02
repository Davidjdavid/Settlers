/*
 * Your own screen layout (SPEC Milestone 11). The game screen's boxes can be docked to an edge
 * of the board (left, right, top or bottom, in an order), floated over the board, or hidden
 * behind a tab. Saved on your profile, one layout per kind of screen. No saved layout means the
 * standard screen, drawn exactly as it always was.
 *
 * Everything here is pure, so it's tested without a browser. A saved layout is never trusted:
 * `resolve` turns anything (an older version, a box added later, a float off the screen) into a
 * layout that shows every box somewhere sensible. The prompt bar isn't a box: it always stays
 * under the board, so nothing you need to act on can be lost.
 */

import type { PlayerSettings } from '@settlers/server/protocol';

export const PANELS = ['players', 'talk', 'hand', 'build', 'improve', 'play', 'barbarians'] as const;
export type PanelId = (typeof PANELS)[number];
export const PANEL_LABEL: Record<PanelId, string> = {
  players: 'Players',
  talk: 'Table talk',
  hand: 'Your hand',
  build: 'What you can do',
  improve: 'Science · Trade · Politics',
  play: 'Cards to play',
  barbarians: 'Barbarians',
};
/** Boxes split out of "Your hand" (2 October): a layout saved before then puts them after it. */
const FROM_HAND: readonly PanelId[] = ['build', 'improve', 'play'];

export const DOCKS = ['left', 'right', 'top', 'bottom'] as const;
export type Dock = (typeof DOCKS)[number] | 'float';
export type Device = 'laptop' | 'tablet' | 'phone';

/** Where one box goes. x, y and w are fractions of the board area (floats only). */
export interface Place {
  dock: Dock;
  order: number;
  hidden?: boolean;
  x?: number;
  y?: number;
  w?: number;
}
export interface Layout {
  v: 1;
  panels: Partial<Record<PanelId, Place>>;
}
/** A layout with every box placed, after checking. */
export type Resolved = Record<PanelId, Place>;

export const deviceOf = (width: number): Device =>
  width <= 560 ? 'phone' : width < 1180 ? 'tablet' : 'laptop';

/** The standard screen as places: what the presets and a fresh edit start from. */
export function standard(device: Device): Resolved {
  if (device === 'laptop')
    return {
      barbarians: { dock: 'left', order: 0 },
      players: { dock: 'left', order: 1 },
      talk: { dock: 'left', order: 2 },
      hand: { dock: 'right', order: 0 },
      build: { dock: 'right', order: 1 },
      improve: { dock: 'right', order: 2 },
      play: { dock: 'right', order: 3 },
    };
  const d: Dock = device === 'tablet' ? 'right' : 'bottom';
  return {
    hand: { dock: d, order: 0 },
    build: { dock: d, order: 1 },
    improve: { dock: d, order: 2 },
    play: { dock: d, order: 3 },
    barbarians: { dock: d, order: 4 },
    players: { dock: d, order: 5 },
    talk: { dock: d, order: 6 },
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Smallest and largest float width, as a fraction of the board area. */
export const FLOAT_W = [0.18, 0.6] as const;

/**
 * Every box placed, from whatever was saved. Unknown or broken entries take their standard
 * place; floats are kept on the board; phones never float (there's no room), so a float there
 * docks at the bottom.
 */
export function resolve(saved: unknown, device: Device): Resolved {
  const base = standard(device);
  const panels =
    saved &&
    typeof saved === 'object' &&
    (saved as Layout).v === 1 &&
    typeof (saved as Layout).panels === 'object'
      ? ((saved as Layout).panels as Record<string, unknown>)
      : {};
  const out = {} as Resolved;
  for (const id of PANELS) {
    const p = panels[id] as Partial<Place> | undefined;
    const ok =
      p &&
      typeof p === 'object' &&
      (DOCKS as readonly string[]).concat('float').includes(p.dock as string) &&
      num(p.order);
    if (!ok) {
      const h = out.hand;
      const k = FROM_HAND.indexOf(id);
      // An older layout: the split-out box goes right after (or under) your hand.
      out[id] =
        k >= 0 && h && panels.hand
          ? h.dock === 'float'
            ? { ...h, y: clamp((h.y ?? 0) + 0.18 * (k + 1), 0, 0.9) }
            : { ...h, order: h.order + 0.1 * (k + 1) }
          : { ...base[id] };
      continue;
    }
    let place: Place = { dock: p.dock!, order: p.order! };
    if (p.hidden === true) place.hidden = true;
    if (place.dock === 'float') {
      if (device === 'phone')
        place = { dock: 'bottom', order: 99, ...(place.hidden ? { hidden: true } : {}) };
      else {
        const w = clamp(num(p.w) ? p.w : 0.3, FLOAT_W[0], FLOAT_W[1]);
        place.w = w;
        place.x = clamp(num(p.x) ? p.x : 0.05, 0, 1 - w);
        place.y = clamp(num(p.y) ? p.y : 0.05, 0, 0.9);
      }
    }
    out[id] = place;
  }
  return renumber(out);
}

/** Orders 0, 1, 2… within each dock, keeping their relative order (ties by the standard order). */
function renumber(r: Resolved): Resolved {
  const out = { ...r };
  for (const d of [...DOCKS, 'float'] as Dock[]) {
    const ids = PANELS.filter((id) => out[id].dock === d).sort(
      (a, b) => out[a].order - out[b].order || PANELS.indexOf(a) - PANELS.indexOf(b),
    );
    ids.forEach((id, i) => (out[id] = { ...out[id], order: i }));
  }
  return out;
}

/** The boxes docked at `d`, in order (hidden ones included; the caller decides how to show them). */
export const inDock = (r: Resolved, d: Dock): PanelId[] =>
  PANELS.filter((id) => r[id].dock === d).sort((a, b) => r[a].order - r[b].order);

/* ---------- Edits (each returns a new layout) ---------- */

const save = (r: Resolved): Layout => ({ v: 1, panels: renumber(r) });

/** Dock a box at the end of an edge (it's shown again if it was hidden). */
export function dockAt(r: Resolved, id: PanelId, d: (typeof DOCKS)[number]): Layout {
  const last = Math.max(
    -1,
    ...inDock(r, d)
      .filter((x) => x !== id)
      .map((x) => r[x].order),
  );
  return save({ ...r, [id]: { dock: d, order: last + 1 } });
}

/** Move a box one place earlier (-1) or later (+1) along its edge, past boxes that are shown. */
export function shift(r: Resolved, id: PanelId, by: -1 | 1, absent: readonly PanelId[] = []): Layout {
  const list = inDock(r, r[id].dock).filter((x) => x === id || (!absent.includes(x) && !r[x].hidden));
  const i = list.indexOf(id);
  const j = i + by;
  if (j < 0 || j >= list.length) return save(r);
  const other = list[j]!;
  return save({
    ...r,
    [id]: { ...r[id], order: r[other].order },
    [other]: { ...r[other], order: r[id].order },
  });
}

/** Float a box over the board at x, y (fractions), w wide; kept on the board. */
export function floatAt(r: Resolved, id: PanelId, x: number, y: number, w = r[id].w ?? 0.3): Layout {
  const ww = clamp(w, FLOAT_W[0], FLOAT_W[1]);
  return save({
    ...r,
    [id]: {
      dock: 'float',
      order: r[id].dock === 'float' ? r[id].order : 99,
      x: clamp(x, 0, 1 - ww),
      y: clamp(y, 0, 0.9),
      w: ww,
    },
  });
}

/** Hide a box behind a tab, or show it again where it was. */
export function setHidden(r: Resolved, id: PanelId, hidden: boolean): Layout {
  const p = { ...r[id] };
  if (hidden) p.hidden = true;
  else delete p.hidden;
  return save({ ...r, [id]: p });
}

export const PRESETS = ['standard', 'bigBoard', 'leftHanded'] as const;
export type Preset = (typeof PRESETS)[number];
export const PRESET_LABEL: Record<Preset, string> = {
  standard: 'Standard',
  bigBoard: 'Big board',
  leftHanded: 'Left-handed',
};

/**
 * A preset's layout, or null for Standard (no saved layout: the standard screen exactly).
 * Big board: your hand along the bottom, everything else behind tabs. Left-handed: the
 * standard screen with left and right swapped.
 */
export function preset(p: Preset, device: Device): Layout | null {
  const s = standard(device);
  if (p === 'standard') return null;
  if (p === 'bigBoard') {
    const out = {} as Resolved;
    for (const id of PANELS)
      out[id] =
        id === 'hand' || FROM_HAND.includes(id)
          ? { dock: 'bottom', order: PANELS.indexOf(id) }
          : { ...s[id], hidden: true };
    return save(out);
  }
  const flip = (d: Dock): Dock => (d === 'left' ? 'right' : d === 'right' ? 'left' : d);
  const out = {} as Resolved;
  for (const id of PANELS) out[id] = { ...s[id], dock: flip(s[id].dock) };
  return save(out);
}

/** The saved layouts with this device's replaced (null: back to the standard screen). */
export function withLayout(
  settings: PlayerSettings | null | undefined,
  device: Device,
  l: Layout | null,
): NonNullable<PlayerSettings['layout']> {
  const all = { ...(settings?.layout ?? {}) };
  if (l) all[device] = l;
  else delete all[device];
  return all;
}
