import { defineConfig } from "@playwright/test";
import projectPages from "./playwright.project-pages.config";

// Compiled app and fixture-only HTTP. Roadmap has no production-acceptance scope.
export default defineConfig({
  ...projectPages,
  testMatch: ["roadmap-workspace.spec.ts"],
  outputDir: "test-results/roadmap-workspace",
  // These cases test timeline geometry, not Firefox's headful scrollbar paint.
  projects: projectPages.projects?.map(project => ({ ...project, use: { ...project.use, headless: true } })),
  use: { ...projectPages.use, baseURL: "http://127.0.0.1:4182" },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4182",
    url: "http://127.0.0.1:4182", timeout: 120_000, reuseExistingServer: false,
  },
});
