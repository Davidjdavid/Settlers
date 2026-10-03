import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientMsgSchema, type ClientMsg, type ServerMsg } from '../src/protocol';
import { Rooms, type Conn } from '../src/rooms';
import { Store } from '../src/store';
import { joinAs } from './util';
import {
  emptyMusic,
  musicOp,
  parseYouTube,
  positionAt,
  MUSIC_QUEUE_MAX,
  type MusicOp,
  type MusicState,
} from '../src/music';

describe('YouTube links (SPEC 12.1)', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { kind: 'video', id: 'dQw4w9WgXcQ' }],
    ['youtube.com/watch?v=dQw4w9WgXcQ&feature=share', { kind: 'video', id: 'dQw4w9WgXcQ' }],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', { kind: 'video', id: 'dQw4w9WgXcQ', start: 42 }],
    ['https://youtu.be/dQw4w9WgXcQ?t=1m30s', { kind: 'video', id: 'dQw4w9WgXcQ', start: 90 }],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', { kind: 'video', id: 'dQw4w9WgXcQ' }],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', { kind: 'video', id: 'dQw4w9WgXcQ' }],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', { kind: 'video', id: 'dQw4w9WgXcQ' }],
    [
      'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      { kind: 'playlist', id: 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' },
    ],
    // A song opened from a playlist or a Mix plays that song, not the list from its start
    // (3 October: "plays the wrong songs").
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      { kind: 'video', id: 'dQw4w9WgXcQ' },
    ],
    [
      'https://www.youtube.com/watch?v=9bZkp7q19f0&list=RD9bZkp7q19f0&start_radio=1',
      { kind: 'video', id: '9bZkp7q19f0' },
    ],
  ] as const)('%s', (url, want) => {
    expect(parseYouTube(url)).toEqual(want);
  });

  it.each([
    'https://vimeo.com/123456',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>',
    'not a link at all',
    'javascript:alert(1)',
    'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ',
  ])('refuses %s', (url) => {
    expect(parseYouTube(url)).toBeNull();
  });
});

const V = 'https://youtu.be/dQw4w9WgXcQ';
const V2 = 'https://youtu.be/9bZkp7q19f0';
const L = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';

function run(ops: [MusicOp, number][], st: MusicState = emptyMusic()) {
  const notes: string[] = [];
  for (const [op, now] of ops) {
    const r = musicOp(st, op, 'Ann', now);
    if (!r.ok) throw new Error(r.error);
    st = r.st;
    if (r.note) notes.push(r.note);
  }
  return { st, notes };
}

describe('the shared player (SPEC 12.1)', () => {
  it('the first link plays at once; the rest queue', () => {
    const { st, notes } = run([
      [{ k: 'add', url: V }, 1000],
      [{ k: 'add', url: L }, 2000],
    ]);
    expect(st.queue.map((x) => x.kind)).toEqual(['video', 'playlist']);
    expect(st.playing).toBe(true);
    expect(positionAt(st, 11_000)).toBe(10);
    expect(notes).toEqual(['Ann added a song', 'Ann added a playlist to the queue']);
  });

  it('a link with t= starts there', () => {
    const { st } = run([[{ k: 'add', url: 'https://youtu.be/dQw4w9WgXcQ?t=30' }, 1000]]);
    expect(positionAt(st, 1000)).toBe(30);
    expect(positionAt(st, 6000)).toBe(35);
  });

  it('pause keeps the place; play carries on from it', () => {
    let { st } = run([[{ k: 'add', url: V }, 0]]);
    ({ st } = run([[{ k: 'pause' }, 20_000]], st));
    expect(st.playing).toBe(false);
    expect(positionAt(st, 99_000)).toBe(20);
    ({ st } = run([[{ k: 'play' }, 50_000]], st));
    expect(positionAt(st, 55_000)).toBe(25);
  });

  it('skip and a video ending move on; reports about something already gone change nothing', () => {
    let { st } = run([
      [{ k: 'add', url: V }, 0],
      [{ k: 'add', url: V2 }, 0],
      [{ k: 'add', url: L }, 0],
    ]);
    const v0 = st.ver;
    ({ st } = run([[{ k: 'ended', ver: v0 }, 5000]], st));
    expect(st.queue[0]!.id).toBe('9bZkp7q19f0');
    expect(positionAt(st, 6000)).toBe(1);
    // Every other screen reports the same end a moment later: ignored.
    const same = musicOp(st, { k: 'ended', ver: v0 }, 'Bob', 5100);
    expect(same.ok && same.st).toEqual(st);
    ({ st } = run([[{ k: 'skip', ver: st.ver }, 7000]], st));
    // A playlist goes through its videos before the queue moves on.
    expect(st.queue[0]!.kind).toBe('playlist');
    expect(st.index).toBe(0);
    ({ st } = run([[{ k: 'ended', ver: st.ver }, 8000]], st));
    expect(st.index).toBe(1);
    ({ st } = run([[{ k: 'ended', ver: st.ver, last: true }, 9000]], st));
    expect(st.queue).toEqual([]);
    expect(st.playing).toBe(false);
  });

  it('a video that won’t play is skipped for everyone, once', () => {
    let { st } = run([
      [{ k: 'add', url: V }, 0],
      [{ k: 'add', url: V2 }, 0],
    ]);
    const v = st.ver;
    const r = run(
      [
        [{ k: 'error', ver: v }, 100],
        [{ k: 'error', ver: v }, 120],
      ],
      st,
    );
    expect(r.st.queue.map((x) => x.id)).toEqual(['9bZkp7q19f0']);
    expect(r.notes).toEqual(['A video couldn’t be played here, so it was skipped']);
    st = r.st;
    expect(st.playing).toBe(true);
  });

  it('stop stops the music for everyone and keeps the queue; clear takes off only what waits', () => {
    let { st, notes } = run([
      [{ k: 'add', url: V }, 0],
      [{ k: 'add', url: V2 }, 0],
      [{ k: 'add', url: L }, 0],
      [{ k: 'stop' }, 30_000],
    ]);
    expect(st.queue.map((x) => x.id)).toEqual([
      'dQw4w9WgXcQ',
      '9bZkp7q19f0',
      'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    ]);
    expect(st.playing).toBe(false);
    // Back to the start of the song: Play starts it again from the top.
    expect(positionAt(st, 99_000)).toBe(0);
    ({ st } = run([[{ k: 'play' }, 40_000]], st));
    expect(positionAt(st, 45_000)).toBe(5);
    ({ st, notes } = run([[{ k: 'clear' }, 50_000]], st));
    expect(st.queue.map((x) => x.id)).toEqual(['dQw4w9WgXcQ']);
    expect(st.playing).toBe(true);
    expect(notes).toEqual(['Ann cleared the queue']);
  });

  it('a title is only kept for what is playing: the video, or the playlist video it came from', () => {
    let { st } = run([[{ k: 'add', url: L }, 0]]);
    // A screen still showing another video of the playlist: ignored.
    ({ st } = run([[{ k: 'title', ver: st.ver, title: 'Old song', index: 3 }, 0]], st));
    expect(st.queue[0]!.title).toBeUndefined();
    ({ st } = run([[{ k: 'title', ver: st.ver, title: 'First song', index: 0 }, 0]], st));
    expect(st.queue[0]).toMatchObject({ title: 'First song', titleAt: 0 });
    // On to the next video: its own title replaces it.
    ({ st } = run([[{ k: 'ended', ver: st.ver, last: false }, 1000]], st));
    ({ st } = run([[{ k: 'title', ver: st.ver, title: 'Second song', index: 1 }, 0]], st));
    expect(st.queue[0]).toMatchObject({ title: 'Second song', titleAt: 1 });
    // A video in a playlist that won't play: on to the playlist's next video, not past it all.
    ({ st } = run([[{ k: 'error', ver: st.ver, last: false }, 2000]], st));
    expect([st.queue.length, st.index]).toEqual([1, 2]);
  });

  it('the first title heard stands (screens in other languages can be sent another one)', () => {
    let { st } = run([[{ k: 'add', url: V }, 0]]);
    ({ st } = run([[{ k: 'title', ver: st.ver, title: 'Never Gonna Give You Up' }, 0]], st));
    const again = musicOp(st, { k: 'title', ver: st.ver, title: 'Nunca te voy a dejar' }, 'Bob', 0);
    expect(again.ok && again.st).toBe(st);
    expect(st.queue[0]!.title).toBe('Never Gonna Give You Up');
    // A playlist: one title per video of it, the first heard.
    ({ st } = run(
      [
        [{ k: 'add', url: L }, 0],
        [{ k: 'skip', ver: st.ver }, 0],
      ],
      st,
    ));
    ({ st } = run([[{ k: 'title', ver: st.ver, title: 'Song A', index: 0 }, 0]], st));
    const b = musicOp(st, { k: 'title', ver: st.ver, title: 'Canción A', index: 0 }, 'Bob', 0);
    expect(b.ok && b.st).toBe(st);
    ({ st } = run([[{ k: 'ended', ver: st.ver, last: false }, 0]], st));
    ({ st } = run([[{ k: 'title', ver: st.ver, title: 'Song B', index: 1 }, 0]], st));
    expect([st.queue[0]!.title, st.queue[0]!.titleAt]).toEqual(['Song B', 1]);
  });

  it('taking a song off the queue takes off that song, even if the queue moved on first', () => {
    let { st } = run([
      [{ k: 'add', url: V }, 0],
      [{ k: 'add', url: V2 }, 0],
      [{ k: 'add', url: L }, 0],
    ]);
    const list = st.queue[2]!.id;
    // The first song ends just before the click on the playlist's ✕ (shown third) arrives.
    ({ st } = run([[{ k: 'ended', ver: st.ver }, 0]], st));
    ({ st } = run([[{ k: 'remove', i: 2, id: list }, 0]], st));
    expect(st.queue.map((x) => x.id)).toEqual(['9bZkp7q19f0']);
    expect(musicOp(st, { k: 'remove', i: 1, id: list }, 'Ann', 0)).toEqual({
      ok: false,
      error: 'That isn’t in the queue',
    });
  });

  it('pressing what is already so changes nothing (no save, no broadcast)', () => {
    const { st } = run([[{ k: 'add', url: V }, 0]]);
    const play = musicOp(st, { k: 'play' }, 'Bob', 5);
    expect(play.ok && play.st).toBe(st);
    const paused = run([[{ k: 'pause' }, 5]], st).st;
    const pause = musicOp(paused, { k: 'pause' }, 'Bob', 6);
    expect(pause.ok && pause.st).toBe(paused);
    const empty = emptyMusic();
    const none = musicOp(empty, { k: 'play' }, 'Bob', 0);
    expect(none.ok && none.st).toBe(empty);
  });

  it('titles, removing from the queue, and the limits', () => {
    let { st } = run([
      [{ k: 'add', url: V }, 0],
      [{ k: 'add', url: V2 }, 0],
    ]);
    ({ st } = run([[{ k: 'title', ver: st.ver, title: '  Never   Gonna\nGive You Up ' }, 0]], st));
    expect(st.queue[0]!.title).toBe('Never Gonna Give You Up');
    expect(musicOp(st, { k: 'remove', i: 0 }, 'Ann', 0)).toEqual({
      ok: false,
      error: 'That isn’t in the queue',
    });
    ({ st } = run([[{ k: 'remove', i: 1 }, 0]], st));
    expect(st.queue).toHaveLength(1);
    ({ st } = run([[{ k: 'clear' }, 0]], st));
    expect(st.queue).toHaveLength(1);
    expect(musicOp(st, { k: 'add', url: 'https://vimeo.com/1' }, 'Ann', 0)).toEqual({
      ok: false,
      error: 'That isn’t a YouTube video or playlist link',
    });
    for (let i = st.queue.length; i < MUSIC_QUEUE_MAX; i++) ({ st } = run([[{ k: 'add', url: V }, 0]], st));
    expect(musicOp(st, { k: 'add', url: V }, 'Ann', 0)).toEqual({
      ok: false,
      error: 'The music queue is full',
    });
  });
});

/* ---------- Through the server ---------- */

class FakeConn implements Conn {
  room: Conn['room'] = null;
  pid: string | null = null;
  msgs: ServerMsg[] = [];
  send(m: ServerMsg) {
    this.msgs.push(structuredClone(m));
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> {
    const m = [...this.msgs].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`no ${t} message`);
    return m as Extract<ServerMsg, { t: T }>;
  }
  /** The room as this screen last heard it. */
  room_() {
    const m = [...this.msgs].reverse().find((x) => x.t === 'sync' || x.t === 'update');
    return (m as Extract<ServerMsg, { t: 'sync' }>).room;
  }
}

describe('music through the server (SPEC 12.2)', () => {
  let dir: string;
  let store: Store;
  let rooms: Rooms;
  let clock = 1_000_000;
  const open = () => (rooms = new Rooms(store, { log: () => {}, now: () => clock }));
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settlers-music-'));
    store = new Store(join(dir, 'test.db'));
    open();
  });
  afterEach(() => {
    rooms.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const send = (c: FakeConn, m: ClientMsg) => rooms.handle(c, ClientMsgSchema.parse(m));

  it('anyone in the room adds and controls it; everyone gets the same timing; it survives a restart', () => {
    const ann = new FakeConn();
    send(ann, { t: 'create' });
    const code = ann.last('sync').room.code;
    send(ann, joinAs(store, 'Ann', 'red'));
    const watcher = new FakeConn();
    send(watcher, { t: 'hello', room: code });
    expect(ann.room_().music).toBeUndefined();

    send(ann, { t: 'music', op: { k: 'add', url: 'https://youtu.be/dQw4w9WgXcQ' } });
    const m = watcher.room_().music!;
    expect(m.queue[0]).toMatchObject({ kind: 'video', id: 'dQw4w9WgXcQ', by: 'Ann' });
    expect(m).toMatchObject({ playing: true, started: clock, now: clock });
    expect(JSON.stringify(watcher.last('update').log)).toContain('Ann added a song');

    // A watcher can pause it too; the log says "Someone".
    clock += 30_000;
    send(watcher, { t: 'music', op: { k: 'pause' } });
    expect(ann.room_().music).toMatchObject({ playing: false, pos: 30 });
    expect(JSON.stringify(ann.last('update').log)).toContain('Someone paused the music');

    // Not a YouTube link: only the sender hears about it.
    const before = ann.msgs.length;
    send(watcher, { t: 'music', op: { k: 'add', url: 'https://open.spotify.com/track/x' } });
    expect(watcher.last('error').text).toBe('That isn’t a YouTube video or playlist link');
    expect(ann.msgs.length).toBe(before);
    // Unknown shapes never get in.
    expect(() => send(ann, { t: 'music', op: { k: 'add', url: 5 } } as never)).toThrow();

    // A restart keeps the queue and the place; a late joiner hears it with the server's clock.
    clock += 60_000;
    rooms.stop();
    open();
    const late = new FakeConn();
    send(late, { t: 'hello', room: code });
    expect(late.room_().music).toMatchObject({ playing: false, pos: 30, now: clock });
    send(late, { t: 'music', op: { k: 'play' } });
    clock += 5_000;
    expect((clock - late.room_().music!.started) / 1000).toBe(35);
  });
});
