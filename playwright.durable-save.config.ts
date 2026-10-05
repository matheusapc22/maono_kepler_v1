import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Isolated real-browser IndexedDB/HTTP recovery tests. No production services.
export default defineConfig({
  ...base,
  testMatch: "**/durable-save-recovery.spec.ts",
  use: {
    ...base.use,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
});
