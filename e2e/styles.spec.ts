/*
 * Board styles (3 October): each person picks how the board looks on their own screen, at the
 * pre-game table or in My settings, and it's saved on their profile. Three browsers (a laptop, a
 * tablet and a phone) play a Knights game; one switches the table's board to Pixel and only their
 * screen changes. Mid-game every style is drawn on every screen with the same pieces, numbers and
 * harbors as Classic, and the style survives a reload.
 * `SHOTS=<dir>` saves a screenshot of every style on every screen.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { confirmPlace, lobbyStep, playUntil, seatedTable, startGame, view } from './table';

const SHOTS = process.env.SHOTS;
const STYLES = [
  'classic',
  'pixel',
  'wooden',
  'flat',
  'night',
  'crayon',
  'smash',
  'platformer',
  'american',
  'pikmin',
];

test.use({ actionTimeout: 15_000 });
test.setTimeout(8 * 60_000);

/** What's on a board, whatever it looks like: tokens, harbors, pieces and click targets. */
const contents = (p: Page, sel: string) =>
  p.evaluate((sel) => {
    const b = document.querySelector(sel)!;
    const n = (q: string) => b.querySelectorAll(q).length;
    return {
      tokens: [...b.querySelectorAll('[data-token]')].map((x) => x.getAttribute('data-token')).join(','),
      ports: n('[data-port]'),
      roads: n('[data-road]'),
      buildings: [...b.querySelectorAll('[data-building]')]
        .map((x) => `${x.getAttribute('data-building')}:${x.getAttribute('data-kind')}`)
        .join(','),
      knights: n('[data-knight]'),
      hexes: n('[data-kind=hex]'),
      // Which tile is where (tokens above are only which hexes have one: a reroll that keeps the
      // desert in place changes nothing there).
      terrain: [...b.querySelectorAll('[data-kind=hex]')].map((x) => x.getAttribute('data-t')).join(','),
      targets: n('[data-v]') + n('[data-e]'),
    };
  }, sel);

async function pickInSettings(p: Page, style: string) {
  await p.getByRole('button', { name: 'Menu', exact: true }).click();
  await p.getByTestId('menu-settings').click();
  await p.getByTestId('setting-artStyle').selectOption(style);
  await expect(p.locator('#board')).toHaveAttribute('data-style', style);
  await p.getByTestId('settings-close').click();
}

test('everyone picks their own board style, at the table and mid-game', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'styles');
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    const [a, b, c] = t.pages as [Page, Page, Page];
    await a.setViewportSize({ width: 1366, height: 768 });
    await b.setViewportSize({ width: 820, height: 1180 });
    await c.setViewportSize({ width: 390, height: 844 });

    /* ---------- The pre-game table ---------- */
    for (const p of t.pages) await expect(p.getByTestId('mapboard')).toHaveAttribute('data-style', 'classic');
    const before = await contents(b, '[data-testid=mapboard]');
    await a.getByTestId('table-style').selectOption('pixel');
    await expect(a.getByTestId('mapboard')).toHaveAttribute('data-style', 'pixel');
    // Only Ann's screen changes; the board itself is the same.
    await expect(b.getByTestId('mapboard')).toHaveAttribute('data-style', 'classic');
    expect(await contents(a, '[data-testid=mapboard]')).toEqual(before);
    expect(await a.locator('[data-testid=mapboard] clipPath[id^=pxc-]').count()).toBeGreaterThan(0);
    if (SHOTS) await a.screenshot({ path: `${SHOTS}/table-pixel-laptop.png` });
    // Rerolls are drawn in her style too.
    await b.getByTestId('reroll').click();
    await expect.poll(async () => contents(a, '[data-testid=mapboard]')).not.toEqual(before);
    await expect(a.getByTestId('mapboard')).toHaveAttribute('data-style', 'pixel');

    /* ---------- The game ---------- */
    await lobbyStep(a, 'game');
    await a.click('[data-testid=mode-knights]');
    await lobbyStep(c, 'game');
    await expect(c.getByTestId('mode-knights')).toHaveClass(/on/);
    await startGame(a);
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    await expect(a.locator('#board')).toHaveAttribute('data-style', 'pixel');
    await expect(b.locator('#board')).toHaveAttribute('data-style', 'classic');

    // Setup, then play on until there are cities and knights to look at.
    await playUntil(
      t,
      async () => {
        const v = await view(a);
        return (
          v.phase === 'play' &&
          v.stage === 'main' &&
          v.verts.some((x: [number, number] | null) => x && x[1] === 2) &&
          (v.ck?.knights ?? []).some((k: unknown) => k)
        );
      },
      { maxSteps: 3000 },
    );
    // Let everyone catch up to the same move.
    const seq = (await view(a)).seq;
    for (const p of t.pages) await expect.poll(async () => (await view(p)).seq).toBe(seq);

    // Nothing in front of the board: close any barbarian notice.
    for (const p of t.pages) {
      // Anyone else's notice closes itself after 7 s, so it may go just as it's clicked.
      const ok = p.getByTestId('raid-ok');
      if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2000 }).catch(() => {});
      await expect(p.locator('.back')).toHaveCount(0, { timeout: 10_000 });
    }
    // Classic first: what each screen shows (its own click targets differ), then every style.
    const classic: Awaited<ReturnType<typeof contents>>[] = [];
    for (const style of STYLES) {
      for (const p of t.pages) await pickInSettings(p, style);
      for (const [i, p] of t.pages.entries()) {
        const now = await contents(p, '#board');
        if (style === 'classic') {
          expect(now.tokens.split(',').length).toBeGreaterThan(10);
          classic.push(now);
        }
        // The same board on every screen in every style.
        expect(now).toEqual(classic[i]);
        if (SHOTS)
          await p.screenshot({ path: `${SHOTS}/game-${style}-${['laptop', 'tablet', 'phone'][i]}.png` });
      }
      // No board is wider than its screen.
      expect(await c.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    // The style is saved on the profile: a reload keeps it.
    await pickInSettings(a, 'night');
    await a.reload();
    await expect(a.locator('#board')).toHaveAttribute('data-style', 'night');

    // Play on with three different styles on the three screens.
    await pickInSettings(c, 'pikmin');
    await playUntil(t, async () => (await view(a)).seq >= seq + 40, {
      maxSteps: 2000,
      beforeStep: async (p) => {
        await confirmPlace(p);
        return false;
      },
    });
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
