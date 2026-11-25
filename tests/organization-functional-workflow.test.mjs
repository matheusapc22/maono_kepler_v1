import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [workflow, config, generic, spec] = await Promise.all([
  read('.github/workflows/organization-functional-evidence.yml'),
  read('playwright.organization-evidence.config.ts'), read('playwright.config.ts'),
  read('tests/acceptance-browser/organization-functional-evidence.spec.ts'),
]);

test('evidence browser cases run only in their compiled, flags-enabled, credential-free CI gate', () => {
  assert.match(generic, /testDir:\s*['"]\.\/tests\/browser['"]/);
  assert.match(config, /testDir:\s*['"]\.\/tests\/acceptance-browser['"]/);
  assert.match(config, /testMatch:\s*\[['"]organization-functional-evidence\.spec\.ts['"]\]/);
  assert.match(config, /command:\s*['"]npm run preview /);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /node --experimental-strip-types --test tests\/organization-functional-\*\.test\.mjs tests\/production-acceptance-operator-organization-readiness\.test\.mjs/);
  for (const flag of ['VITE_ADMIN_AUDIT_OPERATIONS_V1', 'VITE_ORGANIZATION_MANAGEMENT_V1']) assert.match(workflow, new RegExp(`${flag}: 'true'`));
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /run: npx playwright test --config=playwright\.organization-evidence\.config\.ts --reporter=list,json/);
  assert.doesNotMatch(workflow, /continue-on-error|--grep|--shard|secrets\.|MAONO_ACCEPTANCE_QA_CREDENTIALS|wrangler|environment:\s*production/);
  assert.doesNotMatch(spec, /\b(?:test|describe)\.(?:skip|only|fixme)\s*\(/);
  assert.match(workflow, /if: always\(\)[\s\S]*uses: actions\/upload-artifact@v4/);
});

test('workflow changes, collector dependencies and application changes all trigger the complete gate', () => {
  for (const path of ['src/**', 'functions/**', 'scripts/acceptance/**', 'scripts/install-ci-browsers.mjs',
    'tests/organization-functional-*.test.mjs', 'tests/production-acceptance-operator-organization-readiness.test.mjs',
    'tests/helpers/organization-functional-evidence-fixture.mjs', 'tests/acceptance-browser/**',
    'playwright.organization-evidence.config.ts', '.github/workflows/organization-functional-evidence.yml',
    'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig*.json']) assert.ok(workflow.includes(`- '${path}'`), path);
  assert.match(workflow, /branches:\s*\[mano_kepler_v1\]/);
  assert.match(workflow, /workflow_dispatch:/);
});
