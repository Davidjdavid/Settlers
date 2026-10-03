/*
 * Table music (SPEC 12): one hidden YouTube player per screen, kept in step with the room's music
 * on the server (what's playing, and when it started on the server's clock). The music sheet adds
 * links, plays, pauses and skips for everyone; volume and mute are your own, saved on your profile.
 * Tests swap the YouTube player for a stand-in (window.__settlersFakeYT), since YouTube isn't
 * reachable from the test machines.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerSettings, RoomInfo } from '@settlers/server/protocol';
import { client, useClient } from './net';
import { Sheet } from './Sheets';

type Music = NonNullable<RoomInfo['music']>;
type Item = Music['queue'][number];

/** What a screen needs from a player: YouTube's, or the tests' stand-in. */
interface Player {
  load(item: Item, index: number, at: number, play: boolean): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(at: number): void;
  time(): number;
  /** Is it actually playing (false while the browser blocks sound until a click)? */
  playing(): boolean;
  volume(vol: number, muted: boolean): void;
  /** Is the current video the last of its playlist (or not a playlist)? */
  last(): boolean;
  title(): string | null;
  /** What the player itself has on: its video, and for a playlist which of its videos. */
  current(): { id: string | null; index: number };
}
interface Events {
  ended(): void;
  error(): void;
}

/* ---------- YouTube ---------- */

/* eslint-disable @typescript-eslint/no-explicit-any -- YouTube's IFrame API has no types here */
let ytReady: Promise<any> | null = null;
function loadYouTube(): Promise<any> {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return ytReady;
}

function youTubePlayer(host: HTMLElement, ev: Events): Player {
  let yt: any = null;
  let queued: (() => void) | null = null;
  let vol: [number, boolean] = [60, false];
  const el = document.createElement('div');
  host.appendChild(el);
  void loadYouTube().then((YT) => {
    yt = new YT.Player(el, {
      width: 200,
      height: 120,
      playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0 },
      events: {
        onReady: () => {
          yt.setVolume(vol[0]);
          if (vol[1]) yt.mute();
          queued?.();
          queued = null;
        },
        onStateChange: (e: { data: number }) => {
          if (e.data === YT.PlayerState.ENDED) ev.ended();
        },
        onError: () => ev.error(),
      },
    });
  });
  const when = (f: () => void) => (yt?.loadVideoById ? f() : (queued = f));
  return {
    load(item, index, at, play) {
      when(() => {
        if (item.kind === 'playlist')
          yt[play ? 'loadPlaylist' : 'cuePlaylist']({
            list: item.id,
            listType: 'playlist',
            index,
            startSeconds: at,
          });
        else yt[play ? 'loadVideoById' : 'cueVideoById']({ videoId: item.id, startSeconds: at });
      });
    },
    play: () => when(() => yt.playVideo()),
    pause: () => when(() => yt.pauseVideo()),
    stop: () => when(() => yt.stopVideo()),
    seek: (at) => when(() => yt.seekTo(at, true)),
    time: () => (yt?.getCurrentTime ? yt.getCurrentTime() : 0),
    playing: () => yt?.getPlayerState?.() === 1,
    volume(v, muted) {
      vol = [v, muted];
      if (!yt?.setVolume) return;
      yt.setVolume(muted ? 0 : v);
      if (muted) yt.mute();
      else yt.unMute();
    },
    last() {
      const list = yt?.getPlaylist?.();
      return !list || yt.getPlaylistIndex() >= list.length - 1;
    },
    title: () => yt?.getVideoData?.()?.title || null,
    current: () => ({
      id: yt?.getVideoData?.()?.video_id || null,
      index: yt?.getPlaylistIndex ? Math.max(0, yt.getPlaylistIndex()) : 0,
    }),
  };
}

/* ---------- The tests' stand-in ---------- */

interface FakeState {
  kind: string | null;
  id: string | null;
  index: number;
  playing: boolean;
  at: number;
  since: number;
  vol: number;
  muted: boolean;
  /** Videos in each playlist (the stand-in's playlists all have 3). */
  listLength: number;
  blocked: boolean;
}

function fakePlayer(
  ev: Events,
  opts: { blocked?: boolean },
): Player & { state(): FakeState; end(): void; fail(): void; advance(): void } {
  const s: FakeState = {
    kind: null, id: null, index: 0, playing: false, at: 0, since: Date.now(), vol: 60, muted: false,
    listLength: 3, blocked: !!opts.blocked,
  }; // prettier-ignore
  const now = () => (s.playing ? s.at + (Date.now() - s.since) / 1000 : s.at);
  const set = (playing: boolean, at = now()) => {
    s.at = at;
    s.since = Date.now();
    s.playing = playing && !s.blocked;
  };
  // A click on the page unblocks sound, as in a real browser.
  if (s.blocked)
    window.addEventListener('pointerdown', () => (s.blocked = false), { once: true, capture: true });
  return {
    load(item, index, at, play) {
      s.kind = item.kind;
      s.id = item.id;
      s.index = index;
      set(play, at);
    },
    play: () => set(true),
    pause: () => set(false),
    stop() {
      s.kind = s.id = null;
      set(false, 0);
    },
    seek: (at) => set(s.playing, at),
    time: now,
    playing: () => s.playing,
    volume(v, muted) {
      s.vol = v;
      s.muted = muted;
    },
    last: () => s.kind !== 'playlist' || s.index >= s.listLength - 1,
    title: () => (s.id ? `Song ${s.id}${s.kind === 'playlist' ? ` #${s.index + 1}` : ''}` : null),
    current: () => ({ id: s.id, index: s.index }),
    state: () => ({ ...s, at: Math.round(now() * 10) / 10 }),
    end: () => ev.ended(),
    fail: () => ev.error(),
    // As YouTube does at the end of a video in a playlist: on to the next one by itself.
    advance() {
      if (s.kind !== 'playlist') return ev.ended();
      if (s.index >= s.listLength - 1) return ev.ended();
      s.index++;
      set(s.playing, 0);
    },
  };
}

/* ---------- Your volume (this screen first, kept on your profile) ---------- */

interface Mine {
  vol: number;
  muted: boolean;
}
const LOCAL = 'settlers.music';
const fromProfile = (s: PlayerSettings | null | undefined): Mine => ({
  vol: s?.music?.vol ?? 60,
  muted: !!s?.music?.muted,
});
/** This screen's volume: set here first (it changes the music at once), else the profile's. */
function readLocal(): Mine | null {
  try {
    const x = JSON.parse(localStorage.getItem(LOCAL) ?? 'null') as Mine | null;
    return x && typeof x.vol === 'number' && typeof x.muted === 'boolean' ? x : null;
  } catch {
    return null;
  }
}
const listeners = new Set<() => void>();
function setLocal(m: Mine) {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(m));
  } catch {
    // Private mode: the change still applies until the page closes.
  }
  current = m;
  for (const f of listeners) f();
}
let current: Mine | null = null;
/** Your volume and mute on this screen, live. */
function useMine(profile: PlayerSettings | null | undefined): Mine {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  current ??= readLocal();
  return current ?? fromProfile(profile);
}

/** iPhones and iPads don't let a page set YouTube's volume: their volume buttons do. */
const fixedVolume = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---------- Keeping in step ---------- */

const DRIFT = 3; // seconds out before a screen is put back in line (SPEC 12.1)
const LOADING = 4000; // ms after a load before what the player reports is trusted

/** Where the room's music is now, in seconds, by the server's clock. */
function expected(m: Music, offset: number): number {
  return m.playing ? Math.max(0, (Date.now() + offset - m.started) / 1000) : m.pos;
}

const itemKey = (x: Item) => `${x.kind}:${x.id}`;

/** The hidden player, mounted once while you're in a room. */
export function MusicHost() {
  const st = useClient();
  const m = st.room?.music;
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<
    (Player & Partial<{ state(): FakeState; end(): void; fail(): void; advance(): void }>) | null
  >(null);
  /** What this screen loaded: the room's `ver` then, and the item and playlist video. */
  const loaded = useRef<{ ver: number; key: string } | null>(null);
  /** What this screen last asked its player to load, and when (it reports the old video a moment). */
  const asked = useRef<{ item: string; index: number; at: number } | null>(null);
  const settling = () => !!asked.current && Date.now() - asked.current.at < LOADING;
  /** Which video of a playlist the player is on: what it was asked for while it loads. */
  const indexOn = (p: Player) => (settling() ? asked.current!.index : p.current().index);
  /** Is the player on the room's current item (and in a playlist, the right video of it)? */
  const onCurrent = (p: Player, m: Music) => {
    const cur = m.queue[0];
    if (!cur || asked.current?.item !== itemKey(cur)) return false;
    return cur.kind === 'video' || indexOn(p) === m.index;
  };
  const load = (p: Player, cur: Item, index: number, at: number, play: boolean) => {
    p.load(cur, index, at, play);
    asked.current = { item: itemKey(cur), index, at: Date.now() };
  };
  const offset = useRef(0);
  const latest = useRef(m);
  latest.current = m;
  const [blocked, setBlocked] = useState(false);
  const mine = useMine(st.room?.mySettings);
  const muted = useRef(mine.muted);
  muted.current = mine.muted;

  // The server's clock (SPEC 12.1: late joiners land in step), worked out once per message: a
  // redraw long after it would otherwise slip the clock and pull the music back.
  const heard = useRef<number | null>(null);
  if (m && heard.current !== m.now) {
    heard.current = m.now;
    offset.current = m.now - Date.now();
  }

  const send = (op: Parameters<typeof client.music>[0]) => client.music(op);
  const ensure = () => {
    if (player.current || !host.current) return player.current;
    const ev: Events = {
      // About what this screen loaded (its own `ver`), so a late report never skips the next one.
      ended: () => {
        if (loaded.current)
          send({ k: 'ended', ver: loaded.current.ver, last: player.current?.last() ?? true });
      },
      error: () => {
        if (loaded.current)
          send({ k: 'error', ver: loaded.current.ver, last: player.current?.last() ?? true });
      },
    };
    const fake = (window as { __settlersFakeYT?: { blocked?: boolean } | boolean }).__settlersFakeYT;
    player.current = fake
      ? fakePlayer(ev, typeof fake === 'object' ? fake : {})
      : youTubePlayer(host.current, ev);
    (window as { __settlersMusic?: unknown }).__settlersMusic = player.current;
    return player.current;
  };

  // What plays, and whether: whenever the room's music changes. Muted, this screen stays paused
  // (it works on every device) and joins in again where everyone is when unmuted.
  useEffect(() => {
    const cur = m?.queue[0];
    if (!m || !cur) {
      if (player.current && loaded.current) player.current.stop();
      loaded.current = asked.current = null;
      return;
    }
    const p = ensure();
    if (!p) return;
    const play = m.playing && !mine.muted;
    const key = `${cur.kind}:${cur.id}:${m.index}`;
    const want = expected(m, offset.current);
    if (loaded.current?.key !== key || !onCurrent(p, m)) {
      // Something else to play (a playlist that moved on by itself is already on it: no restart).
      loaded.current = { ver: m.ver, key };
      if (!onCurrent(p, m)) return load(p, cur, m.index, want, play);
    } else loaded.current = { ver: m.ver, key };
    // Playing, a little out is fine (a seek is a hiccup); paused or stopped, exactly where it is.
    if (Math.abs(p.time() - want) > (m.playing ? DRIFT : 0)) p.seek(want);
    if (play) p.play();
    else p.pause();
  }, [m?.ver, m?.playing, m?.queue[0]?.id, m?.index, mine.muted]);

  useEffect(() => {
    player.current?.volume(mine.vol, mine.muted);
  }, [mine.vol, mine.muted, m?.ver]);

  // Every second: a playlist that moved on by itself told to everyone; back in line if more than
  // 3 s out; the title once the player really has the song on; blocked sound noticed.
  useEffect(() => {
    const t = setInterval(() => {
      const cur = latest.current;
      const p = player.current;
      if (!cur?.queue.length || !p || muted.current) return setBlocked(false);
      const item = cur.queue[0]!;
      if (asked.current?.item !== itemKey(item) || settling()) return;
      const on = indexOn(p);
      if (item.kind === 'playlist' && on !== cur.index) {
        // YouTube went on to the playlist's next video: move everyone on with it (once: later
        // reports carry an old `ver`). Anything else: back to where the room is.
        if (on === cur.index + 1 && loaded.current)
          send({ k: 'ended', ver: loaded.current.ver, last: false });
        else load(p, item, cur.index, expected(cur, offset.current), cur.playing);
        return;
      }
      // A video: the player really on it (it keeps the last one a moment while loading).
      if (item.kind === 'video' && p.current().id !== item.id) return;
      if (cur.playing && p.playing()) {
        const want = expected(cur, offset.current);
        if (Math.abs(p.time() - want) > DRIFT) p.seek(want);
      }
      setBlocked(cur.playing && !p.playing());
      // The name, once the player has really been on this song a moment (it keeps the last
      // song's name while loading), tidied as the server keeps it.
      const raw = p.playing() ? p.title() : null;
      const title = raw?.replace(/\s+/g, ' ').trim().slice(0, 120);
      const known = item.kind === 'video' ? item.title : item.titleAt === cur.index ? item.title : undefined;
      if (title && title !== known)
        send(
          item.kind === 'playlist'
            ? { k: 'title', ver: cur.ver, title, index: cur.index }
            : { k: 'title', ver: cur.ver, title },
        );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /** Sound let through by a click: start, where everyone is. */
  const join = () => {
    const cur = latest.current;
    const p = player.current;
    if (!p || !cur) return;
    p.seek(expected(cur, offset.current));
    p.play();
  };

  // Sound blocked until a click: the first click anywhere starts it.
  useEffect(() => {
    if (!blocked) return;
    const go = join;
    window.addEventListener('pointerdown', go, { once: true });
    return () => window.removeEventListener('pointerdown', go);
  }, [blocked]);
  (window as { __settlersMusicBlocked?: boolean }).__settlersMusicBlocked = blocked;

  return (
    <>
      <div ref={host} className="musichost" aria-hidden="true" />
      {blocked && m?.queue.length ? (
        <button className="musicjoin" data-testid="music-join" onClick={join}>
          ♪ Click to join the music
        </button>
      ) : null}
    </>
  );
}

/* ---------- The button and the sheet ---------- */

/** What to call a queue item: its title, or what it is. */
function itemLabel(x: Item, m: Music | undefined, first: boolean): string {
  if (x.kind === 'video') return x.title ?? 'A song';
  const n = first && m ? m.index : 0;
  const title = x.titleAt === n ? x.title : undefined;
  return first && m
    ? `${title ?? 'A playlist'} · song ${m.index + 1} of the playlist`
    : (title ?? 'A playlist');
}

/** A small ♪ button for the top bar and the lobby: what's playing, and the music sheet. */
export function MusicButton({ onOpen }: { onOpen: () => void }) {
  const st = useClient();
  const m = st.room?.music;
  const cur = m?.queue[0];
  return (
    <button
      className={`btn small ghost musicbtn${cur && m?.playing ? ' playing' : ''}`}
      onClick={onOpen}
      data-testid="open-music"
      title={cur ? itemLabel(cur, m, true) : 'Play music for the table'}
    >
      ♪<span className="wide-only"> {cur ? (m?.playing ? 'Music' : 'Paused') : 'Music'}</span>
    </button>
  );
}

export function MusicSheet({ onClose }: { onClose: () => void }) {
  const st = useClient();
  const m = st.room?.music;
  const cur = m?.queue[0];
  const [link, setLink] = useState('');
  const settings = st.room?.mySettings ?? null;
  const mine = useMine(settings);
  const [clearing, setClearing] = useState(false);
  const fixed = fixedVolume();
  // Changes apply on this screen at once; seated, they're also kept on your profile a moment
  // after the slider stops (as the Sounds page does).
  const save = useRef<number | undefined>(undefined);
  const change = (next: Mine) => {
    setLocal(next);
    if (!settings) return;
    window.clearTimeout(save.current);
    save.current = window.setTimeout(
      () => client.saveSettings({ ...(client.state.room?.mySettings ?? settings), music: next }),
      350,
    );
  };
  const add = () => {
    if (!link.trim()) return;
    client.music({ k: 'add', url: link.trim() });
    setLink('');
  };
  return (
    <Sheet
      title="Music"
      sub="Everyone at the table hears the same thing. Your volume is your own."
      onClose={onClose}
      foot={
        <button className="btn" onClick={onClose} data-testid="music-close">
          Done
        </button>
      }
    >
      <div className="music" data-testid="music">
        <form
          className="row tight"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a YouTube video or playlist link"
            aria-label="YouTube link"
            data-testid="music-link"
          />
          <button className="btn small" type="submit" data-testid="music-add" disabled={!link.trim()}>
            Add
          </button>
        </form>
        {cur ? (
          <div className="nowplaying" data-testid="music-now">
            <span className="eyebrow">{m!.playing ? 'Playing' : m!.pos === 0 ? 'Stopped' : 'Paused'}</span>
            <b data-testid="music-title">{itemLabel(cur, m, true)}</b>
            <span className="small">added by {cur.by}</span>
            <div className="row tight">
              {m!.playing ? (
                <button
                  className="btn small"
                  onClick={() => client.music({ k: 'pause' })}
                  data-testid="music-pause"
                >
                  Pause
                </button>
              ) : (
                <button
                  className="btn small"
                  onClick={() => client.music({ k: 'play' })}
                  data-testid="music-play"
                >
                  Play
                </button>
              )}
              <button
                className="btn small"
                onClick={() =>
                  client.music({
                    k: 'skip',
                    ver: m!.ver,
                    last: (window as { __settlersMusic?: Player }).__settlersMusic?.last() ?? true,
                  })
                }
                data-testid="music-skip"
              >
                Skip
              </button>
              <button
                className="btn small ghost"
                onClick={() => client.music({ k: 'stop' })}
                data-testid="music-stop"
                title="Stop for everyone and go back to the start of the song. The queue stays."
              >
                Stop
              </button>
            </div>
          </div>
        ) : (
          <p className="small">Nothing playing. Paste a link to start the music for everyone.</p>
        )}
        {m && m.queue.length > 1 ? (
          <div className="musicqueuebox">
            <div className="row tight">
              <span className="eyebrow">Up next</span>
              {clearing ? (
                <>
                  <button
                    className="btn small danger"
                    onClick={() => {
                      client.music({ k: 'clear' });
                      setClearing(false);
                    }}
                    data-testid="music-clear-yes"
                  >
                    Yes, clear the queue
                  </button>
                  <button className="btn small ghost" onClick={() => setClearing(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button
                  className="btn small ghost"
                  onClick={() => setClearing(true)}
                  data-testid="music-clear"
                >
                  Clear the queue
                </button>
              )}
            </div>
            <ol className="musicqueue" data-testid="music-queue">
              {m.queue.slice(1).map((x, i) => (
                <li key={`${i}-${x.id}`}>
                  <span>{itemLabel(x, m, false)}</span>
                  <span className="small"> · {x.by}</span>
                  <button
                    className="btn small ghost"
                    aria-label="Take off the queue"
                    onClick={() => client.music({ k: 'remove', i: i + 1 })}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="switchrow">
          <span>Your volume</span>
          {fixed ? (
            <span className="small" data-testid="music-volume-note">
              Use your device’s volume buttons
            </span>
          ) : (
            <input
              type="range"
              min={0}
              max={100}
              value={mine.vol}
              onChange={(e) => change({ ...mine, vol: Number(e.target.value) })}
              aria-label="Music volume"
              data-testid="music-volume"
            />
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={mine.muted}
              onChange={(e) => change({ ...mine, muted: e.target.checked })}
              data-testid="music-mute"
            />
            Mute for me
          </label>
        </div>
      </div>
    </Sheet>
  );
}
