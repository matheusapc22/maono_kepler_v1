import { defineConfig } from '@playwright/test';

// This directory is intentionally outside the generic tests/browser discovery.
// Compiled product UI + synthetic HTTP; never a Production acceptance window.
export default defineConfig({
  testDir: './tests/acceptance-browser',
  testMatch: ['organization-functional-evidence.spec.ts'],
  outputDir: 'test-results/organization-functional-evidence',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4199',
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4199', url: 'http://127.0.0.1:4199', reuseExistingServer: false },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
