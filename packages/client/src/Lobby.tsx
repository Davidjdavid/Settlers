/* Login, home and lobby screens. */

import { useEffect, useState } from 'react';
import { COLORS, SCENARIOS, type Color } from '@settlers/engine';
import type { RoomInfo, RoomOptions } from '@settlers/server/protocol';
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
  const scenario = SCENARIOS[room.options.scenario]!;
  const allowed = playersFor(room.options);
  const fits = allowed.includes(room.seats.length);
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
          {room.seats.map((s) =>
            s.cpu ? (
              <CpuSeat key={s.pid} seat={s} taken={taken} />
            ) : (
              <div className="seat" key={s.pid}>
                <span className="dot" style={{ background: PCOL[s.color] }} />
                <span className="nm">{s.nick}</span>
                {s.pid === room.me ? <span className="you">you</span> : null}
                <span className={`online${s.connected ? '' : ' away'}`} />
              </div>
            ),
          )}
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
            <Options room={room} editable />
            {room.seats.length < 4 ? (
              <button
                className="btn small"
                onClick={() => client.addCpu()}
                data-testid="add-cpu"
                style={{ marginBottom: 12 }}
              >
                Add CPU player
              </button>
            ) : null}
            <div className="row">
              <button
                className="btn primary"
                disabled={!fits}
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
              {fits
                ? 'Anyone seated can start when everyone is here.'
                : `${scenario.name}${room.options.ck ? ' with Cities & Knights' : ''} needs ${allowed.join(' or ')} players.`}
            </p>
          </>
        ) : room.seats.length < 4 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nick.trim() && pick) client.join(nick.trim(), pick);
            }}
          >
            <Options room={room} editable={false} />
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

/** A CPU's seat: anyone in the lobby can rename it, recolour it or remove it. */
function CpuSeat({ seat, taken }: { seat: RoomInfo['seats'][number]; taken: Set<Color> }) {
  const [nick, setNick] = useState(seat.nick);
  const [editing, setEditing] = useState(false);
  // Someone else renamed it: show the new name unless you're typing.
  useEffect(() => {
    if (!editing) setNick(seat.nick);
  }, [seat.nick, editing]);
  const save = () => {
    const n = nick.trim();
    if (n && n !== seat.nick) client.editCpu(seat.pid, { nick: n });
    else setNick(seat.nick);
  };
  return (
    <div className="seat cpuseat" data-testid="cpu-seat">
      <span className="dot" style={{ background: PCOL[seat.color] }} />
      <input
        className="text cpunick"
        value={nick}
        maxLength={18}
        aria-label="CPU name"
        data-testid="cpu-nick"
        onChange={(e) => setNick(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          save();
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button
        className="btn small ghost"
        aria-label={`Remove ${seat.nick}`}
        onClick={() => client.removeCpu(seat.pid)}
      >
        ✕
      </button>
      <span className="cpurow">
        <span className="you">CPU</span>
        <select
          className="cpucolor"
          aria-label="CPU color"
          data-testid="cpu-color"
          value={seat.color}
          onChange={(e) => client.editCpu(seat.pid, { color: e.target.value as Color })}
        >
          {COLORS.filter((c) => c === seat.color || !taken.has(c)).map((c) => (
            <option key={c} value={c}>
              {PNAME[c]}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

const SCENARIO_LIST: { id: RoomOptions['scenario']; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'heading-for-new-shores', label: 'Seafarers: Heading for New Shores' },
];

type Flag = 'no7FirstRound' | 'bank3to1' | 'freeShipMoves' | 'rerollBeforeAttack' | 'noDiscardBeforeAttack';
const HOUSE_RULES: { k: Flag; label: string; seafarers?: boolean; ck?: boolean }[] = [
  { k: 'no7FirstRound', label: 'No 7s in the first round' },
  { k: 'bank3to1', label: '3:1 bank trades for everyone' },
  { k: 'freeShipMoves', label: 'Move ships as often as you like', seafarers: true },
  { k: 'rerollBeforeAttack', label: 'Re-roll 7s until the barbarians have attacked', ck: true },
  { k: 'noDiscardBeforeAttack', label: 'No discards on a 7 until the barbarians have attacked', ck: true },
];

/** Cities & Knights adds 3 points to a scenario's target and needs 3 or 4 players. */
const CK_EXTRA_VP = 3;
const defaultVP = (o: RoomOptions) => SCENARIOS[o.scenario]!.winVP + (o.ck ? CK_EXTRA_VP : 0);
export function playersFor(o: RoomOptions): number[] {
  const players = SCENARIOS[o.scenario]!.players;
  return o.ck ? players.filter((n) => n >= 3) : players;
}

/** Scenario, points to win and house rules. Seated players edit; everyone sees them. */
function Options({ room, editable }: { room: RoomInfo; editable: boolean }) {
  const o = room.options;
  const scenario = SCENARIOS[o.scenario]!;
  const sea = scenario.modules.includes('seafarers');
  const set = (next: RoomOptions) => client.setOptions(next);
  const check = { display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--ink)', fontWeight: 500 } as const; // prettier-ignore
  return (
    <div className="field" data-testid="options">
      <label>Game</label>
      <div className="row">
        {SCENARIO_LIST.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`btn small${o.scenario === x.id ? ' on' : ''}`}
            disabled={!editable}
            data-testid={`scenario-${x.id}`}
            onClick={() => set({ ...o, scenario: x.id, winVP: defaultVP({ ...o, scenario: x.id }) })}
          >
            {x.label}
          </button>
        ))}
      </div>
      <label style={check}>
        <input
          type="checkbox"
          checked={!!o.ck}
          disabled={!editable}
          data-testid="ck"
          onChange={(e) => {
            const next = { ...o, ck: e.target.checked };
            set({ ...next, winVP: defaultVP(next) });
          }}
        />
        Cities &amp; Knights
      </label>
      <p className="hint" style={{ margin: '2px 0 6px' }}>
        {playersFor(o).join(' or ')} players
        {sea && scenario.specialVP?.newIsland
          ? ` · ${scenario.specialVP.newIsland} points for each new island you settle`
          : ''}
      </p>
      <label>Points to win</label>
      <div className="ctl" style={{ marginBottom: 8 }}>
        <button
          type="button"
          disabled={!editable || o.winVP <= 5}
          onClick={() => set({ ...o, winVP: o.winVP - 1 })}
          aria-label="Fewer points"
        >
          −
        </button>
        <output data-testid="win-vp">{o.winVP}</output>
        <button
          type="button"
          disabled={!editable || o.winVP >= 30}
          onClick={() => set({ ...o, winVP: o.winVP + 1 })}
          aria-label="More points"
        >
          +
        </button>
      </div>
      <label>House rules</label>
      <div style={{ display: 'grid', gap: 6 }}>
        {HOUSE_RULES.filter((h) => (!h.seafarers || sea) && (!h.ck || o.ck)).map((h) => (
          <label key={h.k} style={check}>
            <input
              type="checkbox"
              checked={!!o.houseRules[h.k]}
              disabled={!editable}
              data-testid={`rule-${h.k}`}
              onChange={(e) => set({ ...o, houseRules: { ...o.houseRules, [h.k]: e.target.checked } })}
            />
            {h.label}
          </label>
        ))}
        {o.ck ? (
          <div style={{ ...check, justifyContent: 'space-between' }}>
            <span>Barbarians and progress cards start after round</span>
            <div className="ctl">
              <button
                type="button"
                disabled={!editable || !o.houseRules.barbarianDelay}
                aria-label="Earlier barbarians"
                onClick={() =>
                  set({
                    ...o,
                    houseRules: { ...o.houseRules, barbarianDelay: (o.houseRules.barbarianDelay ?? 0) - 1 },
                  })
                }
              >
                −
              </button>
              <output data-testid="barbarian-delay">{o.houseRules.barbarianDelay ?? 0}</output>
              <button
                type="button"
                disabled={!editable || (o.houseRules.barbarianDelay ?? 0) >= 10}
                aria-label="Later barbarians"
                onClick={() =>
                  set({
                    ...o,
                    houseRules: { ...o.houseRules, barbarianDelay: (o.houseRules.barbarianDelay ?? 0) + 1 },
                  })
                }
              >
                +
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
