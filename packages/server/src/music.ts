/*
 * Table music (SPEC 12): one shared YouTube player per room. The server keeps the queue and when
 * the current item started, on its own clock; every screen plays the same thing at the same point.
 * Pure functions here; rooms.ts saves and broadcasts.
 */

export interface MusicItem {
  kind: 'video' | 'playlist';
  id: string;
  /** Who added it (a name, for the queue). */
  by: string;
  /** The title, once a screen has loaded it (for a playlist: of its video number `titleAt`). */
  title?: string;
  titleAt?: number;
  /** Start this far in (seconds), from a link with t=…; only for the first play. */
  start?: number;
}

export interface MusicState {
  /** queue[0] is playing (or paused); the rest wait their turn. */
  queue: MusicItem[];
  /** For a playlist: which of its videos. */
  index: number;
  playing: boolean;
  /** Server time (ms) at which the current video's position was 0, while playing. */
  started: number;
  /** Position (s) while paused. */
  pos: number;
  /** Bumped whenever what's playing or where changes, so stale reports are ignored. */
  ver: number;
}

export type MusicOp =
  | { k: 'add'; url: string }
  | { k: 'play' }
  | { k: 'pause' }
  | { k: 'skip'; ver: number; last?: boolean }
  | { k: 'ended'; ver: number; last?: boolean }
  | { k: 'error'; ver: number; last?: boolean }
  | { k: 'title'; ver: number; title: string; index?: number }
  | { k: 'remove'; i: number; id?: string }
  | { k: 'stop' }
  | { k: 'clear' };

export const MUSIC_QUEUE_MAX = 50;

/** A saved music state that still looks right (a bad one is dropped, not trusted). */
export function isMusic(x: unknown): x is MusicState {
  const m = x as MusicState;
  return (
    !!m &&
    Array.isArray(m.queue) &&
    m.queue.length <= MUSIC_QUEUE_MAX &&
    m.queue.every((q) => (q.kind === 'video' || q.kind === 'playlist') && typeof q.id === 'string') &&
    [m.index, m.started, m.pos, m.ver].every((n) => typeof n === 'number') &&
    typeof m.playing === 'boolean'
  );
}

export const emptyMusic = (): MusicState => ({
  queue: [],
  index: 0,
  playing: false,
  started: 0,
  pos: 0,
  ver: 0,
});

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,64}$/;

/** A YouTube video or playlist from a link someone pasted; null if it isn't one. */
export function parseYouTube(raw: string): Pick<MusicItem, 'kind' | 'id' | 'start'> | null {
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let video: string | null = null;
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') video = u.searchParams.get('v');
    else {
      const m = /^\/(shorts|embed|live|v)\/([^/]+)/.exec(u.pathname);
      if (m) video = m[2]!;
    }
  } else return null;
  const list = u.searchParams.get('list');
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  const start = t ? parseTime(t) : 0;
  // A playlist's own page plays the playlist. A link to a video that happens to come from a
  // playlist or a Mix (watch?v=…&list=…) plays that video: it's the song the person was hearing.
  if (list && LIST.test(list) && (u.pathname === '/playlist' || !video))
    return { kind: 'playlist', id: list };
  if (video && VIDEO.test(video))
    return start ? { kind: 'video', id: video, start } : { kind: 'video', id: video };
  return null;
}

/** "90", "1m30s", "1h2m3s" → seconds. */
function parseTime(t: string): number {
  if (/^\d+$/.test(t)) return Math.min(Number(t), 24 * 3600);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m) return 0;
  return Math.min(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0), 24 * 3600);
}

/** Where the current video is (seconds) at server time `now`. */
export function positionAt(st: MusicState, now: number): number {
  return st.playing ? Math.max(0, (now - st.started) / 1000) : st.pos;
}

/** Start the current item (queue[0]) from its beginning (or its link's start), playing. */
function startCurrent(st: MusicState, now: number, index = 0) {
  st.index = index;
  const start = index === 0 ? (st.queue[0]?.start ?? 0) : 0;
  st.playing = st.queue.length > 0;
  st.started = now - start * 1000;
  st.pos = st.queue.length ? start : 0;
  st.ver++;
}

/** Move on from the current video: the next in its playlist, or the next item in the queue. */
function advance(st: MusicState, now: number, last: boolean) {
  const cur = st.queue[0];
  if (cur?.kind === 'playlist' && !last) return startCurrent(st, now, st.index + 1);
  st.queue.shift();
  startCurrent(st, now);
}

/**
 * Apply one change by `who` at server time `now`. Returns the new state and a line for the log, or
 * an error to show. Reports about something no longer playing (an old `ver`) change nothing.
 */
export function musicOp(
  st0: MusicState,
  op: MusicOp,
  who: string,
  now: number,
): { ok: true; st: MusicState; note?: string } | { ok: false; error: string } {
  const st = structuredClone(st0);
  const stale = 'ver' in op && op.ver !== st.ver;
  switch (op.k) {
    case 'add': {
      const yt = parseYouTube(op.url);
      if (!yt) return { ok: false, error: 'That isn’t a YouTube video or playlist link' };
      if (st.queue.length >= MUSIC_QUEUE_MAX) return { ok: false, error: 'The music queue is full' };
      st.queue.push({ ...yt, by: who });
      if (st.queue.length === 1) startCurrent(st, now);
      const what = yt.kind === 'playlist' ? 'a playlist' : 'a song';
      return { ok: true, st, note: `${who} added ${what}${st.queue.length > 1 ? ' to the queue' : ''}` };
    }
    case 'play':
      if (!st.queue.length || st.playing) return { ok: true, st: st0 };
      st.playing = true;
      st.started = now - st.pos * 1000;
      st.ver++;
      return { ok: true, st, note: `${who} played the music` };
    case 'pause':
      if (!st.playing) return { ok: true, st: st0 };
      st.pos = positionAt(st, now);
      st.playing = false;
      st.ver++;
      return { ok: true, st, note: `${who} paused the music` };
    case 'skip':
      if (stale || !st.queue.length) return { ok: true, st: st0 };
      advance(st, now, !!op.last);
      return { ok: true, st, note: `${who} skipped to the next song` };
    case 'ended':
      if (stale || !st.queue.length) return { ok: true, st: st0 };
      advance(st, now, !!op.last);
      return { ok: true, st };
    case 'error':
      if (stale || !st.queue.length) return { ok: true, st: st0 };
      // A video that won't play is skipped for everyone: in a playlist, on to its next video.
      advance(st, now, op.last ?? true);
      return { ok: true, st, note: 'A video couldn’t be played here, so it was skipped' };
    case 'title': {
      const cur = st.queue[0];
      if (stale || !cur) return { ok: true, st: st0 };
      // A playlist's title is for one of its videos: only the one playing now.
      if (cur.kind === 'playlist' && op.index !== st.index) return { ok: true, st: st0 };
      const title = op.title.replace(/\s+/g, ' ').trim().slice(0, 120);
      const at = cur.kind === 'playlist' ? st.index : undefined;
      // The first title heard stands: screens in other languages can be told another one, and
      // would otherwise take turns changing it.
      if (!title || (cur.title && cur.titleAt === at)) return { ok: true, st: st0 };
      cur.title = title;
      if (at === undefined) delete cur.titleAt;
      else cur.titleAt = at;
      return { ok: true, st };
    }
    case 'remove': {
      // The song the person saw there: the queue may have moved on before the click arrived.
      let i = op.i;
      if (op.id !== undefined && st.queue[i]?.id !== op.id) {
        const near = st.queue.map((x, j) => (j >= 1 && x.id === op.id ? j : -1)).filter((j) => j >= 0);
        i = near.sort((a, b) => Math.abs(a - op.i) - Math.abs(b - op.i))[0] ?? -1;
      }
      if (!(i >= 1 && i < st.queue.length)) return { ok: false, error: 'That isn’t in the queue' };
      st.queue.splice(i, 1);
      return { ok: true, st, note: `${who} took a song off the queue` };
    }
    case 'stop':
      // Stops the music for everyone and goes back to the start of the song; the queue stays.
      if (!st.queue.length || (!st.playing && st.pos === 0)) return { ok: true, st: st0 };
      st.playing = false;
      st.pos = 0;
      st.ver++;
      return { ok: true, st, note: `${who} stopped the music` };
    case 'clear':
      // Takes off the songs waiting their turn; what's playing carries on.
      if (st.queue.length < 2) return { ok: true, st: st0 };
      st.queue = st.queue.slice(0, 1);
      return { ok: true, st, note: `${who} cleared the queue` };
  }
}
