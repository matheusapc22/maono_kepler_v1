import { defineConfig } from "@playwright/test";
import projectPages from "./playwright.project-pages.config";

// Built React and controlled fixture HTTP only. No real authenticated account.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["admin-progressive-loading.spec.ts", "projects-progressive-loading.spec.ts", "roadmap-progressive-loading.spec.ts", "ticket-documents-progressive-loading.spec.ts", "ticket-optional-progressive-loading.spec.ts"],
  outputDir: "test-results/progressive-loading",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4191", locale: "pt-BR", timezoneId: "America/Sao_Paulo",
    headless: true, trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4191",
    url: "http://127.0.0.1:4191", timeout: 120_000, reuseExistingServer: false,
  },
  projects: projectPages.projects?.map(project => ({ ...project, use: { ...project.use, headless: true } })),
});
