/*
 * Milestone 11: your own screen layout, on a laptop, a tablet and a phone, against the real
 * server build. On the laptop: Edit layout from the menu, a box docked to another edge and moved
 * along it, one floated, dragged and widened, one hidden behind a tab and peeked at; saved on the
 * profile, so it survives a reload and comes back on a new device; with everything hidden (Big
 * board) the prompt and a sheet that needs an answer still show. The tablet goes left-handed; the
 * phone only moves boxes up and down and hides them. A dozen turns are played with the layouts on,
 * and Standard brings back the standard screen. SHOTS=<dir> saves screenshots.
 */

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { confirmPlace, playUntil, seatedTable, view } from './table';

const SHOTS = process.env.SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `layout-${name}.png`) });
};

test.use({ actionTimeout: 15_000 });
test.setTimeout(15 * 60_000);

let server: TestServer;
test.beforeAll(async () => {
  server = new TestServer(await freePort(), 'layout-pass');
  await server.start();
});
test.afterAll(async () => server.stop());

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
const mine = (p: Page): Promise<any> => p.evaluate(() => (window as any).__settlers.state().room?.mySettings);
const noSideScroll = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const openEditor = async (p: Page) => {
  await p.getByRole('button', { name: 'Menu' }).click();
  await p.getByTestId('menu-layout').click();
  await expect(p.getByTestId('layout-edit')).toBeVisible();
};

test('your own layout on a laptop, a tablet and a phone', async ({ browser }) => {
  const t = await seatedTable(browser, server, ['Lia', 'Tom', 'Pip']);
  const [lap, tab, phone] = t.pages as [Page, Page, Page];
  await lap.setViewportSize({ width: 1366, height: 768 });
  await tab.setViewportSize({ width: 1024, height: 768 });
  await phone.setViewportSize({ width: 390, height: 844 });
  await lap.getByTestId('start').click();
  for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
  // The standard screen to begin with: nothing custom.
  for (const p of t.pages) await expect(p.locator('.app.custom')).toHaveCount(0);

  /* ---------- The laptop ---------- */
  await openEditor(lap);
  await expect(lap.locator('[data-edge=left] [data-panel=players]')).toBeVisible();
  // Table talk dragged by its bar to the right edge, then moved above the hand.
  const talkBar = (await lap.getByTestId('ly-bar-talk').boundingBox())!;
  await lap.mouse.move(talkBar.x + 30, talkBar.y + talkBar.height / 2);
  await lap.mouse.down();
  await lap.mouse.move(1300, 400, { steps: 10 });
  await expect(lap.locator('.lyzone.z-right.on')).toBeVisible();
  await lap.mouse.up();
  await expect(lap.locator('[data-edge=right] [data-panel=talk]')).toBeVisible();
  const order = () =>
    lap
      .locator('[data-edge=right] > [data-panel]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.panel));
  expect(await order()).toEqual(['hand', 'build', 'play', 'talk']);
  for (let i = 0; i < 3; i++) await lap.getByTestId('ly-talk-earlier').click();
  await expect.poll(order).toEqual(['talk', 'hand', 'build', 'play']);
  // Your hand is in separate boxes: what you can do goes to the left on its own.
  await lap.getByTestId('ly-build-left').click();
  await expect(lap.locator('[data-edge=left] [data-panel=build] [data-testid=build-road]')).toBeVisible();
  await expect.poll(order).toEqual(['talk', 'hand', 'play']);
  await expect(lap.locator('[data-edge=right] [data-panel=hand] [data-testid=hand]')).toBeVisible();
  // The players float over the board; drag them and widen them.
  await lap.getByTestId('ly-players-float').click();
  const float = lap.locator('.lyfloat[data-panel=players]');
  await expect(float).toBeVisible();
  const b0 = (await float.boundingBox())!;
  const bar = (await lap.getByTestId('ly-bar-players').boundingBox())!;
  await lap.mouse.move(bar.x + 20, bar.y + bar.height / 2);
  await lap.mouse.down();
  await lap.mouse.move(bar.x + 220, bar.y + 120, { steps: 8 });
  await lap.mouse.up();
  await expect.poll(async () => (await float.boundingBox())!.x).toBeGreaterThan(b0.x + 150);
  const size = (await lap.getByTestId('ly-size-players').boundingBox())!;
  await lap.mouse.move(size.x + 8, size.y + 8);
  await lap.mouse.down();
  await lap.mouse.move(size.x + 108, size.y + 8, { steps: 6 });
  await lap.mouse.up();
  await expect.poll(async () => (await float.boundingBox())!.width).toBeGreaterThan(b0.width + 60);
  // The barbarians aren't in a base game; hide table talk behind a tab.
  await expect(lap.locator('[data-panel=barbarians]')).toHaveCount(0);
  await lap.getByTestId('ly-talk-hide').click();
  await expect(lap.getByTestId('ly-tab-talk')).toBeVisible();
  await shot(lap, 'editing');
  await lap.getByTestId('ly-done').click();
  await expect(lap.getByTestId('layout-edit')).toHaveCount(0);
  // Peek at the hidden log, then put it away.
  await lap.getByTestId('ly-tab-talk').click();
  await expect(lap.getByTestId('layout-peek').locator('[data-testid=log]')).toBeVisible();
  await lap.getByTestId('ly-tab-talk').click();
  await expect(lap.getByTestId('layout-peek')).toHaveCount(0);
  // Saved on the profile, for laptops only.
  await expect.poll(async () => (await mine(lap))?.layout?.laptop?.panels?.players?.dock).toBe('float');
  expect((await mine(lap)).layout.phone).toBeUndefined();
  await shot(lap, 'laptop');
  // A reload keeps it.
  await lap.reload();
  await expect(lap.locator('.lyfloat[data-panel=players]')).toBeVisible();
  await expect(lap.getByTestId('ly-tab-talk')).toBeVisible();
  expect(await noSideScroll(lap)).toBe(true);

  /* ---------- The tablet: left-handed (the Layout button in the top bar) ---------- */
  await tab.getByTestId('open-layout').click();
  await expect(tab.getByTestId('layout-edit')).toBeVisible();
  await tab.getByTestId('ly-preset-leftHanded').click();
  await expect(tab.locator('[data-edge=left] [data-panel=hand]')).toBeVisible();
  await tab.getByTestId('ly-done').click();
  await expect.poll(async () => (await mine(tab))?.layout?.tablet?.panels?.hand?.dock).toBe('left');
  expect(await noSideScroll(tab)).toBe(true);
  await shot(tab, 'tablet');

  /* ---------- Table talk: shorter, taller, folded away (saved on the profile) ---------- */
  const log = tab.getByTestId('log');
  const h0 = (await log.boundingBox())!.height;
  await tab.getByTestId('talk-shorter').click();
  await expect.poll(async () => (await mine(tab))?.talk).toBe('short');
  await expect.poll(async () => (await log.boundingBox())!.height).toBeLessThanOrEqual(130);
  await expect(tab.getByTestId('talk-shorter')).toBeDisabled();
  await tab.getByTestId('talk-taller').click();
  await tab.getByTestId('talk-taller').click();
  await expect.poll(async () => (await mine(tab))?.talk).toBe('tall');
  await expect(tab.getByTestId('talk-taller')).toBeDisabled();
  await tab.getByTestId('talk-min').click();
  await expect(log).toHaveCount(0);
  await expect(tab.getByTestId('talk-min')).toHaveText('Open');
  await shot(tab, 'talk-folded');
  await tab.reload();
  await expect(tab.getByTestId('talk-min')).toHaveText('Open');
  await tab.getByTestId('talk-min').click();
  await expect(log).toBeVisible();
  expect(Math.abs((await log.boundingBox())!.height - h0)).toBeLessThan(40);
  // No CPUs at this table: no CPU chatter switch.
  await expect(tab.getByTestId('talk-cpuchat')).toHaveCount(0);

  /* ---------- Cards to play: every card with its picture and what it does ---------- */
  await tab.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
    const s = (window as any).__settlers;
    const v = structuredClone(s.state().game);
    v.hand.dev = { knight: 2, road: 1, plenty: 0, mono: 1 };
    v.hand.vpCards = 1;
    s.stage(v);
  });
  const cards = tab.getByTestId('play-cards');
  await expect(cards.locator('.playcard')).toHaveCount(4);
  await expect(cards.locator('.cardart')).toHaveCount(4);
  await expect(cards.locator('[data-dev=knight]')).toContainText('Move the robber and steal a card');
  await expect(cards.locator('[data-dev=knight]')).toContainText('×2');
  await expect(cards.locator('[data-dev=vp]')).toContainText('Worth 1 point');
  await shot(tab, 'cards-to-play');
  await tab.reload();
  await expect(cards.locator('.none')).toBeVisible();

  /* ---------- The phone: up and down, and hide ---------- */
  await openEditor(phone);
  await expect(phone.getByTestId('ly-players-left')).toHaveCount(0);
  await expect(phone.getByTestId('ly-players-float')).toHaveCount(0);
  const phoneOrder = () =>
    phone
      .locator('[data-edge=bottom] > [data-panel]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.panel));
  expect(await phoneOrder()).toEqual(['hand', 'build', 'play', 'players', 'talk']);
  await phone.getByTestId('ly-players-earlier').click();
  await expect.poll(phoneOrder).toEqual(['hand', 'build', 'players', 'play', 'talk']);
  await phone.getByTestId('ly-talk-hide').click();
  await phone.getByTestId('ly-done').click();
  await expect(phone.getByTestId('ly-tab-talk')).toBeVisible();
  expect(await noSideScroll(phone)).toBe(true);
  await shot(phone, 'phone');

  /* ---------- A dozen turns with the layouts on ---------- */
  await playUntil(t, async () => (await view(lap)).turnN >= 12, {
    beforeStep: async (p) => {
      await confirmPlace(p);
      return false;
    },
  });
  for (const p of t.pages) await expect(p.getByTestId('prompt')).toBeVisible();
  const lia = (await view(lap)).me;

  /* ---------- Big board: everything hidden, and still nothing lost ---------- */
  await openEditor(lap);
  await lap.getByTestId('ly-preset-bigBoard').click();
  await lap.getByTestId('ly-done').click();
  for (const id of ['players', 'talk']) await expect(lap.getByTestId(`ly-tab-${id}`)).toBeVisible();
  await expect(lap.locator('[data-edge=bottom] [data-panel=hand]')).toBeVisible();
  await expect(lap.getByTestId('prompt')).toBeVisible();
  await shot(lap, 'big-board');
  // A sheet that needs an answer (a discard, on a made-up view) opens over everything.
  await lap.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
    const s = (window as any).__settlers;
    const v = structuredClone(s.state().game);
    v.stage = 'discard';
    v.discard = { [v.me]: 4 };
    v.hand.res = { wood: 3, brick: 3, sheep: 2, wheat: 0, ore: 0 };
    s.stage(v);
  });
  await expect(lap.getByRole('dialog', { name: /Discard 4 cards/ })).toBeVisible();
  await lap.reload();

  /* ---------- A new device: the layout follows the profile ---------- */
  const other = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await other.goto(server.url);
  await other.fill('#pass', server.passphrase);
  await other.click('button:has-text("Enter")');
  await other.goto(`${server.url}/r/${t.code}`);
  await other.locator('[data-testid=rejoin][data-name=Lia]').click();
  await other.getByTestId('rejoin-move').click();
  await expect.poll(async () => (await view(other))?.me).toBe(lia);
  await expect(other.getByTestId('ly-tab-players')).toBeVisible();
  await expect(other.locator('[data-edge=bottom] [data-panel=hand]')).toBeVisible();

  /* ---------- Standard: the standard screen again ---------- */
  await openEditor(other);
  await other.getByTestId('ly-preset-standard').click();
  await other.getByTestId('ly-done').click();
  await expect(other.locator('.app.custom')).toHaveCount(0);
  await expect(other.locator('aside.side .players-box')).toBeVisible();
  await expect.poll(async () => (await mine(other))?.layout?.laptop).toBeUndefined();
  expect(t.errors).toEqual([]);
});
