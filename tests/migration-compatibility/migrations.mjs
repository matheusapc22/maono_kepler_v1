import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = [['0039_project_save_operations.sql', '0ef8d78946235a089b754f818e35c83aa3a754a2e3092d09d86c88248cd98ab8'], ['0040_project_preview_operations.sql', 'de1937e98e405fdf2ebb2c13e6b077a4ff3b767580559fbcb279b331e1cc5202']];
export const migrationStage = Number(process.env.MAONO_COMPAT_STAGE || 0);
export function applyCompatibilityMigrations(db, stage = migrationStage) {
  assert.ok([0, 39, 40].includes(stage));
  db.exec(readFileSync(new URL('../../migrations/0019_save_deploy_contract.sql', import.meta.url), 'utf8'));
  for (const [name, sha] of files) {
    if (Number(name.slice(0, 4)) > stage) continue;
    const sql = readFileSync(new URL(`../../migrations/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(sql).digest('hex'), sha);
    db.exec(sql.toString());
  }
  assertCompatibilityInvariants(db, stage);
}
export function assertCompatibilityInvariants(db, stage = migrationStage) {
  assert.equal(db.prepare('SELECT schema_version FROM app_schema_metadata WHERE id=1').get().schema_version, 19);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  if (stage >= 39) {
    for (const table of ['project_save_operations', 'project_save_outbox']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `pre-cutover ${table} stays empty`);
    assert.equal(db.prepare('SELECT count(*) n FROM project_config_revisions WHERE save_operation_id IS NOT NULL').get().n, 0);
  }
  if (stage >= 40) {
    for (const table of ['project_preview_operations', 'project_preview_outbox']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `pre-cutover ${table} stays empty`);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM projects WHERE preview_artifact_id IS NOT NULL OR preview_operation_id IS NOT NULL OR preview_operation_epoch <> 0').get().n, 0);
  }
}
