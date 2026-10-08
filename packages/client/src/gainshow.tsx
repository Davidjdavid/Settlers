/*
 * The cards you just got (10 October): a bank deck appears over the board, your cards are dealt
 * out of it one at a time, big and face up, over "You got 2 Wheat and 1 Ore"; then each flies
 * into its own spot in your hand, which bumps as the card lands. Clicks go through it. With
 * reduced motion the cards just show for a moment, then fade.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COMS, RES, type Card, type Cards } from '@settlers/engine';
import { CARD_COLOR, CARD_LABEL, cardIcon } from './art';

/** Cards shown one by one; past this the rest are counted. */
const SHOWN = 8;
/** When the first card leaves the deck, the gap between cards, and how long each takes (ms). */
const DEAL_AT = 250;
const DEAL_GAP = 150;
const DEAL_TIME = 450;
/** How long they stay up once all are out, and how long the flight to your hand takes. */
const HOLD = 1100;
const FLY_GAP = 70;
const FLY_TIME = 620;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** "2 Wheat and 1 Ore". */
export function gainWords(cards: Cards): string {
  const parts = [...RES, ...COMS]
    .filter((r) => (cards[r] ?? 0) > 0)
    .map((r) => `${cards[r]} ${CARD_LABEL[r]}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** One card per card got, in the hand's order. */
function dealt(cards: Cards): Card[] {
  return [...RES, ...COMS].flatMap((r) => new Array<Card>(cards[r] ?? 0).fill(r));
}

/** The hand on screen, if it's showing. */
function handSpot(r: Card): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-testid=hand] .rcard[data-res="${r}"]`)) {
    const b = el.getBoundingClientRect();
    if (b.width && b.height) return el;
  }
  return null;
}

export function GainShow({
  gains,
  color,
  onDone,
}: {
  gains: { n: number; cards: Cards } | null;
  /** Your colour, around the words. */
  color?: string | undefined;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [calm] = useState(reduced);
  const cards = gains ? dealt(gains.cards) : [];
  const shown = cards.slice(0, SHOWN);
  useEffect(() => {
    if (!gains) return;
    setLeaving(false);
    const out = DEAL_AT + (shown.length - 1) * DEAL_GAP + DEAL_TIME + HOLD;
    const timers: number[] = [];
    // Then into your hand, each card to its own spot.
    timers.push(
      window.setTimeout(() => {
        setLeaving(true);
        if (calm) return;
        root.current?.querySelectorAll<HTMLElement>('.gs-card').forEach((el, i) => {
          const to = handSpot(el.dataset.res as Card);
          // No hand on screen (a watcher, a folded box): the card just fades.
          if (!to)
            return void el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
          const a = el.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          const dx = b.left + b.width / 2 - (a.left + a.width / 2);
          const dy = b.top + b.height / 2 - (a.top + a.height / 2);
          const delay = i * FLY_GAP;
          el.animate(
            [
              { transform: 'translate(0, 0) scale(1)', opacity: 1 },
              {
                transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})`,
                opacity: 1,
                offset: 0.92,
              },
              { transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})`, opacity: 0 },
            ],
            { duration: FLY_TIME, delay, easing: 'cubic-bezier(0.55, 0, 0.7, 0.4)', fill: 'forwards' },
          );
          to.animate(
            [
              { transform: 'scale(1)', filter: 'brightness(1)' },
              { transform: 'scale(1.22)', filter: 'brightness(1.25)' },
              { transform: 'scale(1)', filter: 'brightness(1)' },
            ],
            { duration: 360, delay: delay + FLY_TIME * 0.9, easing: 'ease-out' },
          );
        });
      }, out),
    );
    timers.push(window.setTimeout(onDone, out + (calm ? 400 : (shown.length - 1) * FLY_GAP + FLY_TIME + 80)));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [gains?.n]);
  if (!gains || !cards.length) return null;
  return (
    <div
      className={`gainshow${leaving ? ' leaving' : ''}${calm ? ' calm' : ''}`}
      ref={root}
      data-testid="gain-show"
      aria-live="polite"
      key={gains.n}
      style={color ? ({ '--gs-ring': color } as CSSProperties) : undefined}
    >
      <div className="gs-row">
        <div className="gs-bank" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>Bank</span>
        </div>
        {shown.map((r, i) => (
          <div
            key={i}
            className="gs-card"
            data-res={r}
            data-testid="gain-card"
            style={
              {
                '--c': CARD_COLOR[r],
                '--i': i,
                // Out of the deck, which is first in the row.
                '--dx': `calc(${-(i + 1)} * (var(--gs-w) + var(--gs-gap)))`,
              } as CSSProperties
            }
          >
            <span className="gs-face gs-front">
              <span className="gs-icon" dangerouslySetInnerHTML={{ __html: cardIcon(r) }} />
              <span className="gs-name">{CARD_LABEL[r]}</span>
            </span>
            <span className="gs-face gs-back" />
          </div>
        ))}
      </div>
      <div className="gs-text" data-testid="gain-text">
        You got <b>{gainWords(gains.cards)}</b>
        {cards.length > shown.length ? <small> ({cards.length} cards)</small> : null}
      </div>
    </div>
  );
}
