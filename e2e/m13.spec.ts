/*
 * Milestone 13 (after the first game night): undo a whole turn, asked and answered by clicking,
 * with the question listing what it takes back; several bank trades at once through the bank
 * basket; your cards arranged by dragging and by tapping, kept through a reload, and reset.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import {
  checkFrames,
  confirmPlace,
  lobbyStep,
  playUntil,
  seatedTable,
  startGame,
  turnPage,
  view,
} from './table';

const SHOTS = process.env.SHOTS;

test.use({ actionTimeout: 15_000 });
test.setTimeout(Number(process.env.T ?? 8 * 60_000));

const botStep = (p: Page, byHand: string[] = []): Promise<string> =>
  p.evaluate((h) => (window as any).__settlers.botStep(h), byHand);
const legal = (p: Page): Promise<{ type: string; turn?: boolean }[]> =>
  p.evaluate(() => (window as any).__settlers.legal());

test('undo a whole turn, the bank basket, and arranging your cards', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'm13');
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    const [a] = t.pages as [Page, Page, Page];

    // Lobby: undo a move and a whole turn are on; the second needs the first.
    for (const p of t.pages) await lobbyStep(p, 'game');
    await expect(a.getByTestId('rule-undo')).toBeChecked();
    await expect(a.getByTestId('rule-undoTurn')).toBeChecked();
    await a.getByTestId('rule-undo').click();
    for (const p of t.pages) await expect(p.getByTestId('rule-undoTurn')).toBeDisabled();
    await a.getByTestId('rule-undo').click();
    for (const p of t.pages) await expect(p.getByTestId('rule-undoTurn')).toBeEnabled();
    await startGame(a);
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    expect((await view(a)).rules.houseRules).toMatchObject({ undo: true, undoTurn: true });

    // Play on until a turn has moves only "Undo my turn" can take back (the bot plays the turn,
    // but never ends it while we look).
    let mover: Page | null = null;
    let start: any = null;
    for (let tries = 0; tries < 80 && !mover; tries++) {
      await playUntil(
        t,
        async () => {
          const v = await view(a);
          return v.phase === 'play' && v.stage === 'main' && v.turnUndo?.n === 0;
        },
        { beforeStep: async (p) => (await confirmPlace(p), false) },
      );
      const p = await turnPage(t);
      start = await view(t.pages.find((x) => x !== p)!);
      for (let i = 0; i < 40; i++) {
        if ((await legal(p)).some((x) => x.type === 'askUndo' && x.turn)) break;
        const r = await botStep(p, ['end']);
        if (r === 'busy') await p.waitForTimeout(30);
        else if (r.startsWith('skip') || r === 'idle' || (await view(p)).stage !== 'main') break;
      }
      if ((await legal(p)).some((x) => x.type === 'askUndo' && x.turn)) mover = p;
      else await botStep(p);
    }
    expect(mover, 'a turn with something to undo').not.toBeNull();
    const m = mover!;
    const others = t.pages.filter((p) => p !== m);
    const moverName = (await view(m)).players[(await view(m)).me].nick as string;

    // Ask; the others see what it takes back, and say yes.
    await m.getByTestId('undo-turn').click();
    for (const p of others) {
      const banner = p.getByTestId('undo-banner');
      await expect(banner).toContainText(`${moverName} asks to undo their whole turn`);
      await expect(banner).toContainText('The roll stays');
      await expect(p.getByTestId('undo-list').locator('li').first()).toBeVisible();
    }
    if (SHOTS) await others[0]!.screenshot({ path: `${SHOTS}/m13-undo-turn.png` });
    for (const p of others) await p.getByTestId('undo-yes').click();
    for (const p of t.pages) {
      await expect.poll(async () => (await view(p)).turnUndo?.n).toBe(0);
      const v = await view(p);
      expect(v.edges).toEqual(start.edges);
      expect(v.verts).toEqual(start.verts);
      expect(v.players.map((x: any) => x.resCount)).toEqual(start.players.map((x: any) => x.resCount));
      await expect(p.getByTestId('log')).toContainText('turn was undone, back to just after the roll');
    }

    // Big moments (SPEC 13.4): a rule changed mid-game shows on the others' boards with what it
    // means; the scoreboard shows everyone's place.
    for (const p of t.pages) await expect(p.getByTestId('place')).toHaveCount(3);
    await m.getByRole('button', { name: 'Menu', exact: true }).click();
    await m.getByTestId('menu-rules').click();
    await m.getByTestId('tablerule-bank3to1').click();
    await m.getByTestId('rules-close').click();
    for (const p of others) {
      const moment = p.locator('[data-testid=moment][data-kind=rule]');
      await expect(moment).toContainText(`${moverName} turned on “3:1 bank trades for everyone”`);
      await expect(moment).toContainText('Everyone trades with the bank at 3:1');
    }
    if (SHOTS) await others[0]!.screenshot({ path: `${SHOTS}/m13-moment.png` });

    // The dice panel (SPEC 13.3): what stands out first, then every roll (newest first), then the
    // numbers as before.
    const d = a;
    await d.getByTestId('open-dice').click();
    await expect(d.getByTestId('dice-facts').locator('[data-k=sevens]')).toContainText('Sevens:');
    await expect(d.getByTestId('dice-facts').locator('[data-k=fair]')).toBeVisible();
    const list = await d.evaluate(() => (window as any).__settlers.state().dice.list);
    expect(list.length).toBeGreaterThan(0);
    const newest = list[list.length - 1];
    const firstRow = d.getByTestId('roll-row').first();
    await expect(firstRow).toHaveAttribute('data-total', String(newest.d[0] + newest.d[1]));
    await expect(firstRow).toContainText(`#${list.length}`);
    await expect(firstRow.locator('.dieface')).toHaveCount(2);
    await expect(d.getByTestId('roll-row')).toHaveCount(Math.min(12, list.length));
    if (list.length > 12) {
      await d.getByTestId('roll-list-all').click();
      await expect(d.getByTestId('roll-row')).toHaveCount(list.length);
    }
    await expect(d.getByTestId('dice-chart')).toBeVisible();
    if (SHOTS) {
      await d.screenshot({ path: `${SHOTS}/m13-dice-panel.png` });
      await d.setViewportSize({ width: 390, height: 844 });
      await d.screenshot({ path: `${SHOTS}/m13-dice-panel-phone.png` });
      await d.setViewportSize({ width: 1280, height: 860 });
    }
    await d.keyboard.press('Escape');

    // The bank basket, on a made-up view: 8 sheep and 4 wheat (4:1) for 2 brick and an ore.
    const b = others[0]!;
    const staged = await view(b);
    staged.turn = staged.me;
    staged.stage = 'main';
    staged.undo = undefined;
    staged.turnUndo = undefined;
    staged.offers = [];
    staged.hand.res = { wood: 0, brick: 0, sheep: 8, wheat: 4, ore: 0 };
    staged.board.ports = [];
    delete staged.rules.houseRules.bank3to1; // turned on above: 4:1 here
    await b.evaluate((v) => (window as any).__settlers.stage(v), staged);
    await b.getByTestId('trade-bank').click();
    const basket = b.getByTestId('bank-basket');
    await expect(basket).toBeVisible();
    await basket.getByLabel('More give sheep').click();
    await basket.getByLabel('More give sheep').click();
    await basket.getByLabel('More give wheat').click();
    await expect(basket.getByLabel('More give wheat')).toBeDisabled(); // 4 is all of them
    await expect(b.getByTestId('bank-trade')).toHaveText('Pick 3 more to get');
    await expect(b.getByTestId('bank-trade')).toBeDisabled();
    await basket.getByLabel('More get brick').click();
    await basket.getByLabel('More get brick').click();
    await basket.getByLabel('More get ore').click();
    await expect(basket.getByLabel('More get sheep')).toBeDisabled(); // you're giving sheep
    await expect(b.getByTestId('bank-trade')).toHaveText('Trade 8 Sheep, 4 Wheat for 2 Brick, 1 Ore');
    if (SHOTS) await b.screenshot({ path: `${SHOTS}/m13-bank-basket.png` });
    await b.getByTestId('bank-trade').click();
    expect(await b.evaluate(() => (window as any).__settlers.staged())).toContainEqual({
      type: 'bankTrade',
      give: { sheep: 8, wheat: 4 },
      get: { brick: 2, ore: 1 },
    });
    await b.reload();
    await expect(b.locator('#board')).toBeVisible();

    // Arranging cards: drag ore onto wood's spot, tap brick then sheep, reload, reset.
    const order = () =>
      b.locator('[data-testid=hand] .rcard').evaluateAll((els) => els.map((e) => e.getAttribute('data-res')));
    await expect.poll(order).toEqual(['wood', 'brick', 'sheep', 'wheat', 'ore']);
    const from = (await b.locator('[data-testid=hand] [data-res=ore]').boundingBox())!;
    const to = (await b.getByTestId('hand-slot-0').boundingBox())!;
    await b.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await b.mouse.down();
    for (let i = 1; i <= 8; i++)
      await b.mouse.move(
        from.x + from.width / 2 + ((to.x - from.x) * i) / 8,
        from.y + from.height / 2 + ((to.y - from.y) * i) / 8,
      );
    await b.mouse.up();
    await expect.poll(order).toEqual(['ore', 'brick', 'sheep', 'wheat', 'wood']);
    await b.locator('[data-testid=hand] [data-res=brick]').click();
    await expect(b.getByTestId('hand-hint')).toContainText('Tap another spot');
    await b.locator('[data-testid=hand] [data-res=sheep]').click();
    await expect.poll(order).toEqual(['ore', 'sheep', 'brick', 'wheat', 'wood']);
    if (SHOTS) await b.locator('[data-box=hand]').screenshot({ path: `${SHOTS}/m13-hand.png` });
    await b.reload();
    await expect(b.locator('#board')).toBeVisible();
    await expect.poll(order).toEqual(['ore', 'sheep', 'brick', 'wheat', 'wood']);
    // Only this screen changed.
    await expect
      .poll(() =>
        others[1]!
          .locator('[data-testid=hand] .rcard')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-res'))),
      )
      .toEqual(['wood', 'brick', 'sheep', 'wheat', 'ore']);
    await b.getByTestId('hand-reset').click();
    await expect.poll(order).toEqual(['wood', 'brick', 'sheep', 'wheat', 'ore']);
    await expect(b.getByTestId('hand-reset')).toHaveCount(0);

    const seats = await Promise.all(t.pages.map(async (p) => (await view(p)).me));
    checkFrames(t, seats, 20);
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
