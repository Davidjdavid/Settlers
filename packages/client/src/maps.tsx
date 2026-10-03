/*
 * Maps (docs/maps.md 4): the map list and the editor. MapBoard, the warnings and the fairness
 * summary are shared with the pre-game table.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CLASSIC_MAP,
  EditHistory,
  MAX_HEXES,
  OUR_RULES,
  RULE_INFO,
  SIDE_DIR,
  checkBoard,
  coastalSides,
  cornerKeys,
  counts,
  cornerPips,
  emptyMap,
  fairnessSummary,
  fillRest,
  geometryFor,
  hexAt,
  normalize,
  producing,
  COPYABLE_MAPS,
  SCENARIOS,
  standardBlank,
  edgeOfSide,
  type At,
  type EditOp,
  type GenRules,
  type MapData,
  type PortType,
  type Terrain,
  type Violation,
} from '@settlers/engine';
import type { MapInfo } from '@settlers/server/protocol';
import { GLYPH, K, RES_LABEL, TILE_COLOR, f1, hexPts } from './art';
import {
  DECOR,
  harborMarkSVG,
  landArtSVG,
  harborPiersSVG,
  harborPoint,
  seaSVG,
  tokenSVG,
  treasureSVG,
} from './Board';
import { Brand, MapPreview } from './home';
import { client, useClient } from './net';
import { ConfirmTwice, Sheet } from './Sheets';
import { THEMES, useStyle } from './themes';

export type Tool =
  | { k: 'terrain'; t: Terrain | 'random' }
  | { k: 'number'; n: number | 'random' }
  | { k: 'harbor'; t: PortType | 'random' | null }
  | { k: 'move' }
  | { k: 'lock' }
  | { k: 'shape'; add: 'random' | 'sea' }
  /** Seafarers (SPEC 10.1): paint the start area, or place the pirate's start. */
  | { k: 'start' }
  | { k: 'pirate' }
  /** Regions (SPEC 10.4): paint hexes into a region, or out of every region (null). */
  | { k: 'region'; region: string | null }
  /** Treasures (SPEC 10.3): click a path to put a treasure on it, a treasure to take it off. */
  | { k: 'treasure' };

export const TERRAIN_NAME: Record<Terrain | 'random', string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
  desert: 'Desert',
  gold: 'Gold',
  sea: 'Sea',
  fog: 'Fog',
  random: 'Blank',
};
const HARBOR_NAME = (t: PortType | 'random') =>
  t === 'any' ? '3:1' : t === 'random' ? 'Blank' : `2:1 ${RES_LABEL[t]}`;
const NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const BLANK_FILL = '#3a4a52';

type Target =
  | { k: 'hex'; at: At }
  | { k: 'token'; at: At }
  | { k: 'harbor'; at: At; side: number }
  | { k: 'side'; at: At; side: number }
  | { k: 'path'; at: At; side: number }
  | { k: 'treasure'; at: At; side: number }
  | { k: 'ghost'; at: At };

function targetOf(el: Element | null): Target | null {
  const t = el?.closest('[data-kind]') as HTMLElement | SVGElement | null;
  if (!t) return null;
  const d = t.dataset;
  const at: At = [Number(d.q), Number(d.r)];
  switch (d.kind) {
    case 'hex':
    case 'token':
    case 'ghost':
      return { k: d.kind, at };
    case 'harbor':
    case 'side':
    case 'path':
    case 'treasure':
      return { k: d.kind, at, side: Number(d.side) };
  }
  return null;
}
const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);

const LOCK = (x: number, y: number) =>
  `<g transform="translate(${f1(x)} ${f1(y)})" class="lockmark"><rect x="-7" y="-2" width="14" height="11" rx="2" fill="#f4ecd6" stroke="#0a1b23" stroke-width="1.5"/><path d="M-4 -2v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#f4ecd6" stroke-width="2.5"/><path d="M-4 -2v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#0a1b23" stroke-width="1"/></g>`;

/** The heat map's colour: one hue, dim for few pips, bright for many (docs/maps.md 4.3). */
const heatFill = (p: number) => `hsl(42 ${f1(40 + p * 4)}% ${f1(18 + Math.min(p, 15) * 3.6)}%)`;

/**
 * A map drawn for editing or previewing. With a tool, clicks and drags turn into edits; without
 * one it's just a picture. `highlight` marks what a warning is about.
 */
export function MapBoard(props: {
  map: MapData;
  tool: Tool | null;
  onEdit?: (op: EditOp) => void;
  heat?: boolean;
  pips?: Record<number, number>;
  highlight?: Violation | null;
  className?: string;
  /** The art style to draw in (a personal setting); the editor stays Classic. */
  style?: string;
}) {
  const { map, tool, onEdit } = props;
  const style = useStyle(props.style);
  const th = THEMES[style];
  const g = useMemo(() => geometryFor(map.hexes.map((h) => ({ q: h.q, r: h.r }))), [map.hexes]);
  const ghosts = useMemo(() => {
    if (tool?.k !== 'shape') return [];
    if (!map.hexes.length) return [[0, 0] as At];
    const have = new Set(map.hexes.map((h) => `${h.q},${h.r}`));
    const out = new Map<string, At>();
    for (const h of map.hexes)
      for (const [dq, dr] of SIDE_DIR) {
        const at: At = [h.q + dq, h.r + dr];
        if (!have.has(at.join(','))) out.set(at.join(','), at);
      }
    return map.hexes.length >= MAX_HEXES ? [] : [...out.values()];
  }, [map.hexes, tool?.k]);
  const vb = useMemo(() => {
    const pts = [...map.hexes.map((h) => ({ q: h.q, r: h.r })), ...ghosts.map(([q, r]) => ({ q, r }))];
    if (!pts.length) pts.push({ q: 0, r: 0 });
    const xs = pts.map((p) => Math.sqrt(3) * (p.q + p.r / 2));
    const ys = pts.map((p) => 1.5 * p.r);
    const m = 1.9;
    const x0 = Math.min(...xs) - m;
    const y0 = Math.min(...ys) - m;
    return [x0 * K, y0 * K, (Math.max(...xs) + m - x0) * K, (Math.max(...ys) + m - y0) * K];
  }, [map.hexes, ghosts]);
  const [picked, setPicked] = useState<Target | null>(null);
  const down = useRef<Target | null>(null);
  useEffect(() => setPicked(null), [tool]);

  const hl = props.highlight;
  const hlHexes = new Set(hl?.hexes ?? []);
  const hlCorners = new Set(hl?.corners ?? []);
  const hlHarbors = new Set(hl?.harbors ?? []);

  /** A drag or two taps with the Move tool: swap tiles, numbers or harbors. */
  const move = (a: Target, b: Target) => {
    if (a.k === 'hex' && (b.k === 'hex' || b.k === 'token')) onEdit?.({ k: 'swapTile', a: a.at, b: b.at });
    else if (a.k === 'token' && (b.k === 'token' || b.k === 'hex'))
      onEdit?.({ k: 'swapNumber', a: a.at, b: b.at });
    else if (a.k === 'harbor' && (b.k === 'side' || b.k === 'harbor'))
      onEdit?.({ k: 'moveHarbor', from: { at: a.at, side: a.side }, to: { at: b.at, side: b.side } });
  };

  const click = (t: Target) => {
    if (!tool || !onEdit) return;
    switch (tool.k) {
      case 'terrain':
        if (t.k === 'hex' || t.k === 'token') onEdit({ k: 'terrain', at: t.at, t: tool.t });
        return;
      case 'number':
        if (t.k === 'hex' || t.k === 'token') onEdit({ k: 'number', at: t.at, n: tool.n });
        return;
      case 'harbor':
        if (t.k === 'side' || t.k === 'harbor') onEdit({ k: 'harbor', at: t.at, side: t.side, t: tool.t });
        return;
      case 'lock': {
        if (t.k === 'harbor') {
          const h = map.harbors.find((x) => x.q === t.at[0] && x.r === t.at[1] && x.side === t.side);
          onEdit({ k: 'lockHarbor', at: t.at, side: t.side, on: !h?.lock });
        } else if (t.k === 'hex' || t.k === 'token') {
          const h = map.hexes[hexAt(map.hexes, t.at[0], t.at[1])]!;
          const what = t.k === 'token' ? 'n' : 't';
          onEdit({ k: 'lock', at: t.at, what, on: !h.lock?.[what] });
        }
        return;
      }
      case 'shape':
        if (t.k === 'ghost') onEdit({ k: 'addHex', at: t.at, t: tool.add });
        else if (t.k === 'hex' || t.k === 'token') onEdit({ k: 'removeHex', at: t.at });
        return;
      case 'start':
        if (t.k === 'hex' || t.k === 'token') onEdit({ k: 'start', at: t.at, on: !inStart(t.at) });
        return;
      case 'pirate':
        if (t.k === 'hex' || t.k === 'token') onEdit({ k: 'pirate', at: t.at });
        return;
      case 'region':
        if (t.k === 'hex' || t.k === 'token') onEdit({ k: 'region', at: t.at, region: tool.region });
        return;
      case 'treasure':
        if (t.k === 'path' || t.k === 'treasure')
          onEdit({ k: 'treasure', at: t.at, side: t.side, on: t.k === 'path' });
        return;
    }
  };
  const start = Array.isArray(map.start) ? map.start : [];
  const inStart = (at: At) => start.some(([q, r]) => q === at[0] && r === at[1]);

  const onPointerDown = (e: React.PointerEvent) => {
    const t = targetOf(e.target as Element);
    if (!t) return;
    if (tool?.k === 'move') {
      e.preventDefault();
      if (picked) {
        if (!same(picked, t)) move(picked, t);
        setPicked(null);
        down.current = null;
        return;
      }
      down.current = t;
      return;
    }
    click(t);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const a = down.current;
    down.current = null;
    if (!a || tool?.k !== 'move') return;
    const b = targetOf(document.elementFromPoint(e.clientX, e.clientY));
    if (b && !same(a, b)) move(a, b);
    else setPicked(a);
  };

  const showSides = tool?.k === 'harbor' || (tool?.k === 'move' && picked?.k === 'harbor');
  // Free coastal sides where a harbor can go: none sharing a corner with another harbor (the
  // one being moved aside).
  const sides = useMemo(() => {
    if (!showSides) return [];
    const mine = picked?.k === 'harbor' ? picked : null;
    const used = new Set(
      map.harbors
        .filter((h) => !(mine && h.q === mine.at[0] && h.r === mine.at[1] && h.side === mine.side))
        .flatMap((h) => cornerKeys([h.q, h.r], h.side)),
    );
    return coastalSides(map).filter((s) => !cornerKeys(s.at, s.side).some((k) => used.has(k)));
  }, [map, showSides, picked]);
  // Every path (edge) once, named by the first hex that has it, with its middle: treasure targets.
  const paths = useMemo(() => {
    if (tool?.k !== 'treasure') return [];
    const taken = new Set(
      (map.treasures ?? []).flatMap((t) => {
        const h = hexAt(map.hexes, t.q, t.r);
        return h < 0 ? [] : [edgeOfSide(g, h, t.side)];
      }),
    );
    const out: { e: number; at: At; side: number; x: number; y: number }[] = [];
    const seen = new Set<number>();
    map.hexes.forEach((h, i) => {
      for (let side = 0; side < 6; side++) {
        const e = edgeOfSide(g, i, side);
        if (seen.has(e) || taken.has(e)) continue;
        seen.add(e);
        const E = g.edges[e]!;
        const a = g.verts[E.a]!;
        const b = g.verts[E.b]!;
        out.push({ e, at: [h.q, h.r], side, x: ((a.x + b.x) / 2) * K, y: ((a.y + b.y) / 2) * K });
      }
    });
    return out;
  }, [map, tool?.k, g]);
  const heat = props.heat ? cornerPips(map, props.pips) : null;
  const isPicked = (t: Target) => !!picked && same(picked, t);

  const statics = useMemo(() => seaSVG(vb), [vb, props.style]);
  return (
    <svg
      className={`mapboard${tool ? ` tool-${tool.k}` : ''} ${props.className ?? ''}`}
      viewBox={vb.join(' ')}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      data-testid="mapboard"
      data-style={style}
      role="img"
      aria-label={`Map: ${map.name}`}
    >
      <g dangerouslySetInnerHTML={{ __html: statics }} />
      {map.hexes.map((h, i) => {
        const p = g.hexes[i]!;
        const cx = p.x * K;
        const cy = p.y * K;
        const at: At = [h.q, h.r];
        if (h.t === 'sea')
          return (
            <g key={i} data-kind="hex" data-q={h.q} data-r={h.r} data-t="sea">
              {th.id === 'classic' ? null : <g dangerouslySetInnerHTML={{ __html: th.seaHex(cx, cy, i) }} />}
              <polygon
                points={hexPts(cx, cy, 0.97 * K)}
                fill={th.id === 'classic' ? 'rgba(255,255,255,.04)' : 'transparent'}
                stroke={hlHexes.has(i) ? '#ffd166' : th.id === 'classic' ? 'rgba(160,215,225,.3)' : 'none'}
                strokeWidth={hlHexes.has(i) ? 5 : 1.5}
              />
            </g>
          );
        const blank = h.t === 'random';
        return (
          <g
            key={i}
            data-kind="hex"
            data-q={h.q}
            data-r={h.r}
            data-t={h.t}
            className={isPicked({ k: 'hex', at }) ? 'picked' : undefined}
          >
            <polygon points={hexPts(cx, cy, 1.07 * K)} fill={th.beach[0]} />
            <polygon
              points={hexPts(cx, cy, 0.965 * K)}
              fill={blank ? BLANK_FILL : th.tile[h.t as Terrain]}
              stroke={
                hlHexes.has(i) ? '#ffd166' : blank ? 'rgba(230,240,245,.45)' : th.hexStroke(h.t as Terrain)
              }
              strokeWidth={hlHexes.has(i) ? 6 : blank ? 2 : th.hexStrokeW}
              strokeDasharray={blank ? '8 6' : undefined}
            />
            {blank ? (
              <text
                x={cx}
                y={cy - 0.42 * K}
                textAnchor="middle"
                dominantBaseline="central"
                className="blankmark"
              >
                ?
              </text>
            ) : th.id !== 'classic' ? (
              <g dangerouslySetInnerHTML={{ __html: landArtSVG(h.t as Terrain, cx, cy, i) }} />
            ) : (
              DECOR.map(([ang, rad], j) => {
                if ((i + j) % 6 === 2 || !GLYPH[h.t as keyof typeof GLYPH]) return null;
                const a = (Math.PI / 180) * ang;
                const s = (h.t === 'ore' ? 0.42 : 0.34) * K;
                return (
                  <use
                    key={j}
                    href={`#g-${h.t}`}
                    x={f1(cx + Math.cos(a) * rad * K - s / 2)}
                    y={f1(cy + Math.sin(a) * rad * K - s / 2)}
                    width={f1(s)}
                    height={f1(s)}
                    opacity={0.8}
                  />
                );
              })
            )}
            {h.lock?.t ? <g dangerouslySetInnerHTML={{ __html: LOCK(cx, cy - 0.68 * K) }} /> : null}
          </g>
        );
      })}
      {map.hexes.map((h, i) => {
        if (h.n === undefined || (h.t !== 'random' && !producing(h.t))) return null;
        const p = g.hexes[i]!;
        const at: At = [h.q, h.r];
        const cls = isPicked({ k: 'token', at }) ? 'picked' : undefined;
        if (h.n === 'random')
          return h.t === 'random' ? null : (
            <g key={`n${i}`} data-kind="token" data-q={h.q} data-r={h.r} className={cls}>
              <circle
                cx={p.x * K}
                cy={p.y * K}
                r={0.3 * K}
                fill="rgba(244,236,214,.35)"
                stroke="#f4ecd6"
                strokeDasharray="5 4"
                strokeWidth={2}
              />
              <text
                x={p.x * K}
                y={p.y * K}
                textAnchor="middle"
                dominantBaseline="central"
                className="blankmark small"
              >
                ?
              </text>
            </g>
          );
        return (
          <g key={`n${i}`} data-kind="token" data-q={h.q} data-r={h.r} data-n={h.n} className={cls}>
            <g dangerouslySetInnerHTML={{ __html: tokenSVG(g, i, h.n, false, false) }} />
            {h.lock?.n ? (
              <g dangerouslySetInnerHTML={{ __html: LOCK(p.x * K + 0.3 * K, p.y * K - 0.28 * K) }} />
            ) : null}
          </g>
        );
      })}
      {sides.map((s) => {
        if (map.harbors.some((h) => h.q === s.at[0] && h.r === s.at[1] && h.side === s.side)) return null;
        const land = hexAt(map.hexes, s.at[0], s.at[1]);
        const pt = harborPoint(g, edgeOfSide(g, land, s.side), land);
        return (
          <g
            key={`s${s.at.join(',')},${s.side}`}
            data-kind="side"
            data-q={s.at[0]}
            data-r={s.at[1]}
            data-side={s.side}
          >
            <circle cx={pt.x} cy={pt.y} r={0.2 * K} className="sidetarget" />
          </g>
        );
      })}
      {/* Treasures (SPEC 10.3): the spots, and with the tool every free path as a target. */}
      {tool?.k === 'treasure'
        ? paths.map((x) => (
            <g key={`p${x.e}`} data-kind="path" data-q={x.at[0]} data-r={x.at[1]} data-side={x.side}>
              <circle cx={x.x} cy={x.y} r={0.16 * K} className="sidetarget" />
            </g>
          ))
        : null}
      {(map.treasures ?? []).map((t) => {
        const h = hexAt(map.hexes, t.q, t.r);
        if (h < 0) return null;
        return (
          <g
            key={`t${t.q},${t.r},${t.side}`}
            data-kind="treasure"
            data-q={t.q}
            data-r={t.r}
            data-side={t.side}
            dangerouslySetInnerHTML={{ __html: treasureSVG(g, edgeOfSide(g, h, t.side)) }}
          />
        );
      })}
      {map.harbors.map((hb, i) => {
        const land = hexAt(map.hexes, hb.q, hb.r);
        if (land < 0) return null;
        const e = edgeOfSide(g, land, hb.side);
        const pt = harborPoint(g, e, land);
        const at: At = [hb.q, hb.r];
        const mark =
          hb.t === 'random'
            ? `<circle cx="${f1(pt.x)}" cy="${f1(pt.y)}" r="${0.3 * K}" fill="#f4ecd6" stroke="#0a1b23" stroke-width="2.5" stroke-dasharray="5 4"/><text x="${f1(pt.x)}" y="${f1(pt.y)}" text-anchor="middle" dominant-baseline="central" font-size="${0.26 * K}" fill="#1b2a30">?</text>`
            : harborMarkSVG(hb.t, pt);
        return (
          <g
            key={`h${i}`}
            data-kind="harbor"
            data-q={hb.q}
            data-r={hb.r}
            data-side={hb.side}
            data-t={hb.t}
            className={`harbor${isPicked({ k: 'harbor', at, side: hb.side }) ? ' picked' : ''}${hlHarbors.has(i) ? ' hl' : ''}`}
          >
            <g dangerouslySetInnerHTML={{ __html: harborPiersSVG(g, e, pt) + mark }} />
            {hb.lock ? (
              <g dangerouslySetInnerHTML={{ __html: LOCK(pt.x + 0.26 * K, pt.y - 0.26 * K) }} />
            ) : null}
          </g>
        );
      })}
      {/* Regions (SPEC 10.4): an outline in the region's colour and its letter. */}
      {map.regions
        ? map.hexes.map((h, i) => {
            if (!h.region || !map.regions![h.region]) return null;
            const k = Object.keys(map.regions!).indexOf(h.region);
            const p = g.hexes[i]!;
            return (
              <g key={`rg${i}`} className="regionmark" data-region={h.region} pointerEvents="none">
                <polygon
                  points={hexPts(p.x * K, p.y * K, 0.9 * K)}
                  stroke={REGION_COLORS[k % REGION_COLORS.length]}
                />
                <text
                  x={p.x * K + 0.5 * K}
                  y={p.y * K - 0.42 * K}
                  fill={REGION_COLORS[k % REGION_COLORS.length]}
                >
                  {String.fromCharCode(65 + k)}
                </text>
              </g>
            );
          })
        : null}
      {/* The start area and the pirate's start (SPEC 10.1). */}
      {start.map(([q, r]) => {
        const i = hexAt(map.hexes, q, r);
        if (i < 0) return null;
        const p = g.hexes[i]!;
        return (
          <polygon
            key={`s${q},${r}`}
            className="startarea"
            data-start={`${q},${r}`}
            points={hexPts(p.x * K, p.y * K, 0.86 * K)}
          />
        );
      })}
      {map.pirate
        ? (() => {
            const i = hexAt(map.hexes, map.pirate[0], map.pirate[1]);
            if (i < 0) return null;
            const p = g.hexes[i]!;
            return (
              <g className="piratestart" data-testid="pirate-start" pointerEvents="none">
                <circle cx={p.x * K} cy={p.y * K} r={0.34 * K} />
                <text x={p.x * K} y={p.y * K} textAnchor="middle" dominantBaseline="central">
                  ☠
                </text>
              </g>
            );
          })()
        : null}
      {ghosts.map((at) => {
        const x = Math.sqrt(3) * (at[0] + at[1] / 2) * K;
        const y = 1.5 * at[1] * K;
        return (
          <g key={`g${at.join(',')}`} data-kind="ghost" data-q={at[0]} data-r={at[1]} className="ghosthex">
            <polygon points={hexPts(x, y, 0.93 * K)} />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central">
              +
            </text>
          </g>
        );
      })}
      {heat
        ? g.verts.map((V, v) => {
            const land = V.hexes.some((h) => map.hexes[h]!.t !== 'sea' && map.hexes[h]!.t !== 'fog');
            if (!land) return null;
            const p = heat[v]!;
            if (!p) return null;
            return (
              <g
                key={`v${v}`}
                className={`heat${hlCorners.has(v) ? ' hl' : ''}`}
                data-corner={v}
                data-pips={p}
              >
                <circle cx={V.x * K} cy={V.y * K} r={0.17 * K} fill={heatFill(p)} />
                <text x={V.x * K} y={V.y * K} fill={p >= 8 ? '#1b1205' : '#f4ecd6'}>
                  {p}
                </text>
              </g>
            );
          })
        : hl?.corners.map((v) => (
            <circle
              key={`c${v}`}
              cx={g.verts[v]!.x * K}
              cy={g.verts[v]!.y * K}
              r={0.2 * K}
              className="cornerhl"
            />
          ))}
    </svg>
  );
}

/** Rule warnings (docs/maps.md 4.3): shown, never blocking. Hovering one highlights it. */
export function Warnings({ list, onHover }: { list: Violation[]; onHover: (v: Violation | null) => void }) {
  if (!list.length)
    return (
      <p className="hint ok" data-testid="warnings">
        No rule broken.
      </p>
    );
  return (
    <ul className="warnings" data-testid="warnings">
      {list.map((v, i) => (
        <li
          key={i}
          onMouseEnter={() => onHover(v)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(v)}
          onBlur={() => onHover(null)}
          tabIndex={0}
          data-rule={v.rule}
        >
          <b>{RULE_INFO[v.rule].no}</b> {v.text}
        </li>
      ))}
    </ul>
  );
}

const RES_ORDER = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;

/** The fairness summary (docs/maps.md 5.14), for a board with nothing blank. */
export function Fairness({ map, pips }: { map: MapData; pips: Record<number, number> }) {
  const s = useMemo(() => fairnessSummary(map, pips), [map, pips]);
  const names = (ts: Terrain[]) => ts.map((t) => TERRAIN_NAME[t]).join(', ') || 'nothing';
  return (
    <div className="fairness" data-testid="fairness">
      <div className="fairrow">
        {s.resources.map((r) => (
          <span key={r.r} className="res" title={`fair share ${r.fair.toFixed(1)}`}>
            <i style={{ background: TILE_COLOR[r.r] }} />
            {RES_LABEL[r.r]} <b>{r.pips}</b>
            <small>/{r.fair.toFixed(1)}</small>
          </span>
        ))}
      </div>
      <div className="fairrow">
        Best corners:{' '}
        {s.best.map((c, i) => (
          <span key={i}>
            <b>{c.pips}</b> ({names(c.terrain)}){i < s.best.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
      {s.worstInland ? (
        <div className="fairrow">
          Worst inland corner: <b>{s.worstInland.pips}</b> ({names(s.worstInland.terrain)})
        </div>
      ) : null}
      <div className="fairrow">
        Starting gap: <b>{s.draft[3].gap}</b> pips with 3 players, <b>{s.draft[4].gap}</b> with 4
      </div>
    </div>
  );
}

/** Tiles and tokens on the board against the set (docs/maps.md 4.3). */
export function Counts({ map }: { map: MapData }) {
  const c = counts(map);
  const terr = (Object.keys({ ...c.set.terrain, ...c.placed.terrain }) as Terrain[]).sort(
    (a, b) => Object.keys(TERRAIN_NAME).indexOf(a) - Object.keys(TERRAIN_NAME).indexOf(b),
  );
  const num = NUMBERS.filter((n) => c.set.numbers[n] || c.placed.numbers[n]);
  const blanks = map.hexes.filter((h) => h.t === 'random').length;
  return (
    <div className="counts" data-testid="counts">
      <div>
        {terr.map((t) => (
          <span key={t} className={(c.placed.terrain[t] ?? 0) > (c.set.terrain[t] ?? 0) ? 'over' : undefined}>
            {c.placed.terrain[t] ?? 0}/{c.set.terrain[t] ?? 0} {TERRAIN_NAME[t].toLowerCase()}
          </span>
        ))}
        {blanks ? <span>{blanks} blank</span> : null}
      </div>
      <div>
        Numbers:{' '}
        {num.map((n) => (
          <span key={n} className={(c.placed.numbers[n] ?? 0) > (c.set.numbers[n] ?? 0) ? 'over' : undefined}>
            {n}×{c.placed.numbers[n] ?? 0}/{c.set.numbers[n] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- The map list (4.4) ---------- */

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'map'}.settlers-map.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function MapsPage() {
  const st = useClient();
  const [del, setDel] = useState<MapInfo | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const exporting = useRef<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (st.status === 'live') {
      client.loadMaps();
      client.loadProfiles();
    }
  }, [st.status]);
  // Export: fetch the full map, then download it.
  useEffect(() => {
    const m = st.openMap;
    if (m && exporting.current === m.map.id) {
      exporting.current = null;
      download(m.info.name, JSON.stringify(m.map, null, 2));
    }
  }, [st.openMap]);
  const list = st.maps ?? [];
  return (
    <div className="center mapspage">
      <div className="card wide" data-testid="maps-page">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Brand />
          <button className="btn small" onClick={() => client.go('/')}>
            Back
          </button>
        </div>
        <h2>Maps</h2>
        <p className="lede">Make boards to play on. Saved maps are shared with everyone.</p>
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn primary" onClick={() => client.go('/maps/new')} data-testid="new-map">
            New map
          </button>
          <button className="btn" onClick={() => client.go('/maps/empty')} data-testid="new-empty-map">
            Start from nothing
          </button>
          <select
            className="btn"
            aria-label="Start from a premade map"
            data-testid="copy-premade"
            value=""
            onChange={(e) => e.target.value && client.go(`/maps/copy-${e.target.value}`)}
          >
            <option value="">Start from a premade map…</option>
            {COPYABLE_MAPS.map((m) => (
              <option key={m} value={m}>
                {SCENARIOS[m]!.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => file.current?.click()} data-testid="import-map">
            Import…
          </button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                client.importMap(JSON.parse(await f.text()) as MapData);
              } catch {
                client.toast('That file isn’t a map', 'err');
              }
            }}
          />
        </div>
        {list.length ? (
          <div className="maplist">
            {list.map((m) => (
              <div className="mapitem" key={m.id} data-testid="map-item" data-name={m.name}>
                <MapPreview hexes={m.hexes} size={96} />
                <div className="info">
                  {rename?.id === m.id ? (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (rename.name.trim()) client.renameMap(m.id, rename.name.trim());
                        setRename(null);
                      }}
                    >
                      <input
                        className="text"
                        value={rename.name}
                        maxLength={40}
                        autoFocus
                        onChange={(e) => setRename({ id: m.id, name: e.target.value })}
                        data-testid="rename-input"
                      />
                      <button className="btn small primary">Rename</button>
                    </form>
                  ) : (
                    <b>{m.name}</b>
                  )}
                  <span className="sub">
                    {m.by ? `${m.by} · ` : ''}
                    {new Date(m.updatedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' · '}
                    {m.players.join(', ')} players{m.seafarers ? ' · Seafarers' : ''}
                  </span>
                </div>
                <div className="acts">
                  <button
                    className="btn small primary"
                    onClick={() => client.go(`/maps/${m.id}`)}
                    data-testid="open-map"
                  >
                    Open
                  </button>
                  <button
                    className="btn small"
                    onClick={() => setRename({ id: m.id, name: m.name })}
                    data-testid="rename-map"
                  >
                    Rename
                  </button>
                  <button
                    className="btn small"
                    onClick={() => client.duplicateMap(m.id)}
                    data-testid="duplicate-map"
                  >
                    Duplicate
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      exporting.current = m.id;
                      client.openSavedMap(m.id);
                    }}
                    data-testid="export-map"
                  >
                    Export
                  </button>
                  <button className="btn small ghost" onClick={() => setDel(m)} data-testid="delete-map">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">No maps yet. “New map” starts from the standard board with every tile blank.</p>
        )}
      </div>
      {del ? (
        <ConfirmTwice
          title={`Delete “${del.name}”?`}
          first="It’ll be gone from the map list for everyone."
          second="Games already played on it keep their own copy. Delete it?"
          action="Delete it"
          onConfirm={() => client.deleteMap(del.id)}
          onClose={() => setDel(null)}
        />
      ) : null}
    </div>
  );
}

/* ---------- The editor (4.2, 4.3) ---------- */

/** A short random seed like k7Qp-3x (docs/maps.md 5.18). */
export function newSeed(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(6));
  const s = [...r].map((x) => abc[x % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function ToolButton(props: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  testid?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`btn small tool${props.on ? ' on' : ''}`}
      aria-pressed={props.on}
      onClick={props.onClick}
      data-testid={props.testid}
      title={props.title}
    >
      {props.children}
    </button>
  );
}

export function MapEditorPage({ id }: { id: string }) {
  const st = useClient();
  const hist = useRef<EditHistory | null>(null);
  const [, redraw] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(
    id === 'new' || id === 'empty' || id.startsWith('copy-') ? null : id,
  );
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>({ k: 'terrain', t: 'wood' });
  const [heat, setHeat] = useState(true);
  const [preset, setPreset] = useState('builtin:our rules');
  const [hover, setHover] = useState<Violation | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [name, setName] = useState('');

  // Start: a new board, or the saved map once it arrives.
  if (!hist.current) {
    if (id === 'new') hist.current = new EditHistory(standardBlank(CLASSIC_MAP, 'new', 'New map'));
    else if (id === 'empty') hist.current = new EditHistory(emptyMap('new', 'New map'));
    else if (id.startsWith('copy-') && SCENARIOS[id.slice(5)]) {
      // A copy of a premade Seafarers map, to change and save as your own.
      const m = SCENARIOS[id.slice(5)]!;
      hist.current = new EditHistory(
        normalize({ ...structuredClone(m), id: 'new', name: `${m.name} (copy)` }),
      );
    } else if (st.openMap?.map.id === id) hist.current = new EditHistory(normalize(st.openMap.map));
  }
  useEffect(() => {
    if (st.status !== 'live') return;
    client.loadPresets();
    client.loadProfiles();
    if (!hist.current) client.openSavedMap(id);
  }, [st.status]);
  useEffect(() => {
    if (!hist.current && st.openMap?.map.id === id) redraw((x) => x + 1);
  }, [st.openMap]);
  const map = hist.current?.map ?? null;
  useEffect(() => {
    if (map) setName(map.name);
  }, [map?.name]);
  // After a save, the server gives a new map its id.
  useEffect(() => {
    const m = st.openMap;
    if (!m?.saved || !map || m.info.name !== map.name) return;
    if (!savedId || savedId === m.map.id) {
      setSavedId(m.map.id);
      setDirty(false);
      if (location.pathname !== `/maps/${m.map.id}`) history.replaceState(null, '', `/maps/${m.map.id}`);
    }
  }, [st.openMap]);

  const edit = (op: EditOp) => {
    const h = hist.current;
    if (!h) return;
    const r = h.apply(op);
    if (!r.ok) client.toast(r.error, 'err');
    else {
      setDirty(true);
      redraw((x) => x + 1);
    }
  };
  const step = (dir: 'undo' | 'redo') => {
    const h = hist.current;
    if (h && (dir === 'undo' ? h.undo() : h.redo())) {
      setDirty(true);
      redraw((x) => x + 1);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        step(e.shiftKey ? 'redo' : 'undo');
      } else if (k === 'y') {
        e.preventDefault();
        step('redo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const presets = st.presets ?? [
    { id: 'builtin:our rules', name: 'Our rules', rules: OUR_RULES, builtIn: true, by: null },
  ];
  const rules: GenRules = (presets.find((p) => p.id === preset) ?? presets[0]!).rules;
  const players = map?.players.length ? Math.max(...map.players) : 4;
  const warnings = useMemo(() => (map ? checkBoard(map, rules, players) : []), [map, rules, players]);
  if (!map) return <div className="center">Opening the map…</div>;
  const seafarers = map.modules.includes('seafarers');
  const complete = map.hexes.length > 0 && map.hexes.every((h) => h.t !== 'random' && h.n !== 'random');
  const terrains: (Terrain | 'random')[] = [
    'wood', 'brick', 'sheep', 'wheat', 'ore', 'desert', ...(seafarers ? (['sea', 'gold', 'fog'] as const) : []), 'random',
  ]; // prettier-ignore
  const harbors: (PortType | 'random')[] = ['any', 'wood', 'brick', 'sheep', 'wheat', 'ore', 'random'];
  const back = () => (dirty ? setLeaving(true) : client.go('/maps'));

  return (
    <div className="mapeditor" data-testid="map-editor">
      <header className="edhead">
        <button className="btn small" onClick={back} data-testid="editor-back">
          Back
        </button>
        <input
          className="text mapname"
          value={name}
          maxLength={40}
          aria-label="Map name"
          data-testid="map-name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== map.name && edit({ k: 'meta', name })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="row tight">
          <button
            className="btn small"
            disabled={!hist.current?.canUndo}
            onClick={() => step('undo')}
            data-testid="undo-edit"
          >
            Undo
          </button>
          <button
            className="btn small"
            disabled={!hist.current?.canRedo}
            onClick={() => step('redo')}
            data-testid="redo-edit"
          >
            Redo
          </button>
          <button
            className="btn small"
            onClick={() => download(map.name, JSON.stringify({ ...map, id: savedId ?? map.id }, null, 2))}
            data-testid="export-current"
          >
            Export
          </button>
          <button
            className="btn small primary"
            onClick={() => client.saveMap({ ...map, id: savedId ?? 'new' })}
            data-testid="save-map"
          >
            {dirty || !savedId ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>
      <div className="edbody">
        <div className="edboard">
          <MapBoard map={map} tool={tool} onEdit={edit} heat={heat} pips={rules.pips} highlight={hover} />
        </div>
        <aside className="edside">
          <section>
            <h4>Tiles</h4>
            <div className="palette">
              {terrains.map((t) => (
                <ToolButton
                  key={t}
                  on={tool.k === 'terrain' && tool.t === t}
                  onClick={() => setTool({ k: 'terrain', t })}
                  testid={`tool-terrain-${t}`}
                >
                  <i className="sw" style={{ background: t === 'random' ? BLANK_FILL : TILE_COLOR[t] }} />
                  {TERRAIN_NAME[t]}
                </ToolButton>
              ))}
            </div>
          </section>
          <section>
            <h4>Numbers</h4>
            <div className="palette nums">
              {NUMBERS.map((n) => (
                <ToolButton
                  key={n}
                  on={tool.k === 'number' && tool.n === n}
                  onClick={() => setTool({ k: 'number', n })}
                  testid={`tool-number-${n}`}
                >
                  <span className={n === 6 || n === 8 ? 'red' : undefined}>{n}</span>
                </ToolButton>
              ))}
              <ToolButton
                on={tool.k === 'number' && tool.n === 'random'}
                onClick={() => setTool({ k: 'number', n: 'random' })}
                testid="tool-number-random"
                title="Take the number off (it's filled later)"
              >
                Blank
              </ToolButton>
            </div>
          </section>
          <section>
            <h4>Harbors</h4>
            <div className="palette">
              {harbors.map((t) => (
                <ToolButton
                  key={t}
                  on={tool.k === 'harbor' && tool.t === t}
                  onClick={() => setTool({ k: 'harbor', t })}
                  testid={`tool-harbor-${t}`}
                >
                  {HARBOR_NAME(t)}
                </ToolButton>
              ))}
              <ToolButton
                on={tool.k === 'harbor' && tool.t === null}
                onClick={() => setTool({ k: 'harbor', t: null })}
                testid="tool-harbor-remove"
              >
                Remove
              </ToolButton>
            </div>
          </section>
          <section>
            <h4>Treasures</h4>
            <div className="palette">
              <ToolButton
                on={tool.k === 'treasure'}
                onClick={() => setTool({ k: 'treasure' })}
                testid="tool-treasure"
                title="Click a path to put a treasure on it; click a treasure to take it off"
              >
                Treasure
              </ToolButton>
              <span className="hint" data-testid="treasure-count">
                {(map.treasures ?? []).length
                  ? `${(map.treasures ?? []).length} on the map. The first road or ship on one finds it.`
                  : 'None yet. Any mode.'}
              </span>
            </div>
          </section>
          <section>
            <h4>Arrange</h4>
            <div className="palette">
              <ToolButton
                on={tool.k === 'move'}
                onClick={() => setTool({ k: 'move' })}
                testid="tool-move"
                title="Drag a tile, number or harbor to swap it"
              >
                Move
              </ToolButton>
              <ToolButton
                on={tool.k === 'lock'}
                onClick={() => setTool({ k: 'lock' })}
                testid="tool-lock"
                title="Locked things stay when filling"
              >
                Lock
              </ToolButton>
              <ToolButton
                on={tool.k === 'shape' && tool.add === 'random'}
                onClick={() => setTool({ k: 'shape', add: 'random' })}
                testid="tool-shape"
                title="Click + to add a hex, a hex to remove it"
              >
                Add / remove hex
              </ToolButton>
              {seafarers ? (
                <ToolButton
                  on={tool.k === 'shape' && tool.add === 'sea'}
                  onClick={() => setTool({ k: 'shape', add: 'sea' })}
                  testid="tool-shape-sea"
                >
                  Add sea
                </ToolButton>
              ) : null}
            </div>
            <p className="hint small">{TOOL_HINT[tool.k]}</p>
          </section>
          {seafarers ? <SeafarersPanel map={map} tool={tool} setTool={setTool} edit={edit} /> : null}
          <RegionsPanel map={map} tool={tool} setTool={setTool} edit={edit} />
          <section>
            <h4>Fill</h4>
            <div className="row tight">
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                aria-label="Preset"
                data-testid="preset"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={() => setPresetsOpen(true)} data-testid="presets">
                Presets…
              </button>
              <button
                className="btn small primary"
                data-testid="fill-rest"
                onClick={() => {
                  const r = fillRest(map, rules, newSeed(), players);
                  if (!r.ok) client.toast(r.error, 'err');
                  else edit({ k: 'replace', map: r.map });
                }}
              >
                Fill the rest
              </button>
              <button className="btn small" onClick={() => edit({ k: 'clear' })} data-testid="clear-unlocked">
                Clear unlocked
              </button>
            </div>
          </section>
          <section>
            <h4>Map</h4>
            <div className="row tight">
              Players:
              {[2, 3, 4].map((n) => (
                <label key={n} className="check">
                  <input
                    type="checkbox"
                    checked={map.players.includes(n)}
                    onChange={(e) =>
                      edit({
                        k: 'meta',
                        players: e.target.checked ? [...map.players, n] : map.players.filter((x) => x !== n),
                      })
                    }
                  />
                  {n}
                </label>
              ))}
            </div>
            <div className="row tight">
              <label className="check">
                Points to win
                <input
                  type="number"
                  className="text num"
                  min={3}
                  max={30}
                  value={map.winVP}
                  onChange={(e) => edit({ k: 'meta', winVP: Number(e.target.value) })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={seafarers}
                  onChange={(e) => edit({ k: 'meta', seafarers: e.target.checked })}
                  data-testid="seafarers"
                />
                Seafarers
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={heat}
                  onChange={(e) => setHeat(e.target.checked)}
                  data-testid="heat"
                />
                Heat map
              </label>
            </div>
            <Counts map={map} />
          </section>
          <section>
            <h4>Warnings</h4>
            <Warnings list={warnings} onHover={setHover} />
          </section>
          {complete ? (
            <section>
              <h4>Fairness</h4>
              <Fairness map={map} pips={rules.pips} />
            </section>
          ) : null}
        </aside>
      </div>
      {presetsOpen ? (
        <PresetSheet value={preset} onPick={setPreset} onClose={() => setPresetsOpen(false)} />
      ) : null}
      {leaving ? (
        <Sheet
          title="Leave without saving?"
          sub="Your changes since the last save will be lost."
          onClose={() => setLeaving(false)}
          foot={
            <>
              <button className="btn ghost" onClick={() => setLeaving(false)}>
                Keep editing
              </button>
              <button
                className="btn primary danger"
                onClick={() => client.go('/maps')}
                data-testid="leave-unsaved"
              >
                Leave
              </button>
            </>
          }
        >
          {null}
        </Sheet>
      ) : null}
    </div>
  );
}

/** Region outlines: distinct hues that read on every tile. */
const REGION_COLORS = [
  '#ffd166',
  '#7fd6ff',
  '#ff8fd0',
  '#b4f06b',
  '#ffa45c',
  '#c3a6ff',
  '#5ce1c0',
  '#ff6b6b',
  '#f4ecd6',
  '#9fb3ff',
  '#e0c070',
  '#8cf0ff',
];

/** One tile set: each kind's count, with a swap in (+) or out (−); the size follows the hexes. */
function SetEditor({
  map,
  region,
  edit,
}: {
  map: MapData;
  region: string | null;
  edit: (op: EditOp) => void;
}) {
  const c = counts(map, region);
  const kinds: Terrain[] = [
    'wood',
    'brick',
    'sheep',
    'wheat',
    'ore',
    'desert',
    ...(map.modules.includes('seafarers') ? (['gold'] as const) : []),
  ];
  const hexes = map.hexes.filter((h) => (h.region ?? null) === region && h.t !== 'sea' && h.t !== 'fog');
  const blank = hexes.filter((h) => h.t === 'random').length;
  return (
    <div className="seted" data-testid={`set-${region ?? 'main'}`}>
      <span className="small">
        {hexes.length} land hex{hexes.length === 1 ? '' : 'es'}
        {blank ? `, ${blank} blank` : ''}
      </span>
      <div className="fogcounts">
        {kinds.map((t) => (
          <span key={t} className="fogcount" data-t={t}>
            <i className="sw" style={{ background: TILE_COLOR[t] }} />
            {TERRAIN_NAME[t]}
            <button
              type="button"
              aria-label={`One ${t} fewer`}
              data-testid={`set-${region ?? 'main'}-${t}-less`}
              onClick={() => edit({ k: 'setTile', region, t, delta: -1 })}
            >
              −
            </button>
            <b data-testid={`set-${region ?? 'main'}-${t}`}>{c.set.terrain[t] ?? 0}</b>
            <button
              type="button"
              aria-label={`One ${t} more`}
              data-testid={`set-${region ?? 'main'}-${t}-more`}
              onClick={() => edit({ k: 'setTile', region, t, delta: 1 })}
            >
              +
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Tile sets and regions (SPEC 10.4): the main set, and regions of hexes with their own sets,
 * shuffled only within the region. Works in every mode (D5).
 */
function RegionsPanel({
  map,
  tool,
  setTool,
  edit,
}: {
  map: MapData;
  tool: Tool;
  setTool: (t: Tool) => void;
  edit: (op: EditOp) => void;
}) {
  const ids = Object.keys(map.regions ?? {});
  return (
    <section data-testid="regions-panel">
      <h4>Tile sets</h4>
      <p className="hint small">
        Blank hexes are drawn from their set when the board is made, and again on every reroll.
      </p>
      <b className="small">{ids.length ? 'Everywhere else' : 'The whole map'}</b>
      <SetEditor map={map} region={null} edit={edit} />
      {ids.map((id, k) => (
        <div key={id} className="regionrow" data-testid={`region-${id}`}>
          <div className="row tight">
            <i className="sw" style={{ background: REGION_COLORS[k % REGION_COLORS.length] }} />
            <b>{String.fromCharCode(65 + k)}</b>
            <input
              className="text"
              defaultValue={map.regions![id]!.name}
              key={map.regions![id]!.name}
              aria-label="Region name"
              data-testid={`region-${id}-name`}
              onBlur={(e) =>
                e.target.value.trim() !== map.regions![id]!.name &&
                edit({ k: 'renameRegion', region: id, name: e.target.value })
              }
            />
            <ToolButton
              on={tool.k === 'region' && tool.region === id}
              onClick={() => setTool({ k: 'region', region: id })}
              testid={`region-${id}-paint`}
            >
              Paint
            </ToolButton>
            <button
              className="btn small ghost"
              onClick={() => edit({ k: 'removeRegion', region: id })}
              data-testid={`region-${id}-remove`}
            >
              Remove
            </button>
          </div>
          <SetEditor map={map} region={id} edit={edit} />
        </div>
      ))}
      <div className="row tight">
        <button
          className="btn small"
          data-testid="region-add"
          onClick={() => {
            const before = new Set(ids);
            edit({ k: 'addRegion' });
            // Paint with the new region straight away.
            const fresh = Object.keys(map.regions ?? {}).find((x) => !before.has(x));
            const next = `r${[...Array(13).keys()].slice(1).find((i) => !before.has(`r${i}`))}`;
            setTool({ k: 'region', region: fresh ?? next });
          }}
        >
          New region
        </button>
        {ids.length ? (
          <ToolButton
            on={tool.k === 'region' && tool.region === null}
            onClick={() => setTool({ k: 'region', region: null })}
            testid="region-none"
          >
            Paint out of regions
          </ToolButton>
        ) : null}
      </div>
    </section>
  );
}

const FOG_NUMBER_CYCLE = [5, 9, 4, 10, 6, 8, 3, 11, 2, 12];
const FOG_KINDS: Terrain[] = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold', 'desert', 'sea'];

/**
 * Seafarers pieces (SPEC 10.1, 10.2): the start area and the pirate's start (board tools),
 * points for a new island, and the fog stack (what fog can hide), set by hand or left standard.
 */
function SeafarersPanel({
  map,
  tool,
  setTool,
  edit,
}: {
  map: MapData;
  tool: Tool;
  setTool: (t: Tool) => void;
  edit: (op: EditOp) => void;
}) {
  const fogHexes = map.hexes.filter((h) => h.t === 'fog').length;
  const stack = map.fog ?? { terrain: [], numbers: [] };
  const [nums, setNums] = useState(stack.numbers.join(', '));
  useEffect(() => setNums(stack.numbers.join(', ')), [stack.numbers.join(',')]);
  const countOf = (t: Terrain) => stack.terrain.filter((x) => x === t).length;
  const setCount = (t: Terrain, n: number) => {
    const terrain = [...stack.terrain.filter((x) => x !== t), ...new Array<Terrain>(Math.max(0, n)).fill(t)];
    // Land and gold under the fog need a number each: more land brings a standard number.
    const need = terrain.filter((x) => x !== 'sea' && x !== 'desert').length;
    const numbers = stack.numbers.slice();
    while (numbers.length < need) numbers.push(FOG_NUMBER_CYCLE[numbers.length % FOG_NUMBER_CYCLE.length]!);
    edit({ k: 'fogStack', terrain, numbers });
  };
  const start = Array.isArray(map.start) ? map.start.length : 0;
  return (
    <section data-testid="seafarers-panel">
      <h4>Seafarers</h4>
      <div className="palette">
        <ToolButton on={tool.k === 'start'} onClick={() => setTool({ k: 'start' })} testid="tool-start">
          Start area{start ? ` (${start})` : ''}
        </ToolButton>
        <ToolButton on={tool.k === 'pirate'} onClick={() => setTool({ k: 'pirate' })} testid="tool-pirate">
          Pirate start
        </ToolButton>
        <ToolButton
          on={false}
          onClick={() => edit({ k: 'pirate', at: null })}
          testid="pirate-off"
          title="The pirate starts off the board"
        >
          Pirate off the board
        </ToolButton>
      </div>
      <div className="row tight">
        <label className="check">
          Points for a new island
          <select
            value={map.specialVP?.newIsland ?? 0}
            onChange={(e) => edit({ k: 'islandVP', n: Number(e.target.value) })}
            data-testid="island-vp"
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {fogHexes ? (
        <div className="fogstack" data-testid="fog-stack">
          <p className="small">
            Under the fog ({stack.terrain.length} tiles for {fogHexes} fog hexes):
          </p>
          <div className="fogcounts">
            {FOG_KINDS.map((t) => (
              <span key={t} className="fogcount" data-t={t}>
                <i className="sw" style={{ background: TILE_COLOR[t] }} />
                {TERRAIN_NAME[t]}
                <button
                  type="button"
                  aria-label={`One less ${t}`}
                  onClick={() => setCount(t, countOf(t) - 1)}
                >
                  −
                </button>
                <b data-testid={`fog-${t}`}>{countOf(t)}</b>
                <button
                  type="button"
                  aria-label={`One more ${t}`}
                  onClick={() => setCount(t, countOf(t) + 1)}
                >
                  +
                </button>
              </span>
            ))}
          </div>
          <label className="check">
            Numbers
            <input
              className="text"
              value={nums}
              data-testid="fog-numbers"
              onChange={(e) => setNums(e.target.value)}
              onBlur={() => {
                const numbers = nums
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(Number);
                if (numbers.join(',') !== stack.numbers.join(','))
                  edit({ k: 'fogStack', terrain: stack.terrain, numbers });
              }}
            />
          </label>
          <button
            className="btn small"
            onClick={() => edit({ k: 'fogStack', standard: true })}
            data-testid="fog-standard"
          >
            Standard
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={map.fogRewards !== false}
              data-testid="fog-rewards"
              onChange={(e) => edit({ k: 'fogRewards', on: e.target.checked })}
            />
            Uncovering pays: land gives its card, sea or desert a treasure
          </label>
        </div>
      ) : null}
    </section>
  );
}

const TOOL_HINT: Record<Tool['k'], string> = {
  terrain: 'Click a hex to place the tile.',
  number: 'Click a tile to place the number.',
  harbor: 'Click a dot on the coast to place a harbor, or a harbor to change it.',
  treasure: 'Click a dot on a path to put a treasure there, or a treasure to take it off.',
  move: 'Drag a tile, number or harbor onto another to swap them (or tap one, then the other).',
  lock: 'Click a tile, number or harbor to lock or unlock it. Filling keeps locked things.',
  shape: 'Click + to add a hex, or a hex to remove it.',
  start:
    'Click hexes to paint the start area: starting settlements go only there. None painted means anywhere.',
  pirate: 'Click a sea hex for the pirate’s start.',
  region: 'Click hexes to paint them into the region; its blanks draw only from its own set.',
};

/* ---------- Presets (5.18) ---------- */

type Bool = 'redApart' | 'harborNoRed' | 'twoTwelveApart' | 'noLowClusters' | 'sameApart';
type Limit = 'bestSpot' | 'badSpot' | 'clump' | 'balance' | 'fairness';
const LIMITS: { k: Limit; no: string; label: string; unit: string; def: number; min: number; max: number }[] =
  [
    { k: 'bestSpot', no: '5.5', label: 'Best-spot limit', unit: 'pips at most', def: 12, min: 5, max: 30 },
    {
      k: 'badSpot',
      no: '5.6',
      label: 'Bad-spot limit (inland corners)',
      unit: 'pips at least',
      def: 4,
      min: 0,
      max: 30,
    },
    { k: 'clump', no: '5.10', label: 'Resource clump limit', unit: 'tiles at most', def: 3, min: 1, max: 19 },
    {
      k: 'balance',
      no: '5.11',
      label: 'Resource balance',
      unit: '% of fair share',
      def: 25,
      min: 0,
      max: 100,
    },
    {
      k: 'fairness',
      no: '5.12',
      label: 'Starting fairness',
      unit: 'pips gap at most',
      def: 4,
      min: 0,
      max: 30,
    },
  ];
const BOOLS: { k: Bool; no: string; label: string }[] = [
  { k: 'redApart', no: '5.2', label: 'Red numbers (6, 8) never touch' },
  { k: 'harborNoRed', no: '5.4', label: 'No 6 or 8 at any harbor' },
  { k: 'twoTwelveApart', no: '5.7', label: '2 and 12 never touch' },
  { k: 'noLowClusters', no: '5.8', label: 'No clusters of 2, 3, 11, 12' },
  { k: 'sameApart', no: '5.9', label: 'Same number never touches' },
];

/** Pick, view, copy, edit and delete generator presets. Built-in ones are read-only. */
export function PresetSheet(props: { value: string; onPick: (id: string) => void; onClose: () => void }) {
  const st = useClient();
  const list = st.presets ?? [];
  const current = list.find((p) => p.id === props.value) ?? list[0];
  const [draft, setDraft] = useState<{ id?: string; name: string; rules: GenRules } | null>(null);
  const [del, setDel] = useState(false);
  const [trial, setTrial] = useState<string | null>(null);
  const r = draft?.rules ?? current?.rules ?? OUR_RULES;
  const ro = !draft;
  const set = (patch: Partial<GenRules>) =>
    draft && setDraft({ ...draft, rules: { ...draft.rules, ...patch } });
  // After saving, pick the preset by its name.
  useEffect(() => {
    if (!draft?.name) return;
    const saved = list.find((p) => p.name === draft.name.trim() && !p.builtIn);
    if (saved && JSON.stringify(saved.rules) === JSON.stringify(draft.rules)) {
      props.onPick(saved.id);
      setDraft(null);
    }
  }, [st.presets]);
  const tryIt = () => {
    const t0 = performance.now();
    const g = fillRest(standardBlank(CLASSIC_MAP, 'try', 'Try'), r, newSeed(), r.fairPlayers ?? 4);
    setTrial(
      g.ok
        ? `A board in ${Math.round(performance.now() - t0)} ms${g.eased ? ' (spot rules eased a little)' : ''}.`
        : g.error,
    );
  };
  return (
    <Sheet
      title="Generator presets"
      sub="Rules a filled or generated board follows. Presets are shared with everyone."
      onClose={props.onClose}
      foot={
        draft ? (
          <>
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!draft.name.trim()}
              onClick={() => client.savePreset(draft.id, draft.name.trim(), draft.rules)}
              data-testid="preset-save"
            >
              Save preset
            </button>
          </>
        ) : (
          <>
            {current && !current.builtIn ? (
              <>
                <button className="btn ghost" onClick={() => setDel(true)} data-testid="preset-delete">
                  Delete
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    setDraft({ id: current.id, name: current.name, rules: structuredClone(current.rules) })
                  }
                  data-testid="preset-edit"
                >
                  Edit
                </button>
              </>
            ) : null}
            <button
              className="btn"
              onClick={() =>
                setDraft({ name: `${current?.name ?? 'Our rules'} (mine)`, rules: structuredClone(r) })
              }
              data-testid="preset-copy"
            >
              Copy to a new preset
            </button>
            <button className="btn primary" onClick={props.onClose}>
              Done
            </button>
          </>
        )
      }
    >
      <div className="presetform" data-testid="preset-sheet">
        {draft ? (
          <input
            className="text"
            value={draft.name}
            maxLength={40}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Preset name"
            data-testid="preset-name"
          />
        ) : (
          <select
            value={current?.id}
            onChange={(e) => props.onPick(e.target.value)}
            aria-label="Preset"
            data-testid="preset-pick"
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.by ? ` (${p.by})` : ''}
              </option>
            ))}
          </select>
        )}
        {BOOLS.map((b) => (
          <label key={b.k} className="check rule">
            <input
              type="checkbox"
              disabled={ro}
              checked={r[b.k]}
              onChange={(e) => set({ [b.k]: e.target.checked })}
              data-testid={`rule-${b.k}`}
            />
            <b>{b.no}</b> {b.label}
          </label>
        ))}
        <label className="check rule">
          <b>5.3</b> 2:1 harbors away from good numbers of their resource
          <select
            disabled={ro}
            value={r.harborGood}
            onChange={(e) => set({ harborGood: e.target.value as GenRules['harborGood'] })}
          >
            <option value="off">Off</option>
            <option value="68">6 and 8</option>
            <option value="5689">5, 6, 8 and 9</option>
          </select>
        </label>
        {LIMITS.map((l) => (
          <label key={l.k} className="check rule">
            <input
              type="checkbox"
              disabled={ro}
              checked={r[l.k] !== null}
              onChange={(e) => set({ [l.k]: e.target.checked ? l.def : null })}
              data-testid={`rule-${l.k}`}
            />
            <b>{l.no}</b> {l.label}
            {r[l.k] !== null ? (
              <>
                <input
                  type="number"
                  className="text num"
                  disabled={ro}
                  min={l.min}
                  max={l.max}
                  value={r[l.k] ?? ''}
                  onChange={(e) =>
                    set({ [l.k]: Math.max(l.min, Math.min(l.max, Math.round(Number(e.target.value) || 0))) })
                  }
                  data-testid={`limit-${l.k}`}
                />
                <small>{l.unit}</small>
              </>
            ) : null}
          </label>
        ))}
        {r.badSpot !== null ? (
          <label className="check rule sub">
            <input
              type="checkbox"
              disabled={ro}
              checked={r.badSpotDesert}
              onChange={(e) => set({ badSpotDesert: e.target.checked })}
            />
            Count corners on the desert too
          </label>
        ) : null}
        {r.fairness !== null ? (
          <label className="check rule sub">
            Fairness for
            <select
              disabled={ro}
              value={r.fairPlayers ?? 0}
              onChange={(e) => set({ fairPlayers: Number(e.target.value) || null })}
            >
              <option value={0}>the table’s players</option>
              <option value={2}>2 players</option>
              <option value={3}>3 players</option>
              <option value={4}>4 players</option>
            </select>
          </label>
        ) : null}
        <label className="check rule">
          <b>5.15</b> Desert
          <select
            disabled={ro}
            value={r.desert}
            onChange={(e) => set({ desert: e.target.value as GenRules['desert'] })}
            data-testid="rule-desert"
          >
            <option value="random">Anywhere</option>
            <option value="center">In the middle</option>
            <option value="edge">On the coast</option>
            <option value="none">No desert</option>
          </select>
        </label>
        <label className="check rule">
          <b>5.16</b> Harbors
          <select
            disabled={ro}
            value={r.harbors}
            onChange={(e) => set({ harbors: e.target.value as GenRules['harbors'] })}
          >
            <option value="standard">Standard spots</option>
            <option value="random">Random spots</option>
          </select>
        </label>
        <label className="check rule">
          <b>5.17</b> Numbers
          <select
            disabled={ro}
            value={r.numbers}
            onChange={(e) => set({ numbers: e.target.value as GenRules['numbers'] })}
          >
            <option value="random">Random, within the rules</option>
            <option value="spiral">Official spiral</option>
          </select>
        </label>
        <details>
          <summary>
            <b>5.1</b> Pips per token
          </summary>
          <div className="pips">
            {NUMBERS.map((n) => (
              <label key={n}>
                {n}
                <input
                  type="number"
                  className="text num"
                  disabled={ro}
                  min={0}
                  max={10}
                  value={r.pips[n] ?? 0}
                  onChange={(e) =>
                    set({
                      pips: {
                        ...r.pips,
                        [n]: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <div className="row tight">
          <button type="button" className="btn small" onClick={tryIt} data-testid="preset-try">
            Try these rules
          </button>
          {trial ? (
            <span className="hint small" data-testid="preset-trial">
              {trial}
            </span>
          ) : null}
        </div>
      </div>
      {del && current ? (
        <ConfirmTwice
          title={`Delete “${current.name}”?`}
          first="It’ll be gone for everyone."
          second="Boards already made with it stay as they are. Delete it?"
          action="Delete it"
          onConfirm={() => {
            client.deletePreset(current.id);
            props.onPick('builtin:our rules');
          }}
          onClose={() => setDel(false)}
        />
      ) : null}
    </Sheet>
  );
}
