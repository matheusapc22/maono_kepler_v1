import { defineConfig } from "@playwright/test";
import projectPages from "./playwright.project-pages.config";

// Built local application and synthetic, intercepted HTTP only. No production acceptance.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "users-access-workspace.spec.ts",
  outputDir: "test-results/users-access-workspace",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4183", locale: "pt-BR", timezoneId: "America/Sao_Paulo",
    headless: true, trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4183",
    url: "http://127.0.0.1:4183", timeout: 120_000, reuseExistingServer: false,
  },
  // Share launch options with the other route gates; native scrollbar paint is
  // not this suite's concern, so every engine runs headless.
  projects: projectPages.projects?.map(project => ({ ...project, use: { ...project.use, headless: true } })),
});
