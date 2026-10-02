/*
 * The map list and editor (docs/maps.md 4) in a real browser against the production build:
 * place tiles, numbers and harbors, drag to swap, lock, fill the rest, undo and redo, reshape,
 * save, rename, duplicate, export, import and delete. SHOTS=<dir> saves screenshots.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freePort, TestServer } from './server';

const SHOTS = process.env.SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`) });
};

test.use({ actionTimeout: 15_000 });
test.setTimeout(5 * 60_000);

let server: TestServer;
test.beforeAll(async () => {
  server = new TestServer(await freePort(), 'maps-pass');
  await server.start();
});
test.afterAll(async () => server.stop());

const hex = (p: Page, q: number, r: number) => p.locator(`[data-kind=hex][data-q="${q}"][data-r="${r}"]`);
const token = (p: Page, q: number, r: number) => p.locator(`[data-kind=token][data-q="${q}"][data-r="${r}"]`);

/** A point on a hex's tile, above its number token. */
async function onTile(p: Page, q: number, r: number) {
  const b = (await hex(p, q, r).locator('polygon').nth(1).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height * 0.22 };
}
/** Click a hex away from its number token. */
async function clickTile(p: Page, q: number, r: number) {
  const b = (await hex(p, q, r).locator('polygon').nth(1).boundingBox())!;
  await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.22);
}

test('make, edit, save and share a map', async ({ browser }) => {
  const errors: string[] = [];
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  await page.fill('#pass', server.passphrase);
  await page.click('button:has-text("Enter")');

  // The map list, empty.
  await page.getByTestId('open-maps').click();
  await expect(page.getByTestId('maps-page')).toContainText('No maps yet');

  // A new map: the standard board, all blank.
  await page.getByTestId('new-map').click();
  await expect(page.getByTestId('map-editor')).toBeVisible();
  await expect(page.locator('[data-kind=hex][data-t=random]')).toHaveCount(19);
  await expect(page.locator('[data-kind=harbor][data-t=random]')).toHaveCount(9);

  // Place a tile and a number.
  await page.getByTestId('tool-terrain-ore').click();
  await clickTile(page, 0, 0);
  await expect(hex(page, 0, 0)).toHaveAttribute('data-t', 'ore');
  await expect(page.getByTestId('counts')).toContainText('1/3 ore');
  await page.getByTestId('tool-number-6').click();
  await token(page, 0, 0).click();
  await expect(token(page, 0, 0)).toHaveAttribute('data-n', '6');

  // An 8 next to the 6 shows a warning; undo takes it away, redo puts it back.
  await page.getByTestId('tool-terrain-wheat').click();
  await clickTile(page, 1, 0);
  await page.getByTestId('tool-number-8').click();
  await token(page, 1, 0).click();
  await expect(page.locator('.warnings li[data-rule=red]')).toContainText('touch');
  await shot(page, 'maps-1-warning');
  await page.getByTestId('undo-edit').click();
  await expect(token(page, 1, 0)).not.toHaveAttribute('data-n', '8');
  await expect(page.locator('.warnings li[data-rule=red]')).toHaveCount(0);
  await page.getByTestId('redo-edit').click();
  await expect(token(page, 1, 0)).toHaveAttribute('data-n', '8');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.warnings li[data-rule=red]')).toHaveCount(0);

  // A 2:1 ore harbor on the first harbor spot.
  await page.getByTestId('tool-harbor-ore').click();
  const firstHarbor = page.locator('[data-kind=harbor]').first();
  const hq = await firstHarbor.getAttribute('data-q');
  const hr = await firstHarbor.getAttribute('data-r');
  const hs = await firstHarbor.getAttribute('data-side');
  await firstHarbor.locator('circle').first().click();
  await expect(
    page.locator(`[data-kind=harbor][data-q="${hq}"][data-r="${hr}"][data-side="${hs}"]`),
  ).toHaveAttribute('data-t', 'ore');

  // Drag the ore 6 to the next hex west: the tiles swap.
  await page.getByTestId('tool-move').click();
  const from = await onTile(page, 0, 0);
  const to = await onTile(page, -1, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(hex(page, -1, 0)).toHaveAttribute('data-t', 'ore');
  await expect(token(page, -1, 0)).toHaveAttribute('data-n', '6');
  await expect(hex(page, 0, 0)).toHaveAttribute('data-t', 'random');

  // Lock the ore tile, then fill the rest.
  await page.getByTestId('tool-lock').click();
  await clickTile(page, -1, 0);
  await expect(hex(page, -1, 0).locator('.lockmark')).toHaveCount(1);
  await page.getByTestId('fill-rest').click();
  await expect(page.locator('[data-kind=hex][data-t=random]')).toHaveCount(0);
  await expect(page.locator('[data-kind=harbor][data-t=random]')).toHaveCount(0);
  await expect(hex(page, -1, 0)).toHaveAttribute('data-t', 'ore');
  await expect(token(page, -1, 0)).toHaveAttribute('data-n', '6');
  await expect(page.getByTestId('fairness')).toBeVisible();
  await expect(page.getByTestId('warnings')).toContainText('No rule broken');
  await shot(page, 'maps-2-filled');

  // Name and save.
  await page.getByTestId('map-name').fill('Ring island');
  await page.getByTestId('map-name').press('Enter');
  await page.getByTestId('save-map').click();
  await expect(page.getByTestId('toast').last()).toContainText('Saved “Ring island”');
  await expect(page).toHaveURL(/\/maps\/m-/);
  await expect(page.getByTestId('save-map')).toHaveText('Saved');

  // Clear unlocked keeps the lock; fill again; one undo brings the filled board back.
  await page.getByTestId('clear-unlocked').click();
  await expect(page.locator('[data-kind=hex][data-t=random]')).toHaveCount(18);
  await expect(hex(page, -1, 0)).toHaveAttribute('data-t', 'ore');
  await page.getByTestId('undo-edit').click();
  await expect(page.locator('[data-kind=hex][data-t=random]')).toHaveCount(0);

  // The heat map shows pips at every corner.
  await expect(page.locator('.heat').first()).toBeVisible();
  await page.getByTestId('heat').uncheck();
  await expect(page.locator('.heat')).toHaveCount(0);
  await page.getByTestId('heat').check();

  // Presets: copy "Our rules" to a new one, change it, try it, fill with it, then delete it.
  await page.getByTestId('presets').click();
  await expect(page.getByTestId('rule-redApart')).toBeDisabled();
  await page.getByTestId('preset-copy').click();
  await page.getByTestId('preset-name').fill('Tight');
  await page.getByTestId('limit-bestSpot').fill('11');
  await page.getByTestId('rule-fairness').uncheck();
  await page.getByTestId('preset-try').click();
  await expect(page.getByTestId('preset-trial')).toContainText('A board in');
  await page.getByTestId('preset-save').click();
  await expect(page.getByTestId('preset-pick')).toHaveValue(/^p-/);
  await expect(page.getByTestId('limit-bestSpot')).toHaveValue('11');
  await shot(page, 'maps-6-preset');
  await page.locator('.sheet button:has-text("Done")').click();
  await expect(page.getByTestId('preset')).toHaveValue(/^p-/);
  await page.getByTestId('clear-unlocked').click();
  await page.getByTestId('fill-rest').click();
  await expect(page.locator('[data-kind=hex][data-t=random]')).toHaveCount(0);
  await expect(page.locator('.heat[data-pips="12"], .heat[data-pips="13"]')).toHaveCount(0);
  await page.getByTestId('presets').click();
  await page.getByTestId('preset-delete').click();
  await page.locator('.sheet button:has-text("Continue")').click();
  await page.locator('.sheet button:has-text("Delete it")').click();
  await expect(page.locator('[data-testid=preset-pick] option')).toHaveCount(2);
  await page.locator('.sheet button:has-text("Done")').click();

  // Back to the list: rename, duplicate, export, import, delete.
  await page.getByTestId('save-map').click();
  await page.getByTestId('editor-back').click();
  await expect(page.getByTestId('map-item')).toHaveCount(1);
  await page.getByTestId('rename-map').click();
  await page.getByTestId('rename-input').fill('Donut');
  await page.getByTestId('rename-input').press('Enter');
  await expect(page.locator('[data-testid=map-item][data-name=Donut]')).toHaveCount(1);
  await page.getByTestId('duplicate-map').click();
  await expect(page.locator('[data-testid=map-item][data-name="Donut (copy)"]')).toHaveCount(1);
  const donut = page.locator('[data-testid=map-item][data-name=Donut]');
  const download = page.waitForEvent('download');
  await donut.getByTestId('export-map').click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toBe('Donut.settlers-map.json');
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  expect(exported.hexes).toHaveLength(19);
  await page.getByTestId('import-file').setInputFiles(file);
  await expect(page.locator('[data-testid=map-item][data-name="Donut (2)"]')).toHaveCount(1);
  await shot(page, 'maps-3-list');
  // A bad file is refused.
  await page.getByTestId('import-file').setInputFiles({
    name: 'bad.settlers-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...exported, hexes: [...exported.hexes, exported.hexes[0]] })),
  });
  await expect(page.getByTestId('toast').last()).toContainText('This map can’t be saved: duplicate hex');
  const copy = page.locator('[data-testid=map-item][data-name="Donut (copy)"]');
  await copy.getByTestId('delete-map').click();
  await page.locator('.sheet button:has-text("Continue")').click();
  await page.locator('.sheet button:has-text("Delete it")').click();
  await expect(page.getByTestId('map-item')).toHaveCount(2);

  // The saved map opens exactly as saved.
  await donut.getByTestId('open-map').click();
  await expect(hex(page, -1, 0)).toHaveAttribute('data-t', 'ore');
  await expect(hex(page, -1, 0).locator('.lockmark')).toHaveCount(1);
  for (const h of exported.hexes as { q: number; r: number; t: string }[])
    await expect(hex(page, h.q, h.r)).toHaveAttribute('data-t', h.t);

  // Reshape: add a hex next to the board, then remove it.
  await page.getByTestId('tool-shape').click();
  await page.locator('[data-kind=ghost]').first().click();
  await expect(page.locator('[data-kind=hex]')).toHaveCount(20);
  await expect(page.getByTestId('counts')).toContainText('1 blank');
  await shot(page, 'maps-4-reshape');
  await page.getByTestId('undo-edit').click();
  await expect(page.locator('[data-kind=hex]')).toHaveCount(19);
  await clickTile(page, 2, -2);
  await expect(page.locator('[data-kind=hex]')).toHaveCount(18);

  // Leaving with unsaved changes asks first.
  await page.getByTestId('editor-back').click();
  await page.getByTestId('leave-unsaved').click();
  await expect(page.getByTestId('maps-page')).toBeVisible();

  // On a phone the editor stacks and nothing spills sideways.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByTestId('new-map').click();
  await expect(page.getByTestId('map-editor')).toBeVisible();
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide).toBeLessThanOrEqual(0);
  await shot(page, 'maps-5-phone');
  expect(errors).toEqual([]);
});
