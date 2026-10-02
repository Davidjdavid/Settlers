/*
 * The game screen with your own layout (SPEC 11). The board (with the prompt under it) sits in
 * the middle; boxes dock along its four edges in order, float over it, or hide behind a tab you
 * tap to peek. "Edit layout" adds a bar to each box: dock it to an edge, move it along, float it
 * (drag it by its bar, widen it by its corner), or hide it; presets and Done along the top.
 *
 * Nothing you must act on lives in a box: the prompt is under the board, and sheets that need an
 * answer open over everything, so no layout can hide them.
 */

import { useRef, useState, type ReactNode } from 'react';
import {
  DOCKS, PANEL_LABEL, PANELS, PRESETS, PRESET_LABEL, dockAt, floatAt, inDock, preset, setHidden, shift,
  type Device, type Dock, type Layout, type PanelId, type Resolved,
} from './layout'; // prettier-ignore

const ARROW: Record<(typeof DOCKS)[number], string> = { left: '◀', right: '▶', top: '▲', bottom: '▼' };

export function LayoutView({
  r,
  device,
  editing,
  main,
  panels,
  onChange,
  onDone,
}: {
  r: Resolved;
  device: Device;
  editing: boolean;
  main: ReactNode;
  /** The boxes; null when a box doesn't apply to this game (the barbarians outside Knights). */
  panels: Record<PanelId, ReactNode>;
  onChange: (l: Layout | null) => void;
  onDone: () => void;
}) {
  const center = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<PanelId | null>(null);
  // A float being dragged or widened: where it started and where the pointer started.
  const drag = useRef<{ id: PanelId; mode: 'move' | 'size'; x0: number; y0: number; px: number; py: number; w: number } | null>(null); // prettier-ignore
  const [live, setLive] = useState<{ id: PanelId; x: number; y: number; w: number } | null>(null);
  const phone = device === 'phone';
  const has = (id: PanelId) => panels[id] != null;
  const hidden = PANELS.filter((id) => has(id) && r[id].hidden);
  const absent = PANELS.filter((id) => !has(id));

  const frame = (id: PanelId) => {
    if (!has(id)) return null;
    const p = r[id];
    const float = p.dock === 'float';
    const pos = live?.id === id ? live : p;
    const style = float ? { left: `${(pos.x ?? 0) * 100}%`, top: `${(pos.y ?? 0) * 100}%`, width: `${(pos.w ?? 0.3) * 100}%` } : undefined; // prettier-ignore
    const start = (mode: 'move' | 'size') => (e: React.PointerEvent) => {
      if (!editing || !float || (e.target as Element).closest('button')) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drag.current = { id, mode, x0: p.x ?? 0, y0: p.y ?? 0, px: e.clientX, py: e.clientY, w: p.w ?? 0.3 };
    };
    const moveTo = (e: React.PointerEvent) => {
      const d = drag.current;
      const box = center.current?.getBoundingClientRect();
      if (!d || d.id !== id || !box) return;
      const dx = (e.clientX - d.px) / box.width;
      const dy = (e.clientY - d.py) / box.height;
      setLive(
        d.mode === 'move'
          ? {
              id,
              x: Math.min(1 - d.w, Math.max(0, d.x0 + dx)),
              y: Math.min(0.9, Math.max(0, d.y0 + dy)),
              w: d.w,
            }
          : { id, x: d.x0, y: d.y0, w: Math.min(0.6, Math.max(0.18, d.w + dx)) },
      );
    };
    const end = () => {
      const d = drag.current;
      drag.current = null;
      if (d && live?.id === id) onChange(floatAt(r, id, live.x, live.y, live.w));
      setLive(null);
    };
    return (
      <div
        key={id}
        className={`lyp${float ? ' lyfloat' : ''}`}
        data-panel={id}
        data-dock={p.dock}
        style={style}
        onPointerMove={moveTo}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {editing ? (
          <div className="lybar" onPointerDown={start('move')} data-testid={`ly-bar-${id}`}>
            <b>{PANEL_LABEL[id]}</b>
            <span className="lybtns">
              {phone
                ? null
                : DOCKS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`lybtn${p.dock === d ? ' on' : ''}`}
                      title={`Dock ${d === 'top' || d === 'bottom' ? `along the ${d}` : `on the ${d}`}`}
                      aria-label={`${PANEL_LABEL[id]}: dock ${d}`}
                      data-testid={`ly-${id}-${d}`}
                      onClick={() => onChange(dockAt(r, id, d))}
                    >
                      {ARROW[d]}
                    </button>
                  ))}
              {float ? null : (
                <>
                  <button
                    type="button"
                    className="lybtn"
                    aria-label={`${PANEL_LABEL[id]}: earlier`}
                    data-testid={`ly-${id}-earlier`}
                    onClick={() => onChange(shift(r, id, -1, absent))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="lybtn"
                    aria-label={`${PANEL_LABEL[id]}: later`}
                    data-testid={`ly-${id}-later`}
                    onClick={() => onChange(shift(r, id, 1, absent))}
                  >
                    ↓
                  </button>
                </>
              )}
              {phone || float ? null : (
                <button
                  type="button"
                  className="lybtn"
                  data-testid={`ly-${id}-float`}
                  onClick={() => onChange(floatAt(r, id, 0.05, 0.05))}
                >
                  Float
                </button>
              )}
              <button
                type="button"
                className="lybtn"
                data-testid={`ly-${id}-hide`}
                onClick={() => onChange(setHidden(r, id, true))}
              >
                Hide
              </button>
            </span>
          </div>
        ) : null}
        {panels[id]}
        {editing && float ? (
          <span
            className="lysize"
            onPointerDown={start('size')}
            data-testid={`ly-size-${id}`}
            aria-hidden="true"
          />
        ) : null}
      </div>
    );
  };

  const edge = (d: Dock) => {
    const ids = inDock(r, d).filter((id) => has(id) && !r[id].hidden);
    return (
      <div className={`lycol ly-${d}`} data-edge={d}>
        {ids.map(frame)}
      </div>
    );
  };

  return (
    <div className={`ly${phone ? ' phone' : ''}`} data-testid="layout">
      {editing ? (
        <div className="lyedit" data-testid="layout-edit">
          <b>Edit layout</b>
          <span className="hint">
            {phone
              ? 'Move boxes up or down, or hide them.'
              : 'Dock boxes to an edge, float them over the board (drag by the bar), or hide them.'}
          </span>
          <span className="lybtns">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="btn small"
                data-testid={`ly-preset-${p}`}
                onClick={() => onChange(preset(p, device))}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
            <button type="button" className="btn small primary" data-testid="ly-done" onClick={onDone}>
              Done
            </button>
          </span>
        </div>
      ) : null}
      {edge('top')}
      {edge('left')}
      <div className="ly-center" ref={center}>
        {hidden.length ? (
          <div className="lytabs" data-testid="layout-tabs">
            {hidden.map((id) => (
              <button
                key={id}
                type="button"
                className={`lytab${peek === id ? ' on' : ''}`}
                data-testid={`ly-tab-${id}`}
                onClick={() => setPeek(peek === id ? null : id)}
              >
                {PANEL_LABEL[id]}
              </button>
            ))}
            {editing
              ? hidden.map((id) => (
                  <button
                    key={`s${id}`}
                    type="button"
                    className="lytab show"
                    data-testid={`ly-show-${id}`}
                    onClick={() => onChange(setHidden(r, id, false))}
                  >
                    Show {PANEL_LABEL[id].toLowerCase()}
                  </button>
                ))
              : null}
          </div>
        ) : null}
        {main}
        {PANELS.filter((id) => r[id].dock === 'float' && !r[id].hidden).map(frame)}
        {peek && hidden.includes(peek) ? (
          <div className="lyp lyfloat lypeek" data-panel={peek} data-testid="layout-peek">
            <div className="lybar">
              <b>{PANEL_LABEL[peek]}</b>
              <button type="button" className="lybtn" aria-label="Close" onClick={() => setPeek(null)}>
                ✕
              </button>
            </div>
            {panels[peek]}
          </div>
        ) : null}
      </div>
      {edge('right')}
      {edge('bottom')}
    </div>
  );
}
