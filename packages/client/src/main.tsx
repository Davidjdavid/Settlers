import { createRoot } from 'react-dom/client';
import { botMove, legalActions, seedRng, stateFromView, type PlayerView } from '@settlers/engine';
import { App } from './App';
import { client } from './net';
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/figtree/latin-700.css';
import '@fontsource/figtree/latin-800.css';
import '@fontsource/young-serif/latin-400.css';
import './styles.css';
import { applySize } from './display';
import { played } from './sound';

applySize();

createRoot(document.getElementById('root')!).render(<App />);

// Hook for the end-to-end test: play your own seat with the engine's bot. It only sees this
// browser's view and sends moves through the normal connection, like a person clicking.
const rng = seedRng(String(Math.random()));
Object.assign(window, {
  __settlers: {
    state: () => client.state,
    stage: (game: PlayerView) => client.stage(game),
    staged: () => client.stagedMoves(),
    // The moves this browser's player could make in a view (a made-up one for staged tests).
    legal: (game: PlayerView | null = client.state.game) =>
      game && game.me != null ? legalActions(stateFromView(game), game.me) : [],
    sounds: () => played.slice(),
    // `byHand`: move types the test will make through the UI instead (returned as 'skip:<type>').
    botStep: async (byHand: string[] = []) => {
      const v = client.state.game;
      if (!v || client.state.pending) return 'busy';
      const a = botMove(v, rng);
      if (!a) return 'idle';
      if (byHand.includes(a.type)) return `skip:${a.type}`;
      const r = await client.act(a);
      return r.ok ? a.type : `rejected:${r.error}`;
    },
  },
});
