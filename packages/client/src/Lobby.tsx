/* Login, home and lobby screens. */

import { useEffect, useState } from 'react';
import { COLORS, PLAYER_COLORS, SCENARIOS, type Color } from '@settlers/engine';
import type { RoomInfo, RoomOptions } from '@settlers/server/protocol';
import { BRAND_SVG, PCOL, PEDGE, PNAME, K, cityPath, settlementPath } from './art';
import { Help, RULE_HELP } from './help';
import { RULE_LABEL } from './text';
import { client, useClient } from './net';
import { Brand, ProfilePicker } from './home';
import { TableBoardPanel, TurnOrderPanel } from './table';
import { CpusPage } from './cpus';

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

export function Lobby({ room }: { room: RoomInfo }) {
  const mine = room.seats.find((s) => s.pid === room.me);
  const live = useClient().status === 'live';
  // Custom CPUs, for the CPU seats' menus.
  useEffect(() => {
    if (live) client.loadCpus();
  }, [live]);
  const taken = new Set(room.seats.map((s) => s.color));
  const [profile, setProfile] = useState<{ id: string; color: Color } | null>(null);
  const [color, setColor] = useState<Color | null>(null);
  const [cpus, setCpus] = useState(false);
  const free = PLAYER_COLORS.filter((c) => !taken.has(c));
  // Your favourite colour if it's free, else the first free one.
  const pick =
    color && !taken.has(color)
      ? color
      : profile && !taken.has(profile.color) && profile.color !== 'gray'
        ? profile.color
        : (free[0] ?? null);
  const link = `${location.origin}/r/${room.code}`;
  const allowed = playersFor(room.options);
  const fits = allowed.includes(room.seats.length);
  const mode = modeOf(room.options);
  // A profile already at the table gets that seat back (SPEC 4.6, 5.1); if another screen still
  // has it, it moves here.
  const here = new Set(room.seats.flatMap((s) => (s.profile && !s.cpu ? [s.profile] : [])));
  const back = profile ? room.seats.find((s) => !s.cpu && s.profile === profile.id) : undefined;
  const rejoining = !!back;
  const moving = !!back?.connected;
  const t = room.table;
  const canStart = fits && !!t && !t.problem && !!t.first.pid;
  return (
    <div className={`lobbywrap${t ? ' withtable' : ''}`}>
      {cpus ? <CpusPage onBack={() => setCpus(false)} /> : null}
      {t ? <TableBoardPanel room={room} /> : null}
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
              <ColorPicker
                colors={PLAYER_COLORS}
                value={mine.color}
                taken={taken}
                onPick={(c) => client.setColor(c)}
              />
            </div>
            <Options room={room} editable />
            <div className="row" style={{ marginBottom: 12 }}>
              {room.seats.length < 4 ? (
                <button className="btn small" onClick={() => client.addCpu()} data-testid="add-cpu">
                  Add CPU player
                </button>
              ) : null}
              <button className="btn small ghost" onClick={() => setCpus(true)} data-testid="cpu-page-link">
                How CPUs play
              </button>
            </div>
            {t ? <TurnOrderPanel room={room} /> : null}
            <div className="row">
              <button
                className="btn primary"
                disabled={!canStart}
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
              {!fits
                ? `${MODES[mode].label} needs ${allowed.join(' or ')} players.`
                : t?.problem
                  ? t.problem
                  : t && !t.first.pid
                    ? 'Finish the roll for who goes first.'
                    : 'Anyone seated can start whenever you like; Ready is just a signal.'}
            </p>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (profile && (pick || rejoining)) client.join(profile.id, pick ?? 'red', moving);
            }}
          >
            <Options room={room} editable={false} />
            {t ? <TurnOrderPanel room={room} /> : null}
            <div className="field">
              <label>Who are you?</label>
              <ProfilePicker
                value={profile?.id ?? null}
                here={here}
                onPick={(p) => setProfile({ id: p.id, color: p.color })}
              />
            </div>
            {moving ? (
              <p className="hint" data-testid="move-hint">
                {back!.nick} is sitting here on another screen (another tab, or a page left open). Move the
                seat to this screen? The other screen will just watch.
              </p>
            ) : rejoining ? (
              <p className="hint">You’re at this table: you’ll get your seat back.</p>
            ) : room.seats.length < 4 ? (
              <div className="field">
                <label>Color</label>
                <ColorPicker colors={PLAYER_COLORS} value={pick} taken={taken} onPick={setColor} />
              </div>
            ) : (
              <p className="hint">The table is full. Pick your name if you were sitting here.</p>
            )}
            <button
              className="btn primary"
              disabled={!profile || (!rejoining && (!pick || room.seats.length >= 4))}
              data-testid="sit"
            >
              {moving ? 'Move my seat here' : rejoining ? 'Rejoin' : 'Take a seat'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** A small road, settlement and city in a colour (SPEC 4.2). */
export function PiecePreview({ color, size = 1 }: { color: Color; size?: number }) {
  const fill = PCOL[color];
  const edge = PEDGE(color);
  const u = K * 0.55;
  return (
    <svg
      className="preview"
      viewBox={`${-0.3 * u} ${-0.62 * u} ${3.3 * u} ${1.05 * u}`}
      width={66 * size}
      height={21 * size}
      aria-hidden="true"
    >
      <line
        x1={0}
        y1={0.15 * u}
        x2={0.85 * u}
        y2={-0.3 * u}
        stroke={edge}
        strokeWidth={0.26 * u}
        strokeLinecap="round"
      />
      <line
        x1={0}
        y1={0.15 * u}
        x2={0.85 * u}
        y2={-0.3 * u}
        stroke={fill}
        strokeWidth={0.15 * u}
        strokeLinecap="round"
      />
      <path
        d={settlementPath(1.45 * u, 0, 1.5)}
        fill={fill}
        stroke={edge}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d={cityPath(2.45 * u, 0.02 * u)}
        fill={fill}
        stroke={edge}
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Colour choices, each with a preview of its pieces. Taken colours are disabled. */
function ColorPicker(props: {
  colors: readonly Color[];
  value: Color | null;
  taken: Set<Color>;
  onPick: (c: Color) => void;
}) {
  return (
    <div className="colorpick">
      {props.colors.map((c) => (
        <button
          type="button"
          key={c}
          className="colorbtn"
          aria-label={PNAME[c]}
          aria-pressed={props.value === c}
          disabled={props.taken.has(c) && props.value !== c}
          data-color={c}
          onClick={() => props.onPick(c)}
        >
          <PiecePreview color={c} />
          <span>{PNAME[c]}</span>
        </button>
      ))}
    </div>
  );
}

/** A CPU's seat: anyone in the lobby can rename it, recolour it or remove it. */
function CpuSeat({ seat, taken }: { seat: RoomInfo['seats'][number]; taken: Set<Color> }) {
  const custom = useClient().cpus ?? [];
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
        <select
          className="cpulevel"
          aria-label="How good it is"
          data-testid="cpu-level"
          value={seat.level ?? 'easy'}
          onChange={(e) => client.editCpu(seat.pid, { level: e.target.value })}
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
          {custom.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {seat.level &&
          !['easy', 'medium', 'hard'].includes(seat.level) &&
          !custom.some((c) => c.id === seat.level) ? (
            <option value={seat.level}>{seat.levelName}</option>
          ) : null}
        </select>
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
        <PiecePreview color={seat.color} size={0.8} />
      </span>
    </div>
  );
}

/* ---------- Game mode and options ---------- */

type Mode = 'base' | 'seafarers' | 'knights' | 'full';
const MODES: Record<Mode, { label: string; sub: string; scenario: RoomOptions['scenario']; ck: boolean }> = {
  base: { label: 'Base game', sub: 'The classic island', scenario: 'classic', ck: false },
  seafarers: { label: 'Seafarers', sub: 'Ships, islands and gold across the water', scenario: 'heading-for-new-shores', ck: false },
  knights: { label: 'Knights', sub: 'Cities & Knights on the classic island', scenario: 'classic', ck: true },
  full: { label: 'Full game', sub: 'Seafarers and Cities & Knights together', scenario: 'heading-for-new-shores', ck: true },
}; // prettier-ignore
/** The Seafarers maps to play on (SPEC 10.2: the Fog Islands). */
const SEA_MAPS: [RoomOptions['scenario'], string][] = [
  ['heading-for-new-shores', 'Heading for New Shores'],
  ['fog-islands', 'Fog Islands'],
];
const modeOf = (o: RoomOptions): Mode =>
  o.scenario === 'classic' ? (o.ck ? 'knights' : 'base') : o.ck ? 'full' : 'seafarers';

type Flag = 'no7FirstRound' | 'bank3to1' | 'freeShipMoves' | 'rerollBeforeAttack' | 'noDiscardBeforeAttack' | 'handBack' | 'handBackSetup'; // prettier-ignore
const HOUSE_RULES: { k: Flag; seafarers?: boolean; ck?: boolean; defaultOn?: boolean }[] = [
  { k: 'no7FirstRound' },
  { k: 'bank3to1' },
  { k: 'freeShipMoves', seafarers: true },
  { k: 'rerollBeforeAttack', ck: true },
  { k: 'noDiscardBeforeAttack', ck: true },
  { k: 'handBack', defaultOn: true },
  { k: 'handBackSetup' },
];

/** Cities & Knights adds 3 points to a scenario's target and needs 3 or 4 players. */
const CK_EXTRA_VP = 3;
const defaultVP = (o: RoomOptions) => SCENARIOS[o.scenario]!.winVP + (o.ck ? CK_EXTRA_VP : 0);
export function playersFor(o: RoomOptions): number[] {
  const players = SCENARIOS[o.scenario]!.players;
  return o.ck ? players.filter((n) => n >= 3) : players;
}

/** Game mode, points to win and house rules. Seated players edit; everyone sees them. */
function Options({ room, editable }: { room: RoomInfo; editable: boolean }) {
  const o = room.options;
  const mode = modeOf(o);
  const sea = o.scenario !== 'classic';
  const set = (next: RoomOptions) => client.setOptions(next);
  const check = { display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--ink)', fontWeight: 500 } as const; // prettier-ignore
  const on = (h: (typeof HOUSE_RULES)[number]) =>
    h.defaultOn ? o.houseRules[h.k] !== false : !!o.houseRules[h.k];
  return (
    <div className="field" data-testid="options">
      <label>Game</label>
      <div className="modes">
        {(Object.keys(MODES) as Mode[]).map((m) => {
          const x = MODES[m];
          // Switching between Seafarers and Full game keeps the Seafarers map you picked.
          const scenario = x.scenario !== 'classic' && sea ? o.scenario : x.scenario;
          const next = { ...o, scenario, ck: x.ck };
          return (
            <button
              key={m}
              type="button"
              className={`modebtn${mode === m ? ' on' : ''}`}
              aria-pressed={mode === m}
              disabled={!editable}
              data-testid={`mode-${m}`}
              onClick={() => set({ ...next, winVP: defaultVP(next) })}
            >
              <b>{x.label}</b>
              <span>{x.sub}</span>
              <small>
                {playersFor(next).join(' or ')} players · {defaultVP(next)} points
              </small>
            </button>
          );
        })}
      </div>
      {sea ? (
        <div className="seg seamaps" role="radiogroup" aria-label="Seafarers map" style={{ marginBottom: 6 }}>
          {SEA_MAPS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={o.scenario === id}
              className={`btn small${o.scenario === id ? ' on' : ''}`}
              disabled={!editable}
              data-testid={`scenario-${id}`}
              onClick={() => {
                const next = { ...o, scenario: id };
                set({ ...next, winVP: defaultVP(next) });
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {sea && SCENARIOS[o.scenario]!.specialVP?.newIsland ? (
        <p className="hint" style={{ margin: '2px 0 6px' }}>
          {SCENARIOS[o.scenario]!.specialVP!.newIsland} points for each new island you settle
        </p>
      ) : null}
      <label>
        Points to win <Help text={RULE_HELP.winVP} />
      </label>
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
      <label>
        Bank cards{' '}
        <Help text="Limited: the official supply, 19 of each resource (and 12 of each commodity in Knights games). If the bank can’t pay everyone a card a roll produces, nobody gets it. Unlimited: the bank never runs out." />
      </label>
      <div
        className="seg banksel"
        role="radiogroup"
        aria-label="Bank cards"
        style={{ marginLeft: 0, marginBottom: 8 }}
      >
        {(['limited', 'unlimited'] as const).map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={(o.bank ?? 'limited') === b}
            className={`btn small${(o.bank ?? 'limited') === b ? ' on' : ''}`}
            disabled={!editable}
            data-testid={`bank-${b}`}
            onClick={() => set({ ...o, bank: b })}
          >
            {b === 'limited' ? 'Limited' : 'Unlimited'}
          </button>
        ))}
      </div>
      <label>House rules</label>
      <div style={{ display: 'grid', gap: 6 }}>
        {HOUSE_RULES.filter((h) => (!h.seafarers || sea) && (!h.ck || o.ck)).map((h) => (
          <label key={h.k} style={check}>
            <input
              type="checkbox"
              checked={on(h)}
              disabled={!editable || (h.k === 'handBackSetup' && o.houseRules.handBack === false)}
              data-testid={`rule-${h.k}`}
              onChange={(e) => set({ ...o, houseRules: { ...o.houseRules, [h.k]: e.target.checked } })}
            />
            {RULE_LABEL[h.k]}
            <Help text={RULE_HELP[h.k]} />
          </label>
        ))}
        {o.ck ? (
          <div style={{ ...check, justifyContent: 'space-between' }}>
            <span>
              {RULE_LABEL.barbarianDelay} <Help text={RULE_HELP.barbarianDelay} />
            </span>
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
      {room.seats.some((st) => st.cpu && st.level !== 'easy') ? (
        <>
          <label>CPU players</label>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={check}>
              <input
                type="checkbox"
                checked={o.cpuTrading !== false}
                disabled={!editable}
                data-testid="opt-cpuTrading"
                onChange={(e) => set({ ...o, cpuTrading: e.target.checked })}
              />
              CPUs trade with people
              <Help text="Medium, Hard and custom CPUs answer your offers and make fair offers of their own. Off: they never offer and turn every offer down. Easy never trades either way." />
            </label>
            <label style={check}>
              <input
                type="checkbox"
                checked={o.cpuOneOffer !== false}
                disabled={!editable || o.cpuTrading === false}
                data-testid="opt-cpuOneOffer"
                onChange={(e) => set({ ...o, cpuOneOffer: e.target.checked })}
              />
              One offer per CPU per turn
              <Help text="Off lets a CPU make more than one offer in its turn (still only fair ones, and never the same offer twice)." />
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}
