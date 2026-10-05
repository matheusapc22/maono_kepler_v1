import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',testMatch:'document-preview.spec.ts',timeout:45_000,expect:{timeout:12_000},workers:1,fullyParallel:false,
 use:{baseURL:'http://127.0.0.1:4178',locale:'pt-BR',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 webServer:{command:'npm run preview -- --host 127.0.0.1 --port 4178',url:'http://127.0.0.1:4178',timeout:120_000,reuseExistingServer:false},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}],
});
