/*
 * The pre-game table and turn order (docs/pregame.md 3) in three browsers against the production
 * build: the same board everywhere, rerolls, Back/Forward and edits seen live with who did them,
 * Ready cleared by a change, seating and a roll for first, and games that start on exactly the
 * board on the table: a full game on a generated board and another on a custom map.
 * SHOTS=<dir> saves screenshots.
 */

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freePort, TestServer } from './server';
import { checkFrames, confirmPlace, playUntil, seatedTable, view, type Table } from './table';

test.use({ actionTimeout: 15_000 });
test.setTimeout(20 * 60_000);

const SHOTS = process.env.SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

let server: TestServer;
test.beforeAll(async () => {
  server = new TestServer(await freePort(), 'pregame-pass');
  await server.start();
});
test.afterAll(async () => server.stop());

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
const tableOf = (p: Page): Promise<any> => p.evaluate(() => (window as any).__settlers.state().room?.table);
const boardKey = async (p: Page) => {
  const t = await tableOf(p);
  return t
    ? `${t.board.seed}|${JSON.stringify(t.board.map.hexes)}|${JSON.stringify(t.board.map.harbors)}`
    : '';
};
/** Every browser shows the same board (waiting for the latest change to reach them all). */
async function sameBoard(t: Table) {
  let keys: string[] = [];
  await expect
    .poll(async () => {
      keys = await Promise.all(t.pages.map(boardKey));
      return new Set(keys).size;
    })
    .toBe(1);
  return keys[0]!;
}
const lastLine = (p: Page) => p.getByTestId('board-last');
const hexOn = (p: Page, q: number, r: number) =>
  p.locator(`[data-testid=table-board] [data-kind=hex][data-q="${q}"][data-r="${r}"]`);
async function onTile(p: Page, q: number, r: number) {
  // The whole board in view (the panel can be taller than the screen).
  await p
    .locator('[data-testid=table-board] [data-testid=mapboard]')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = (await hexOn(p, q, r).locator('polygon').nth(1).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height * 0.22 };
}

/** The game's board equals the table's last board, tile by tile, number by number, harbor by harbor. */
async function startsOnTableBoard(
  t: Table,
  board: { hexes: { t: string; n?: number }[]; harbors: { t: string }[] },
) {
  for (const p of t.pages) {
    const v = await view(p);
    expect(v.board.hexes.map((h: { t: string; n: number }) => `${h.t}${h.n}`)).toEqual(
      board.hexes.map((h) => `${h.t}${h.n ?? 0}`),
    );
    expect(v.board.ports.map((x: { t: string }) => x.t)).toEqual(board.harbors.map((h) => h.t));
  }
}

async function playToEnd(t: Table) {
  await playUntil(t, async () => (await view(t.pages[0]!)).phase === 'over', {
    beforeStep: async (p) => {
      await confirmPlace(p);
      return false;
    },
  });
}

test('three browsers share the table, then play on a generated board', async ({ browser }) => {
  const t = await seatedTable(browser, server, ['Joe', 'Alex', 'Sam']);
  const [joe, alex, sam] = t.pages as [Page, Page, Page];
  await sameBoard(t);
  await expect(joe.getByTestId('board-source')).toContainText('Standard board');

  // Joe switches to the generator: everyone sees the new board and who did it.
  await joe.getByTestId('board-kind').selectOption('generated');
  for (const p of t.pages) await expect(p.getByTestId('board-source')).toContainText('Generated · Our rules');
  for (const p of t.pages) await expect(lastLine(p)).toContainText('Joe generated a board');
  const generated = await sameBoard(t);

  // Sam is ready; Alex rerolls, which clears it.
  await sam.getByTestId('ready').click();
  for (const p of t.pages)
    await expect(p.locator('[data-testid=chair][data-name=Sam] [data-testid=ready-tick]')).toHaveCount(1);
  await alex.getByTestId('reroll').click();
  for (const p of t.pages) await expect(lastLine(p)).toContainText('Alex rerolled');
  const rerolled = await sameBoard(t);
  expect(rerolled).not.toBe(generated);
  for (const p of t.pages) await expect(p.getByTestId('ready-tick')).toHaveCount(0);

  // Back and Forward, seen by everyone.
  await sam.getByTestId('board-back').click();
  for (const p of t.pages) await expect(lastLine(p)).toContainText('Sam went back a board');
  expect(await sameBoard(t)).toBe(generated);
  await joe.getByTestId('board-forward').click();
  // Wait for Forward to reach everyone: until then they all still agree on the old board.
  for (const p of t.pages) await expect(lastLine(p)).toContainText('Joe went forward a board');
  expect(await sameBoard(t)).toBe(rerolled);

  // Rerolls and Forward don't move the buttons (or the board): the mouse can stay put. Standard
  // boards have many warnings, and how many changes from board to board.
  await joe.getByTestId('board-kind').selectOption('default');
  await expect(joe.getByTestId('board-source')).toContainText('Standard board');
  const spots = () =>
    joe.evaluate(() =>
      ['reroll', 'board-back', 'board-forward', 'board-kind']
        .map((id) => {
          const r = document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width)];
        })
        .concat([[Math.round(document.querySelector('.tbmap')!.getBoundingClientRect().width)]]),
    );
  const at0 = await spots();
  const warnings = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const seed = await joe.getByTestId('board-seed').textContent();
    await joe.getByTestId(i % 3 === 2 ? 'board-back' : 'reroll').click();
    await expect(joe.getByTestId('board-seed')).not.toHaveText(seed!);
    warnings.add((await joe.locator('.tbdetails summary').textContent()) ?? '');
    expect(await spots(), `after click ${i + 1}`).toEqual(at0);
  }
  expect(warnings.size, 'boards with different warnings were tried').toBeGreaterThan(1);
  // Changing a rule on the other side doesn't move them either.
  await joe.getByTestId('mode-knights').click();
  await joe.getByTestId('mode-base').click();
  expect(await spots()).toEqual(at0);

  // Alex edits the board: drag one tile onto another.
  await alex.getByTestId('edit-board').check();
  const board = (await tableOf(alex)).board.map;
  // Two tiles near the middle (away from the harbors), of different kinds.
  const inner = board.hexes.filter(
    (h: { q: number; r: number }) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) <= 1,
  );
  const a = inner[0];
  const b = inner.find((h: { t: string }) => h.t !== a.t);
  const from = await onTile(alex, a.q, a.r);
  const to = await onTile(alex, b.q, b.r);
  await alex.mouse.move(from.x, from.y);
  await alex.mouse.down();
  await alex.mouse.move(to.x, to.y, { steps: 6 });
  await alex.mouse.up();
  for (const p of t.pages) {
    await expect(hexOn(p, a.q, a.r)).toHaveAttribute('data-t', b.t);
    await expect(lastLine(p)).toContainText(`Alex moved ${a.t}`);
    await expect(p.getByTestId('board-source')).toContainText('edited by Alex');
  }
  await sameBoard(t);
  await shot(joe, 'pregame-1-table');

  // Seating: Sam moves to the front; then everyone rolls for first.
  await sam.getByRole('button', { name: 'Move Sam earlier' }).click();
  await sam.getByRole('button', { name: 'Move Sam earlier' }).click();
  for (const p of t.pages)
    await expect(p.locator('[data-testid=chair]').first()).toHaveAttribute('data-name', 'Sam');
  await joe.getByTestId('first-roll').click();
  for (const p of [joe, alex, sam]) {
    const btn = p.getByTestId('roll-first');
    if (await btn.isVisible().catch(() => false)) await btn.click();
  }
  // Ties roll again until someone wins; Auto-roll finishes it.
  for (let i = 0; i < 10 && !(await tableOf(joe)).first.pid; i++) {
    await joe.getByTestId('auto-roll').click();
    await joe.waitForTimeout(100);
  }
  const first = (await tableOf(joe)).first.pid;
  expect(first).toBeTruthy();
  for (const p of t.pages) await expect(p.getByTestId('order-line')).toContainText('Turn order: ①');
  await shot(sam, 'pregame-2-rolled');
  const circle: string[] = (await tableOf(joe)).circle;
  const order = [...circle.slice(circle.indexOf(first)), ...circle.slice(0, circle.indexOf(first))];

  const final = (await tableOf(joe)).board.map;
  await alex.getByTestId('start').click();
  for (const p of t.pages) await expect(p.getByTestId('lobby')).toHaveCount(0);
  await startsOnTableBoard(t, final);
  const v = await view(joe);
  expect(v.players.map((p: { pid: string }) => p.pid)).toEqual(order);
  await playToEnd(t);
  const seats = await Promise.all(t.pages.map(async (p) => (await view(p)).me));
  checkFrames(t, seats);
  expect(t.errors).toEqual([]);
});

test('a full game on a custom map', async ({ browser }) => {
  // Ann makes a map first: the standard board with an ore 6 in the middle, the rest filled.
  const maker = await (await browser.newContext()).newPage();
  await maker.goto(server.url);
  await maker.fill('#pass', server.passphrase);
  await maker.click('button:has-text("Enter")');
  await maker.getByTestId('open-maps').click();
  await maker.getByTestId('new-map').click();
  await maker.getByTestId('tool-terrain-ore').click();
  const c = maker.locator('[data-kind=hex][data-q="0"][data-r="0"] polygon').nth(1);
  const bb = (await c.boundingBox())!;
  await maker.mouse.click(bb.x + bb.width / 2, bb.y + bb.height * 0.22);
  await maker.getByTestId('tool-number-6').click();
  await maker.locator('[data-kind=token][data-q="0"][data-r="0"]').click();
  await maker.getByTestId('fill-rest').click();
  await maker.getByTestId('map-name').fill('Ore heart');
  await maker.getByTestId('map-name').press('Enter');
  await maker.getByTestId('save-map').click();
  await expect(maker).toHaveURL(/\/maps\/m-/);

  const t = await seatedTable(browser, server, ['Ann', 'Ben', 'Cy']);
  const [ann] = t.pages as [Page, Page, Page];
  await ann.getByTestId('board-kind').selectOption('saved');
  await expect(ann.getByTestId('board-map')).toHaveValue(/^m-/);
  for (const p of t.pages) await expect(p.getByTestId('board-source')).toContainText('Saved map · Ore heart');
  await sameBoard(t);
  const board = (await tableOf(ann)).board.map;
  expect(board.hexes.find((h: { q: number; r: number }) => h.q === 0 && h.r === 0)).toMatchObject({
    t: 'ore',
    n: 6,
  });
  await ann.getByTestId('first-pick').click();
  await t.pages[2]!.locator('[data-testid=chair][data-name=Cy]').click();
  for (const p of t.pages) await expect(p.getByTestId('order-line')).toContainText('① Cy');
  await shot(ann, 'pregame-3-custom');
  // On a phone the table stacks above the room card and nothing spills sideways.
  const phone = t.pages[1]!;
  await phone.setViewportSize({ width: 390, height: 820 });
  await expect(phone.getByTestId('table-board')).toBeVisible();
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  await shot(phone, 'pregame-4-phone');
  await ann.getByTestId('start').click();
  for (const p of t.pages) await expect(p.getByTestId('lobby')).toHaveCount(0);
  await startsOnTableBoard(t, board);
  expect((await view(ann)).players[0].nick).toBe('Cy');
  await playToEnd(t);
  expect(t.errors).toEqual([]);
});
