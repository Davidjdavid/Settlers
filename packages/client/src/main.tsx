import { createRoot } from 'react-dom/client';
import { botMove, seedRng } from '@settlers/engine';
import { App } from './App';
import { client } from './net';
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/figtree/latin-700.css';
import '@fontsource/figtree/latin-800.css';
import '@fontsource/young-serif/latin-400.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Hook for the end-to-end test: play your own seat with the engine's bot. It only sees this
// browser's view and sends moves through the normal connection, like a person clicking.
const rng = seedRng(String(Math.random()));
Object.assign(window, {
  __settlers: {
    state: () => client.state,
    botStep: async () => {
      const v = client.state.game;
      if (!v || client.state.pending) return 'busy';
      const a = botMove(v, rng);
      if (!a) return 'idle';
      const r = await client.act(a);
      return r.ok ? a.type : `rejected:${r.error}`;
    },
  },
});
