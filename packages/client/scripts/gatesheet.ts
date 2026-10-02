/*
 * Draws the metropolis gate (SPEC 8.2) for every track on cities of several colours, at the
 * smallest, normal and largest board scale, on land and water, and saves a screenshot.
 * Run: npx tsx packages/client/scripts/gatesheet.ts <out.png>
 */

import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { K, PCOL, TILE_COLOR, cityPath, edgeOf, gateSVG } from '../src/art';

const TRACKS = ['science', 'trade', 'politics'] as const;
const COLORS = ['red', 'blue', 'white', 'orange', 'black', 'yellow', 'gray'] as const;
const SCALES = [0.45, 1, 1.8];

function cell(color: (typeof COLORS)[number], track: (typeof TRACKS)[number], scale: number, ground: string) {
  const w = Math.round(1.1 * K * scale);
  const h = Math.round(1.1 * K * scale);
  const fill = PCOL[color];
  return `<svg width="${w}" height="${h}" viewBox="${-0.55 * K} ${-0.75 * K} ${1.1 * K} ${1.1 * K}"><rect x="${-0.55 * K}" y="${-0.75 * K}" width="${1.1 * K}" height="${1.1 * K}" fill="${ground}"/><path d="${cityPath(0, 0)}" fill="${fill}" stroke="${edgeOf(fill)}" stroke-width="2.6" stroke-linejoin="round"/>${gateSVG(0, 0, track)}</svg>`;
}

let html = `<!doctype html><meta charset="utf-8"><style>
body{background:#0e1a20;color:#e9e3d2;font:13px system-ui;margin:16px}
h2{margin:14px 0 6px;font-size:15px} .row{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;margin-bottom:6px}
svg{display:block;border-radius:4px}</style><h1>Metropolis gates</h1>`;
for (const scale of SCALES) {
  html += `<h2>Scale ${scale}</h2>`;
  for (const ground of [TILE_COLOR.wheat, TILE_COLOR.wood, '#12404f']) {
    html += '<div class="row">';
    for (const track of TRACKS) for (const c of COLORS) html += cell(c, track, scale, ground);
    html += '</div>';
  }
}

const out = process.argv[2] ?? 'gates.png';
// The pre-installed Chromium where there is one (as playwright.config.ts does), else Playwright's own.
const browser = await chromium.launch(
  existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`saved ${out}`);
