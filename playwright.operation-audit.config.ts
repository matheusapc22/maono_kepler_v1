import { defineConfig } from '@playwright/test';

// Actual compiled UI, synthetic HTTP. No production credentials or bindings.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['admin-audit-operations.spec.ts', 'organizations-audit-flow.spec.ts'],
  outputDir: 'test-results/operation-audit',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4198',
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    headless: true, serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4198',
    url: 'http://127.0.0.1:4198', reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
