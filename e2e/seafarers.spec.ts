/*
 * Three browsers play a complete Seafarers game (Heading for New Shores) against the real
 * server build:
 * - the scenario and a house rule are picked in the lobby by clicking;
 * - the first starting settlement is placed by clicking, with a ship chosen in the
 *   "Road or ship?" sheet when the edge is on the coast;
 * - points to win are lowered to 10 in the lobby, to keep the test quick;
 * - gold is picked through the gold sheet whenever it appears (if the dice give any); the rest is played by each
 *   browser's bot, which sees only that browser's view;
 * - mid-game a player reloads; every WebSocket frame is checked for hidden information.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, confirmPlace, playUntil, seatedTable, turnPage, view } from './table';

test('three players play a full Seafarers game', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'sea passphrase');
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    const [a, b, c] = t.pages as [Page, Page, Page];

    // Options, picked by clicking, are shown to everyone.
    await a.click('[data-testid=mode-seafarers]');
    await expect(b.getByTestId('mode-seafarers')).toHaveClass(/on/);
    await expect(c.getByTestId('win-vp')).toHaveText('14');
    await a.click('[data-testid=rule-freeShipMoves]');
    await expect(b.getByTestId('rule-freeShipMoves')).toBeChecked();
    // A shorter game: 10 points to win, set with the minus button.
    for (let i = 0; i < 4; i++) await a.click('[aria-label="Fewer points"]');
    await expect(c.getByTestId('win-vp')).toHaveText('10');
    await a.click('[data-testid=start]');
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    const v0 = await view(a);
    expect(v0.rules.modules).toEqual(['seafarers']);
    expect(v0.winVP).toBe(10);
    expect(v0.rules.houseRules).toEqual({ freeShipMoves: true, handBack: true });

    // The first starting settlement by clicking: a coast corner, then a ship.
    const first = await turnPage(t);
    const corners = first.locator('#board [data-v]');
    const nCorners = await corners.count();
    let placedShip = false;
    for (let i = 0; i < nCorners && !placedShip; i++) {
      await corners.nth(i).click();
      const edges = first.locator('#board [data-e]');
      const nEdges = await edges.count();
      for (let j = 0; j < nEdges; j++) {
        await edges.nth(j).click();
        const pick = first.getByTestId('piece-ship');
        if (await pick.isVisible().catch(() => false)) {
          await pick.click();
          placedShip = true;
          break;
        }
        // Not a coast edge: it's a road. Confirm it and stop exploring.
        await confirmPlace(first);
        await expect.poll(async () => (await view(first)).seq).toBe(1);
        if ((await view(first)).seq > 0) break;
      }
      if ((await view(first)).seq > 0) break;
    }
    await expect.poll(async () => (await view(a)).seq).toBe(1);
    const afterFirst = await view(a);
    if (placedShip) expect(afterFirst.sea.ships.filter((x: number | null) => x != null)).toHaveLength(1);

    // Gold is picked through the real sheet whenever it pops up.
    let goldByUI = 0;
    const pickGold = async (p: Page) => {
      const v = await view(p);
      if (v?.stage !== 'gold' || v.me == null || !v.sea.gold?.owed[v.me]) return false;
      const take = p.getByTestId('gold-take');
      await expect(take).toBeVisible();
      while (await take.isDisabled()) {
        const more = p.locator('.sheet .ctl button[aria-label^="More"]:not([disabled])').first();
        if (!(await more.count())) break;
        await more.click();
      }
      await take.click();
      await expect(take).toBeHidden();
      goldByUI++;
      return true;
    };

    await playUntil(t, async () => (await view(a)).turnN >= 20, { beforeStep: pickGold });
    const bSeat = (await view(b)).me;
    await b.reload();
    await expect(b.locator('#board')).toBeVisible();
    await expect.poll(async () => (await view(b))?.me).toBe(bSeat);

    await playUntil(t, async () => (await view(a)).phase === 'over', {
      maxSteps: 30000,
      beforeStep: pickGold,
      log: () => server.output,
    });
    for (const p of t.pages) await expect(p.getByTestId('game-over')).toBeVisible();

    const finals = await Promise.all(t.pages.map(view));
    for (const f of finals) {
      expect(f.winner).toBe(finals[0].winner);
      expect(f.seq).toBe(finals[0].seq);
      expect(JSON.stringify(f.sea.ships)).toBe(JSON.stringify(finals[0].sea.ships));
    }
    const ships = finals[0].sea.ships.filter((x: number | null) => x != null).length;
    console.log(
      `Seafarers game over after ${finals[0].seq} moves, ${finals[0].turnN} turns; ${ships} ships; gold picked by UI ${goldByUI} times; first setup piece a ship: ${placedShip}`,
    );
    expect(ships).toBeGreaterThan(0);
    // Whether gold comes up at all is down to the dice; every gold choice that did must have
    // gone through the sheet (the bots never got to answer one).
    const goldSeqs = new Set<number>();
    for (const f of t.frames[0]!)
      for (const it of f.log ?? [])
        if (it.k === 'ev' && it.e?.k === 'gold') goldSeqs.add((it as { seq: number }).seq);
    expect(goldByUI).toBe(goldSeqs.size);
    checkFrames(
      t,
      finals.map((f) => f.me),
    );
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
