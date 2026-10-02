/*
 * The dice beside the Roll button (SPEC 5.3). Each die shows its own face. On your roll the dice
 * are a button that works exactly like "Roll dice". Every roll tumbles for about half a second on
 * every screen, then lands on the server's numbers; for the roller the tumble starts on the click.
 * The animation is only for show: the faces it ends on are always the ones the server rolled.
 * The first die is yellow and the second red, as in the box (Knights: red decides progress cards).
 */

import { useEffect, useRef, useState } from 'react';
import { dieSVG, eventDieSVG } from './art';
import type { Track } from '@settlers/engine';
import { client } from './net';
import { hear } from './sound';

export const TUMBLE_MS = 500;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const face = () => 1 + Math.floor(Math.random() * 6);
/** The event die's sides: three barbarian ships and a gate of each colour. */
const EVENT_FACES = ['ship', 'ship', 'ship', 'science', 'trade', 'politics'] as const;
const eventFace = () => EVENT_FACES[Math.floor(Math.random() * 6)]!;
type EventFace = 'ship' | Track;

export function RollDice({
  dice,
  event,
  canRoll,
  onRoll,
  sound,
  rollRef,
  corner,
}: {
  dice: [number, number] | null;
  /** Knights games: the event die's last face (null before the first roll); undefined otherwise. */
  event?: EventFace | null;
  /** The copy in the board's corner (SPEC 9.1): just for looking at. */
  corner?: boolean;
  canRoll: boolean;
  onRoll: () => Promise<{ ok: boolean }> | void;
  /** Game sounds on (the dice sound plays for everyone, SPEC 5.9). */
  sound: boolean;
  /** Lets the Roll dice button roll exactly like a click on the dice. */
  rollRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [tumble, setTumble] = useState<[number, number] | null>(null);
  const [tumbleEvent, setTumbleEvent] = useState<EventFace | null>(null);
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
    setTumbleEvent(null);
  };
  const start = () => {
    started.current = Date.now();
    if (reduced()) return;
    if (timer.current) return;
    setTumble([face(), face()]);
    setTumbleEvent(eventFace());
    timer.current = setInterval(() => {
      setTumble([face(), face()]);
      setTumbleEvent(eventFace());
    }, 70);
  };

  useEffect(
    () =>
      client.onFresh(({ items }) => {
        if (!items.some((it) => it.k === 'ev' && it.e.k === 'roll')) return;
        if (!mine.current) {
          if (soundRef.current && !corner) hear('dice', client.state.room?.mySettings);
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
    if (sound) hear('dice', client.state.room?.mySettings);
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
      className={`dice rolldice${canRoll ? ' canroll' : ''}${tumble ? ' tumbling' : ''}${fade ? ' fade' : ''}${corner ? ' cornerdice' : ''}`}
      data-testid={corner ? 'corner-dice' : 'dice'}
      data-state={tumble ? 'tumbling' : 'still'}
      data-faces={dice ? dice.join(',') : ''}
      data-event={event ?? undefined}
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
      {/* Both number dice, then the event die in Knights games (SPEC 9.1). */}
      <span
        dangerouslySetInnerHTML={{
          __html:
            dieSVG(shown ? shown[0] : 1, 'yellow') +
            dieSVG(shown ? shown[1] : 1, 'red') +
            (event !== undefined ? eventDieSVG(tumble ? tumbleEvent : event) : ''),
        }}
        style={{ display: 'flex', gap: 6, opacity: shown ? 1 : 0.35 }}
      />
      {!tumble && dice ? <span className="sum">{dice[0] + dice[1]}</span> : null}
    </div>
  );
}
