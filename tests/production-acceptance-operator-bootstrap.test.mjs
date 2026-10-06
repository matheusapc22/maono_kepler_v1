import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const workflow = await readFile(new URL('../.github/workflows/production-acceptance-operator.yml', import.meta.url), 'utf8');

test('protected main bootstrap reserves bounded operator, cleanup and reporting time', () => {
  const job = workflow.slice(workflow.indexOf('  protected:'));
  const limits = [...job.matchAll(/timeout-minutes: (\d+)/g)].map(match => Number(match[1]));
  assert.deepEqual(limits, [210, 3, 1, 2, 5, 192, 1, 2]);
  assert.equal(limits.slice(1).reduce((sum, value) => sum + value, 0), 206);
  const validate = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  protected:'));
  assert.match(validate, /execution-budget\.mjs/);
  assert.match(validate, /assert\.equal\(totalBudgetMs\(\), 190 \* 60_000\)/);
  assert.match(validate, /cleanup: 10 \* 60_000, restoration: 60 \* 60_000, report: 5 \* 60_000/);
  assert.doesNotMatch(validate, /secrets\./);
});

test('bootstrap continues to execute only the revalidated canonical product SHA', () => {
  assert.match(workflow, /PRODUCT_BRANCH: mano_kepler_v1/);
  assert.match(workflow, /test "\$DISPATCH_REF" = "main"/);
  assert.match(workflow, /test "\$ACTOR" = "\$OWNER"/);
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/);
  assert.match(workflow, /test "\$current" = "\$VALIDATED_RELEASE_SHA"/);
  assert.match(workflow, /environment: production-acceptance/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /path: \.tmp\/production-acceptance\/report\*\.json/);
  assert.doesNotMatch(workflow, /^\s*(push|schedule):/m);
  assert.doesNotMatch(workflow, /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?(source_sha|command|secret_name):/);
});
