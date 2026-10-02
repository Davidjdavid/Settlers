import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '@settlers/server/protocol';
import {
  PANELS, dockAt, floatAt, inDock, preset, resolve, setHidden, shift, standard, withLayout,
  type Device, type Resolved,
} from '../src/layout'; // prettier-ignore

const DEVICES: Device[] = ['laptop', 'tablet', 'phone'];
const shown = (r: Resolved) => PANELS.filter((id) => !r[id].hidden);

describe('your own layout (SPEC 11)', () => {
  it('nothing saved is the standard screen; every box has a place', () => {
    for (const d of DEVICES) {
      const r = resolve(undefined, d);
      expect(r).toEqual(standard(d));
      expect(shown(r)).toHaveLength(PANELS.length);
    }
  });

  it('anything saved, however broken or old, loads as a sensible layout', () => {
    const junk = [
      null,
      42,
      'x',
      { v: 2, panels: {} },
      { v: 1 },
      { v: 1, panels: { players: { dock: 'sideways', order: 0 } } },
      { v: 1, panels: { talk: { dock: 'float', order: 0, x: 5, y: -3, w: 9 } } },
      { v: 1, panels: { gone: { dock: 'left', order: 0 }, hand: { dock: 'top', order: Number.NaN } } },
    ];
    for (const d of DEVICES)
      for (const j of junk) {
        const r = resolve(j, d);
        for (const id of PANELS) {
          const p = r[id];
          expect(['left', 'right', 'top', 'bottom', 'float']).toContain(p.dock);
          expect(Number.isInteger(p.order)).toBe(true);
          if (p.dock === 'float') {
            expect(d).not.toBe('phone');
            expect(p.x! + p.w!).toBeLessThanOrEqual(1);
            expect(p.y!).toBeGreaterThanOrEqual(0);
            expect(p.y!).toBeLessThanOrEqual(0.9);
          }
        }
      }
    // A float kept on the board.
    const f = resolve(
      { v: 1, panels: { talk: { dock: 'float', order: 0, x: 5, y: -3, w: 9 } } },
      'laptop',
    ).talk;
    expect(f).toEqual({ dock: 'float', order: 0, x: 0.4, y: 0, w: 0.6 });
    // Phones don't float: it docks at the bottom.
    expect(resolve({ v: 1, panels: { talk: { dock: 'float', order: 0 } } }, 'phone').talk.dock).toBe(
      'bottom',
    );
  });

  it('dock, reorder, float and hide, each saved through the server’s settings check', () => {
    let r = resolve(undefined, 'laptop');
    const check = (l: unknown) => {
      expect(SettingsSchema.safeParse({ layout: { laptop: l } }).success).toBe(true);
      return resolve(l, 'laptop');
    };
    r = check(dockAt(r, 'talk', 'right'));
    expect(inDock(r, 'right')).toEqual(['hand', 'talk']);
    expect(inDock(r, 'left')).toEqual(['barbarians', 'players']);
    r = check(shift(r, 'talk', -1));
    expect(inDock(r, 'right')).toEqual(['talk', 'hand']);
    // Can't move past the end.
    r = check(shift(r, 'talk', -1));
    expect(inDock(r, 'right')).toEqual(['talk', 'hand']);
    // Moving along an edge skips boxes this game doesn't have (no barbarians outside Knights).
    const left = resolve(undefined, 'laptop');
    const lefts = (l: ReturnType<typeof shift>) => inDock(resolve(l, 'laptop'), 'left');
    expect(lefts(shift(left, 'players', -1))).toEqual(['players', 'barbarians', 'talk']);
    expect(lefts(shift(left, 'players', -1, ['barbarians']))).toEqual(['barbarians', 'players', 'talk']);
    expect(lefts(shift(left, 'talk', -1, ['barbarians']))).toEqual(['barbarians', 'talk', 'players']);
    r = check(floatAt(r, 'players', 0.9, 0.5, 0.25));
    expect(r.players).toEqual({ dock: 'float', order: 0, x: 0.75, y: 0.5, w: 0.25 });
    r = check(setHidden(r, 'players', true));
    expect(r.players.hidden).toBe(true);
    expect(r.players.dock).toBe('float');
    r = check(setHidden(r, 'players', false));
    expect(r.players.hidden).toBeUndefined();
    // Docking a hidden box shows it again.
    r = check(setHidden(r, 'barbarians', true));
    r = check(dockAt(r, 'barbarians', 'top'));
    expect(r.barbarians).toEqual({ dock: 'top', order: 0 });
  });

  it('presets: Standard is no saved layout; Big board keeps only your hand; Left-handed mirrors', () => {
    for (const d of DEVICES) {
      expect(preset('standard', d)).toBeNull();
      const big = resolve(preset('bigBoard', d), d);
      expect(shown(big)).toEqual(['hand']);
      expect(big.hand.dock).toBe('bottom');
      const left = resolve(preset('leftHanded', d), d);
      for (const id of PANELS) {
        const s = standard(d)[id].dock;
        expect(left[id].dock).toBe(s === 'left' ? 'right' : s === 'right' ? 'left' : s);
      }
      expect(SettingsSchema.safeParse({ layout: { [d]: preset('bigBoard', d) } }).success).toBe(true);
    }
  });

  it('a layout is per kind of screen: saving one leaves the others', () => {
    const l = preset('bigBoard', 'laptop');
    const s = { layout: { phone: preset('leftHanded', 'phone')! } };
    const out = withLayout(s, 'laptop', l);
    expect(out.phone).toEqual(s.layout.phone);
    expect(out.laptop).toEqual(l);
    expect(withLayout({ layout: out }, 'laptop', null)).toEqual({ phone: s.layout.phone });
  });
});
