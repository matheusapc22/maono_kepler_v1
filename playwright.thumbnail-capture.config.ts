import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: ['**/project-thumbnail-capture.spec.ts', '**/point-cluster-capture.spec.ts'],
  outputDir: process.env.PREVIEW_CAPTURE_RESULTS || '/tmp/maono-thumbnail-capture-results',
  timeout: 30000, workers: 1, fullyParallel: false,
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { timeout: 10000, env: { ...process.env } } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { timeout: 10000, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } },
    // Use the virtual display for Firefox's real WebGL capture fixtures.
    { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: false } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], launchOptions: { timeout: 10000, executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: { timeout: 10000, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], launchOptions: { timeout: 10000, executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } } },
  ],
});
