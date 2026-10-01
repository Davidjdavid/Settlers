/*
 * Three browsers play a complete game against the real server build:
 * - lobby, setup placement, rolling and ending a turn are done by clicking the UI;
 * - the rest of the game is played by each browser's bot, which sees only that browser's view
 *   and sends moves over the normal WebSocket connection;
 * - mid-game, one player reloads the page, and the server is killed and restarted;
 * - every WebSocket frame each browser receives is checked for hidden information.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';

interface Frame {
  t: string;
  game?: { me: number | null; seq: number; players: Record<string, unknown>[]; hand: unknown } | null;
  log?: { k: string; e?: { k: string; p?: number; from?: number; r?: unknown; card?: unknown } }[];
}

test('three players play a full game, surviving a reload and a server crash', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'test passphrase');
  await server.start();
  const frames: Frame[][] = [[], [], []];
  const pages: Page[] = [];
  const errors: string[] = [];

  try {
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`page ${i}: ${e.message}`));
      page.on('websocket', (ws) =>
        ws.on('framereceived', (f) => frames[i]!.push(JSON.parse(String(f.payload)))),
      );
      pages.push(page);
    }
    const [a, b, c] = pages as [Page, Page, Page];

    // Log in. A wrong passphrase is refused first.
    await a.goto(server.url);
    await a.fill('#pass', 'wrong');
    await a.click('button:has-text("Enter")');
    await expect(a.getByText('That passphrase isn’t right')).toBeVisible();
    for (const p of pages) {
      if (p !== a) await p.goto(server.url);
      await p.fill('#pass', 'test passphrase');
      await p.click('button:has-text("Enter")');
    }

    // Lobby: A creates a room, B and C join by link.
    await a.click('[data-testid=create]');
    const code = (await a.getByTestId('room-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    const nicks = ['Ann', 'Bob', 'Cat'];
    await a.fill('[data-testid=nick]', nicks[0]!);
    await a.click('[data-testid=sit]');
    for (const [i, p] of [b, c].entries()) {
      await p.goto(`${server.url}/r/${code}`);
      await p.fill('[data-testid=nick]', nicks[i + 1]!);
      await p.click('[data-testid=sit]');
    }
    await expect(a.locator('.seat:not(.open)')).toHaveCount(3);
    await a.click('[data-testid=start]');
    for (const p of pages) await expect(p.locator('#board')).toBeVisible();

    const view = (p: Page) => p.evaluate(() => (window as any).__settlers.state().game);
    const turnPage = async () => {
      const v = await view(a);
      for (const p of pages) if ((await view(p)).me === v.turn) return p;
      throw new Error('no page for current turn');
    };

    // The first setup placement is made by clicking the board.
    const first = await turnPage();
    await first.locator('#board [data-v]').first().click();
    await first.locator('#board [data-e]').first().click();
    await expect.poll(async () => (await view(a)).seq).toBe(1);

    // Bots play until `until` is true; fails if nothing moves for a while.
    const playUntil = async (until: () => Promise<boolean>, maxSteps = 5000) => {
      let idle = 0;
      for (let step = 0; step < maxSteps; step++) {
        if (await until()) return;
        let moved = false;
        for (const p of pages) {
          const r: string = await p.evaluate(() => (window as any).__settlers.botStep());
          if (r.startsWith('rejected')) throw new Error(`bot move ${r}`);
          if (r !== 'idle' && r !== 'busy') moved = true;
        }
        idle = moved ? 0 : idle + 1;
        if (idle > 200)
          throw new Error(`game stuck: ${JSON.stringify((await view(a)).stage)}\n${server.output}`);
        if (!moved) await a.waitForTimeout(20);
      }
      throw new Error('too many steps');
    };

    await playUntil(async () => (await view(a)).stage !== 'setup');

    // Roll and end a turn by clicking the real buttons; the dice animate.
    let p = await turnPage();
    await p.getByTestId('roll').click();
    await expect(p.locator('[data-testid=dice] .die')).toHaveCount(2);
    await playUntil(async () => (await view(a)).stage === 'main');
    p = await turnPage();
    await p.getByTestId('end').click();
    await expect.poll(async () => (await view(a)).stage).toBe('preroll');

    // Play a while, then B reloads the page and must land back in the same seat.
    await playUntil(async () => (await view(a)).turnN >= 12);
    const bSeat = (await view(b)).me;
    await b.reload();
    await expect(b.locator('#board')).toBeVisible();
    await expect.poll(async () => (await view(b))?.me).toBe(bSeat);
    await expect(b.getByTestId('hand')).toBeVisible();

    // Play on, then crash the server and restart it. Nothing may be lost.
    await playUntil(async () => (await view(a)).turnN >= 30);
    const seqBefore = (await view(a)).seq;
    await server.crash();
    for (const pg of pages) await expect(pg.getByTestId('offline')).toBeVisible();
    await server.start();
    for (const pg of pages) await expect(pg.getByTestId('offline')).toBeHidden({ timeout: 15000 });
    await expect.poll(async () => (await view(a)).seq).toBeGreaterThanOrEqual(seqBefore);
    for (const pg of pages) expect((await view(pg)).me).not.toBeNull();

    // Finish the game.
    await playUntil(async () => (await view(a)).phase === 'over', 20000);
    for (const pg of pages) await expect(pg.getByTestId('game-over')).toBeVisible();

    // Everyone agrees on the outcome and the board.
    const finals = await Promise.all(pages.map(view));
    for (const f of finals) {
      expect(f.winner).toBe(finals[0].winner);
      expect(f.seq).toBe(finals[0].seq);
      expect(JSON.stringify(f.verts)).toBe(JSON.stringify(finals[0].verts));
      expect(JSON.stringify(f.edges)).toBe(JSON.stringify(finals[0].edges));
    }
    console.log(
      `game over after ${finals[0].seq} moves, ${finals[0].turnN} turns; winner seat ${finals[0].winner}`,
    );

    // Hidden information: check every frame each browser received.
    for (let i = 0; i < 3; i++) {
      const seat = finals[i].me;
      for (const f of frames[i]!) {
        const raw = JSON.stringify(f);
        expect(raw).not.toContain('"rng"');
        expect(raw).not.toContain('"seed"');
        expect(raw).not.toContain('"deck"');
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
      expect(frames[i]!.length).toBeGreaterThan(100);
    }
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
