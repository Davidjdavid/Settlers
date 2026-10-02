/* Cities & Knights parts of the table: barbarians, improvements, progress cards, knight and choice sheets. */

import { useState, type ReactNode } from 'react';
import {
  COMS, RES, TRACKS, TRACK_COM, trackOf, type Action, type Card, type DevType, type Owe, type PlayerView,
  type Progress, type Seat, type Track,
} from '@settlers/engine'; // prettier-ignore
import {
  CARD_COLOR, CARD_LABEL, DEV_HELP, DEV_LABEL, PCOL, PROGRESS_HELP, PROGRESS_LABEL, TRACK_ABILITY, TRACK_COLOR, TRACK_LABEL, TRACK_ORDER,
  dieSVG,
} from './art'; // prettier-ignore
import { cardArt } from './cardart';
import { client } from './net';
import { CountSheet, Icon, Sheet, kindsOf } from './Sheets';
import { listNames, nameOf } from './text';

type Choose = Extract<Action, { type: 'choose' }>;
type Play = Extract<Action, { type: 'progress' }>;

/** The first choice the viewer owes, if any. */
export const myOwe = (v: PlayerView): Owe | null =>
  v.me != null && v.stage === 'ck' ? (v.ck?.owe.find((o) => o.p === v.me) ?? null) : null;

/** Choices made by clicking the board rather than in a sheet. */
export const BOARD_OWES = new Set<Owe['k']>(['loseCity', 'relocate', 'desert', 'deserterPlace', 'rebuild']);

/** What a progress card asks for, judged from its legal plays. */
export type Param = 'none' | 'd' | 'v' | 'vs' | 'h' | 'hh' | 'e' | 'to' | 'r';
export function paramOf(plays: Play[]): Param {
  const a = plays[0];
  if (!a) return 'none';
  if (a.d) return 'd';
  if (a.vs) return 'vs';
  if (a.h2 != null) return 'hh';
  if (a.h != null) return 'h';
  if (a.v != null) return 'v';
  if (a.e != null) return 'e';
  if (a.to != null) return 'to';
  if (a.r) return 'r';
  return 'none';
}

const OWE_TITLE: Record<Owe['k'], [string, string]> = {
  loseCity: [
    'The barbarians take one of your cities',
    'Tap a city (not a metropolis). It becomes a settlement.',
  ],
  defenderDraw: ['You helped beat the barbarians', 'Draw a progress card from a deck of your choice.'],
  overflow: ['Too many progress cards', 'You can hold 4. Put one back under its deck.'],
  aqueduct: ['Aqueduct', 'The roll gave you nothing, so take a resource of your choice.'],
  relocate: ['Your knight was chased away', 'Tap an empty corner next to your road to put it.'],
  desert: ['Deserter', 'Tap one of your knights to remove.'],
  deserterPlace: ['Deserter', 'You may place a knight like the one that deserted. Tap a corner, or skip.'],
  give: ['Wedding', 'Choose the cards to give.'],
  discard: ['Saboteur', 'Choose cards to discard.'],
  harbor: ['Commercial Harbor', 'Offer each player a resource for one of their commodities.'],
  harborGive: ['Commercial Harbor', 'Give a commodity in return.'],
  take: ['Master Merchant', 'Take cards from their hand.'],
  spy: ['Spy', 'Take one of their progress cards.'],
  rebuild: ['Diplomat', 'You may build the removed road again for free. Tap an edge, or skip.'],
};

export function owePrompt(v: PlayerView, o: Owe | null): { title: string; sub: string; mine: boolean } {
  if (o) {
    const [title, sub] = OWE_TITLE[o.k];
    const n = 'n' in o ? o.n : 0;
    const extra =
      o.k === 'give' ? ` Give ${n} to ${nameOf(v, o.to)}.` : o.k === 'take' ? ` Take ${n} from ${nameOf(v, o.from)}.` : o.k === 'discard' ? ` Discard ${n}.` : ''; // prettier-ignore
    return { title, sub: sub + extra, mine: true };
  }
  const waiting = [...new Set(v.ck?.owe.map((x) => x.p) ?? [])];
  return { title: 'Waiting for choices', sub: `Waiting for ${listNames(v, waiting)}.`, mine: false };
}

/* ---------- Side panel: barbarians and decks ---------- */

/** How close the barbarians are: calm, near (3 or fewer steps), or close (1). */
export const barbLevel = (left: number) => (left <= 1 ? 'close' : left <= 3 ? 'near' : 'calm');

/** The barbarians in the top bar: always in view, whatever the layout. */
export function BarbarianChip({ v }: { v: PlayerView }) {
  const ck = v.ck!;
  const left = 7 - ck.barb;
  const strength = v.verts.filter((b) => b && b[1] === 2).length;
  const defense = ck.knights.reduce((a, k) => a + (k?.on ? k.lvl : 0), 0);
  return (
    <span
      className={`turnchip barbchip barb-${barbLevel(left)}`}
      data-testid="barb-chip"
      title={`Barbarians: ${left} ${left === 1 ? 'step' : 'steps'} to attack · strength ${strength} vs defense ${defense}`}
    >
      <span aria-hidden="true">⛵</span>
      <span className="label">{left}</span>
      <span className="sub">to attack</span>
    </span>
  );
}

export function BarbarianBox({ v }: { v: PlayerView }) {
  const ck = v.ck!;
  const strength = v.verts.filter((b) => b && b[1] === 2).length;
  const defense = ck.knights.reduce((a, k) => a + (k?.on ? k.lvl : 0), 0);
  const delay = v.rules.houseRules.barbarianDelay ?? 0;
  const waiting = v.turnN <= delay * v.players.length;
  const left = 7 - ck.barb;
  return (
    <section className={`box ckbox barb-${barbLevel(left)}`} aria-label="Barbarians" data-testid="barbarians">
      <div className="barbhead">
        <span className="eyebrow">Barbarians</span>
        <span className="barbleft" data-testid="barb-left">
          <b>{left}</b> {left === 1 ? 'step' : 'steps'} to attack
        </span>
      </div>
      <div className="track" title={`${ck.barb} of 7`}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={`step${i === ck.barb ? ' ship' : ''}${i === 7 ? ' land' : ''}`}>
            {i === ck.barb ? '⛵' : i === 7 ? '🏰' : ''}
          </span>
        ))}
      </div>
      <div className="ckline">
        <span>
          Strength <b>{strength}</b> (cities)
        </span>
        <span>
          Defense <b>{defense}</b> (active knights)
        </span>
      </div>
      <div className={`barbverdict${strength > defense ? ' bad' : ''}`} data-testid="barb-verdict">
        {strength > defense
          ? `If they landed now, the barbarians would win (${strength} vs ${defense})`
          : `If they landed now, Catan would hold (${defense} vs ${strength})`}
      </div>
      <div className="ckline">
        {ck.attacks ? (
          <span>
            {ck.attacks} attack{ck.attacks === 1 ? '' : 's'} so far
          </span>
        ) : (
          <span>Robber asleep until the first attack</span>
        )}
        {waiting ? <span>Event die starts in round {delay + 1}</span> : null}
      </div>
      <div className="ckline decks">
        {TRACK_ORDER.map((t) => (
          <span key={t} style={{ ['--c' as string]: TRACK_COLOR[t] }} className="deck">
            {TRACK_LABEL[t]} {ck.decks[t]}
          </span>
        ))}
      </div>
    </section>
  );
}

const FACE_LABEL = {
  ship: 'Barbarian ship',
  trade: 'Trade gate',
  politics: 'Politics gate',
  science: 'Science gate',
};

/** The event die next to the production dice. */
export function EventDie({ v }: { v: PlayerView }) {
  const e = v.ck?.event;
  if (!e || !v.dice) return null;
  return (
    <span
      className="eventdie"
      title={FACE_LABEL[e]}
      data-testid="event-die"
      data-face={e}
      style={{ ['--c' as string]: e === 'ship' ? '#20242b' : TRACK_COLOR[e] }}
    >
      {e === 'ship' ? '⛵' : '⛩'}
    </span>
  );
}

/** Small per-player C&K stats for the player list. */
export function PlayerCK({ v, p }: { v: PlayerView; p: Seat }) {
  const ck = v.ck!;
  const knights = ck.knights.filter((k) => k && k.p === p);
  const active = knights.reduce((a, k) => a + (k!.on ? k!.lvl : 0), 0);
  const col = ck.colors[p]!;
  return (
    <span className="stats ckstats">
      <span title="Active knight strength / knights">
        <b>{active}</b>/{knights.length} knights
      </span>
      {TRACK_ORDER.map((t) => (
        <span
          key={t}
          className="lvl"
          style={{ ['--c' as string]: TRACK_COLOR[t] }}
          title={`${TRACK_LABEL[t]} level`}
        >
          {ck.lvl[p]![t]}
        </span>
      ))}
      <span title="Progress cards by colour" className="pcols">
        {TRACK_ORDER.flatMap((t) =>
          Array.from({ length: col[t] }, (_, i) => (
            <i key={`${t}${i}`} style={{ background: TRACK_COLOR[t] }} data-pcol={t} />
          )),
        )}
      </span>
      {ck.defender[p] ? <span title="Defender of Catan">🛡{ck.defender[p]}</span> : null}
    </span>
  );
}

/* ---------- Tray: improvements and progress cards ---------- */

export function ImproveRow({
  v,
  acts,
  busy,
  onImprove,
}: {
  v: PlayerView;
  acts: Action[];
  busy: boolean;
  onImprove: (t: Track, options: Action[]) => void;
}) {
  const ck = v.ck!;
  const me = v.me!;
  // Improvements need a city (SPEC 9.2: a blocked button says why).
  const hasCity = v.verts.some((b) => b && b[0] === me && b[1] === 2);
  return (
    <div className="improve">
      {TRACK_ORDER.map((t) => {
        const L = ck.lvl[me]![t];
        const opts = acts.filter((a) => a.type === 'improve' && a.track === t);
        const cost = Math.max(0, L + 1 - (ck.crane > 0 ? 1 : 0));
        return (
          <button
            key={t}
            className="btn bbtn ibtn"
            style={{ ['--c' as string]: TRACK_COLOR[t] }}
            disabled={busy || !opts.length}
            data-testid={`improve-${t}`}
            title={
              !hasCity && L < 5
                ? 'You need a city to buy city improvements'
                : `Level 3: ${TRACK_ABILITY[t]}. Level 4 earns the metropolis.`
            }
            onClick={() => onImprove(t, opts)}
          >
            <span>
              {TRACK_LABEL[t]} <b>{L}</b>
              {L >= 3 ? ' ★' : ''}
            </span>
            <span className="cost" data-testid={`ibtn-why-${t}`}>
              {L >= 5
                ? 'complete'
                : !hasCity
                  ? 'needs a city'
                  : `next: ${cost} ${CARD_LABEL[TRACK_COM[t]].toLowerCase()}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A progress or development card's face: its picture, name and what it does, always shown. */
export function CardFace({
  c,
  sub,
}: {
  c: Progress | DevType;
  /** A note after the name (the track, "×2", "+1 point"). */
  sub?: ReactNode;
}) {
  const progress = c in PROGRESS_LABEL;
  return (
    <span className="cardface">
      <span
        className="art"
        style={progress ? { ['--c' as string]: TRACK_COLOR[trackOf(c as Progress)] } : undefined}
        dangerouslySetInnerHTML={{ __html: cardArt(c) }}
      />
      <span className="body">
        <span className="t">
          {progress ? PROGRESS_LABEL[c as Progress] : DEV_LABEL[c as DevType]}
          {sub ? <span className="c"> {sub}</span> : null}
        </span>
        <span className="d">{progress ? PROGRESS_HELP[c as Progress] : DEV_HELP[c as DevType]}</span>
      </span>
    </span>
  );
}

/** Your progress cards, each with its picture and what it does, and the ones shown for points. */
export function ProgressRow({
  v,
  acts,
  busy,
  onPlay,
  onDrop,
}: {
  v: PlayerView;
  acts: Action[];
  busy: boolean;
  onPlay: (card: Progress, plays: Play[]) => void;
  onDrop: (card: Progress) => void;
}) {
  const hand = v.ck?.hand ?? [];
  const shown = v.ck?.shown[v.me!] ?? [];
  if (!hand.length && !shown.length) return null;
  return (
    <>
      {hand.map((c, i) => {
        const plays = acts.filter((a): a is Play => a.type === 'progress' && a.card === c);
        const drop = acts.some((a) => a.type === 'dropProgress' && a.card === c);
        return (
          <div
            key={`${c}${i}`}
            className="playcard"
            style={{ ['--c' as string]: TRACK_COLOR[trackOf(c)] }}
            data-progress={c}
          >
            <CardFace c={c} sub={TRACK_LABEL[trackOf(c)]} />
            <span className="row">
              <button className="btn small" disabled={busy || !plays.length} onClick={() => onPlay(c, plays)}>
                Play
              </button>
              {drop ? (
                <button className="btn small ghost" disabled={busy} onClick={() => onDrop(c)}>
                  Put back
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
      {shown.map((c, i) => (
        <div key={`s${c}${i}`} className="playcard vp" style={{ ['--c' as string]: TRACK_COLOR[trackOf(c)] }}>
          <CardFace c={c} sub="+1 point" />
        </div>
      ))}
    </>
  );
}

/* ---------- Sheets ---------- */

/** Actions for one of your knights. */
export function KnightSheet({
  v,
  at,
  acts,
  onMove,
  onChase,
  onClose,
}: {
  v: PlayerView;
  at: number;
  acts: Action[];
  onMove: () => void;
  onChase: () => void;
  onClose: () => void;
}) {
  const k = v.ck!.knights[at]!;
  const has = (t: Action['type']) =>
    acts.some(
      (a) => a.type === t && ((a as { v?: number; from?: number }).v ?? (a as { from?: number }).from) === at,
    );
  const act = (a: Action) => {
    void client.act(a);
    onClose();
  };
  return (
    <Sheet
      title={`${['', 'Basic', 'Strong', 'Mighty'][k.lvl]} knight (${k.on ? 'active' : 'inactive'})`}
      sub="Active knights defend against the barbarians. A knight can act once it was active at the start of your turn."
      onClose={onClose}
      foot={
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="menuitems">
        <button
          className="btn"
          disabled={!has('activate')}
          onClick={() => act({ type: 'activate', v: at })}
          data-testid="k-activate"
        >
          Activate (1 wheat)
        </button>
        <button
          className="btn"
          disabled={!has('promote')}
          onClick={() => act({ type: 'promote', v: at })}
          data-testid="k-promote"
        >
          Promote (1 sheep, 1 ore)
        </button>
        <button
          className="btn"
          disabled={!has('moveKnight')}
          onClick={() => {
            onMove();
            onClose();
          }}
          data-testid="k-move"
        >
          Move or chase away a weaker knight
        </button>
        <button
          className="btn"
          disabled={!has('chase')}
          onClick={() => {
            onChase();
            onClose();
          }}
          data-testid="k-chase"
        >
          Chase the robber
        </button>
      </div>
    </Sheet>
  );
}

/** Pick one of several options shown as buttons. */
function Options<T>(props: {
  title: string;
  sub: string;
  options: T[];
  label: (o: T) => React.ReactNode;
  style?: (o: T) => React.CSSProperties | undefined;
  onPick: (o: T) => void;
  onClose: () => void;
  testid?: (o: T) => string;
}) {
  return (
    <Sheet
      title={props.title}
      sub={props.sub}
      onClose={props.onClose}
      foot={
        <button className="btn ghost" onClick={props.onClose}>
          Close
        </button>
      }
    >
      <div className="pickgrid">
        {props.options.map((o, i) => (
          <button
            key={i}
            className="pick"
            style={props.style?.(o)}
            data-testid={props.testid?.(o)}
            onClick={() => {
              props.onPick(o);
              props.onClose();
            }}
          >
            {props.label(o)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

const cardStyle = (c: Card) => ({ ['--c' as string]: CARD_COLOR[c] });
const cardLabel = (c: Card) => (
  <>
    <Icon r={c} />
    {CARD_LABEL[c]}
  </>
);

/** Choices owed that are made in a sheet. */
export function OweSheet({
  v,
  o,
  opts,
  onClose,
}: {
  v: PlayerView;
  o: Owe;
  opts: Choose[];
  onClose: () => void;
}) {
  const choose = (a: Omit<Choose, 'type'>) => void client.act({ type: 'choose', ...a });
  const [title, sub] = OWE_TITLE[o.k];
  switch (o.k) {
    case 'defenderDraw':
      return (
        <Options
          title={title}
          sub={sub}
          options={opts.map((a) => a.track!)}
          label={(t) => `${TRACK_LABEL[t]} (${v.ck!.decks[t]} left)`}
          style={(t) => ({ ['--c' as string]: TRACK_COLOR[t] })}
          onPick={(track) => choose({ track })}
          onClose={onClose}
        />
      );
    case 'overflow':
    case 'spy': {
      const cards = opts.map((a) => a.card!);
      return (
        <Options
          title={title}
          sub={o.k === 'spy' ? `${nameOf(v, o.from)}’s progress cards. Take one.` : sub}
          options={cards}
          label={(c) => <CardFace c={c} sub={TRACK_LABEL[trackOf(c)]} />}
          style={(c) => ({ ['--c' as string]: TRACK_COLOR[trackOf(c)] })}
          onPick={(card) => choose({ card })}
          onClose={onClose}
          testid={(c) => `pick-${c}`}
        />
      );
    }
    case 'aqueduct':
    case 'harborGive':
      return (
        <Options
          title={title}
          sub={o.k === 'harborGive' ? `${nameOf(v, o.to)} gave you 1 ${o.r}. Give a commodity back.` : sub}
          options={opts.map((a) => a.r!)}
          label={cardLabel}
          style={cardStyle}
          onPick={(r) => choose({ r })}
          onClose={onClose}
        />
      );
    case 'give':
    case 'discard':
      return (
        <CountSheet
          title={title}
          sub={
            o.k === 'give'
              ? `Give ${o.n} cards of your choice to ${nameOf(v, o.to)}.`
              : `Discard ${o.n} cards of your choice.`
          }
          kinds={kindsOf(v)}
          from={v.hand!.res}
          need={o.n}
          verb={o.k === 'give' ? 'Give' : 'Discard'}
          onPick={(cards) => choose({ cards })}
          onClose={onClose}
        />
      );
    case 'take':
      return (
        <CountSheet
          title={title}
          sub={`${nameOf(v, o.from)}’s hand. Take ${o.n}.`}
          kinds={kindsOf(v)}
          from={v.ck!.reveal?.hand ?? {}}
          need={o.n}
          verb="Take"
          onPick={(cards) => choose({ cards })}
          onClose={onClose}
        />
      );
    case 'harbor':
      return <HarborSheet v={v} left={o.left} onClose={onClose} />;
    default:
      return null;
  }
}

function HarborSheet({ v, left, onClose }: { v: PlayerView; left: Seat[]; onClose: () => void }) {
  const to = left[0]!;
  const hand = v.hand!.res;
  return (
    <Sheet
      title={`Commercial Harbor: ${nameOf(v, to)}`}
      sub={`Offer ${nameOf(v, to)} one of your resources; they give you a commodity back.`}
      onClose={onClose}
      foot={
        <button className="btn ghost" onClick={() => void client.act({ type: 'choose', to, skip: true })}>
          Skip {nameOf(v, to)}
        </button>
      }
    >
      <div className="pickgrid">
        {RES.map((r) => (
          <button
            key={r}
            className="pick"
            style={cardStyle(r)}
            disabled={!hand[r]}
            onClick={() => void client.act({ type: 'choose', to, r })}
          >
            {cardLabel(r)}
            <small>have {hand[r]}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Progress cards that need a player, a card kind or dice. */
export function CardParamSheet({
  v,
  card,
  plays,
  onClose,
}: {
  v: PlayerView;
  card: Progress;
  plays: Play[];
  onClose: () => void;
}) {
  const play = (a: Play) => void client.act(a);
  const kind = paramOf(plays);
  if (kind === 'to')
    return (
      <Options
        title={PROGRESS_LABEL[card]}
        sub={PROGRESS_HELP[card]}
        options={plays}
        label={(a) => (
          <>
            <span className="dot" style={{ background: PCOL[v.players[a.to!]!.color] }} />
            {nameOf(v, a.to!)}
          </>
        )}
        onPick={play}
        onClose={onClose}
      />
    );
  if (kind === 'r')
    return (
      <Options
        title={PROGRESS_LABEL[card]}
        sub={PROGRESS_HELP[card]}
        options={plays}
        label={(a) => cardLabel(a.r!)}
        style={(a) => cardStyle(a.r!)}
        onPick={play}
        onClose={onClose}
      />
    );
  if (kind === 'd') return <AlchemistSheet plays={plays} onClose={onClose} />;
  return null;
}

function AlchemistSheet({ plays, onClose }: { plays: Play[]; onClose: () => void }) {
  const [d, setD] = useState<[number, number]>([3, 4]);
  const ok = plays.some((a) => a.d![0] === d[0] && a.d![1] === d[1]);
  const face = (i: 0 | 1) => (
    <div className="ctl" style={{ alignItems: 'center' }}>
      <button
        type="button"
        disabled={d[i] <= 1}
        onClick={() => setD(i ? [d[0], d[1] - 1] : [d[0] - 1, d[1]])}
      >
        −
      </button>
      <span
        dangerouslySetInnerHTML={{ __html: dieSVG(d[i], i ? 'red' : 'yellow') }}
        style={{ display: 'inline-flex', width: 34 }}
      />
      <button
        type="button"
        disabled={d[i] >= 6}
        onClick={() => setD(i ? [d[0], d[1] + 1] : [d[0] + 1, d[1]])}
      >
        +
      </button>
    </div>
  );
  return (
    <Sheet
      title="Alchemist"
      sub="Choose the yellow and red dice for this roll. The event die rolls as usual."
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={!ok}
          onClick={() => {
            void client.act({ type: 'progress', card: 'alchemist', d });
            onClose();
          }}
        >
          Roll {d[0] + d[1]}
        </button>
      }
    >
      <div className="row" style={{ gap: 18 }}>
        <span>Yellow</span>
        {face(0)}
        <span>Red</span>
        {face(1)}
      </div>
    </Sheet>
  );
}
