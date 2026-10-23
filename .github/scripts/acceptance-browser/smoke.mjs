import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('scripts/acceptance/package.json'));
const { chromium } = require('@playwright/test');
assert.equal(require('@playwright/test/package.json').version, '1.55.0');

// No application URL, account, session or storage is involved in this smoke.
const browser = await chromium.launch({ headless: true, timeout: 30_000 });
try {
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.setContent('<button onclick="this.textContent=\'Ready\'">Check browser</button>');
  await page.getByRole('button', { name: 'Check browser', exact: true }).click();
  assert.equal(await page.getByRole('button').textContent(), 'Ready');
  assert.equal(page.url(), 'about:blank');
  console.log(JSON.stringify({ browserSetupSmoke: 'PASS', browserVersion: browser.version(), applicationRequests: 0 }));
} finally {
  await browser.close();
}
