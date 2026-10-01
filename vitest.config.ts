import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Whole games are played in some tests; leave room for slow CI machines.
    testTimeout: 30000,
  },
});
