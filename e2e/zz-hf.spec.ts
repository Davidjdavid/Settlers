import { expect, test } from '@playwright/test';
import { TestServer, freePort } from './server';
import { seatedTable, view } from './table';
const S = '/tmp/claude-0/-home-user-Settlers/d2bc060c-d153-5772-852c-444505b588af/scratchpad/hf';
test('hfns look', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'hf');
  await server.start();
  const t = await seatedTable(browser, server, ['Ann', 'Ben', 'Cy']);
  const [a] = t.pages;
  await a!.setViewportSize({ width: 1600, height: 900 });
  for (const mode of ['seafarers', 'full']) {
    if (mode === 'full') {
      const t2 = await seatedTable(browser, server, ['Dee', 'Eve', 'Fay']);
      t.pages = t2.pages;
    }
    const p = t.pages[0]!;
    await p.setViewportSize({ width: 1600, height: 900 });
    await p.getByTestId(`mode-${mode}`).click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${S}-${mode}-table.png` });
    await p.getByTestId('start').click();
    await expect(p.locator('#board')).toBeVisible();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${S}-${mode}-game.png` });
    const v = await view(p);
    const land = v.board.hexes.filter((h: { t: string }) => h.t !== 'sea').length;
    console.log(mode, 'hexes', v.board.hexes.length, 'land', land);
  }
  await server.stop();
});
