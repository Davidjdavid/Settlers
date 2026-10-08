/*
 * Table music (SPEC 12) with a stand-in for YouTube's player (YouTube isn't reachable from the test
 * machines; window.__settlersFakeYT swaps it in). Three browsers in a room: one adds a link and all
 * play it at the same point; one browser's sound is blocked until it's clicked; pause, play, skip,
 * a playlist moving on by itself (as YouTube does) and its titles, a video that won't play, a late
 * joiner and a reload all stay in step; volume and mute apply on that screen at once, for a watcher
 * too, and are kept (mute pauses only that screen); the music carries on into the game, where Stop
 * goes back to the start of the song for everyone and keeps the queue, and Clear asks first.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { TestServer, freePort } from './server';
import { seatedTable, startGame } from './table';

const SHOTS = process.env.SHOTS;
test.use({ actionTimeout: 15_000 });
test.setTimeout(5 * 60_000);

interface FakeState {
  kind: string | null;
  id: string | null;
  index: number;
  playing: boolean;
  at: number;
  vol: number;
  muted: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook returns plain JSON
const music = (p: Page): Promise<{ player: FakeState | null; blocked: boolean }> =>
  p.evaluate(() => (window as any).__settlers.music());
const player = async (p: Page) => (await music(p)).player;

/** Every page plays `id` (or pauses), all within 1.5 s of each other. */
async function inStep(pages: Page[], id: string, playing: boolean) {
  for (const p of pages)
    await expect.poll(async () => [(await player(p))?.id, (await player(p))?.playing]).toEqual([id, playing]);
  const ats = await Promise.all(pages.map(async (p) => (await player(p))!.at));
  expect(Math.max(...ats) - Math.min(...ats), `positions ${ats}`).toBeLessThan(1.5);
  return ats[0]!;
}

async function openMusic(p: Page) {
  await p.getByTestId('open-music').click();
  await expect(p.getByTestId('music')).toBeVisible();
}

async function fakeBrowser(browser: Browser, server: TestServer, code: string, blocked = false) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    (b) => Object.assign(window, { __settlersFakeYT: b ? { blocked: true } : true }),
    blocked,
  );
  const p = await ctx.newPage();
  await p.goto(server.url);
  await p.fill('#pass', server.passphrase);
  await p.click('button:has-text("Enter")');
  await p.goto(`${server.url}/r/${code}`);
  return p;
}

const SONG = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SONG2 = 'https://youtu.be/9bZkp7q19f0';
const LIST = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';

test('shared music: in step for everyone, each with their own volume', async ({ browser }) => {
  const server = new TestServer(await freePort(), 'music');
  await server.start();
  try {
    // The stand-in player in every browser seatedTable opens (Cat's sound blocked until a click).
    const orig = browser.newContext.bind(browser);
    let n = 0;
    browser.newContext = async (o) => {
      const ctx = await orig(o);
      const blocked = n++ === 2;
      await ctx.addInitScript(
        (b) => Object.assign(window, { __settlersFakeYT: b ? { blocked: true } : true }),
        blocked,
      );
      return ctx;
    };
    const t = await seatedTable(browser, server, ['Ann', 'Bob', 'Cat']);
    browser.newContext = orig;
    const [a, b, c] = t.pages as [Page, Page, Page];

    /* ---------- A link, played for everyone ---------- */
    await openMusic(a);
    await a.getByTestId('music-link').fill('https://open.spotify.com/track/123');
    await a.getByTestId('music-add').click();
    await expect(a.getByTestId('toast').last()).toContainText('That isn’t a YouTube video or playlist link');
    await a.getByTestId('music-link').fill(SONG);
    await a.getByTestId('music-add').click();
    await expect(a.getByTestId('music-now')).toContainText('added by Ann');
    // Cat's browser hasn't been clicked: it asks, and joins on a click.
    await expect(c.getByTestId('music-join')).toBeVisible({ timeout: 15_000 });
    expect((await player(c))!.playing).toBe(false);
    await c.getByTestId('music-join').click();
    await inStep([a, b, c], 'dQw4w9WgXcQ', true);
    await expect(c.getByTestId('music-join')).toHaveCount(0);
    // The title, once a player knows it, shows for everyone.
    await expect(a.getByTestId('music-now')).toContainText('Song dQw4w9WgXcQ', { timeout: 15_000 });
    if (SHOTS) await a.screenshot({ path: `${SHOTS}/music-sheet.png` });

    // A slow connection buffers for a while: that isn't blocked sound, so no "Click to join".
    await b.evaluate(() => (window as any).__settlers.musicBuffer(true)); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < 8; i++) {
      await b.waitForTimeout(500);
      await expect(b.getByTestId('music-join')).toHaveCount(0);
    }
    await b.evaluate(() => (window as any).__settlers.musicBuffer(false)); // eslint-disable-line @typescript-eslint/no-explicit-any
    await inStep([a, b, c], 'dQw4w9WgXcQ', true);

    /* ---------- Pause and play, from another screen ---------- */
    await openMusic(b);
    await b.getByTestId('music-pause').click();
    const pausedAt = await inStep([a, b, c], 'dQw4w9WgXcQ', false);
    await a.waitForTimeout(1500);
    expect((await player(c))!.at).toBe(pausedAt);
    await b.getByTestId('music-play').click();
    await inStep([a, b, c], 'dQw4w9WgXcQ', true);

    /* ---------- The queue, skip, a playlist moving on, a video that won't play ---------- */
    for (const url of [SONG2, LIST]) {
      await b.getByTestId('music-link').fill(url);
      await b.getByTestId('music-add').click();
    }
    await expect(a.getByTestId('music-queue').locator('li')).toHaveCount(2);
    await a.getByTestId('music-skip').click();
    await inStep([a, b, c], '9bZkp7q19f0', true);
    // The video won't play on one screen: skipped for everyone, once.
    await c.evaluate(() => (window as any).__settlers.musicFail()); // eslint-disable-line @typescript-eslint/no-explicit-any
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    await expect(a.getByTestId('music-now')).toContainText('Song PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf #1', {
      timeout: 15_000,
    });
    // YouTube goes on to the playlist's next video by itself on one screen: everyone follows it
    // (the others' reports are ignored: test/music.test.ts), and that screen isn't restarted.
    await a.waitForTimeout(2000);
    await b.evaluate(() => (window as any).__settlers.musicAdvance()); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const p of t.pages) await expect.poll(async () => (await player(p))!.index).toBe(1);
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    // The title shown is the new video's, never the last one's.
    await expect(a.getByTestId('music-title')).not.toContainText('#1');
    await expect(a.getByTestId('music-title')).toContainText('#2', { timeout: 15_000 });
    await expect(a.getByTestId('music-title')).toContainText('song 2 of the playlist');

    // A redraw long after the last message about the music (a toast, here) keeps it in step.
    await a.waitForTimeout(4000);
    await a.getByTestId('music-link').fill('https://vimeo.com/1');
    await a.getByTestId('music-add').click();
    await expect(a.getByTestId('toast').last()).toContainText('That isn’t a YouTube');
    await a.waitForTimeout(1500);
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);

    /* ---------- A late joiner, and a reload ---------- */
    await a.waitForTimeout(2500);
    const late = await fakeBrowser(browser, server, t.code);
    await late.locator('body').click({ position: { x: 5, y: 5 } });
    await inStep([a, b, late], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    expect((await player(late))!.index).toBe(1);
    await b.reload();
    await b.locator('body').click({ position: { x: 5, y: 5 } });
    await inStep([a, b, c, late], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);

    /* ---------- Volume and mute are your own: at once, kept, and for a watcher too ---------- */
    await a.getByTestId('music-volume').fill('20');
    expect((await player(a))!.vol).toBe(20); // straight away, no wait for the server
    await a.getByTestId('music-mute').check();
    // Mute pauses this screen only (it works on every device); everyone else plays on.
    await expect
      .poll(async () => [(await player(a))!.vol, (await player(a))!.muted, (await player(a))!.playing])
      .toEqual([20, true, false]);
    expect([(await player(b))!.vol, (await player(b))!.muted, (await player(b))!.playing]).toEqual([
      60,
      false,
      true,
    ]);
    await expect(a.getByTestId('music-join')).toHaveCount(0);
    await a.reload();
    await a.locator('body').click({ position: { x: 5, y: 5 } });
    await expect
      .poll(async () => [(await player(a))?.vol, (await player(a))?.muted, (await player(a))?.playing])
      .toEqual([20, true, false]);
    await a.waitForTimeout(3000);
    // Unmuted: back in, where everyone is.
    await openMusic(a);
    await a.getByTestId('music-mute').uncheck();
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    // Someone watching (not seated) has a volume and mute too.
    await openMusic(late);
    await late.getByTestId('music-volume').fill('35');
    await late.getByTestId('music-mute').check();
    await expect
      .poll(async () => [(await player(late))!.vol, (await player(late))!.playing])
      .toEqual([35, false]);
    await late.getByTestId('music-mute').uncheck();
    await inStep([a, b, late], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    await late.close();
    await a.getByTestId('music-close').click();

    /* ---------- Into the game: the music carries on ---------- */
    await startGame(a);
    for (const p of t.pages) await expect(p.locator('#board')).toBeVisible();
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    await openMusic(c);
    if (SHOTS) await c.screenshot({ path: `${SHOTS}/music-game.png` });
    // Stop: everyone back to the start of the song, stopped; the queue stays, and Play goes on.
    for (const url of [SONG, SONG2]) {
      await c.getByTestId('music-link').fill(url);
      await c.getByTestId('music-add').click();
    }
    await expect(c.getByTestId('music-queue').locator('li')).toHaveCount(2);
    await c.getByTestId('music-stop').click();
    expect(await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', false)).toBe(0);
    await expect(c.getByTestId('music-now')).toContainText('Stopped');
    await expect(c.getByTestId('music-queue').locator('li')).toHaveCount(2);
    await c.getByTestId('music-play').click();
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    // Clear takes off what waits, once confirmed; the song playing carries on.
    await c.getByTestId('music-clear').click();
    await expect(c.getByTestId('music-queue').locator('li')).toHaveCount(2);
    await c.getByTestId('music-clear-yes').click();
    await expect(c.getByTestId('music-queue')).toHaveCount(0);
    await inStep([a, b, c], 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', true);
    // The log (shown in the game) has what happened, before the game and in it.
    const log = c.getByTestId('log');
    for (const line of [
      'Ann added a song',
      'Bob paused the music',
      'A video couldn’t be played here, so it was skipped',
      'Cat stopped the music',
      'Cat cleared the queue',
    ])
      await expect(log).toContainText(line);
    expect(t.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
