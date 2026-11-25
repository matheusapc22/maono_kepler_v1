import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isDeletionBlocker, isDeletionPreview } from '../src/pages/Admin/organizations/organization-deletion-contract.ts';
import development from '../playwright.config.ts';
import audit from '../playwright.operation-audit.config.ts';

test('structured blocker only accepts known domain actions, safe identities and its organization', () => {
  const blocker = { code: 'UNRESOLVED_OPERATION', count: 1, description: 'Consulte a operação anterior.', action: { kind: 'query', enabled: true, organizationId: 11, operationId: '22222222-2222-4222-8222-222222222222', itemIndex: 0 } };
  const preview = { organizationId: 11, name: 'Organização sintética', version: 3, eligible: false, blockers: [blocker], confirmation: 'EXCLUIR PERMANENTEMENTE' };
  assert.equal(isDeletionBlocker(blocker), true); assert.equal(isDeletionPreview(preview, 11), true);
  assert.equal(isDeletionBlocker({ ...blocker, action: { ...blocker.action, kind: 'execute_url' } }), false);
  assert.equal(isDeletionBlocker({ ...blocker, action: { ...blocker.action, operationId: '../private' } }), false);
  assert.equal(isDeletionPreview({ ...preview, blockers: [{ ...blocker, action: { ...blocker.action, organizationId: 99 } }] }, 11), false);
  assert.equal(isDeletionPreview({ ...preview, eligible: true }, 11), false);
});

test('legacy code/count previews remain valid without fabricating a resolver action', () => {
  const blocker = { code: 'LINKED_DATA', count: 2 };
  assert.equal(isDeletionBlocker(blocker), true); assert.equal(blocker.action, undefined);
  assert.equal(isDeletionPreview({ organizationId: 11, name: 'Legada', version: 0, eligible: false, blockers: [blocker], confirmation: 'EXCLUIR PERMANENTEMENTE' }, 11), true);
});

test('audit suites excluded from development retain a mandatory complete flagged compiled gate', () => {
  const suites = ['admin-audit-operations.spec.ts', 'organizations-audit-flow.spec.ts'];
  for (const suite of suites) assert.ok(development.testIgnore.includes(`**/${suite}`));
  assert.deepEqual(audit.testMatch, suites);
  assert.equal(audit.testIgnore, undefined); assert.equal(audit.grep, undefined); assert.equal(audit.grepInvert, undefined);
  assert.equal(audit.webServer.command, 'npm run preview -- --host 127.0.0.1 --port 4198');
  const workflow = readFileSync(new URL('../.github/workflows/operation-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  const steps = workflow.split(/(?=^      - name:)/m);
  const compile = steps.find(step => /^        run: npm run build\s*$/m.test(step));
  assert.ok(compile, 'The compiled artifact is required for the audit browser gate');
  assert.match(compile, /^          VITE_ADMIN_AUDIT_OPERATIONS_V1: 'true'\s*$/m);
  assert.match(compile, /^          VITE_ORGANIZATION_MANAGEMENT_V1: 'true'\s*$/m);
  assert.doesNotMatch(compile, /^        if:/m);
  const browser = steps.find(step => step.includes('--config=playwright.operation-audit.config.ts'));
  assert.ok(browser, 'Excluded suites must retain their required workflow invocation');
  assert.match(browser, /^        run: npx playwright test --config=playwright\.operation-audit\.config\.ts --reporter=list,json\s*$/m);
  assert.doesNotMatch(browser, /^        if:/m);
});
