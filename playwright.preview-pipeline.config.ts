import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',testMatch:['**/project-preview-pipeline.spec.ts','**/preview-spool-epochs.spec.ts'],outputDir:'test-results/preview-pipeline',timeout:30000,workers:1,fullyParallel:false,
  use:{trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari'],launchOptions:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE}:undefined}},
    {name:'mobile-chromium',use:{...devices['Pixel 7']}},{name:'mobile-webkit',use:{...devices['iPhone 13'],launchOptions:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE}:undefined}}],
});
