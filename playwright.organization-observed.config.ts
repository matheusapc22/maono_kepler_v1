import {defineConfig} from '@playwright/test';
import base from './playwright.organization-evidence.config';

export default defineConfig({...base,
  testMatch: ['organization-observed.spec.ts'],
  outputDir: 'test-results/organization-observed',
  use: {...base.use, trace: 'off', screenshot: 'off', video: 'off'},
});
