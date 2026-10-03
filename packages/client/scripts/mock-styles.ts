/* The five art styles on one board, for a visual check: npx tsx packages/client/scripts/mock-styles.ts out.html */
import { writeFileSync } from 'node:fs';
import { geometryFor, newGame, SCENARIOS } from '@settlers/engine';
import { K, PCOL, cityPath, f1, hexPts, settlementPath } from '../src/art';
import { STYLES, STYLE_LABEL, THEMES, useStyle, T } from '../src/themes';

const s = newGame('mock-3', [{ pid: 'a', nick: 'Ann', color: 'red' }, { pid: 'b', nick: 'Bob', color: 'blue' }, { pid: 'c', nick: 'Cy', color: 'white' }, { pid: 'd', nick: 'Di', color: 'orange' }] as never, { map: SCENARIOS['heading-for-new-shores']! }); // prettier-ignore
const g = geometryFor(s.board.hexes);
const xs = g.verts.map((v) => v.x);
const ys = g.verts.map((v) => v.y);
const m = 1.25;
const vb = [(Math.min(...xs) - m) * K, (Math.min(...ys) - m) * K, (Math.max(...xs) - Math.min(...xs) + 2 * m) * K, (Math.max(...ys) - Math.min(...ys) + 2 * m) * K]; // prettier-ignore
const DECOR = [
  [-90, 0.6],
  [-30, 0.6],
  [30, 0.6],
  [90, 0.62],
  [150, 0.6],
  [210, 0.6],
] as const;
const land = (i: number) => !['sea', 'fog'].includes(s.board.hexes[i]!.t);
// Some pieces: settlements/cities on land corners with a road each, a ship, knights.
const landVerts = g.verts.map((v, i) => i).filter((i) => g.verts[i]!.hexes.filter(land).length >= 2);
const picks = [0.05, 0.25, 0.45, 0.65, 0.85].map((f) => landVerts[Math.floor(f * landVerts.length)]!);
const seaEdge = g.edges.findIndex((e) => e.hexes.length === 2 && !land(e.hexes[0]!) && land(e.hexes[1]!));

function board(style: (typeof STYLES)[number]): string {
  useStyle(style);
  const t = T();
  const out: string[] = [];
  const box = `x="${vb[0]! + 2}" y="${vb[1]! + 2}" width="${vb[2]! - 4}" height="${vb[3]! - 4}" rx="${0.45 * K}"`;
  out.push(`<defs>${t.seaDefs}</defs>${t.sea(box)}`);
  const lands = g.hexes.filter((_, i) => land(i));
  for (const h of lands)
    out.push(`<polygon points="${hexPts(h.x * K, h.y * K, 1.1 * K)}" fill="${t.beach[0]}"/>`);
  for (const h of lands)
    out.push(`<polygon points="${hexPts(h.x * K, h.y * K, 1.035 * K)}" fill="${t.beach[1]}"/>`);
  s.board.hexes.forEach((hx, i) => {
    const h = g.hexes[i]!;
    const cx = h.x * K;
    const cy = h.y * K;
    if (hx.t === 'sea') return out.push(t.seaHex(cx, cy, i));
    out.push(
      `<polygon points="${hexPts(cx, cy, 0.965 * K)}" fill="${t.tile[hx.t]}" stroke="${t.hexStroke}" stroke-width="${t.hexStrokeW}"/>`,
    );
    if (t.innerRing)
      out.push(
        `<polygon points="${hexPts(cx, cy, 0.8 * K)}" fill="none" stroke="${t.innerRing}" stroke-width="2"/>`,
      );
    const spots = t.decor === 'single' ? [[-90, 0.58] as const] : DECOR;
    spots.forEach(([ang, rad], j) => {
      if (t.decor === 'scatter' && (i + j) % 6 === 2) return;
      const a = (Math.PI / 180) * ang;
      const sz = (t.decor === 'single' ? 0.42 : hx.t === 'ore' ? 0.42 : 0.34) * K;
      out.push(
        `<use href="#g-${hx.t}" x="${f1(cx + Math.cos(a) * rad * K - sz / 2)}" y="${f1(cy + Math.sin(a) * rad * K - sz / 2)}" width="${f1(sz)}" height="${f1(sz)}"${t.glyphAttr(hx.t)}/>`,
      );
    });
  });
  out.push(t.overlay(vb));
  s.board.hexes.forEach((hx, i) => {
    if (hx.n) out.push(t.token(g.hexes[i]!.x * K, g.hexes[i]!.y * K, hx.n));
  });
  // Pieces.
  const cols = [PCOL.red, PCOL.blue, PCOL.white, PCOL.orange, PCOL.black];
  out.push(t.piecesOpen);
  picks.forEach((v, k) => {
    const V = g.verts[v]!;
    const col = cols[k]!;
    const e = V.edges.find((x) => g.edges[x]!.hexes.some(land))!;
    const E = g.edges[e]!;
    const a = g.verts[E.a]!;
    const b = g.verts[E.b]!;
    out.push(
      `<line x1="${f1(a.x * K)}" y1="${f1(a.y * K)}" x2="${f1(b.x * K)}" y2="${f1(b.y * K)}" stroke="${t.edge(col)}" stroke-width="${0.22 * K}" stroke-linecap="${t.crisp ? 'butt' : 'round'}"/><line x1="${f1(a.x * K)}" y1="${f1(a.y * K)}" x2="${f1(b.x * K)}" y2="${f1(b.y * K)}" stroke="${col}" stroke-width="${0.13 * K}" stroke-linecap="${t.crisp ? 'butt' : 'round'}"/>`,
    );
    const d = k % 2 ? cityPath(V.x * K, V.y * K) : settlementPath(V.x * K, V.y * K);
    out.push(
      `<path d="${d}" fill="${col}" stroke="${t.edge(col)}" stroke-width="2.6" stroke-linejoin="round"/>`,
    );
  });
  if (seaEdge >= 0) {
    const E = g.edges[seaEdge]!;
    const x = ((g.verts[E.a]!.x + g.verts[E.b]!.x) / 2) * K;
    const y = ((g.verts[E.a]!.y + g.verts[E.b]!.y) / 2) * K;
    const u = 0.125 * K;
    out.push(
      `<g transform="translate(${f1(x)} ${f1(y)})"><path d="M${-2.6 * u} ${-0.2 * u}L${2.6 * u} ${-0.2 * u}L${1.7 * u} ${1.1 * u}L${-1.7 * u} ${1.1 * u}Z" fill="${PCOL.blue}" stroke="${t.edge(PCOL.blue)}" stroke-width="2.2"/><path d="M${-0.1 * u} ${-0.3 * u}V${-2.4 * u}L${1.5 * u} ${-0.6 * u}Z" fill="#f4ecd6" stroke="#0b1418" stroke-width="1.6"/></g>`,
    );
  }
  out.push(t.piecesClose);
  // A harbor-style label, to see the text.
  const h0 = g.hexes[0]!;
  out.push(
    `<circle cx="${f1(h0.x * K)}" cy="${f1((h0.y - 1.3) * K)}" r="${0.3 * K}" fill="#f4ecd6" stroke="#0a1b23" stroke-width="2.5"/>${t.text(h0.x * K, (h0.y - 1.3) * K, '3:1', 0.2 * K, '#1b2a30')}`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" font-family="'Young Serif', Georgia, serif"${t.crisp ? ' shape-rendering="crispEdges"' : ''}>${out.join('')}</svg>`;
}
const cells = STYLES.map(
  (st) => `<figure><figcaption>${STYLE_LABEL[st]}</figcaption>${board(st)}</figure>`,
).join('');
void THEMES;
writeFileSync(
  process.argv[2]!,
  `<!doctype html><html><body style="margin:0;background:#0b1418;color:#f4ecd6;font:600 22px system-ui"><div style="display:grid;grid-template-columns:repeat(2,640px);gap:18px;padding:18px">${cells}</div><style>figure{margin:0}figcaption{margin:4px 0 8px}svg{width:640px;height:auto;display:block}</style></body></html>`,
);
