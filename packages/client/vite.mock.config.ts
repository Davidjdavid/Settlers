/* The Isle mock-up (docs/isle.md 10): `npx vite --config vite.mock.config.ts` serves it at
   /mock/; a build writes a standalone page to MOCK_OUT. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5180, host: '127.0.0.1' },
  build: {
    outDir: process.env.MOCK_OUT ?? 'mock-dist',
    emptyOutDir: true,
    rollupOptions: { input: 'mock/index.html' },
  },
});
