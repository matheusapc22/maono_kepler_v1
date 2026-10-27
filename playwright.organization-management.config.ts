import { defineConfig } from '@playwright/test';
// Compiled UI with intercepted HTTP. Never authenticates a production account.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'organization-management*.spec.ts',
  outputDir: 'test-results/organization-management',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4196',
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    headless: true, serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4196',
    url: 'http://127.0.0.1:4196', reuseExistingServer: false,
  },
  projects: [{name: 'chromium', use: {browserName: 'chromium'}}],
});
