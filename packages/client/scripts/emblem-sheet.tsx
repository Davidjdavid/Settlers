// Draws every emblem in every player colour, at three sizes, for a visual check:
// npx tsx packages/client/scripts/emblem-sheet.tsx out.html
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import type { Color } from '@settlers/engine';
import { EMBLEMS, EmblemBadge } from '../src/emblems';

const COLORS: Color[] = [
  'red',
  'blue',
  'white',
  'orange',
  'purple',
  'black',
  'pink',
  'yellow',
  'gray',
  'teal',
  'cyan',
  'brown',
  'magenta',
  'lavender',
  'mint',
];
const rows = [40, 26, 18].map((size) =>
  h(
    'div',
    { key: size, style: { display: 'grid', gap: 6, marginBottom: 18 } },
    COLORS.map((c) =>
      h(
        'div',
        { key: c, style: { display: 'flex', gap: 6 } },
        EMBLEMS.map((e) => h(EmblemBadge, { key: e, emblem: e, color: c, size })),
      ),
    ),
  ),
);
const css =
  '.emblem{display:inline-grid;place-items:center;flex:none;border-radius:50%}.emblem svg{display:block}body{background:#13243a;padding:16px;margin:0}';
writeFileSync(
  process.argv[2]!,
  `<!doctype html><style>${css}</style>${renderToStaticMarkup(h('div', null, rows))}`,
);
