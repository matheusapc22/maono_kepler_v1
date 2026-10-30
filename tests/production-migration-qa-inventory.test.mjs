import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { collectQaInventory, validateQaInventoryContext, qaInventoryFailure, QA_INVENTORY_QUERIES } from '../scripts/migrations/organization-qa-inventory.mjs';
import { ORGANIZATION_MIGRATION, ORGANIZATION_MIGRATION_SHA256, ORGANIZATION_SCHEMA_QUERIES } from '../scripts/migrations/organization-management-schema.mjs';
import { PRODUCTION_DATABASE_NAME, PRODUCTION_DATABASE_ID } from '../scripts/migrations/production-migration-lib.mjs';
import { installMigratedOrganizationSchema } from './helpers/organization-schema-history.mjs';

const source = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const FIXED_NOW = '2026-10-30T12:00:00.000Z';
// Test-only clock seam. Run the original SQL unchanged; only replace SQLite's
// 'now' argument, delegating date parsing/modifiers/NULL to a native connection.
// The real clock, production code and the allowlisted queries are untouched.
function freezeJulianNow(t, db) {
  const native = new DatabaseSync(':memory:');
  t.after(() => native.close());
  const statements = new Map();
  db.function('julianday', { varargs:true }, (...args) => {
    const values = args.length ? args.map((value,index) => index===0 && value==='now' ? FIXED_NOW : value) : [FIXED_NOW];
    if (!statements.has(values.length)) statements.set(values.length,
      native.prepare(`SELECT julianday(${values.map(()=>'?').join(',')}) AS value`));
    return statements.get(values.length).get(...values).value;
  });
}
test('target boundary clock delegates native date semantics without rewriting SQL',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());freezeJulianNow(t,db);
  const row=db.prepare(`SELECT julianday('now') AS current, julianday(?) AS literal,
    julianday('now','-1 day') AS previous, julianday('now','+0.001 seconds') AS next,
    julianday('PRIVATE_INVALID') AS invalid, julianday(NULL) AS absent`).get(FIXED_NOW);
  assert.equal(row.current,Date.parse(FIXED_NOW)/86400000+2440587.5);
  assert.equal(row.literal,row.current);assert.equal(row.previous,row.current-1);
  assert.ok(row.next>row.current);assert.equal(row.invalid,null);assert.equal(row.absent,null);
});
// Frozen SQL from product b2a9f186, independent of the new conditional fields.
const legacyOrganizationsSql=source('scripts/migrations/organization-qa-inventory.mjs').replace(/\r\n/g,'\n')
  .match(/organizations: `([\s\S]*?)`,\n  quickCheck/)[1];
test('target diagnostics preserve the exact original totals SQL',()=>{
  assert.equal(digest(legacyOrganizationsSql),'a244320d07b02b2f8a72614d7e8a6f2dd9e1a2accb36f1c0c5055ed0fa000b76');
});
const legacyReasons=(row,summary)=>[
  [row.active!==1,'INACTIVE'],[row.storageStatus!=='READY'||row.storageErrorPresent!==0,'STORAGE_UNREADY'],
  [row.activeOwnerCount<1||row.eligibleManagerCount!==row.managerAssigned,'OWNER_UNREADY'],
  [row.sharedMemberCount!==0||row.enabledDelegationCount!==0,'SHARED_ACCESS'],
  [row.liveSessionCount!==0||row.pendingWorkCount!==0||row.recentlyChanged!==0,'OBSERVED_ACTIVITY'],
  [summary.unresolvedManagementItems!==0,'GLOBAL_MANAGEMENT_UNRESOLVED'],
].filter(([blocked])=>blocked).map(([,code])=>code);
const migration = { name:ORGANIZATION_MIGRATION,sha256:ORGANIZATION_MIGRATION_SHA256 };
const names = readdirSync(new URL('../migrations/',import.meta.url)).filter(n => /^\d{4}_.*\.sql$/.test(n)).sort();
const ledger = names.map((name,i) => ({ id:i+1,name,appliedAt:'2026-10-30 01:49:42' }));
const remote = { identity:{ name:PRODUCTION_DATABASE_NAME,id:PRODUCTION_DATABASE_ID },ledger,localMigrations:names };
const ALLOWED = new Set([...Object.values(ORGANIZATION_SCHEMA_QUERIES),...Object.values(QA_INVENTORY_QUERIES),
  'SELECT id, name, applied_at FROM d1_migrations ORDER BY id;']);
const projectSql = "INSERT INTO projects(id,name,slug,dropbox_root_path,organization_id) VALUES(1,'synthetic','synthetic','/projects/synthetic/project',1);";
const saveSql = `INSERT INTO project_save_operations(id,organization_id,actor_user_id,operation_id,project_id,target_key,kind,expected_config_revision,
  manifest_fingerprint,checksum_algorithm,checksum,size_bytes,serialization_version,schema_name,schema_version,content_type,state,receipt_json,committed_at,storage_ref)
  VALUES('synthetic-save',1,1,'synthetic-operation',1,'synthetic','update',0,'${'a'.repeat(64)}','sha256','${'a'.repeat(64)}',1,1,'synthetic',1,'application/json',
  'PUBLISHED','{"publishedRevision":1}',CURRENT_TIMESTAMP,'synthetic-ref');`;
const ticketSql = "INSERT INTO organization_tickets(id,organization_id,subject,description,created_by,created_at,updated_at) VALUES(1,1,'PRIVATE_SUBJECT','PRIVATE_CONTENT',1,'2020-01-01','2020-01-01');";
const context = {
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'matheusapc22/maono_kepler_v1',
  GITHUB_REF_NAME:'main',GITHUB_REPOSITORY_OWNER:'matheusapc22',GITHUB_ACTOR:'matheusapc22',
  MODE:'organization-qa-inventory',MIGRATION:ORGANIZATION_MIGRATION,APPROVAL_HASH:'',
  PRODUCT_BRANCH:'mano_kepler_v1',PRODUCTION_D1_NAME:PRODUCTION_DATABASE_NAME,PRODUCTION_D1_ID:PRODUCTION_DATABASE_ID,
  CLOUDFLARE_ACCOUNT_ID:'09d455fa1cf988b0d9db89987b73eaff',VALIDATED_RELEASE_SHA:'a'.repeat(40),
};
test('inventory protected context accepts only the fixed dispatch and pinned clean product', () => {
  validateQaInventoryContext(context,{ sha:'a'.repeat(40),clean:true },ORGANIZATION_MIGRATION);
});
test('inventory errors retain only fixed diagnostic codes, never raw process/DB/input content',()=>{
  for(const error of [new Error('PRIVATE_TOKEN'),{code:'PRIVATE_SECRET',details:'PRIVATE_DATA'},
    {code:'QA_INVENTORY_DRIFT',message:'PRIVATE_MESSAGE',details:{stdout:'PRIVATE_TOKEN',stderr:'PRIVATE_DATA'}}]) {
    const result=qaInventoryFailure(error);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
    assert.equal(result.code,error.code==='QA_INVENTORY_DRIFT'?'QA_INVENTORY_DRIFT':'QA_INVENTORY_BLOCKED');
  }
});
for (const field of Object.keys(context)) test('inventory rejects context drift: ' + field, () => {
  assert.throws(() => validateQaInventoryContext({ ...context,[field]:'INVALID' },{ sha:'a'.repeat(40),clean:true },ORGANIZATION_MIGRATION),{ code:'QA_INVENTORY_CONTEXT_INVALID' });
});
for (const [name,git,mig] of [['dirty',{sha:'a'.repeat(40),clean:false},ORGANIZATION_MIGRATION],
  ['sha',{sha:'b'.repeat(40),clean:true},ORGANIZATION_MIGRATION],['migration',{sha:'a'.repeat(40),clean:true},'0043_other.sql']]) {
  test('inventory rejects ' + name, () => assert.throws(() => validateQaInventoryContext(context,git,mig),{code:'QA_INVENTORY_CONTEXT_INVALID'}));
}

for (const profile of ['canonical','historical']) {
  function fixture(t, prepare = () => {}, transform = (sql,rows) => rows) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    if (profile === 'historical') installMigratedOrganizationSchema(db);
    else db.exec(source('schema.sql'));
    db.exec(source('migrations/0006_create_organization_exports.sql'));
    db.exec(source('migrations/0011_roadmap_gantt.sql'));
    db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');
    for (const r of ledger) db.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').run(r.id,r.name,r.appliedAt);
    db.exec(`INSERT INTO users(id,email,name,password_hash) VALUES (1,'private@example.test','PRIVATE_PERSON','PRIVATE_HASH'),(2,'second@example.test','PRIVATE_SECOND','PRIVATE_HASH');
      INSERT INTO organizations(id,name,slug,dropbox_root_path,storage_status,updated_at) VALUES
      (1,'PRIVATE_ORGANIZATION','private-slug','/PRIVATE_PATH','READY','2020-01-01 00:00:00'),
      (2,'PRIVATE_ORGANIZATION_TWO','private-slug2','/PRIVATE_PATH2','READY','2020-01-01 00:00:00');
      INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,1,'owner'),(2,2,'owner');`);
    prepare(db);
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    const snapshot = () => JSON.stringify(tables.map(({name}) => [name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));
    const before = snapshot();
    db.exec('PRAGMA query_only=ON;');
    const calls = [];
    const injected = { runProcess:async (command,args) => {
      assert.equal(command,'npx');
      assert.ok(args.includes(PRODUCTION_DATABASE_NAME));
      calls.push(args);
      if (args.includes('time-travel')) return { stdout:JSON.stringify({bookmark:'synthetic-bookmark-123456789'}) };
      const sql = args[args.indexOf('--command')+1];
      assert.ok(ALLOWED.has(sql),'query must be fixed and allowlisted');
      assert.ok(args.includes('--remote'));
      return { stdout:JSON.stringify([{results:transform(sql,db.prepare(sql).all()),success:true}]) };
    } };
    return {db,injected,calls,before,snapshot};
  }
  test(profile + ': full SQLite collection is read-only, deterministic and minimized', async t => {
    const f = fixture(t);
    const result = await collectQaInventory('synthetic-config',remote,migration,f.injected);
    assert.equal(result.selection.organization.id,1);
    assert.equal(result.selection.status,'PROVISIONAL_CANDIDATE');
    assert.equal(result.eligibleCount,2);
    assert.equal(result.scannedCount,2);
    assert.equal(result.ledger.appliedCount,ledger.length);
    assert.equal(result.atomicDatabaseSnapshot,false);
    assert.equal(result.exclusiveTestWindowProven,false);
    assert.equal(result.qaCredentialsVerified,false);
    assert.equal(result.flagsObserved,false);
    assert.equal(result.functionalAcceptanceExecuted,false);
    assert.equal(f.calls.filter(args => args.includes(QA_INVENTORY_QUERIES.organizations)).length,2);
    assert.equal(f.calls.filter(args => args.includes('SELECT id, name, applied_at FROM d1_migrations ORDER BY id;')).length,3);
    assert.equal(f.snapshot(),f.before);
    assert.throws(() => f.db.exec('UPDATE organizations SET active=0'),/readonly/);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|example\.test|private-slug|dropbox|token|password|before_json|payload_json/);
    assert.equal(JSON.stringify(result).includes('"id":2'),false);
  });
  test(profile + ': ranks existing resources before link count and ID, counts inactive resources too', async t => {
    const f=fixture(t,db => db.exec("INSERT INTO organization_file_folders(organization_id,name,deleted_at) VALUES(1,'PRIVATE_FOLDER','2020-01-01');"));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.equal(result.selection.organization.id,2);
    assert.equal(result.eligibleCount,2);
  });
  function assertDiagnostics(f, result, expected) {
    assert.deepEqual(result.excludedOrganizations,expected);
    assert.equal(result.version,3);
    assert.equal(result.excludedOrganizations.length,result.scannedCount-result.eligibleCount);
    const codes=['INACTIVE','STORAGE_UNREADY','OWNER_UNREADY','SHARED_ACCESS','OBSERVED_ACTIVITY','GLOBAL_MANAGEMENT_UNRESOLVED'];
    const counts=Object.fromEntries(codes.map(code=>[code,0]));
    let previous=0;
    for (const row of result.excludedOrganizations) {
      assert.deepEqual(Object.keys(row).sort(),['id','reasons']);
      assert.ok(Number.isSafeInteger(row.id) && row.id>previous);
      previous=row.id;
      assert.ok(row.reasons.length>0 && row.reasons.length<=codes.length);
      assert.equal(new Set(row.reasons).size,row.reasons.length);
      for (const code of row.reasons) { assert.ok(codes.includes(code)); counts[code]++; }
    }
    assert.deepEqual(counts,result.exclusions);
    const ledgerSql='SELECT id, name, applied_at FROM d1_migrations ORDER BY id;';
    assert.deepEqual(f.calls.map(args=>args.includes('time-travel')?'time-travel':args[args.indexOf('--command')+1]),[
      ledgerSql,...Object.values(ORGANIZATION_SCHEMA_QUERIES),'time-travel',ledgerSql,
      QA_INVENTORY_QUERIES.quickCheck,QA_INVENTORY_QUERIES.foreignKeys,
      QA_INVENTORY_QUERIES.summary,QA_INVENTORY_QUERIES.organizations,
      QA_INVENTORY_QUERIES.summary,QA_INVENTORY_QUERIES.organizations,ledgerSql,
    ],'diagnostics must not add, remove, reorder or repeat remote reads');
    assert.equal(f.snapshot(),f.before);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|example\.test|private-slug|dropbox|token|password|payload_json/);
  }
  test(profile + ': diagnostic mixed inventory exports only excluded IDs and leaves selection intact',async t=>{
    const f=fixture(t,db=>db.exec("UPDATE organizations SET active=0,updated_at='2020-01-01' WHERE id=1;"));
    // 0042 records legacy metadata writes as a recent management event.
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM organization_management_events WHERE organization_id=1 AND action='organization.legacy_updated';").get().n,1);
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assertDiagnostics(f,result,[{id:1,reasons:['INACTIVE','OBSERVED_ACTIVITY']}]);
    assert.equal(result.selection.organization.id,2);
    assert.equal(result.eligibleCount,1);
    assert.equal(result.selection.status,'PROVISIONAL_CANDIDATE');
  });
  test(profile + ': diagnostic no candidates preserves all reasons without raw state or personal fields',async t=>{
    const f=fixture(t,db=>db.exec(`
      UPDATE organizations SET active=0,storage_error='PRIVATE_ERROR',updated_at='2020-01-01' WHERE id=1;
      UPDATE users SET active=0 WHERE id=1;
      INSERT INTO organization_access_delegations(organization_id,delegate_user_id,granted_by,updated_by) VALUES(1,1,1,1);
      INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(1,'PRIVATE_TOKEN','9999-01-01');
      INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json)
      VALUES('synthetic-diagnostic',1,'synthetic-diagnostic','PRIVATE_HASH','change','PRIVATE_PAYLOAD');
    `));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assertDiagnostics(f,result,[
      {id:1,reasons:['INACTIVE','STORAGE_UNREADY','OWNER_UNREADY','SHARED_ACCESS','OBSERVED_ACTIVITY','GLOBAL_MANAGEMENT_UNRESOLVED']},
      {id:2,reasons:['GLOBAL_MANAGEMENT_UNRESOLVED']},
    ]);
    assert.equal(result.eligibleCount,0);
    assert.deepEqual(result.selection,{status:'NO_ELIGIBLE_CANDIDATE',organization:null});
  });
  test(profile + ': diagnostic all eligible does not list unselected organizations',async t=>{
    const f=fixture(t);
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assertDiagnostics(f,result,[]);
    assert.equal(result.selection.organization.id,1);
    assert.equal(result.eligibleCount,2);
    assert.equal(JSON.stringify(result).includes('"id":2'),false);
  });
  test(profile + ': diagnostic empty database has no fabricated ID or reason',async t=>{
    const f=fixture(t,db=>db.exec('DELETE FROM organization_users; DELETE FROM organizations;'));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assertDiagnostics(f,result,[]);
    assert.equal(result.scannedCount,0);
    assert.deepEqual(result.selection,{status:'NO_ELIGIBLE_CANDIDATE',organization:null});
  });
  function populateLimit(db,count) {
    db.exec("UPDATE organizations SET active=0,updated_at='2020-01-01';");
    const insert=db.prepare("INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at) VALUES(?,?,?, ?,0,'READY','2020-01-01');");
    for(let id=3;id<=count;id++) insert.run(id,'PRIVATE_NAME_'+id,'private-slug-'+id,'/PRIVATE_PATH/'+id);
  }
  test(profile + ': diagnostic exact limit retains every excluded ID once in ascending order',async t=>{
    const f=fixture(t,db=>populateLimit(db,100));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assertDiagnostics(f,result,Array.from({length:100},(_,i)=>({id:i+1,reasons:i<2?['INACTIVE','OBSERVED_ACTIVITY']:['INACTIVE','OWNER_UNREADY']})));
    assert.equal(result.scannedCount,100);
    assert.equal(result.eligibleCount,0);
    assert.equal(result.selection.organization,null);
  });
  test(profile + ': diagnostic limit overflow fails before reading any organization IDs',async t=>{
    const f=fixture(t,db=>populateLimit(db,101));
    let report;
    await assert.rejects(async()=>{report=await collectQaInventory('synthetic',remote,migration,f.injected);},{code:'QA_INVENTORY_LIMIT_EXCEEDED'});
    assert.equal(report,undefined);
    assert.equal(f.calls.some(args=>args.includes(QA_INVENTORY_QUERIES.organizations)),false);
    assert.equal(f.snapshot(),f.before);
  });
  function targetFixture(t,prepare=()=>{},transform=(sql,rows)=>rows) {
    return fixture(t,db=>{
      db.exec(`INSERT INTO users(id,email,name,password_hash) VALUES(3,'target@example.test','PRIVATE_TARGET','PRIVATE_HASH');
        INSERT INTO organizations(id,name,slug,dropbox_root_path,storage_status,updated_at)
        VALUES(4,'PRIVATE_TARGET_ORG','private-slug4','/PRIVATE_PATH4','READY','2020-01-01');
        INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(4,3,'owner');`);
      prepare(db);
    },transform);
  }
  function assertTarget(f,result) {
    const rows=f.db.prepare(legacyOrganizationsSql).all();
    const summary=f.db.prepare(QA_INVENTORY_QUERIES.summary).get();
    const excluded=rows.filter(row=>legacyReasons(row,summary).length).map(row=>({id:row.id,reasons:legacyReasons(row,summary)}));
    assertDiagnostics(f,result,excluded);
    const eligible=rows.filter(row=>!legacyReasons(row,summary).length).sort((a,b)=>a.resourceCount-b.resourceCount||a.memberCount-b.memberCount||a.id-b.id);
    assert.equal(result.eligibleCount,eligible.length);
    assert.deepEqual(result.selection,eligible.length?{status:'PROVISIONAL_CANDIDATE',organization:{...eligible[0]}}:{status:'NO_ELIGIBLE_CANDIDATE',organization:null});
    assert.equal(result.snapshotDigest,digest(JSON.stringify({summary,organizations:rows})));
    assert.equal(result.targetedDiagnosticsDigest,digest(JSON.stringify(result.targetedDiagnostics)));
    assert.equal(result.targetedDiagnostics?.id,rows.some(row=>row.id===4)?4:undefined);
    if(result.selection.organization) assert.equal(Object.keys(result.selection.organization).length,16);
    const raw=f.db.prepare(QA_INVENTORY_QUERIES.organizations).all();
    for(const row of raw) if(row.id!==4) assert.ok(Object.entries(row).filter(([key])=>key.startsWith('org4_')).every(([,value])=>value===null));
    for(const row of raw) assert.deepEqual(Object.fromEntries(Object.keys(rows[0]??{}).map(key=>[key,row[key]])),{...rows.find(old=>old.id===row.id)});
    return result.targetedDiagnostics;
  }
  test(profile+': target only ID4, with unchanged alternative candidate and empty detail sources',async t=>{
    const f=targetFixture(t),r=await collectQaInventory('synthetic',remote,migration,f.injected),d=assertTarget(f,r);
    assert.equal(r.selection.organization.id,1);
    assert.equal(d.ownership.activeOwners,1);assert.equal(d.ownership.totalOwners,1);
    assert.equal(d.ownership.noActiveOwner,false);assert.equal(d.ownership.ineligibleAssignedManager,false);
    assert.equal(d.ownership.managerAssigned,0);assert.equal(d.members.total,1);
    assert.equal(d.resources.total,0);assert.equal(d.pendingWork.total,0);assert.equal(d.sessions.total,0);
    assert.ok(Object.values(d.changes).every(value=>value===0));
    assert.deepEqual(d.reasons,[]);
    assert.doesNotMatch(JSON.stringify(r.selection),/org4_|ownership|bySource|byExpiry/);
  });
  test(profile+': target absence is null, never fabricated zero counters',async t=>{
    const f=fixture(t),r=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.equal(assertTarget(f,r),null);
  });
  test(profile+': target selection still exposes exactly the old candidate fields',async t=>{
    const f=targetFixture(t,db=>db.exec("INSERT INTO organization_file_folders(organization_id,name) VALUES(1,'PRIVATE'),(2,'PRIVATE');"));
    const r=await collectQaInventory('synthetic',remote,migration,f.injected);assertTarget(f,r);
    assert.equal(r.selection.organization.id,4);
    assert.doesNotMatch(JSON.stringify(r.selection),/org4_|ownership|bySource/);
  });
  for(const [name,sql,expected] of [
    ['no owner',"DELETE FROM organization_users WHERE organization_id=4;",{activeOwners:0,totalOwners:0,noActiveOwner:true,ineligibleAssignedManager:false}],
    ['inactive owner',"UPDATE users SET active=0 WHERE id=3;",{activeOwners:0,inactiveOwners:1,noActiveOwner:true,ineligibleAssignedManager:false}],
    ['eligible manager',"UPDATE organizations SET management_owner_id=3 WHERE id=4;",{activeOwners:1,managerAssigned:1,eligibleManagerCount:1,managerUserActive:1,managerMembershipOwner:1,ineligibleAssignedManager:false}],
  ]) test(profile+': target ownership '+name,async t=>{
    const f=targetFixture(t,db=>db.exec(sql));const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    for(const [key,value] of Object.entries(expected)) assert.equal(d.ownership[key],value,key);
  });
  // Synthetic business-invariant corruption: restore the exact guard before
  // collection. Schema/FK checks remain active; no production guard is changed.
  for(const [name,prepare,expected] of [
    ['missing manager link',()=>{},{managerUserExists:1,managerUserActive:1,managerMembershipExists:0,managerMembershipOwner:0}],
    ['manager role viewer',db=>db.exec("INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(4,2,'viewer');"),{managerUserActive:1,managerMembershipExists:1,managerMembershipOwner:0}],
    ['inactive manager owner',db=>db.exec("UPDATE users SET active=0 WHERE id=2; INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(4,2,'owner');"),{managerUserActive:0,managerMembershipExists:1,managerMembershipOwner:1}],
  ]) test(profile+': target distinguishes '+name,async t=>{
    const f=targetFixture(t,db=>{
      prepare(db);
      const guard=db.prepare("SELECT sql FROM sqlite_schema WHERE name='org_management_owner_valid'").get().sql;
      db.exec('DROP TRIGGER org_management_owner_valid;');
      db.exec('UPDATE organizations SET management_owner_id=2 WHERE id=4;');
      db.exec(guard);
    });
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.ownership.ineligibleAssignedManager,true);assert.equal(d.ownership.noActiveOwner,false);
    for(const [key,value] of Object.entries(expected)) assert.equal(d.ownership[key],value,key);
  });
  for(const [name,expires,key] of [['valid','9999-01-01','valid'],['invalid','PRIVATE_INVALID','invalid']]) {
    for(const [association,user,active] of [['ActiveOnly',1,4],['MemberOnly',3,null],['Both',3,4]]) {
      test(profile+': target session '+name+' '+association,async t=>{
        const f=targetFixture(t,db=>db.prepare('INSERT INTO sessions(user_id,active_organization_id,token_hash,expires_at) VALUES(?,?,?,?)').run(user,active,'PRIVATE_TOKEN',expires));
        const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
        assert.equal(d.sessions.total,1);assert.equal(d.sessions.byExpiryAndAssociation[key+association],1);
        assert.equal(Object.values(d.sessions.byExpiryAndAssociation).filter(v=>v!==0).length,1);
      });
    }
  }
  test(profile+': target expired session is not activity and never exports session identifiers',async t=>{
    const f=targetFixture(t,db=>db.exec("INSERT INTO sessions(user_id,active_organization_id,token_hash,expires_at) VALUES(3,4,'PRIVATE_TOKEN','2020-01-01');"));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));assert.equal(d.sessions.total,0);
  });
  for(const origin of ['metadata','events']) for(const [name,value,expected] of [
    ['old','2020-01-01',null],['recent','CURRENT_TIMESTAMP','recent'],['future','9999-01-01','future'],['invalid','PRIVATE_INVALID','invalid'],
  ]) test(profile+': target '+origin+' date '+name,async t=>{
    const sqlValue=value==='CURRENT_TIMESTAMP'?value:"'"+value+"'";
    const f=targetFixture(t,db=>db.exec(origin==='metadata'?`UPDATE organizations SET updated_at=${sqlValue} WHERE id=4;`:
      `INSERT INTO organization_management_events(organization_id,action,version,reason,created_at) VALUES(4,'PRIVATE_ACTION',0,'PRIVATE_REASON',${sqlValue});`));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(Object.values(d.changes).reduce((a,b)=>a+b,0),expected?1:0);
    if(expected) assert.equal(d.changes[origin+expected[0].toUpperCase()+expected.slice(1)],1);
    assert.equal(d.reasons.includes('OBSERVED_ACTIVITY'),Boolean(expected));
  });
  for(const origin of ['metadata','events']) for(const [name,value,expected] of [
    ['before 24h','2026-10-29T11:59:59.999Z',null],
    ['exact 24h','2026-10-29T12:00:00.000Z','Recent'],
    ['after 24h','2026-10-29T12:00:00.001Z','Recent'],
    ['before now','2026-10-30T11:59:59.999Z','Recent'],
    ['exact now',FIXED_NOW,'Recent'],
    ['after now','2026-10-30T12:00:00.001Z','Future'],
  ]) test(profile+': target boundary '+origin+' '+name,async t=>{
    const f=targetFixture(t,db=>{
      freezeJulianNow(t,db);
      if(origin==='metadata') db.prepare('UPDATE organizations SET updated_at=? WHERE id=4').run(value);
      else db.prepare('INSERT INTO organization_management_events(organization_id,action,version,created_at) VALUES(4,?,0,?)').run('PRIVATE_ACTION',value);
    });
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    const changes={metadataInvalid:0,metadataFuture:0,metadataRecent:0,eventsInvalid:0,eventsFuture:0,eventsRecent:0};
    if(expected) changes[origin+expected]=1;
    assert.deepEqual(d.changes,changes);
    assert.deepEqual(d.reasons,expected?['OBSERVED_ACTIVITY']:[]);
  });
  for(const [name,value,live] of [
    ['before now','2026-10-30T11:59:59.999Z',0],['exact now',FIXED_NOW,0],['after now','2026-10-30T12:00:00.001Z',1],
  ]) for(const [association,user,active] of [['ActiveOnly',1,4],['MemberOnly',3,null],['Both',3,4]]) {
    test(profile+': target boundary session '+association+' '+name,async t=>{
      const f=targetFixture(t,db=>{
        freezeJulianNow(t,db);
        db.prepare('INSERT INTO sessions(user_id,active_organization_id,token_hash,expires_at) VALUES(?,?,?,?)').run(user,active,'PRIVATE_TOKEN',value);
      });
      const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
      const partitions={validActiveOnly:0,validMemberOnly:0,validBoth:0,invalidActiveOnly:0,invalidMemberOnly:0,invalidBoth:0};
      partitions['valid'+association]=live;
      assert.equal(d.sessions.total,live);assert.deepEqual(d.sessions.byExpiryAndAssociation,partitions);
      assert.deepEqual(d.reasons,live?['OBSERVED_ACTIVITY']:[]);
    });
  }
  for(const [name,mutate] of [
    ['missing',r=>{delete r.org4_resources_projects;}],['null',r=>{r.org4_owner_totalOwners=null;}],
    ['negative',r=>{r.org4_pending_saves=-1;}],['string',r=>{r.org4_sessions_invalidBoth='1';}],
    ['unsafe',r=>{r.org4_changes_eventsInvalid=Number.MAX_SAFE_INTEGER+1;}],
    ['sum mismatch',r=>{r.org4_resources_projects=1;}],['owner mismatch',r=>{r.org4_owner_totalOwners=0;}],
    ['manager mismatch',r=>{r.org4_owner_managerUserActive=1;}],['metadata overlap',r=>{r.org4_changes_metadataFuture=1;r.org4_changes_metadataRecent=1;}],
    ['union mismatch',r=>{r.org4_causes_fileState=1;}],['extra personal field',r=>{r.org4_userEmail='PRIVATE_EMAIL';}],
  ]) test(profile+': target rejects '+name,async t=>{
    const f=targetFixture(t,()=>{},(sql,rows)=>{if(sql===QA_INVENTORY_QUERIES.organizations) mutate(rows.find(r=>r.id===4));return rows;});
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_RESPONSE_INVALID'});
  });
  test(profile+': target rejects details attached to a different organization',async t=>{
    const f=targetFixture(t,()=>{},(sql,rows)=>{if(sql===QA_INVENTORY_QUERIES.organizations) rows.find(r=>r.id===1).org4_owner_totalOwners=1;return rows;});
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_RESPONSE_INVALID'});
  });
  test(profile+': target detail-only drift is rejected even when legacy totals and reasons match',async t=>{
    let reads=0;
    const f=targetFixture(t,db=>db.exec("INSERT INTO sessions(user_id,active_organization_id,token_hash,expires_at) VALUES(3,4,'PRIVATE_TOKEN','9999-01-01');"),(sql,rows)=>{
      if(sql===QA_INVENTORY_QUERIES.organizations&&++reads===2) {const row=rows.find(r=>r.id===4);row.org4_sessions_validBoth=0;row.org4_sessions_invalidBoth=1;}
      return rows;
    });
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_DRIFT'});
  });
  const insertRow=(db,table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')});`).run(...Object.values(row));
  const seedProject=db=>insertRow(db,'projects',{id:1,organization_id:4,name:'PRIVATE_PROJECT',slug:'private-project',dropbox_root_path:'/PRIVATE_PROJECT'});
  const seedTicket=db=>insertRow(db,'organization_tickets',{id:1,organization_id:4,subject:'PRIVATE_SUBJECT',description:'PRIVATE_CONTENT',created_by:3,created_at:'2020-01-01',updated_at:'2020-01-01'});
  const seedSave=(db,state='PUBLISHED')=>{
    seedProject(db);
    db.exec(saveSql.replace("VALUES('synthetic-save',1,1,","VALUES('synthetic-save',4,1,").replace("'PUBLISHED'","'"+state+"'"));
  };
  const seedPreview=(db,state='READY')=>{
    seedSave(db);
    insertRow(db,'project_preview_operations',{id:'preview',organization_id:4,project_id:1,actor_user_id:3,operation_id:'preview-operation',
      save_operation_id:'synthetic-save',save_operation_key:'synthetic-operation',revision:1,config_checksum:'a'.repeat(64),editor_session_id:'PRIVATE_EDITOR',
      edit_generation:0,renderer_version:'1',image_checksum:'a'.repeat(64),size_bytes:1,capture_method:'synthetic',manifest_json:'{}',
      storage_root:'/PRIVATE_ROOT',config_file:'PRIVATE_FILE',project_epoch:1,storage_ref:'PRIVATE_REF',state,receipt_json:'{}',payload_stored_at:'2020-01-01'});
  };
  const seedRevision=(db,extra={})=>{
    seedProject(db);
    insertRow(db,'project_config_revisions',{project_id:1,revision:1,status:'WRITING',checksum_algorithm:'sha256',checksum:'a'.repeat(64),
      storage_provider:'synthetic',storage_ref:'PRIVATE_REF',schema_name:'synthetic',schema_version:1,size_bytes:1,content_type:'application/json',...extra});
  };
  const seedLink=(db,extra={})=>{
    seedTicket(db);
    insertRow(db,'change_records',{id:'change',organization_id:4,domain:'platform',title:'PRIVATE_TITLE',proposal:'PRIVATE_PROPOSAL',status:'delivered',created_by:3,actor_id:3});
    insertRow(db,'ticket_change_links',{ticket_id:1,organization_id:4,record_id:'change',actor_id:3,...extra});
  };
  const seedMapLink=(db,extra={})=>{
    seedProject(db);seedTicket(db);
    insertRow(db,'project_change_requests',{id:'map-change',organization_id:4,project_id:1,requested_by_user_id:3,
      base_revision:0,status:'applied',lifecycle_version:7,reason:'PRIVATE_REASON',idempotency_key:'synthetic-map-key',submission_hash:'hash'});
    // The real insert trigger creates the map_project record at version 1.
    // Different versions make choosing c.version instead of r.lifecycle_version observable.
    const record=db.prepare("SELECT id,domain,version FROM change_records WHERE change_request_id='map-change'").get();
    assert.deepEqual({...record},{id:'cr:map-change',domain:'map_project',version:1});
    assert.equal(db.prepare("SELECT lifecycle_version FROM project_change_requests WHERE id='map-change'").get().lifecycle_version,7);
    insertRow(db,'ticket_change_links',{ticket_id:1,organization_id:4,record_id:record.id,actor_id:3,...extra});
  };
  const targetSources=[
    ['reservations',db=>insertRow(db,'organization_resource_reservations',{organization_id:4,resource_type:'project',idempotency_key:'synthetic-target-key',actor_user_id:3,expires_at:'2000-01-01'})],
    ['limitRequests',db=>insertRow(db,'organization_limit_requests',{organization_id:4,request_type:'plan',reason:'PRIVATE_REASON',status:'pending'})],
    ['saves',db=>seedSave(db,'AWAITING_UPLOAD')],
    ['previews',db=>seedPreview(db,'WAITING_CAPTURE')],
    ['saveOutbox',db=>{seedSave(db);insertRow(db,'project_save_outbox',{operation_id:'synthetic-save',effect:'AUDIT',state:'PENDING'});}],
    ['previewOutbox',db=>{seedPreview(db);insertRow(db,'project_preview_outbox',{operation_id:'preview'});}],
    ['legacyExports',db=>insertRow(db,'organization_exports',{organization_id:4,type:'synthetic',format:'json',status:'queued'})],
    ['ticketExports',db=>insertRow(db,'ticket_export_jobs',{id:'export',organization_id:4,actor_id:3,request_id:'synthetic',request_hash:'synthetic',
      input_json:'{}',definition_json:'{}',config_json:'{}',state:'running',generation:0,created_at:'2020-01-01',updated_at:'2020-01-01',expires_at:'9999-01-01'})],
    ['exportGc',db=>insertRow(db,'ticket_export_gc',{id:'gc',job_id:'old-job',organization_id:4,next_at:'2020-01-01'})],
    ['attachmentUploads',db=>{seedTicket(db);insertRow(db,'ticket_attachment_upload_sessions',{id:'synthetic-upload',organization_id:4,ticket_id:1,user_id:3,
      storage_key:'PRIVATE_KEY',expected_size:1,expected_content_hash:'a'.repeat(64),target_audience:'ticket',state:'RESERVED',idle_expires_at:1,hard_expires_at:2,created_at:'2020-01-01',updated_at:'2020-01-01'});}],
    ['ticketOutbox',db=>{seedTicket(db);
      insertRow(db,'ticket_commands',{id:'cmd',organization_id:4,actor_user_id:3,operation:'synthetic',request_hash:'hash',result_json:'{}',response_status:200,created_at:'2020-01-01'});
      insertRow(db,'ticket_events',{id:1,organization_id:4,ticket_id:1,event_type:'synthetic'});
      insertRow(db,'ticket_command_outbox',{id:'outbox',command_id:'cmd',organization_id:4,ticket_id:1,event_id:1,event_type:'synthetic',payload:'{}',created_at:'2020-01-01'});
    }],
    ['changeRequests',db=>{seedProject(db);insertRow(db,'project_change_requests',{id:'cr',organization_id:4,project_id:1,requested_by_user_id:3,base_revision:0,
      reason:'PRIVATE_REASON',idempotency_key:'synthetic-key',submission_hash:'hash'});}],
    ['attachmentsWithoutSession',db=>{seedTicket(db);insertRow(db,'ticket_attachments',{organization_id:4,ticket_id:1,original_name:'PRIVATE_FILE',stored_name:'PRIVATE_FILE',
      storage_key:'PRIVATE_KEY',mime_type:'text/plain',size_bytes:1,uploaded_by:3,status:'PENDING'});}],
    ['backfills',db=>insertRow(db,'ticket_command_backfills',{organization_id:4,status:'running'})],
    ['files',db=>insertRow(db,'organization_files',{organization_id:4,name:'PRIVATE_FILE',file_name:'PRIVATE_FILE',dropbox_path:'PRIVATE_PATH',status:'PENDING'})],
    ['legacyPreviews',db=>{seedProject(db);db.exec("UPDATE projects SET preview_status='PENDING' WHERE id=1;");}],
    ['revisions',db=>seedRevision(db)],
    ['changeLinks',db=>seedLink(db)],
  ];
  for(const [name,prepare] of targetSources) test(profile+': target pending source '+name,async t=>{
    const f=targetFixture(t,prepare),d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,1);assert.equal(d.pendingWork.bySource[name],1);
    assert.equal(Object.values(d.pendingWork.bySource).filter(v=>v!==0).length,1);
    assert.ok(d.reasons.includes('OBSERVED_ACTIVITY'));
  });
  for(const [name,values,expected] of [
    ['status',{status:'running'},{backfillStatus:1}],
    ['pending',{status:'ready',pending_count:3},{backfillPendingRows:1}],
    ['skipped',{status:'ready',skipped_count:4},{backfillSkippedRows:1}],
    ['overlap',{status:'failed',pending_count:3,skipped_count:4},{backfillStatus:1,backfillPendingRows:1,backfillSkippedRows:1}],
    ['ready',{status:'ready'},{}],
  ]) test(profile+': target backfill cause '+name,async t=>{
    const f=targetFixture(t,db=>insertRow(db,'ticket_command_backfills',{organization_id:4,...values}));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,Object.keys(expected).length?1:0);
    for(const key of ['backfillStatus','backfillPendingRows','backfillSkippedRows']) assert.equal(d.pendingWork.overlappingCauses[key],expected[key]??0);
  });
  for(const [name,values,expected] of [
    ['state',{status:'PENDING'},{fileState:1}],
    ['purge null',{status:'TRASHED',deleted_at:'2020-01-01'},{filePurgeInvalidDate:1}],
    ['purge invalid',{status:'TRASHED',deleted_at:'2020-01-01',purge_after:'PRIVATE_INVALID'},{filePurgeInvalidDate:1}],
    ['purge due',{status:'TRASHED',deleted_at:'2020-01-01',purge_after:'2020-01-02'},{filePurgeDue:1}],
    ['overlap',{status:'PURGE_PENDING',deleted_at:'2020-01-01',purge_after:'2020-01-02'},{fileState:1,filePurgeDue:1}],
    ['future',{status:'TRASHED',deleted_at:'2020-01-01',purge_after:'9999-01-01'},{}],
    ['already purged',{status:'PURGED',deleted_at:'2020-01-01',purge_after:'PRIVATE_INVALID',purged_at:'2020-01-02'},{}],
  ]) test(profile+': target file cause '+name,async t=>{
    const f=targetFixture(t,db=>insertRow(db,'organization_files',{organization_id:4,name:'PRIVATE_FILE',file_name:'PRIVATE_FILE',dropbox_path:'PRIVATE_PATH',...values}));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,Object.keys(expected).length?1:0);
    for(const key of ['fileState','filePurgeInvalidDate','filePurgeDue']) assert.equal(d.pendingWork.overlappingCauses[key],expected[key]??0);
  });
  for(const [name,value,due] of [
    ['before now','2026-10-30T11:59:59.999Z',1],['exact now',FIXED_NOW,1],['after now','2026-10-30T12:00:00.001Z',0],
  ]) test(profile+': target boundary file purge '+name,async t=>{
    const f=targetFixture(t,db=>{
      freezeJulianNow(t,db);
      insertRow(db,'organization_files',{organization_id:4,name:'PRIVATE_FILE',file_name:'PRIVATE_FILE',dropbox_path:'PRIVATE_PATH',
        status:'TRASHED',deleted_at:'2020-01-01',purge_after:value});
    });
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,due);assert.equal(d.pendingWork.bySource.files,due);
    assert.equal(d.pendingWork.overlappingCauses.filePurgeDue,due);
    assert.equal(d.pendingWork.overlappingCauses.filePurgeInvalidDate,0);assert.equal(d.pendingWork.overlappingCauses.fileState,0);
    assert.deepEqual(d.reasons,due?['OBSERVED_ACTIVITY']:[]);
  });
  for(const [name,values,expected] of [
    ['nonterminal',{status:'WRITING'},{revisionNonterminal:1}],
    ['ready ahead',{status:'READY'},{revisionAheadReady:1}],
    ['failed published ahead',{status:'FAILED',published_at:'2020-01-01'},{revisionAheadPublished:1}],
    ['overlap',{status:'READY',published_at:'2020-01-01'},{revisionAheadReady:1,revisionAheadPublished:1}],
    ['failed final',{status:'FAILED'},{}],
  ]) test(profile+': target revision cause '+name,async t=>{
    const f=targetFixture(t,db=>seedRevision(db,values));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,Object.keys(expected).length?1:0);
    for(const key of ['revisionNonterminal','revisionAheadReady','revisionAheadPublished']) assert.equal(d.pendingWork.overlappingCauses[key],expected[key]??0);
  });
  for(const [name,values,expected] of [
    ['missing status',{source_version:1},{linkMissingStatus:1}],
    ['version mismatch',{source_version:0,source_status:'delivered'},{linkVersionMismatch:1}],
    ['overlap',{source_version:0},{linkMissingStatus:1,linkVersionMismatch:1}],
    ['aligned',{source_version:1,source_status:'delivered'},{}],
    ['inactive',{source_version:0,active:0},{}],
  ]) test(profile+': target link cause '+name,async t=>{
    const f=targetFixture(t,db=>seedLink(db,values));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,Object.keys(expected).length?1:0);
    for(const key of ['linkMissingStatus','linkVersionMismatch']) assert.equal(d.pendingWork.overlappingCauses[key],expected[key]??0);
  });
  for(const [name,values,expected] of [
    ['aligned lifecycle',{source_version:7,source_status:'applied'},{}],
    ['matches record but not lifecycle',{source_version:1,source_status:'applied'},{linkVersionMismatch:1}],
    ['different from both',{source_version:0,source_status:'applied'},{linkVersionMismatch:1}],
    ['missing status',{source_version:7},{linkMissingStatus:1}],
    ['overlap',{source_version:1},{linkMissingStatus:1,linkVersionMismatch:1}],
    ['inactive mismatch',{source_version:1,active:0},{}],
  ]) test(profile+': target map_project link '+name,async t=>{
    const f=targetFixture(t,db=>seedMapLink(db,values));
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    const pending=Object.keys(expected).length?1:0;
    assert.equal(d.pendingWork.total,pending);assert.equal(d.pendingWork.bySource.changeLinks,pending);
    assert.equal(d.pendingWork.bySource.changeRequests,0);
    assert.equal(Object.values(d.pendingWork.bySource).filter(value=>value!==0).length,pending);
    for(const key of ['linkMissingStatus','linkVersionMismatch']) assert.equal(d.pendingWork.overlappingCauses[key],expected[key]??0);
    assert.deepEqual(d.reasons,pending?['OBSERVED_ACTIVITY']:[]);
  });
  test(profile+': target resource components include inactive and trashed resources without their content',async t=>{
    const f=targetFixture(t,db=>{
      seedProject(db);db.exec('UPDATE projects SET active=0 WHERE id=1;');seedTicket(db);
      insertRow(db,'organization_files',{organization_id:4,name:'PRIVATE_FILE',file_name:'PRIVATE_FILE',dropbox_path:'PRIVATE_PATH',status:'TRASHED'});
      insertRow(db,'organization_file_folders',{organization_id:4,name:'PRIVATE_FOLDER',deleted_at:'2020-01-01'});
      insertRow(db,'organization_roadmaps',{organization_id:4,name:'PRIVATE_ROADMAP',start_date:'2020-01-01',end_date:'2020-12-31',created_by:3});
      insertRow(db,'organization_exports',{organization_id:4,type:'synthetic',format:'json',status:'queued'});
    });
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.resources.total,6);assert.ok(Object.values(d.resources.bySource).every(v=>v===1));
  });
  test(profile+': target terminal operation states and final outboxes remain nonblocking',async t=>{
    const f=targetFixture(t,db=>{
      seedPreview(db);
      insertRow(db,'project_save_outbox',{operation_id:'synthetic-save',effect:'AUDIT',state:'DONE'});
      insertRow(db,'project_preview_outbox',{operation_id:'preview',state:'DONE'});
      insertRow(db,'organization_resource_reservations',{organization_id:4,resource_type:'project',idempotency_key:'synthetic-target-key',actor_user_id:3,expires_at:'2000-01-01',status:'EXPIRED'});
      insertRow(db,'organization_limit_requests',{organization_id:4,request_type:'plan',reason:'PRIVATE_REASON',status:'approved'});
      insertRow(db,'ticket_command_backfills',{organization_id:4,status:'ready'});
    });
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,0);assert.deepEqual(d.reasons,[]);
  });
  test(profile+': target mixed causes retain union totals and distinguish every temporal origin',async t=>{
    const f=targetFixture(t,db=>{
      insertRow(db,'ticket_command_backfills',{organization_id:4,status:'failed',pending_count:2,skipped_count:3});
      insertRow(db,'organization_files',{organization_id:4,name:'PRIVATE_FILE',file_name:'PRIVATE_FILE',dropbox_path:'PRIVATE_PATH',status:'PURGE_PENDING',deleted_at:'2020-01-01',purge_after:'PRIVATE_INVALID'});
      db.exec("UPDATE organizations SET updated_at='9999-01-01' WHERE id=4;");
      for(const date of ['2020-01-01','9999-01-01','PRIVATE_INVALID']) insertRow(db,'organization_management_events',{organization_id:4,action:'PRIVATE_ACTION',version:0,created_at:date});
      db.exec("INSERT INTO organization_management_events(organization_id,action,version) VALUES(4,'PRIVATE_ACTION',0);");
      insertRow(db,'sessions',{user_id:3,token_hash:'PRIVATE_VALID',expires_at:'9999-01-01',active_organization_id:4});
      insertRow(db,'sessions',{user_id:1,token_hash:'PRIVATE_INVALID',expires_at:'PRIVATE_INVALID',active_organization_id:4});
    });
    const d=assertTarget(f,await collectQaInventory('synthetic',remote,migration,f.injected));
    assert.equal(d.pendingWork.total,2);
    assert.equal(Object.values(d.pendingWork.overlappingCauses).reduce((a,b)=>a+b,0),5);
    assert.equal(d.sessions.total,2);assert.equal(d.sessions.byExpiryAndAssociation.validBoth,1);assert.equal(d.sessions.byExpiryAndAssociation.invalidActiveOnly,1);
    assert.deepEqual(d.changes,{metadataInvalid:0,metadataFuture:1,metadataRecent:0,eventsInvalid:1,eventsFuture:1,eventsRecent:1});
  });
  const queues = [
    ['legacy export',"INSERT INTO organization_exports(organization_id,type,format,status) VALUES(1,'synthetic','json','queued');"],
    ['ticket export',"INSERT INTO ticket_export_jobs(id,organization_id,actor_id,request_id,request_hash,input_json,definition_json,config_json,state,generation,created_at,updated_at,expires_at) VALUES('synthetic',1,1,'synthetic','synthetic','{}','{}','{}','running',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'9999-01-01');"],
    ['save outbox after publication',projectSql+saveSql+"INSERT INTO project_save_outbox(operation_id,effect,state) VALUES('synthetic-save','AUDIT','PENDING');"],
    ['preview outbox after READY',projectSql+saveSql+`INSERT INTO project_preview_operations(id,organization_id,project_id,actor_user_id,operation_id,save_operation_id,save_operation_key,
      revision,config_checksum,editor_session_id,edit_generation,renderer_version,image_checksum,size_bytes,capture_method,manifest_json,storage_root,config_file,
      project_epoch,storage_ref,state,receipt_json,payload_stored_at) VALUES('preview',1,1,1,'preview-operation','synthetic-save','synthetic-operation',1,'${'a'.repeat(64)}',
      'synthetic-editor',0,'1','${'a'.repeat(64)}',1,'synthetic','{}','/projects/synthetic','config.json',1,'preview-ref','READY','{}',CURRENT_TIMESTAMP);
      INSERT INTO project_preview_outbox(operation_id) VALUES('preview');`],
    ['ticket upload',ticketSql+`INSERT INTO ticket_attachment_upload_sessions(id,organization_id,ticket_id,user_id,storage_key,expected_size,expected_content_hash,target_audience,
      state,idle_expires_at,hard_expires_at,created_at,updated_at) VALUES('synthetic-upload',1,1,1,'PRIVATE_KEY',1,'${'a'.repeat(64)}','ticket','RESERVED',1,2,'2020-01-01','2020-01-01');`],
    ['ticket outbox',ticketSql+`INSERT INTO ticket_commands(id,organization_id,actor_user_id,operation,request_hash,result_json,response_status,created_at)
      VALUES('cmd',1,1,'synthetic','hash','{}',200,'2020-01-01');
      INSERT INTO ticket_events(id,organization_id,ticket_id,event_type) VALUES(1,1,1,'synthetic');
      INSERT INTO ticket_command_outbox(id,command_id,organization_id,ticket_id,event_id,event_type,payload,created_at)
      VALUES('outbox','cmd',1,1,1,'synthetic','{}','2020-01-01');`],
    ['export garbage collection',"INSERT INTO ticket_export_gc(id,job_id,organization_id,next_at) VALUES('gc','old-job',1,'2020-01-01');"],
    ['change request',projectSql+"INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,base_revision,reason,idempotency_key,submission_hash) VALUES('cr',1,1,1,0,'PRIVATE_REASON','synthetic-key','hash');"],
  ];
  for(const [name,sql] of queues) test(profile + ': queue regression ' + name,async t=>{
    const f=fixture(t,db=>db.exec("DELETE FROM organization_users WHERE organization_id=2; DELETE FROM organizations WHERE id=2;"+sql));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.equal(result.selection.status,'NO_ELIGIBLE_CANDIDATE');
    assert.equal(result.exclusions.OBSERVED_ACTIVITY,1);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
    assert.equal(f.snapshot(),f.before);
  });
  const legacyQueues = [
    ['attachment without session',ticketSql+"INSERT INTO ticket_attachments(organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,uploaded_by,status) VALUES(1,1,'synthetic','synthetic','synthetic-key','text/plain',1,1,'PENDING');"],
    ['backfill running',"INSERT INTO ticket_command_backfills(organization_id,status,pending_count) VALUES(1,'running',1);"],
    ['backfill skipped backlog',"INSERT INTO ticket_command_backfills(organization_id,status,skipped_count) VALUES(1,'ready',1);"],
    ['file upload',"INSERT INTO organization_files(organization_id,name,file_name,dropbox_path,status) VALUES(1,'PRIVATE_FILE','PRIVATE_FILE','PRIVATE_PATH','PENDING');"],
    ['file purge',"INSERT INTO organization_files(organization_id,name,file_name,dropbox_path,status,deleted_at) VALUES(1,'PRIVATE_FILE','PRIVATE_FILE','PRIVATE_PATH','PURGE_PENDING','2020-01-01');"],
    ['preview awaiting capture',projectSql+"UPDATE projects SET preview_status='PENDING' WHERE id=1;"],
    ['revision writing',projectSql+`INSERT INTO project_config_revisions(project_id,revision,checksum_algorithm,checksum,storage_provider,storage_ref,schema_name,schema_version,size_bytes,content_type)
      VALUES(1,1,'sha256','${'a'.repeat(64)}','synthetic','PRIVATE_REF','synthetic',1,1,'application/json');`],
    ['revision READY not published',projectSql+`INSERT INTO project_config_revisions(project_id,revision,status,checksum_algorithm,checksum,storage_provider,storage_ref,schema_name,schema_version,size_bytes,content_type)
      VALUES(1,1,'READY','sha256','${'a'.repeat(64)}','synthetic','PRIVATE_REF','synthetic',1,1,'application/json');`],
    ['file purge due',"INSERT INTO organization_files(organization_id,name,file_name,dropbox_path,status,deleted_at,purge_after) VALUES(1,'PRIVATE_FILE','PRIVATE_FILE','PRIVATE_PATH','TRASHED','2020-01-01','2020-01-02');"],
    ['change link reconciliation',ticketSql+`INSERT INTO change_records(id,organization_id,domain,title,proposal,status,created_by,actor_id)
      VALUES('change',1,'platform','PRIVATE_TITLE','PRIVATE_PROPOSAL','delivered',1,1);
      INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id) VALUES(1,1,'change',1);`],
  ];
  for(const [name,sql] of legacyQueues) test(profile + ': queue follow-up ' + name,async t=>{
    const f=fixture(t,db=>db.exec("DELETE FROM organization_users WHERE organization_id=2; DELETE FROM organizations WHERE id=2;"+sql));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.equal(result.selection.status,'NO_ELIGIBLE_CANDIDATE');
    assert.equal(result.exclusions.OBSERVED_ACTIVITY,1);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
    assert.equal(f.snapshot(),f.before);
  });
  const blocks = [
    ['INACTIVE',"UPDATE organizations SET active=0,updated_at='2020-01-01' WHERE id=1;"],
    ['STORAGE_UNREADY',"UPDATE organizations SET storage_status='PENDING' WHERE id=1;"],
    ['STORAGE_UNREADY',"UPDATE organizations SET storage_status='PRIVATE_INVALID' WHERE id=1;"],
    ['STORAGE_UNREADY',"UPDATE organizations SET storage_error='PRIVATE_ERROR' WHERE id=1;"],
    ['OWNER_UNREADY',"UPDATE users SET active=0 WHERE id=1;"],
    ['SHARED_ACCESS',"INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(2,1,'viewer');"],
    ['SHARED_ACCESS',"INSERT INTO organization_access_delegations(organization_id,delegate_user_id,granted_by,updated_by) VALUES(1,1,1,1);"],
    ['OBSERVED_ACTIVITY',"INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(1,'PRIVATE_TOKEN','9999-01-01');"],
    ['OBSERVED_ACTIVITY',"INSERT INTO sessions(user_id,active_organization_id,token_hash,expires_at) VALUES(2,1,'PRIVATE_TOKEN','INVALID');"],
    ['OBSERVED_ACTIVITY',"UPDATE organizations SET updated_at=CURRENT_TIMESTAMP WHERE id=1;"],
    ['OBSERVED_ACTIVITY',"UPDATE organizations SET updated_at='INVALID' WHERE id=1;"],
    ['OBSERVED_ACTIVITY',"INSERT INTO organization_limit_requests(organization_id,request_type,reason,status) VALUES(1,'plan','PRIVATE_REASON','pending');"],
    ['OBSERVED_ACTIVITY',"INSERT INTO organization_resource_reservations(organization_id,resource_type,idempotency_key,actor_user_id,expires_at) VALUES(1,'project','synthetic-key-1234',1,'2000-01-01');"],
    ['OBSERVED_ACTIVITY',"INSERT INTO organization_management_events(organization_id,action,version,reason) VALUES(1,'synthetic',0,'PRIVATE_REASON');"],
  ];
  for (const [reason,sql] of blocks) test(profile + ': excludes ' + reason + ' via ' + sql.split(' ').slice(0,3).join(' '), async t => {
    const f=fixture(t,db => db.exec(sql));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.ok(result.exclusions[reason]>0);
    assert.notEqual(result.selection.organization?.id,1);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|INVALID/);
  });
  test(profile + ': unknown nullable historical lifecycle never becomes READY', async t => {
    if (profile === 'canonical') {
      const f=fixture(t);
      assert.throws(() => f.db.exec('UPDATE organizations SET storage_status=NULL WHERE id=1'),/readonly/);
    } else {
      const f=fixture(t,db=>db.exec('UPDATE organizations SET storage_status=NULL WHERE id=1'));
      const result=await collectQaInventory('synthetic',remote,migration,f.injected);
      assert.equal(result.selection.organization.id,2);
      assert.equal(result.exclusions.STORAGE_UNREADY,1);
    }
  });
  for (const state of [null,'pending','running','partial','failed']) test(profile + ': unresolved global operation blocks selection: ' + state, async t => {
    const f=fixture(t,db => {
      db.exec("INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json) VALUES('synthetic',1,'synthetic-key','PRIVATE_HASH','change','PRIVATE_PAYLOAD');");
      if (state) db.prepare('INSERT INTO organization_management_operation_items(operation_id,item_index,state) VALUES(?,?,?)').run('synthetic',0,state);
    });
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.equal(result.selection.status,'NO_ELIGIBLE_CANDIDATE');
    assert.equal(result.unresolvedManagementItems,1);
    assert.equal(result.selection.organization,null);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  });
  const badRows = [
    ['negative count',r=>{r[0].memberCount=-1;}],['string count',r=>{r[0].memberCount='1';}],
    ['unsafe count',r=>{r[0].resourceCount=Number.MAX_SAFE_INTEGER+1;}],
    ['extra sensitive column',r=>{r[0].email='PRIVATE_EMAIL';}],
    ['missing column',r=>{delete r[0].memberCount;}],['duplicate id',r=>{r[1].id=r[0].id;}],
    ['string sensitive id',r=>{r[0].id='PRIVATE_ID';}],['unsafe id',r=>{r[0].id=Number.MAX_SAFE_INTEGER+1;}],
    ['reordered rows',r=>r.reverse()],['owner inconsistency',r=>{r[0].activeOwnerCount=100;}],
    ['invalid active',r=>{r[0].active=2;}],['invalid lifecycle',r=>{r[0].storageStatus='PRIVATE_INVALID';}],
  ];
  for (const [name,mutate] of badRows) test(profile + ': rejects malformed aggregate ' + name, async t => {
    const f=fixture(t,()=>{},(sql,rows)=>{if(sql===QA_INVENTORY_QUERIES.organizations) mutate(rows);return rows;});
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_RESPONSE_INVALID'});
  });
  test(profile + ': refuses truncation, limit overflow and invalid summary before organization read', async t => {
    const f=fixture(t,()=>{},(sql,rows)=>sql===QA_INVENTORY_QUERIES.summary?[{organizationCount:101,unresolvedManagementItems:0}]:rows);
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_LIMIT_EXCEEDED'});
    assert.equal(f.calls.some(a=>a.includes(QA_INVENTORY_QUERIES.organizations)),false);
  });
  test(profile + ': incomplete rows fail closed', async t => {
    const f=fixture(t,()=>{},(sql,rows)=>sql===QA_INVENTORY_QUERIES.organizations?rows.slice(0,1):rows);
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_INCOMPLETE'});
  });
  test(profile + ': empty inventory returns no fabricated candidate',async t=>{
    const f=fixture(t,db=>db.exec('DELETE FROM organization_users; DELETE FROM organizations;'));
    const result=await collectQaInventory('synthetic',remote,migration,f.injected);
    assert.equal(result.scannedCount,0);assert.equal(result.selection.status,'NO_ELIGIBLE_CANDIDATE');
    assert.equal(result.selection.organization,null);
  });
  test(profile + ': malformed summary rejects before listing aggregates',async t=>{
    const f=fixture(t,()=>{},(sql,rows)=>sql===QA_INVENTORY_QUERIES.summary?[{organizationCount:'2',unresolvedManagementItems:0}]:rows);
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_RESPONSE_INVALID'});
    assert.equal(f.calls.some(a=>a.includes(QA_INVENTORY_QUERIES.organizations)),false);
  });
  test(profile + ': failed D1 response cannot use accompanying results as success',async t=>{
    const f=fixture(t), run=f.injected.runProcess;
    f.injected.runProcess=async(command,args)=>{
      const result=await run(command,args);
      return args.includes(QA_INVENTORY_QUERIES.summary)?{stdout:JSON.stringify([{success:false,results:[{organizationCount:2,unresolvedManagementItems:0}],errors:['PRIVATE']}])}:result;
    };
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_RESPONSE_INVALID'});
  });
  test(profile + ': schema drift prevents inventory reads',async t=>{
    const f=fixture(t,db=>db.exec('CREATE INDEX unexpected_org_index ON organizations(active);'));
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_SCHEMA_OR_LEDGER_UNREADY'});
    assert.equal(f.calls.some(a=>a.includes(QA_INVENTORY_QUERIES.summary)),false);
  });
  test(profile + ': wrong target and migration hash stop before network',async t=>{
    const f=fixture(t);
    await assert.rejects(collectQaInventory('synthetic',{...remote,identity:{...remote.identity,id:'other'}},migration,f.injected),{code:'ORGANIZATION_POSTVALIDATE_TARGET_INVALID'});
    await assert.rejects(collectQaInventory('synthetic',remote,{...migration,sha256:'0'.repeat(64)},f.injected),{code:'ORGANIZATION_POSTVALIDATE_TARGET_INVALID'});
    assert.equal(f.calls.length,0);
  });
  for (const key of ['summary','organizations','ledger']) test(profile + ': detects drift in ' + key, async t => {
    let reads=0;
    const sql=key==='ledger'?'SELECT id, name, applied_at FROM d1_migrations ORDER BY id;':QA_INVENTORY_QUERIES[key];
    const f=fixture(t,()=>{},(query,rows)=>{
      if(query===sql && ++reads===(key==='ledger'?3:2)) {
        if(key==='summary') rows[0].unresolvedManagementItems++;
        else if(key==='organizations') rows[0].managementVersion++;
        else rows[0].applied_at='2026-10-30 02:00:00';
      }
      return rows;
    });
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'QA_INVENTORY_DRIFT'});
  });
  for (const key of ['quickCheck','foreignKeys']) test(profile + ': integrity failure never returns database details: ' + key, async t => {
    const f=fixture(t,()=>{},(sql,rows)=>sql===QA_INVENTORY_QUERIES[key]?[{private:'PRIVATE_DATA'}]:rows);
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),e=>{
      assert.equal(e.code,'QA_INVENTORY_INTEGRITY_FAILED');assert.doesNotMatch(JSON.stringify(e),/PRIVATE/);return true;
    });
    assert.equal(f.calls.some(a=>a.includes(QA_INVENTORY_QUERIES.organizations)),false);
  });
  test(profile + ': pending migration prevents business aggregate reads', async t => {
    const f=fixture(t);
    await assert.rejects(collectQaInventory('synthetic',{...remote,localMigrations:[...names,'0043_pending.sql']},migration,f.injected),{code:'QA_INVENTORY_SCHEMA_OR_LEDGER_UNREADY'});
    assert.equal(f.calls.some(a=>a.includes(QA_INVENTORY_QUERIES.summary)),false);
  });
  test(profile + ': strict raw ledger rejects invalid hidden row', async t => {
    const f=fixture(t,()=>{},(sql,rows)=>sql.startsWith('SELECT id, name, applied_at')?[...rows,{id:999,name:'',applied_at:'PRIVATE'}]:rows);
    await assert.rejects(collectQaInventory('synthetic',remote,migration,f.injected),{code:'ORGANIZATION_LEDGER_INVALID'});
    assert.equal(f.calls.some(a=>a.includes(QA_INVENTORY_QUERIES.summary)),false);
  });
}

test('inventory dispatcher preserves a separate fixed read-only branch and minimized artifact', () => {
  const workflow=source('.github/workflows/production-d1-migration-operator.yml');
  const branches=[...workflow.matchAll(/            organization-qa-inventory\)\r?\n([\s\S]*?)              ;;/g)];
  assert.equal(branches.length,2);
  for(const [,body] of branches) {
    assert.match(body,/test -z "\$APPROVAL_HASH"/);
    assert.match(body,/test "\$MIGRATION" = "0042_organization_management.sql"/);
    assert.doesNotMatch(body,/migration:apply|migration:audit|wrangler|acceptance:|curl|fetch/);
  }
  assert.match(branches[1][1],/npm run migration:inventory:organizations -- --migration "\$MIGRATION" --report "\$report"/);
  assert.match(workflow,/path:.*inputs.mode == 'organization-qa-inventory'.*organization-qa-inventory.json/);
  assert.match(workflow,/retention-days:.*organization-qa-inventory.*3.*14/);
  const cli=source('scripts/migrations/inventory-organizations-production.mjs');
  assert.ok(cli.indexOf('validateQaInventoryContext(process.env') < cli.indexOf('await readRemoteState('));
  assert.ok(cli.indexOf('buildOrganizationSchemaReferences(ORGANIZATION_SCHEMA_QUERIES)') < cli.indexOf('await readRemoteState('));
  assert.doesNotMatch(cli,/error\.message|error\.details|console\.log|runWranglerApply|fetch\(/);
});

const workflow=source('.github/workflows/production-d1-migration-operator.yml');
const inputGate=workflow.match(/name: Validate owner, dispatch ref and explicit inputs[\s\S]*?run: \|\r?\n([\s\S]*?)\r?\n      - name: Checkout canonical product branch/)[1]
  .split(/\r?\n/).map(line=>line.slice(10)).join('\n');
const gitExec = process.platform==='win32' ? spawnSync('git',['--exec-path'],{encoding:'utf8',windowsHide:true}) : null;
if(gitExec) assert.equal(gitExec.status,0,'Git for Windows is required for the Bash dispatcher contract');
const bash = gitExec ? resolve(gitExec.stdout.trim(),'../../../bin/bash.exe') : 'bash';
for(const [name,change,expected] of [
  ['valid inventory',{},0],['wrong owner',{ACTOR:'other'},1],['wrong ref',{DISPATCH_REF:'feature'},1],
  ['wrong migration',{MIGRATION:'0043_other.sql'},1],['approval on inventory',{APPROVAL_HASH:'a'.repeat(64)},1],
  ['unknown mode',{MODE:'arbitrary-sql'},2],['migration injection',{MIGRATION:'0042_x.sql; exit 0'},1],
  ['audit unchanged',{MODE:'audit'},0],['postvalidate unchanged',{MODE:'postvalidate'},0],
  ['apply missing approval',{MODE:'apply'},1],['apply syntax unchanged',{MODE:'apply',APPROVAL_HASH:'a'.repeat(64)},0],
]) test('real dispatcher input shell: '+name,()=>{
  const result=spawnSync(bash,['--noprofile','--norc','-s'],{
    input:inputGate,encoding:'utf8',windowsHide:true,
    env:{...process.env,ACTOR:'matheusapc22',OWNER:'matheusapc22',DISPATCH_REF:'main',MODE:'organization-qa-inventory',
      MIGRATION:ORGANIZATION_MIGRATION,APPROVAL_HASH:'',...change},
  });
  assert.equal(result.error,undefined);
  assert.equal(result.status,expected);
});
