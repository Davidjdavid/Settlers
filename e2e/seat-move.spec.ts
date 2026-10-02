/*
 * Your seat on another screen (SPEC 4.6). A player's seat is still held by a screen that's
 * connected (a second tab, a page left open, a phone that dropped off without saying), and they
 * open the room in a browser that doesn't know their seat. Their name stays pickable: one more
 * tap moves the seat to this screen, and the old screen just watches. In the lobby and mid-game.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { seatedTable, view } from './table';

test.use({ actionTimeout: 10_000 });
test.setTimeout(3 * 60_000);

let server: TestServer;
test.beforeAll(async () => {
  server = new TestServer(await freePort(), 'seat-move');
  await server.start();
});
test.afterAll(async () => server.stop());

async function freshBrowser(browser: Browser, code: string): Promise<Page> {
  const p = await (await browser.newContext()).newPage();
  await p.goto(server.url);
  await p.fill('#pass', server.passphrase);
  await p.click('button:has-text("Enter")');
  await p.goto(`${server.url}/r/${code}`);
  return p;
}

test('your seat moves to the screen you pick your name on, in the lobby and mid-game', async ({
  browser,
}) => {
  const t = await seatedTable(browser, server, ['Dave', 'Eve']);
  const [dave, eve] = t.pages as [Page, Page];
  await expect(dave.getByTestId('start')).toBeVisible();

  /* ---------- The lobby ---------- */
  const tab = await freshBrowser(browser, t.code);
  const me = tab.locator('[data-testid=profile][data-name=Dave]');
  await expect(me).toBeEnabled();
  await expect(me).toContainText('at this table');
  await me.click();
  await expect(tab.getByTestId('move-hint')).toContainText('another screen');
  await expect(tab.getByTestId('sit')).toHaveText('Move my seat here');
  await tab.getByTestId('sit').click();
  await expect(tab.getByTestId('start')).toBeVisible();
  // The first screen is told and now sees the join form.
  await expect(dave.getByText('Your seat moved to another screen')).toBeVisible();
  await expect(dave.getByTestId('sit')).toBeVisible();
  await expect(eve.locator('.seat:not(.open)')).toHaveCount(2);

  /* ---------- Mid-game ---------- */
  await tab.getByTestId('start').click();
  await expect.poll(async () => (await view(tab))?.me).toEqual(expect.any(Number));
  const seat = (await view(tab)).me;
  const phone = await freshBrowser(browser, t.code);
  await expect(phone.locator('#board')).toBeVisible();
  const btn = phone.locator('[data-testid=rejoin][data-name=Dave]');
  await btn.click();
  await phone.getByTestId('rejoin-move').click();
  await expect.poll(async () => (await view(phone))?.me).toBe(seat);
  await expect.poll(async () => (await view(tab))?.me).toBeNull();
  await expect(tab.getByText('Your seat moved to another screen')).toBeVisible();
  // And back again from the old screen.
  await tab.locator('[data-testid=rejoin][data-name=Dave]').click();
  await tab.getByTestId('rejoin-move').click();
  await expect.poll(async () => (await view(tab))?.me).toBe(seat);
  expect(t.errors).toEqual([]);
});
