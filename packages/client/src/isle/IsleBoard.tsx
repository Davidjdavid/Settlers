/*
 * The Isle board (docs/isle.md 3): a toy island in a bright sea, filling the screen. The island is
 * fitted into the space the seats and tray leave free; the sea runs off every edge.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { geometryFor, type Geometry, type PlayerView } from '@settlers/engine';
import {
  ICON,
  ICOL,
  OUTLINE,
  citySVG,
  knightSVG,
  pirateSVG,
  roadSVG,
  robberSVG,
  settlementSVG,
  shipSVG,
  wallSVG,
} from './pieces';
import { f2, rand, rhex, tileDefs, tileSVG } from './tiles';

/** Pixels per hex radius in board space. */
export const U = 100;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const PIPS = (n: number) => 6 - Math.abs(7 - n);

function tokenSVG(n: number, cx: number, cy: number, i: number): string {
  const red = n === 6 || n === 8;
  const r = 0.34 * U;
  const pips = PIPS(n);
  const dots = Array.from({ length: pips }, (_, k) => {
    const x = cx + (k - (pips - 1) / 2) * 0.075 * U;
    return `<circle cx="${f2(x)}" cy="${f2(cy + 0.17 * U)}" r="${f2(0.026 * U)}" fill="${red ? '#e2352a' : '#4a3b2a'}"/>`;
  }).join('');
  return (
    `<g class="itoken" data-token="${i}" data-n="${n}" data-pips="${pips}">` +
    `<ellipse cx="${f2(cx)}" cy="${f2(cy + 0.06 * U)}" rx="${f2(r * 1.02)}" ry="${f2(r * 0.95)}" fill="#000" opacity=".22"/>` +
    `<circle cx="${f2(cx)}" cy="${f2(cy + 0.035 * U)}" r="${f2(r)}" fill="#d8c79f" stroke="#a8916a" stroke-width="${f2(0.012 * U)}"/>` +
    `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="url(#itok)" stroke="#e3d5b4" stroke-width="${f2(0.012 * U)}"/>` +
    `<text x="${f2(cx)}" y="${f2(cy + 0.075 * U)}" text-anchor="middle" font-family="'Baloo 2', sans-serif" font-weight="800" font-size="${f2(0.34 * U)}" fill="${red ? '#e2352a' : '#3b2d1e'}" letter-spacing="-1">${n}</text>` +
    dots +
    `</g>`
  );
}

/** Where a harbor's badge sits: off the middle of its side, out to sea. */
function harborPoint(g: Geometry, e: number, land: number) {
  const E = g.edges[e]!;
  const a = g.verts[E.a]!;
  const b = g.verts[E.b]!;
  const h = g.hexes[land]!;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const L = Math.hypot(mx - h.x, my - h.y);
  return { x: (mx + ((mx - h.x) / L) * 0.62) * U, y: (my + ((my - h.y) / L) * 0.62) * U, a, b };
}

const HARBOR_RING: Record<string, string> = {
  wood: '#3e8f3a',
  brick: '#c0502c',
  sheep: '#79b64a',
  wheat: '#e0a524',
  ore: '#7c889b',
  any: '#2a8fd6',
};

function harborSVG(
  t: string,
  p: { x: number; y: number; a: { x: number; y: number }; b: { x: number; y: number } },
): string {
  const plank = (v: { x: number; y: number }) => {
    const x1 = v.x * U;
    const y1 = v.y * U;
    const x2 = x1 + (p.x - x1) * 0.7;
    const y2 = y1 + (p.y - y1) * 0.7;
    return `<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="#6b4423" stroke-width="${f2(0.13 * U)}" stroke-linecap="round"/><line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="#c48a52" stroke-width="${f2(0.08 * U)}" stroke-linecap="round" stroke-dasharray="${f2(0.06 * U)} ${f2(0.025 * U)}"/>`;
  };
  const r = 0.3 * U;
  const ring = HARBOR_RING[t] ?? '#2a8fd6';
  const icon =
    t === 'any'
      ? `<text x="${f2(p.x)}" y="${f2(p.y + 0.06 * U)}" text-anchor="middle" font-family="'Baloo 2', sans-serif" font-weight="800" font-size="${f2(0.2 * U)}" fill="${ring}">?</text>`
      : `<g transform="translate(${f2(p.x)} ${f2(p.y - 0.03 * U)}) scale(${f2(0.19 * U)})">${ICON[t] ?? ''}</g>`;
  return (
    `<g class="iharbor" data-harbor="${t}">${plank(p.a)}${plank(p.b)}` +
    `<ellipse cx="${f2(p.x)}" cy="${f2(p.y + 0.07 * U)}" rx="${f2(r)}" ry="${f2(r * 0.4)}" fill="#063a63" opacity=".25"/>` +
    `<circle cx="${f2(p.x)}" cy="${f2(p.y)}" r="${f2(r)}" fill="#ffffff" stroke="${ring}" stroke-width="${f2(0.06 * U)}"/>` +
    icon +
    `<rect x="${f2(p.x - 0.2 * U)}" y="${f2(p.y + 0.17 * U)}" width="${f2(0.4 * U)}" height="${f2(0.17 * U)}" rx="${f2(0.085 * U)}" fill="${ring}" stroke="#ffffff" stroke-width="${f2(0.025 * U)}"/>` +
    `<text x="${f2(p.x)}" y="${f2(p.y + 0.3 * U)}" text-anchor="middle" font-family="'Baloo 2', sans-serif" font-weight="800" font-size="${f2(0.14 * U)}" fill="#ffffff">${t === 'any' ? '3:1' : '2:1'}</text>` +
    `</g>`
  );
}

function seaDefs(): string {
  return (
    `<radialGradient id="isea" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#4cc4f0"/><stop offset=".6" stop-color="#2a9fe0"/><stop offset="1" stop-color="#1877c4"/></radialGradient>` +
    `<radialGradient id="itok" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#fff8e6"/><stop offset="1" stop-color="#f1e5c6"/></radialGradient>` +
    `<pattern id="iwaves" width="180" height="90" patternUnits="userSpaceOnUse"><path d="M10 30q12-10 24 0t24 0" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".22"/><path d="M100 72q12-10 24 0t24 0" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".16"/></pattern>` +
    `<filter id="iblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>`
  );
}

/** Everything that doesn't change in a game: sea, island, tiles, harbors and number tokens. */
function staticSVG(v: PlayerView, g: Geometry): string {
  const out: string[] = [];
  out.push(`<defs>${seaDefs()}${tileDefs()}</defs>`);
  out.push(`<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#isea)"/>`);
  out.push(`<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#iwaves)"/>`);
  const land = v.board.hexes.map((h, i) => ({ h, i, p: g.hexes[i]! })).filter((x) => x.h.t !== 'sea');
  // Shallow water, foam and a sandy beach round each island.
  out.push(
    `<g opacity=".55">${land.map((x) => `<path d="${rhex(x.p.x * U, x.p.y * U, 1.42 * U, 0.5 * U)}" fill="#7fe3f2"/>`).join('')}</g>`,
  );
  out.push(
    `<g class="foam">${land.map((x) => `<path d="${rhex(x.p.x * U, x.p.y * U, 1.17 * U, 0.35 * U)}" fill="#ffffff" opacity=".9"/>`).join('')}</g>`,
  );
  out.push(
    land
      .map((x) => `<path d="${rhex(x.p.x * U, x.p.y * U + 0.06 * U, 1.1 * U, 0.3 * U)}" fill="#e2bd72"/>`)
      .join(''),
  );
  out.push(
    land.map((x) => `<path d="${rhex(x.p.x * U, x.p.y * U, 1.08 * U, 0.3 * U)}" fill="#f8e3a6"/>`).join(''),
  );
  // Soft shadows under the tiles.
  out.push(
    `<g filter="url(#iblur)" opacity=".35">${land.map((x) => `<path d="${rhex(x.p.x * U + 0.05 * U, x.p.y * U + 0.18 * U, 0.9 * U, 0.15 * U)}" fill="#6b4a12"/>`).join('')}</g>`,
  );
  // Harbors sit out on the water, under nothing.
  v.board.ports.forEach((pt) => {
    const e = g.edges[pt.e]!;
    const landHex = e.hexes.find((x) => v.board.hexes[x]!.t !== 'sea') ?? e.hexes[0]!;
    out.push(harborSVG(pt.t, harborPoint(g, pt.e, landHex)));
  });
  // Tiles, back to front so the thick sides overlap properly.
  const order = [...land].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
  for (const x of order) {
    const variant = Math.floor(rand(x.i * 31 + 7)() * 2);
    out.push(tileSVG(x.h.t, x.p.x * U, x.p.y * U, U, variant, x.i));
  }
  return out.join('');
}

function tokensSVG(v: PlayerView, g: Geometry): string {
  return v.board.hexes
    .map((h, i) => (h.n && h.t !== 'sea' ? tokenSVG(h.n, g.hexes[i]!.x * U, g.hexes[i]!.y * U, i) : ''))
    .join('');
}

function piecesSVG(v: PlayerView, g: Geometry): string {
  const out: string[] = [];
  const color = (p: number) => v.players[p]!.color;
  // Roads.
  v.edges.forEach((p, e) => {
    if (p == null) return;
    const E = g.edges[e]!;
    const a = g.verts[E.a]!;
    const b = g.verts[E.b]!;
    const t = 0.2;
    out.push(
      `<g class="ipiece" data-road="${e}">${roadSVG((a.x + (b.x - a.x) * t) * U, (a.y + (b.y - a.y) * t) * U, (a.x + (b.x - a.x) * (1 - t)) * U, (a.y + (b.y - a.y) * (1 - t)) * U, color(p), U)}</g>`,
    );
  });
  // Ships.
  (v.sea?.ships ?? []).forEach((p, e) => {
    if (p == null) return;
    const E = g.edges[e]!;
    const a = g.verts[E.a]!;
    const b = g.verts[E.b]!;
    out.push(
      `<g class="ipiece" data-ship="${e}">${shipSVG(((a.x + b.x) / 2) * U, ((a.y + b.y) / 2) * U, 0, color(p), 1.3 * U)}</g>`,
    );
  });
  if ((v.board.pirate ?? -1) >= 0) {
    const h = g.hexes[v.board.pirate!]!;
    out.push(pirateSVG(h.x * U, h.y * U, 1.35 * U));
  }
  // City walls under their cities.
  for (const w of v.ck?.walls ?? []) {
    const V = g.verts[w]!;
    out.push(wallSVG(V.x * U, V.y * U, 1.4 * U));
  }
  // Buildings, back to front.
  const blds = v.verts.flatMap((b, i) => (b ? [{ b, i, V: g.verts[i]! }] : [])).sort((a, b) => a.V.y - b.V.y);
  for (const { b, i, V } of blds)
    out.push(
      `<g class="ipiece" data-building="${i}" data-kind="${b[1] === 2 ? 'city' : 'settlement'}">${b[1] === 2 ? citySVG(V.x * U, V.y * U, color(b[0]), 1.4 * U) : settlementSVG(V.x * U, V.y * U, color(b[0]), 1.45 * U)}</g>`,
    );
  v.ck?.knights.forEach((k, i) => {
    if (!k) return;
    const V = g.verts[i]!;
    out.push(
      `<g class="ipiece" data-knight="${i}">${knightSVG(V.x * U, V.y * U, color(k.p), k.lvl, k.on, 1.3 * U)}</g>`,
    );
  });
  if (v.board.robber >= 0) {
    const h = g.hexes[v.board.robber]!;
    out.push(robberSVG(h.x * U - 0.48 * U, h.y * U + 0.02 * U, 1.5 * U));
  }
  return out.join('');
}

/** The island's box in board pixels. */
function islandBox(v: PlayerView, g: Geometry) {
  const land = v.board.hexes.flatMap((h, i) => (h.t !== 'sea' ? [g.hexes[i]!] : []));
  const xs = land.map((h) => h.x * U);
  const ys = land.map((h) => h.y * U);
  const m = 1.15 * U;
  return {
    x: Math.min(...xs) - m,
    y: Math.min(...ys) - m,
    w: Math.max(...xs) - Math.min(...xs) + 2 * m,
    h: Math.max(...ys) - Math.min(...ys) + 2 * m,
  };
}

export interface Glow {
  verts?: number[];
  edges?: number[];
  hexes?: number[];
}

export function IsleBoard({
  v,
  insets,
  hot,
  glow,
  extra,
}: {
  v: PlayerView;
  insets: Insets;
  /** The number just rolled: its tiles hop and its tokens shine. */
  hot?: number | null;
  glow?: Glow;
  /** Anything else to draw over the pieces (ghost pieces, effects). */
  extra?: string;
}) {
  const g = geometryFor(v.board.hexes);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const box = useMemo(() => islandBox(v, g), [g]);
  const sw = Math.max(50, size.w - insets.left - insets.right);
  const sh = Math.max(50, size.h - insets.top - insets.bottom);
  const k = Math.min(sw / box.w, sh / box.h);
  const vb = [
    box.x - (insets.left + (sw - box.w * k) / 2) / k,
    box.y - (insets.top + (sh - box.h * k) / 2) / k,
    size.w / k,
    size.h / k,
  ];
  const stat = useMemo(() => staticSVG(v, g), [g, v.board]);
  const toks = tokensSVG(v, g);
  const pcs = piecesSVG(v, g);
  const glows: string[] = [];
  for (const h of glow?.hexes ?? []) {
    const H = g.hexes[h]!;
    glows.push(`<path class="iglow-hex" d="${rhex(H.x * U, H.y * U, 0.9 * U, 0.12 * U)}"/>`);
  }
  for (const e of glow?.edges ?? []) {
    const E = g.edges[e]!;
    const a = g.verts[E.a]!;
    const b = g.verts[E.b]!;
    glows.push(
      `<line class="iglow-edge" x1="${f2((a.x + (b.x - a.x) * 0.22) * U)}" y1="${f2((a.y + (b.y - a.y) * 0.22) * U)}" x2="${f2((a.x + (b.x - a.x) * 0.78) * U)}" y2="${f2((a.y + (b.y - a.y) * 0.78) * U)}"/>`,
    );
  }
  for (const x of glow?.verts ?? []) {
    const V = g.verts[x]!;
    glows.push(
      `<g class="iglow-vert"><circle cx="${f2(V.x * U)}" cy="${f2(V.y * U)}" r="${f2(0.2 * U)}" class="ring"/><circle cx="${f2(V.x * U)}" cy="${f2(V.y * U)}" r="${f2(0.09 * U)}" class="dot"/></g>`,
    );
  }
  return (
    <div className="isleboard" ref={wrap} data-hot={hot ?? undefined}>
      <svg
        viewBox={vb.map((n) => n.toFixed(1)).join(' ')}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="The island"
      >
        <g dangerouslySetInnerHTML={{ __html: stat }} />
        <g dangerouslySetInnerHTML={{ __html: toks }} />
        <g dangerouslySetInnerHTML={{ __html: pcs }} />
        <g dangerouslySetInnerHTML={{ __html: glows.join('') + (extra ?? '') }} />
      </svg>
      <style>
        {hot
          ? `.isleboard .itile:is(${v.board.hexes.flatMap((h, i) => (h.n === hot ? [`[data-h="${i}"]`] : [])).join(',') || '.none'}){animation:ihop .6s cubic-bezier(.3,1.6,.5,1) 2} .isleboard .itoken:is(${v.board.hexes.flatMap((h, i) => (h.n === hot ? [`[data-token="${i}"]`] : [])).join(',') || '.none'}){animation:ipop .7s cubic-bezier(.3,1.6,.5,1) 2}`
          : ''}
      </style>
    </div>
  );
}

export { OUTLINE, ICOL };
