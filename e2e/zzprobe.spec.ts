import { test } from '@playwright/test';
import { TestServer, freePort } from './server';
test('probe', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'probe');
  await server.start();
  try {
    for (const [kind, o] of Object.entries({
      tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
      phone: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: 'reduce' as const,
      },
      laptop: { viewport: { width: 1366, height: 820 } },
    })) {
      const p = await (await browser.newContext(o)).newPage();
      await p.goto(server.url);
      await p.fill('#pass', server.passphrase);
      await p.click('button:has-text("Enter")');
      await p.click('[data-testid=create]');
      await p.getByTestId('new-profile').click();
      await p.getByTestId('new-name').fill('P' + kind);
      await p.getByTestId('new-save').click();
      await p.locator('[data-testid=profile]').first().click();
      await p.click('[data-testid=sit]');
      await p.click('[data-testid=mode-base]');
      await p.click('[data-testid=add-cpu]').catch(() => {});
      await p.click('[data-testid=start]', { timeout: 5000 }).catch(() => console.log('no start', kind));
      await p
        .locator('#board')
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      for (const size of ['small', 'medium', 'large', 'xl', 'medium']) {
        await p.getByRole('button', { name: 'Menu', exact: true }).click();
        await p.getByTestId('menu-settings').click();
        await p.getByTestId(`size-${size}`).click();
        await p.screenshot({
          path: `/tmp/claude-0/-home-user-Settlers/d2bc060c-d153-5772-852c-444505b588af/scratchpad/sz-${kind}-${size}.png`,
        });
        await p
          .getByTestId('settings-close')
          .click({ timeout: 3000 })
          .catch(async () => {
            console.log('BLOCKED', kind, size);
            await p.keyboard.press('Escape');
          });
      }
    }
  } finally {
    await server.stop();
  }
});
