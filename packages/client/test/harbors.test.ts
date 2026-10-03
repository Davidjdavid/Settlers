import { describe, expect, it } from 'vitest';
import { geometryFor, newGame, scenarioMap } from '@settlers/engine';
import { staticSVG, viewBox } from '../src/Board';
import { STYLES, THEMES, useStyle } from '../src/themes';

const seats = ['Alex', 'Sam', 'Joe'].map((nick, i) => ({
  pid: `p${i}`,
  nick,
  color: (['red', 'blue', 'white'] as const)[i]!,
}));

describe('Harbors on the board', () => {
  // Harbors sit out on the water: whatever a style draws on a sea hex (Pixel's solid water and
  // boats, Pikmin's lily pads) must be under them, or the harbor is hidden.
  for (const style of STYLES)
    it(`${style}: every harbor is drawn over the sea hexes`, () => {
      useStyle(style);
      const s = newGame('harbors', seats, {
        modules: ['seafarers'],
        map: scenarioMap('heading-for-new-shores', 3),
      });
      const g = geometryFor(s.board.hexes);
      const svg = staticSVG(s.board, g, viewBox(g));
      const sea = svg.lastIndexOf('data-sea=');
      const port = svg.indexOf('data-port=');
      expect(s.board.hexes.some((h) => h.t === 'sea')).toBe(true);
      expect(s.board.ports.length).toBeGreaterThan(0);
      expect(sea).toBeGreaterThan(0);
      expect(port, 'first harbor drawn before the last sea hex').toBeGreaterThan(sea);
    });

  it('the water a harbor sits on has no boat or lily pad', () => {
    // Pixel draws a boat on every fifth sea hex from the 3rd, Pikmin a lily pad on every fourth from the 2nd.
    expect(THEMES.pixel.seaHex(0, 0, 2)).toContain('px-boat');
    expect(THEMES.pixel.seaHex(0, 0, 2, true)).not.toContain('<use');
    expect(THEMES.pikmin.seaHex(0, 0, 1)).toContain('<path');
    expect(THEMES.pikmin.seaHex(0, 0, 1, true)).not.toContain('<path');
  });
});
