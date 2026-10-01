import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use a preinstalled Chromium when one is provided (e.g. cloud dev boxes); otherwise Playwright's own.
const chromium =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'e2e',
  timeout: 10 * 60 * 1000,
  workers: 1,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 860 },
    launchOptions: chromium ? { executablePath: chromium } : {},
    trace: 'retain-on-failure',
  },
});
