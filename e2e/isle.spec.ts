/*
 * The new game screen (docs/isle.md 14, 15), in a Knights game on a 1366×768 laptop, a 1440×900
 * laptop and a 1920×1080 monitor:
 * - each person picks it from the menu; it's saved on their profile (a reload keeps it) and only
 *   changes their screen; a narrow window keeps the standard screen;
 * - the race track, the awards shelf and every seat (points, cards, progress cards by deck) match
 *   the game all the way through;
 * - rolls by the big button: every screen announces the roll with its total, and the last rolls
 *   list it first; the cards the roll gives you are dealt big from the bank (exactly those cards),
 *   then go into your hand; End turn by the big button;
 * - what the others did since your last turn stays on bubbles by their seats (no list to OK);
 * - the trade buttons sit right beside your cards, and nothing overflows at any size;
 * - the game is played to the end, and the menu takes you back to the standard screen.
 * The rest of the moves are played by each browser's bot. `SHOTS=<dir>` saves screenshots.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { confirmPlace, playUntil, seatedTable, view } from './table';

const SHOTS = process.env.SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/isle-${name}.png` });
};

test.use({ actionTimeout: 15_000 });
test.setTimeout(12 * 60_000);

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** Points as each screen counts them (your own hidden points only on your screen). */
const pointsOn = (v: any, p: number) =>
  p === v.me && v.hand ? v.hand.totalVP : v.players[p].publicVP + (v.players[p].vpCards ?? 0);

test('the new screen: a Knights game on two laptops and a monitor', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'isle', { CPU_DELAY_MS: '100' });
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    const [a, b, c] = t.pages as [Page, Page, Page];
    // Emblems (docs/isle.md 9): Ann picks the crown in the lobby; Bob can't take it.
    await a.locator('.emblembtn[data-emblem=crown]').click();
    await expect(b.locator('.seat .emblem[data-emblem=crown]')).toHaveCount(1);
    await expect(b.locator('.emblembtn[data-emblem=crown]')).toBeDisabled();
    await expect(a.locator('.emblembtn[data-emblem=crown]')).toHaveAttribute('aria-pressed', 'true');
    await a.click('[data-testid=mode-knights]');
    await expect(c.getByTestId('mode-knights')).toHaveClass(/on/);
    for (let i = 0; i < 4; i++) await a.click('[aria-label="Fewer points"]');
    await expect(c.getByTestId('win-vp')).toHaveText('9');
    for (let i = 0; i < 3; i++) await t.pages[i]!.setViewportSize(SIZES[i]!);
    await a.click('[data-testid=start]');
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();

    /* ---------- Picking the toy screen ---------- */
    const pick = async (p: Page, now: string, screen: string) => {
      await p.getByRole('button', { name: 'Menu', exact: true }).first().click();
      await expect(p.getByTestId(`menu-screen-${now}`)).toHaveAttribute('aria-pressed', 'true');
      await p.getByTestId(`menu-screen-${screen}`).click();
    };
    await pick(a, 'standard', 'new');
    await expect(a.getByTestId('isle-play')).toBeVisible();
    // Only Ann's screen changed.
    await expect(b.getByTestId('isle-play')).toHaveCount(0);
    for (const p of [b, c]) await pick(p, 'standard', 'new');
    for (const p of t.pages) await expect(p.getByTestId('isle-play')).toBeVisible();
    // Saved on the profile: a reload keeps it.
    await c.reload();
    await expect(c.getByTestId('isle-play')).toBeVisible();
    // A narrow window keeps the standard screen, and the new one comes back when it's wide again.
    await b.setViewportSize({ width: 900, height: 1000 });
    await expect(b.getByTestId('isle-play')).toHaveCount(0);
    await expect(b.locator('#board')).toBeVisible();
    await b.setViewportSize(SIZES[1]!);
    await expect(b.getByTestId('isle-play')).toBeVisible();

    /* ---------- Everything matches the game, at every size ---------- */
    const checkScreen = async (p: Page) => {
      const v = await view(p);
      if (!v || v.phase === 'over') return;
      const seats = await p.evaluate(() => (window as any).__settlers.state().room.seats);
      for (let s = 0; s < v.players.length; s++) {
        // Everyone shows as their emblem, never a letter.
        const emblem = seats.find((x: { pid: string }) => x.pid === v.players[s].pid).emblem;
        await expect(p.locator(`[data-testid=seat-${s}] .emblem`).first()).toHaveAttribute(
          'data-emblem',
          emblem,
        );
        await expect(p.locator(`[data-testid=racer-${s}] .emblem`)).toHaveAttribute('data-emblem', emblem);
        await expect(p.getByTestId(`racer-${s}`)).toHaveAttribute('data-pts', String(pointsOn(v, s)));
        await expect(p.getByTestId(`cards-${s}`)).toContainText(String(v.players[s].resCount));
        for (const tr of ['science', 'trade', 'politics'])
          await expect(p.locator(`[data-testid=progress-${s}] [data-pcol=${tr}]`)).toHaveText(
            String(v.ck.colors[s][tr]),
          );
      }
      await expect(p.locator('[data-award=longest]')).toHaveAttribute('data-holder', String(v.longest ?? ''));
      for (const tr of ['science', 'trade', 'politics']) {
        const at = v.ck.metro[tr];
        const holder = at != null ? v.verts[at][0] : '';
        await expect(p.locator(`[data-award=${tr}]`)).toHaveAttribute('data-holder', String(holder));
      }
      // Nothing spills out of the window or the strip along the bottom.
      const spill = await p.evaluate(() => {
        const tray = document.querySelector('.ip-tray') as HTMLElement;
        return {
          page: document.documentElement.scrollWidth - innerWidth,
          tray: tray.scrollWidth - tray.clientWidth,
          bottom: tray.getBoundingClientRect().bottom - innerHeight,
        };
      });
      expect(spill.page).toBeLessThanOrEqual(0);
      expect(spill.tray).toBeLessThanOrEqual(1);
      expect(spill.bottom).toBeLessThanOrEqual(0);
    };

    /* ---------- Turns through the big button ---------- */
    const done = { roll: 0, end: 0, bubbles: 0, dealt: 0, beside: 0 };
    let checks = 0;
    const beforeStep = async (p: Page): Promise<boolean> => {
      await confirmPlace(p);
      const v = await view(p);
      if (!v || v.phase !== 'play' || v.turn !== v.me) return false;
      if (v.stage === 'preroll' && v.turnN > 3 && done.roll < 6) {
        // Your turn: what the others did since your last one is on bubbles by their seats, and
        // there's no separate list to OK.
        await expect(p.getByTestId('recap')).toHaveCount(0);
        const bubbles = async () =>
          Object.fromEntries(
            await p
              .locator('[data-testid^=bubble-]')
              .evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.testid!, e.textContent!])),
          );
        // What someone just did off their turn shows for 4½ s; what they did since your turn stays.
        const settle = done.roll < 2;
        if (settle) await p.waitForTimeout(4700);
        const before = await bubbles();
        if (Object.keys(before).length) done.bubbles++;
        if (done.roll === 0) await shot(p, 'your-turn');
        // Roll by the big button: every screen announces it.
        await p.getByTestId('roll').click();
        await expect.poll(async () => (await view(p)).stage).not.toBe('preroll');
        const after = await view(p);
        const sum = after.dice[0] + after.dice[1];
        for (const q of t.pages)
          await expect(q.getByTestId('roll-show')).toHaveAttribute('data-sum', String(sum));
        // The cards it gave you are dealt big: exactly those (the hand's change, up to 8 shown one
        // by one), then they go into your hand.
        const got = Object.entries(after.hand.res as Record<string, number>)
          .map(([k, n]) => [k, n - (v.hand.res[k] ?? 0)] as const)
          .filter(([, n]) => n > 0);
        if (got.length) {
          await expect(p.getByTestId('gain-text')).toContainText('You got');
          if (got.reduce((a, [, n]) => a + n, 0) <= 8)
            for (const [k, n] of got)
              await expect(p.locator(`[data-testid=gain-card][data-res=${k}]`)).toHaveCount(n);
          if (!done.dealt) await shot(p, 'dealt');
          done.dealt++;
          await expect(p.getByTestId('gain-show')).toHaveCount(0, { timeout: 8000 });
        } else await expect(p.getByTestId('gain-show')).toHaveCount(0);
        // Once announced, the roll heads the last rolls everywhere.
        for (const q of t.pages)
          await expect(q.getByTestId('last-rolls').locator('li').first()).toHaveAttribute(
            'data-sum',
            String(sum),
          );
        // The bubbles stayed (a 7 can bring discards, which show for a moment instead).
        if (settle && sum !== 7) expect(await bubbles()).toEqual(before);
        if (done.roll === 0) await shot(p, 'roll');
        done.roll++;
        return true;
      }
      if (v.stage === 'main' && done.end < 4 && !v.offers.length && v.turnN > 3) {
        // The trade buttons sit right beside your cards.
        const hand = await p.locator('.ip-hand').boundingBox();
        const trade = await p.getByTestId('trade').boundingBox();
        expect(trade!.x - (hand!.x + hand!.width)).toBeLessThan(40);
        expect(trade!.x).toBeGreaterThan(hand!.x);
        done.beside++;
        if (done.end === 0) await shot(p, 'main');
        await p.getByTestId('end').click();
        await p.getByTestId('ask-yes').click();
        await expect.poll(async () => (await view(p)).turn).not.toBe(v.me);
        done.end++;
        return true;
      }
      if (++checks % 25 === 0) await checkScreen(p);
      return false;
    };
    await playUntil(t, async () => (await view(a)).phase === 'over', {
      maxSteps: 30000,
      beforeStep,
      log: () => server.output,
    });
    expect(done.roll).toBeGreaterThanOrEqual(3);
    expect(done.end).toBeGreaterThanOrEqual(2);
    expect(done.bubbles).toBeGreaterThanOrEqual(1);
    expect(done.dealt).toBeGreaterThanOrEqual(1);

    /* ---------- The end ---------- */
    for (const p of t.pages) await expect(p.getByTestId('game-over')).toBeVisible();
    await shot(c, 'over');
    await pick(a, 'new', 'standard');
    await expect(a.getByTestId('isle-play')).toHaveCount(0);
    await expect(a.getByTestId('turnchip')).toBeVisible();
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
