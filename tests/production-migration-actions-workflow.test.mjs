import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/production-d1-migration-operator.yml', import.meta.url),
  'utf8',
);

test('production migration operator has no automatic production trigger', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push\s*:/m);
  assert.doesNotMatch(workflow, /^\s*schedule\s*:/m);
});

test('remote job is protected by the dedicated GitHub Environment secret', () => {
  assert.match(workflow, /environment: production-d1-migrations/);
  assert.match(workflow, /secrets\.MAONO_D1_MIGRATION_API_TOKEN/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
});

test('Cloudflare token is scoped to credential-check and operator steps only', () => {
  assert.doesNotMatch(workflow, /remote:[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:[\s\S]*?steps:/);
  const occurrences = workflow.match(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.MAONO_D1_MIGRATION_API_TOKEN \}\}/g) || [];
  assert.equal(occurrences.length, 2);
});

test('official actions that run in the protected workflow are immutable-SHA pinned', () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node|upload-artifact)@v\d/);
  assert.match(workflow, /package-manager-cache: false/);
});

test('dispatch is restricted to repository owner on default main ref', () => {
  assert.match(workflow, /test "\$ACTOR" = "\$OWNER"/);
  assert.match(workflow, /test "\$DISPATCH_REF" = "main"/);
});

test('product SHA is pinned and branch drift is refused before Cloudflare access', () => {
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/);
  assert.match(workflow, /git ls-remote origin/);
  assert.match(workflow, /test "\$current" = "\$VALIDATED_RELEASE_SHA"/);
});

test('apply requires approval hash and performs a fresh audit first', () => {
  assert.match(workflow, /\[\[ "\$APPROVAL_HASH" =~ \^\[0-9a-fA-F\]\{64\}\$ \]\]/);
  const applyIndex = workflow.indexOf('            apply)');
  const freshAuditIndex = workflow.indexOf('migration:audit:production', applyIndex);
  const applyCommandIndex = workflow.indexOf('migration:apply:production', applyIndex);
  assert.ok(applyIndex > 0 && freshAuditIndex > applyIndex && applyCommandIndex > freshAuditIndex);
  assert.match(workflow, /test "\$current_hash" = "\$supplied_hash"/);
});

test('audit artifacts remove executable approval token before upload', () => {
  assert.match(workflow, /delete r\.approval\.token/);
  assert.match(workflow, /delete r\.applyCommand/);
});

test('workflow never runs generic Wrangler migration apply directly', () => {
  assert.doesNotMatch(workflow, /wrangler\s+d1\s+migrations\s+apply/i);
  assert.match(workflow, /migration:apply:production/);
  assert.match(workflow, /migration:postvalidate:production/);
});

test('historical postvalidation has explicit origin input and read-only artifact permission',()=>{
 assert.match(workflow,/audit_run_id:/);assert.match(workflow,/actions: read/);assert.doesNotMatch(workflow,/actions: write/);
 assert.match(workflow,/test "\$ACTOR_ID" = "\$OWNER_ID"/);
 assert.match(workflow,/AUDIT_RUN_ID: \$\{\{ inputs.audit_run_id \}\}/);
 assert.match(workflow,/TRUSTED_WORKFLOW_SHA: \$\{\{ github.workflow_sha \}\}/);
 assert.match(workflow,/TRUSTED_WORKFLOW_REF: \$\{\{ github.workflow_ref \}\}/);
 const origin=workflow.indexOf('- name: Authenticate original historical audit before D1 credentials');
 assert.ok(origin>0&&origin<workflow.indexOf('- name: Validate protected credential presence'));
 assert.match(workflow,/--audit-report \.tmp\/production-migrations\/original-audit.json --approval "\$APPROVAL_HASH"/);
});
test('fixed historical selector is separate from generic migrations and version gated',()=>{
 assert.match(workflow,/HISTORICAL_OPERATOR_CONTRACT!=='historical-0044-operator-v1'/);
 assert.match(workflow,/await validateHistoricalOperatorSources\(\)/);
 assert.match(workflow,/test ! -e "migrations\/\$MIGRATION"/);
 assert.match(workflow,/else\s+test -f "migrations\/\$MIGRATION"/);
 const validation=workflow.slice(workflow.indexOf('case "$MODE" in'),workflow.indexOf('- name: Checkout canonical product branch'));
 assert.match(validation,/audit\)[\s\S]*?test -z "\$AUDIT_RUN_ID"/);
 assert.match(validation,/apply\)[\s\S]*?test -z "\$AUDIT_RUN_ID"/);
 assert.match(validation,/postvalidate\)[\s\S]*?0044_organization_permanent_deletion_historical.sql[\s\S]*?AUDIT_RUN_ID/);
});

test('historical apply is denied before gate and again before fresh audit; audit identity is not approval',()=>{const clauses=[...workflow.matchAll(/            apply\)\r?\n([^\n]*)/g)];assert.equal(clauses.length,2);for(const c of clauses)assert.match(c[1],/test "\$MIGRATION" != "0044_organization_permanent_deletion_historical.sql"/);assert.match(workflow,/BLOCKED_TRANSPORT_NOT_AUTHORIZATION/);assert.match(workflow,/process.stdout.write\(r.evidenceIdentity\)/);assert.doesNotMatch(workflow,/approval_token="\$supplied_hash"/);});
