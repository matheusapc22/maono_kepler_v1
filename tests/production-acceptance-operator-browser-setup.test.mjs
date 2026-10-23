import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [workflow, setup, smoke] = await Promise.all([
  read('.github/workflows/production-acceptance-operator.yml'),
  read('.github/scripts/acceptance-browser/setup.sh'),
  read('.github/scripts/acceptance-browser/smoke.mjs'),
]);
const protectedJob = workflow.slice(workflow.indexOf('  protected:'));
const smokeJob = workflow.slice(workflow.indexOf('  browser-setup-smoke:'), workflow.indexOf('  validate:'));

test('browser setup is proved by the same credential-free PR path before a production window', () => {
  assert.match(workflow, /'\.github\/scripts\/acceptance-browser\/\*\*'/);
  assert.match(smokeJob, /if: github\.event_name == 'pull_request'/);
  assert.match(smokeJob, /runs-on: ubuntu-24\.04/);
  assert.match(protectedJob, /runs-on: ubuntu-24\.04/);
  for (const job of [smokeJob, protectedJob]) {
    assert.match(job, /timeout-minutes: 5\s+(?:if:.*\s+)?shell: bash\s+run: \|\s+bash \.github\/scripts\/acceptance-browser\/setup\.sh/);
  }
  assert.doesNotMatch(smokeJob, /secrets\.|environment:|operator\.mjs/);
  assert.doesNotMatch(setup + smoke, /MAONO_ACCEPTANCE_|CLOUDFLARE_API_TOKEN/);
});

test('setup downloads only the pinned headless runtime without system-package upgrades', () => {
  assert.match(setup, /test "\$ID:\$VERSION_ID" = ubuntu:24\.04/);
  assert.match(setup, /npm install --prefix scripts\/acceptance/);
  assert.match(setup, /--no-save --no-package-lock --ignore-scripts --no-audit --no-fund/);
  assert.match(setup, /@playwright\/test@1\.55\.0/);
  assert.match(setup, /playwright install --only-shell chromium/);
  assert.doesNotMatch(setup, /--with-deps|install-deps|\bapt(?:-get)?\s/);
  assert.match(setup, /PLAYWRIGHT_BROWSERS_PATH=.*RUNNER_TEMP/);
  assert.ok(setup.indexOf('smoke.mjs') < setup.indexOf('>> "${GITHUB_ENV:?}"'));
});

test('browser smoke is offline, exercises interaction and always closes its browser', () => {
  assert.match(smoke, /offline: true, serviceWorkers: 'block'/);
  assert.match(smoke, /context\.route\('\*\*\/\*', route => route\.abort\(\)\)/);
  assert.match(smoke, /\.click\(\)/);
  assert.match(smoke, /assert\.equal\(page\.url\(\), 'about:blank'\)/);
  assert.match(smoke, /finally\s*\{\s*await browser\.close\(\)/);
  assert.doesNotMatch(smoke, /https?:|page\.goto|fetch\(/);
});

test('browser preparation leaves protected cleanup and restoration budgets intact', () => {
  const limits = [...protectedJob.matchAll(/timeout-minutes: (\d+)/g)].map(m => Number(m[1]));
  assert.deepEqual(limits, [210, 3, 1, 2, 5, 192, 1, 2]);
  assert.equal(limits.slice(1).reduce((sum, value) => sum + value, 0), 206);
  assert.match(protectedJob, /environment: production-acceptance/);
  assert.match(protectedJob, /needs\.validate\.outputs\.browser_required == 'true' && inputs\.mode == 'run'/);
});
