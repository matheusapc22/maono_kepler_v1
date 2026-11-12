// Complete historical structural projection + test-only guards; synthetic defaults, never operational certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {readFileSync} from 'node:fs';
import {historicalExecutionSchema as proofSchema,requireEpochSingletons} from './helpers/deletion-historical-execution.mjs';
import {startDeletion,stepDeletion,deletionPreview} from '../functions/_lib/organization-permanent-deletion.js';
const actor={id:1,role:'super_admin'};
const absent=async()=>{throw Object.assign(new Error('Synthetic missing'),{code:'DROPBOX_PATH_NOT_FOUND'});};
const storage={metadata:absent,metadataLegacy:absent,metadataId:absent};
function fixture(t,hooks={}){
 const f=persistenceFixture(t,{...hooks,schemaSql:hooks.schemaSql??proofSchema()});
 requireEpochSingletons(f.db);
 f.env.ORGANIZATION_PERMANENT_DELETE_V1='true';
 f.db.exec(`INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at) VALUES(3,'Delete','delete-proof','/projects/delete-proof',0,'DISABLED','2020-01-01 00:00:00');
 INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(3,1,'owner');
 UPDATE organizations SET management_owner_id=1 WHERE id=3;
 UPDATE organizations SET updated_at='2020-01-01 00:00:00' WHERE id=3;
 INSERT INTO organization_access_delegations(id,organization_id,delegate_user_id,granted_by,updated_by) VALUES(31,3,1,1,1),(21,2,1,1,1);
 INSERT INTO delegation_permissions(delegation_id,permission) VALUES(31,'projects.view'),(21,'projects.view');
 INSERT INTO delegation_target_levels(delegation_id,access_level) VALUES(31,'viewer'),(21,'viewer');
 INSERT INTO user_permission_denials(user_id,organization_id,permission) VALUES(1,3,'projects.edit'),(1,2,'projects.edit');
 INSERT INTO user_permissions(user_id,permission,organization_id) VALUES(1,'proof.local',3),(1,'proof.global',NULL),(1,'proof.other',2);
 UPDATE sessions SET active_organization_id=3 WHERE user_id=1;`);
 f.start=async()=>{const result=await startDeletion(f.env,actor,3,crypto.randomUUID(),{version:f.db.prepare('SELECT management_version v FROM organizations WHERE id=3').get().v,confirmation:'EXCLUIR PERMANENTEMENTE'});f.db.exec("UPDATE organization_deletions SET not_before='2020-01-01T00:00:00Z' WHERE organization_id=3");return result.deletion;};
 f.step=async d=>(await stepDeletion(f.env,actor,d.id,{deletionStorage:storage})).deletion;
 return f;
}
test('real runtime delegation-first SQL preserves other org/global grants, cascades only target ACL, archives and detaches',async t=>{
 const f=fixture(t);const before=f.db.prepare('SELECT version FROM project_save_authorization_generation').get().version;
 const exportBefore=f.db.prepare('SELECT version FROM ticket_export_generation').get().version;
 const d=await f.start();assert.equal((await f.step(d)).state,'completed');
 const finalAssertion=f.sqlCalls.find(x=>x.kind==='batch'&&x.sql.startsWith('INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_deletions'));
 assert.ok(finalAssertion);
 const coverage=JSON.parse(readFileSync(new URL('./fixtures/deletion-historical-safety/business-seed-manifest.json',import.meta.url),'utf8')).coverage;
 assert.equal(coverage.length,68);
 for(const {table} of coverage)assert.ok(finalAssertion.sql.includes('NOT EXISTS(SELECT 1 FROM "'+table+'" WHERE organization_id=?)'),'final veto '+table);
 assert.deepEqual(finalAssertion.args.slice(2),Array(69).fill(3)); // 68 business predicates + mixed-scope ACL predicate.
 assert.equal(f.db.prepare('SELECT id FROM organizations WHERE id=3').get(),undefined);
 assert.deepEqual(f.db.prepare('SELECT id,enabled FROM organization_access_delegations').all().map(r=>[r.id,r.enabled]),[[21,1]]);
 for(const name of ['delegation_permissions','delegation_target_levels'])assert.deepEqual(f.db.prepare('SELECT delegation_id FROM '+name).all().map(r=>r.delegation_id),[21]);
 assert.deepEqual(f.db.prepare('SELECT permission FROM user_permissions ORDER BY permission').all().map(r=>r.permission),['proof.global','proof.other']);
 assert.equal(f.db.prepare('SELECT count(*) n FROM user_permission_denials WHERE organization_id=2').get().n,1);
 assert.equal(f.db.prepare('SELECT active_organization_id FROM sessions WHERE user_id=1').get().active_organization_id,null);
 assert.equal(f.db.prepare('SELECT active_organization_id FROM sessions WHERE user_id=2').get().active_organization_id,2);
 assert.ok(f.db.prepare('SELECT count(*) n FROM organization_deleted_management_events WHERE organization_id=3').get().n>0);
 // Exact effects: org claim update + membership/denial/grant delete + org delete.
 assert.equal(f.db.prepare('SELECT version FROM project_save_authorization_generation').get().version-before,5);
 // Export epoch has no user_permissions trigger: the other four effects remain.
 assert.equal(f.db.prepare('SELECT version FROM ticket_export_generation').get().version-exportBefore,4);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
function project(f,org=2){f.db.prepare("INSERT INTO projects(id,name,slug,dropbox_root_path,organization_id) VALUES(99,'Project','proof-project','/proof/project',?)").run(org);}
for(const active of [0,1])test('mixed project ACL veto independent of active/expiry '+active,async t=>{
 const f=fixture(t);project(f);f.db.prepare("INSERT INTO user_permissions(user_id,permission,organization_id,project_id,active,expires_at) VALUES(1,'proof.mixed',3,99,?,'2000-01-01')").run(active);
 const preview=await deletionPreview(f.env,3);assert.ok(preview.blockers.some(b=>b.code==='MIXED_SCOPE_PERMISSION'&&b.count===1));
 await assert.rejects(f.start,e=>e.code==='ORGANIZATION_DELETE_BLOCKED');
 assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deletions').get().n,0);
 assert.ok(f.db.prepare("SELECT 1 FROM user_permissions WHERE permission='proof.mixed'").get());
});
test('project-only ACL remains intact and frozen direct ACL cannot become mixed after claim',async t=>{
 const f=fixture(t);project(f);f.db.exec("INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'proof.project',NULL,99)");
 const d=await f.start();
 assert.throws(()=>f.db.exec("UPDATE user_permissions SET project_id=99 WHERE organization_id=3"),/ORGANIZATION_DELETION_LOCKED/);
 assert.throws(()=>f.db.exec("INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'new',3,99)"),/ORGANIZATION_DELETION_LOCKED/);
 assert.equal((await f.step(d)).state,'completed');
 assert.equal(f.db.prepare("SELECT project_id FROM user_permissions WHERE permission='proof.project'").get().project_id,99);
});
test('project parent without organization FK still vetoes inactive business data',async t=>{
 const f=fixture(t);project(f,3);f.db.exec('UPDATE projects SET active=0 WHERE id=99');
 const p=await deletionPreview(f.env,3);assert.equal(p.eligible,false);assert.ok(p.blockers.some(b=>b.code==='LINKED_DATA'));
 await assert.rejects(f.start);assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deletions').get().n,0);
});
test('failure after cascades rolls back actual SQLite archive, detach, ACL and epoch effects',async t=>{
 const f=fixture(t);const d=await f.start();
 f.db.exec("CREATE TRIGGER proof_final_fail BEFORE DELETE ON organizations WHEN OLD.id=3 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END;");
 const before=f.db.prepare('SELECT version FROM project_save_authorization_generation').get().version;
 const exportBefore=f.db.prepare('SELECT version FROM ticket_export_generation').get().version;
 const result=await f.step(d);assert.equal(result.state,'storage_deleted');
 assert.ok(f.db.prepare('SELECT 1 FROM organization_access_delegations WHERE id=31').get());
 assert.ok(f.db.prepare('SELECT 1 FROM delegation_permissions WHERE delegation_id=31').get());
 assert.equal(f.db.prepare('SELECT active_organization_id FROM sessions WHERE user_id=1').get().active_organization_id,3);
 assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deleted_management_events').get().n,0);
 assert.equal(f.db.prepare('SELECT version FROM project_save_authorization_generation').get().version,before);
 assert.equal(f.db.prepare('SELECT version FROM ticket_export_generation').get().version,exportBefore);
});
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('physical second writer committed before claim is caught by atomic business assertion',async t=>{
 const f=fixture(t),dir=mkdtempSync(join(tmpdir(),'deletion-physical-'));
 const path=join(dir,'proof.sqlite');await backup(f.db,path);const a=new DatabaseSync(path),b=new DatabaseSync(path);t.after(()=>{b.close();a.close();rmSync(dir,{recursive:true,force:true});});
 f.sqlCalls.length=0;await f.start();const claim=f.sqlCalls.filter(s=>s.kind==='batch'&&/^(INSERT|UPDATE)/.test(s.sql));
 b.exec("INSERT INTO projects(name,slug,dropbox_root_path,organization_id) VALUES('Late','late-project','/late',3)");
 a.exec('BEGIN IMMEDIATE');assert.throws(()=>{for(const s of claim)a.prepare(s.sql).run(...s.args);},/CHECK constraint failed/);a.exec('ROLLBACK');
 assert.equal(a.prepare('SELECT count(*) n FROM organization_deletions').get().n,0);
 assert.equal(a.prepare('SELECT count(*) n FROM projects WHERE organization_id=3').get().n,1);
});
test('physical stale writer cannot insert or reparent direct business after committed claim',async t=>{
 const f=fixture(t);project(f,2);const dir=mkdtempSync(join(tmpdir(),'deletion-physical-'));
 const path=join(dir,'proof.sqlite');await backup(f.db,path);const a=new DatabaseSync(path),b=new DatabaseSync(path);t.after(()=>{b.close();a.close();rmSync(dir,{recursive:true,force:true});});
 a.exec('PRAGMA journal_mode=WAL');b.exec('PRAGMA journal_mode=WAL; BEGIN');b.prepare('SELECT count(*) FROM projects').get();
 f.sqlCalls.length=0;await f.start();const claim=f.sqlCalls.filter(s=>s.kind==='batch'&&/^(INSERT|UPDATE)/.test(s.sql));
 a.exec('BEGIN IMMEDIATE');for(const s of claim)a.prepare(s.sql).run(...s.args);a.exec('COMMIT');
 assert.throws(()=>b.exec('UPDATE projects SET organization_id=3 WHERE id=99'),/locked/);b.exec('ROLLBACK');
 assert.throws(()=>b.exec('UPDATE projects SET organization_id=3 WHERE id=99'),/ORGANIZATION_DELETION_LOCKED/);
 assert.throws(()=>b.exec("INSERT INTO projects(name,slug,dropbox_root_path,organization_id) VALUES('Late','late-project','/late',3)"),/ORGANIZATION_DELETION_LOCKED/);
 assert.equal(b.prepare('SELECT organization_id FROM projects WHERE id=99').get().organization_id,2);
});


for(const kind of ['null-owner','dangling'])test('mixed scope veto does not infer project owner: '+kind,async t=>{
 const f=fixture(t);if(kind==='null-owner')project(f,null);else f.db.exec('PRAGMA foreign_keys=OFF');
 f.db.exec("INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'proof.invalid-owner',3,99)");
 f.db.exec('PRAGMA foreign_keys=ON');
 const preview=await deletionPreview(f.env,3);assert.ok(preview.blockers.some(b=>b.code==='MIXED_SCOPE_PERMISSION'&&b.count===1));
 await assert.rejects(f.start,e=>e.code==='ORGANIZATION_DELETE_BLOCKED');
 assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deletions').get().n,0);
});
test('step preflight blocks mixed scope under explicit test-only guard drift',async t=>{
 const f=fixture(t);project(f);const d=await f.start();
 const guard=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='org_delete_guard_user_permissions_insert'").get().sql;
 // Deliberate test-only fault injection, never part of candidate/runtime workflow.
 f.db.exec("DROP TRIGGER org_delete_guard_user_permissions_insert; INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'proof.drift',3,99)");f.db.exec(guard);
 const result=await f.step(d);assert.equal(result.state,'pending');assert.equal(result.errorCode,'ORGANIZATION_DELETE_BLOCKED');
 assert.ok(f.db.prepare('SELECT 1 FROM organization_access_delegations WHERE id=31').get());
 assert.ok(f.db.prepare('SELECT 1 FROM organizations WHERE id=3').get());
 assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deleted_management_events').get().n,0);
 assert.equal(f.db.prepare('SELECT active_organization_id FROM sessions WHERE user_id=1').get().active_organization_id,3);
});

for(const phase of ['claim','final'])test('real atomic '+phase+' assertion rejects mixed scope introduced after inventory',async t=>{
 let injected=false;
 const f=fixture(t,{beforeBatch:({db,statements})=>{
  const hit=phase==='claim'?statements.some(s=>s.sql.startsWith('INSERT INTO organization_deletions(')):statements.some(s=>s.sql==='DELETE FROM organizations WHERE id=?');
  if(!hit||injected)return;injected=true;
  const guard=db.prepare("SELECT sql FROM sqlite_master WHERE name='org_delete_guard_user_permissions_insert'").get().sql;
  // Explicit local fault injection between preflight and batch, not a runtime bypass.
  db.exec("DROP TRIGGER org_delete_guard_user_permissions_insert; INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'proof.race',3,99)");db.exec(guard);
 }});project(f);
 if(phase==='claim'){await assert.rejects(f.start,/CHECK constraint failed/);assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deletions').get().n,0);}
 else {const d=await f.start();const result=await f.step(d);assert.equal(result.state,'storage_deleted');assert.equal(result.errorCode,'ORGANIZATION_DELETE_INTERRUPTED');}
 assert.equal(injected,true);assert.ok(f.db.prepare('SELECT 1 FROM organization_access_delegations WHERE id=31').get());
 assert.equal(f.db.prepare('SELECT count(*) n FROM organization_deleted_management_events').get().n,0);
 assert.equal(f.db.prepare('SELECT active_organization_id FROM sessions WHERE user_id=1').get().active_organization_id,3);
 const assertions=f.sqlCalls.filter(x=>x.kind==='batch'&&x.sql.startsWith('INSERT INTO organization_management_assertions(ok) SELECT CASE'));
 assert.ok(assertions.length>0);assert.ok(assertions.every(x=>x.sql.includes('NOT EXISTS(SELECT 1 FROM user_permissions WHERE organization_id=? AND project_id IS NOT NULL)')));
});
import {onRequest} from '../functions/api/admin/organization-management/[[path]].js';
test('HTTP preview returns safe mixed-scope blocker and UI has specific review message',async t=>{
 const f=fixture(t);project(f);f.env.ORGANIZATION_MANAGEMENT_V1='true';f.db.exec("UPDATE users SET role='super_admin' WHERE id=1; INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'proof.mixed',3,99)");
 const response=await onRequest({env:f.env,request:new Request('https://local.invalid/api/admin/organization-management/organizations/3/deletion-preview',{headers:f.headers(1)})});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.eligible,false);assert.deepEqual(body.blockers.find(x=>x.code==='MIXED_SCOPE_PERMISSION'),{code:'MIXED_SCOPE_PERMISSION',count:1});
 const ui=readFileSync(new URL('../src/pages/Admin/organizations/OrganizationDeletionPanel.tsx',import.meta.url),'utf8');assert.match(ui,/MIXED_SCOPE_PERMISSION:'Permissões vinculadas também a projetos exigem revisão antes da exclusão'/);
});

import {fixtureManifest} from './helpers/deletion-historical-fixture.mjs';
for(const [slot,spec] of Object.entries(fixtureManifest.syntheticDefaults))test('cleanup invariant under declared synthetic scalar variation: '+slot,async t=>{
 const object=fixtureManifest.objects.find(o=>o.name===slot.split('.')[0]);
 const old=typeof spec.representative==='number'?String(spec.representative):"'"+spec.representative+"'";
 const replacement=spec.literalType==='number'?'29':"'another local representative'";
 const schema=proofSchema().replace(object.sql,object.sql.replace('DEFAULT '+old,'DEFAULT '+replacement));
 assert.notEqual(schema,proofSchema());
 const f=fixture(t,{schemaSql:schema});
 f.db.exec("UPDATE user_permissions SET active=0,expires_at='2000-01-01'; UPDATE organization_access_delegations SET enabled=0 WHERE organization_id=3");
 const d=await f.start();assert.equal((await f.step(d)).state,'completed');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE organization_id=3').get().n,0);
 assert.deepEqual(f.db.prepare('SELECT permission FROM user_permissions ORDER BY permission').all().map(x=>x.permission),['proof.global','proof.other']);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_permission_denials WHERE organization_id=2').get().n,1);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
