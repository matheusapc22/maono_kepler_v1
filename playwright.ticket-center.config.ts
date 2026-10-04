import { defineConfig } from "@playwright/test";
import projectPages from "./playwright.project-pages.config";

// Same actual compiled application and three engines, independently bounded
// so Central cases do not lengthen the existing map/project acceptance job.
export default defineConfig({
  ...projectPages,
  testMatch: ["ticket-center-visual.spec.ts", "ticket-view-selector.spec.ts"],
});
