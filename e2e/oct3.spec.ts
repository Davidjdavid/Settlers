/*
 * 3 October: the new Seafarers maps in the lobby, and the dice deck (docs/rules/dice-deck.md)
 * picked in the lobby, played through the server (the log says when the deck is shuffled) and
 * switched mid-game from the table rules, where the cards left show.
 */

import { expect, test, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { confirmPlace, lobbyStep, playUntil, seatedTable, startGame, view } from './table';

const SHOTS = process.env.SHOTS;

test.use({ actionTimeout: 15_000 });
test.setTimeout(Number(process.env.T ?? 8 * 60_000));

test('new maps in the lobby, and a game with the dice deck', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'oct3');
  await server.start();
  try {
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    const [a, b, c] = t.pages as [Page, Page, Page];

    // Quick clicks all count, even before the server has answered the first (a fast double click
    // on a slow connection): three steps down, and two house rules ticked at once, stay.
    for (const p of t.pages) await lobbyStep(p, 'game');
    const startVP = Number(await a.getByTestId('win-vp').textContent());
    await a.evaluate(() => {
      const fewer = document.querySelector<HTMLButtonElement>('[aria-label="Fewer points"]')!;
      fewer.click();
      fewer.click();
      fewer.click();
      document.querySelector<HTMLInputElement>('[data-testid=rule-no7FirstRound]')!.click();
      document.querySelector<HTMLInputElement>('[data-testid=rule-bank3to1]')!.click();
    });
    for (const p of t.pages) {
      await expect(p.getByTestId('win-vp')).toHaveText(String(startVP - 3));
      await expect(p.getByTestId('rule-no7FirstRound')).toBeChecked();
      await expect(p.getByTestId('rule-bank3to1')).toBeChecked();
    }
    await a.evaluate(() => {
      document.querySelector<HTMLInputElement>('[data-testid=rule-no7FirstRound]')!.click();
      document.querySelector<HTMLInputElement>('[data-testid=rule-bank3to1]')!.click();
      for (let i = 0; i < 3; i++)
        document.querySelector<HTMLButtonElement>('[aria-label="More points"]')!.click();
    });
    for (const p of t.pages) {
      await expect(p.getByTestId('win-vp')).toHaveText(String(startVP));
      await expect(p.getByTestId('rule-bank3to1')).not.toBeChecked();
    }

    // Every new map can be picked, and everyone sees it on the table.
    await a.click('[data-testid=mode-seafarers]');
    for (const [id, name] of [
      ['classic-isles-far', 'Classic and the Isles, far apart'],
      ['archipelago', 'Archipelago'],
      ['the-crossing', 'The Crossing'],
      ['atoll', 'The Atoll'],
    ] as const) {
      await a.getByTestId(`scenario-${id}`).click();
      for (const p of t.pages)
        await expect(p.getByTestId(`scenario-${id}`)).toHaveAttribute('aria-checked', 'true');
      await expect(b.locator('[data-testid=table-board] [data-testid=mapboard]')).toHaveAttribute(
        'aria-label',
        `Map: ${name}`,
      );
      if (SHOTS) await b.screenshot({ path: `${SHOTS}/oct3-table-${id}.png` });
    }

    // The dice deck with 5 cards out, picked in the lobby.
    await a.getByTestId('rule-diceDeck').selectOption('trimmed');
    for (const p of t.pages) await expect(p.getByTestId('rule-diceDeck')).toHaveValue('trimmed');
    await startGame(a);
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    expect((await view(a)).rules.houseRules.diceDeck).toBe('trimmed');

    // A few turns: the first roll shuffles the deck (later shuffles: test/diceDeck.test.ts).
    await playUntil(t, async () => ((await view(a)).turnN ?? 0) > 4, {
      maxSteps: 2000,
      beforeStep: async (p) => {
        await confirmPlace(p);
        return false;
      },
    });
    await expect(c.getByTestId('log')).toContainText('The dice deck was shuffled: 31 cards');
    // Nobody is ever sent which cards are left.
    for (const fs of t.frames)
      for (const f of fs) expect(JSON.stringify(f)).not.toMatch(/"diceDeck":\{|"out":\[/);

    // The table rules show the deck and how many cards are left; switching it changes the game.
    const turnPage = async () => {
      const v = await view(a);
      for (const p of t.pages) if ((await view(p)).me === v.turn) return p;
      throw new Error('no turn page');
    };
    const p = await turnPage();
    await p.getByRole('button', { name: 'Menu', exact: true }).click();
    await p.getByTestId('menu-rules').click();
    await expect(p.getByTestId('tablerule-diceDeck')).toHaveValue('trimmed');
    await expect(p.getByTestId('deck-left')).toContainText('cards left in the dice deck');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/oct3-rules.png` });
    await p.getByTestId('tablerule-diceDeck').selectOption('dice');
    for (const q of t.pages)
      await expect.poll(async () => (await view(q)).rules.houseRules.diceDeck).toBeUndefined();
    await expect(c.getByTestId('log')).toContainText('switched back to dice');
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
