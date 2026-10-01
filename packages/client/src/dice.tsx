/*
 * The dice beside the Roll button (SPEC 5.3). Each die shows its own face. On your roll the dice
 * are a button that works exactly like "Roll dice". Every roll tumbles for about half a second on
 * every screen, then lands on the server's numbers; for the roller the tumble starts on the click.
 * The animation is only for show: the faces it ends on are always the ones the server rolled.
 */

import { useEffect, useRef, useState } from 'react';
import { dieSVG } from './art';
import { client } from './net';
import { play } from './sound';

export const TUMBLE_MS = 500;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const face = () => 1 + Math.floor(Math.random() * 6);

export function RollDice({
  dice,
  canRoll,
  onRoll,
  sound,
  rollRef,
}: {
  dice: [number, number] | null;
  canRoll: boolean;
  onRoll: () => Promise<{ ok: boolean }> | void;
  /** Game sounds on (the dice sound plays for everyone, SPEC 5.9). */
  sound: boolean;
  /** Lets the Roll dice button roll exactly like a click on the dice. */
  rollRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [tumble, setTumble] = useState<[number, number] | null>(null);
  const [fade, setFade] = useState(false);
  const started = useRef(0);
  const mine = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setTumble(null);
  };
  const start = () => {
    started.current = Date.now();
    if (reduced()) return;
    if (timer.current) return;
    setTumble([face(), face()]);
    timer.current = setInterval(() => setTumble([face(), face()]), 70);
  };

  useEffect(
    () =>
      client.onFresh(({ items }) => {
        if (!items.some((it) => it.k === 'ev' && it.e.k === 'roll')) return;
        if (!mine.current) {
          if (soundRef.current) play('dice');
          start();
        }
        mine.current = false;
        // Land on the real numbers once the tumble has run its half second.
        const left = Math.max(0, started.current + TUMBLE_MS - Date.now());
        setTimeout(() => {
          stop();
          if (reduced()) {
            setFade(true);
            setTimeout(() => setFade(false), 250);
          }
        }, left);
      }),
    [],
  );
  useEffect(() => () => stop(), []);

  const roll = () => {
    if (!canRoll) return;
    mine.current = true;
    if (sound) play('dice');
    start();
    // If the server refuses the roll, stop tumbling; the dice never show a made-up result.
    void Promise.resolve(onRoll()).then((r) => {
      if (r && !r.ok) {
        mine.current = false;
        stop();
      }
    });
  };
  if (rollRef) rollRef.current = roll;
  const shown = tumble ?? dice;
  return (
    <div
      className={`dice rolldice${canRoll ? ' canroll' : ''}${tumble ? ' tumbling' : ''}${fade ? ' fade' : ''}`}
      data-testid="dice"
      data-state={tumble ? 'tumbling' : 'still'}
      data-faces={dice ? dice.join(',') : ''}
      {...(canRoll
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': 'Roll dice',
            'data-roll': 'dice',
            onClick: roll,
            onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && roll(),
          }
        : { title: dice ? `Last roll: ${dice[0]} and ${dice[1]} (${dice[0] + dice[1]})` : '' })}
    >
      {shown ? (
        <span
          dangerouslySetInnerHTML={{ __html: dieSVG(shown[0]) + dieSVG(shown[1]) }}
          style={{ display: 'flex', gap: 6 }}
        />
      ) : (
        <span
          dangerouslySetInnerHTML={{ __html: dieSVG(1) + dieSVG(1) }}
          style={{ display: 'flex', gap: 6, opacity: 0.35 }}
        />
      )}
      {!tumble && dice ? <span className="sum">{dice[0] + dice[1]}</span> : null}
    </div>
  );
}
