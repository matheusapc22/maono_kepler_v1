import { defineConfig, devices } from "@playwright/test";

// Compiled application with synthetic HTTP. This is not real-account acceptance.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "login-redesign.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4180", locale: "pt-BR", trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block", reducedMotion: "reduce" },
  webServer: { command: "npm run preview -- --host 127.0.0.1 --port 4180", url: "http://127.0.0.1:4180", timeout: 120_000, reuseExistingServer: false },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], headless: false } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
