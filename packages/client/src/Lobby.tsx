/* Login, home and lobby screens. */

import { useState } from 'react';
import { COLORS, type Color } from '@settlers/engine';
import type { RoomInfo } from '@settlers/server/protocol';
import { BRAND_SVG, PCOL, PNAME } from './art';
import { client, getStored } from './net';

function Brand() {
  return (
    <div className="brand" style={{ marginBottom: 14 }}>
      <span dangerouslySetInnerHTML={{ __html: BRAND_SVG }} style={{ display: 'contents' }} />
      <span>Settlers</span>
    </div>
  );
}

export function Login() {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="center">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(await client.login(pass));
          setBusy(false);
        }}
      >
        <Brand />
        <h2>Welcome back</h2>
        <p className="lede">Enter the passphrase to get to the table.</p>
        <div className="field">
          <label htmlFor="pass">Passphrase</label>
          <input
            id="pass"
            className="text"
            type="password"
            autoFocus
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
        <button className="btn primary" disabled={!pass || busy}>
          Enter
        </button>
        {err ? <p className="err">{err}</p> : null}
      </form>
    </div>
  );
}

export function Home({ error }: { error: string | null }) {
  const [code, setCode] = useState('');
  return (
    <div className="center">
      <div className="card">
        <Brand />
        <h2>Start or join a game</h2>
        <p className="lede">Create a room and share the code, or enter a friend’s code.</p>
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="btn primary" onClick={() => client.createRoom()} data-testid="create">
            Create a room
          </button>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) {
              history.pushState(null, '', `/r/${c}`);
              client.openRoom(c);
            }
          }}
        >
          <input
            className="text codein"
            placeholder="CODE"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, ''))}
            aria-label="Room code"
          />
          <button className="btn" disabled={!code}>
            Join
          </button>
        </form>
        {error ? <p className="err">{error}</p> : null}
      </div>
    </div>
  );
}

export function Lobby({ room }: { room: RoomInfo }) {
  const mine = room.seats.find((s) => s.pid === room.me);
  const taken = new Set(room.seats.map((s) => s.color));
  const [nick, setNick] = useState(getStored('settlers.nick') ?? '');
  const [color, setColor] = useState<Color | null>(null);
  const free = COLORS.filter((c) => !taken.has(c));
  const pick = color && !taken.has(color) ? color : (free[0] ?? null);
  const link = `${location.origin}/r/${room.code}`;
  return (
    <div className="center">
      <div className="card" data-testid="lobby">
        <Brand />
        <div className="roomline">
          <div>
            <span className="eyebrow">Room code</span>
            <div className="roomcode" data-testid="room-code">
              {room.code}
            </div>
          </div>
          <button
            className="btn small"
            onClick={() =>
              void navigator.clipboard?.writeText(link).then(
                () => client.toast('Invite link copied'),
                () => client.toast(link),
              )
            }
          >
            Copy invite link
          </button>
        </div>
        <div className="seats">
          {room.seats.map((s) => (
            <div className="seat" key={s.pid}>
              <span className="dot" style={{ background: PCOL[s.color] }} />
              <span className="nm">{s.nick}</span>
              {s.pid === room.me ? <span className="you">you</span> : null}
              <span className={`online${s.connected ? '' : ' away'}`} />
            </div>
          ))}
          {Array.from({ length: Math.max(0, 4 - room.seats.length) }, (_, i) => (
            <div className="seat open" key={`open${i}`}>
              Open seat
            </div>
          ))}
        </div>
        {mine ? (
          <>
            <div className="field">
              <label>Your color</label>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: PCOL[c] }}
                    aria-label={PNAME[c]}
                    aria-pressed={mine.color === c}
                    disabled={taken.has(c) && mine.color !== c}
                    onClick={() => client.setColor(c)}
                  />
                ))}
              </div>
            </div>
            <div className="row">
              <button
                className="btn primary"
                disabled={room.seats.length < 2}
                onClick={() => client.start()}
                data-testid="start"
              >
                Start game
              </button>
              <button className="btn ghost" onClick={() => client.stand()}>
                Stand up
              </button>
            </div>
            <p className="hint">
              {room.seats.length < 2
                ? 'Waiting for at least one more player.'
                : 'Anyone seated can start when everyone is here.'}
            </p>
          </>
        ) : room.seats.length < 4 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nick.trim() && pick) client.join(nick.trim(), pick);
            }}
          >
            <div className="field">
              <label htmlFor="nick">Nickname</label>
              <input
                id="nick"
                className="text"
                maxLength={18}
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                data-testid="nick"
              />
            </div>
            <div className="field">
              <label>Color</label>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className="swatch"
                    style={{ background: PCOL[c] }}
                    aria-label={PNAME[c]}
                    aria-pressed={pick === c}
                    disabled={taken.has(c)}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            <button className="btn primary" disabled={!nick.trim() || !pick} data-testid="sit">
              Take a seat
            </button>
          </form>
        ) : (
          <p className="hint">The table is full.</p>
        )}
      </div>
    </div>
  );
}
