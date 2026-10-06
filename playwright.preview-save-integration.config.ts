import { defineConfig, devices } from '@playwright/test';

// Compiled map with map, preview and clustering flags. HTTP accounts/storage are local fixtures.
export default defineConfig({
  testDir: './tests/browser', testMatch: 'project-save-preview-integration.spec.ts',
  outputDir: 'test-results/preview-save-integration', timeout: 90_000,
  expect: { timeout: 10_000 }, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4176', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4176',
    url: 'http://127.0.0.1:4176', timeout: 120_000, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: false } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], launchOptions: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } : undefined } },
  ],
});
