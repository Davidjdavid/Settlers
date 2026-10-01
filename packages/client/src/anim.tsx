/*
 * Simple animations driven by fresh events from the server:
 * - Dice flicker through random faces, then stop on the roll.
 * - Small cards fly from where they come from (a hex, a player, the bank) to who gets them.
 * Animations never block input or delay state; they're decoration over the real view.
 * Nothing animates on a full sync (joining, reconnecting).
 */

import { useEffect, useRef, useState } from 'react';
import {
  RES,
  geometryFor,
  type GameEvent,
  type PartialRes,
  type PlayerView,
  type Resource,
  type Seat,
} from '@settlers/engine';
import { TILE_COLOR, dieSVG, iconSVG } from './art';
import { hexScreenPoint } from './Board';
import { client } from './net';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Dice({ dice }: { dice: [number, number] | null }) {
  const [flicker, setFlicker] = useState<[number, number] | null>(null);
  useEffect(
    () =>
      client.onFresh(({ items }) => {
        if (!items.some((it) => it.k === 'ev' && it.e.k === 'roll') || reduced() || document.hidden) return;
        const roll = () =>
          [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] as [number, number];
        setFlicker(roll());
        const t = setInterval(() => setFlicker(roll()), 70);
        setTimeout(() => {
          clearInterval(t);
          setFlicker(null);
        }, 750);
      }),
    [],
  );
  const shown = flicker ?? dice;
  if (!shown) return <div className="dice" />;
  return (
    <div
      className={`dice${flicker ? ' flicker' : ''}`}
      title={dice ? `Last roll: ${dice[0] + dice[1]}` : ''}
      data-testid="dice"
    >
      <span
        dangerouslySetInnerHTML={{ __html: dieSVG(shown[0]) + dieSVG(shown[1]) }}
        style={{ display: 'flex', gap: 6 }}
      />
      {!flicker && dice ? <span className="sum">{dice[0] + dice[1]}</span> : null}
    </div>
  );
}

type Spot = { x: number; y: number };
type Card = { kind: Resource | 'back' | 'dev' };

function center(el: Element | null): Spot | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const playerSpot = (p: Seat) => center(document.querySelector(`[data-seat="${p}"]`));
const bankSpot = () => center(document.querySelector('[data-bank]'));

/** Expand counts into individual cards, capped so big trades don't flood the screen. */
function cardsOf(c: PartialRes | null | undefined, cap = 8): Card[] {
  const out: Card[] = [];
  for (const r of RES) for (let i = 0; i < (c?.[r] ?? 0) && out.length < cap; i++) out.push({ kind: r });
  return out;
}

export function Flights() {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      client.onFresh(({ items, after }) => {
        if (!after || reduced() || document.hidden || !layer.current) return;
        // Wait a frame so the board and panels have rendered the new state.
        requestAnimationFrame(() => {
          let delay = 0;
          for (const it of items) {
            if (it.k !== 'ev') continue;
            for (const f of flightsFor(it.e, after)) {
              if (!f.from || !f.to) continue;
              fly(layer.current!, f.from, f.to, f.card, delay);
              delay += 90;
            }
          }
        });
      }),
    [],
  );
  return <div className="flights" ref={layer} aria-hidden="true" />;
}

function fly(root: HTMLElement, from: Spot, to: Spot, card: Card, delay: number) {
  const el = document.createElement('div');
  el.className = `flycard${card.kind === 'back' ? ' back' : card.kind === 'dev' ? ' dev back' : ''}`;
  if (card.kind !== 'back' && card.kind !== 'dev') {
    el.style.setProperty('--c', TILE_COLOR[card.kind]);
    el.innerHTML = iconSVG(card.kind);
  }
  el.dataset.flight = card.kind;
  root.appendChild(el);
  const at = (p: Spot, s: number) => `translate(${p.x - 13}px, ${p.y - 18}px) scale(${s})`;
  const anim = el.animate(
    [
      { transform: at(from, 0.4), opacity: 0 },
      { transform: at(from, 1.1), opacity: 1, offset: 0.25 },
      { transform: at(to, 0.8), opacity: 0.95, offset: 0.9 },
      { transform: at(to, 0.6), opacity: 0 },
    ],
    { duration: 950, delay, easing: 'ease-in-out', fill: 'both' },
  );
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();
}

interface Flight {
  from: Spot | null;
  to: Spot | null;
  card: Card;
}

function flightsFor(e: GameEvent, v: PlayerView): Flight[] {
  const out: Flight[] = [];
  const move = (cards: Card[], from: Spot | null, to: Spot | null) => {
    for (const card of cards) out.push({ from, to, card });
  };
  switch (e.k) {
    case 'produce': {
      // Cards appear over each producing hex and go to the owners of adjacent buildings.
      const sum = v.dice ? v.dice[0] + v.dice[1] : 0;
      const g = geometryFor(v.board.hexes);
      v.board.hexes.forEach((hx, i) => {
        if (hx.n !== sum || i === v.board.robber || hx.t === 'desert') return;
        for (const vert of g.hexVerts[i]!) {
          const b = v.verts[vert];
          if (!b || !(e.gains[b[0]]?.[hx.t] ?? 0)) continue;
          move(Array(b[1]).fill({ kind: hx.t }), hexScreenPoint(i), playerSpot(b[0]));
        }
      });
      break;
    }
    case 'setup': {
      if (!e.got) break;
      const g = geometryFor(v.board.hexes);
      for (const h of g.verts[e.v]!.hexes) {
        const t = v.board.hexes[h]!.t;
        if (t !== 'desert') move([{ kind: t }], hexScreenPoint(h), playerSpot(e.p));
      }
      break;
    }
    case 'discard':
      move(cardsOf(e.c), playerSpot(e.p), bankSpot());
      break;
    case 'steal':
      move([{ kind: e.r ?? 'back' }], playerSpot(e.from), playerSpot(e.p));
      break;
    case 'bank':
      move(cardsOf({ [e.give]: e.n }), playerSpot(e.p), bankSpot());
      move([{ kind: e.get }], bankSpot(), playerSpot(e.p));
      break;
    case 'trade':
      move(cardsOf(e.give), playerSpot(e.a), playerSpot(e.b));
      move(cardsOf(e.want), playerSpot(e.b), playerSpot(e.a));
      break;
    case 'mono':
      for (const [p, n] of Object.entries(e.from))
        move(cardsOf({ [e.r]: n }), playerSpot(Number(p)), playerSpot(e.p));
      break;
    case 'plenty':
      move(cardsOf(e.got), bankSpot(), playerSpot(e.p));
      break;
    case 'buyDev':
      move([{ kind: 'dev' }], bankSpot(), playerSpot(e.p));
      break;
  }
  return out;
}
