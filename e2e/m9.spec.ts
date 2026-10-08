/*
 * Milestone 9b in three browsers against the real server build: a laptop, a tablet and a phone.
 * - Sounds (SPEC 9.4): Ann turns the dice sound off and changes another's volume and style on
 *   the Sounds page; it's saved on her profile and nobody else's sounds change. Through a full
 *   Knights game every browser plays the sounds for what happens (Ann never the dice), table
 *   talk ticks for everyone but the sender, and the winner's fanfare plays.
 * - Pinned dice (9.5): pinned from the dice sheet, dragged to another corner, shrunk to a strip,
 *   still there after a reload and through the whole game, its chart counting every roll; on the
 *   phone a strip above the hand.
 * SHOTS=<dir> saves screenshots.
 */

import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, playUntil, baseGame, sitAs, view, type Frame, type Table } from './table';

test.use({ actionTimeout: 15000 });
test.setTimeout(30 * 60 * 1000);

const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/m9-${name}.png` });
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hooks return plain JSON
const hook = (p: Page, f: string): Promise<any> => p.evaluate((f) => (window as any).__settlers[f](), f);
const sounds = (p: Page): Promise<string[]> => hook(p, 'sounds');
/** Every game event a browser was sent as news (updates; a sync resends the whole log). */
function eventsIn(frames: Frame[]): { k: string; at?: number; what?: string }[] {
  return frames.flatMap((f) => {
    const m = f as { t?: string; log?: { k: string; e?: { k: string; at?: number; what?: string } }[] };
    return m.t === 'update' ? (m.log ?? []).flatMap((x) => (x.k === 'ev' && x.e ? [x.e] : [])) : [];
  });
}
const settings = async (p: Page) => (await hook(p, 'state')).room.mySettings;

test('Milestone 9b: sounds with their own settings, and the dice pinned on screen', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'm9 passphrase');
  await server.start();
  const frames: Frame[][] = [[], [], []];
  const errors: string[] = [];
  const devices: BrowserContextOptions[] = [
    { viewport: { width: 1366, height: 768 } },
    { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  ];
  const names = ['Ann', 'Bob', 'Cat'];
  const open = async (i: number) => {
    const page = await (await browser.newContext(devices[i])).newPage();
    page.on('pageerror', (e) => errors.push(`${names[i]}: ${e.message}`));
    page.on('websocket', (ws) =>
      ws.on('framereceived', (f) => frames[i]!.push(JSON.parse(String(f.payload)))),
    );
    await page.goto(server.url);
    await page.fill('#pass', 'm9 passphrase');
    await page.click('button:has-text("Enter")');
    return page;
  };

  try {
    const pages = [await open(0), await open(1), await open(2)];
    const [a, b, c] = pages as [Page, Page, Page];
    await a.click('[data-testid=create]');
    const code = (await a.getByTestId('room-code').textContent())!.trim();
    await sitAs(a, 'Ann', 'red');
    await baseGame(a);
    await b.goto(`${server.url}/r/${code}`);
    await sitAs(b, 'Bob', 'blue');
    await c.goto(`${server.url}/r/${code}`);
    await sitAs(c, 'Cat', 'orange');
    await expect(a.locator('.seat:not(.open)')).toHaveCount(3);
    const t: Table = { pages, frames, errors, code };
    await a.click('[data-testid=mode-knights]');
    for (let i = 0; i < 5; i++) await a.click('[aria-label="Fewer points"]');
    await a.click('[data-testid=start]');
    for (const p of pages) await expect(p.locator('#board')).toBeVisible();
    const seats = [(await view(a)).me, (await view(b)).me, (await view(c)).me];
    // Pinned before anyone has rolled: the chart says so instead of showing an empty box.
    await b.getByTestId('open-dice').click();
    await b.getByTestId('dice-pin-on').click();
    await expect(b.getByTestId('dice-pin-none')).toHaveText('No rolls yet');
    await b.getByTestId('dice-pin-off').click();
    await expect(b.getByTestId('dice-pin')).toHaveCount(0);

    /* ---------- Ann's Sounds page ---------- */
    await a.getByRole('button', { name: 'Menu', exact: true }).click();
    await a.getByTestId('menu-settings').click();
    await a.getByTestId('sounds-open').click();
    await expect(a.getByTestId('sound-dice')).toBeVisible();
    await a.getByTestId('sound-dice-on').click();
    await a.getByTestId('sound-steal-vol').fill('30');
    await a.getByTestId('sound-road-style').selectOption('2');
    await a.getByTestId('sound-turn-play').click();
    await shot(a, 'sounds-page');
    await a.getByTestId('sounds-back').click();
    await expect
      .poll(async () => (await settings(a))?.sounds)
      .toEqual({ each: { dice: { on: false }, steal: { vol: 0.3 }, road: { style: 2 } } });
    // Nobody else's sounds changed.
    for (const p of [b, c]) expect((await settings(p))?.sounds).toBeUndefined();
    await a.keyboard.press('Escape');

    /* ---------- Pinned dice ---------- */
    // The dice sheet opens once there's a roll to show.
    await playUntil(t, async () => (await hook(a, 'state')).dice != null);
    const pin = async (p: Page) => {
      await p.getByTestId('open-dice').click();
      await p.getByTestId('dice-pin-on').click();
      await expect(p.getByTestId('dice-pin')).toBeVisible();
    };
    await pin(a);
    await expect(a.getByTestId('dice-pin')).toHaveAttribute('data-corner', 'tl');
    // Drag it to the bottom-right of the board.
    const board = (await a.locator('.board-wrap').boundingBox())!;
    const bar = (await a.locator('.dicepin .pinbar .t').boundingBox())!;
    await a.mouse.move(bar.x + 4, bar.y + 4);
    await a.mouse.down();
    await a.mouse.move(board.x + board.width - 120, board.y + board.height - 60, { steps: 8 });
    await a.mouse.up();
    await expect(a.getByTestId('dice-pin')).toHaveAttribute('data-corner', 'br');
    await a.getByTestId('dice-pin-size').click();
    await expect(a.getByTestId('dice-pin')).toHaveClass(/small/);
    await expect.poll(async () => (await settings(a))?.dicePin).toEqual({ corner: 'br', small: true });
    // The phone: a strip above the hand.
    await pin(c);
    await expect(c.getByTestId('dice-pin')).toHaveAttribute('data-corner', 'phone');
    expect(await c.locator('.dock-wrap [data-testid=dice-pin]').count()).toBe(1);
    // A reload keeps it where it was.
    await a.reload();
    await expect(a.getByTestId('dice-pin')).toHaveAttribute('data-corner', 'br');
    await expect(a.getByTestId('dice-pin')).toHaveClass(/small/);
    await a.getByTestId('dice-pin-size').click();
    await expect(a.getByTestId('dice-pin')).not.toHaveClass(/small/);
    // Bob has nothing pinned.
    await expect(b.getByTestId('dice-pin')).toHaveCount(0);

    /* ---------- Table talk ---------- */
    await b.locator('.chatform input').fill('Good luck everyone');
    await b.locator('.chatform button').click();
    await expect.poll(async () => (await sounds(a)).includes('chat')).toBe(true);
    await expect.poll(async () => (await sounds(c)).includes('chat')).toBe(true);
    expect(await sounds(b)).not.toContain('chat');

    /* ---------- A whole game ---------- */
    let checkedPin = 0;
    await playUntil(t, async () => (await view(a)).phase === 'over', {
      maxSteps: 20000,
      beforeStep: async (p) => {
        // Now and then: the pin is still in its corner, counting every roll.
        if (p === a && checkedPin < 6 && Math.random() < 0.02) {
          checkedPin++;
          await expect(a.getByTestId('dice-pin')).toHaveAttribute('data-corner', 'br');
        }
        return false;
      },
    });
    await shot(a, 'pin-laptop');
    await shot(c, 'pin-phone');
    const dice = (await hook(a, 'state')).dice;
    const shown = await a
      .locator('.dicepin .minichart g[data-total]')
      .evaluateAll((gs) => gs.reduce((n, g) => n + Number((g as HTMLElement).dataset.n), 0));
    expect(shown).toBe(dice.dice.reduce((x: number, y: number) => x + y, 0));
    await expect(c.getByTestId('dice-pin')).toBeVisible();

    // Sounds: each browser played what happened, by its own switches.
    const heard = await Promise.all(pages.map(sounds));
    // A city or wall built after setup (setup's city sounds like a settlement): a short random
    // game can end without one.
    const builtCity = frames[0]!.some((f) => /"what":"city"|"k":"wall"/.test(JSON.stringify(f)));
    // Every game has setup's cards and settlements (a setup placement sounds like a settlement);
    // the rest only if they happened (a short Knights game can end before the barbarians first
    // attack, so with no robber, or be won on cities and cards without another road: CI saw one):
    // each sound played if and only if its event reached that browser.
    const SOUND_OF: Record<string, (e: { k: string; at?: number; what?: string }) => boolean> = {
      road: (e) => e.k === 'build' && (e.what === 'road' || e.what === 'ship'),
      robber: (e) => e.k === 'robber' || e.k === 'pirate',
      buyCard: (e) => ['buyDev', 'draw', 'treasureDev'].includes(e.k),
      knight: (e) => ['knight', 'activate', 'activateAll', 'promote'].includes(e.k),
      barbarians: (e) => e.k === 'barbarians' && (e.at ?? 7) < 7,
    };
    for (const [i, h] of heard.entries()) {
      for (const id of ['cards', 'settlement']) expect(h, `${names[i]}: ${id}`).toContain(id);
      const evs = eventsIn(frames[i]!);
      for (const [id, of] of Object.entries(SOUND_OF)) {
        if (evs.some(of)) expect(h, `${names[i]}: ${id}`).toContain(id);
        else expect(h, `${names[i]}: no ${id} event, no ${id} sound`).not.toContain(id);
      }
      if (builtCity) expect(h, `${names[i]}: city`).toContain('city');
      else expect(h, `${names[i]}: no city built, no city sound`).not.toContain('city');
    }
    expect(heard[0]).not.toContain('dice');
    expect(heard[1]).toContain('dice');
    expect(heard[2]).toContain('dice');
    for (const h of heard) expect(h.some((x) => ['horn', 'sad', 'defended'].includes(x))).toBe(true);
    for (const h of heard) expect(h).toContain('fanfare');

    checkFrames(t, seats, 100);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
