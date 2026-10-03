/*
 * Milestone 5 in three browsers against the real server build: a laptop, a tablet and a phone
 * (both touch screens; the phone with reduced motion on).
 * - Profiles: each person makes theirs in the lobby.
 * - Undo by clicking: approved by everyone, and denied by one "no".
 * - Zoom: zoomed in, a tap lands exactly where it's aimed (the ghost appears on that corner).
 * - Dice: rolled by clicking the dice or the button (the same thing), every screen tumbles and
 *   lands on the server's numbers, the dice sound plays for everyone with game sounds on.
 * - The turn sound plays only for the player who needs to act, and only with the setting on.
 * - Scores: every breakdown adds up to the score; pieces left match the game.
 * - Display sizes on every device: nothing overlaps the edges or needs sideways scrolling.
 * - Save and quit, then Resume: everyone back in their seat, the game exactly as it was.
 * - The end: confetti (a calm banner with reduced motion), the end-screen stats, the Stats page.
 */

import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { baseGame, sitAs, view, type Frame } from './table';

test.use({ actionTimeout: 15000 });
test.setTimeout(20 * 60 * 1000);

const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/m5-${name}.png`, fullPage: true });
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hooks return plain JSON
const hook = (p: Page, f: string, ...args: unknown[]): Promise<any> =>
  p.evaluate(([f, args]) => (window as any).__settlers[f as string](...(args as unknown[])), [
    f,
    args,
  ] as const);
const sounds = (p: Page): Promise<string[]> => hook(p, 'sounds');

test('three people play a whole game with the Milestone 5 features', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'm5 passphrase');
  await server.start();
  const frames: Frame[][] = [[], [], []];
  const errors: string[] = [];
  const devices: Record<string, BrowserContextOptions> = {
    laptop: { viewport: { width: 1366, height: 820 } },
    tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
    phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' },
  };
  const names = ['Ann', 'Bob', 'Cat'];
  const kinds = ['laptop', 'tablet', 'phone'];
  const touch = new Set<Page>();

  const open = async (i: number) => {
    const ctx = await browser.newContext(devices[kinds[i]!]);
    const page = await ctx.newPage();
    if (devices[kinds[i]!]!.hasTouch) touch.add(page);
    page.on('pageerror', (e) => errors.push(`${kinds[i]}: ${e.message}`));
    page.on('websocket', (ws) =>
      ws.on('framereceived', (f) => frames[i]!.push(JSON.parse(String(f.payload)))),
    );
    await page.goto(server.url);
    await page.fill('#pass', 'm5 passphrase');
    await page.click('button:has-text("Enter")');
    return page;
  };

  try {
    const pages = [await open(0), await open(1), await open(2)];
    const [a, b, c] = pages as [Page, Page, Page];

    /* ---------- Profiles and the lobby ---------- */
    await a.click('[data-testid=create]');
    const code = (await a.getByTestId('room-code').textContent())!.trim();
    await sitAs(a, 'Ann', 'red');
    await baseGame(a);
    for (const i of [1, 2]) {
      await pages[i]!.goto(`${server.url}/r/${code}`);
      await sitAs(pages[i]!, names[i]!, ['red', 'blue', 'yellow'][i]);
    }
    await expect(a.locator('.seat:not(.open)')).toHaveCount(3);
    // A short game: 6 points.
    for (let i = 0; i < 4; i++) await a.click('[aria-label="Fewer points"]');
    await expect(c.getByTestId('win-vp')).toHaveText('6');
    await a.click('[data-testid=start]');
    for (const p of pages) await expect(p.locator('#board')).toBeVisible();

    const seatOf = async (p: Page): Promise<number> => (await view(p)).me;
    const pageOf = async (seat: number) => {
      for (const p of pages) if ((await seatOf(p)) === seat) return p;
      throw new Error(`no page for seat ${seat}`);
    };
    const turnPage = async () => pageOf((await view(pages[0]!)).turn);
    const hit = (p: Page, sel: string) =>
      touch.has(p) ? p.locator(sel).first().tap() : p.locator(sel).first().click();
    const openMenu = (p: Page) => p.getByRole('button', { name: 'Menu', exact: true }).click();

    /* ---------- Bob turns his sounds off ---------- */
    await openMenu(b);
    await b.getByTestId('menu-settings').click();
    await b.getByTestId('setting-turnSound').click();
    await b.getByTestId('setting-gameSounds').click();
    await expect
      .poll(async () => (await hook(b, 'state')).room.mySettings)
      .toMatchObject({ turnSound: false, gameSounds: false });
    await b.getByTestId('settings-close').click();

    /* ---------- Zoom: a tap lands where it's aimed ---------- */
    const p0 = await turnPage();
    await p0.getByTestId('zoom-in').click();
    await p0.getByTestId('zoom-in').click();
    await expect(p0.locator('#board')).toHaveAttribute('data-zoom', '1.96');
    // A corner that's on screen while zoomed in.
    const visible = await p0.evaluate(() => {
      const box = document.querySelector('#board')!.getBoundingClientRect();
      const all = [...document.querySelectorAll('#board [data-v]')];
      return all.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left > box.left + 20 &&
          r.right < box.right - 60 &&
          r.top > box.top + 20 &&
          r.bottom < box.bottom - 20
        );
      });
    });
    expect(visible).toBeGreaterThanOrEqual(0);
    const corner = p0.locator('#board [data-v]').nth(visible);
    const v = await corner.getAttribute('data-v');
    await (touch.has(p0) ? corner.tap() : corner.click());
    await expect(p0.locator(`#board .ghost[data-ghost-at="${v}"]`)).toHaveCount(1);
    await shot(p0, 'zoomed-ghost');
    await p0.getByTestId('zoom-fit').click();
    await expect(p0.locator('#board')).toHaveAttribute('data-zoom', '1.00');

    /* ---------- Undo by clicking: approved, then denied ---------- */
    const placeByHand = async (p: Page) => {
      const seq = (await view(p)).seq;
      await hit(p, '#board [data-v]');
      await hit(p, '#board [data-e]');
      await hit(p, '[data-testid=confirm-place]');
      await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(seq);
    };
    // p0 already has a corner picked; pick an edge and confirm.
    await hit(p0, '#board [data-e]');
    await hit(p0, '[data-testid=confirm-place]');
    await expect.poll(async () => (await view(p0)).verts.filter((x: unknown) => x).length).toBe(1);
    await hit(p0, '[data-testid=undo]');
    const others = pages.filter((p) => p !== p0);
    for (const o of others) {
      await expect(o.getByTestId('undo-banner')).toBeVisible();
      await hit(o, '[data-testid=undo-yes]');
    }
    await expect.poll(async () => (await view(p0)).verts.filter((x: unknown) => x).length).toBe(0);
    await placeByHand(p0);
    await hit(p0, '[data-testid=undo]');
    await expect(others[0]!.getByTestId('undo-banner')).toBeVisible();
    await hit(others[0]!, '[data-testid=undo-no]');
    await expect.poll(async () => (await view(p0)).undo ?? null).toBeNull();
    expect((await view(p0)).verts.filter((x: unknown) => x).length).toBe(1);

    /* ---------- Play: rolls and turn ends by hand, the rest by each browser's bot ---------- */
    let rolls = 0;
    let checkedTurnSound = 0;
    const roll = async (p: Page) => {
      const before = await Promise.all(pages.map(sounds));
      const seq = (await view(p)).seq;
      // Alternate: the dice themselves, then the Roll dice button. Both roll the same way.
      if (rolls % 2 === 0) await hit(p, '[data-roll=dice]');
      else await hit(p, '[data-testid=roll]');
      // The roller's dice tumble at once (no tumble with reduced motion).
      if (!touch.has(p) || p !== c)
        await expect(p.getByTestId('dice')).toHaveAttribute('data-state', /tumbling|still/);
      await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(seq);
      const dice = (await view(p)).dice as [number, number];
      // Every screen lands on the server's numbers.
      for (const q of pages) {
        const d = q.getByTestId('dice');
        await expect(d).toHaveAttribute('data-state', 'still');
        await expect(d).toHaveAttribute('data-faces', dice.join(','));
        await expect(d.locator('.die').nth(0)).toHaveAttribute('data-face', String(dice[0]));
        await expect(d.locator('.die').nth(1)).toHaveAttribute('data-face', String(dice[1]));
      }
      // The dice sound for everyone with game sounds on; Bob has them off.
      for (const [i, q] of pages.entries()) {
        const n =
          (await sounds(q)).filter((x) => x === 'dice').length -
          before[i]!.filter((x) => x === 'dice').length;
        expect(n, `${names[i]} dice sound`).toBe(q === b ? 0 : 1);
      }
      rolls++;
    };
    const end = async (p: Page) => {
      const before = await Promise.all(pages.map(sounds));
      const seq = (await view(p)).seq;
      await p.getByTestId('end').click();
      await p.getByTestId('ask-yes').click();
      await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(seq);
      // The turn sound: only the next player, and only if their setting is on.
      const next = await turnPage();
      await p.waitForTimeout(300);
      for (const [i, q] of pages.entries()) {
        const n =
          (await sounds(q)).filter((x) => x === 'turn').length -
          before[i]!.filter((x) => x === 'turn').length;
        const v = await view(q);
        const waiting = v.offers.length || v.stage !== 'preroll';
        if (waiting) continue; // someone else's offer or a discard could also call for them
        expect(n, `${names[i]} turn sound`).toBe(q === next && q !== b ? 1 : 0);
      }
      checkedTurnSound++;
    };
    /** Breakdowns add up to scores, and pieces left match the game, on every screen. */
    const checkScores = async () => {
      for (const q of pages) {
        const v = await view(q);
        for (let i = 0; i < v.players.length; i++) {
          const score = q.getByTestId(`score-${i}`);
          const shown = Number(await score.getAttribute('data-score'));
          await score.click();
          const text = (await q.getByTestId(`breakdown-${i}`).textContent())!;
          const [total, rest] = text.split(' = ');
          expect(Number(total)).toBe(shown);
          const parts = (rest ?? '').split(' + ').map((x) => Number(/\((\d+)\)/.exec(x)?.[1] ?? 0));
          expect(parts.reduce((x, y) => x + y, 0)).toBe(shown);
          await score.click();
          const pieces = q.getByTestId(`pieces-${i}`);
          for (const k of ['road', 'settlement', 'city'])
            expect(Number(await pieces.locator(`[data-kind=${k}]`).getAttribute('data-n'))).toBe(
              Math.max(0, v.players[i].pieces[k]),
            );
        }
      }
    };
    /** Every display size on every device: no sideways scrolling, nothing cut off. */
    const checkSizes = async () => {
      for (const [i, q] of pages.entries()) {
        for (const size of ['small', 'medium', 'large', 'xl']) {
          await openMenu(q);
          await q.getByTestId('menu-settings').click();
          await q.getByTestId(`size-${size}`).click();
          await q.getByTestId('settings-close').click();
          const bad = await q.evaluate(() => {
            const out: string[] = [];
            const root = document.documentElement;
            if (root.scrollWidth > root.clientWidth + 1)
              out.push(`page ${root.scrollWidth} > ${root.clientWidth}`);
            const vw = root.clientWidth;
            for (const sel of ['.top', '.prompt', '.tray', '.side', '#board']) {
              const el = document.querySelector(sel);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              if (r.right > innerWidth + 1) out.push(`${sel} right ${r.right} > ${innerWidth}`);
              if (r.left < -1) out.push(`${sel} left ${r.left}`);
            }
            // Text that overflows its own box (cut off).
            for (const el of document.querySelectorAll(
              '.btn, .prompt strong, .player .nm, .eyebrow, .turnchip .label, .roomchip',
            )) {
              const e = el as HTMLElement;
              if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === 'hidden')
                out.push(`cut: ${e.textContent}`);
            }
            return out;
          });
          expect(bad, `${kinds[i]} at ${size}`).toEqual([]);
          await shot(q, `${kinds[i]}-${size}`);
        }
        await openMenu(q);
        await q.getByTestId('menu-settings').click();
        await q.getByTestId('size-medium').click();
        await q.getByTestId('settings-close').click();
      }
    };

    const play = async (until: () => Promise<boolean>) => {
      let idle = 0;
      for (let step = 0; step < 20000; step++) {
        if (await until()) return;
        let moved = false;
        for (const p of pages) {
          const r: string = await hook(p, 'botStep', ['roll', 'end']);
          if (r.startsWith('rejected')) throw new Error(`bot move ${r}`);
          if (r === 'skip:roll') await roll(p);
          else if (r === 'skip:end') await end(p);
          if (r !== 'idle' && r !== 'busy') moved = true;
        }
        idle = moved ? 0 : idle + 1;
        if (idle > 300) throw new Error(`stuck at ${(await view(a)).stage}`);
        if (!moved) await a.waitForTimeout(20);
      }
      throw new Error('too many steps');
    };

    await play(async () => (await view(a)).turnN >= 6);
    await checkScores();
    await checkSizes();
    await shot(a, 'laptop-midgame');
    await shot(c, 'phone-midgame');

    /* ---------- Save and quit, then Resume ---------- */
    const before = await view(a);
    const seats = await Promise.all(pages.map(seatOf));
    await openMenu(a);
    await a.getByTestId('menu-quit').click();
    await a.locator('.sheet .foot .btn.primary').click(); // Continue
    await a.locator('.sheet .foot .btn.primary').click(); // Ask everyone
    await expect(b.getByTestId('reset-banner')).toContainText('save the game');
    await a.getByTestId('reset-confirm').click();
    for (const p of pages) await expect(p.getByTestId('create')).toBeVisible();
    await expect(a.getByTestId('saved-game')).toHaveCount(1);
    await shot(a, 'saved-list');
    await a.getByTestId('resume').click();
    await expect(a.locator('#board')).toBeVisible();
    const newCode = /\/r\/([A-Z0-9]+)/.exec(a.url())![1]!;
    expect(newCode).not.toBe(code);
    for (const [i, p] of pages.entries()) {
      if (p !== a) await p.goto(`${server.url}/r/${newCode}`);
      await p.locator(`[data-testid=rejoin][data-name=${names[i]}]`).click();
      await expect.poll(() => seatOf(p)).toBe(seats[i]);
    }
    const after = await view(a);
    for (const k of ['seq', 'turn', 'stage', 'verts', 'edges', 'dice', 'hand', 'bank'])
      expect(after[k], k).toEqual(before[k]);

    /* ---------- To the end ---------- */
    await play(async () => (await view(a)).phase === 'over');
    for (const p of pages) await expect(p.getByTestId('celebration')).toBeVisible();
    await expect(c.getByTestId('celebration')).toHaveAttribute('data-calm', '1');
    await expect(c.getByTestId('confetti')).toHaveCount(0);
    await expect(a.getByTestId('confetti')).toHaveCount(1);
    await shot(a, 'celebration');
    for (const p of pages) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 10000 });
    await expect(a.getByTestId('game-stats')).toBeVisible();
    // The end-screen points are the final scores.
    const fin = await view(a);
    const shownPts = await a.getByTestId('final-points').locator('b').allTextContents();
    expect(shownPts.map(Number)).toEqual(
      fin.players.map((p: { publicVP: number; vpCards: number }) => p.publicVP + p.vpCards),
    );
    await shot(a, 'end-screen');
    expect(checkedTurnSound).toBeGreaterThan(3);
    expect(rolls).toBeGreaterThan(5);
    // Bob never heard a thing.
    expect((await sounds(b)).filter((x) => x === 'turn' || x === 'dice')).toEqual([]);

    /* ---------- The Stats page ---------- */
    await a.getByRole('button', { name: 'Look at the board' }).click();
    await a.getByRole('button', { name: 'Menu', exact: true }).click();
    await a.locator('.sheet .btn.ghost:has-text("Leave this room")').click();
    await a.getByTestId('open-stats').click();
    await a.locator('[data-testid=stats-who][data-name=Ann]').click();
    await expect(a.getByTestId('record')).toContainText(/Ann: [01] wins?/);
    await expect(a.getByTestId('past-game')).toHaveCount(1);
    await a.getByTestId('past-game').click();
    await expect(a.getByTestId('game-stats')).toBeVisible();
    await shot(a, 'stats-page');
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
