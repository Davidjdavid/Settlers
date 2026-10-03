/*
 * Milestone 8 in three browsers against the real server build: a 1366×768 laptop, a tablet and
 * a phone (both touch screens).
 * - Lobby: Cities & Knights; the Bank cards setting, seen and changed live by everyone.
 * - Points to win on every screen, and again after Keep playing raises it.
 * - Board labels: hovering a harbor on the laptop; on the phone, press and hold shows a label
 *   and never places a piece (a normal tap still does).
 * - Trade buttons: the bank button shows a rate and opens the bank side of the trade screen.
 * - The log: on the laptop it sits beside the board inside the screen; it follows new entries,
 *   stops when scrolled up and shows "N new ↓", and new entries never move the page.
 * - The Smith, on a made-up view in one browser (a real game rarely deals it): knights that can
 *   be promoted light up, "Upgrade both knights", "Upgrade these 2", using only 1 of 2 upgrades
 *   asks first, Cancel keeps the card, a knight promoted this turn can't be picked.
 * - Keep playing after the first win: asked, agreed by everyone, played on to an overtime win;
 *   the end screen and the Stats page show it.
 * SHOTS=<dir> saves screenshots.
 */

import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, confirmPlace, playUntil, baseGame, sitAs, view, type Frame, type Table } from './table';

test.use({ actionTimeout: 15000 });
test.setTimeout(30 * 60 * 1000);

const shot = async (p: Page, name: string, fullPage = false) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/m8-${name}.png`, fullPage });
};

/** Press and hold with a finger at the middle of an element, then lift. */
async function hold(p: Page, sel: string, ms = 750) {
  await p.locator(sel).first().scrollIntoViewIfNeeded();
  const box = (await p.locator(sel).first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await p.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const scrollY = (p: Page) => p.evaluate(() => document.scrollingElement!.scrollTop);
const logState = (p: Page) =>
  p.getByTestId('log').evaluate((el) => ({
    top: el.scrollTop,
    gap: el.scrollHeight - el.scrollTop - el.clientHeight,
    rows: el.children.length,
  }));

test('Milestone 8: bank, labels, trade buttons, the log, the Smith and keep playing', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'm8 passphrase');
  await server.start();
  const frames: Frame[][] = [[], [], []];
  const errors: string[] = [];
  const devices: BrowserContextOptions[] = [
    { viewport: { width: 1366, height: 768 } },
    { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  ];
  const names = ['Ann', 'Bob', 'Cat'];
  // Frames are checked for hidden information over the first game (the overtime part adds
  // nothing new and makes the check slow).
  let recording = true;
  const open = async (i: number) => {
    const page = await (await browser.newContext(devices[i])).newPage();
    page.on('pageerror', (e) => errors.push(`${names[i]}: ${e.message}`));
    page.on('websocket', (ws) =>
      ws.on('framereceived', (f) => {
        if (recording) frames[i]!.push(JSON.parse(String(f.payload)));
      }),
    );
    await page.goto(server.url);
    await page.fill('#pass', 'm8 passphrase');
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
    await sitAs(c, 'Cat', 'black');
    await expect(a.locator('.seat:not(.open)')).toHaveCount(3);
    const t: Table = { pages, frames, errors, code };

    /* ---------- Lobby: Knights and the bank ---------- */
    await a.click('[data-testid=mode-knights]');
    for (let i = 0; i < 5; i++) await a.click('[aria-label="Fewer points"]');
    await expect(c.getByTestId('win-vp')).toHaveText('8');
    for (const p of pages)
      await expect(p.getByTestId('bank-limited')).toHaveAttribute('aria-checked', 'true');
    await a.getByTestId('bank-unlimited').click();
    for (const p of [b, c])
      await expect(p.getByTestId('bank-unlimited')).toHaveAttribute('aria-checked', 'true');
    // Anyone at the table may change it back; everyone sees it.
    await b.getByTestId('bank-limited').click();
    for (const p of [a, c])
      await expect(p.getByTestId('bank-limited')).toHaveAttribute('aria-checked', 'true');
    await shot(c, 'lobby-phone', true);
    await a.click('[data-testid=start]');
    for (const p of pages) await expect(p.locator('#board')).toBeVisible();
    const seats = [(await view(a)).me, (await view(b)).me, (await view(c)).me];
    expect((await view(a)).rules.bank).toBe('limited');
    // Commodities are counted (12 each), not ∞.
    await expect(a.getByTestId('bank-paper')).toHaveText(/\b12\b/);

    /* ---------- Points to win on every screen ---------- */
    for (const p of pages) await expect(p.getByTestId('goal')).toContainText('8');

    /* ---------- Hover labels on the laptop ---------- */
    const port = a.locator('#board [data-port]').first();
    const pb = (await port.boundingBox())!;
    await a.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await expect(a.getByTestId('board-info')).toContainText(/harbor · trade/);
    await shot(a, 'hover-harbor');
    await a.mouse.move(5, 5);
    await expect(a.getByTestId('board-info')).toHaveCount(0);

    /* ---------- Press and hold on the phone ---------- */
    const meC = (await view(c)).me;
    await playUntil(
      t,
      async () => {
        const v = await view(c);
        return v.stage === 'setup' && v.turn === meC;
      },
      { beforeStep: async (p) => p === c },
    );
    const seq = (await view(c)).seq;
    await expect(c.locator('#board [data-v]').first()).toBeVisible();
    await hold(c, '#board [data-v]');
    await c.waitForTimeout(300);
    // Nothing placed, nothing waiting for Confirm.
    await expect(c.locator('#board [data-ghost]')).toHaveCount(0);
    await expect(c.getByTestId('confirm-place')).toHaveCount(0);
    expect((await view(c)).seq).toBe(seq);
    // On a harbor, a label.
    await hold(c, '#board [data-port]');
    await expect(c.getByTestId('board-info')).toContainText(/harbor/);
    await shot(c, 'hold-harbor');
    expect((await view(c)).seq).toBe(seq);
    // A normal tap still places.
    await c.locator('#board [data-v]').first().tap();
    await expect(c.locator('#board [data-ghost]').first()).toBeVisible();
    await expect(c.getByTestId('board-info')).toHaveCount(0);
    // (In setup the road completes the move.)
    await c.locator('#board [data-e]').first().tap();
    await confirmPlace(c, 2000);
    await expect.poll(async () => (await view(c)).seq).toBeGreaterThan(seq);

    /* ---------- Every player in sight on the laptop ---------- */
    // The players box scrolls on a short screen; whoever is scrolled out is named at its foot.
    const inSight = () =>
      a.evaluate(() => {
        const box = document.querySelector('.players-box')!.getBoundingClientRect();
        const foot = document.querySelector('[data-testid=players-more]')?.getBoundingClientRect();
        const bottom = foot ? foot.top : box.bottom;
        const rows = [...document.querySelectorAll<HTMLElement>('.players .player')];
        const hidden = rows
          .filter((r) => {
            const b = r.getBoundingClientRect();
            return Math.min(b.bottom, bottom) - Math.max(b.top, box.top) < b.height * 0.6;
          })
          .map((r) => r.dataset.seat);
        const named = [...document.querySelectorAll<HTMLElement>('[data-testid=players-more] button')].map(
          (x) => x.dataset.seat,
        );
        return { hidden, named };
      });
    for (const top of [0, 10_000]) {
      await a.locator('.players-box').evaluate((el, t) => (el.scrollTop = t), top);
      await expect
        .poll(async () => {
          const x = await inSight();
          return x.hidden.join() === x.named.join();
        })
        .toBe(true);
    }

    /* ---------- The log on the laptop ---------- */
    const lb = (await a.getByTestId('log').boundingBox())!;
    expect(lb.y).toBeGreaterThanOrEqual(0);
    expect(lb.y + lb.height, 'the log fits on a 1366×768 screen').toBeLessThanOrEqual(768);
    expect(lb.height).toBeGreaterThan(120);

    const checks = { trade: false, scrolled: false, newShown: false, followed: 0, held: false };
    let pageMoved = 0;
    // Later, with more rows than the log shows at once: scrolled up, nothing moves under the reader.
    let reading: { top: number; steps: number; drift: number } | null = null;
    const heldTop = () =>
      a.getByTestId('log').evaluate((el) => {
        const row = el.querySelector('[data-held]');
        return row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
      });
    const beforeStep = async (p: Page): Promise<boolean> => {
      if (p !== a) return false;
      const v = await view(a);
      // Trade buttons on Ann's turn.
      if (!checks.trade && v.phase === 'play' && v.turn === v.me && v.stage === 'main') {
        checks.trade = true;
        const bank = a.getByTestId('trade-bank');
        await expect(bank).toHaveText(/^Bank · [234]:1/);
        await expect(a.getByTestId('trade')).toHaveText(/Trade with players/);
        await shot(a, 'trade-buttons');
        await bank.click();
        await expect(a.locator('.sheet')).toBeVisible();
        await expect(a.locator('.sheet .tabs .btn.on')).toContainText(/Bank/);
        await a.keyboard.press('Escape');
        await expect(a.locator('.sheet')).toHaveCount(0);
        return true;
      }
      if (v.turnN < 4) return false;
      // Scroll the log up: it stops following and counts what's new.
      if (!checks.scrolled) {
        checks.scrolled = true;
        await a.getByTestId('log').evaluate((el) => (el.scrollTop = 0));
        await expect.poll(async () => (await logState(a)).gap).toBeGreaterThan(40);
        return false;
      }
      if (!checks.newShown) {
        const btn = a.getByTestId('log-new');
        if ((await btn.isVisible().catch(() => false)) && !(await a.locator('.back').count())) {
          checks.newShown = true;
          await expect(btn).toHaveText(/^\d+ new ↓$/);
          expect((await logState(a)).top).toBeLessThan(5);
          await shot(a, 'log-new');
          await btn.click();
          await expect.poll(async () => (await logState(a)).gap).toBeLessThan(24);
          await expect(btn).toHaveCount(0);
        }
        return false;
      }
      if (!checks.held && (await a.getByTestId('log-earlier').count())) {
        if (!reading) {
          // Without the browser's own scroll anchoring (not every browser has it), so this checks
          // the log's rule: while someone reads, rows stop leaving the top.
          await a.addStyleTag({ content: '.log { overflow-anchor: none }' });
          const top = await a.getByTestId('log').evaluate((el) => {
            el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
            const box = el.getBoundingClientRect();
            const row = [...el.children].find((c) => c.getBoundingClientRect().top >= box.top)!;
            row.setAttribute('data-held', '1');
            return row.getBoundingClientRect().top - box.top;
          });
          reading = { top, steps: 0, drift: 0 };
          return false;
        }
        const now = await heldTop();
        expect(now, 'the row being read is still on the page').not.toBeNull();
        reading.drift = Math.max(reading.drift, Math.abs(now! - reading.top));
        const btn = a.getByTestId('log-new');
        if (++reading.steps < 4 || !(await btn.isVisible())) return false;
        // A sheet that needs an answer (an Aqueduct pick, say) covers the log: answer it first.
        if (await a.locator('.back').count()) return false;
        expect(reading.drift, 'new rows moved the rows being read').toBeLessThan(2);
        await shot(a, 'log-held');
        await btn.click();
        await expect.poll(async () => (await logState(a)).gap).toBeLessThan(24);
        checks.held = true;
        return false;
      }
      // Following again: the newest entry stays in view.
      if (checks.followed < 20 && (await logState(a)).gap < 24) checks.followed++;
      if ((await scrollY(a)) !== 0) pageMoved++;
      return false;
    };
    // Ann's page stays scrolled to the top; new entries must not move it.
    await a.evaluate(() => window.scrollTo(0, 0));
    await playUntil(t, async () => (await view(a)).phase === 'over', { beforeStep, maxSteps: 20000 });
    expect(checks).toMatchObject({ trade: true, scrolled: true, newShown: true, held: true });
    expect(checks.followed).toBeGreaterThan(5);
    expect(pageMoved, 'new log entries moved the page').toBe(0);
    // Each turn starts with a divider showing the roll; names and cards are coloured.
    await expect(a.locator('.log .sep[data-turn]').filter({ hasText: 'rolled' }).first()).toBeVisible();
    expect(await a.locator('.log .nm[data-p]').count()).toBeGreaterThan(20);
    expect(await a.locator('.log .cd[data-card]').count()).toBeGreaterThan(20);
    // Past a page of rows, both logs still follow (the phone's too).
    expect((await logState(a)).gap).toBeLessThan(24);
    expect((await logState(c)).gap).toBeLessThan(24);
    // Earlier entries on request.
    const before = (await logState(a)).rows;
    await a.getByTestId('log-earlier').click();
    await expect.poll(async () => (await logState(a)).rows).toBeGreaterThan(before);
    await shot(a, 'laptop-end');

    /* ---------- Keep playing ---------- */
    for (const p of pages) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 15000 });
    const first = await view(a);
    await a.getByTestId('keep-playing').click();
    recording = false;
    checkFrames(t, seats, 100);
    // The lowest target allowed, to keep the overtime short.
    while (await a.getByRole('button', { name: 'Lower target' }).isEnabled())
      await a.getByRole('button', { name: 'Lower target' }).click();
    const target = Number(await a.getByTestId('keep-target').textContent());
    expect(target).toBeGreaterThan(first.winVP);
    await a.getByTestId('keep-ask-go').click();
    for (const p of [b, c]) await p.getByTestId('keep-yes').click();
    await expect.poll(async () => (await view(a)).phase).toBe('play');
    for (const p of pages) await expect(p.getByTestId('goal')).toContainText(String(target));
    await playUntil(t, async () => (await view(a)).phase === 'over', { maxSteps: 20000 });
    for (const p of pages) await expect(p.getByTestId('game-over')).toContainText('in overtime');
    const end = await view(a);
    expect(end.keep.wins).toHaveLength(1);
    await shot(a, 'overtime');

    /* ---------- The Stats page ---------- */
    await a.getByRole('button', { name: 'Look at the board' }).click();
    await a.getByRole('button', { name: 'Menu', exact: true }).click();
    await a.locator('.sheet .btn.ghost:has-text("Leave this room")').click();
    await a.getByTestId('open-stats').click();
    const winnerNick = end.players[end.keep.wins[0].p].nick as string;
    await a.locator(`[data-testid=stats-who][data-name=${winnerNick}]`).click();
    await expect(a.getByTestId('overtime-wins')).toHaveText('1');
    await expect(a.getByTestId('past-game').first()).toContainText(/overtime/i);
    await shot(a, 'stats-overtime');

    /* ---------- The Smith, on a made-up view ---------- */
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    const stage = (knights: [number, number, boolean][], politics = 0) =>
      c.evaluate(
        ([knights, politics]) => {
          const s = (window as any).__settlers;
          const v = structuredClone(s.state().game);
          v.phase = 'play';
          v.winner = null;
          delete v.keep;
          v.stage = 'main';
          v.turn = v.me;
          v.dice = [3, 4];
          v.ck.hand = ['smith'];
          v.ck.owe = [];
          v.ck.lvl[v.me].politics = politics;
          v.ck.knights = v.ck.knights.map(() => null);
          // Free corners, away from every building.
          const free = v.verts
            .flatMap((b: unknown, i: number) => (b ? [] : [i]))
            .filter((_: number, i: number) => i % 7 === 3);
          const at: number[] = [];
          knights.forEach(([lvl, up]: [number, boolean], i: number) => {
            v.ck.knights[free[i]] = { p: v.me, lvl, on: true, ...(up ? { up: true } : {}) };
            at.push(free[i]);
          });
          s.stage(v);
          return at;
        },
        [knights.map(([l, , up]) => [l, up]), politics] as const,
      );
    const smith = () => c.locator('[data-progress=smith] button:has-text("Play")').click();
    const moves = (): Promise<{ vs: number[] }[]> => c.evaluate(() => (window as any).__settlers.staged());
    const lit = async () =>
      (
        await c
          .locator('#board [data-v]')
          .evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.v)))
      ).sort();

    // Two knights that can be promoted (and one promoted this turn, which can't be picked).
    let at = await stage([
      [1, 0, false],
      [1, 0, false],
      [1, 0, true],
    ]);
    // The card shows its picture and what it does, without hovering.
    await expect(c.locator('[data-progress=smith] .cardart')).toBeVisible();
    await expect(c.locator('[data-progress=smith]')).toContainText('Promote up to 2 knights for free.');
    await shot(c, 'progress-cards', true);
    await smith();
    expect(await lit()).toEqual([at[0]!, at[1]!].sort());
    await expect(c.locator('#board [data-ghost=knight]')).toHaveCount(2);
    await expect(c.getByTestId('smith-go')).toHaveText('Upgrade both knights');
    await shot(c, 'smith-both');
    // Cancel keeps the card.
    await c.getByTestId('cancel').click();
    await expect(c.locator('[data-progress=smith]')).toHaveCount(1);
    expect(await moves()).toEqual([]);
    // Both in one step.
    await smith();
    await c.getByTestId('smith-go').click();
    expect((await moves()).map((m) => [...m.vs].sort())).toEqual([[at[0]!, at[1]!].sort()]);
    // Only one: its own button, and a question first.
    await smith();
    await c.locator(`#board [data-v="${at[1]}"]`).tap();
    await expect(c.locator('#board [data-ghost=knight]')).toHaveCount(1);
    await expect(c.getByTestId('smith-go')).toHaveCount(0);
    await c.getByTestId('smith-one').click();
    await expect(c.locator('.sheet')).toContainText('Use only 1 of your 2 upgrades?');
    await shot(c, 'smith-one');
    await c.locator('.sheet button:has-text("Use only 1")').click();
    expect((await moves()).at(-1)!.vs).toEqual([at[0]]);

    // Three that can be promoted: pick two. Two basics can't both become strong (only 2 strong
    // knights each, and one is out), so the second basic replaces the first.
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    at = await stage(
      [
        [1, 0, false],
        [1, 0, false],
        [2, 0, false],
      ],
      3,
    );
    await smith();
    expect(await lit()).toEqual([...at].sort());
    await expect(c.locator('#board [data-ghost=knight]')).toHaveCount(0);
    await c.locator(`#board [data-v="${at[0]}"]`).tap();
    await c.locator(`#board [data-v="${at[1]}"]`).tap();
    await expect(c.locator('#board [data-ghost=knight]')).toHaveCount(1);
    await c.locator(`#board [data-v="${at[2]}"]`).tap();
    await expect(c.getByTestId('smith-go')).toHaveText('Upgrade these 2');
    await shot(c, 'smith-pick');
    await c.getByTestId('smith-go').click();
    expect([...(await moves()).at(-1)!.vs].sort()).toEqual([at[1]!, at[2]!].sort());

    /* ---------- A choice left owed when the game ends doesn't stay open (made-up view) ---------- */
    // The barbarians beaten gives the winning point while tied defenders still owe a draw.
    const owedAt = (phase: string) =>
      c.evaluate((phase) => {
        const s = (window as any).__settlers;
        const v = structuredClone(s.state().game);
        Object.assign(v, { phase, stage: 'ck', turn: v.me });
        v.winner = phase === 'play' ? null : v.me;
        v.ck.owe = [{ k: 'defenderDraw', p: v.me }];
        s.stage(v);
      }, phase);
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    await owedAt('play');
    await expect(c.getByRole('dialog', { name: 'You helped beat the barbarians' })).toBeVisible();
    await owedAt('over');
    await expect(c.getByRole('dialog', { name: 'You helped beat the barbarians' })).toHaveCount(0);
    await expect(c.getByTestId('game-over')).toBeVisible({ timeout: 15_000 });

    /* ---------- Move an active knight, and chase the robber (made-up view) ---------- */
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    // One active knight (activated on an earlier turn) on a corner it can move from.
    const kAt: { at: number; to: number[] } = await c.evaluate(() => {
      const s = (window as any).__settlers;
      const base = structuredClone(s.state().game);
      Object.assign(base, { phase: 'play', winner: null, stage: 'main', turn: base.me, dice: [3, 4] });
      delete base.keep;
      base.ck.hand = [];
      base.ck.owe = [];
      // Nothing left over from the real game (an open offer, a turn to hand back, an undo).
      base.offers = [];
      delete base.back;
      delete base.undo;
      base.ck.knights = base.ck.knights.map(() => null);
      // A few more roads, so there's a road to move along whatever the game left (a quick game
      // can end with only the two starting roads).
      for (let k = 0; k < 2; k++) {
        const v0 = structuredClone(base);
        v0.hand.res = { ...v0.hand.res, wood: 9, brick: 9 };
        for (const a of s
          .legal(v0)
          .filter((a: any) => a.type === 'road')
          .slice(0, 6))
          base.edges[a.e] = base.me;
      }
      for (let at = 0; at < base.verts.length; at++) {
        if (base.verts[at]) continue;
        const v = structuredClone(base);
        v.ck.knights[at] = { p: v.me, lvl: 1, on: true };
        const acts = s.legal(v);
        const to = acts.filter((a: any) => a.type === 'moveKnight' && a.from === at).map((a: any) => a.to);
        if (to.length) {
          s.stage(v);
          return { at, to: to.sort((x: number, y: number) => x - y) };
        }
      }
      const v = structuredClone(base);
      const at = base.verts.findIndex((b: unknown) => !b);
      v.ck.knights[at] = { p: v.me, lvl: 1, on: true };
      const kinds = [...new Set(s.legal(v).map((a: any) => a.type))];
      throw new Error(
        `no corner for a knight to move from: ${JSON.stringify(kinds)} roads ${base.edges.filter((e: unknown) => e === base.me).length} keys ${Object.keys(base).join(',')}`,
      );
    });
    await c.getByTestId('knights').click();
    await c.locator(`#board [data-v="${kAt.at}"]`).tap();
    await c.getByTestId('k-move').click();
    // The corners it can reach light up; pick one.
    await expect.poll(async () => (await lit()).sort((x, y) => x - y)).toEqual(kAt.to);
    await c.locator(`#board [data-v="${kAt.to[0]}"]`).tap();
    await confirmPlace(c, 1000);
    await expect
      .poll(moves)
      .toEqual([expect.objectContaining({ type: 'moveKnight', from: kAt.at, to: kAt.to[0] })]);

    /* ---------- Tapping the board with nothing chosen (made-up view) ---------- */
    // My turn, plenty of cards, and the board as the game left it plus one knight of each level.
    const tapView = (need: 'settlement' | 'city') =>
      c.evaluate((need) => {
        const s = (window as any).__settlers;
        const v = structuredClone(s.state().game);
        Object.assign(v, { phase: 'play', winner: null, stage: 'main', turn: v.me, dice: [3, 4] });
        delete v.keep;
        v.offers = [];
        delete v.back;
        delete v.undo;
        v.ck.owe = [];
        v.ck.hand = [];
        for (const k of Object.keys(v.hand.res)) v.hand.res[k] = 5;
        Object.assign(v.players[v.me].pieces, { road: 5, city: 2 });
        v.ck.knights = v.ck.knights.map(() => null);
        // No improvements yet: at level 3 the next one first asks which city gets the metropolis
        // (a whole game can leave any level).
        v.ck.lvl[v.me] = { science: 0, trade: 0, politics: 0 };
        // A settlement of mine to upgrade, or a city without a wall (made from a building if need be:
        // the game may have left none, the barbarians taking cities back).
        const mine = (lvl: number) =>
          v.verts.findIndex(
            (b: any, i: number) => b && b[0] === v.me && b[1] === lvl && !v.ck.walls.includes(i),
          );
        let at = mine(need === 'city' ? 2 : 1);
        if (at < 0) {
          at = mine(need === 'city' ? 1 : 2);
          v.verts[at] = [v.me, need === 'city' ? 2 : 1];
        }
        const free = v.verts
          .flatMap((b: unknown, i: number) => (b ? [] : [i]))
          .filter((_: number, i: number) => i % 9 === 4);
        [1, 2, 3].forEach((lvl, i) => (v.ck.knights[free[i]] = { p: v.me, lvl, on: false }));
        const acts = s.legal(v);
        s.stage(v);
        return {
          at,
          canCity: acts.some((a: any) => a.type === 'city' && a.v === at),
          road: acts.find((a: any) => a.type === 'road')?.e ?? null,
          knights: free.slice(0, 3) as number[],
        };
      }, need);
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    let tv = await tapView('settlement');
    // Every knight shows its level on a badge.
    for (const [i, at] of tv.knights.entries())
      await expect(c.locator(`#board [data-knight="${at}"] .klvl`)).toHaveText(String(i + 1));
    if (process.env.SHOTS)
      await c.locator('#board').screenshot({ path: `${process.env.SHOTS}/m8-knight-levels.png` });
    // A settlement: tap it, confirm, and it becomes a city.
    expect(tv.canCity).toBe(true);
    await c.locator(`#board [data-v="${tv.at}"]`).tap();
    await confirmPlace(c, 1000);
    await expect.poll(moves).toEqual([{ type: 'city', v: tv.at }]);
    // An open edge: a road.
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    tv = await tapView('settlement');
    expect(tv.road).not.toBeNull();
    await c.locator(`#board [data-e="${tv.road}"]`).tap();
    await confirmPlace(c, 1000);
    await expect.poll(moves).toEqual([{ type: 'road', e: tv.road }]);
    // A city: a menu with a wall and the three improvements; pick Science.
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    tv = await tapView('city');
    await c.locator(`#board [data-v="${tv.at}"]`).tap();
    await expect(c.getByRole('dialog', { name: 'What do you want to do here?' })).toBeVisible();
    await expect(c.getByTestId('tap-wall')).toBeVisible();
    await shot(c, 'tap-city');
    await c.getByTestId('tap-improve-science').click();
    await expect.poll(moves).toEqual([expect.objectContaining({ type: 'improve', track: 'science' })]);
    // A knight: its own sheet.
    await c.locator(`#board [data-v="${tv.knights[0]}"]`).tap();
    await expect(c.getByTestId('k-activate')).toBeEnabled();
    await c.keyboard.press('Escape');

    /* ---------- Turning down CPU offers on my own (made-up view) ---------- */
    const cpuOffer = () =>
      c.evaluate(() => {
        const s = (window as any).__settlers;
        const v = structuredClone(s.state().game);
        Object.assign(v, { phase: 'play', winner: null, stage: 'main', dice: [3, 4] });
        delete v.keep;
        v.ck.owe = [];
        const from = (v.me + 1) % v.players.length;
        v.turn = from;
        v.players[from].cpu = true;
        for (const k of Object.keys(v.hand.res)) v.hand.res[k] = 3;
        v.offers = [{ id: 77, from, give: { wood: 1 }, want: { ore: 1 }, resp: {} }];
        s.stage(v);
      });
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    await cpuOffer();
    await c.waitForTimeout(500);
    expect(await moves()).toEqual([]);
    await c.getByRole('button', { name: 'Menu', exact: true }).click();
    await c.getByTestId('menu-settings').click();
    await c.getByTestId('setting-noCpuTrades').click();
    await c.getByTestId('settings-close').click();
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    await cpuOffer();
    await expect.poll(moves).toEqual([{ type: 'respond', id: 77, yes: false }]);

    /* ---------- Play Alchemist: only before your roll (made-up view) ---------- */
    const alchemist = (stage: string) =>
      c.evaluate((stage) => {
        const s = (window as any).__settlers;
        const v = structuredClone(s.state().game);
        Object.assign(v, { phase: 'play', winner: null, stage, turn: v.me });
        v.dice = stage === 'preroll' ? null : [3, 4];
        delete v.keep;
        Object.assign(v.ck, { hand: ['alchemist'], owe: [], alchemy: null });
        s.stage(v);
      }, stage);
    await c.reload();
    await expect(c.locator('#board')).toBeVisible();
    await alchemist('preroll');
    await expect(c.getByTestId('play-alchemist')).toBeVisible();
    await shot(c, 'alchemist');
    // Rolling without it asks first (the card confirmation is on by default).
    await c.getByTestId('roll').click();
    await expect(c.locator('.sheet')).toContainText('Roll without using your Alchemist?');
    await c.locator('.sheet button:has-text("Cancel")').click();
    expect(await moves()).toEqual([]);
    await alchemist('main');
    await expect(c.getByTestId('play-alchemist')).toHaveCount(0);

    // Back to the real game, untouched by any of it.
    await c.reload();
    await expect.poll(async () => (await view(c))?.seq).toBe(end.seq);

    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
