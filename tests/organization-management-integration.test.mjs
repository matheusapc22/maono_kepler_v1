import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {onRequest} from '../functions/api/admin/organization-management/[[path]].js';
import {onRequestPost as requestIncrease} from '../functions/api/organizations/[id]/limits/requests.js';
import {getOrganizationLimits} from '../functions/_lib/organizations.js';
import {getOrganizationLimitsSnapshot,reserveProjectQuota} from '../functions/_lib/organization-limit-service.js';
import {updateOrganizationLifecycle} from '../functions/_lib/organization-lifecycle.js';
import {requirePermission} from '../functions/_lib/permissions.js';

// Actual product schema, sessions, ACL, Pages route, lifecycle, audit and quotas.
// Only Dropbox HTTP is simulated by the existing offline persistence fixture.
function fixture(t,hooks={}) {
  const f=persistenceFixture(t,hooks);
  f.env.ORGANIZATION_MANAGEMENT_V1='true';
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  f.call=async(path,body,userId=1,headers={})=>{
    const request=new Request(`https://local.invalid/api/admin/organization-management${path}`,{
      method:body===undefined?'GET':'POST',headers:{...f.headers(userId),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1',...headers},
      body:body===undefined?undefined:JSON.stringify(body),
    });
    const response=await onRequest({env:f.env,request});
    return {status:response.status,data:await response.json()};
  };
  f.start=async(kind,items,key=crypto.randomUUID())=>{
    const result=await f.call('/operations',{kind,items},1,{'Idempotency-Key':key});
    assert.equal(result.status,200,JSON.stringify(result.data));return result.data;
  };
  f.step=async(op,retry=false)=>{
    const out=await f.call(`/operations/${op.id}/step`,{retry});
    assert.equal(out.status,200,JSON.stringify(out.data));return out.data;
  };
  f.version=(id=1)=>f.db.prepare('SELECT management_version v FROM organizations WHERE id=?').get(id).v;
  return f;
}

test('real session and ACL deny owners, expired sessions and revoked operators',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/organizations')).status,200);
  assert.equal((await f.call('/organizations',undefined,2)).status,403);
  const op=await f.start('pause',[{id:1,version:0,reason:'Paused by operator'}]);
  f.db.exec("UPDATE users SET role='client' WHERE id=1");
  assert.equal((await f.call(`/operations/${op.id}/step`,{})).status,403);
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=1').get().active,1);
  f.db.exec("UPDATE users SET role='super_admin',active=0 WHERE id=1");
  assert.equal((await f.call('/organizations')).status,401);
});

test('real operation ownership isolates another Super Admin',async t=>{
  const f=fixture(t),op=await f.start('pause',[{id:1,version:0,reason:'Pause intended'}]);
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=2");
  assert.equal((await f.call(`/operations/${op.id}`,undefined,2)).status,404);
  assert.equal((await f.call(`/operations/${op.id}/step`,{},2)).status,404);
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=1').get().active,1);
});

test('actual lifecycle pauses without deleting members, project ACL or files and replay is inert',async t=>{
  const f=fixture(t);
  f.db.exec(`INSERT INTO projects(id,name,slug,dropbox_root_path,organization_id) VALUES(1,'Map','map','/offline/a/map',1);
    INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,1,'owner');
    INSERT INTO organization_files(organization_id,name,file_name,dropbox_path) VALUES(1,'Document','document.pdf','/offline/a/document.pdf');`);
  const snapshot=()=>['organization_users','projects','user_projects','organization_files'].map(table=>f.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  const before=snapshot(),op=await f.start('pause',[{id:1,version:0,reason:'Maintenance pause'}]);
  const out=await f.step(op);
  assert.equal(out.items[0].state,'succeeded',JSON.stringify(out));
  assert.deepEqual(snapshot(),before);
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=2').get().active,1);
  assert.equal(f.db.prepare('SELECT storage_status FROM organizations WHERE id=1').get().storage_status,'DISABLED');
  const calls=f.calls.length;await f.step(op);
  assert.equal(f.calls.length,calls);
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_management_events WHERE action='organization.paused'").get().n,1);
});

test('create uses real lifecycle and owner assignment; repeated step creates no duplicate or global role change',async t=>{
  const f=fixture(t),input={name:'Created organization',slug:'created-org',description:'Local fixture',plan:'pro',ownerEmail:'other@offline.invalid'};
  const key=crypto.randomUUID(),op=await f.start('create',[input],key);
  const out=await f.step(op);
  assert.equal(out.items[0].state,'succeeded',JSON.stringify(out));
  const row=f.db.prepare("SELECT * FROM organizations WHERE slug='created-org'").get();
  assert.equal(row.storage_status,'READY');assert.equal(row.management_owner_id,2);assert.equal(row.project_limit,null);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=2').get().role,'client');
  assert.equal(f.db.prepare('SELECT access_level FROM organization_users WHERE organization_id=? AND user_id=2').get(row.id).access_level,'owner');
  const providerCalls=f.calls.length;
  assert.equal((await f.start('create',[input],key)).id,op.id);await f.step(op);
  assert.equal(f.calls.length,providerCalls);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organizations WHERE slug='created-org'").get().n,1);
});

test('metadata CAS rejects stale version across the actual lifecycle',async t=>{
  const f=fixture(t),one=await f.start('change',[{id:1,version:0,name:'Winner',reason:'First correction'}]),two=await f.start('change',[{id:1,version:0,name:'Loser',reason:'Second correction'}]);
  const results=await Promise.all([f.step(one),f.step(two)]);
  assert.equal(results.filter(r=>r.items[0].state==='succeeded').length,1);
  assert.equal(results.filter(r=>['ORGANIZATION_VERSION_CONFLICT','ORGANIZATION_CONCURRENT_UPDATE'].includes(r.items[0].code)).length,1);
  assert.equal(f.version(),1);
});

test('fresh storage preparation is partial until a new verification confirms readiness',async t=>{
  const f=fixture(t);
  f.db.prepare("UPDATE organizations SET dropbox_root_path='/projects/offline-a',storage_status='PENDING',storage_checked_at=? WHERE id=1").run(new Date().toISOString());
  const op=await f.start('resume',[{id:1,version:f.version(),reason:'Verify preparation'}]);
  const out=await f.step(op);
  assert.equal(out.items[0].state,'partial',JSON.stringify(out));
  assert.equal(out.items[0].code,'STORAGE_UNCONFIRMED');
  f.db.exec("UPDATE organizations SET storage_checked_at='2000-01-01T00:00:00.000Z' WHERE id=1");
  const verify=await f.start('resume',[{id:1,version:f.version(),reason:'Verify stale preparation'}]);
  const ready=await f.step(verify);
  assert.equal(ready.items[0].state,'succeeded',JSON.stringify(ready));
  assert.equal(f.db.prepare('SELECT storage_status FROM organizations WHERE id=1').get().storage_status,'READY');
});

test('real limit request persists its actor and approval updates displayed and enforced quota',async t=>{
  const f=fixture(t);
  const request=new Request('https://local.invalid/api/organizations/2/limits/requests',{method:'POST',headers:{...f.headers(2),'Content-Type':'application/json'},body:JSON.stringify({requestType:'projects_increase',reason:'More projects',requestedLimits:{projects:1}})});
  const response=await requestIncrease({env:f.env,request,params:{id:'2'}}),body=await response.json();
  assert.equal(response.status,201,JSON.stringify(body));
  const req=f.db.prepare('SELECT * FROM organization_limit_requests WHERE id=?').get(body.request.id);
  assert.equal(req.created_by,2);assert.equal(JSON.parse(req.requested_limits_json).projects,1);
  const op=await f.start('review',[{id:req.id,version:0,organizationVersion:f.version(2),decision:'approved',reason:'Reviewed capacity',projectLimit:1}]);
  const out=await f.step(op);assert.equal(out.items[0].state,'succeeded',JSON.stringify(out));
  assert.equal((await getOrganizationLimits(f.env,2)).projects.limit,1);
  assert.equal((await getOrganizationLimitsSnapshot(f.env,2)).projects.limit,1);
  await reserveProjectQuota(f.env,{organizationId:2,actorUserId:2,idempotencyKey:'first-project-reservation'});
  await assert.rejects(reserveProjectQuota(f.env,{organizationId:2,actorUserId:2,idempotencyKey:'second-project-reservation'}),{code:'ORGANIZATION_PROJECT_LIMIT_REACHED'});
});

test('legacy update records genuine before/after, invalidates edit and still works with management flag off',async t=>{
  const f=fixture(t);f.env.ORGANIZATION_MANAGEMENT_V1='false';
  await updateOrganizationLifecycle(f.env,1,{name:'Legacy changed'});
  const events=f.db.prepare('SELECT * FROM organization_management_events WHERE organization_id=1').all();
  assert.equal(events.length,1);assert.equal(events[0].actor_id,null);
  assert.equal(JSON.parse(events[0].before_json).name,'Offline A');
  assert.equal(JSON.parse(events[0].after_json).name,'Legacy changed');
  assert.equal(f.version(),1);
  assert.equal((await f.call('/organizations')).status,503);
});

test('canonical schema equals additive migration applied to populated previous schema',t=>{
  const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8'),db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(schema.split('-- Organization limit requests (migration 0007, prerequisite of 0042)')[0]);
  db.exec(readFileSync(new URL('../migrations/0007_create_organization_limit_requests.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO users(id,email,password_hash) VALUES(1,'owner@example.test','not-a-login');
    INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(1,'Existing','existing','/projects/existing');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,1,'owner');
    INSERT INTO organization_limit_requests(organization_id,request_type,created_by) VALUES(1,'projects_increase',1);`);
  db.exec(readFileSync(new URL('../migrations/0042_organization_management.sql',import.meta.url),'utf8'));
  assert.equal(db.prepare('SELECT name FROM organizations').get().name,'Existing');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM organization_management_events').get().n,0,'No fabricated retrospective history');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const clean=new DatabaseSync(':memory:');t.after(()=>clean.close());clean.exec(schema);
  const definitions=connection=>connection.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  assert.deepEqual(definitions(db),definitions(clean));
});

test('plan edits preserve inherited defaults and unrelated overrides',async t=>{
  const f=fixture(t);f.env.PROJECT_LIMIT_PRO='23';
  let op=await f.start('change',[{id:1,version:f.version(),plan:'pro',reason:'Select inherited plan'}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  assert.equal(f.db.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,null);
  let detail=(await f.call('/organizations/1')).data.policy;
  assert.equal(detail.projects,23);assert.equal(detail.projectSource,'environment');
  assert.equal((await getOrganizationLimitsSnapshot(f.env,1)).projects.limit,23);
  op=await f.start('change',[{id:1,version:f.version(),projectLimit:17,reason:'Explicit capacity'}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  op=await f.start('change',[{id:1,version:f.version(),plan:'enterprise',reason:'Preserve explicit capacity'}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  detail=(await f.call('/organizations/1')).data.policy;
  assert.equal(detail.projects,17);assert.equal(detail.projectSource,'organization');
  op=await f.start('change',[{id:1,version:f.version(),projectLimit:null,reason:'Restore inherited capacity'}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  assert.equal((await getOrganizationLimitsSnapshot(f.env,1)).projects.limit,500);
  assert.equal(f.db.prepare('SELECT project_limit FROM organizations WHERE id=2').get().project_limit,null);
});

test('reservation rejects a stale default policy after concurrent downgrade without an override',async t=>{
  let changed=false;
  const f=fixture(t,{beforeSql({sql,db}){
    if(!changed&&/INSERT INTO organization_resource_reservations/.test(sql)){
      changed=true;db.exec("UPDATE organizations SET plan='free' WHERE id=1");
    }
  }});
  f.db.exec("UPDATE organizations SET plan='pro' WHERE id=1");
  await assert.rejects(reserveProjectQuota(f.env,{organizationId:1,actorUserId:1,idempotencyKey:'stale-default-policy'}),{code:'ORGANIZATION_QUOTA_POLICY_CHANGED'});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_resource_reservations').get().n,0);
  await reserveProjectQuota(f.env,{organizationId:1,actorUserId:1,idempotencyKey:'stale-default-policy'});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_resource_reservations').get().n,1);
});

test('plan request approval preserves default inheritance and refusal leaves policy unchanged',async t=>{
  const f=fixture(t);
  f.db.exec("INSERT INTO organization_limit_requests(id,organization_id,request_type,requested_plan,created_by) VALUES(1,1,'plan_upgrade','pro',1),(2,1,'plan_upgrade','enterprise',1)");
  let op=await f.start('review',[{id:1,version:0,organizationVersion:f.version(),decision:'approved',reason:'Approve plan only',projectLimit:null}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  assert.equal(f.db.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,null);
  assert.equal((await getOrganizationLimitsSnapshot(f.env,1)).projects.limit,50);
  op=await f.start('review',[{id:2,version:0,organizationVersion:f.version(),decision:'rejected',reason:'Decline plan request',projectLimit:999}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  assert.equal((await getOrganizationLimitsSnapshot(f.env,1)).projects.limit,50);
});

test('preexisting session loses paused context only and retains access after switching to an active organization',async t=>{
  const f=fixture(t);
  f.db.exec("INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,2,'owner'); UPDATE sessions SET active_organization_id=1 WHERE user_id=2");
  const request=new Request('https://local.invalid/api/organizations/1',{headers:f.headers(2)});
  const permission=id=>requirePermission(f.env,request,'organization.view',{scopeType:'organization',organizationId:id},{audit:false,auditOnSuccess:false});
  await permission(1);
  const op=await f.start('pause',[{id:1,version:f.version(),reason:'Context maintenance'}]);
  assert.equal((await f.step(op)).items[0].state,'succeeded');
  await assert.rejects(permission(1),error=>error.status===403);
  assert.equal((await f.call('/organizations/1')).status,200,'Administrative recovery remains available');
  f.db.exec('UPDATE sessions SET active_organization_id=2 WHERE user_id=2');
  await permission(2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=2').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_users WHERE user_id=2').get().n,2);
});

test('create replay during an existing storage claim remains partial and resumes the same record',async t=>{
  const f=fixture(t),input={name:'Pending create',slug:'pending-create',plan:'free',ownerEmail:'other@offline.invalid'};
  const op=await f.start('create',[input]);
  f.db.prepare("INSERT INTO organizations(name,slug,dropbox_root_path,storage_status,storage_checked_at,management_create_key) VALUES('Pending create','pending-create','/projects/pending-create','PENDING',?,?)").run(new Date().toISOString(),`${op.id}:0`);
  let result=await f.step(op);
  assert.equal(result.items[0].state,'partial');assert.equal(result.items[0].retryable,true);
  const id=result.items[0].result.id;
  f.db.prepare("UPDATE organizations SET storage_checked_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
  result=await f.step(op,true);
  assert.equal(result.items[0].state,'succeeded',JSON.stringify(result));
  assert.equal(result.items[0].result.id,id);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organizations WHERE slug='pending-create'").get().n,1);
});
