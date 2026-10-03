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
      yt.setVolume(v);
      if (muted) yt.mute();
      else yt.unMute();
    },
    last() {
      const list = yt?.getPlaylist?.();
      return !list || yt.getPlaylistIndex() >= list.length - 1;
    },
    title: () => yt?.getVideoData?.()?.title || null,
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
): Player & { state(): FakeState; end(): void; fail(): void } {
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
    state: () => ({ ...s, at: Math.round(now() * 10) / 10 }),
    end: () => ev.ended(),
    fail: () => ev.error(),
  };
}

/* ---------- Keeping in step ---------- */

const DRIFT = 2; // seconds out before a screen is put back in line (SPEC 12.1)
const myMusic = (s: PlayerSettings | null | undefined) => ({
  vol: s?.music?.vol ?? 60,
  muted: !!s?.music?.muted,
});

/** Where the room's music is now, in seconds, by the server's clock. */
function expected(m: Music, offset: number): number {
  return m.playing ? Math.max(0, (Date.now() + offset - m.started) / 1000) : m.pos;
}

/** The hidden player, mounted once while you're in a room. */
export function MusicHost() {
  const st = useClient();
  const m = st.room?.music;
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<(Player & Partial<{ state(): FakeState; end(): void; fail(): void }>) | null>(null);
  const loaded = useRef<string | null>(null);
  const offset = useRef(0);
  const latest = useRef(m);
  latest.current = m;
  const [blocked, setBlocked] = useState(false);
  const mine = myMusic(st.room?.mySettings);

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
        if (loaded.current != null)
          send({ k: 'ended', ver: Number(loaded.current), last: player.current?.last() ?? true });
      },
      error: () => {
        if (loaded.current != null) send({ k: 'error', ver: Number(loaded.current) });
      },
    };
    const fake = (window as { __settlersFakeYT?: { blocked?: boolean } | boolean }).__settlersFakeYT;
    player.current = fake
      ? fakePlayer(ev, typeof fake === 'object' ? fake : {})
      : youTubePlayer(host.current, ev);
    (window as { __settlersMusic?: unknown }).__settlersMusic = player.current;
    return player.current;
  };

  // What plays, and whether: whenever the room's music changes.
  useEffect(() => {
    const cur = m?.queue[0];
    if (!m || !cur) {
      if (player.current && loaded.current) player.current.stop();
      loaded.current = null;
      return;
    }
    const p = ensure();
    if (!p) return;
    const key = `${m.ver}`;
    if (loaded.current !== key) {
      loaded.current = key;
      p.load(cur, m.index, expected(m, offset.current), m.playing);
      if (!m.playing) p.pause();
    } else if (m.playing) p.play();
    else p.pause();
  }, [m?.ver, m?.playing, m?.queue[0]?.id]);

  useEffect(() => {
    player.current?.volume(mine.vol, mine.muted);
  }, [mine.vol, mine.muted, !!player.current]);

  // Every second: back in line if more than 2 s out; the title once known; blocked sound noticed.
  useEffect(() => {
    const t = setInterval(() => {
      const cur = latest.current;
      const p = player.current;
      if (!cur?.queue.length || !p) return setBlocked(false);
      if (cur.playing) {
        const want = expected(cur, offset.current);
        if (Math.abs(p.time() - want) > DRIFT) p.seek(want);
        setBlocked(!p.playing());
      } else setBlocked(false);
      const title = p.title();
      if (title && !cur.queue[0]!.title) send({ k: 'title', ver: cur.ver, title });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Sound blocked until a click: the first click anywhere starts it.
  useEffect(() => {
    if (!blocked) return;
    const go = () => player.current?.play();
    window.addEventListener('pointerdown', go, { once: true });
    return () => window.removeEventListener('pointerdown', go);
  }, [blocked]);
  (window as { __settlersMusicBlocked?: boolean }).__settlersMusicBlocked = blocked;

  return (
    <>
      <div ref={host} className="musichost" aria-hidden="true" />
      {blocked && m?.queue.length ? (
        <button className="musicjoin" data-testid="music-join" onClick={() => player.current?.play()}>
          ♪ Click to join the music
        </button>
      ) : null}
    </>
  );
}

/* ---------- The button and the sheet ---------- */

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
      title={cur ? (cur.title ?? 'Music') : 'Play music for the table'}
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
  const mine = myMusic(settings);
  const [vol, setVol] = useState(mine.vol);
  const [muted, setMuted] = useState(mine.muted);
  const seated = !!settings;
  // Save the volume a moment after the slider stops (as the Sounds page does).
  useEffect(() => {
    if (!seated || vol === mine.vol) return;
    const t = setTimeout(() => client.saveSettings({ ...(settings ?? {}), music: { vol, muted } }), 350);
    return () => clearTimeout(t);
  }, [vol]);
  const add = () => {
    if (!link.trim()) return;
    client.music({ k: 'add', url: link.trim() });
    setLink('');
  };
  const label = (x: Item, i: number) =>
    x.title ??
    (x.kind === 'playlist' ? `A playlist${i === 0 && m ? ` · song ${m.index + 1}` : ''}` : 'A song');
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
            <span className="eyebrow">{m!.playing ? 'Playing' : 'Paused'}</span>
            <b>{label(cur, 0)}</b>
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
              >
                Stop
              </button>
            </div>
          </div>
        ) : (
          <p className="small">Nothing playing. Paste a link to start the music for everyone.</p>
        )}
        {m && m.queue.length > 1 ? (
          <ol className="musicqueue" data-testid="music-queue">
            {m.queue.slice(1).map((x, i) => (
              <li key={`${i}-${x.id}`}>
                <span>{label(x, i + 1)}</span>
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
        ) : null}
        <div className="switchrow">
          <span>Your volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            disabled={!seated}
            onChange={(e) => setVol(Number(e.target.value))}
            aria-label="Music volume"
            data-testid="music-volume"
          />
          <label className="check">
            <input
              type="checkbox"
              checked={muted}
              disabled={!seated}
              onChange={(e) => {
                setMuted(e.target.checked);
                client.saveSettings({ ...(settings ?? {}), music: { vol, muted: e.target.checked } });
              }}
              data-testid="music-mute"
            />
            Mute for me
          </label>
        </div>
      </div>
    </Sheet>
  );
}
