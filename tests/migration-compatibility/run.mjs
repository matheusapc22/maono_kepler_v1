import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Historical pre-cutover proof, not a second writer shipped with the application.
const productSha = 'e12abfd908af81b0c55f2671ec71b161f820ef63';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const evidence = join(root, 'test-results/migration-compatibility');
const migrations = {
  '0039_project_save_operations.sql': '0ef8d78946235a089b754f818e35c83aa3a754a2e3092d09d86c88248cd98ab8',
  '0040_project_preview_operations.sql': 'de1937e98e405fdf2ebb2c13e6b077a4ff3b767580559fbcb279b331e1cc5202',
};
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const report = { productSha, migrations, node: process.version, status: 'running', stages: [], unchangedProductFiles: 0 };
mkdirSync(evidence, { recursive: true });
// Invalidate a previous local success before preflight can fail.
writeFileSync(join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const stage of [0, 39, 40]) rmSync(join(evidence, `stage-${stage}.tap`), { force: true });
let workspace;
try {
  assert.equal(git('rev-parse', `${productSha}^{commit}`).toString().trim(), productSha,
    'Fetch repository history first; CI uses checkout with fetch-depth: 0.');
  for (const [name, hash] of Object.entries(migrations)) {
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'migrations', name))).digest('hex'), hash,
      `${name} must match the reviewed, frozen SQL bytes`);
  }
  workspace = mkdtempSync(join(tmpdir(), 'maono-legacy-migration-compat-'));
  // Use actual product sources from Git, never a copied production fork in this PR.
  execFileSync('tar', ['-x', '-C', workspace], { input: git('archive', productSha), maxBuffer: 64 * 1024 * 1024 });
  const sourceFiles = git('ls-tree', '-r', '--name-only', '-z', productSha).toString().split('\0').filter(Boolean);
  const sourceHashes = new Map(sourceFiles.map(path => [path,
    createHash('sha256').update(readFileSync(join(workspace, path))).digest('hex')]));
  cpSync(here, join(workspace, 'tests/migration-compatibility'), { recursive: true });
  for (const name of Object.keys(migrations)) cpSync(join(root, 'migrations', name), join(workspace, 'migrations', name));

  // Only the existing test fixture is instrumented, in the disposable checkout.
  // Production functions, frontend, schema, dependencies and original assertions stay byte-identical.
  const fixture = join(workspace, 'tests/helpers/project-persistence-fixture.mjs');
  const originalFixture = readFileSync(fixture, 'utf8');
  let injected = originalFixture;
  const replaceOnce = (before, after) => {
    assert.equal(injected.split(before).length, 2, 'Pinned fixture seam must match exactly once');
    injected = injected.replace(before, after);
  };
  replaceOnce('import { DatabaseSync } from "node:sqlite";',
    'import { DatabaseSync } from "node:sqlite";\nimport { applyCompatibilityMigrations, assertCompatibilityInvariants } from "../migration-compatibility/migrations.mjs";');
  replaceOnce('  db.exec(readFileSync(new URL("../../schema.sql", import.meta.url), "utf8"));',
    '  db.exec(readFileSync(new URL("../../schema.sql", import.meta.url), "utf8"));\n  applyCompatibilityMigrations(db, hooks.compatibilityStage);');
  replaceOnce('  t.after(() => db.close());',
    '  t.after(() => { try { assertCompatibilityInvariants(db); } finally { db.close(); } });');
  writeFileSync(fixture, injected);

  let failed = false;
  for (const stage of [0, 39, 40]) {
    const result = spawnSync(process.execPath, [
      '--import', './tests/migration-compatibility/no-network.mjs',
      '--experimental-strip-types', '--test', '--test-reporter=tap',
      'tests/migration-compatibility/handlers.test.mjs',
      'tests/project-persistence-integration.test.mjs',
      'tests/project-recycle-recovery.test.mjs',
    ], { cwd: workspace, env: { ...process.env, MAONO_COMPAT_STAGE: String(stage) },
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000 });
    const tap = `${result.stdout || ''}${result.stderr || ''}`;
    writeFileSync(join(evidence, `stage-${stage}.tap`), tap);
    const count = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
    const passed = result.status === 0 && count('tests') === 40 && count('pass') === 40
      && count('fail') === 0 && count('cancelled') === 0 && count('skipped') === 0;
    report.stages.push({ stage, passed, tests: count('tests'), pass: count('pass'), fail: count('fail'),
      cancelled: count('cancelled'), skipped: count('skipped'), exitCode: result.status,
      error: result.error?.message ?? null });
    console.log(`Legacy runtime ${productSha.slice(0, 7)}, schema stage ${stage}: ${passed ? 'PASS 40/40' : 'FAIL'}`);
    if (!passed) { failed = true; console.error(tap.slice(-12_000)); }
  }
  writeFileSync(fixture, originalFixture);
  for (const [path, hash] of sourceHashes) {
    assert.equal(createHash('sha256').update(readFileSync(join(workspace, path))).digest('hex'), hash,
      `Pinned product source changed: ${path}`);
  }
  report.unchangedProductFiles = sourceHashes.size;
  assert.equal(failed, false, 'Every schema stage must pass all 40 compatibility cases');
  report.status = 'passed';
  console.log(`Verified ${sourceHashes.size} unchanged product files; evidence: ${evidence}`);
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  throw error;
} finally {
  writeFileSync(join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (workspace) rmSync(workspace, { recursive: true, force: true });
}
