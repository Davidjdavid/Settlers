/*
 * Three browsers play a complete Cities & Knights game against the real server build:
 * - Cities & Knights is switched on in the lobby by clicking, and points to win lowered to 8
 *   to keep the test quick;
 * - the first starting settlement and road are placed by clicking; the second piece is a city;
 * - through the game, some moves are made through the real UI whenever they come up: building a
 *   knight, activating it from the knights sheet, buying an improvement, and answering choices
 *   (discards, Wedding, Saboteur, Aqueduct, decks, progress cards) in their sheets;
 * - everything else is played by each browser's bot, which sees only that browser's view;
 * - mid-game a player reloads; every WebSocket frame is checked for hidden information.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, confirmPlace, playUntil, seatedTable, turnPage, view, type Table } from './table';

test('three players play a full Cities & Knights game', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'ck passphrase');
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    const [a, b, c] = t.pages as [Page, Page, Page];

    await a.click('[data-testid=mode-knights]');
    await expect(b.getByTestId('mode-knights')).toHaveClass(/on/);
    await expect(c.getByTestId('win-vp')).toHaveText('13');
    for (let i = 0; i < 5; i++) await a.click('[aria-label="Fewer points"]');
    await expect(c.getByTestId('win-vp')).toHaveText('8');
    await a.click('[data-testid=start]');
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    const v0 = await view(a);
    expect(v0.rules.modules).toEqual(['citiesKnights']);
    expect(v0.winVP).toBe(8);
    await expect(a.getByTestId('barbarians')).toBeVisible();

    // The first starting settlement and road by clicking.
    const first = await turnPage(t);
    await first.locator('#board [data-v]').first().click();
    await first.locator('#board [data-e]').first().click();
    await confirmPlace(first);
    await expect.poll(async () => (await view(a)).seq).toBe(1);

    const ui = { knight: 0, activate: 0, improve: 0, owed: 0 };
    const clickVert = async (p: Page) => {
      await p.locator('#board [data-v]').first().click();
      await confirmPlace(p);
    };

    /** Make one move through the UI if one of the moves we drive by hand is available. */
    const byHand = async (p: Page): Promise<boolean> => {
      const v = await view(p);
      if (!v || v.phase !== 'play' || v.me == null) return false;
      // Choices owed: answer them in their sheet (or on the board).
      if (v.stage === 'ck') {
        const owe = v.ck.owe.find((o: { p: number }) => o.p === v.me);
        if (!owe || ui.owed >= 25) return false;
        const seq = v.seq;
        if (['loseCity', 'relocate', 'desert', 'deserterPlace'].includes(owe.k)) await clickVert(p);
        else if (owe.k === 'rebuild') {
          await p.locator('#board [data-e]').first().click();
          await confirmPlace(p);
        } else if (['give', 'discard', 'take'].includes(owe.k)) await fillCount(p);
        else if (owe.k === 'harbor') await p.locator('.sheet .foot button').first().click();
        else await p.locator('.sheet .pick:not([disabled])').first().click();
        await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(seq);
        ui.owed++;
        return true;
      }
      if (v.stage === 'discard' && v.discard?.[v.me] != null && ui.owed < 25) {
        const seq = v.seq;
        await fillCount(p);
        await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(seq);
        ui.owed++;
        return true;
      }
      if (v.turn !== v.me || v.stage !== 'main') return false;
      if (ui.knight < 3 && (await p.getByTestId('build-knight').isEnabled())) {
        await p.getByTestId('build-knight').click();
        await clickVert(p);
        await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(v.seq);
        ui.knight++;
        return true;
      }
      if (ui.activate < 3 && (await p.getByTestId('knights').isEnabled())) {
        await p.getByTestId('knights').click();
        await clickVert(p);
        const btn = p.getByTestId('k-activate');
        if (await btn.isEnabled()) {
          await btn.click();
          await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(v.seq);
          ui.activate++;
          return true;
        }
        await p.locator('.sheet .foot button').first().click();
      }
      const imp = p.locator('[data-testid^=improve-]:not([disabled])').first();
      if (ui.improve < 4 && (await imp.count())) {
        await imp.click();
        // Level 4 earns a metropolis: pick the city on the board.
        if ((await view(p)).seq === v.seq && (await p.locator('#board [data-v]').count())) await clickVert(p);
        await expect.poll(async () => (await view(p)).seq).toBeGreaterThan(v.seq);
        ui.improve++;
        return true;
      }
      return false;
    };

    await playUntil(t, async () => (await view(a)).turnN >= 20, { beforeStep: byHand });
    const bSeat = (await view(b)).me;
    await b.reload();
    await expect(b.locator('#board')).toBeVisible();
    await expect.poll(async () => (await view(b))?.me).toBe(bSeat);

    await playUntil(t, async () => (await view(a)).phase === 'over', {
      maxSteps: 40000,
      beforeStep: byHand,
      log: () => server.output,
    });
    for (const p of t.pages) await expect(p.getByTestId('game-over')).toBeVisible();

    const finals = await Promise.all(t.pages.map(view));
    for (const f of finals) {
      expect(f.winner).toBe(finals[0].winner);
      expect(f.seq).toBe(finals[0].seq);
      expect(JSON.stringify(f.ck.knights)).toBe(JSON.stringify(finals[0].ck.knights));
    }
    const ck = finals[0].ck;
    console.log(
      `Cities & Knights game over after ${finals[0].seq} moves, ${finals[0].turnN} turns; ${ck.attacks} barbarian attacks; ` +
        `levels ${JSON.stringify(ck.lvl)}; by UI: ${JSON.stringify(ui)}`,
    );
    expect(ui.knight).toBeGreaterThan(0);
    expect(ui.improve).toBeGreaterThan(0);
    checkFrames(
      t,
      finals.map((f) => f.me),
    );
    checkCKFrames(
      t,
      finals.map((f) => f.me),
    );
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

/** Pick the required number of cards in an open count sheet, then confirm. */
async function fillCount(p: Page) {
  const done = p.locator('.sheet .foot .btn.primary');
  await expect(done).toBeVisible();
  while (await done.isDisabled()) {
    const more = p.locator('.sheet .ctl button[aria-label^="More"]:not([disabled])').first();
    if (!(await more.count())) break;
    await more.click();
  }
  await done.click();
}

/** Cities & Knights secrets: other players' progress cards, deck order, revealed hands. */
function checkCKFrames(t: Table, seats: (number | null)[]) {
  t.frames.forEach((frames, i) => {
    const seat = seats[i];
    for (const f of frames) {
      const g = f.game as
        | (Record<string, unknown> & {
            ck?: { decks: unknown; hand: unknown; reveal: unknown; owe: { k: string; p: number }[] };
          })
        | null
        | undefined;
      if (g?.ck) {
        // Decks are sizes only; the reveal is only ever for your own Spy or Master Merchant.
        expect(typeof (g.ck.decks as Record<string, unknown>).trade).toBe('number');
        if (g.ck.reveal)
          expect(g.ck.owe.some((o) => o.p === seat && (o.k === 'spy' || o.k === 'take'))).toBe(true);
      }
      for (const it of f.log ?? []) {
        const e = it.e as
          | { k: string; p?: number; from?: number; to?: number; card?: string | null; cards?: unknown }
          | undefined;
        if (it.k !== 'ev' || !e) continue;
        if (e.k === 'draw' && e.p !== seat && e.card) expect(['printer', 'constitution']).toContain(e.card);
        if (e.k === 'give' && e.from !== seat && e.to !== seat) expect(e.cards).toBeNull();
        if (e.k === 'spy' && e.p !== seat && e.from !== seat) expect(e.card).toBeNull();
      }
    }
  });
}
