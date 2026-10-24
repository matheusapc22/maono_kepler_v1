import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',testMatch:['notice-board.spec.ts','ticket-notifications.spec.ts'],timeout:30000,expect:{timeout:7500},workers:1,
 use:{baseURL:'http://127.0.0.1:4191',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node node_modules/vite/bin/vite.js --config vite.notice-board.config.ts --host 127.0.0.1 --port 4191 --strictPort',url:'http://127.0.0.1:4191/tests/browser/fixtures/notice-board.html',timeout:60000,reuseExistingServer:false},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
