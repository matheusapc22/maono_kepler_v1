import { defineConfig, devices } from "@playwright/test";

// Built application, no production URL or credentials accepted by this config.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "documents-visual.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4175", locale: "pt-BR", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block" },
  webServer: { command: "npm run preview -- --host 127.0.0.1 --port 4175", url: "http://127.0.0.1:4175", timeout: 120_000, reuseExistingServer: false },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
