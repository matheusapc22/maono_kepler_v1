import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// No product checkout, dependency install, real credential or network is used.
const workflow = readFileSync(new URL('../.github/workflows/production-d1-migration-operator.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = '0042_organization_management.sql';
const git = process.platform === 'win32' ? spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }) : null;
if (git) assert.equal(git.status, 0, 'Git for Windows is required for the real Bash contracts');
const bash = git ? resolve(git.stdout.trim(), '../../../bin/bash.exe') : 'bash';

function stepBody(name, source = workflow) {
  const start = source.indexOf('      - name: ' + name + '\n');
  assert.notEqual(start, -1, 'missing workflow step: ' + name);
  const end = source.indexOf('\n      - ', start + 1);
  const step = source.slice(start, end < 0 ? undefined : end);
  const run = step.indexOf('        run: |\n');
  assert.notEqual(run, -1, 'missing Bash block: ' + name);
  return step.slice(run + '        run: |\n'.length).split('\n')
    .filter(line => line.startsWith('          ') || !line.trim())
    .map(line => line.slice(10)).join('\n');
}

const inputGate = stepBody('Validate owner, dispatch ref and explicit inputs');
const operation = stepBody('Execute protected migration operation');
const baseEnv = {
  ACTOR: 'synthetic-owner', OWNER: 'synthetic-owner', DISPATCH_REF: 'main',
  MODE: 'organization-qa-inventory', MIGRATION: migration, APPROVAL_HASH: '',
  VALIDATED_RELEASE_SHA: '1'.repeat(40), GITHUB_STEP_SUMMARY: 'summary.txt',
};

function runShell(t, script, changes = {}, prefix = '') {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-dispatcher-contract-'));
  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    assert.ok(cwd.startsWith(join(tmpdir(), 'qa-dispatcher-contract-')));
    rmSync(cwd, { recursive: true, force: true });
  });
  // Deliberately construct a minimal environment: never inherit CF credentials.
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP, TMP: process.env.TMP, ...baseEnv, ...changes };
  const result = spawnSync(bash, ['--noprofile', '--norc', '-s'], {
    cwd, env, input: prefix + '\n' + script, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.error, undefined);
  const read = path => { try { return readFileSync(join(cwd, path), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };
  return { ...result, read };
}

test('dispatch and PR contracts are the only triggers; PR cannot reach protected jobs', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(?:push|schedule|pull_request_target)\s*:/m);
  assert.match(workflow, /contracts:\n    if: github.event_name == 'pull_request'/);
  for (const job of ['validate', 'remote']) assert.match(workflow, new RegExp(job + ":\\n    if: github.event_name == 'workflow_dispatch'"));
  assert.match(workflow, /node --test tests\/production-migration-actions-workflow.test.mjs/);
});

test('inventory adds only a fixed choice, not arbitrary executable inputs', () => {
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
  assert.deepEqual([...inputs.matchAll(/^      ([a-z_]+):$/gm)].map(m => m[1]), ['mode', 'migration', 'approval_hash']);
  assert.deepEqual([...inputs.matchAll(/^          - (.+)$/gm)].map(m => m[1]), ['audit', 'apply', 'postvalidate', 'organization-qa-inventory']);
});

function assertCredentialBoundary(source) {
  assert.match(source, /permissions:\n  contents: read/);
  assert.match(source, /^  remote:\n[\s\S]*?^    needs: validate\n[\s\S]*?^    environment: production-d1-migrations$/m);
  assert.doesNotMatch(source, /remote:[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:[\s\S]*?steps:/);
  const expected = 'CLOUDFLARE_API_TOKEN: ${{ secrets.MAONO_D1_MIGRATION_API_TOKEN }}';
  assert.equal(source.split(expected).length - 1, 2);
  assert.doesNotMatch(source.slice(0, source.indexOf('\n  remote:')), /\$\{\{\s*secrets\.|^\s*CLOUDFLARE_API_TOKEN:/m);
  for (const name of ['Validate protected credential presence and fixed target', 'Execute protected migration operation']) {
    const start = source.indexOf('      - name: ' + name);
    const end = source.indexOf('\n      - ', start + 1);
    assert.ok(source.slice(start, end < 0 ? undefined : end).includes(expected));
  }
}

test('Environment and credential scope remain exclusive to two protected runner steps', () => assertCredentialBoundary(workflow));
test('credential contract detects removal of the human Environment gate', () => {
  assert.throws(() => assertCredentialBoundary(workflow.replace('\n    environment: production-d1-migrations\n', '\n    environment: unprotected\n')));
});
test('credential contract detects a secret exposed before the Environment', () => {
  assert.throws(() => assertCredentialBoundary(workflow.replace('    outputs:', '    env:\n      CLOUDFLARE_API_TOKEN: ${{ secrets.MAONO_D1_MIGRATION_API_TOKEN }}\n    outputs:')));
});

test('actions are immutable pinned, timeouts and serialization are retained', () => {
  const pins = new Set(['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a']);
  for (const [, action] of workflow.matchAll(/uses: (\S+)/g)) assert.ok(pins.has(action), action);
  assert.match(workflow, /concurrency:\n  group: maono-production-d1-migrations\n  cancel-in-progress: false/);
  assert.deepEqual([...workflow.matchAll(/timeout-minutes: (\d+)/g)].map(m => Number(m[1])), [3, 8, 35]);
});

test('product is pinned and drift checked before credential access', () => {
  assert.match(workflow, /PRODUCT_BRANCH: mano_kepler_v1/);
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/);
  const drift = workflow.indexOf('name: Refuse product-branch drift before remote access');
  const secret = workflow.indexOf('CLOUDFLARE_API_TOKEN: ${{ secrets.');
  assert.ok(drift > 0 && secret > drift);
  assert.match(stepBody('Refuse product-branch drift before remote access'), /test "\$current" = "\$VALIDATED_RELEASE_SHA"/);
  assert.match(workflow, /PRODUCTION_D1_NAME: maono_maps/);
  assert.match(workflow, /PRODUCTION_D1_ID: 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db/);
});

test('product validation checks both collector modules without credentials', () => {
  const validation = stepBody('Validate operator contracts without Cloudflare credentials');
  assert.match(validation, /node --check scripts\/migrations\/organization-qa-inventory.mjs/);
  assert.match(validation, /node --check scripts\/migrations\/inventory-organizations-production.mjs/);
  assert.match(validation, /npm run test:production-migration-gate/);
});

test('audit, apply and postvalidate remain separate; apply requires matching fresh audit', () => {
  assert.match(inputGate, /\[\[ "\$APPROVAL_HASH" =~ \^\[0-9a-fA-F\]\{64\}\$ \]\]/);
  const apply = operation.match(/  apply\)\n([\s\S]*?)    ;;/)[1];
  assert.ok(apply.indexOf('migration:audit:production') < apply.indexOf('test "$current_hash" = "$supplied_hash"'));
  assert.ok(apply.indexOf('test "$current_hash" = "$supplied_hash"') < apply.indexOf('migration:apply:production'));
  assert.match(operation, /delete r\.approval\.token/);
  assert.match(operation, /delete r\.applyCommand/);
  assert.doesNotMatch(operation, /wrangler\s+d1\s+migrations\s+apply/i);
  assert.match(operation, /migration:postvalidate:production/);
});

test('inventory branch has no audit/apply/acceptance or arbitrary network path', () => {
  for (const block of [inputGate, operation]) {
    const inventory = block.match(/  organization-qa-inventory\)\n([\s\S]*?)    ;;/)[1];
    assert.match(inventory, /test -z "\$APPROVAL_HASH"/);
    assert.match(inventory, /test "\$MIGRATION" = "0042_organization_management.sql"/);
    assert.doesNotMatch(inventory, /migration:apply|migration:audit|acceptance:|wrangler|curl|fetch/);
  }
  assert.match(operation, /\*\) exit 2 ;;/);
});

test('inventory artifact is a single JSON with three-day retention; legacy evidence unchanged', () => {
  assert.ok(workflow.includes("path: ${{ inputs.mode == 'organization-qa-inventory' && '.tmp/production-migrations/organization-qa-inventory.json' || '.tmp/production-migrations/*.json' }}"));
  assert.ok(workflow.includes("retention-days: ${{ inputs.mode == 'organization-qa-inventory' && 3 || 14 }}"));
});

for (const [name, changes, status] of [
  ['valid inventory', {}, 0],
  ['wrong owner', { ACTOR: 'other' }, 1],
  ['wrong ref', { DISPATCH_REF: 'feature' }, 1],
  ['wrong migration', { MIGRATION: '0043_other.sql' }, 1],
  ['approval supplied to inventory', { APPROVAL_HASH: 'a'.repeat(64) }, 1],
  ['unknown mode', { MODE: 'arbitrary-sql' }, 2],
  ['migration injection', { MIGRATION: '0042_x.sql; exit 0' }, 1],
  ['audit unchanged', { MODE: 'audit' }, 0],
  ['postvalidate unchanged', { MODE: 'postvalidate' }, 0],
  ['apply without approval', { MODE: 'apply' }, 1],
  ['apply malformed approval', { MODE: 'apply', APPROVAL_HASH: 'invalid' }, 1],
  ['apply syntax unchanged', { MODE: 'apply', APPROVAL_HASH: 'a'.repeat(64) }, 0],
]) test('real input Bash: ' + name, t => assert.equal(runShell(t, inputGate, changes).status, status));

// Stub only the command boundary. Run the real operation Bash in an empty temp
// directory, record exact argv, and never execute npm or any product/D1 script.
const stub = 'npm() { printf "%s\\n" "$@" >> invoked-args.txt; return "${STUB_EXIT:-0}"; }';
for (const [name, changes, status, called] of [
  ['valid inventory', {}, 0, true],
  ['wrong migration', { MIGRATION: '0043_other.sql' }, 1, false],
  ['unexpected approval', { APPROVAL_HASH: 'a'.repeat(64) }, 1, false],
  ['unknown mode', { MODE: 'arbitrary-sql' }, 2, false],
  ['collector failure propagated', { STUB_EXIT: '7' }, 7, true],
]) test('real protected operation Bash with local stub: ' + name, t => {
  const result = runShell(t, operation, changes, stub);
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.read('invoked-args.txt'), called ? ['run', 'migration:inventory:organizations', '--', '--migration', migration, '--report', '.tmp/production-migrations/organization-qa-inventory.json', ''].join('\n') : '');
  if (status === 0) assert.match(result.read('summary.txt'), /writes performed: NO; no acceptance or flag changes/);
  else assert.equal(result.read('summary.txt'), '');
});

test('real drift guard rejects a moved product before later steps', t => {
  const script = stepBody('Refuse product-branch drift before remote access');
  const result = runShell(t, script, { PRODUCT_BRANCH: 'mano_kepler_v1' }, 'git() { printf "%s\\n" "2222222222222222222222222222222222222222 refs/heads/mano_kepler_v1"; }');
  assert.equal(result.status, 1);
});

test('real drift guard accepts the exact pinned product SHA', t => {
  const script = stepBody('Refuse product-branch drift before remote access');
  const result = runShell(t, script, { PRODUCT_BRANCH: 'mano_kepler_v1' }, 'git() { printf "%s\\n" "1111111111111111111111111111111111111111 refs/heads/mano_kepler_v1"; }');
  assert.equal(result.status, 0);
});
