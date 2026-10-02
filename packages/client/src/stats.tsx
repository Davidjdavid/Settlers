/*
 * Stats (SPEC 5.4–5.6): the dice chart (live and all-time), each game's stats (end screen and
 * past games), and the Stats page. Every number comes from the server, which works it out from
 * the saved moves.
 */

import { useEffect, useState } from 'react';
import {
  GAIN_SOURCES,
  LOSS_SOURCES,
  bestTile,
  sumCards,
  type Color,
  type GameStats,
  type VPPart,
} from '@settlers/engine';
import type { DiceInfo, GameStatsInfo } from '@settlers/server/protocol';
import { CARD_LABEL, DEV_LABEL, PCOL, PROGRESS_LABEL, TILE_COLOR } from './art';
import { Brand, MODE_NAME, MapPreview } from './home';
import { client, useClient } from './net';
import { Sheet } from './Sheets';
import { savePin } from './dicepin';

const WAYS = (t: number) => 6 - Math.abs(t - 7);
const ODDS = (t: number) => WAYS(t) / 36;
/** Rolls without a total before the chance of a gap that long is under 10% (SPEC 5.4). */
export const droughtAt = (t: number) => Math.ceil(Math.log(0.1) / Math.log(1 - ODDS(t)));

const BAR = '#7fb8c2';

/** Totals 2–12: how often each came up (bars) against two real dice (ticks). */
export function DiceChart({ dice, title = 'Dice totals' }: { dice: number[]; title?: string }) {
  const n = dice.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...dice.slice(2), ...[...Array(11)].map((_, i) => n * ODDS(i + 2)));
  const W = 320;
  const H = 150;
  const bw = W / 11;
  const y = (k: number) => H - 18 - (k / max) * (H - 34);
  return (
    <figure className="chart" data-testid="dice-chart">
      <figcaption>
        {title} <span className="sub">{n} rolls · bars: rolled · lines: expected with two dice</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${n} rolls`}>
        <line x1={0} x2={W} y1={H - 18} y2={H - 18} stroke="var(--line-2)" />
        {[...Array(11)].map((_, i) => {
          const t = i + 2;
          const k = dice[t] ?? 0;
          const exp = n * ODDS(t);
          const x = i * bw;
          return (
            <g key={t} data-total={t}>
              <title>{`${t}: rolled ${k} (${n ? ((100 * k) / n).toFixed(1) : 0}%), expected ${exp.toFixed(1)} (${(100 * ODDS(t)).toFixed(1)}%)`}</title>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              <path
                d={`M${x + 4} ${H - 18}V${y(k) + 4}q0 -4 4 -4h${bw - 16}q4 0 4 4V${H - 18}Z`}
                fill={BAR}
                opacity={k ? 1 : 0}
              />
              <line x1={x + 2} x2={x + bw - 2} y1={y(exp)} y2={y(exp)} stroke="var(--ink)" strokeWidth={2} />
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--ink-2)">
                {t}
              </text>
              {k ? (
                <text x={x + bw / 2} y={y(k) - 4} textAnchor="middle" fontSize="10" fill="var(--ink-2)">
                  {k}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

const FACE_LABEL: Record<string, string> = {
  ship: 'Ship',
  trade: 'Trade',
  politics: 'Politics',
  science: 'Science',
};
const FACE_ODDS: Record<string, number> = { ship: 3 / 6, trade: 1 / 6, politics: 1 / 6, science: 1 / 6 };

/** The event die (Cities & Knights). */
export function EventDieChart({ events }: { events: Record<string, number> }) {
  const n = Object.values(events).reduce((a, b) => a + b, 0);
  if (!n) return null;
  return (
    <table className="stattable" data-testid="event-die">
      <caption>Event die ({n} rolls)</caption>
      <thead>
        <tr>
          <th>Face</th>
          <th>Rolled</th>
          <th>Expected</th>
        </tr>
      </thead>
      <tbody>
        {Object.keys(FACE_ODDS).map((f) => (
          <tr key={f}>
            <td>{FACE_LABEL[f]}</td>
            <td>{events[f] ?? 0}</td>
            <td>{(n * FACE_ODDS[f]!).toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The live dice panel during a game (SPEC 5.4). */
export function DicePanel({
  dice,
  names,
  onClose,
  pinned,
}: {
  dice: DiceInfo;
  names: string[];
  onClose: () => void;
  /** Whether the dice are pinned on screen (SPEC 9.5). */
  pinned?: boolean;
}) {
  const sevens = dice.dice[7] ?? 0;
  const dry = [...Array(11)]
    .map((_, i) => i + 2)
    .filter((t) => dice.gap[t]! >= droughtAt(t))
    .map((t) => `no ${t} in ${dice.gap[t]} rolls`);
  return (
    <Sheet
      title="Dice"
      sub="This game so far."
      onClose={onClose}
      foot={
        <>
          <button
            className="btn"
            data-testid={pinned ? 'dice-unpin' : 'dice-pin-on'}
            onClick={() => {
              savePin(pinned ? null : { corner: 'tl' });
              onClose();
            }}
          >
            {pinned ? 'Unpin' : 'Pin on screen'}
          </button>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <DiceChart dice={dice.dice} />
      {dry.length ? (
        <p className="callouts" data-testid="droughts">
          {dry.join(' · ')}
        </p>
      ) : null}
      <p className="sub">
        7s: <b>{sevens}</b>
        {dice.chosen ? ` · ${dice.chosen} rolls set by the Alchemist (not counted)` : ''}
      </p>
      <table className="stattable">
        <caption>Rolls per player</caption>
        <tbody>
          {names.map((n, i) => (
            <tr key={i}>
              <td>{n}</td>
              <td>{dice.rolls[i] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <EventDieChart events={dice.events} />
    </Sheet>
  );
}

/** Every player's points over the game, one line each (SPEC 5.5). */
export function PointsChart({
  byTurn,
  names,
  colors,
}: {
  byTurn: number[][];
  names: string[];
  colors: Color[];
}) {
  const turns = byTurn.map((row, t) => (row ? t : -1)).filter((t) => t >= 0);
  if (turns.length < 2) return null;
  const last = turns[turns.length - 1]!;
  const max = Math.max(2, ...byTurn.flatMap((r) => r ?? []));
  const W = 320;
  const H = 160;
  const x = (t: number) => 26 + ((t - turns[0]!) / Math.max(1, last - turns[0]!)) * (W - 90);
  const y = (v: number) => H - 20 - (v / max) * (H - 34);
  return (
    <figure className="chart" data-testid="points-chart">
      <figcaption>Points over the game</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points over the game">
        {[0, Math.round(max / 2), max].map((v) => (
          <g key={v}>
            <line x1={26} x2={W - 64} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={20} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
              {v}
            </text>
          </g>
        ))}
        <text x={26} y={H - 4} fontSize="10" fill="var(--ink-3)">
          turn {turns[0]}
        </text>
        <text x={W - 64} y={H - 4} fontSize="10" fill="var(--ink-3)" textAnchor="end">
          turn {last}
        </text>
        {names.map((n, p) => {
          const pts = turns.map((t) => [x(t), y(byTurn[t]![p] ?? 0)] as const);
          const end = pts[pts.length - 1]!;
          return (
            <g key={p}>
              <polyline
                points={pts.map(([a, b]) => `${a},${b}`).join(' ')}
                fill="none"
                stroke={PCOL[colors[p]!]}
                strokeWidth={2}
                strokeLinejoin="round"
              >
                <title>{`${n}: ${byTurn[last]![p]} points`}</title>
              </polyline>
              <circle
                cx={end[0]}
                cy={end[1]}
                r={4}
                fill={PCOL[colors[p]!]}
                stroke="var(--panel)"
                strokeWidth={2}
              />
              <text x={end[0] + 8} y={end[1] + 4} fontSize="10" fill="var(--ink)">
                {n} {byTurn[last]![p]}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

const GAIN_LABEL: Record<string, string> = {
  production: 'Production',
  trade: 'Trades',
  bank: 'Bank',
  steal: 'Steals',
  cards: 'Cards & bonuses',
  start: 'Start',
};
const LOSS_LABEL: Record<string, string> = {
  robbed: 'Robbed',
  discard: 'Discarded on 7s',
  taken: 'Taken by cards',
  trade: 'Trades',
  bank: 'Bank',
  build: 'Spent building',
};
const VP_LABEL: Record<VPPart['k'], string> = {
  settlement: 'Settlements',
  city: 'Cities',
  longest: 'Longest road',
  largest: 'Largest Army',
  vpCards: 'Victory point cards',
  island: 'Island bonuses',
  metropolis: 'Metropolises',
  defender: 'Defender of Catan',
  merchant: 'Merchant',
  progress: 'Progress cards',
};
const cardName = (k: string) =>
  (CARD_LABEL as Record<string, string>)[k] ??
  (DEV_LABEL as Record<string, string>)[k] ??
  (PROGRESS_LABEL as Record<string, string>)[k] ??
  k;
const cardsLine = (c: Record<string, number | undefined>) =>
  Object.entries(c)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${cardName(k)}`)
    .join(', ') || '—';

/** One game's stats for every player (SPEC 5.5). */
export function GameStatsView({
  stats,
  names,
  colors,
  hexes,
}: {
  stats: GameStats;
  names: string[];
  colors: Color[];
  hexes?: { q: number; r: number; t: string; n: number }[];
}) {
  const P = stats.players;
  const row = (label: string, f: (i: number) => React.ReactNode, testid?: string) => (
    <tr data-testid={testid}>
      <th>{label}</th>
      {P.map((_, i) => (
        <td key={i}>{f(i)}</td>
      ))}
    </tr>
  );
  return (
    <div className="gamestats" data-testid="game-stats">
      <PointsChart byTurn={stats.pointsByTurn} names={names} colors={colors} />
      <div className="tablewrap">
        <table className="stattable wide">
          <thead>
            <tr>
              <th />
              {names.map((n, i) => (
                <th key={i}>
                  <span className="dot" style={{ background: PCOL[colors[i]!] }} /> {n}
                  {stats.winner === i ? ' 🏆' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('Points', (i) => {
              const parts = P[i]!.points;
              return (
                <span
                  title={parts.map((x) => `${VP_LABEL[x.k]} ${x.vp}`).join(', ')}
                  data-testid="final-points"
                >
                  <b>{parts.reduce((a, x) => a + x.vp, 0)}</b>
                  <small className="parts">
                    {parts.map((x) => (
                      <span key={x.k}>
                        {VP_LABEL[x.k]} {x.vp}
                      </span>
                    ))}
                  </small>
                </span>
              );
            })}
            <tr className="group">
              <th colSpan={P.length + 1}>Cards received</th>
            </tr>
            {GAIN_SOURCES.map((k) => row(GAIN_LABEL[k]!, (i) => <CardsCell c={P[i]!.got[k]} />))}
            <tr className="group">
              <th colSpan={P.length + 1}>Cards lost</th>
            </tr>
            {LOSS_SOURCES.map((k) => row(LOSS_LABEL[k]!, (i) => <CardsCell c={P[i]!.lost[k]} />))}
            <tr className="group">
              <th colSpan={P.length + 1}>Robber</th>
            </tr>
            {row('Robbed someone', (i) => P[i]!.robs)}
            {row('Was robbed', (i) => P[i]!.robbed)}
            {row(
              'Robbed by',
              (i) =>
                P[i]!.robbedBy.map((n, j) => (n ? `${names[j]} ${n}` : ''))
                  .filter(Boolean)
                  .join(', ') || '—',
            )}
            <tr className="group">
              <th colSpan={P.length + 1}>Cards, building and trading</th>
            </tr>
            {row('Cards bought or drawn', (i) => cardsLine(P[i]!.bought))}
            {row('Cards played', (i) => cardsLine(P[i]!.played))}
            {row('Knights played', (i) => P[i]!.played.knight ?? 0)}
            {row('Built', (i) => cardsLine(P[i]!.built))}
            {row('Longest road', (i) => P[i]!.longestRoad)}
            {row('Trades with players', (i) => P[i]!.trades.players)}
            {row('Trades with the bank', (i) => P[i]!.trades.bank)}
            {row('Rolls', (i) => P[i]!.rolls)}
            {row('Dice luck', (i) => (
              <Luck got={P[i]!.luck.got} expected={P[i]!.luck.expected} />
            ))}
            {row('Best tile', (i) => {
              const b = bestTile(P[i]!);
              if (!b || !hexes) return b ? `${b[1]} cards` : '—';
              const h = hexes[b[0]]!;
              return (
                <span>
                  <i className="swatch" style={{ background: TILE_COLOR[h.t as keyof typeof TILE_COLOR] }} />{' '}
                  {h.t} {h.n || ''}: {b[1]} cards
                </span>
              );
            })}
          </tbody>
        </table>
      </div>
      <DiceChart dice={stats.dice} title="Dice this game" />
      <EventDieChart events={stats.events} />
    </div>
  );
}

function CardsCell({ c }: { c: Record<string, number | undefined> }) {
  const n = sumCards(c);
  return n ? (
    <span title={cardsLine(c)}>
      <b>{n}</b> <small>{cardsLine(c)}</small>
    </span>
  ) : (
    <span className="muted">0</span>
  );
}

export function Luck({ got, expected }: { got: number; expected: number }) {
  if (!expected) return <span className="muted">—</span>;
  const pct = Math.round((100 * (got - expected)) / expected);
  return (
    <span title={`received ${got}, expected ${expected.toFixed(1)}`}>
      {got} vs {expected.toFixed(0)} ({pct >= 0 ? '+' : ''}
      {pct}%)
    </span>
  );
}

/** A past game's stats, from the Stats page. */
function PastGame({ info, onClose }: { info: GameStatsInfo; onClose: () => void }) {
  return (
    <Sheet
      title={`${MODE_NAME[info.mode]} · ${new Date(info.at).toLocaleDateString()}`}
      onClose={onClose}
      foot={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <MapPreview hexes={info.hexes} size={110} />
      <GameStatsView
        stats={info.stats}
        names={info.players.map((p) => p.name)}
        colors={info.players.map((p) => p.color)}
        hexes={info.hexes}
      />
    </Sheet>
  );
}

/** The Stats page (SPEC 5.6). */
export function StatsPage() {
  const st = useClient();
  const [who, setWho] = useState<string | null>(null);
  const [merge, setMerge] = useState<{ from: string; into: string } | null>(null);
  useEffect(() => {
    if (st.status === 'live') {
      client.loadProfiles();
      client.loadCpus();
    }
  }, [st.status]);
  useEffect(() => {
    if (who && st.status === 'live') client.loadStats(who);
  }, [who, st.status]);
  const rec = st.record?.who === who ? st.record : null;
  const r = rec?.record;
  const pct = (w: number, g: number) => (g ? `${Math.round((100 * w) / g)}%` : '—');
  const people = st.profiles ?? [];
  return (
    <div className="center statspage">
      <div className="card wide" data-testid="stats-page">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Brand />
          <button className="btn small" onClick={() => client.go('/')}>
            Back
          </button>
        </div>
        <h2>Stats</h2>
        <p className="lede">Finished games with two or more people.</p>
        <div className="profiles">
          {people.map((p) => (
            <button
              key={p.id}
              className={`profile${who === p.id ? ' on' : ''}`}
              onClick={() => setWho(p.id)}
              data-testid="stats-who"
              data-name={p.name}
            >
              <span className="dot" style={{ background: PCOL[p.color] }} />
              {p.name}
            </button>
          ))}
          {[
            ...(['easy', 'medium', 'hard'] as const).map((l) => ({
              id: `cpu:${l}`,
              name: `${l[0]!.toUpperCase()}${l.slice(1)} CPU`,
            })),
            ...(st.cpus ?? []).map((c) => ({ id: `cpu:${c.id}`, name: `${c.name} (CPU)` })),
          ].map((c) => (
            <button
              key={c.id}
              className={`profile${who === c.id ? ' on' : ''}`}
              onClick={() => setWho(c.id)}
              data-testid="stats-who"
              data-name={c.name}
            >
              <span className="dot" style={{ background: PCOL.gray }} />
              {c.name}
            </button>
          ))}
        </div>
        {r ? (
          <div data-testid="record">
            <h3>
              {rec!.name}: {r.wins} {r.wins === 1 ? 'win' : 'wins'}, {r.games - r.wins}{' '}
              {r.games - r.wins === 1 ? 'loss' : 'losses'} ({pct(r.wins, r.games)})
            </h3>
            <div className="statgrid">
              <div>
                <span className="eyebrow">Average points</span>
                <b>{r.avgPoints.toFixed(1)}</b>
              </div>
              <div>
                <span className="eyebrow">Overtime wins</span>
                <b data-testid="overtime-wins">{r.overtime ?? 0}</b>
              </div>
              <div>
                <span className="eyebrow">Streak</span>
                <b>
                  {r.streak.current} now · best {r.streak.best}
                </b>
              </div>
              <div>
                <span className="eyebrow">Robberies</span>
                <b>
                  robbed {r.robs} · was robbed {r.robbed}
                </b>
              </div>
              <div>
                <span className="eyebrow">Dice luck</span>
                <b>
                  <Luck got={r.luck.got} expected={r.luck.expected} />
                </b>
              </div>
            </div>
            <table className="stattable">
              <caption>By game mode</caption>
              <tbody>
                {Object.entries(r.byMode).map(([m, x]) => (
                  <tr key={m}>
                    <th>{MODE_NAME[m]}</th>
                    <td>
                      {x.wins} of {x.games} ({pct(x.wins, x.games)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="stattable" data-testid="head-to-head">
              <caption>Head to head</caption>
              <tbody>
                {r.vs.map((x) => (
                  <tr key={x.who}>
                    <th>{x.name}</th>
                    <td>
                      won {x.wins} · lost {x.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="stattable">
              <caption>All-time cards</caption>
              <tbody>
                {GAIN_SOURCES.map((k) => (
                  <tr key={k}>
                    <th>Received: {GAIN_LABEL[k]}</th>
                    <td>{r.got[k] ?? 0}</td>
                  </tr>
                ))}
                {LOSS_SOURCES.map((k) => (
                  <tr key={k}>
                    <th>Lost: {LOSS_LABEL[k]}</th>
                    <td>{r.lost[k] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <DiceChart dice={r.dice} title="Dice in every game" />
            <EventDieChart events={r.events} />
            <h3>Past games</h3>
            <div className="pastlist">
              {r.past.map((g) => (
                <button
                  key={g.id}
                  className="past"
                  onClick={() => client.loadGameStats(g.id)}
                  data-testid="past-game"
                >
                  <span>{new Date(g.at).toLocaleDateString()}</span>
                  <span>{MODE_NAME[g.mode]}</span>
                  <span>
                    {g.players.map((p, i) => (
                      <span key={i} className="who">
                        <span className="dot" style={{ background: PCOL[p.color] }} />
                        {p.name} {p.vp}
                        {p.won ? ' 🏆' : ''}
                      </span>
                    ))}
                    {g.overtime?.length ? (
                      <span className="who overtime">
                        Overtime: {g.overtime.map((w) => `${w.name} to ${w.target}`).join(', ')}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : who ? (
          <p className="hint">Loading…</p>
        ) : (
          <p className="hint">Pick a name.</p>
        )}
        <details className="merge">
          <summary>Merge two names (a typo)</summary>
          <p className="hint">
            Everything of the first name moves to the second. Not possible if both played in the same game.
          </p>
          <div className="row">
            <select
              value={merge?.from ?? ''}
              onChange={(e) => setMerge({ from: e.target.value, into: merge?.into ?? '' })}
              aria-label="Merge this name"
            >
              <option value="">Merge…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={merge?.into ?? ''}
              onChange={(e) => setMerge({ from: merge?.from ?? '', into: e.target.value })}
              aria-label="Into this name"
            >
              <option value="">into…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <MergeButton merge={merge} names={people} onDone={() => setMerge(null)} />
          </div>
        </details>
      </div>
      {st.gameStats ? <PastGame info={st.gameStats} onClose={() => client.closeGameStats()} /> : null}
    </div>
  );
}

function MergeButton({
  merge,
  names,
  onDone,
}: {
  merge: { from: string; into: string } | null;
  names: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const ok = merge && merge.from && merge.into && merge.from !== merge.into;
  const name = (id?: string) => names.find((p) => p.id === id)?.name ?? '';
  return step === 0 ? (
    <button className="btn small" disabled={!ok} onClick={() => setStep(1)}>
      Merge
    </button>
  ) : (
    <span className="row">
      <span>
        Move everything of {name(merge?.from)} into {name(merge?.into)}?
      </span>
      <button
        className="btn small danger"
        onClick={() => {
          client.mergeProfiles(merge!.from, merge!.into);
          setStep(0);
          onDone();
        }}
      >
        Yes, merge
      </button>
      <button className="btn small ghost" onClick={() => setStep(0)}>
        Cancel
      </button>
    </span>
  );
}
