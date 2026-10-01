/* The board, drawn as SVG strings like the prototype, with click targets for legal spots. */

import { useMemo, useRef } from 'react';
import { geometryFor, type Board as BoardData, type Geometry, type PlayerView } from '@settlers/engine';
import {
  GLYPH,
  K,
  PCOL,
  RES_LABEL,
  TILE_COLOR,
  TRACK_COLOR,
  cityPath,
  f1,
  hexPts,
  settlementPath,
} from './art';

export interface Targets {
  verts: number[];
  edges: number[];
  hexes: number[];
  /** Selected setup corner, drawn as a ghost settlement. */
  ghost: number | null;
  dimVerts?: boolean;
  /** A ship being moved, drawn highlighted. */
  ghostEdge?: number | null;
  /** A knight being moved, drawn highlighted. */
  ghostVert?: number | null;
}

export const NO_TARGETS: Targets = { verts: [], edges: [], hexes: [], ghost: null };

/** The live board SVG, used to place flying cards over hexes. */
export const boardRef: { svg: SVGSVGElement | null; geo: Geometry | null } = { svg: null, geo: null };

export function hexScreenPoint(h: number): { x: number; y: number } | null {
  const { svg, geo } = boardRef;
  const hex = geo?.hexes[h];
  const ctm = svg?.getScreenCTM();
  if (!svg || !hex || !ctm) return null;
  const p = svg.createSVGPoint();
  p.x = hex.x * K;
  p.y = hex.y * K;
  const s = p.matrixTransform(ctm);
  return { x: s.x, y: s.y };
}

function viewBox(g: Geometry): number[] {
  const xs = g.verts.map((v) => v.x);
  const ys = g.verts.map((v) => v.y);
  const m = 1.25;
  const x0 = Math.min(...xs) - m;
  const y0 = Math.min(...ys) - m;
  return [x0 * K, y0 * K, (Math.max(...xs) + m - x0) * K, (Math.max(...ys) + m - y0) * K];
}

const DECOR = [[-90, 0.6], [-30, 0.6], [30, 0.6], [90, 0.62], [150, 0.6], [210, 0.6]] as const; // prettier-ignore

function staticSVG(board: BoardData, g: Geometry, vb: number[]): string {
  const out: string[] = [];
  out.push(`<defs>
    <pattern id="waves" width="54" height="26" patternUnits="userSpaceOnUse"><path d="M2 15q12.5-9 25 0t25 0" fill="none" stroke="#2a7183" stroke-width="2" stroke-linecap="round" opacity=".55"/></pattern>
    ${Object.entries(GLYPH)
      .map(([k, v]) => `<symbol id="g-${k}" viewBox="-12 -12 24 24">${v}</symbol>`)
      .join('')}
    <radialGradient id="tokshade" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadfc2"/></radialGradient>
  </defs>`);
  const sea = `x="${vb[0]! + 2}" y="${vb[1]! + 2}" width="${vb[2]! - 4}" height="${vb[3]! - 4}" rx="${0.45 * K}"`;
  out.push(
    `<rect ${sea} fill="#12404f"/><rect ${sea} fill="url(#waves)"/><rect ${sea} fill="none" stroke="#1d5767" stroke-width="2"/>`,
  );
  // Beaches under land only; sea hexes are open water.
  const landHexes = g.hexes.filter((_, i) => board.hexes[i]!.t !== 'sea');
  for (const h of landHexes)
    out.push(`<polygon points="${hexPts(h.x * K, h.y * K, 1.1 * K)}" fill="#d9c69a"/>`);
  for (const h of landHexes)
    out.push(`<polygon points="${hexPts(h.x * K, h.y * K, 1.035 * K)}" fill="#c9b382"/>`);
  for (const pt of board.ports) {
    const e = g.edges[pt.e]!;
    const a = g.verts[e.a]!;
    const b = g.verts[e.b]!;
    // Point the harbor away from its land hex, towards the water.
    const h = g.hexes[e.hexes.find((x) => board.hexes[x]!.t !== 'sea') ?? e.hexes[0]!]!;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const L = Math.hypot(mx - h.x, my - h.y);
    const px = (mx + ((mx - h.x) / L) * 0.66) * K;
    const py = (my + ((my - h.y) / L) * 0.66) * K;
    for (const v of [a, b]) {
      const x1 = v.x * K;
      const y1 = v.y * K;
      const x2 = f1(x1 + (px - x1) * 0.62);
      const y2 = f1(y1 + (py - y1) * 0.62);
      out.push(
        `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${x2}" y2="${y2}" stroke="#7a5a37" stroke-width="7" stroke-linecap="round"/>`,
      );
      out.push(
        `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${x2}" y2="${y2}" stroke="#a9845a" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 4"/>`,
      );
    }
    if (pt.t === 'any') {
      out.push(
        `<g><title>3:1 port, any resource</title><circle cx="${f1(px)}" cy="${f1(py)}" r="${0.3 * K}" fill="#f4ecd6" stroke="#0a1b23" stroke-width="2.5"/><text x="${f1(px)}" y="${f1(py)}" text-anchor="middle" dominant-baseline="central" font-size="${0.2 * K}" fill="#1b2a30">3:1</text></g>`,
      );
    } else {
      out.push(
        `<g><title>2:1 ${RES_LABEL[pt.t].toLowerCase()} port</title><circle cx="${f1(px)}" cy="${f1(py)}" r="${0.32 * K}" fill="${TILE_COLOR[pt.t]}" stroke="#0a1b23" stroke-width="2.5"/><use href="#g-${pt.t}" x="${f1(px - 0.2 * K)}" y="${f1(py - 0.27 * K)}" width="${0.4 * K}" height="${0.4 * K}"/><text x="${f1(px)}" y="${f1(py + 0.19 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${0.15 * K}" fill="#10181c" font-weight="700">2:1</text></g>`,
      );
    }
  }
  board.hexes.forEach((hx, i) => {
    const h = g.hexes[i]!;
    const cx = h.x * K;
    const cy = h.y * K;
    if (hx.t === 'sea') {
      // A faint outline so you can see where the pirate can go.
      out.push(
        `<polygon points="${hexPts(cx, cy, 0.97 * K)}" fill="rgba(255,255,255,.025)" stroke="rgba(160,215,225,.16)" stroke-width="1.5" data-sea="${i}"/>`,
      );
      return;
    }
    if (hx.t === 'fog') {
      out.push(
        `<polygon points="${hexPts(cx, cy, 0.965 * K)}" fill="${TILE_COLOR.fog}" stroke="rgba(10,27,35,.35)" stroke-width="2" data-fog="${i}"/>`,
      );
      out.push(
        `<use href="#g-fog" x="${f1(cx - 0.45 * K)}" y="${f1(cy - 0.45 * K)}" width="${f1(0.9 * K)}" height="${f1(0.9 * K)}" opacity=".85"/>`,
      );
      out.push(
        `<text x="${f1(cx)}" y="${f1(cy + 0.55 * K)}" text-anchor="middle" font-size="${0.17 * K}" fill="#e8eef0" opacity=".8">?</text>`,
      );
      return;
    }
    out.push(
      `<polygon points="${hexPts(cx, cy, 0.965 * K)}" fill="${TILE_COLOR[hx.t]}" stroke="rgba(10,27,35,.35)" stroke-width="2"/>`,
    );
    out.push(
      hx.t === 'gold'
        ? `<polygon points="${hexPts(cx, cy, 0.86 * K)}" fill="none" stroke="#ffe27a" stroke-width="3" opacity=".75"/>`
        : `<polygon points="${hexPts(cx, cy, 0.8 * K)}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>`,
    );
    DECOR.forEach(([ang, rad], j) => {
      if ((i + j) % 6 === 2) return;
      const a = (Math.PI / 180) * ang;
      const s = (hx.t === 'ore' ? 0.42 : hx.t === 'desert' ? 0.36 : hx.t === 'gold' ? 0.38 : 0.34) * K;
      out.push(
        `<use href="#g-${hx.t}" x="${f1(cx + Math.cos(a) * rad * K - s / 2)}" y="${f1(cy + Math.sin(a) * rad * K - s / 2)}" width="${f1(s)}" height="${f1(s)}" opacity="${hx.t === 'desert' ? 0.7 : 0.85}"/>`,
      );
    });
  });
  return out.join('');
}

function tokenSVG(g: Geometry, i: number, n: number, hot: boolean, blocked: boolean): string {
  if (!n) return '';
  const h = g.hexes[i]!;
  const cx = h.x * K;
  const cy = h.y * K;
  const red = n === 6 || n === 8;
  const pips = 6 - Math.abs(7 - n);
  let dots = '';
  for (let k = 0; k < pips; k++) {
    const x = cx + (k - (pips - 1) / 2) * 0.085 * K;
    dots += `<circle cx="${f1(x)}" cy="${f1(cy + 0.19 * K)}" r="${0.032 * K}" fill="${red ? '#b3261e' : '#28343a'}"/>`;
  }
  return `<g opacity="${blocked ? 0.5 : 1}" data-token="${i}">${hot ? `<circle class="hotring" cx="${f1(cx)}" cy="${f1(cy)}" r="${0.44 * K}"/>` : ''}<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${0.34 * K}" fill="url(#tokshade)" stroke="rgba(10,27,35,.45)" stroke-width="2"/><text x="${f1(cx)}" y="${f1(cy - 0.03 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${(n >= 10 ? 0.27 : 0.31) * K}" fill="${red ? '#b3261e' : '#1d2a30'}">${n}</text>${dots}</g>`;
}

function robberSVG(g: Geometry, i: number): string {
  const h = g.hexes[i]!;
  const x = (h.x - 0.52) * K;
  const y = (h.y + 0.02) * K;
  return `<g class="piece" data-robber="${i}"><ellipse cx="${f1(x)}" cy="${f1(y + 0.3 * K)}" rx="${0.19 * K}" ry="${0.06 * K}" fill="rgba(0,0,0,.35)"/><path d="M${f1(x - 0.16 * K)} ${f1(y + 0.29 * K)}Q${f1(x - 0.17 * K)} ${f1(y - 0.02 * K)} ${f1(x)} ${f1(y - 0.07 * K)}Q${f1(x + 0.17 * K)} ${f1(y - 0.02 * K)} ${f1(x + 0.16 * K)} ${f1(y + 0.29 * K)}Z" fill="#20242b" stroke="#efe7d2" stroke-width="2.2"/><circle cx="${f1(x)}" cy="${f1(y - 0.17 * K)}" r="${0.105 * K}" fill="#20242b" stroke="#efe7d2" stroke-width="2.2"/></g>`;
}

/** A small boat on an edge, pointing along it. */
function shipSVG(g: Geometry, e: number, color: string, isFresh: boolean, lifted: boolean): string {
  const E = g.edges[e]!;
  const a = g.verts[E.a]!;
  const b = g.verts[E.b]!;
  const x = ((a.x + b.x) / 2) * K;
  const y = ((a.y + b.y) / 2) * K;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const u = 0.11 * K;
  return `<g class="piece${isFresh ? ' fresh' : ''}" data-ship="${e}" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)})"${lifted ? ' opacity=".45"' : ''}>
    <path d="M${f1(-2.6 * u)} ${f1(-0.2 * u)}L${f1(2.6 * u)} ${f1(-0.2 * u)}L${f1(1.7 * u)} ${f1(1.1 * u)}L${f1(-1.7 * u)} ${f1(1.1 * u)}Z" fill="${color}" stroke="#0b1418" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M${f1(-0.1 * u)} ${f1(-0.3 * u)}V${f1(-2.4 * u)}L${f1(1.5 * u)} ${f1(-0.6 * u)}Z" fill="#f4ecd6" stroke="#0b1418" stroke-width="1.6" stroke-linejoin="round"/>
  </g>`;
}

function pirateSVG(g: Geometry, i: number): string {
  const h = g.hexes[i]!;
  const x = h.x * K;
  const y = h.y * K;
  const u = 0.13 * K;
  return `<g class="piece" data-pirate="${i}" transform="translate(${f1(x)} ${f1(y)})">
    <ellipse cx="0" cy="${f1(1.5 * u)}" rx="${f1(3 * u)}" ry="${f1(0.6 * u)}" fill="rgba(0,0,0,.35)"/>
    <path d="M${f1(-3 * u)} 0L${f1(3 * u)} 0L${f1(2 * u)} ${f1(1.5 * u)}L${f1(-2 * u)} ${f1(1.5 * u)}Z" fill="#20242b" stroke="#efe7d2" stroke-width="2"/>
    <path d="M${f1(-0.2 * u)} ${f1(-0.1 * u)}V${f1(-3.2 * u)}L${f1(2 * u)} ${f1(-0.8 * u)}Z" fill="#20242b" stroke="#efe7d2" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${f1(0.8 * u)}" cy="${f1(-1.6 * u)}" r="${f1(0.35 * u)}" fill="#efe7d2"/>
  </g>`;
}

/** A knight: a shield in the owner's colour with one pip per strength; gold ring when active. */
function knightSVG(
  g: Geometry,
  v: number,
  color: string,
  lvl: number,
  on: boolean,
  owner: number,
  isFresh: boolean,
  lifted: boolean,
): string {
  const V = g.verts[v]!;
  const x = V.x * K;
  const y = V.y * K;
  const r = 0.19 * K;
  let pips = '';
  for (let i = 0; i < lvl; i++) {
    const px = x + (i - (lvl - 1) / 2) * 0.1 * K;
    pips += `<circle cx="${f1(px)}" cy="${f1(y + 0.02 * K)}" r="${f1(0.035 * K)}" fill="#0b1418"/>`;
  }
  return `<g class="piece knight${isFresh ? ' fresh' : ''}" data-knight="${v}" data-owner="${owner}" data-lvl="${lvl}" data-on="${on ? 1 : 0}"${lifted ? ' opacity=".45"' : on ? '' : ' opacity=".8"'}>${on ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r + 0.07 * K)}" fill="none" stroke="#ffd54a" stroke-width="${f1(0.05 * K)}"/>` : ''}<path d="M${f1(x - r)} ${f1(y - r * 0.75)}Q${f1(x)} ${f1(y - r * 1.15)} ${f1(x + r)} ${f1(y - r * 0.75)}V${f1(y + r * 0.1)}Q${f1(x + r)} ${f1(y + r * 0.9)} ${f1(x)} ${f1(y + r * 1.15)}Q${f1(x - r)} ${f1(y + r * 0.9)} ${f1(x - r)} ${f1(y + r * 0.1)}Z" fill="${color}" stroke="${on ? '#3b2a00' : '#0b1418'}" stroke-width="2.2"/>${pips}</g>`;
}

/** The merchant: a small figure in the owner's colour on its tile. */
function merchantSVG(g: Geometry, h: number, color: string): string {
  const H = g.hexes[h]!;
  const x = (H.x + 0.5) * K;
  const y = (H.y - 0.05) * K;
  const u = 0.1 * K;
  return `<g class="piece" data-merchant="${h}"><ellipse cx="${f1(x)}" cy="${f1(y + 2.6 * u)}" rx="${f1(1.6 * u)}" ry="${f1(0.5 * u)}" fill="rgba(0,0,0,.3)"/><path d="M${f1(x - 1.4 * u)} ${f1(y + 2.5 * u)}L${f1(x)} ${f1(y - 1.2 * u)}L${f1(x + 1.4 * u)} ${f1(y + 2.5 * u)}Z" fill="${color}" stroke="#0b1418" stroke-width="2"/><circle cx="${f1(x)}" cy="${f1(y - 1.6 * u)}" r="${f1(0.8 * u)}" fill="#f4ecd6" stroke="#0b1418" stroke-width="1.6"/><path d="M${f1(x - 1.3 * u)} ${f1(y - 2.2 * u)}h${f1(2.6 * u)}" stroke="#0b1418" stroke-width="2.4" stroke-linecap="round"/></g>`;
}

function roadLine(g: Geometry, e: number, inset: number) {
  const E = g.edges[e]!;
  const a = g.verts[E.a]!;
  const b = g.verts[E.b]!;
  return {
    x1: f1((a.x + (b.x - a.x) * inset) * K),
    y1: f1((a.y + (b.y - a.y) * inset) * K),
    x2: f1((a.x + (b.x - a.x) * (1 - inset)) * K),
    y2: f1((a.y + (b.y - a.y) * (1 - inset)) * K),
  };
}

export function Board(props: {
  view: PlayerView;
  targets: Targets;
  myColor: string | null;
  onVert: (v: number) => void;
  onEdge: (e: number) => void;
  onHex: (h: number) => void;
}) {
  const { view, targets } = props;
  const g = geometryFor(view.board.hexes);
  const vb = useMemo(() => viewBox(g), [g]);
  // Hexes change when fog is discovered, so the key includes their terrain.
  const hexKey = view.board.hexes.map((h) => `${h.t}${h.n}`).join(',');
  const staticHtml = useMemo(() => staticSVG(view.board, g, vb), [hexKey, view.board.ports, g, vb]);
  const seen = useRef<Set<string> | null>(null);

  const sum = view.dice ? view.dice[0] + view.dice[1] : 0;
  const hot = view.dice && ['main', 'discard', 'robber', 'roads'].includes(view.stage) && sum !== 7 ? sum : 0;
  const parts: string[] = [];
  view.board.hexes.forEach((hx, i) =>
    parts.push(tokenSVG(g, i, hx.n, hot > 0 && hx.n === hot, i === view.board.robber)),
  );

  const now = new Set<string>();
  const first = seen.current == null;
  const fresh = (key: string) => {
    now.add(key);
    return !first && !seen.current!.has(key);
  };
  view.edges.forEach((p, e) => {
    if (p == null) return;
    const l = roadLine(g, e, 0.16);
    const col = PCOL[view.players[p]!.color];
    parts.push(
      `<g class="piece${fresh(`e${e}:${p}`) ? ' fresh' : ''}" data-road="${e}" data-owner="${p}"><line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#0b1418" stroke-width="${0.22 * K}" stroke-linecap="round"/><line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${col}" stroke-width="${0.13 * K}" stroke-linecap="round"/></g>`,
    );
  });
  const ships = view.sea?.ships ?? [];
  ships.forEach((p, e) => {
    if (p == null) return;
    parts.push(shipSVG(g, e, PCOL[view.players[p]!.color], fresh(`s${e}:${p}`), e === targets.ghostEdge));
  });
  if (view.board.robber >= 0) parts.push(robberSVG(g, view.board.robber));
  if ((view.board.pirate ?? -1) >= 0) parts.push(pirateSVG(g, view.board.pirate!));
  const ck = view.ck;
  if (ck?.merchant) parts.push(merchantSVG(g, ck.merchant.h, PCOL[view.players[ck.merchant.p]!.color]));
  // City walls sit under their cities.
  for (const v of ck?.walls ?? []) {
    const V = g.verts[v]!;
    const x = V.x * K;
    const y = V.y * K;
    parts.push(
      `<rect class="piece" data-wall="${v}" x="${f1(x - 0.34 * K)}" y="${f1(y + 0.08 * K)}" width="${f1(0.68 * K)}" height="${f1(0.16 * K)}" rx="${f1(0.03 * K)}" fill="#8b8172" stroke="#0b1418" stroke-width="2"/>`,
    );
  }
  view.verts.forEach((b, v) => {
    if (!b) return;
    const V = g.verts[v]!;
    const d = b[1] === 2 ? cityPath(V.x * K, V.y * K) : settlementPath(V.x * K, V.y * K);
    parts.push(
      `<path class="piece${fresh(`v${v}:${b.join(',')}`) ? ' fresh' : ''}" data-building="${v}" data-owner="${b[0]}" data-kind="${b[1] === 2 ? 'city' : 'settlement'}" d="${d}" fill="${PCOL[view.players[b[0]]!.color]}" stroke="#0b1418" stroke-width="2.6" stroke-linejoin="round"/>`,
    );
  });
  if (ck) {
    // Metropolises: a tower in the track's colour on top of the city.
    for (const [t, v] of Object.entries(ck.metro)) {
      if (v == null) continue;
      const V = g.verts[v]!;
      const x = V.x * K;
      const y = V.y * K;
      parts.push(
        `<g class="piece" data-metro="${t}" data-at="${v}"><rect x="${f1(x - 0.24 * K)}" y="${f1(y - 0.52 * K)}" width="${f1(0.16 * K)}" height="${f1(0.32 * K)}" fill="${TRACK_COLOR[t as 'trade']}" stroke="#0b1418" stroke-width="2"/><path d="M${f1(x - 0.27 * K)} ${f1(y - 0.52 * K)}L${f1(x - 0.16 * K)} ${f1(y - 0.66 * K)}L${f1(x - 0.05 * K)} ${f1(y - 0.52 * K)}Z" fill="${TRACK_COLOR[t as 'trade']}" stroke="#0b1418" stroke-width="2" stroke-linejoin="round"/></g>`,
      );
    }
    ck.knights.forEach((k, v) => {
      if (!k) return;
      parts.push(
        knightSVG(
          g,
          v,
          PCOL[view.players[k.p]!.color],
          k.lvl,
          k.on,
          k.p,
          fresh(`k${v}:${k.p}:${k.lvl}`),
          v === targets.ghostVert,
        ),
      );
    });
  }
  seen.current = now;

  if (targets.ghost != null && props.myColor) {
    const V = g.verts[targets.ghost]!;
    parts.push(
      `<path class="ghost" d="${settlementPath(V.x * K, V.y * K)}" fill="${props.myColor}" stroke="#fff6dc" stroke-width="2.6" stroke-linejoin="round"/>`,
    );
  }
  for (const h of targets.hexes) {
    const H = g.hexes[h]!;
    parts.push(
      `<g class="target" data-h="${h}"><polygon class="hit" points="${hexPts(H.x * K, H.y * K, 0.97 * K)}"/><polygon class="hexglow" points="${hexPts(H.x * K, H.y * K, 0.86 * K)}"/></g>`,
    );
  }
  for (const e of targets.edges) {
    const l = roadLine(g, e, 0.2);
    parts.push(
      `<g class="target" data-e="${e}"><circle class="hit" cx="${f1((l.x1 + l.x2) / 2)}" cy="${f1((l.y1 + l.y2) / 2)}" r="${0.24 * K}"/><line class="hit" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${0.44 * K}" stroke-linecap="round"/><line class="eback" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/><line class="espot" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/></g>`,
    );
  }
  for (const v of targets.verts) {
    const V = g.verts[v]!;
    parts.push(
      `<g class="target" data-v="${v}"${targets.dimVerts ? ' opacity=".4"' : ''}><circle class="hit" cx="${f1(V.x * K)}" cy="${f1(V.y * K)}" r="${0.36 * K}"/><circle class="ring" cx="${f1(V.x * K)}" cy="${f1(V.y * K)}" r="${0.2 * K}"/><circle class="spot" cx="${f1(V.x * K)}" cy="${f1(V.y * K)}" r="${0.1 * K}"/></g>`,
    );
  }

  const onClick = (ev: React.MouseEvent) => {
    const el = (ev.target as Element).closest('[data-v],[data-e],[data-h]') as
      HTMLElement | SVGElement | null;
    if (!el) return;
    const d = el.dataset;
    if (d.v != null) props.onVert(Number(d.v));
    else if (d.e != null) props.onEdge(Number(d.e));
    else if (d.h != null) props.onHex(Number(d.h));
  };

  return (
    <svg
      id="board"
      viewBox={vb.join(' ')}
      role="img"
      aria-label="Island board"
      ref={(el) => {
        boardRef.svg = el;
        boardRef.geo = g;
      }}
      onClick={onClick}
    >
      <g dangerouslySetInnerHTML={{ __html: staticHtml }} />
      <g dangerouslySetInnerHTML={{ __html: parts.join('') }} />
    </svg>
  );
}
