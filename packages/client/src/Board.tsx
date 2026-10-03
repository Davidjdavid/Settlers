/* The board, drawn as SVG strings like the prototype, with click targets for legal spots. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  geometryFor,
  type Board as BoardData,
  type Geometry,
  type PlayerView,
  type Track,
} from '@settlers/engine';
import {
  GLYPH,
  K,
  PCOL,
  PEDGE,
  RES_LABEL,
  TILE_COLOR,
  TRACK_COLOR,
  cityPath,
  edgeOf,
  f1,
  gateSVG,
  hexPts,
  settlementPath,
} from './art';
import { spotAt, spotLabel, spotsOf, type Spot } from './boardinfo';

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
  /** Spots you can tap to act on with nothing chosen (no glow): your pieces and where you can build. */
  tapVerts?: number[];
  tapEdges?: number[];
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

export function viewBox(g: Geometry): number[] {
  const xs = g.verts.map((v) => v.x);
  const ys = g.verts.map((v) => v.y);
  const m = 1.25;
  const x0 = Math.min(...xs) - m;
  const y0 = Math.min(...ys) - m;
  return [x0 * K, y0 * K, (Math.max(...xs) + m - x0) * K, (Math.max(...ys) + m - y0) * K];
}

/** Shared SVG definitions (wave pattern, tile glyphs, token shading) and the sea behind the board. */
export function seaSVG(vb: number[]): string {
  const sea = `x="${vb[0]! + 2}" y="${vb[1]! + 2}" width="${vb[2]! - 4}" height="${vb[3]! - 4}" rx="${0.45 * K}"`;
  return `<defs>
    <pattern id="waves" width="54" height="26" patternUnits="userSpaceOnUse"><path d="M2 15q12.5-9 25 0t25 0" fill="none" stroke="#2a7183" stroke-width="2" stroke-linecap="round" opacity=".55"/></pattern>
    ${Object.entries(GLYPH)
      .map(([k, v]) => `<symbol id="g-${k}" viewBox="-12 -12 24 24">${v}</symbol>`)
      .join('')}
    <radialGradient id="tokshade" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadfc2"/></radialGradient>
  </defs><rect ${sea} fill="#12404f"/><rect ${sea} fill="url(#waves)"/><rect ${sea} fill="none" stroke="#1d5767" stroke-width="2"/>`;
}

/** Where a harbor's marker sits: off the middle of its side, away from its land hex. */
export function harborPoint(g: Geometry, e: number, land: number): { x: number; y: number } {
  const E = g.edges[e]!;
  const a = g.verts[E.a]!;
  const b = g.verts[E.b]!;
  const h = g.hexes[land]!;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const L = Math.hypot(mx - h.x, my - h.y);
  return { x: (mx + ((mx - h.x) / L) * 0.66) * K, y: (my + ((my - h.y) / L) * 0.66) * K };
}

/** The two piers from a harbor's corners to its marker. */
export function harborPiersSVG(g: Geometry, e: number, p: { x: number; y: number }): string {
  const E = g.edges[e]!;
  return [g.verts[E.a]!, g.verts[E.b]!]
    .map((v) => {
      const x1 = v.x * K;
      const y1 = v.y * K;
      const x2 = f1(x1 + (p.x - x1) * 0.62);
      const y2 = f1(y1 + (p.y - y1) * 0.62);
      return (
        `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${x2}" y2="${y2}" stroke="#7a5a37" stroke-width="7" stroke-linecap="round"/>` +
        `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${x2}" y2="${y2}" stroke="#a9845a" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 4"/>`
      );
    })
    .join('');
}

/** A harbor's marker: 3:1, or 2:1 with its resource. */
export function harborMarkSVG(t: string, p: { x: number; y: number }): string {
  const { x: px, y: py } = p;
  if (t === 'any')
    return `<g><title>3:1 port, any resource</title><circle cx="${f1(px)}" cy="${f1(py)}" r="${0.3 * K}" fill="#f4ecd6" stroke="#0a1b23" stroke-width="2.5"/><text x="${f1(px)}" y="${f1(py)}" text-anchor="middle" dominant-baseline="central" font-size="${0.2 * K}" fill="#1b2a30">3:1</text></g>`;
  const r = t as keyof typeof RES_LABEL;
  return `<g><title>2:1 ${RES_LABEL[r].toLowerCase()} port</title><circle cx="${f1(px)}" cy="${f1(py)}" r="${0.32 * K}" fill="${TILE_COLOR[r]}" stroke="#0a1b23" stroke-width="2.5"/><use href="#g-${r}" x="${f1(px - 0.2 * K)}" y="${f1(py - 0.27 * K)}" width="${0.4 * K}" height="${0.4 * K}"/><text x="${f1(px)}" y="${f1(py + 0.19 * K)}" text-anchor="middle" dominant-baseline="central" font-size="${0.15 * K}" fill="#10181c" font-weight="700">2:1</text></g>`;
}

export const DECOR = [[-90, 0.6], [-30, 0.6], [30, 0.6], [90, 0.62], [150, 0.6], [210, 0.6]] as const; // prettier-ignore

function staticSVG(board: BoardData, g: Geometry, vb: number[], no3to1 = false): string {
  const out: string[] = [];
  out.push(seaSVG(vb));
  // Beaches under land only; sea hexes are open water.
  const landHexes = g.hexes.filter((_, i) => board.hexes[i]!.t !== 'sea');
  for (const h of landHexes)
    out.push(`<polygon points="${hexPts(h.x * K, h.y * K, 1.1 * K)}" fill="#d9c69a"/>`);
  for (const h of landHexes)
    out.push(`<polygon points="${hexPts(h.x * K, h.y * K, 1.035 * K)}" fill="#c9b382"/>`);
  // With "3:1 bank trades for everyone", 3:1 harbors would give nothing extra: not drawn (SPEC 8.11 D5).
  board.ports.forEach((pt, i) => {
    if (no3to1 && pt.t === 'any') return;
    const e = g.edges[pt.e]!;
    // Point the harbor away from its land hex, towards the water.
    const land = e.hexes.find((x) => board.hexes[x]!.t !== 'sea') ?? e.hexes[0]!;
    const p = harborPoint(g, pt.e, land);
    out.push(harborPiersSVG(g, pt.e, p));
    out.push(`<g data-port="${i}">${harborMarkSVG(pt.t, p)}</g>`);
  });
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

export function tokenSVG(g: Geometry, i: number, n: number, hot: boolean, blocked: boolean): string {
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

/** A face-down treasure (docs/rules/treasures.md): a small chest at the middle of its path. */
export function treasureSVG(g: Geometry, e: number): string {
  const E = g.edges[e]!;
  const a = g.verts[E.a]!;
  const b = g.verts[E.b]!;
  const x = ((a.x + b.x) / 2) * K;
  const y = ((a.y + b.y) / 2) * K;
  const w = 0.4 * K;
  const h = 0.27 * K;
  return `<g class="treasure" data-treasure="${e}"><title>Treasure: the first road or ship here finds it</title><rect x="${f1(x - w / 2)}" y="${f1(y - h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="3" fill="#8a5a2b" stroke="#2a1a0c" stroke-width="2"/><path d="M${f1(x - w / 2)} ${f1(y - h / 2 + 0.08 * K)}H${f1(x + w / 2)}" stroke="#2a1a0c" stroke-width="1.8"/><rect x="${f1(x - 0.05 * K)}" y="${f1(y - 0.05 * K)}" width="${f1(0.1 * K)}" height="${f1(0.11 * K)}" fill="#ffd34d" stroke="#2a1a0c" stroke-width="1.2"/></g>`;
}

/** A small boat on an edge, pointing along it. */
function shipSVG(g: Geometry, e: number, color: string, isFresh: boolean, lifted: boolean): string {
  const E = g.edges[e]!;
  const a = g.verts[E.a]!;
  const b = g.verts[E.b]!;
  const x = ((a.x + b.x) / 2) * K;
  const y = ((a.y + b.y) / 2) * K;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const u = 0.125 * K;
  return `<g class="piece${isFresh ? ' fresh' : ''}" data-ship="${e}" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)})"${lifted ? ' opacity=".45"' : ''}>
    <path d="M${f1(-2.6 * u)} ${f1(-0.2 * u)}L${f1(2.6 * u)} ${f1(-0.2 * u)}L${f1(1.7 * u)} ${f1(1.1 * u)}L${f1(-1.7 * u)} ${f1(1.1 * u)}Z" fill="${color}" stroke="${edgeOf(color)}" stroke-width="2.2" stroke-linejoin="round"/>
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

/**
 * A knight: a shield in the owner's colour, bigger for each level, with its level (1, 2 or 3) on a
 * light badge; gold ring when active.
 */
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
  // Basic, strong and mighty knights differ in size, so a glance tells them apart.
  const r = [0.17, 0.17, 0.2, 0.23][lvl]! * K;
  const bx = x + r * 0.78;
  const by = y + r * 0.72;
  const badge = `<circle cx="${f1(bx)}" cy="${f1(by)}" r="${f1(0.095 * K)}" fill="#fff6dc" stroke="#0b1418" stroke-width="1.8"/><text x="${f1(bx)}" y="${f1(by)}" text-anchor="middle" dominant-baseline="central" font-size="${f1(0.13 * K)}" font-weight="800" fill="#0b1418" class="klvl">${lvl}</text>`;
  // Level by shape as well (SPEC 5.11): strong has a crest, mighty a crown.
  const top = y - r * 1.05;
  const crest =
    lvl === 2
      ? `<path d="M${f1(x - 0.05 * K)} ${f1(top)}Q${f1(x)} ${f1(top - 0.2 * K)} ${f1(x + 0.12 * K)} ${f1(top - 0.12 * K)}Q${f1(x + 0.04 * K)} ${f1(top - 0.06 * K)} ${f1(x + 0.05 * K)} ${f1(top)}Z" fill="${color}" stroke="${edgeOf(color)}" stroke-width="1.6"/>`
      : lvl === 3
        ? `<path d="M${f1(x - 0.13 * K)} ${f1(top + 0.02 * K)}L${f1(x - 0.13 * K)} ${f1(top - 0.14 * K)}L${f1(x - 0.065 * K)} ${f1(top - 0.06 * K)}L${f1(x)} ${f1(top - 0.17 * K)}L${f1(x + 0.065 * K)} ${f1(top - 0.06 * K)}L${f1(x + 0.13 * K)} ${f1(top - 0.14 * K)}L${f1(x + 0.13 * K)} ${f1(top + 0.02 * K)}Z" fill="#ffd54a" stroke="#3b2a00" stroke-width="1.6" stroke-linejoin="round"/>`
        : '';
  // An inactive knight fades; its level badge stays solid so it's still easy to read.
  return `<g class="piece knight${isFresh ? ' fresh' : ''}" data-knight="${v}" data-owner="${owner}" data-lvl="${lvl}" data-on="${on ? 1 : 0}"${lifted ? ' opacity=".45"' : ''}><g${!lifted && !on ? ' opacity=".55"' : ''}>${crest}${on ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r + 0.07 * K)}" fill="none" stroke="#ffd54a" stroke-width="${f1(0.05 * K)}"/>` : ''}<path d="M${f1(x - r)} ${f1(y - r * 0.75)}Q${f1(x)} ${f1(y - r * 1.15)} ${f1(x + r)} ${f1(y - r * 0.75)}V${f1(y + r * 0.1)}Q${f1(x + r)} ${f1(y + r * 0.9)} ${f1(x)} ${f1(y + r * 1.15)}Q${f1(x - r)} ${f1(y + r * 0.9)} ${f1(x - r)} ${f1(y + r * 0.1)}Z" fill="${color}" stroke="${on ? '#3b2a00' : edgeOf(color)}" stroke-width="2.2"/></g>${badge}</g>`;
}

/** The merchant: a small figure in the owner's colour on its tile. */
function merchantSVG(g: Geometry, h: number, color: string): string {
  const H = g.hexes[h]!;
  const x = (H.x + 0.5) * K;
  const y = (H.y - 0.05) * K;
  const u = 0.1 * K;
  return `<g class="piece" data-merchant="${h}"><ellipse cx="${f1(x)}" cy="${f1(y + 2.6 * u)}" rx="${f1(1.6 * u)}" ry="${f1(0.5 * u)}" fill="rgba(0,0,0,.3)"/><path d="M${f1(x - 1.4 * u)} ${f1(y + 2.5 * u)}L${f1(x)} ${f1(y - 1.2 * u)}L${f1(x + 1.4 * u)} ${f1(y + 2.5 * u)}Z" fill="${color}" stroke="${edgeOf(color)}" stroke-width="2"/><circle cx="${f1(x)}" cy="${f1(y - 1.6 * u)}" r="${f1(0.8 * u)}" fill="#f4ecd6" stroke="#0b1418" stroke-width="1.6"/><path d="M${f1(x - 1.3 * u)} ${f1(y - 2.2 * u)}h${f1(2.6 * u)}" stroke="#0b1418" stroke-width="2.4" stroke-linecap="round"/></g>`;
}

/** A city wall: a thick stone base with crenels, under the city. */
function wallPath(x: number, y: number): string {
  const l = x - 0.38 * K;
  const w = 0.76 * K;
  const b = y + 0.3 * K;
  const t = y + 0.1 * K;
  const c = 0.06 * K;
  let d = `M${f1(l)} ${f1(b)}V${f1(t)}`;
  for (let i = 0; i < 5; i++) {
    const x0 = l + (i * w) / 5;
    d += `H${f1(x0 + w / 10)}V${f1(t - c)}H${f1(x0 + w / 5)}V${f1(t)}`;
  }
  return `${d}V${f1(b)}Z`;
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

/** A see-through preview of a piece before it's placed (SPEC 4.3). */
export interface Ghost {
  kind:
    | 'settlement'
    | 'city'
    | 'road'
    | 'ship'
    | 'knight'
    | 'wall'
    | 'robber'
    | 'pirate'
    | 'merchant'
    /* A pick that places nothing new: a corner, an edge or a tile. */
    | 'mark'
    | 'markEdge'
    | 'markHex';
  at: number;
  /** A knight's level (the Smith shows its picks one level up). */
  lvl?: number;
}

function ghostSVG(g: Geometry, gh: Ghost, color: string, waiting: boolean): string {
  const V = g.verts[gh.at];
  let inner = '';
  switch (gh.kind) {
    case 'settlement':
    case 'city': {
      const d = gh.kind === 'city' ? cityPath(V!.x * K, V!.y * K) : settlementPath(V!.x * K, V!.y * K);
      inner = `<path d="${d}" fill="${color}" stroke="#fff6dc" stroke-width="2.6" stroke-linejoin="round"/>`;
      break;
    }
    case 'road': {
      const l = roadLine(g, gh.at, 0.16);
      inner = `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#fff6dc" stroke-width="${0.22 * K}" stroke-linecap="round"/><line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${color}" stroke-width="${0.13 * K}" stroke-linecap="round"/>`;
      break;
    }
    case 'ship':
      inner = shipSVG(g, gh.at, color, false, false);
      break;
    case 'knight':
      inner = knightSVG(g, gh.at, color, gh.lvl ?? 1, false, -1, false, false);
      break;
    case 'wall':
      inner = `<path d="${wallPath(V!.x * K, V!.y * K)}" fill="#8b8172" stroke="#fff6dc" stroke-width="2"/>`;
      break;
    case 'robber':
      inner = robberSVG(g, gh.at);
      break;
    case 'pirate':
      inner = pirateSVG(g, gh.at);
      break;
    case 'merchant':
      inner = merchantSVG(g, gh.at, color);
      break;
    case 'mark':
      inner = `<circle cx="${f1(V!.x * K)}" cy="${f1(V!.y * K)}" r="${f1(0.27 * K)}" fill="none" stroke="#fff6dc" stroke-width="${f1(0.07 * K)}"/>`;
      break;
    case 'markEdge': {
      const l = roadLine(g, gh.at, 0.16);
      inner = `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#fff6dc" stroke-width="${0.3 * K}" stroke-linecap="round" fill="none"/><line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${color}" stroke-width="${0.16 * K}" stroke-linecap="round"/>`;
      break;
    }
    case 'markHex': {
      const H = g.hexes[gh.at]!;
      inner = `<polygon points="${hexPts(H.x * K, H.y * K, 0.86 * K)}" fill="none" stroke="#fff6dc" stroke-width="${f1(0.08 * K)}"/><polygon points="${hexPts(H.x * K, H.y * K, 0.78 * K)}" fill="none" stroke="${color}" stroke-width="${f1(0.06 * K)}"/>`;
      break;
    }
  }
  // No data-* inside, so the hit test never mistakes a preview for a piece.
  return `<g class="ghost${waiting ? ' waiting' : ''}" data-ghost="${gh.kind}" data-ghost-at="${gh.at}" opacity=".62" pointer-events="none">${inner.replace(/ data-[a-z]+="[^"]*"/g, '')}</g>`;
}

/** Was this tap from a finger or pen rather than a mouse? */
export function isTouch(ev: React.MouseEvent): boolean {
  const t = (ev.nativeEvent as PointerEvent).pointerType;
  if (t) return t !== 'mouse';
  return window.matchMedia?.('(hover: none)').matches ?? false;
}

export function Board(props: {
  view: PlayerView;
  targets: Targets;
  myColor: string | null;
  onVert: (v: number, touch: boolean) => void;
  onEdge: (e: number, touch: boolean) => void;
  onHex: (h: number, touch: boolean) => void;
  /** What pointing at a spot would place there, drawn as a see-through preview. */
  preview?: (t: 'v' | 'e' | 'h', id: number) => Ghost[];
  /** Pieces waiting for Confirm. */
  pending?: Ghost[];
  /** Corners to draw attention to (a city just lost to the barbarians, SPEC 9.2). */
  flash?: number[];
}) {
  const { view, targets } = props;
  const [hover, setHover] = useState<string | null>(null);
  const g = geometryFor(view.board.hexes);
  const vb = useMemo(() => viewBox(g), [g]);
  const zoom = useZoom(vb);
  // Hexes change when fog is discovered, so the key includes their terrain.
  const hexKey = view.board.hexes.map((h) => `${h.t}${h.n}`).join(',');
  const no3to1 = !!view.rules.houseRules.bank3to1;
  const staticHtml = useMemo(
    () => staticSVG(view.board, g, vb, no3to1),
    [hexKey, view.board.ports, g, vb, no3to1],
  );
  const seen = useRef<Set<string> | null>(null);
  // Hover and press-and-hold labels (SPEC 8.3): the piece, and where its top is in the box.
  const wrap = useRef<HTMLDivElement | null>(null);
  const [info, setInfo] = useState<{ key: string; x: number; y: number; below: boolean } | null>(null);
  const hold = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const held = useRef(false);
  useEffect(
    () => () => {
      if (hold.current) window.clearTimeout(hold.current.timer);
    },
    [],
  );
  const spots = spotsOf(view, g, no3to1);

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
  for (const e of view.tr?.spots ?? []) parts.push(treasureSVG(g, e));
  view.edges.forEach((p, e) => {
    if (p == null) return;
    const l = roadLine(g, e, 0.16);
    const col = PCOL[view.players[p]!.color];
    parts.push(
      `<g class="piece${fresh(`e${e}:${p}`) ? ' fresh' : ''}" data-road="${e}" data-owner="${p}"><line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${edgeOf(col)}" stroke-width="${0.22 * K}" stroke-linecap="round"/><line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${col}" stroke-width="${0.13 * K}" stroke-linecap="round"/></g>`,
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
      `<path class="piece" data-wall="${v}" d="${wallPath(x, y)}" fill="#8b8172" stroke="#0b1418" stroke-width="2" stroke-linejoin="round"/>`,
    );
  }
  view.verts.forEach((b, v) => {
    if (!b) return;
    const V = g.verts[v]!;
    const d = b[1] === 2 ? cityPath(V.x * K, V.y * K) : settlementPath(V.x * K, V.y * K);
    parts.push(
      `<path class="piece${fresh(`v${v}:${b.join(',')}`) ? ' fresh' : ''}" data-building="${v}" data-owner="${b[0]}" data-kind="${b[1] === 2 ? 'city' : 'settlement'}" d="${d}" fill="${PCOL[view.players[b[0]]!.color]}" stroke="${PEDGE(view.players[b[0]]!.color)}" stroke-width="2.6" stroke-linejoin="round"/>`,
    );
  });
  if (ck) {
    // Metropolises: a golden gate on the city, its banner in the track's colour (SPEC 8.2).
    for (const [t, v] of Object.entries(ck.metro)) {
      if (v == null) continue;
      const V = g.verts[v]!;
      parts.push(
        `<g class="piece" data-metro="${t}" data-at="${v}">${gateSVG(V.x * K, V.y * K, t as Track)}</g>`,
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
  for (const v of props.flash ?? []) {
    const V = g.verts[v]!;
    parts.push(
      `<circle class="flashring" data-flash="${v}" cx="${f1(V.x * K)}" cy="${f1(V.y * K)}" r="${0.42 * K}"/>`,
    );
  }

  if (targets.ghost != null && props.myColor)
    parts.push(ghostSVG(g, { kind: 'settlement', at: targets.ghost }, props.myColor, false));
  // Previews: where the mouse points, and whatever waits for Confirm.
  const ghostColor = props.myColor ?? '#f4ecd6';
  const waiting = props.pending ?? [];
  for (const gh of waiting) parts.push(ghostSVG(g, gh, ghostColor, true));
  if (hover && props.preview && !waiting.length) {
    const [t, id] = hover.split(':') as ['v' | 'e' | 'h', string];
    const ok = t === 'v' ? targets.verts : t === 'e' ? targets.edges : targets.hexes;
    if (ok.includes(Number(id)))
      for (const gh of props.preview(t, Number(id))) parts.push(ghostSVG(g, gh, ghostColor, false));
  }

  // Tap spots: hit areas only, drawn under the glowing targets.
  for (const e of targets.tapEdges ?? []) {
    const l = roadLine(g, e, 0.2);
    parts.push(
      `<g class="target tap" data-e="${e}"><circle class="hit" cx="${f1((l.x1 + l.x2) / 2)}" cy="${f1((l.y1 + l.y2) / 2)}" r="${0.2 * K}"/><line class="hit" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${0.34 * K}" stroke-linecap="round"/></g>`,
    );
  }
  for (const v of targets.tapVerts ?? []) {
    const V = g.verts[v]!;
    parts.push(
      `<g class="target tap" data-v="${v}"><circle class="hit" cx="${f1(V.x * K)}" cy="${f1(V.y * K)}" r="${0.3 * K}"/></g>`,
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

  const targetOf = (ev: React.MouseEvent): string | null => {
    const el = (ev.target as Element).closest('[data-v],[data-e],[data-h]') as
      HTMLElement | SVGElement | null;
    if (!el) return null;
    const d = el.dataset;
    return d.v != null ? `v:${d.v}` : d.e != null ? `e:${d.e}` : `h:${d.h}`;
  };
  const onClick = (ev: React.MouseEvent) => {
    if (held.current) {
      held.current = false;
      return;
    }
    // The end of a drag or pinch isn't a tap.
    if (zoom.dragged.current) {
      zoom.dragged.current = false;
      return;
    }
    const key = targetOf(ev);
    if (!key) return;
    const id = Number(key.slice(2));
    const touch = isTouch(ev);
    if (key[0] === 'v') props.onVert(id, touch);
    else if (key[0] === 'e') props.onEdge(id, touch);
    else props.onHex(id, touch);
  };
  /** The labelled piece under a screen point, placed just above it in the board's box. */
  const infoAt = (cx: number, cy: number) => {
    const m = zoom.svg.current?.getScreenCTM();
    const box = wrap.current?.getBoundingClientRect();
    if (!m || !box) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    const hit = spotAt(spots, p.x / K, p.y / K);
    if (!hit) return null;
    const c = new DOMPoint(hit.x * K, hit.y * K).matrixTransform(m);
    const r = hit.r * K * m.a;
    const top = c.y - box.top - r;
    const below = top < 70;
    return { key: JSON.stringify(hit.spot), x: c.x - box.left, y: below ? top + 2 * r : top, below };
  };
  const showInfo = (n: ReturnType<typeof infoAt>) =>
    setInfo((old) => (old?.key === n?.key && old?.x === n?.x && old?.y === n?.y ? old : n));
  const stopHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const onDown = (ev: React.PointerEvent) => {
    zoom.down(ev);
    if (ev.pointerType === 'mouse') return;
    held.current = false;
    setInfo(null);
    stopHold();
    if (!ev.isPrimary) return;
    // Press and hold only shows info: whatever it's on, the tap that follows is ignored.
    const { clientX: x, clientY: y } = ev;
    const timer = window.setTimeout(() => {
      hold.current = null;
      held.current = true;
      showInfo(infoAt(x, y));
    }, 500);
    hold.current = { id: ev.pointerId, x, y, timer };
  };
  const onMove = (ev: React.PointerEvent) => {
    zoom.move(ev);
    const h = hold.current;
    if (h && (h.id !== ev.pointerId || Math.hypot(ev.clientX - h.x, ev.clientY - h.y) > 10)) stopHold();
    if (ev.pointerType !== 'mouse') return;
    const key = targetOf(ev);
    if (key !== hover) setHover(key);
    // A legal spot under the mouse shows its preview instead.
    showInfo(key ? null : infoAt(ev.clientX, ev.clientY));
  };
  const shown = info && spots.find((x) => JSON.stringify(x.spot) === info.key);
  const label = shown ? spotLabel(view, shown.spot as Spot) : null;
  const boxW = wrap.current?.clientWidth ?? 0;

  return (
    <div className="boardzoom" ref={wrap}>
      <svg
        id="board"
        viewBox={zoom.box.join(' ')}
        role="img"
        aria-label="Island board"
        data-zoom={zoom.view.s.toFixed(2)}
        style={{ touchAction: zoom.view.s > 1 ? 'none' : 'pan-y' }}
        ref={(el) => {
          boardRef.svg = el;
          boardRef.geo = g;
          zoom.svg.current = el;
        }}
        onClick={onClick}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(ev) => {
          stopHold();
          zoom.up(ev);
        }}
        onPointerCancel={(ev) => {
          stopHold();
          zoom.up(ev);
        }}
        onPointerLeave={(ev) => {
          setHover(null);
          if (ev.pointerType === 'mouse') setInfo(null);
          zoom.up(ev);
        }}
        onContextMenu={(ev) => ev.preventDefault()}
      >
        <g dangerouslySetInnerHTML={{ __html: staticHtml }} />
        <g dangerouslySetInnerHTML={{ __html: parts.join('') }} />
      </svg>
      {label && info && (
        <div
          className={`boardinfo${info.below ? ' below' : ''}`}
          data-testid="board-info"
          role="status"
          style={{ left: Math.min(Math.max(info.x, 130), Math.max(130, boxW - 130)), top: info.y }}
        >
          {label}
        </div>
      )}
      <div className="zoomctl" aria-label="Zoom">
        <button
          type="button"
          className="iconbtn"
          aria-label="Zoom in"
          data-testid="zoom-in"
          onClick={() => zoom.by(1.4)}
        >
          +
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="Zoom out"
          data-testid="zoom-out"
          onClick={() => zoom.by(1 / 1.4)}
        >
          −
        </button>
        <button
          type="button"
          className="iconbtn fit"
          aria-label="Fit board"
          data-testid="zoom-fit"
          disabled={zoom.view.s === 1}
          onClick={zoom.fit}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

const MAX_ZOOM = 4;

/**
 * Board zoom (SPEC 5.12): buttons, mouse wheel, trackpad pinch, two-finger pinch, drag to move.
 * Only this screen's view changes. Zooming narrows the SVG viewBox, so every piece, ghost and
 * tap target stays in board coordinates and taps land where they're aimed at any zoom.
 */
function useZoom(vb: number[]) {
  const [view, setView] = useState({ s: 1, cx: vb[0]! + vb[2]! / 2, cy: vb[1]! + vb[3]! / 2 });
  const svg = useRef<SVGSVGElement | null>(null);
  const dragged = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; x: number; y: number; moved: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const clamp = (v: { s: number; cx: number; cy: number }) => {
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s));
    const w = vb[2]! / s;
    const h = vb[3]! / s;
    return {
      s,
      cx: Math.min(vb[0]! + vb[2]! - w / 2, Math.max(vb[0]! + w / 2, v.cx)),
      cy: Math.min(vb[1]! + vb[3]! - h / 2, Math.max(vb[1]! + h / 2, v.cy)),
    };
  };
  /** Screen point → board coordinates. */
  const toBoard = (x: number, y: number) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  /** Zoom by `f` keeping the board point under (x, y) where it is. */
  const zoomAt = (f: number, x?: number, y?: number) => {
    const v = viewRef.current;
    const at = x != null && y != null ? toBoard(x, y) : null;
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s * f));
    const k = v.s / s;
    const next = at ? { s, cx: at.x + (v.cx - at.x) * k, cy: at.y + (v.cy - at.y) * k } : { ...v, s };
    setView(clamp(next));
  };

  // Mouse wheel and trackpad pinch (which arrives as a wheel event with ctrlKey).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [vb.join(',')]);
  // A different board (a new game) starts unzoomed.
  useEffect(() => setView({ s: 1, cx: vb[0]! + vb[2]! / 2, cy: vb[1]! + vb[3]! / 2 }), [vb.join(',')]);

  const down = (ev: React.PointerEvent) => {
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const ps = [...pointers.current.values()];
    if (ps.length === 2)
      start.current = { d: Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y), x: 0, y: 0, moved: true };
    else if (ps.length === 1) start.current = { d: 0, x: ev.clientX, y: ev.clientY, moved: false };
  };
  const move = (ev: React.PointerEvent) => {
    const prev = pointers.current.get(ev.pointerId);
    if (!prev) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const ps = [...pointers.current.values()];
    const st = start.current;
    if (!st) return;
    if (ps.length === 2) {
      const d = Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y);
      if (st.d > 0) zoomAt(d / st.d, (ps[0]!.x + ps[1]!.x) / 2, (ps[0]!.y + ps[1]!.y) / 2);
      st.d = d;
      dragged.current = true;
      return;
    }
    // One finger or the mouse: drag to move while zoomed in.
    if (viewRef.current.s <= 1) return;
    if (!st.moved && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < 6) return;
    st.moved = true;
    dragged.current = true;
    const a = toBoard(prev.x, prev.y);
    const b = toBoard(ev.clientX, ev.clientY);
    if (a && b) setView((v) => clamp({ ...v, cx: v.cx - (b.x - a.x), cy: v.cy - (b.y - a.y) }));
  };
  const up = (ev: React.PointerEvent) => {
    pointers.current.delete(ev.pointerId);
    if (!pointers.current.size) start.current = null;
    // A click follows pointerup only if nothing was dragged; clear the flag after it.
    if (dragged.current) setTimeout(() => (dragged.current = false), 0);
  };
  const w = vb[2]! / view.s;
  const h = vb[3]! / view.s;
  return {
    view,
    box: [view.cx - w / 2, view.cy - h / 2, w, h],
    svg,
    dragged,
    down,
    move,
    up,
    by: (f: number) => zoomAt(f),
    fit: () => setView(clamp({ s: 1, cx: 0, cy: 0 })),
  };
}
