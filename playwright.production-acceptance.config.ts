import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'production-acceptance-preview.spec.ts',
  outputDir: 'test-results/production-acceptance-local', timeout: 120_000, workers: 1,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4187', locale: 'pt-BR',
    serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4187',
    url: 'http://127.0.0.1:4187', timeout: 120_000, reuseExistingServer: false },
});
