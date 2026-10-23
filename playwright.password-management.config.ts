import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "password-management.spec.ts",
  outputDir: "test-results/password-management",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4187", headless: true, serviceWorkers: "block",
    // Password tests must not retain screenshots, videos or request traces.
    screenshot: "off", trace: "off", video: "off",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4187",
    url: "http://127.0.0.1:4187", reuseExistingServer: false, timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
