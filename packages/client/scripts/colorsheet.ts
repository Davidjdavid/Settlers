/*
 * Draws every player colour's road, settlement, city, ship and knight on every tile colour, with
 * normal vision and simulated colorblindness, and saves a screenshot (SPEC 4.2).
 * Run: npx tsx packages/client/scripts/colorsheet.ts <out.png>
 */

import { chromium } from '@playwright/test';
import { COLORS } from '@settlers/engine';
import { K, PCOL, PNAME, TILE_COLOR, cityPath, edgeOf, settlementPath } from '../src/art';
import { VISIONS, simulate, type Vision } from '../src/colorcheck';

const GROUNDS: [string, string][] = [...Object.entries(TILE_COLOR), ['water', '#12404f']];
const VISION_NAME: Record<Vision, string> = {
  normal: 'Normal vision',
  protan: 'Protanopia (no red cones)',
  deutan: 'Deuteranopia (no green cones)',
  tritan: 'Tritanopia (no blue cones)',
};
const W = 150;
const H = 62;

function cell(fill: string, ground: string, v: Vision): string {
  const f = simulate(fill, v);
  const e = simulate(edgeOf(fill), v);
  const g = simulate(ground, v);
  const s = 0.42;
  const b = 0.85;
  const pieces = [
    `<line x1="8" y1="48" x2="40" y2="20" stroke="${e}" stroke-width="${0.22 * K * s}" stroke-linecap="round"/><line x1="8" y1="48" x2="40" y2="20" stroke="${f}" stroke-width="${0.13 * K * s}" stroke-linecap="round"/>`,
    `<g transform="translate(62 40) scale(${b})"><path d="${settlementPath(0, 0)}" fill="${f}" stroke="${e}" stroke-width="2.6" stroke-linejoin="round"/></g>`,
    `<g transform="translate(96 40) scale(${b})"><path d="${cityPath(0, 0)}" fill="${f}" stroke="${e}" stroke-width="2.6" stroke-linejoin="round"/></g>`,
    `<g transform="translate(130 36)"><path d="M-14 0L14 0L9 7L-9 7Z" fill="${f}" stroke="${e}" stroke-width="1.6"/><path d="M0 -1V-13L8 -3Z" fill="${simulate('#f4ecd6', v)}" stroke="#0b1418" stroke-width="1"/></g>`,
  ].join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${g}"/>${pieces}</svg>`;
}

let html = `<!doctype html><meta charset="utf-8"><style>
body{background:#0e1a20;color:#e9e3d2;font:13px system-ui;margin:16px}
h2{margin:18px 0 6px;font-size:16px} table{border-collapse:collapse} td,th{padding:2px} th{font-weight:600;text-align:left}
td svg{display:block;border-radius:4px}
</style><h1 style="font-size:20px">Settlers piece colours on every tile</h1>
<p>Road, settlement, city and ship in each colour. Gray is for CPU players only.</p>`;
for (const v of VISIONS) {
  html += `<h2>${VISION_NAME[v]}</h2><table><tr><th></th>${COLORS.map((c) => `<th>${PNAME[c]}</th>`).join('')}</tr>`;
  for (const [t, hex] of GROUNDS)
    html += `<tr><th>${t}</th>${COLORS.map((c) => `<td>${cell(PCOL[c], hex, v)}</td>`).join('')}</tr>`;
  html += '</table>';
}

const out = process.argv[2] ?? 'colorsheet.png';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`wrote ${out}`);
