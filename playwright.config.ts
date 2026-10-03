import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  // This new route suite owns a compiled-preview, three-engine gate. Running it
  // against Vite dev can reload /projects while Kepler dependencies reoptimize.
  // All preexisting loading/reliability suites remain in this development gate.
  testIgnore: ["**/project-pages.spec.ts", "**/platform-density-map.spec.ts", "**/map-add-data-sidebar.spec.ts"],
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
