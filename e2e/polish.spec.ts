/*
 * Milestone 4, "table polish", in three browsers against the real server build. The third
 * browser is a touch-screen phone.
 * - Lobby: the four game modes, 8 colours with piece previews, no shared colours, no gray.
 * - Placement preview and Confirm/Cancel, with a mouse and by touch, each setting on and off.
 * - Confirm before ending a turn, playing a card and accepting a trade, each on and off.
 * - Personal settings, saved by nickname, come back after rejoining by name on a new device.
 * - Table rules are changed mid-game by the player whose turn it is.
 * - Handing the dice back: during setup, refused once, and handed back unasked with the turn
 *   restored exactly.
 * - Each browser's bot plays the rest of the game to the end, and every frame is checked for leaks.
 */

import { expect, test, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { checkFrames, sitAs, view, type Frame } from './table';

// A click that can't happen should fail the test quickly, not wait for the 10-minute limit.
test.use({ actionTimeout: 15000 });
test.setTimeout(20 * 60 * 1000);

/** Screenshots for checking the UI by eye: SHOTS=<dir> npx playwright test e2e/polish.spec.ts */
const shot = async (p: Page, name: string) => {
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
type SettingKey = 'confirmPlace' | 'confirmPlaceTouch' | 'confirmEnd' | 'confirmCard' | 'confirmTrade';

test('three players use the table polish features through a whole game', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'polish passphrase');
  await server.start();
  const frames: Frame[][] = [[], [], []];
  const rejoinFrames: Frame[] = [];
  const errors: string[] = [];
  const touch = new Set<Page>();
  const phone: BrowserContextOptions = {
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 860 },
  };

  const open = async (into: Frame[], opts: BrowserContextOptions = {}) => {
    const page = await (await browser.newContext(opts)).newPage();
    if (opts.hasTouch) touch.add(page);
    page.on('pageerror', (e) => errors.push(`${e.message}`));
    page.on('websocket', (ws) => ws.on('framereceived', (f) => into.push(JSON.parse(String(f.payload)))));
    await page.goto(server.url);
    await page.fill('#pass', 'polish passphrase');
    await page.click('button:has-text("Enter")');
    return page;
  };

  try {
    const pages = [await open(frames[0]!), await open(frames[1]!), await open(frames[2]!, phone)];
    const [a, b, c] = pages as [Page, Page, Page];
    const nicks = ['Ann', 'Bob', 'Cat'];

    /* ---------- Lobby ---------- */
    await a.click('[data-testid=create]');
    const code = (await a.getByTestId('room-code').textContent())!.trim();
    // Fourteen colours, each with a road, settlement and city preview; gray is for CPUs only.
    await expect(a.locator('.colorbtn')).toHaveCount(14);
    await expect(a.locator('.colorbtn svg')).toHaveCount(14);
    await expect(a.locator('.colorbtn[data-color=gray]')).toHaveCount(0);
    const colors = ['pink', 'yellow', 'black'];
    await sitAs(a, nicks[0]!, 'pink');
    for (const i of [1, 2]) {
      const p = pages[i]!;
      await p.goto(`${server.url}/r/${code}`);
      // No two players can have the same colour.
      await expect(p.locator('.colorbtn[data-color=pink]')).toBeDisabled();
      await sitAs(p, nicks[i]!, colors[i]);
    }
    await expect(a.locator('.seat:not(.open)')).toHaveCount(3);
    // The four game modes, picked by anyone seated and shown to everyone.
    await expect(a.locator('[data-testid^=mode-]')).toHaveCount(4);
    // A new room starts on the Full game.
    await expect(c.getByTestId('mode-full')).toHaveClass(/on/);
    await a.click('[data-testid=mode-base]');
    await expect(b.getByTestId('mode-base')).toHaveClass(/on/);
    // Hand-back is on by default; during setup only if switched on. Every switch explains itself.
    await expect(a.getByTestId('rule-handBack')).toBeChecked();
    await a.click('[data-testid=rule-handBackSetup]');
    await expect(b.getByTestId('rule-handBackSetup')).toBeChecked();
    const help = a.locator('label:has([data-testid=rule-handBack]) .help');
    await help.hover();
    await expect(help.locator('.helptext')).toBeVisible();
    await expect(help.locator('.helptext')).toContainText('give the dice back');
    await shot(a, 'lobby');
    await shot(c, 'lobby-phone');
    // A shorter game: 7 points to win (raised to 8 mid-game below).
    for (let i = 0; i < 3; i++) await a.click('[aria-label="Fewer points"]');
    await expect(c.getByTestId('win-vp')).toHaveText('7');
    await a.click('[data-testid=start]');
    for (const p of pages) await expect(p.locator('#board')).toBeVisible();
    const v0 = await view(a);
    expect(v0.rules.houseRules).toEqual({ handBack: true, handBackSetup: true, undo: true });
    // Seats are shuffled at the start; everyone keeps their colour.
    const seats: number[] = [];
    for (const [i, p] of pages.entries()) {
      seats.push((await view(p)).me);
      expect(v0.players[seats[i]!].color).toBe(colors[i]);
    }

    /* ---------- Helpers ---------- */
    const seatOf = async (p: Page): Promise<number> => (await view(p)).me;
    const pageOf = async (seat: number) => {
      for (const p of pages) if ((await seatOf(p)) === seat) return p;
      throw new Error(`no page for seat ${seat}`);
    };
    const turnPage = async () => pageOf((await view(a)).turn);
    const settingsOf = (p: Page): Promise<Record<string, boolean> | null> =>
      p.evaluate(() => (window as any).__settlers.state().room?.mySettings ?? null);
    const isOn = async (p: Page, k: SettingKey) => (await settingsOf(p))?.[k] !== false;
    /** Tap on a phone, click with a mouse. */
    const hit = (p: Page, l: Locator) => (touch.has(p) ? l.tap() : l.click());
    const openMenu = (p: Page) => p.getByRole('button', { name: 'Menu', exact: true }).click();
    /** Switch one of my settings through the "My settings" sheet. */
    const ensure = async (p: Page, k: SettingKey, on: boolean) => {
      const cur = await isOn(p, k);
      if (cur === on) return;
      await openMenu(p);
      await p.getByTestId('menu-settings').click();
      const sw = p.getByTestId(`setting-${k}`);
      await expect(sw).toBeChecked({ checked: cur });
      await shot(p, `settings-${touch.has(p) ? 'phone' : 'desktop'}`);
      await sw.click();
      await expect.poll(() => isOn(p, k)).toBe(on);
      await p.getByTestId('settings-close').click();
    };
    const seqUp = async (p: Page, seq: number) =>
      expect.poll(async () => (await view(p)).seq).toBeGreaterThan(seq);
    const count = {
      placeMouse: [0, 0],
      placeTouch: [0, 0],
      end: [0, 0],
      card: [0, 0],
      trade: [0, 0],
      refused: 0,
      handedBack: 0,
    };
    /** Use a setting on until it has been seen on, then off until seen off. */
    const choose = async (p: Page, k: SettingKey, seen: number[]) => {
      const on = seen[1] === 0 ? true : seen[0] === 0 ? false : await isOn(p, k);
      await ensure(p, k, on);
      seen[on ? 1 : 0]++;
      return on;
    };

    /** A starting settlement and road, by clicking (or tapping) the board. */
    const placeSetup = async (p: Page) => {
      const seq = (await view(p)).seq;
      const t = touch.has(p);
      const on = await choose(
        p,
        t ? 'confirmPlaceTouch' : 'confirmPlace',
        t ? count.placeTouch : count.placeMouse,
      );
      await hit(p, p.locator('#board [data-v]').first());
      await hit(p, p.locator('#board [data-e]').first());
      if (on) {
        // Nothing is placed until Confirm: the pieces wait as see-through ghosts.
        await expect(p.getByTestId('confirm-place')).toBeVisible();
        await expect(p.locator('#board .ghost.waiting')).toHaveCount(2);
        expect((await view(p)).seq).toBe(seq);
        await shot(p, `confirm-${t ? 'phone' : 'mouse'}-${count.placeTouch[1] + count.placeMouse[1]}`);
        await hit(p, p.getByTestId('confirm-place'));
      } else await expect(p.getByTestId('confirm-place')).toHaveCount(0);
      await seqUp(p, seq);
    };

    /* ---------- Setup: preview, Cancel, Confirm, and a hand-back ---------- */
    const p0 = await turnPage();
    if (!touch.has(p0)) {
      // Pointing with the mouse shows a ghost settlement; nothing is placed.
      await p0.locator('#board [data-v]').first().hover();
      await expect(p0.locator('#board .ghost:not(.waiting)')).toHaveCount(1);
      await p0.locator('#board [data-v]').first().click();
      await p0.locator('#board [data-e]').first().hover();
      await expect(p0.locator('#board .ghost[data-ghost=road]')).toHaveCount(1);
    } else await hit(p0, p0.locator('#board [data-v]').first());
    await hit(p0, p0.locator('#board [data-e]').first());
    await expect(p0.getByTestId('confirm-place')).toBeVisible();
    await hit(p0, p0.getByTestId('cancel-place'));
    await expect(p0.locator('#board .ghost.waiting')).toHaveCount(0);
    expect((await view(a)).seq).toBe(0);
    await placeSetup(p0);
    // The next player hands the dice back when asked: the placement is undone.
    const p1 = await turnPage();
    await p0.getByTestId('ask-back').click();
    await expect(p1.getByTestId('back-banner')).toBeVisible();
    await shot(p1, 'back-banner');
    await p1.getByTestId('back-banner').getByTestId('hand-back').click();
    await expect.poll(async () => (await view(a)).turn).toBe(await seatOf(p0));
    expect((await view(a)).verts.every((x: unknown) => x == null)).toBe(true);
    count.handedBack++;
    // Placed again, this time with the mouse confirmation switched off.
    await placeSetup(p0);
    while ((await view(a)).stage === 'setup') await placeSetup(await turnPage());
    for (const [k, n] of Object.entries({ placeMouse: count.placeMouse, placeTouch: count.placeTouch }))
      expect(
        n.every((x) => x > 0),
        `${k} on and off`,
      ).toBe(true);

    /* ---------- Main game: bots play, people end turns, play cards and trade by hand ---------- */
    let rulesDone = false;
    let backStep = 0;
    let rejoined = false;

    const changeRules = async (p: Page) => {
      await openMenu(p);
      await p.getByTestId('menu-rules').click();
      await shot(p, 'rules');
      await p.getByTestId('tablerule-bank3to1').click();
      for (const q of pages)
        await expect.poll(async () => (await view(q)).rules.houseRules.bank3to1).toBe(true);
      const vp = (await view(p)).winVP;
      await p.locator('[data-testid=table-rules] [aria-label=More]').first().click();
      for (const q of pages) await expect.poll(async () => (await view(q)).winVP).toBe(vp + 1);
      await p.getByTestId('rules-close').click();
      await expect(pages.find((q) => q !== p)!.locator('.log')).toContainText('3:1 bank trades');
      // Only the player with the dice can change them.
      const other = pages.find((q) => q !== p)!;
      await openMenu(other);
      await other.getByTestId('menu-rules').click();
      await expect(other.getByTestId('tablerule-bank3to1')).toBeDisabled();
      await expect(other.getByTestId('tablerule-bank3to1')).toBeChecked();
      await other.getByTestId('rules-close').click();
      rulesDone = true;
    };

    const tryTrade = async (p: Page) => {
      const v = await view(p);
      const give = RES.find((r) => v.hand.res[r] > 0);
      if (!give) return;
      for (const q of pages) {
        if (q === p) continue;
        const qv = await view(q);
        const want = RES.find((r) => r !== give && qv.hand.res[r] > 0);
        if (!want) continue;
        const on = count.trade[1] === 0;
        await ensure(p, 'confirmTrade', on);
        await ensure(q, 'confirmTrade', on);
        const had = v.hand.res[want];
        await p.getByTestId('trade').click();
        await p.click(`[aria-label="More give ${give}"]`);
        await p.click(`[aria-label="More want ${want}"]`);
        await p.locator('.sheet .foot .btn.primary').click();
        const offer = q.getByTestId('offer');
        await expect(offer).toBeVisible();
        await offer.getByRole('button', { name: 'Accept' }).click();
        if (on) {
          await expect(q.getByRole('dialog')).toContainText('Accept');
          await q.getByTestId('ask-yes').click();
        }
        await expect(q.getByRole('dialog')).toHaveCount(0);
        await p.getByRole('button', { name: `Trade with ${qv.players[qv.me].nick}` }).click();
        if (on) {
          await expect(p.getByRole('dialog')).toContainText(`Trade with ${qv.players[qv.me].nick}?`);
          await p.getByTestId('ask-yes').click();
        } else await expect(p.getByRole('dialog')).toHaveCount(0);
        await expect.poll(async () => (await view(p)).hand.res[want]).toBe(had + 1);
        count.trade[on ? 1 : 0]++;
        return;
      }
    };

    let boughtOn = -1;
    const endTurn = async (p: Page) => {
      const before = await view(p);
      // The bots rarely buy cards (one game played none in 119 turns): until both card settings
      // have been tried, play any playable Knight or Road Building before ending, and otherwise
      // buy a card by clicking, once a turn. The turn then ends on a later step.
      const dev = before.hand?.dev;
      // Keep the game going until both card settings have been tried: whoever has the dice
      // raises the points to win (a table rule, SPEC 4.5) when someone gets close.
      const top = Math.max(...before.players.map((x: { publicVP: number }) => x.publicVP));
      if (
        count.card.some((x) => x === 0) &&
        before.stage === 'main' &&
        top >= before.winVP - 2 &&
        before.winVP < 25
      ) {
        await openMenu(p);
        await p.getByTestId('menu-rules').click();
        await p.locator('[data-testid=table-rules] [aria-label=More]').first().click();
        await expect.poll(async () => (await view(p)).winVP).toBe(before.winVP + 1);
        await p.getByTestId('rules-close').click();
        return;
      }
      if (count.card.some((x) => x === 0) && before.stage === 'main' && dev) {
        if (!before.devPlayed && dev.knight > 0) return playCard(p, 'playKnight');
        if (!before.devPlayed && dev.road > 0 && before.players[before.me].pieces.road > 0)
          return playCard(p, 'playRoads');
        const res = before.hand.res;
        if (boughtOn !== before.turnN && before.deckCount > 0 && res.sheep && res.wheat && res.ore) {
          boughtOn = before.turnN;
          const seq = before.seq;
          await p.getByTestId('build-dev').click();
          await seqUp(p, seq);
          return;
        }
      }
      if (!rulesDone) await changeRules(p);
      if (count.trade[0] + count.trade[1] < 2 && before.turnN > 6) await tryTrade(p);
      const kept = backStep === 1 ? await view(p) : null;
      const on = await choose(p, 'confirmEnd', count.end);
      const seq = (await view(p)).seq;
      await p.getByTestId('end').click();
      if (on) {
        await expect(p.getByRole('dialog')).toContainText('End your turn?');
        if (count.end[1] === 1) await shot(p, 'end-confirm');
        expect((await view(p)).seq).toBe(seq);
        await p.getByTestId('ask-yes').click();
      }
      await seqUp(p, seq);
      if (backStep > 1 || before.turnN < 4) return;
      const next = await turnPage();
      if (backStep === 0) {
        // Asked, and refused: a "no" is final.
        await p.getByTestId('ask-back').click();
        await expect(next.getByTestId('back-banner')).toBeVisible();
        await next.getByTestId('refuse-back').click();
        await expect.poll(async () => (await view(p)).back?.refused).toBe(true);
        await expect(p.getByTestId('ask-back')).toHaveCount(0);
        count.refused++;
      } else {
        // Handed back without being asked: the turn comes back exactly as it was.
        await next.getByTestId('hand-back').click();
        await expect.poll(async () => (await view(p)).turn).toBe(kept.me);
        const now = await view(p);
        for (const k of ['stage', 'dice', 'hand', 'verts', 'edges', 'players', 'bank', 'offers', 'devPlayed'])
          expect(now[k], k).toEqual(kept[k]);
        count.handedBack++;
      }
      backStep++;
    };

    const playCard = async (p: Page, type: string) => {
      const card = type === 'playKnight' ? 'knight' : 'road';
      const on = await choose(p, 'confirmCard', count.card);
      const seq = (await view(p)).seq;
      await p.getByTestId(`play-${card}`).click();
      if (on) {
        await expect(p.getByRole('dialog')).toContainText(card === 'knight' ? 'Play Knight?' : 'Play Road');
        expect((await view(p)).seq).toBe(seq);
        await p.getByTestId('ask-yes').click();
      }
      await seqUp(p, seq);
    };

    /** Leave on one device, come back on another by picking the same name. */
    const rejoin = async () => {
      const old = pages[1]!;
      const seat = await seatOf(old);
      const mine = await settingsOf(old);
      await old.context().close();
      await expect(a.locator(`.player[data-seat="${seat}"]`)).toHaveClass(/away/);
      const fresh = await open(rejoinFrames);
      await fresh.goto(`${server.url}/r/${code}`);
      // Watching: pick your name to get your seat back.
      await fresh.locator('[data-testid=rejoin][data-name=Bob]').click();
      await expect.poll(() => seatOf(fresh)).toBe(seat);
      expect(await settingsOf(fresh)).toEqual(mine);
      await expect(a.locator(`.player[data-seat="${seat}"]`)).not.toHaveClass(/away/);
      pages[1] = fresh;
      rejoined = true;
    };

    const byHand = ['end', 'playKnight', 'playRoads'];
    let idle = 0;
    for (let step = 0; ; step++) {
      if (step > 30000) throw new Error('too many steps');
      const v = await view(a);
      if (v.phase === 'over') break;
      if (step % 200 === 0)
        console.log(`step ${step}: turn ${v.turnN}, stage ${v.stage}`, JSON.stringify(count));
      if (!rejoined && v.turnN >= 15 && v.stage === 'preroll') await rejoin();
      let moved = false;
      for (const p of pages) {
        const r: string = await p.evaluate((h) => (window as any).__settlers.botStep(h), byHand);
        if (r.startsWith('rejected')) throw new Error(`bot move ${r}`);
        if (r === 'skip:end') await endTurn(p);
        else if (r.startsWith('skip:')) await playCard(p, r.slice(5));
        if (r !== 'idle' && r !== 'busy') moved = true;
      }
      idle = moved ? 0 : idle + 1;
      if (idle > 200) throw new Error(`game stuck at ${(await view(a)).stage}\n${server.output}`);
      if (!moved) await a.waitForTimeout(20);
    }
    for (const p of pages) await expect(p.getByTestId('game-over')).toBeVisible();
    console.log(`polish game over after ${(await view(a)).turnN} turns`, JSON.stringify(count));

    // Every feature was used, and every setting both on and off.
    expect(rejoined).toBe(true);
    expect(rulesDone).toBe(true);
    expect(count.refused).toBe(1);
    expect(count.handedBack).toBe(2);
    for (const k of ['end', 'card', 'trade'] as const)
      expect(
        count[k].every((x) => x > 0),
        k,
      ).toBe(true);
    expect(errors).toEqual([]);

    // No browser was sent anything it shouldn't see, before or after rejoining.
    // The browser that left mid-game saw only part of it.
    checkFrames({ pages, frames, errors, code }, seats, 30);
    for (const f of rejoinFrames) {
      const raw = JSON.stringify(f);
      expect(raw).not.toContain('"rng"');
      if (f.game) expect(raw).not.toContain('"seed"');
      if (f.game) expect([null, seats[1]]).toContain(f.game.me);
    }
  } finally {
    await server.stop();
  }
});
