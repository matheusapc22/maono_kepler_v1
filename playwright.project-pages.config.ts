import { defineConfig, devices } from "@playwright/test";

// Actual built React application; fixture-only HTTP, no production URL or credentials.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["platform-selectors.spec.ts", "project-pages.spec.ts", "platform-density-map.spec.ts", "map-add-data-sidebar.spec.ts", "map-data-localization.spec.ts", "map-sidebar-scrollbars.spec.ts", "map-panel-minimal.spec.ts", "map-panel-hint-compatibility.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4176", locale: "pt-BR", timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4176",
    url: "http://127.0.0.1:4176", timeout: 120_000, reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Playwright headless Firefox injects an agent stylesheet that hides every
    // native scrollbar. A virtual display lets this gate verify the real CSS.
    { name: "firefox", use: { ...devices["Desktop Firefox"], headless: false } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
