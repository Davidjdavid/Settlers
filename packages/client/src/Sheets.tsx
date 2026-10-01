/* Pop-up sheets: trading, discarding, card choices, menu and confirmations. */

import { useEffect, useState, type ReactNode } from 'react';
import {
  RES,
  rateFor,
  stateFromView,
  total,
  type Action,
  type PartialRes,
  type PlayerView,
  type Resource,
  type Seat,
} from '@settlers/engine';
import { RES_LABEL, TILE_COLOR, iconSVG } from './art';
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

const Icon = ({ r }: { r: Resource }) => (
  <span
    className="ic"
    style={{ ['--c' as string]: TILE_COLOR[r] }}
    dangerouslySetInnerHTML={{ __html: iconSVG(r) }}
  />
);

export function Chips({ c }: { c: PartialRes }) {
  return (
    <span className="chips">
      {RES.filter((r) => (c[r] ?? 0) > 0).map((r) => (
        <span key={r} className="chip" style={{ ['--c' as string]: TILE_COLOR[r] }}>
          <span dangerouslySetInnerHTML={{ __html: iconSVG(r) }} style={{ display: 'contents' }} />
          {c[r]} {RES_LABEL[r]}
        </span>
      ))}
    </span>
  );
}

function Ctl(props: { value: number; max: number; onChange: (n: number) => void; label: string }) {
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
  const hand = v.hand!.res;
  const [pick, setPick] = useState<PartialRes>({});
  const n = total(pick);
  return (
    <Sheet
      title={`Discard ${need} cards`}
      sub={`You have more than 7 cards. Choose ${need} to give back. Picked ${n} of ${need}.`}
      onClose={onClose}
      foot={
        <button
          className="btn primary"
          disabled={n !== need}
          onClick={() => {
            void client.act({ type: 'discard', cards: pick });
            onClose();
          }}
        >
          Discard {n}
        </button>
      }
    >
      <div className="steppers">
        {RES.map((r) => (
          <div className="stepper" key={r} style={{ ['--c' as string]: TILE_COLOR[r] }}>
            <Icon r={r} />
            <span className="lbl">
              {RES_LABEL[r]}
              <small>you have {hand[r]}</small>
            </span>
            <Ctl
              label={r}
              value={pick[r] ?? 0}
              max={Math.min(hand[r], (pick[r] ?? 0) + need - n)}
              onChange={(x) => setPick({ ...pick, [r]: x })}
            />
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- Trade: players and bank ---------- */

export function TradeSheet({ v, onClose }: { v: PlayerView; onClose: () => void }) {
  const me = v.me!;
  const myTurn = v.turn === me;
  const [tab, setTab] = useState<'players' | 'bank'>('players');
  const [give, setGive] = useState<PartialRes>({});
  const [want, setWant] = useState<PartialRes>({});
  const [bg, setBg] = useState<Resource | null>(null);
  const [bw, setBw] = useState<Resource | null>(null);
  const hand = v.hand!.res;
  const s = stateFromView(v);
  const canOffer =
    total(give) > 0 && total(want) > 0 && !RES.some((r) => (give[r] ?? 0) > 0 && (want[r] ?? 0) > 0);
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
            disabled={!bg || !bw || hand[bg] < rate || v.bank[bw] < 1}
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
          {RES.map((r) => (
            <div key={r} style={{ display: 'contents' }}>
              <div className="rl" style={{ ['--c' as string]: TILE_COLOR[r] }}>
                <Icon r={r} />
                <span>{RES_LABEL[r]}</span>
                <small>×{hand[r]}</small>
              </div>
              <Ctl
                label={`give ${r}`}
                value={give[r] ?? 0}
                max={hand[r]}
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
              {RES.map((r) => {
                const rr = rateFor(s, me, r);
                return (
                  <button
                    key={r}
                    className="pick"
                    aria-pressed={bg === r}
                    disabled={hand[r] < rr}
                    onClick={() => setBg(r)}
                    style={{ ['--c' as string]: TILE_COLOR[r] }}
                  >
                    <Icon r={r} />
                    {RES_LABEL[r]}
                    <small>
                      {rr}:1 · have {hand[r]}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="group">
            <span className="eyebrow">You get</span>
            <div className="pickgrid">
              {RES.map((r) => (
                <button
                  key={r}
                  className="pick"
                  aria-pressed={bw === r}
                  disabled={r === bg || v.bank[r] < 1}
                  onClick={() => setBw(r)}
                  style={{ ['--c' as string]: TILE_COLOR[r] }}
                >
                  <Icon r={r} />
                  {RES_LABEL[r]}
                  <small>bank {v.bank[r]}</small>
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
  onClose,
}: {
  v: PlayerView;
  hex: number;
  victims: Seat[];
  kind?: 'robber' | 'pirate';
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
              void client.act({ type: kind, hex, victim: p });
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
}: {
  v: PlayerView | null;
  code: string;
  onClose: () => void;
  onEndGame: () => void;
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
            <div>
              Development card <Chips c={{ sheep: 1, wheat: 1, ore: 1 }} />
            </div>
          </div>
        </div>
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

/** When an edge could take a road or a ship, ask which. */
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
