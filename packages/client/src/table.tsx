/*
 * The pre-game table (docs/pregame.md): the shared board with its source, rerolls, history and
 * edits, the seating circle, who goes first, and Ready. Everything here is sent to the server,
 * which keeps the one true table; this screen only shows what it says.
 */

import { useEffect, useRef, useState } from 'react';
import {
  checkBoard,
  OUR_RULES,
  type EditOp,
  type GenRules,
  type PortType,
  type Terrain,
} from '@settlers/engine';
import type { RoomInfo, TableInfo, TableOp } from '@settlers/server/protocol';
import { PCOL, dieSVG } from './art';
import { Fairness, MapBoard, TERRAIN_NAME, Warnings, type Tool } from './maps';
import { client, getStored, setStored, useClient } from './net';

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 20 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};
const CIRCLED = ['①', '②', '③', '④'];

export const sendTable = (op: TableOp) => client.tableOp(op);

/** "Generated · Our rules · seed k7Qp-3x · edited by Bob" */
export function sourceLine(b: TableInfo['board']): string {
  const src =
    b.source.kind === 'default'
      ? 'Standard board'
      : b.source.kind === 'saved'
        ? `Saved map · ${b.source.name}`
        : `Generated · ${b.source.presetName}`;
  return `${src}${b.edited.length ? ` · edited by ${b.edited.join(', ')}` : ''}`;
}

/** The shared board and everything about choosing it (1.1-1.3). */
export function TableBoardPanel({ room }: { room: RoomInfo }) {
  const st = useClient();
  const t = room.table!;
  const seated = !!room.seats.find((s) => s.pid === room.me);
  const [heat, setHeatState] = useState(getStored('settlers.heat') !== '0');
  const setHeat = (on: boolean) => {
    setHeatState(on);
    setStored('settlers.heat', on ? '1' : '0');
  };
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>({ k: 'move' });
  const [seed, setSeed] = useState('');
  const [, tick] = useState(0);
  const [hover, setHover] = useState<ReturnType<typeof checkBoard>[number] | null>(null);
  useEffect(() => {
    if (st.status !== 'live') return;
    client.loadPresets();
    client.loadMaps();
  }, [st.status]);
  useEffect(() => {
    const i = setInterval(() => tick((x) => x + 1), 15_000);
    // Maps made in another tab or on another device show up when you come back here.
    const back = () => {
      if (document.visibilityState === 'visible') client.loadMaps();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      clearInterval(i);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, []);
  const map = t.board.map;
  const sea = room.options.scenario !== 'classic';
  const presets = st.presets ?? [];
  const rules: GenRules =
    t.board.source.kind === 'generated'
      ? (presets.find((p) => p.id === (t.board.source as { preset: string }).preset)?.rules ?? OUR_RULES)
      : OUR_RULES;
  const players = Math.max(2, Math.min(4, room.seats.length || 4));
  const warnings = checkBoard(map, rules, players);
  // Maps for this mode can be picked; the others are listed too (greyed out) so a new map is
  // always there to see, with the mode it needs.
  const allMaps = st.maps ?? [];
  const savedMaps = allMaps.filter((m) => m.seafarers === sea);
  const otherMaps = allMaps.filter((m) => m.seafarers !== sea);
  const src = t.board.source;
  // "Saved map" picked: waiting for the server's list of maps.
  const [wantSaved, setWantSaved] = useState(false);
  const asked = useRef<typeof st.maps | null>(null);
  useEffect(() => {
    if (!wantSaved || st.maps === asked.current || !st.maps) return;
    setWantSaved(false);
    if (savedMaps[0]) sendTable({ k: 'source', source: 'saved', id: savedMaps[0].id });
    else
      client.toast(
        otherMaps.length
          ? `Your saved maps are for ${sea ? 'Base or Knights' : 'Seafarers or Full game'}: switch the mode to play them`
          : `No saved ${sea ? 'Seafarers ' : ''}maps yet: make one in Maps`,
        'err',
      );
  }, [wantSaved, st.maps]);
  const edit = (op: EditOp) => sendTable({ k: 'edit', op } as TableOp);
  const terrains: Terrain[] = [
    'wood',
    'brick',
    'sheep',
    'wheat',
    'ore',
    'desert',
    ...(sea ? (['gold', 'sea'] as const) : []),
  ];
  const harbors: PortType[] = ['any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];

  return (
    <section className="tableboard" data-testid="table-board">
      <div className="tbhead">
        <div className="tbsource" data-testid="board-source">
          <b>{sourceLine(t.board)}</b>
          <span className="seed">
            seed <code data-testid="board-seed">{t.board.seed}</code>
            <button
              type="button"
              className="btn small ghost"
              onClick={() =>
                void navigator.clipboard?.writeText(t.board.seed).then(
                  () => client.toast('Seed copied'),
                  () => client.toast(t.board.seed),
                )
              }
            >
              Copy
            </button>
          </span>
        </div>
        {/* Always there (empty until something changes), so nothing below moves when it fills. */}
        <div className="tblast" data-testid={t.last ? 'board-last' : undefined}>
          {t.last ? `${t.last.who} ${t.last.what} · ${ago(t.last.at)}` : '\u00a0'}
        </div>
      </div>
      <div className="tbmap">
        <MapBoard map={map} tool={editing ? tool : null} onEdit={edit} heat={heat} highlight={hover} />
      </div>
      {seated ? (
        <div className="tbcontrols">
          <div className="row tight">
            <select
              aria-label="Board"
              data-testid="board-kind"
              value={src.kind}
              onFocus={() => client.loadMaps()}
              onChange={(e) => {
                const k = e.target.value;
                if (k === 'default') sendTable({ k: 'source', source: 'default' });
                else if (k === 'generated')
                  sendTable({
                    k: 'source',
                    source: 'generated',
                    preset: presets[0]?.id ?? 'builtin:our rules',
                  });
                else {
                  // Ask for the latest list and pick from it when it comes (a map just made, or
                  // a list not loaded yet, used to read as "no saved maps").
                  asked.current = st.maps ?? null;
                  setWantSaved(true);
                  client.loadMaps();
                }
              }}
            >
              <option value="default">Standard board</option>
              <option value="generated">Generator</option>
              <option value="saved">Saved map</option>
            </select>
            {src.kind === 'generated' ? (
              <select
                aria-label="Preset"
                data-testid="board-preset"
                value={src.preset}
                onChange={(e) => sendTable({ k: 'source', source: 'generated', preset: e.target.value })}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            {src.kind === 'saved' ? (
              <select
                aria-label="Saved map"
                data-testid="board-map"
                value={src.id}
                onFocus={() => client.loadMaps()}
                onChange={(e) => sendTable({ k: 'source', source: 'saved', id: e.target.value })}
              >
                {savedMaps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {otherMaps.length ? (
                  <optgroup label={sea ? 'For Base or Knights' : 'For Seafarers or Full game'}>
                    {otherMaps.map((m) => (
                      <option key={m.id} value={m.id} disabled>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            ) : null}
          </div>
          <div className="row tight">
            <button
              className="btn small primary"
              onClick={() => sendTable({ k: 'reroll' })}
              data-testid="reroll"
            >
              Reroll
            </button>
            <button
              className="btn small"
              disabled={t.at <= 0}
              onClick={() => sendTable({ k: 'back' })}
              data-testid="board-back"
            >
              ‹ Back
            </button>
            <button
              className="btn small"
              disabled={t.at >= t.count - 1}
              onClick={() => sendTable({ k: 'forward' })}
              data-testid="board-forward"
            >
              Forward ›
            </button>
            <span className="hint small">
              {t.at + 1} of {t.count}
            </span>
            <form
              className="row tight"
              onSubmit={(e) => {
                e.preventDefault();
                if (seed.trim()) sendTable({ k: 'seed', seed: seed.trim() });
                setSeed('');
              }}
            >
              <input
                className="text seedin"
                placeholder="Type a seed"
                value={seed}
                maxLength={40}
                onChange={(e) => setSeed(e.target.value.replace(/[^A-Za-z0-9-]/g, ''))}
                data-testid="seed-input"
              />
              <button className="btn small" disabled={!seed.trim()}>
                Go
              </button>
            </form>
          </div>
          <div className="row tight">
            <label className="check">
              <input
                type="checkbox"
                checked={editing}
                onChange={(e) => setEditing(e.target.checked)}
                data-testid="edit-board"
              />
              Edit this board
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={heat}
                onChange={(e) => setHeat(e.target.checked)}
                data-testid="table-heat"
              />
              Heat map
            </label>
          </div>
          {editing ? (
            <div className="palette tbtools" data-testid="table-tools">
              <button
                type="button"
                className={`btn small tool${tool.k === 'move' ? ' on' : ''}`}
                onClick={() => setTool({ k: 'move' })}
                data-testid="ttool-move"
              >
                Move
              </button>
              <button
                type="button"
                className={`btn small tool${tool.k === 'lock' ? ' on' : ''}`}
                onClick={() => setTool({ k: 'lock' })}
                data-testid="ttool-lock"
              >
                Lock
              </button>
              <select
                aria-label="Tile"
                value={tool.k === 'terrain' ? tool.t : ''}
                onChange={(e) => e.target.value && setTool({ k: 'terrain', t: e.target.value as Terrain })}
                data-testid="ttool-terrain"
              >
                <option value="">Tile…</option>
                {terrains.map((x) => (
                  <option key={x} value={x}>
                    {TERRAIN_NAME[x]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Number"
                value={tool.k === 'number' ? String(tool.n) : ''}
                onChange={(e) => e.target.value && setTool({ k: 'number', n: Number(e.target.value) })}
                data-testid="ttool-number"
              >
                <option value="">Number…</option>
                {[2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                aria-label="Harbor"
                value={tool.k === 'harbor' && tool.t ? tool.t : ''}
                onChange={(e) => e.target.value && setTool({ k: 'harbor', t: e.target.value as PortType })}
                data-testid="ttool-harbor"
              >
                <option value="">Harbor…</option>
                {harbors.map((x) => (
                  <option key={x} value={x}>
                    {x === 'any' ? '3:1' : `2:1 ${TERRAIN_NAME[x]}`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Under the buttons, so they stay put when it shows. */}
      {t.problem ? (
        <p className="err" data-testid="board-problem">
          {t.problem}
        </p>
      ) : null}
      <details className="tbdetails" open>
        <summary>Warnings ({warnings.length}) and fairness</summary>
        {src.kind !== 'generated' ? (
          <p className="hint small">
            Warnings use “Our rules”. Pick the generator to make a board that meets them.
          </p>
        ) : null}
        <Warnings list={warnings} onHover={setHover} />
        <Fairness map={map} pips={rules.pips} />
      </details>
    </section>
  );
}

/** Seating, who goes first, the turn order and Ready (1.4, 2). */
export function TurnOrderPanel({ room }: { room: RoomInfo }) {
  const t = room.table!;
  const seats = new Map(room.seats.map((s) => [s.pid, s]));
  const me = room.me;
  const seated = !!(me && seats.has(me));
  const [drag, setDrag] = useState<string | null>(null);
  const order = t.first.pid
    ? [...t.circle.slice(t.circle.indexOf(t.first.pid)), ...t.circle.slice(0, t.circle.indexOf(t.first.pid))]
    : t.circle;
  const name = (pid: string) => seats.get(pid)?.nick ?? '?';
  const roll = t.first.roll;
  const move = (from: string, to: string) => {
    if (from === to) return;
    const c = t.circle.filter((p) => p !== from);
    c.splice(c.indexOf(to) + (t.circle.indexOf(from) < t.circle.indexOf(to) ? 1 : 0), 0, from);
    sendTable({ k: 'circle', order: c });
  };
  return (
    <section className="turnorder" data-testid="turn-order">
      <div className="field">
        <label>Seating (turns go around this way)</label>
        <div className="circle" onPointerLeave={() => setDrag(null)}>
          {t.circle.map((pid, i) => {
            const s = seats.get(pid);
            if (!s) return null;
            const r = roll?.rolls[pid];
            return (
              <div
                key={pid}
                className={`chair${drag === pid ? ' dragging' : ''}${t.first.pid === pid ? ' first' : ''}${t.first.mode === 'pick' && seated ? ' pickable' : ''}`}
                data-testid="chair"
                data-name={s.nick}
                onPointerDown={(e) => {
                  if (!seated || (e.target as HTMLElement).closest('button')) return;
                  setDrag(pid);
                }}
                onPointerUp={() => {
                  if (drag && drag !== pid) move(drag, pid);
                  else if (drag === pid && t.first.mode === 'pick') sendTable({ k: 'pickFirst', pid });
                  setDrag(null);
                }}
              >
                <span className="dot" style={{ background: PCOL[s.color] }} />
                <span className="nm">{s.nick}</span>
                {t.ready.includes(pid) ? (
                  <span className="tick" title="Ready" data-testid="ready-tick">
                    ✓
                  </span>
                ) : null}
                {r ? (
                  <span className="rolled" data-testid="rolled">
                    <span dangerouslySetInnerHTML={{ __html: dieSVG(r[0]) + dieSVG(r[1]) }} />
                    {r[0] + r[1]}
                  </span>
                ) : null}
                {seated ? (
                  <span className="arrows">
                    <button
                      type="button"
                      className="btn small ghost"
                      aria-label={`Move ${s.nick} earlier`}
                      disabled={i === 0}
                      onClick={() => move(pid, t.circle[i - 1]!)}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      aria-label={`Move ${s.nick} later`}
                      disabled={i === t.circle.length - 1}
                      onClick={() => move(pid, t.circle[i + 1]!)}
                    >
                      ›
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {seated ? (
          <button
            className="btn small"
            onClick={() => sendTable({ k: 'shuffle' })}
            data-testid="shuffle-seats"
          >
            Shuffle
          </button>
        ) : null}
      </div>
      <div className="field">
        <label>Who goes first</label>
        <div className="seg">
          {(['roll', 'random', 'pick'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn small${t.first.mode === m ? ' on' : ''}`}
              aria-pressed={t.first.mode === m}
              disabled={!seated}
              onClick={() => sendTable({ k: 'firstMode', mode: m })}
              data-testid={`first-${m}`}
            >
              {m === 'roll' ? 'Roll for it' : m === 'random' ? 'Random' : 'Pick'}
            </button>
          ))}
        </div>
        {t.first.mode === 'roll' && roll && !roll.winner ? (
          <div className="rolloff" data-testid="rolloff">
            <span className="hint small">
              {roll.round > 1
                ? `Tie! ${roll.rolling.map(name).join(' and ')} roll again.`
                : 'Everyone rolls; highest goes first.'}
            </span>
            <div className="row tight">
              {me && roll.rolling.includes(me) && !roll.rolls[me] ? (
                <button
                  className="btn small primary"
                  onClick={() => sendTable({ k: 'roll' })}
                  data-testid="roll-first"
                >
                  Roll
                </button>
              ) : null}
              {seated ? (
                <button
                  className="btn small"
                  onClick={() => sendTable({ k: 'autoRoll' })}
                  data-testid="auto-roll"
                >
                  Auto-roll everyone
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {t.first.mode === 'pick' ? <p className="hint small">Tap a seat to make it first.</p> : null}
        {t.first.mode === 'random' && seated ? (
          <button
            className="btn small ghost"
            onClick={() => sendTable({ k: 'firstMode', mode: 'random' })}
            data-testid="random-again"
          >
            Pick again
          </button>
        ) : null}
      </div>
      <div className="orderline" data-testid="order-line">
        {t.first.pid ? (
          <>
            <div>
              <b>Turn order:</b> {order.map((p, i) => `${CIRCLED[i]} ${name(p)}`).join(' → ')}
            </div>
            <div>
              <b>Setup:</b> {[...order, ...order.slice().reverse()].map(name).join(', ')}
            </div>
          </>
        ) : (
          <div className="hint">Who goes first isn’t settled yet.</div>
        )}
      </div>
      {seated ? (
        <button
          className={`btn${t.ready.includes(me!) ? ' on' : ''}`}
          aria-pressed={t.ready.includes(me!)}
          onClick={() => sendTable({ k: 'ready', on: !t.ready.includes(me!) })}
          data-testid="ready"
        >
          {t.ready.includes(me!) ? '✓ Ready' : 'Ready'}
        </button>
      ) : null}
    </section>
  );
}
