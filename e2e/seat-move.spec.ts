/*
 * Your seat on another screen (SPEC 4.6). A player's seat is still held by a screen that's
 * connected (a second tab, a page left open, a phone that dropped off without saying), and they
 * open the room in a browser that doesn't know their seat. Their name stays pickable: one more
 * tap moves the seat to this screen, and the old screen just watches. In the lobby and mid-game.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { seatedTable, startGame, view } from './table';

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
  await expect(dave.getByTestId('step-start')).toBeVisible();

  /* ---------- The lobby ---------- */
  const tab = await freshBrowser(browser, t.code);
  const me = tab.locator('[data-testid=profile][data-name=Dave]');
  await expect(me).toBeEnabled();
  await expect(me).toContainText('at this table');
  await me.click();
  await expect(tab.getByTestId('move-hint')).toContainText('another screen');
  await expect(tab.getByTestId('sit')).toHaveText('Move my seat here');
  await tab.getByTestId('sit').click();
  await expect(tab.getByTestId('step-start')).toBeVisible();
  // The first screen is told and now sees the join form.
  await expect(dave.getByText('Your seat moved to another screen')).toBeVisible();
  await expect(dave.getByTestId('sit')).toBeVisible();
  await expect(eve.locator('.seat:not(.open)')).toHaveCount(2);

  /* ---------- Mid-game ---------- */
  await startGame(tab);
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

  /* ---------- Back by mistake ---------- */
  // Back leaves the game for the start page, which offers the way back; Forward works too.
  const url = eve.url();
  const eveSeat = (await view(eve)).me;
  await eve.goBack();
  await expect(eve.getByTestId('back-to-game')).toContainText(t.code);
  await eve.getByTestId('back-to-game').click();
  await expect(eve.locator('#board')).toBeVisible();
  await expect.poll(async () => (await view(eve))?.me).toBe(eveSeat);
  await eve.goBack();
  await expect(eve.getByTestId('back-to-game')).toBeVisible();
  await eve.goForward();
  await expect(eve.locator('#board')).toBeVisible();
  expect(eve.url()).toBe(url);
  await expect.poll(async () => (await view(eve))?.me).toBe(eveSeat);
  expect(t.errors).toEqual([]);
});

test('the Stats page lists people, not CPUs, and a person can be deleted', async ({ browser }) => {
  const t = await seatedTable(browser, server, ['Gus', 'Hal']);
  const p = await freshBrowser(browser, t.code);
  // A name made here but never seated.
  await p.getByTestId('new-profile').click();
  await p.getByTestId('new-name').fill('Typo');
  await p.getByTestId('new-save').click();
  await expect(p.locator('[data-testid=profile][data-name=Typo]')).toHaveCount(1);
  await p.goto(`${server.url}/stats`);
  await expect(p.locator('[data-testid=stats-who][data-name=Gus]')).toBeVisible();
  await expect(p.locator('[data-testid=stats-who][data-name*=CPU]')).toHaveCount(0);
  await p.locator('[data-testid=stats-who][data-name=Typo]').click();
  await p.getByTestId('delete-profile').click();
  await p
    .getByRole('dialog')
    .getByRole('button', { name: /^(Next|Continue|Yes|Delete)/ })
    .first()
    .click();
  await p.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(p.locator('[data-testid=stats-who][data-name=Typo]')).toHaveCount(0);
  // Someone playing right now can't be.
  const del = async (name: string) => {
    await p.locator(`[data-testid=stats-who][data-name=${name}]`).click();
    await p.getByTestId('delete-profile').click();
    await p
      .getByRole('dialog')
      .getByRole('button', { name: /^(Next|Continue|Yes|Delete)/ })
      .first()
      .click();
    await p.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  };
  await del('Gus');
  await expect(p.getByText('Gus is playing right now in room')).toBeVisible();
  await expect(p.locator('[data-testid=stats-who][data-name=Gus]')).toBeVisible();
  // Once Gus has gone, he can be, and his seat at the table that never started goes too.
  await t.pages[0]!.close();
  await del('Gus');
  await expect(p.getByText('Gus was deleted and taken off 1 table')).toBeVisible();
  await expect(p.locator('[data-testid=stats-who][data-name=Gus]')).toHaveCount(0);
  await expect(t.pages[1]!.locator('.seat:not(.open)')).toHaveCount(1);
});
