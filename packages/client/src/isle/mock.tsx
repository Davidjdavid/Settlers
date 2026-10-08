/* The Isle mock-up (docs/isle.md 10): the new screen with made-up data from a real Full game. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PlayerView } from '@settlers/engine';
import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/m-plus-rounded-1c/latin-500.css';
import '@fontsource/m-plus-rounded-1c/latin-700.css';
import '@fontsource/m-plus-rounded-1c/latin-800.css';
import './isle.css';
import demo from './demo.json';
import { IsleBoard } from './IsleBoard';

const view = (demo as unknown as { view: PlayerView }).view;

function Mock() {
  const q = new URLSearchParams(location.search);
  const hot = Number(q.get('hot')) || null;
  const tilt = Number(q.get('tilt')) || 0;
  return (
    <div
      className="isle"
      style={tilt ? ({ ['--tilt' as string]: `${tilt}deg` } as React.CSSProperties) : undefined}
      data-tilt={tilt || undefined}
    >
      <IsleBoard v={view} insets={{ top: 40, right: 150, bottom: 150, left: 150 }} hot={hot} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Mock />
  </StrictMode>,
);
