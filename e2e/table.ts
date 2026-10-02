/* Shared steps for end-to-end tests: browsers, login, a seated room, bot play, frame checks. */

import { expect, type Browser, type Page } from '@playwright/test';
import type { TestServer } from './server';

export interface Frame {
  t: string;
  game?: { me: number | null; seq: number; players: Record<string, unknown>[]; hand: unknown } | null;
  log?: { k: string; e?: { k: string; p?: number; from?: number; r?: unknown; card?: unknown } }[];
}

export interface Table {
  pages: Page[];
  frames: Frame[][];
  errors: string[];
  code: string;
}

/**
 * Sit down as a profile (SPEC 5.1): pick the name from the list, or make it first. With `color`,
 * that colour is picked; otherwise the profile's favourite (or the first free one).
 */
export async function sitAs(page: Page, name: string, color?: string) {
  const existing = page.locator(`[data-testid=profile][data-name="${name}"]`);
  await page.getByTestId('profiles').waitFor();
  if (!(await existing.count())) {
    await page.getByTestId('new-profile').click();
    await page.getByTestId('new-name').fill(name);
    if (color) await page.getByTestId('new-color').selectOption(color);
    await page.getByTestId('new-save').click();
    await expect(existing).toHaveCount(1);
  }
  if ((await existing.getAttribute('aria-pressed')) !== 'true') await existing.click();
  await expect(existing).toHaveAttribute('aria-pressed', 'true');
  if (color) await page.click(`.colorbtn[data-color=${color}]`);
  await page.click('[data-testid=sit]');
  await expect(page.locator('[data-testid=sit]')).toHaveCount(0);
}

/** Open n browsers, log in, create a room and seat everyone. */
export async function seatedTable(browser: Browser, server: TestServer, nicks: string[]): Promise<Table> {
  const frames: Frame[][] = nicks.map(() => []);
  const errors: string[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < nicks.length; i++) {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => errors.push(`page ${i}: ${e.message}`));
    page.on('websocket', (ws) =>
      ws.on('framereceived', (f) => frames[i]!.push(JSON.parse(String(f.payload)))),
    );
    await page.goto(server.url);
    await page.fill('#pass', server.passphrase);
    await page.click('button:has-text("Enter")');
    pages.push(page);
  }
  const host = pages[0]!;
  await host.click('[data-testid=create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  await sitAs(host, nicks[0]!);
  for (let i = 1; i < pages.length; i++) {
    await pages[i]!.goto(`${server.url}/r/${code}`);
    await sitAs(pages[i]!, nicks[i]!);
  }
  await expect(host.locator('.seat:not(.open)')).toHaveCount(nicks.length);
  return { pages, frames, errors, code };
}

// The page's own game view (what the server sent this browser).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
export const view = (p: Page): Promise<any> => p.evaluate(() => (window as any).__settlers.state().game);

/** Press Confirm if a placement is waiting for it (on by default, SPEC 4.3). */
export async function confirmPlace(p: Page) {
  const btn = p.getByTestId('confirm-place');
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

/** The page whose turn it is. */
export async function turnPage(t: Table): Promise<Page> {
  const v = await view(t.pages[0]!);
  for (const p of t.pages) if ((await view(p)).me === v.turn) return p;
  throw new Error('no page for the current turn');
}

/**
 * Let each browser's bot play until `until` is true. `beforeStep` can drive some moves through
 * the real UI instead (return true if it did something).
 */
export async function playUntil(
  t: Table,
  until: () => Promise<boolean>,
  opts: { maxSteps?: number; beforeStep?: (p: Page) => Promise<boolean>; log?: () => string } = {},
) {
  let idle = 0;
  for (let step = 0; step < (opts.maxSteps ?? 5000); step++) {
    if (await until()) return;
    let moved = false;
    for (const p of t.pages) {
      if (opts.beforeStep && (await opts.beforeStep(p))) {
        moved = true;
        continue;
      }
      const r: string = await p.evaluate(() => (window as any).__settlers.botStep());
      if (r.startsWith('rejected')) throw new Error(`bot move ${r}`);
      if (r !== 'idle' && r !== 'busy') moved = true;
    }
    idle = moved ? 0 : idle + 1;
    if (idle > 200)
      throw new Error(`game stuck at ${(await view(t.pages[0]!)).stage}\n${opts.log?.() ?? ''}`);
    if (!moved) await t.pages[0]!.waitForTimeout(20);
  }
  throw new Error('too many steps');
}

/** No frame any browser received may contain another seat's secrets. */
export function checkFrames(t: Table, seats: (number | null)[], minFrames = 100) {
  t.frames.forEach((frames, i) => {
    const seat = seats[i];
    for (const f of frames) {
      const raw = JSON.stringify(f);
      expect(raw).not.toContain('"rng"');
      // The table's board seed is public (docs/pregame.md 1.1); nothing in a game may carry one.
      if (f.game) expect(raw).not.toContain('"seed"');
      expect(raw).not.toContain('"deck"');
      expect(raw).not.toMatch(/"fog":\{/);
      if (f.game) {
        expect(f.game.me).toBe(seat);
        for (const pl of f.game.players) expect(Object.keys(pl)).not.toContain('res');
      }
      for (const it of f.log ?? []) {
        if (it.k !== 'ev' || !it.e) continue;
        if (it.e.k === 'steal' && it.e.p !== seat && it.e.from !== seat) expect(it.e.r).toBeNull();
        if (it.e.k === 'buyDev' && it.e.p !== seat) expect(it.e.card).toBeNull();
      }
    }
    expect(frames.length).toBeGreaterThan(minFrames);
  });
}
