/*
 * Milestone 10 (10.1–10.4) in browsers against the real server build:
 * - The map editor's Seafarers pieces: sea and fog painted, the start area painted, points for a
 *   new island, the pirate's start, the fog stack (gold added under the fog); and a region with
 *   its own tile set (a gold tile swapped in), then "Fill the rest" and save.
 * - Three browsers pick that map at the pre-game table in Seafarers mode and play it to the end:
 *   the game starts on exactly the table's board, with the pirate, the fog and the region's gold
 *   where the map put them.
 * - The Fog Islands, picked in the lobby, played to the end.
 * - Treasures (10.3): three put on paths in the editor (one taken off again), face down on the
 *   board in every browser, never a hint of the deck in any frame; the treasure sheet answered by
 *   clicking on a made-up view (a random game may find none that asks). SHOTS=<dir> saves
 *   screenshots.
 */

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, confirmPlace, playUntil, seatedTable, view, type Table } from './table';

const SHOTS = process.env.SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `m10-${name}.png`), fullPage: true });
};

test.use({ actionTimeout: 15_000 });
test.setTimeout(20 * 60_000);

let server: TestServer;
test.beforeAll(async () => {
  server = new TestServer(await freePort(), 'm10-pass');
  await server.start();
});
test.afterAll(async () => server.stop());

const hex = (p: Page, q: number, r: number) => p.locator(`[data-kind=hex][data-q="${q}"][data-r="${r}"]`);
/** Click a hex away from its number token. */
async function clickTile(p: Page, q: number, r: number) {
  const b = (await hex(p, q, r).locator('polygon').last().boundingBox())!;
  await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.22);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
const tableOf = (p: Page): Promise<any> => p.evaluate(() => (window as any).__settlers.state().room?.table);

async function playToEnd(t: Table) {
  await playUntil(t, async () => (await view(t.pages[0]!)).phase === 'over', {
    maxSteps: 20000,
    beforeStep: async (p) => {
      await confirmPlace(p);
      return false;
    },
  });
}

const EAST: [number, number][] = [
  [1, -2],
  [2, -2],
  [2, -1],
];
const REGION: [number, number][] = [
  [1, -1],
  [1, 0],
  [0, 1],
];
const START: [number, number][] = [
  [-2, 0],
  [-2, 1],
  [-2, 2],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [-1, 2],
  [0, -2],
  [0, -1],
  [0, 0],
  [-0, 2],
  [1, 1],
];

test('a Seafarers map from the editor, played to the end; then the Fog Islands', async ({ browser }) => {
  /* ---------- The editor ---------- */
  const maker = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors: string[] = [];
  maker.on('pageerror', (e) => errors.push(e.message));
  await maker.goto(server.url);
  await maker.fill('#pass', server.passphrase);
  await maker.click('button:has-text("Enter")');
  await maker.getByTestId('open-maps').click();
  await maker.getByTestId('new-map').click();
  await maker.getByTestId('seafarers').check();
  await expect(maker.getByTestId('seafarers-panel')).toBeVisible();
  // Sea along the east side, fog in the south.
  await maker.getByTestId('tool-terrain-sea').click();
  for (const [q, r] of EAST) await clickTile(maker, q, r);
  await maker.getByTestId('tool-terrain-fog').click();
  await clickTile(maker, 2, 0);
  await clickTile(maker, 1, 1);
  await expect(maker.getByTestId('fog-stack')).toBeVisible();
  // Gold under the fog (it brings its own number).
  await maker
    .locator('[data-testid=fog-stack] .fogcount[data-t=gold] button[aria-label^="One more"]')
    .click();
  await expect(maker.getByTestId('fog-gold')).toHaveText('1');
  // The start area, island points and the pirate.
  await maker.getByTestId('tool-start').click();
  for (const [q, r] of START.slice(0, -1)) await clickTile(maker, q, r);
  await expect(maker.locator('[data-start]')).toHaveCount(11);
  await maker.getByTestId('island-vp').selectOption('2');
  await maker.getByTestId('tool-pirate').click();
  await clickTile(maker, 2, -1);
  await expect(maker.getByTestId('pirate-start')).toHaveCount(1);
  // A region with gold in its own set.
  await maker.getByTestId('region-add').click();
  await expect(maker.getByTestId('region-r1')).toBeVisible();
  for (const [q, r] of REGION) await clickTile(maker, q, r);
  await expect(maker.locator('[data-region=r1]')).toHaveCount(3);
  await maker.getByTestId('set-r1-gold-more').click();
  await expect(maker.getByTestId('set-r1-gold')).toHaveText('1');
  await maker.getByTestId('region-r1-name').fill('Gold coast');
  await maker.getByTestId('region-r1-name').press('Tab');
  await shot(maker, 'editor');
  // Undo and redo step through it.
  await maker.getByTestId('undo-edit').click();
  await expect(maker.getByTestId('region-r1-name')).toHaveValue('Region A');
  await maker.getByTestId('redo-edit').click();
  await expect(maker.getByTestId('region-r1-name')).toHaveValue('Gold coast');
  // Treasures (10.3): two on paths by the start, one out across the water.
  await maker.getByTestId('tool-treasure').click();
  await maker.locator('[data-kind=path][data-q="0"][data-r="0"]').first().click();
  await maker.locator('[data-kind=path][data-q="-1"][data-r="0"]').first().click();
  await maker.locator('[data-kind=path][data-q="2"][data-r="-1"]').first().click();
  await expect(maker.locator('[data-kind=treasure]')).toHaveCount(3);
  // A click on one takes it off; another puts one back.
  await maker.locator('[data-kind=treasure]').last().click();
  await expect(maker.locator('[data-kind=treasure]')).toHaveCount(2);
  await maker.locator('[data-kind=path][data-q="1"][data-r="-2"]').first().click();
  await expect(maker.getByTestId('treasure-count')).toContainText('3 on the map');
  await maker.getByTestId('fill-rest').click();
  await expect(maker.locator('[data-kind=hex][data-t=random]')).toHaveCount(0);
  await maker.getByTestId('map-name').fill('Gold coast');
  await maker.getByTestId('map-name').press('Enter');
  await maker.getByTestId('save-map').click();
  await expect(maker).toHaveURL(/\/maps\/m-/);
  await shot(maker, 'editor-filled');

  /* ---------- Played at the table ---------- */
  const t = await seatedTable(browser, server, ['Ann', 'Ben', 'Cy']);
  const [ann] = t.pages as [Page, Page, Page];
  await ann.getByTestId('mode-seafarers').click();
  await ann.getByTestId('board-kind').selectOption('saved');
  await expect(ann.getByTestId('board-map')).toHaveValue(/^m-/);
  for (const p of t.pages) await expect(p.getByTestId('board-source')).toContainText('Gold coast');
  const board = (await tableOf(ann)).board.map;
  const at = (q: number, r: number) =>
    board.hexes.findIndex((h: { q: number; r: number }) => h.q === q && h.r === r);
  // The region's gold landed in the region, and only there.
  const golds = board.hexes.filter((h: { t: string }) => h.t === 'gold');
  expect(golds.length).toBeGreaterThan(0);
  for (const g of golds) expect(REGION.some(([q, r]) => q === g.q && r === g.r)).toBe(true);
  await shot(ann, 'table');
  await ann.getByTestId('start').click();
  for (const p of t.pages) await expect(p.getByTestId('lobby')).toHaveCount(0);
  const v = await view(ann);
  expect(v.board.hexes.map((h: { t: string; n: number }) => `${h.t}${h.n}`)).toEqual(
    board.hexes.map((h: { t: string; n?: number }) => `${h.t}${h.n ?? 0}`),
  );
  expect(v.board.pirate).toBe(at(2, -1));
  expect(v.rules.newIslandVP).toBe(2);
  expect(v.board.hexes.filter((h: { t: string }) => h.t === 'fog')).toHaveLength(2);
  // The treasures are on the board, face down, in every browser.
  expect(v.rules.modules).toContain('treasures');
  expect(v.tr.spots).toHaveLength(3);
  for (const p of t.pages) await expect(p.locator('#board [data-treasure]')).toHaveCount(3);
  await shot(ann, 'game');
  const seats = await Promise.all(t.pages.map(async (p) => (await view(p)).me));
  await playToEnd(t);
  checkFrames(t, seats, 50);
  // The treasure deck's order never reaches a browser.
  for (const fs of t.frames)
    for (const f of fs) expect(JSON.stringify(f)).not.toMatch(/"deck":\["(roads|pick|trio|dev)/);
  const found = (await view(ann)).tr.found;
  console.log(
    `Gold coast: ${found.length} of 3 treasures found: ${found.map((f: { k: string }) => f.k).join(', ')}`,
  );
  for (const p of t.pages) await expect(p.locator('#board [data-treasure]')).toHaveCount(3 - found.length);
  expect(t.errors).toEqual([]);

  /* ---------- The treasure sheet, on a made-up view ---------- */
  // (A random game may find no treasure that asks for a choice, so the sheet is checked here.)
  await ann.reload();
  await expect(ann.locator('#board')).toBeVisible();
  const stage = (owe: { k: string; n: number }) =>
    ann.evaluate((owe) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
      const s = (window as any).__settlers;
      const v = structuredClone(s.state().game);
      v.phase = 'play';
      v.winner = null;
      delete v.keep;
      v.turn = v.me;
      v.stage = 'treasure';
      v.tr.owe = [{ p: v.me, ...owe }];
      v.tr.back = 'main';
      s.stage(v);
    }, owe);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
  const moves = (): Promise<any[]> => ann.evaluate(() => (window as any).__settlers.staged());
  await stage({ k: 'pick', n: 2 });
  await expect(ann.getByTestId('treasure-pick')).toBeVisible();
  await expect(ann.getByTestId('treasure-take')).toBeDisabled();
  await ann.getByRole('button', { name: 'More ore' }).click();
  await ann.getByRole('button', { name: 'More wheat' }).click();
  await shot(ann, 'treasure-sheet');
  await ann.getByTestId('treasure-take').click();
  await expect.poll(moves).toContainEqual({ type: 'treasurePick', cards: { ore: 1, wheat: 1 } });
  await ann.reload();

  /* ---------- The Fog Islands from the lobby ---------- */
  const f = await seatedTable(browser, server, ['Dee', 'Eve', 'Fay']);
  const [dee] = f.pages as [Page, Page, Page];
  await dee.getByTestId('mode-seafarers').click();
  await dee.getByTestId('scenario-fog-islands').click();
  for (const p of f.pages)
    await expect(p.getByTestId('scenario-fog-islands')).toHaveAttribute('aria-checked', 'true');
  await expect(f.pages[2]!.getByTestId('win-vp')).toHaveText('12');
  await dee.getByTestId('start').click();
  for (const p of f.pages) await expect(p.locator('#board')).toBeVisible();
  const fv = await view(dee);
  expect(fv.rules.mapId).toBe('fog-islands');
  expect(fv.board.hexes.filter((h: { t: string }) => h.t === 'fog')).toHaveLength(15);
  await shot(dee, 'fog-islands');
  await playToEnd(f);
  // Fog found on the way (a random game may find none) shows the same in every browser, and only
  // where fog was; the rest is as it started.
  const fogAt = new Set(fv.board.hexes.flatMap((h: { t: string }, i: number) => (h.t === 'fog' ? [i] : [])));
  const ends = await Promise.all(
    f.pages.map(async (p) =>
      (await view(p)).board.hexes.map((h: { t: string; n?: number }) => `${h.t}${h.n ?? 0}`),
    ),
  );
  for (const e of ends.slice(1)) expect(e).toEqual(ends[0]);
  const start = fv.board.hexes.map((h: { t: string; n?: number }) => `${h.t}${h.n ?? 0}`);
  ends[0]!.forEach((x: string, i: number) => {
    if (!fogAt.has(i)) expect(x).toBe(start[i]);
  });
  console.log(
    `Fog Islands: ${ends[0]!.filter((x: string) => x.startsWith('fog')).length} of 15 fog hexes left`,
  );
  expect(f.errors).toEqual([]);
  expect(errors).toEqual([]);
});
