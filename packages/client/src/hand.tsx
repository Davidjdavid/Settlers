/*
 * The cards in your hand, in the spots you've arranged them in (SPEC 13.2). Drag a card onto
 * another spot to swap them, or tap one card and then another spot. Saved on your profile, one
 * arrangement per kind of game; only your screen changes.
 */

import { useEffect, useRef, useState } from 'react';
import { COMS, type Card } from '@settlers/engine';
import { CARD_COLOR, CARD_LABEL, cardIcon } from './art';
import { DEFAULT_SLOTS, isDefault, slotsFor, swapSlots, type HandKind, type Slots } from './handorder';
import { client, useClient } from './net';

/** How far a press must move before it's a drag rather than a tap. */
const DRAG_PX = 6;

export function HandCards({ res, ck }: { res: Partial<Record<Card, number>>; ck: boolean }) {
  const kind: HandKind = ck ? 'ck' : 'base';
  const saved = useClient().room?.mySettings?.handOrder?.[kind];
  const fromProfile = slotsFor(saved, kind);
  // A move shows at once; the profile catches up when the server answers.
  const [local, setLocal] = useState<Slots | null>(null);
  const savedKey = JSON.stringify(saved ?? null);
  useEffect(() => setLocal(null), [savedKey]);
  const slots = local ?? fromProfile;
  const [picked, setPickedState] = useState<number | null>(null);
  // The latest of both for the pointer handlers, which outlive a render.
  const pickedRef = useRef<number | null>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const setPicked = (n: number | null) => {
    pickedRef.current = n;
    setPickedState(n);
  };
  const [drag, setDrag] = useState<{ from: number; dx: number; dy: number } | null>(null);
  const press = useRef<{ i: number; x: number; y: number; dragging: boolean } | null>(null);

  const save = (next: Slots) => {
    setLocal(next);
    const mine = client.state.room?.mySettings ?? {};
    client.saveSettings({ ...mine, handOrder: { ...mine.handOrder, [kind]: next } });
  };
  const move = (a: number, b: number) => {
    setPicked(null);
    if (a !== b) save(swapSlots(slotsRef.current, a, b));
  };

  // While pressed, follow the pointer anywhere on the page.
  const onDown = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || slotsRef.current[i] == null) return;
    press.current = { i, x: e.clientX, y: e.clientY, dragging: false };
    const moveFn = (ev: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      const dx = ev.clientX - p.x;
      const dy = ev.clientY - p.y;
      if (!p.dragging && Math.hypot(dx, dy) < DRAG_PX) return;
      p.dragging = true;
      setDrag({ from: p.i, dx, dy });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', moveFn);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const p = press.current;
      press.current = null;
      setDrag(null);
      if (!p) return;
      if (p.dragging) {
        const at = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-slot]');
        if (at) move(p.i, Number(at.dataset.slot));
        return;
      }
      // A tap: pick this card, or put the picked one here.
      const was = pickedRef.current;
      if (was == null) setPicked(p.i);
      else move(was, p.i);
    };
    const cancel = () => {
      window.removeEventListener('pointermove', moveFn);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      press.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', moveFn);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  return (
    <>
      <div
        className={`hand slots${ck ? ' two' : ''}${drag || picked != null ? ' arranging' : ''}`}
        data-testid="hand"
      >
        {slots.map((r, i) =>
          r == null ? (
            <div
              key={`empty${i}`}
              className="hslot empty"
              data-slot={i}
              data-testid={`hand-slot-${i}`}
              onClick={() => picked != null && move(picked, i)}
            />
          ) : (
            <div key={r} className="hslot" data-slot={i} data-testid={`hand-slot-${i}`}>
              <div
                className={`rcard${res[r] ? '' : ' zero'}${(COMS as readonly string[]).includes(r) ? ' com' : ''}${picked === i ? ' picked' : ''}${drag?.from === i ? ' dragging' : ''}`}
                style={{
                  ['--c' as string]: CARD_COLOR[r],
                  ...(drag?.from === i ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}),
                }}
                title={CARD_LABEL[r]}
                data-res={r}
                data-n={res[r] ?? 0}
                onPointerDown={onDown(i)}
              >
                <span dangerouslySetInnerHTML={{ __html: cardIcon(r) }} style={{ display: 'contents' }} />
                <span className="n">{res[r] ?? 0}</span>
              </div>
            </div>
          ),
        )}
      </div>
      {picked != null ? (
        <p className="handhint" data-testid="hand-hint">
          Tap another spot to swap your {CARD_LABEL[slots[picked]!]}, or tap it again to leave it.
        </p>
      ) : !isDefault(slots, kind) ? (
        <button
          type="button"
          className="handreset"
          data-testid="hand-reset"
          onClick={() => save(DEFAULT_SLOTS[kind].slice())}
        >
          Reset card order
        </button>
      ) : null}
    </>
  );
}
