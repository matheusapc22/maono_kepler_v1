import { defineConfig, devices } from '@playwright/test';

// Dedicated port/process. Synthetic HTTP only; never reuse another task's server.
export default defineConfig({
  testDir: './tests/browser', testMatch: ['admin-projects.spec.ts'],
  outputDir: 'test-results/admin-projects', timeout: 45_000,
  expect: { timeout: 10_000 }, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4197', locale: 'pt-BR', timezoneId: 'UTC', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4197', url: 'http://127.0.0.1:4197', timeout: 120_000, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
