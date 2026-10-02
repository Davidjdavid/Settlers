/*
 * Medium, Hard and custom CPUs (docs/bot-medium-hard.md) against the real server build:
 * - the CPU page from the start screen: Easy, Medium and Hard side by side; a custom CPU made
 *   with the sliders, saved and listed; the page on a phone;
 * - in the lobby, one CPU made Hard and another the custom CPU from its seat's menu, seen by
 *   everyone; the CPU trading switches;
 * - a full game: the level tags on the players, a trade offered to everyone through the UI
 *   that both CPUs answer on their own, no CPU move ever rejected, every frame checked for leaks.
 * SHOTS=<dir> saves screenshots.
 */

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, playUntil, seatedTable, view } from './table';

const SHOTS = process.env.SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

test('Hard and custom CPUs: the CPU page, the lobby menu and a full game', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'levels passphrase', { CPU_DELAY_MS: '40' });
  await server.start();
  try {
    // The CPU page: the three built-in CPUs, then a custom one made with the sliders.
    const maker = await (await browser.newContext()).newPage();
    await maker.goto(server.url);
    await maker.fill('#pass', server.passphrase);
    await maker.click('button:has-text("Enter")');
    await maker.getByTestId('open-cpus').click();
    await expect(maker.getByTestId('cpus-page')).toBeVisible();
    await expect(maker.locator('.cpucompare thead th')).toHaveText(['', 'Easy', 'Medium', 'Hard']);
    await expect(maker.getByTestId('cpu-robber').nth(1)).toContainText('within 3 points');
    await maker.getByTestId('new-cpu').click();
    await maker.getByTestId('cpu-name').fill('Turnip');
    await maker.getByTestId('cpu-base-hard').click();
    await maker.getByTestId('cpu-robber-gentle').click();
    await maker.getByTestId('cpu-chatter-chatty').click();
    await expect(maker.locator('.cpupreview')).toContainText('Never robs a person if it can help it');
    await maker.getByTestId('cpu-save').click();
    await expect(maker.locator('[data-testid=cpu-item][data-name=Turnip]')).toBeVisible();
    await expect(maker.locator('.cpucompare thead th')).toHaveText(['', 'Easy', 'Medium', 'Hard', 'Turnip']);
    await shot(maker, 'cpu-1-page');
    // On a phone the comparison scrolls inside its own box; the page never spills sideways.
    await maker.setViewportSize({ width: 390, height: 820 });
    expect(
      await maker.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
    await shot(maker, 'cpu-2-phone');
    await maker.context().close();

    // The lobby: two CPUs, one Hard and one Turnip, picked from their seats' menus.
    const t = await seatedTable(browser, server, ['Ann', 'Bob']);
    const [a, b] = t.pages as [Page, Page];
    await a.click('[data-testid=add-cpu]');
    await a.click('[data-testid=add-cpu]');
    await expect(b.getByTestId('cpu-seat')).toHaveCount(2);
    await expect(b.getByTestId('cpu-level').first()).toHaveValue('easy');
    await b.getByTestId('cpu-level').nth(0).selectOption('hard');
    await expect(b.getByTestId('cpu-level').nth(1).locator('option', { hasText: 'Turnip' })).toHaveCount(1);
    await b.getByTestId('cpu-level').nth(1).selectOption({ label: 'Turnip' });
    await expect(a.getByTestId('cpu-level').nth(0)).toHaveValue('hard');
    await expect(a.getByTestId('cpu-level').nth(1).locator('option:checked')).toHaveText('Turnip');
    // The CPU trading switches: on by default; Ann allows more than one offer a turn.
    await expect(a.getByTestId('opt-cpuTrading')).toBeChecked();
    await a.getByTestId('opt-cpuOneOffer').click();
    await expect(a.getByTestId('opt-cpuOneOffer')).not.toBeChecked();
    await expect(b.getByTestId('opt-cpuOneOffer')).not.toBeChecked();
    // The CPU page opens over the lobby: the room and the seat stay put.
    await a.getByTestId('cpu-page-link').click();
    await expect(a.getByTestId('cpus-page')).toBeVisible();
    await a.getByTestId('cpus-back').click();
    await expect(a.getByTestId('cpus-page')).toHaveCount(0);
    await expect(a.getByTestId('start')).toBeVisible();
    await shot(a, 'cpu-3-lobby');

    await a.click('[data-testid=start]');
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    for (const p of t.pages) {
      await expect(p.getByTestId('cpu-tag')).toHaveCount(2);
      await expect(p.getByTestId('cpu-tag').filter({ hasText: 'CPU · Hard' })).toHaveCount(1);
      await expect(p.getByTestId('cpu-tag').filter({ hasText: 'CPU · Turnip' })).toHaveCount(1);
    }
    const v0 = await view(a);
    const cpus = v0.players.flatMap((p: { cpu?: boolean }, i: number) => (p.cpu ? [i] : []));

    // Once, on a person's turn with a card to spare, offer everyone a trade by clicking: both
    // CPUs answer on their own (accept or decline).
    let offered = false;
    const offer = async (p: Page): Promise<boolean> => {
      if (offered) return false;
      const v = await view(p);
      if (v?.stage !== 'main' || v.turn !== v.me || !v.hand || v.offers.length) return false;
      const give = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as const).find((r) => v.hand.res[r] > 0);
      if (!give) return false;
      const want = give === 'ore' ? 'wood' : 'ore';
      await p.getByTestId('trade').click();
      await p.click(`[aria-label="More give ${give}"]`);
      await p.click(`[aria-label="More want ${want}"]`);
      await p.locator('.sheet .foot .btn.primary').click();
      await expect
        .poll(async () => {
          const o = (await view(p)).offers[0];
          return o ? cpus.every((c: number) => o.resp[c] != null) : 'gone';
        })
        .toBe(true);
      await shot(p, 'cpu-4-answered');
      offered = true;
      return true;
    };
    await playUntil(t, async () => (await view(a)).phase === 'over', {
      maxSteps: 30000,
      beforeStep: offer,
      log: () => server.output,
    });
    for (const p of t.pages) await expect(p.getByTestId('game-over')).toBeVisible();
    const final = await view(a);
    console.log(
      `Hard/custom CPU game over after ${final.seq} moves, ${final.turnN} turns; winner ${final.players[final.winner].nick}`,
    );
    expect(offered).toBe(true);
    expect(server.output).not.toMatch(/move rejected|memory:/);
    checkFrames(
      t,
      (await Promise.all(t.pages.map(view))).map((f) => f.me),
    );
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
