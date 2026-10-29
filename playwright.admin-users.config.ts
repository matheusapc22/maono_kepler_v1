import { defineConfig } from '@playwright/test';
import progressive from './playwright.progressive-loading.config';

// Dedicated local port/output: do not attach to another Admin task's server.
export default defineConfig({
  ...progressive,
  testMatch: ['admin-users-safety.spec.ts', 'admin-workspace.spec.ts', 'admin-progressive-loading.spec.ts', 'projects-theme-regression.spec.ts'],
  outputDir: 'test-results/admin-users',
  use: { ...progressive.use, baseURL: 'http://127.0.0.1:4195' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4195',
    url: 'http://127.0.0.1:4195', timeout: 120_000, reuseExistingServer: false,
  },
});
