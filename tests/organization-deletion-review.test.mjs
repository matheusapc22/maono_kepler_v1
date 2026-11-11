import {readFileSync} from 'node:fs';
import {restoreOrganizationDeletionFence} from './helpers/organization-deletion-preservation.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {deletionPreview} from '../functions/_lib/organization-permanent-deletion.js';
function fixture(t){const f=persistenceFixture(t);f.env.ORGANIZATION_PERMANENT_DELETE_V1='true';f.db.exec("UPDATE organizations SET slug='review-empty',dropbox_root_path='/projects/review-empty',active=0,storage_status='DISABLED',updated_at='2000-01-01 00:00:00' WHERE id=1");return f;}
test('review: unknown renamed organization FK blocks even empty future table',async t=>{
  const f=fixture(t);f.db.exec('CREATE TABLE future_business(id INTEGER PRIMARY KEY,tenant_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE)');
  const preview=await deletionPreview(f.env,1);assert.equal(preview.eligible,false);assert.ok(preview.blockers.some(b=>b.code==='UNGUARDED_DEPENDENCY'));
});
test('review: unknown conventional organization column without FK also blocks',async t=>{
  const f=fixture(t);f.db.exec('CREATE TABLE future_business(id INTEGER PRIMARY KEY,organization_id INTEGER)');
  const preview=await deletionPreview(f.env,1);assert.equal(preview.eligible,false);assert.ok(preview.blockers.some(b=>b.code==='UNGUARDED_DEPENDENCY'));
});
test('review: freshly paused storage cannot start deletion while old calls drain',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET updated_at=CURRENT_TIMESTAMP WHERE id=1");
  const preview=await deletionPreview(f.env,1);assert.equal(preview.eligible,false);assert.ok(preview.blockers.some(b=>b.code==='STORAGE_DRAIN_REQUIRED'));
});
test('review: tombstone protects aliases and descendants on insert and update',t=>{
  const f=fixture(t);f.db.exec("INSERT INTO organization_deletions(id,organization_id,actor_id,idempotency_key,requested_version,name,slug,path,creation_key) VALUES('review-deletion',99,1,'review-key-long-enough',0,'Gone','gone','/projects/gone','old-operation:0')");
  for(const path of ['/projects/gone','/PROJECTS/GONE/documents','/projects']){
    assert.throws(()=>f.db.prepare('INSERT INTO organizations(name,slug,dropbox_root_path) VALUES(?,?,?)').run('Attempt','attempt',path),/ORGANIZATION_DELETION_LOCKED/);
    assert.throws(()=>f.db.prepare('UPDATE organizations SET dropbox_root_path=? WHERE id=2').run(path),/ORGANIZATION_DELETION_LOCKED/);
  }
  assert.throws(()=>f.db.prepare('INSERT INTO organizations(name,slug,dropbox_root_path,management_create_key) VALUES(?,?,?,?)').run('Replay','replay','/projects/replay','old-operation:0'),/ORGANIZATION_DELETION_LOCKED/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organizations').get().n,2);
});

test('review: exact fence inverse rejects removed, changed or duplicated approved guards',()=>{
  const path='functions/_lib/organizations.js',source=readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  for(const guard of ['import { assertDropboxPathWritable } from "./dropbox.js";\n','  await assertDropboxPathWritable(env, safePath);\n','    signal: AbortSignal.timeout(8_000),\n']){
    assert.throws(()=>restoreOrganizationDeletionFence(path,source.replace(guard,'')),/exact reviewed organization deletion fence/);
    assert.throws(()=>restoreOrganizationDeletionFence(path,source.replace(guard,guard+guard)),/exact reviewed organization deletion fence/);
  }
  const restored=restoreOrganizationDeletionFence(path,source);
  const drift=source.replace('mode: "add"','mode: "overwrite"');assert.notEqual(drift,source);
  assert.notEqual(restoreOrganizationDeletionFence(path,drift),restored,'unrelated drift is not normalized away');
});
