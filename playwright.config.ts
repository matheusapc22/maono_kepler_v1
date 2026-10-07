import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  // This new route suite owns a compiled-preview, three-engine gate. Running it
  // against Vite dev can reload /projects while Kepler dependencies reoptimize.
  // All preexisting loading/reliability suites remain in this development gate.
  // Mounted save/PNG integration needs the six compile-time map/preview flags
  // supplied by its dedicated playwright.preview-save-integration.config.ts gate.
  // Production acceptance assertions likewise own a flagged compiled gate on 4187.
  testIgnore: ["**/document-preview.spec.ts", "**/admin-progressive-loading.spec.ts", "**/projects-progressive-loading.spec.ts", "**/roadmap-progressive-loading.spec.ts", "**/ticket-documents-progressive-loading.spec.ts", "**/ticket-optional-progressive-loading.spec.ts", "**/projects-section-loading.spec.ts", "**/map-error-notice.spec.ts", "**/users-access-workspace.spec.ts", "**/platform-selectors.spec.ts", "**/roadmap-workspace.spec.ts", "**/ticket-view-selector.spec.ts", "**/maono-select.spec.ts", "**/ticket-center-visual.spec.ts", "**/login-redesign.spec.ts", "**/project-pages.spec.ts", "**/platform-density-map.spec.ts", "**/map-add-data-sidebar.spec.ts", "**/map-data-localization.spec.ts", "**/map-sidebar-scrollbars.spec.ts", "**/map-panel-minimal.spec.ts", "**/map-sidebar-visual.spec.ts", "**/map-numeric-controls.spec.ts", "**/map-panel-hint-compatibility.spec.ts", "**/project-save-preview-integration.spec.ts", "**/production-acceptance-preview.spec.ts"],
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Local browser regression only; does not change a deployed environment.
    env: { VITE_POINT_CLUSTERING_V1: "true" },
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/login",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
