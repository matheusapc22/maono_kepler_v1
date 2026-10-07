import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Isolated real-browser IndexedDB/HTTP recovery tests. No production services.
export default defineConfig({
  ...base,
  testMatch: ["**/durable-save-recovery.spec.ts", "**/durable-save-store.spec.ts"],
  use: { ...base.use },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : undefined } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"], launchOptions: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } : undefined } },
  ],
});
