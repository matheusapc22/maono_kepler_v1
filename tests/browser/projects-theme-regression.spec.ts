import { test } from '@playwright/test';
import {
  widths, verifyProjectScope, verifyLegacyParity, verifyReproduction, verifyShellTransition,
} from '../helpers/projects-fallback-fixture.mjs';

// Isolated CSS contract. This suite intentionally does not authenticate or call APIs.
// React sub-tabs, real route transitions, responsive layout and bundle acceptance remain separate gates.
for (const width of widths) {
  for (const colorScheme of ['light', 'dark']) {
    test(`Projects fallback isolation: ${width}px / ${colorScheme}`, async ({ page }) => {
      await verifyProjectScope(page, width, { colorScheme });
    });
  }
  for (const shell of ['legacy-page', 'maono-admin-page', 'maono-login-page']) {
    test(`Legacy fallback parity: ${shell} / ${width}px`, async ({ page }) => {
      await verifyLegacyParity(page, width, shell);
    });
  }
}

test('reproduces white inputs, blue submit and centered folder before the fix', async ({ page }) => {
  await verifyReproduction(page);
});

test('shell identity transitions do not depend on startup URL or injection order', async ({ page }) => {
  await verifyShellTransition(page);
});

test('Projects exclusion respects forced-colors', async ({ page }) => {
  await verifyProjectScope(page, 390, { forcedColors: 'active' });
});
