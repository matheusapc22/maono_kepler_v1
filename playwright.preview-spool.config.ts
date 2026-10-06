import base from './playwright.preview-pipeline.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: '**/preview-spool-epochs.spec.ts', outputDir: 'test-results/preview-spool-epochs' });
