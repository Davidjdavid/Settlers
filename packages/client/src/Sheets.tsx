/* Pop-up sheets: trading, discarding, card choices, menu and confirmations. */

import { useEffect, useState, type ReactNode } from 'react';
import {
  COMS,
  RES,
  TRACKS,
  rateFor,
  stateFromView,
  total,
  type Action,
  type Card,
  type Cards,
  type PartialRes,
  type PlayerView,
  type Resource,
  type Seat,
} from '@settlers/engine';
import {
  CARD_COLOR,
  CARD_LABEL,
  RES_LABEL,
  TILE_COLOR,
  TRACK_COLOR,
  TRACK_LABEL,
  TRACK_ORDER,
  cardIcon,
} from './art';
import { client } from './net';
import { cardsText, nameOf } from './text';

export function Sheet(props: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div className="back" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet" role="dialog" aria-label={props.title}>
        <h3>{props.title}</h3>
        {props.sub ? <p className="sub">{props.sub}</p> : null}
        {props.children}
        <div className="foot">{props.foot}</div>
      </div>
    </div>
  );
}

export const Icon = ({ r }: { r: Card }) => (
  <span
    className="ic"
    style={{ ['--c' as string]: CARD_COLOR[r] }}
    dangerouslySetInnerHTML={{ __html: cardIcon(r) }}
  />
);

/** The kinds of card in hands in this game (commodities with Cities & Knights). */
export const kindsOf = (v: PlayerView): readonly Card[] => (v.ck ? [...RES, ...COMS] : RES);

export function Chips({ c }: { c: Cards }) {
  return (
    <span className="chips">
      {[...RES, ...COMS]
        .filter((r) => (c[r] ?? 0) > 0)
        .map((r) => (
          <span key={r} className="chip" style={{ ['--c' as string]: CARD_COLOR[r] }}>
            <span dangerouslySetInnerHTML={{ __html: cardIcon(r) }} style={{ display: 'contents' }} />
            {c[r]} {CARD_LABEL[r]}
          </span>
        ))}
    </span>
  );
}

export function Ctl(props: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="ctl">
      <button
        type="button"
        aria-label={`Less ${props.label}`}
        disabled={props.value <= 0}
        onClick={() => props.onChange(props.value - 1)}
      >
        −
      </button>
      <output>{props.value}</output>
      <button
        type="button"
        aria-label={`More ${props.label}`}
        disabled={props.value >= props.max}
        onClick={() => props.onChange(props.value + 1)}
      >
        +
      </button>
    </div>
  );
}

/* ---------- Discard ---------- */

export function DiscardSheet({ v, onClose }: { v: PlayerView; onClose: () => void }) {
  const need = v.discard?.[v.me ?? -1] ?? 0;
  const limit = v.ck ? `your limit (7, +2 per city wall)` : '7';
  return (
    <CountSheet
      title={`Discard ${need} cards`}
      sub={`You have more than ${limit} cards. Choose ${need} to give back.`}
      kinds={kindsOf(v)}
      from={v.hand!.res}
      need={need}
      verb="Discard"
      onPick={(cards) => void client.act({ type: 'discard', cards })}
      onClose={onClose}
    />
  );
}

/** Pick exactly `need` cards from `from` (a hand). */
export function CountSheet(props: {
  title: string;
  sub: string;
  kinds: readonly Card[];
  from: Cards;
  need: number;
  verb: string;
  onPick: (c: Cards) => void;
  onClose: () => void;
  testid?: string;
}) {
  const { need, from } = props;
  const [pick, setPick] = useState<Cards>({});
  const n = total(pick);
  return (
    <Sheet
      title={props.title}
      sub={`${props.sub} Picked ${n} of ${need}.`}
      onClose={props.onClose}
      foot={
        <button
          className="btn primary"
          disabled={n !== need}
          data-testid={props.testid}
          onClick={() => {
            props.onPick(pick);
            props.onClose();
          }}
        >
          {props.verb} {n}
        </button>
      }
    >
      <div className="steppers">
        {props.kinds.map((r) => (
          <div className="stepper" key={r} style={{ ['--c' as string]: CARD_COLOR[r] }}>
            <Icon r={r} />
            <span className="lbl">
              {CARD_LABEL[r]}
              <small>has {from[r] ?? 0}</small>
            </span>
            <Ctl
              label={r}
              value={pick[r] ?? 0}
              max={Math.min(from[r] ?? 0, (pick[r] ?? 0) + need - n)}
              onChange={(x) => setPick({ ...pick, [r]: x })}
            />
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- Trade: players and bank ---------- */

export function TradeSheet({
  v,
  onClose,
  tab: start = 'players',
}: {
  v: PlayerView;
  onClose: () => void;
  tab?: 'players' | 'bank';
}) {
  const me = v.me!;
  const myTurn = v.turn === me;
  const [tab, setTab] = useState<'players' | 'bank'>(myTurn ? start : 'players');
  const [give, setGive] = useState<Cards>({});
  const [want, setWant] = useState<Cards>({});
  const [bg, setBg] = useState<Card | null>(null);
  const [bw, setBw] = useState<Card | null>(null);
  const hand = v.hand!.res;
  const s = stateFromView(v);
  const kinds = kindsOf(v);
  const has = (r: Card) => hand[r] ?? 0;
  const bankHas = (r: Card) => v.bank[r] ?? 0;
  const canOffer =
    total(give) > 0 && total(want) > 0 && !kinds.some((r) => (give[r] ?? 0) > 0 && (want[r] ?? 0) > 0);
  const rate = bg ? rateFor(s, me, bg) : 4;

  return (
    <Sheet
      title={myTurn ? 'Trade' : `Offer ${nameOf(v, v.turn)} a trade`}
      sub={
        tab === 'players'
          ? 'Pick what you give and what you want. Everyone sees your offer.'
          : 'Trade with the bank at your best rate.'
      }
      onClose={onClose}
      foot={
        tab === 'players' ? (
          <button
            className="btn primary"
            disabled={!canOffer}
            onClick={() => {
              void client.act({ type: 'offer', give, want });
              onClose();
            }}
          >
            Offer {cardsText(give)} for {cardsText(want)}
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!bg || !bw || has(bg) < rate || bankHas(bw) < 1}
            onClick={() => {
              if (bg && bw) void client.act({ type: 'bank', give: bg, get: bw });
            }}
          >
            {bg && bw ? `Give ${rate} ${bg} for 1 ${bw}` : 'Pick both sides'}
          </button>
        )
      }
    >
      {myTurn ? (
        <div className="tabs">
          <button className={`btn small${tab === 'players' ? ' on' : ''}`} onClick={() => setTab('players')}>
            Players
          </button>
          <button className={`btn small${tab === 'bank' ? ' on' : ''}`} onClick={() => setTab('bank')}>
            Bank
          </button>
        </div>
      ) : null}
      {tab === 'players' ? (
        <div className="tgrid">
          <span />
          <span className="hd">Give</span>
          <span className="hd">Want</span>
          {kinds.map((r) => (
            <div key={r} style={{ display: 'contents' }}>
              <div className="rl" style={{ ['--c' as string]: CARD_COLOR[r] }}>
                <Icon r={r} />
                <span>{CARD_LABEL[r]}</span>
                <small>×{has(r)}</small>
              </div>
              <Ctl
                label={`give ${r}`}
                value={give[r] ?? 0}
                max={has(r)}
                onChange={(x) => setGive({ ...give, [r]: x })}
              />
              <Ctl
                label={`want ${r}`}
                value={want[r] ?? 0}
                max={19}
                onChange={(x) => setWant({ ...want, [r]: x })}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="group">
            <span className="eyebrow">You give</span>
            <div className="pickgrid">
              {kinds.map((r) => {
                const rr = rateFor(s, me, r);
                return (
                  <button
                    key={r}
                    className="pick"
                    aria-pressed={bg === r}
                    disabled={has(r) < rr}
                    onClick={() => setBg(r)}
                    style={{ ['--c' as string]: CARD_COLOR[r] }}
                  >
                    <Icon r={r} />
                    {CARD_LABEL[r]}
                    <small>
                      {rr}:1 · have {has(r)}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="group">
            <span className="eyebrow">You get</span>
            <div className="pickgrid">
              {kinds.map((r) => (
                <button
                  key={r}
                  className="pick"
                  aria-pressed={bw === r}
                  disabled={r === bg || bankHas(r) < 1}
                  onClick={() => setBw(r)}
                  style={{ ['--c' as string]: CARD_COLOR[r] }}
                >
                  <Icon r={r} />
                  {CARD_LABEL[r]}
                  {(RES as readonly string[]).includes(r) ? <small>bank {bankHas(r)}</small> : null}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Dev card choices ---------- */

export function PlentySheet({ v, onClose }: { v: PlayerView; onClose: () => void }) {
  const [pick, setPick] = useState<Resource[]>([]);
  const toggle = (r: Resource) => setPick(pick.length >= 2 ? [r] : [...pick, r]);
  return (
    <Sheet
      title="Year of Plenty"
      sub="Take any 2 resources from the bank (they can be the same)."
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={pick.length !== 2}
          onClick={() => {
            void client.act({ type: 'playPlenty', r1: pick[0]!, r2: pick[1]! });
            onClose();
          }}
        >
          Take {pick.join(' and ') || '…'}
        </button>
      }
    >
      <div className="pickgrid">
        {RES.map((r) => (
          <button
            key={r}
            className="pick"
            aria-pressed={pick.includes(r)}
            disabled={v.bank[r] < 1}
            onClick={() => toggle(r)}
            style={{ ['--c' as string]: TILE_COLOR[r] }}
          >
            <Icon r={r} />
            {RES_LABEL[r]}
            <small>
              {pick.filter((x) => x === r).length
                ? `×${pick.filter((x) => x === r).length}`
                : `bank ${v.bank[r]}`}
            </small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function MonoSheet({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<Resource | null>(null);
  return (
    <Sheet
      title="Monopoly"
      sub="Name a resource. Everyone hands you all of theirs."
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={!r}
          onClick={() => {
            if (r) void client.act({ type: 'playMono', r });
            onClose();
          }}
        >
          Take all the {r ?? '…'}
        </button>
      }
    >
      <div className="pickgrid">
        {RES.map((x) => (
          <button
            key={x}
            className="pick"
            aria-pressed={r === x}
            onClick={() => setR(x)}
            style={{ ['--c' as string]: TILE_COLOR[x] }}
          >
            <Icon r={x} />
            {RES_LABEL[x]}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function VictimSheet({
  v,
  hex,
  victims,
  kind = 'robber',
  make,
  onClose,
}: {
  v: PlayerView;
  hex: number;
  victims: Seat[];
  kind?: 'robber' | 'pirate';
  /** Build the action for a victim (default: a robber or pirate move). */
  make?: (p: Seat) => Action;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Steal from whom?"
      sub="You take one random card from the player you pick."
      onClose={onClose}
      foot={
        <button className="btn ghost" onClick={onClose}>
          Back
        </button>
      }
    >
      <div className="menuitems">
        {victims.map((p) => (
          <button
            key={p}
            className="btn"
            onClick={() => {
              void client.act(make ? make(p) : { type: kind, hex, victim: p });
              onClose();
            }}
          >
            {nameOf(v, p)} · {v.players[p]!.resCount} cards
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- Two-step confirmation ---------- */

export function ConfirmTwice(props: {
  title: string;
  first: string;
  second: string;
  action: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  return (
    <Sheet
      title={props.title}
      sub={step === 1 ? props.first : props.second}
      onClose={props.onClose}
      foot={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary danger"
            onClick={() => {
              if (step === 1) setStep(2);
              else {
                props.onConfirm();
                props.onClose();
              }
            }}
          >
            {step === 1 ? 'Continue' : props.action}
          </button>
        </>
      }
    >
      {null}
    </Sheet>
  );
}

/* ---------- Menu ---------- */

export function MenuSheet({
  v,
  code,
  onClose,
  onEndGame,
  onSettings,
  onRules,
  onQuit,
  onLayout,
}: {
  v: PlayerView | null;
  code: string;
  onClose: () => void;
  onEndGame: () => void;
  /** "My settings", for a seated player. */
  onSettings?: () => void;
  /** The game's rules, changed by whoever has the dice. */
  onRules?: () => void;
  /** "Save and quit" (SPEC 5.7). */
  onQuit?: () => void;
  /** "Edit layout" (SPEC 11). */
  onLayout?: () => void;
}) {
  const link = `${location.origin}/r/${code}`;
  const seated = v?.me != null;
  return (
    <Sheet
      title={`Room ${code}`}
      sub="Share this link so friends can join or rejoin."
      onClose={onClose}
      foot={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="menuitems">
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(
              () => client.toast('Invite link copied'),
              () => client.toast(link),
            );
          }}
        >
          Copy invite link
        </button>
        {onSettings ? (
          <button className="btn" onClick={onSettings} data-testid="menu-settings">
            My settings
          </button>
        ) : null}
        {onLayout ? (
          <button className="btn" onClick={onLayout} data-testid="menu-layout">
            Edit layout
          </button>
        ) : null}
        {onRules && v ? (
          <button className="btn" onClick={onRules} data-testid="menu-rules">
            Table rules
          </button>
        ) : null}
        <div className="group">
          <span className="eyebrow">Building costs</span>
          <div className="costs">
            <div>
              Road <Chips c={{ wood: 1, brick: 1 }} />
            </div>
            <div>
              Settlement <Chips c={{ wood: 1, brick: 1, sheep: 1, wheat: 1 }} />
            </div>
            <div>
              City <Chips c={{ wheat: 2, ore: 3 }} />
            </div>
            {v?.ck ? (
              <>
                <div>
                  Knight, or promoting one <Chips c={{ sheep: 1, ore: 1 }} />
                </div>
                <div>
                  Activating a knight <Chips c={{ wheat: 1 }} />
                </div>
                <div>
                  City wall <Chips c={{ brick: 2 }} />
                </div>
                <div>Improvement level n: n paper (science), linen (trade) or coin (politics)</div>
              </>
            ) : (
              <div>
                Development card <Chips c={{ sheep: 1, wheat: 1, ore: 1 }} />
              </div>
            )}
          </div>
        </div>
        {onQuit ? (
          <button className="btn" onClick={onQuit} data-testid="menu-quit">
            Save and quit
          </button>
        ) : null}
        {v && seated && v.phase === 'play' ? (
          <button className="btn danger" onClick={onEndGame}>
            End this game and start a new one…
          </button>
        ) : null}
        <button className="btn ghost" onClick={() => client.leaveRoom()}>
          Leave this room
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Seafarers ---------- */

export function GoldSheet({ v, due, onClose }: { v: PlayerView; due: number; onClose: () => void }) {
  const [pick, setPick] = useState<PartialRes>({});
  const n = total(pick);
  return (
    <Sheet
      title={`Gold! Pick ${due} resource${due === 1 ? '' : 's'}`}
      sub={`A gold field pays any resource you like. Picked ${n} of ${due}.`}
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={n !== due}
          data-testid="gold-take"
          onClick={() => {
            void client.act({ type: 'chooseGold', cards: pick });
            onClose();
          }}
        >
          Take {cardsText(pick)}
        </button>
      }
    >
      <div className="steppers">
        {RES.map((r) => (
          <div className="stepper" key={r} style={{ ['--c' as string]: TILE_COLOR[r] }}>
            <Icon r={r} />
            <span className="lbl">
              {RES_LABEL[r]}
              <small>bank {v.bank[r]}</small>
            </span>
            <Ctl
              label={r}
              value={pick[r] ?? 0}
              max={Math.min(v.bank[r], (pick[r] ?? 0) + due - n)}
              onChange={(x) => setPick({ ...pick, [r]: x })}
            />
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** A treasure's choice (docs/rules/treasures.md): resources from the bank, or a progress deck. */
export function TreasureSheet({
  v,
  due,
  onClose,
}: {
  v: PlayerView;
  due: { k: 'pick' | 'deck'; n: number };
  onClose: () => void;
}) {
  const [pick, setPick] = useState<PartialRes>({});
  const n = total(pick);
  if (due.k === 'deck')
    return (
      <Sheet
        title="Treasure! Pick a progress deck"
        sub="You draw the top card of the deck you pick."
        onClose={onClose}
      >
        <div className="row" data-testid="treasure-decks">
          {TRACKS.map((t) => {
            const left = v.ck?.decks[t] ?? 0;
            return (
              <button
                key={t}
                className="btn"
                disabled={!left}
                data-testid={`treasure-deck-${t}`}
                style={{ borderColor: TRACK_COLOR[t] }}
                onClick={() => {
                  void client.act({ type: 'treasureDeck', track: t });
                  onClose();
                }}
              >
                {TRACK_LABEL[t]} ({left} left)
              </button>
            );
          })}
        </div>
      </Sheet>
    );
  return (
    <Sheet
      title={`Treasure! Pick ${due.n} resource${due.n === 1 ? '' : 's'}`}
      sub={`Any resource the bank has. Picked ${n} of ${due.n}.`}
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={n !== due.n}
          data-testid="treasure-take"
          onClick={() => {
            void client.act({ type: 'treasurePick', cards: pick });
            onClose();
          }}
        >
          Take {cardsText(pick)}
        </button>
      }
    >
      <div className="steppers" data-testid="treasure-pick">
        {RES.map((r) => (
          <div className="stepper" key={r} style={{ ['--c' as string]: TILE_COLOR[r] }}>
            <Icon r={r} />
            <span className="lbl">
              {RES_LABEL[r]}
              <small>bank {v.bank[r]}</small>
            </span>
            <Ctl
              label={r}
              value={pick[r] ?? 0}
              max={Math.min(v.bank[r], (pick[r] ?? 0) + due.n - n)}
              onChange={(x) => setPick({ ...pick, [r]: x })}
            />
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** When an edge could take a road or a ship, ask which. */
/** What a tap on a corner can do, when there's more than one thing (a city: a wall or an improvement). */
export function TapSheet({
  v,
  options,
  onPick,
  onClose,
}: {
  v: PlayerView;
  options: Action[];
  onPick: (a: Action) => void;
  onClose: () => void;
}) {
  // One button per kind (an improvement is one button per track, whatever city it lands on).
  const seen = new Set<string>();
  const rank = (a: Action) => (a.type === 'improve' ? TRACK_ORDER.indexOf(a.track) : 9);
  const items = options
    .filter((a) => {
      const key = a.type === 'improve' ? `improve:${a.track}` : a.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));
  const label = (a: Action): string => {
    switch (a.type) {
      case 'settlement':
        return 'Build a settlement';
      case 'city':
        return 'Upgrade to a city';
      case 'wall':
        return 'Build a city wall';
      case 'knight':
        return 'Place a knight';
      case 'improve': {
        const lvl = v.ck?.lvl[v.me!]?.[a.track] ?? 0;
        return `Improve ${TRACK_LABEL[a.track]} to ${lvl + 1}${a.v != null ? ' (metropolis here)' : ''}`;
      }
      default:
        return a.type;
    }
  };
  return (
    <Sheet
      title="What do you want to do here?"
      onClose={onClose}
      foot={
        <button className="btn ghost" onClick={onClose}>
          Back
        </button>
      }
    >
      <div className="menuitems">
        {items.map((a) => (
          <button
            key={a.type === 'improve' ? `improve-${a.track}` : a.type}
            className="btn"
            style={a.type === 'improve' ? { borderLeft: `4px solid ${TRACK_COLOR[a.track]}` } : undefined}
            onClick={() => onPick(a)}
            data-testid={`tap-${a.type === 'improve' ? `improve-${a.track}` : a.type}`}
          >
            {label(a)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function PieceSheet({
  options,
  onPick,
  onClose,
}: {
  options: Action[];
  onPick: (a: Action) => void;
  onClose: () => void;
}) {
  const label = (a: Action) =>
    a.type === 'ship' || a.type === 'freeShip' || (a.type === 'setup' && a.ship) ? 'Ship' : 'Road';
  return (
    <Sheet
      title="Road or ship?"
      sub="This edge is on the coast, so either fits."
      onClose={onClose}
      foot={
        <button className="btn ghost" onClick={onClose}>
          Back
        </button>
      }
    >
      <div className="row">
        {options.map((a) => (
          <button
            key={label(a)}
            className="btn primary"
            onClick={() => onPick(a)}
            data-testid={`piece-${label(a).toLowerCase()}`}
          >
            {label(a)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
