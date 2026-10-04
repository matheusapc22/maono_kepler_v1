import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: ["maono-select.spec.ts"], workers: 1,
  timeout: 30_000, expect: { timeout: 7_500 },
  use: { baseURL: "http://127.0.0.1:4185", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 4185", url: "http://127.0.0.1:4185/tests/browser/fixtures/maono-select.html", reuseExistingServer: false },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "firefox", use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "gfx.webrender.software": true, "layers.acceleration.disabled": true, "gfx.x11-egl.force-disabled": true } } } }, { name: "webkit", use: { ...devices["Desktop Safari"] } }, { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }, { name: "mobile-webkit", use: { ...devices["iPhone 13"] } }],
});
