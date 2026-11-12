import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {historicalExecutionSchema,additionalHistoricalGuards} from './helpers/deletion-historical-execution.mjs';
import {historicalMissingGuardTables,hash,fixtureManifest,fixtureSnapshot} from './helpers/deletion-historical-fixture.mjs';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {deletionPreview,startDeletion} from '../functions/_lib/organization-permanent-deletion.js';
import {evaluateDeletionSchema} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
const schema=historicalExecutionSchema();
const seed=readFileSync(new URL('./fixtures/deletion-historical-safety/business-seed.test.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(readFileSync(new URL('./fixtures/deletion-historical-safety/business-seed-manifest.json',import.meta.url),'utf8'));
const actor={id:1,role:'super_admin'};
const removed=new Set(['organization_users','organization_access_delegations','user_permission_denials','user_permissions']);
const retained=new Set(['organization_management_events','organization_deletions','organization_deleted_management_events']);
function business(db){return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").all().filter(({name})=>!removed.has(name)&&!retained.has(name)&&db.prepare('PRAGMA table_info('+name+')').all().some(c=>c.name==='organization_id')).map(x=>x.name).sort();}
function populated(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(schema);db.exec(seed);return db;}
const lock=(db,id)=>db.prepare("INSERT INTO organization_deletions(id,organization_id,actor_id,idempotency_key,requested_version,name,slug,path) VALUES(?,?,1,?,0,'Test',?,?)").run('lock-'+id,id,'synthetic-lock-key-'+id,'locked-'+id,'/projects/locked-'+id);
test('all 68 explicit business recipes preserve constraints and complete coverage',t=>{
 const db=populated(t);assert.equal(hash(seed),manifest.seedSha256);assert.equal(fixtureManifest.fixtureSha256,manifest.fixture);
 assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 const names=business(db);assert.equal(names.length,68);assert.deepEqual(names,manifest.coverage.map(x=>x.table).sort());
 for(const table of names){assert.ok(db.prepare('SELECT COUNT(*) n FROM "'+table+'" WHERE organization_id=3').get().n>0,table);assert.ok(manifest.provenance.some(p=>p.table===table),'Missing provenance '+table);}
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ticket_message_revisions WHERE organization_id=3').get().n,1); // Real cc05 trigger, not skipped.
});
test('exact ten historical pairs and bounded cleanup FK graph, no operational profile',t=>{
 const db=populated(t);const added=db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'org_delete_guard_%'").all();
 for(const table of historicalMissingGuardTables)for(const kind of ['insert','update'])assert.ok(added.some(x=>x.name==='org_delete_guard_'+table+'_'+kind));
 assert.equal((additionalHistoricalGuards.match(/CREATE TRIGGER /g)||[]).length,20);assert.equal(added.length,144);
 for(const table of historicalMissingGuardTables)for(const kind of ['insert','update']){
  const condition=kind==='insert'?'organization_id=NEW.organization_id':'organization_id=OLD.organization_id OR organization_id=NEW.organization_id';
  const expected=`CREATE TRIGGER org_delete_guard_${table}_${kind} BEFORE ${kind.toUpperCase()} ON "${table}"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE ${condition})
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END`;
  assert.equal(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get('org_delete_guard_'+table+'_'+kind).sql,expected);
 }
 assert.equal(evaluateDeletionSchema(fixtureSnapshot(db)).compatible,false);
 const inbound=[];for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").all())for(const fk of db.prepare('PRAGMA foreign_key_list('+name+')').all())if(removed.has(fk.table))inbound.push([name,fk.table,fk.from,fk.to,fk.on_delete]);
 assert.deepEqual(inbound.sort(),[['delegation_permissions','organization_access_delegations','delegation_id','id','CASCADE'],['delegation_target_levels','organization_access_delegations','delegation_id','id','CASCADE']]);
});
for(const table of historicalMissingGuardTables)test('physical full-fixture INSERT and OLD/NEW matrix: '+table,t=>{
 const db=populated(t);const row=db.prepare('SELECT rowid AS _rowid,* FROM "'+table+'" WHERE organization_id=3 LIMIT 1').get();assert.ok(row);
 const update=org=>db.prepare('UPDATE "'+table+'" SET organization_id=? WHERE rowid=?').run(org,row._rowid);
 // Initial recipe is a successful constrained INSERT with guards installed.
 // Unlocked same-owner and cross-owner updates remain legal on these ten actual table shapes.
 for(const org of [3,2]){db.exec('SAVEPOINT free');update(org);assert.equal(db.prepare('SELECT organization_id x FROM "'+table+'" WHERE rowid=?').get(row._rowid).x,org);db.exec('ROLLBACK TO free;RELEASE free');}
 assert.throws(()=>update(null),/NOT NULL/); // All ten historical columns are NOT NULL, not silently made nullable.
 for(const [locked,newOrg] of [[3,2],[2,2],[3,3],[3,null]]){
  lock(db,locked);assert.throws(()=>update(newOrg),/ORGANIZATION_DELETION_LOCKED/);assert.equal(db.prepare('SELECT organization_id x FROM "'+table+'" WHERE rowid=?').get(row._rowid).x,3);db.exec('DELETE FROM organization_deletions');
 }
 lock(db,3);
 const columns=Object.keys(row).filter(k=>k!=='_rowid'),values=columns.map(k=>row[k]);
 assert.throws(()=>db.prepare('INSERT INTO "'+table+'" ('+columns.map(x=>'"'+x+'"').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...values),/ORGANIZATION_DELETION_LOCKED/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('actual runtime counts all 68 populated tables and atomic claim contains every veto',async t=>{
 const empty=persistenceFixture(t,{schemaSql:schema});empty.env.ORGANIZATION_PERMANENT_DELETE_V1='true';
 empty.db.exec("INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at) VALUES(3,'Empty','empty','/projects/empty',0,'DISABLED','2020-01-01')");
 const version=empty.db.prepare('SELECT management_version v FROM organizations WHERE id=3').get().v;
 await startDeletion(empty.env,actor,3,'synthetic-full-claim-key',{version,confirmation:'EXCLUIR PERMANENTEMENTE'});
 const claim=empty.sqlCalls.find(s=>s.kind==='batch'&&s.sql.startsWith('INSERT INTO organization_management_assertions(ok) SELECT CASE'));assert.ok(claim);
 const full=persistenceFixture(t,{schemaSql:schema});full.env.ORGANIZATION_PERMANENT_DELETE_V1='true';
 // Existing helper owns users1/2 and orgs1/2. Only synthetic org3 is added; remaining fixed recipe is verbatim.
 full.db.exec("INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status) VALUES(3,'Seed target','seed-target','/projects/seed-target',0,'DISABLED');\n"+seed.split('\n').slice(2).join('\n'));
 const names=business(full.db),preview=await deletionPreview(full.env,3);assert.equal(preview.eligible,false);
 for(const name of names){
  assert.ok(full.sqlCalls.some(s=>s.sql==='SELECT COUNT(*) n FROM "'+name+'" WHERE organization_id=?'&&s.args[0]===3),'runtime count '+name);
  assert.ok(claim.sql.includes('NOT EXISTS(SELECT 1 FROM "'+name+'" WHERE organization_id=?)'),'atomic veto '+name);
  assert.equal(full.db.prepare('SELECT NOT EXISTS(SELECT 1 FROM "'+name+'" WHERE organization_id=3) empty').get().empty,0);
 }
 assert.equal(preview.blockers.filter(x=>x.code==='LINKED_DATA').length,68);
 // Match claim version to separate fixture version; every other runtime-bound value remains identical.
 const args=[...claim.args];args[1]=full.db.prepare('SELECT management_version v FROM organizations WHERE id=3').get().v;
 assert.throws(()=>full.db.prepare(claim.sql).run(...args),/CHECK constraint failed/);
 assert.equal(full.db.prepare('SELECT COUNT(*) n FROM organization_deletions').get().n,0);assert.deepEqual(full.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
