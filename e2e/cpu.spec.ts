/*
 * Two people and a CPU player play a complete game against the real server build:
 * - a CPU is added in the lobby (gray by default), renamed and recoloured by the other person;
 * - the CPU moves on its own on the server (its pause is shortened for the test);
 * - a person offers the CPU a trade through the trade sheet, and the CPU declines it;
 * - the people's moves are made by each browser's bot; every frame is checked for leaks.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, playUntil, seatedTable, view } from './table';

test('two people and a CPU play a full game', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'cpu passphrase', { CPU_DELAY_MS: '40' });
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob']);
    const [a, b] = t.pages as [Page, Page];

    await a.click('[data-testid=add-cpu]');
    await expect(b.getByTestId('cpu-seat')).toHaveCount(1);
    await expect(b.getByTestId('cpu-color')).toHaveValue('gray');
    await b.getByTestId('cpu-nick').fill('Turnip');
    await b.getByTestId('cpu-nick').press('Enter');
    await b.getByTestId('cpu-color').selectOption('purple');
    await expect(a.getByTestId('cpu-nick')).toHaveValue('Turnip');
    await expect(a.getByTestId('cpu-color')).toHaveValue('purple');
    await a.click('[data-testid=start]');
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    const v0 = await view(a);
    const cpu = v0.players.findIndex((p: { cpu?: boolean }) => p.cpu);
    expect(v0.players[cpu].nick).toBe('Turnip');
    expect(v0.players[cpu].color).toBe('purple');
    await expect(a.locator('.player', { hasText: 'Turnip' }).getByText('CPU')).toBeVisible();
    // CPU chatter switched off from table talk, for everyone; then back on.
    await a.getByTestId('talk-cpuchat').click();
    await expect(b.getByTestId('talk-cpuchat')).toHaveText('CPU chat off');
    await b.getByTestId('talk-cpuchat').click();
    await expect(a.getByTestId('talk-cpuchat')).toHaveText('CPU chat on');

    // Once, on a person's turn with a card to spare, offer the CPU a trade by clicking.
    let offered = false;
    const offer = async (p: Page): Promise<boolean> => {
      if (offered) return false;
      const v = await view(p);
      if (v?.stage !== 'main' || v.turn !== v.me || !v.hand) return false;
      const give = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as const).find((r) => v.hand.res[r] > 0);
      if (!give) return false;
      const want = give === 'ore' ? 'wood' : 'ore';
      await p.getByTestId('trade').click();
      await p.click(`[aria-label="More give ${give}"]`);
      await p.click(`[aria-label="More want ${want}"]`);
      await p.locator('.sheet .foot .btn.primary').click();
      // The CPU says no on its own.
      await expect.poll(async () => (await view(p)).offers[0]?.resp?.[cpu]).toBe(0);
      offered = true;
      return true;
    };

    await playUntil(t, async () => (await view(a)).phase === 'over', {
      maxSteps: 30000,
      beforeStep: offer,
      log: () => server.output,
    });
    for (const p of t.pages) await expect(p.getByTestId('game-over')).toBeVisible();
    const final = await view(a);
    console.log(
      `CPU game over after ${final.seq} moves, ${final.turnN} turns; winner ${final.players[final.winner].nick}; offer declined: ${offered}`,
    );
    expect(offered).toBe(true);
    expect(server.output).not.toMatch(/CPU .* move rejected/);
    // The CPU never offered a trade, never accepted one.
    for (const f of t.frames[0]!)
      for (const it of f.log ?? []) {
        const e = it.e as { k: string; offer?: { from: number }; p?: number; yes?: boolean } | undefined;
        if (it.k !== 'ev' || !e) continue;
        if (e.k === 'offer') expect(e.offer!.from).not.toBe(cpu);
        if (e.k === 'respond' && e.p === cpu) expect(e.yes).toBe(false);
      }
    checkFrames(
      t,
      (await Promise.all(t.pages.map(view))).map((f) => f.me),
    );
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
