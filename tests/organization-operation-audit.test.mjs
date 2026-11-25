import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {onRequest} from '../functions/api/admin/organization-management/[[path]].js';
import {startOperation,stepOperation} from '../functions/_lib/organization-management-service.js';
import {updateOrganizationLifecycle,createOrganizationLifecycle} from '../functions/_lib/organization-lifecycle.js';
import {resolveOrganizationPolicy,isProjectQuotaReservationEnabled} from '../functions/_lib/organization-limit-service.js';
import {ManagementError} from '../functions/_lib/organization-management-contract.js';
import {requireOperationAuditReady,auditFrameStatement,safeAuditDetails,safeAuditChanges} from '../functions/_lib/operation-audit.js';
import {getAuditRecoveryActions,runAuditRecoveryAction,consultOrganizationOperation} from '../functions/_lib/organization-audit-recovery.js';
import {deletionPreview} from '../functions/_lib/organization-permanent-deletion.js';
import {runScheduledOrganizationDeletion} from '../workers/organization-deletion.js';
import {openHistoricalFixture} from './helpers/deletion-historical-fixture.mjs';
import {onRequest as auditRecoveryHttp} from '../functions/api/admin/audit/[eventId]/retry.js';

function fixture(t,hooks={}) {
  const f=persistenceFixture(t,hooks);
  f.env.ADMIN_AUDIT_OPERATIONS_V1='true';f.env.ORGANIZATION_MANAGEMENT_V1='true';f.env.ORGANIZATION_PERMANENT_DELETE_V1='true';
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  f.actor={id:1,name:'Offline owner',role:'super_admin',active:1};
  f.request=new Request('https://local.invalid/api/admin/audit/frame:1/retry',{method:'POST',headers:{'X-Maono-UI-Route':'/admin'}});
  f.deps={createLifecycle:createOrganizationLifecycle,updateLifecycle:updateOrganizationLifecycle,resolvePolicy:resolveOrganizationPolicy,quotaEnabled:isProjectQuotaReservationEnabled,
    authorizeGlobal:async()=>({user:f.actor}),authorizeOrganization:async()=>({user:f.actor}),request:f.request};
  f.version=id=>f.db.prepare('SELECT management_version FROM organizations WHERE id=?').get(id).management_version;
  f.operation=async (patch={},kind='change')=>startOperation(f.env,f.actor,crypto.randomUUID(),{kind,items:[{id:1,version:f.version(1),reason:'Teste de auditoria',...patch}]});
  f.frame=id=>f.db.prepare('SELECT * FROM audit_operation_frames WHERE operation_id=? ORDER BY id DESC LIMIT 1').get(id);
  f.frames=id=>f.db.prepare('SELECT * FROM audit_operation_frames WHERE operation_id=? ORDER BY id').all(id);
  f.call=async(path,body)=>{const response=await onRequest({env:f.env,request:new Request('https://local.invalid/api/admin/organization-management'+path,{method:body===undefined?'GET':'POST',headers:{...f.headers(1),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1','X-Maono-UI-Route':'/admin','Idempotency-Key':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
  return f;
}

test('0045 is additive, exactly matches bootstrap and rejects schema/append-only drift',async t=>{
  const f=fixture(t);await requireOperationAuditReady(f.env);
  const source=readFileSync(new URL('../schema.sql',import.meta.url),'utf8'),prior=source.split('-- Operation audit journal (migration 0045).')[0];
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(prior);db.exec(readFileSync(new URL('../migrations/0045_operation_audit_frames.sql',import.meta.url),'utf8'));
  const sql="SELECT name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND (name GLOB 'audit_*' OR name GLOB 'idx_audit_frames_*' OR name GLOB 'organization_*reconciliation*') ORDER BY name";
  assert.deepEqual(db.prepare(sql).all(),f.db.prepare(sql).all());
  assert.throws(()=>f.db.exec('UPDATE audit_operation_frames SET outcome=\'succeeded\''),/APPEND_ONLY/);
  assert.throws(()=>f.db.exec('DELETE FROM audit_operation_frames'),/APPEND_ONLY/);
  f.db.exec("DROP TRIGGER audit_frames_no_update;CREATE TRIGGER audit_frames_no_update BEFORE UPDATE ON audit_operation_frames BEGIN SELECT 1; END;");
  await assert.rejects(requireOperationAuditReady(f.env),{code:'AUDIT_OPERATIONS_SCHEMA_REQUIRED'});
});

test('HTTP action persists actor/origin, atomic effect and immutable attempt after reload',async t=>{
  const f=fixture(t),started=await f.call('/operations',{kind:'change',items:[{id:1,version:f.version(1),name:'Audited organization',reason:'Alteração auditada'}]});
  assert.equal(started.status,200);const id=started.data.id;
  const done=await f.call(`/operations/${id}/step`,{});assert.equal(done.status,200);assert.equal(done.data.items[0].state,'succeeded');
  const rows=f.frames(id);assert.ok(rows.some(row=>row.outcome==='authorized'));assert.ok(rows.some(row=>row.event_type==='effect_confirmed'));
  assert.equal(rows.at(-1).event_type,'attempt_finished');assert.equal(rows.at(-1).outcome,'succeeded');
  assert.equal(rows.at(-1).actor_id,1);assert.equal(rows.at(-1).original_actor_name,'Offline owner');assert.equal(rows.at(-1).ui_route,'/admin');
  assert.match(rows.at(-1).technical_origin,/^api:POST:/);
  const reload=await f.call(`/operations/${id}`);assert.equal(reload.data.items[0].state,'succeeded');
  await f.call(`/operations/${id}/step`,{});assert.equal(f.frames(id).length,rows.length);
});

test('mandatory effect-journal failure rolls back the business change; unknown is not success',async t=>{
  const f=fixture(t),initial=f.version(1),op=await f.operation({name:'Must rollback'});
  f.db.exec("CREATE TRIGGER fail_audit_effect BEFORE INSERT ON audit_operation_frames WHEN NEW.event_type='effect_confirmed' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE');END;");
  const result=await stepOperation(f.env,f.actor,op.id,false,f.deps);
  assert.equal(result.items[0].state,'failed');assert.equal(f.version(1),initial);
  assert.equal(f.db.prepare('SELECT name FROM organizations WHERE id=1').get().name,'Offline A');
  assert.equal(f.frames(op.id).at(-1).outcome,'unknown');
});

test('mandatory attempt journal failure leaves item pending and performs no mutation',async t=>{
  const f=fixture(t),version=f.version(1),op=await f.operation({name:'Must not begin'});
  f.db.exec("CREATE TRIGGER fail_audit_claim BEFORE INSERT ON audit_operation_frames WHEN NEW.event_type='attempt_started' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CLAIM_FAILURE');END;");
  await assert.rejects(stepOperation(f.env,f.actor,op.id,false,f.deps),/SYNTHETIC_CLAIM_FAILURE/);
  assert.equal(f.version(1),version);assert.equal(f.db.prepare('SELECT state FROM organization_management_operation_items WHERE operation_id=?').get(op.id).state,'pending');
});

test('unchanged command is no_change and does not manufacture an effect/version',async t=>{
  const f=fixture(t),version=f.version(1),op=await f.operation({name:'Offline A'});
  await stepOperation(f.env,f.actor,op.id,false,f.deps);
  assert.equal(f.version(1),version);assert.equal(f.frame(op.id).outcome,'no_change');assert.ok(!f.frames(op.id).some(row=>row.event_type==='effect_confirmed'));
});

test('new attempt retains first failure, enforces original author and makes identical recovery key inert',async t=>{
  const f=fixture(t),op=await f.operation({name:'Recovered'});let calls=0;
  const deps={...f.deps,updateLifecycle:async(...args)=>{calls++;if(calls===1)throw new ManagementError('Preparação em andamento.',409,'ORGANIZATION_STORAGE_IN_PROGRESS',true);return updateOrganizationLifecycle(...args);}};
  await stepOperation(f.env,f.actor,op.id,false,deps);const original=f.frame(op.id);assert.equal(original.outcome,'failed');
  const actions=await getAuditRecoveryActions(f.env,f.actor,original);assert.ok(actions.some(action=>action.kind==='retry'));assert.ok(actions.some(action=>action.kind==='query'));
  const command={action:'retry',expectedVersion:f.version(1),requestKey:crypto.randomUUID()};
  await runAuditRecoveryAction(f.env,f.actor,original,command,f.request,deps);
  await runAuditRecoveryAction(f.env,f.actor,original,command,f.request,deps);
  assert.equal(calls,2);const finished=f.frames(op.id).filter(row=>row.event_type==='attempt_finished');assert.deepEqual(finished.map(row=>row.outcome),['failed','succeeded']);
  assert.equal(finished[1].parent_attempt_id,finished[0].attempt_id);
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=2");
  assert.equal((await getAuditRecoveryActions(f.env,{id:2,role:'super_admin'},original))[0].enabled,false);
  f.db.exec('UPDATE users SET active=0 WHERE id=1');await assert.rejects(runAuditRecoveryAction(f.env,f.actor,original,command,f.request,deps),{code:'AUTH_PERMISSION_DENIED'});
});

test('two callers share lease and cannot duplicate a confirmed effect',async t=>{
  const f=fixture(t),op=await f.operation({name:'Concurrent'});let calls=0;
  const deps={...f.deps,updateLifecycle:async(...args)=>{calls++;return updateOrganizationLifecycle(...args);}};
  await Promise.all([stepOperation(f.env,f.actor,op.id,false,deps),stepOperation(f.env,f.actor,op.id,false,deps)]);
  assert.equal(calls,1);assert.equal(f.frames(op.id).filter(row=>row.source==='organization_management_events').length,1);
});

test('committed result with lost response is queryable without duplicate effect',async t=>{
  let dropped=false;const f=fixture(t,{afterBatch({statements}){if(!dropped&&statements.some(s=>s.sql.startsWith('UPDATE organization_management_operation_items SET state=?'))){dropped=true;throw new Error('Synthetic response lost after COMMIT');}}});
  const op=await f.operation({name:'Committed despite lost reply'});
  await assert.rejects(stepOperation(f.env,f.actor,op.id,false,f.deps),/response lost/);
  const again=await stepOperation(f.env,f.actor,op.id,false,f.deps);assert.equal(again.items[0].state,'succeeded');
  assert.equal(f.frames(op.id).filter(row=>row.source==='organization_management_events').length,1);assert.equal(f.frame(op.id).outcome,'succeeded');
});

test('expired crashed lease requires query before resuming the same idempotent operation',async t=>{
  const f=fixture(t),op=await f.operation({name:'After crash'});
  f.db.prepare("UPDATE organization_management_operation_items SET state='running',attempts=1,lease_token='crashed',lease_until='2020-01-01' WHERE operation_id=?").run(op.id);
  const frame=f.frame(op.id);assert.deepEqual((await getAuditRecoveryActions(f.env,f.actor,frame)).map(action=>action.kind),['query']);
  await runAuditRecoveryAction(f.env,f.actor,frame,{action:'query'},f.request,f.deps);
  assert.ok((await getAuditRecoveryActions(f.env,f.actor,frame)).some(action=>action.kind==='resume'));
  await runAuditRecoveryAction(f.env,f.actor,frame,{action:'resume',expectedVersion:f.version(1),requestKey:crypto.randomUUID()},f.request,f.deps);
  assert.equal(f.frame(op.id).outcome,'succeeded');
});

test('review request IDs cannot be confused with organization IDs in deletion blockers',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET active=0,storage_status='DISABLED',dropbox_root_path='/projects/offline-a',updated_at='2020-01-01' WHERE id=1; INSERT INTO organization_limit_requests(id,organization_id,request_type,requested_plan,reason,created_by) VALUES(1,2,'projects_increase',NULL,'Teste da colisão',2)");
  const op=await startOperation(f.env,f.actor,crypto.randomUUID(),{kind:'review',items:[{id:1,version:0,organizationVersion:f.version(2),decision:'rejected',reason:'Teste da colisão'}]});
  const one=await deletionPreview(f.env,1,f.actor),two=await deletionPreview(f.env,2,f.actor);
  assert.ok(!one.blockers.some(b=>b.operationId===op.id));assert.ok(two.blockers.some(b=>b.operationId===op.id));
});

test('terminal no-effect reconciliation releases only its matching attempt and preserves original failure',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET active=0,storage_status='DISABLED',dropbox_root_path='/projects/offline-a',updated_at='2020-01-01' WHERE id=1");
  const op=await startOperation(f.env,f.actor,crypto.randomUUID(),{kind:'change',items:[{id:1,version:999,name:'Must not apply',reason:'Conflito esperado'}]});
  await stepOperation(f.env,f.actor,op.id,false,f.deps);const before=f.frame(op.id);
  assert.ok((await deletionPreview(f.env,1,f.actor)).blockers.some(b=>b.operationId===op.id));
  const otherActorBlocker=(await deletionPreview(f.env,1,{id:2,role:'super_admin'})).blockers.find(b=>b.operationId===op.id);
  assert.equal(otherActorBlocker.action.enabled,false);assert.match(otherActorBlocker.action.reason,/autor original/);
  const result=await consultOrganizationOperation(f.env,f.actor,op.id,0,f.request,f.deps);assert.equal(result.disposition,'confirmed_no_effect');
  assert.equal(f.db.prepare('SELECT state FROM organization_management_operation_items WHERE operation_id=?').get(op.id).state,'failed');
  assert.equal(f.db.prepare('SELECT outcome FROM audit_operation_frames WHERE id=?').get(before.id).outcome,'blocked');
  assert.ok(!(await deletionPreview(f.env,1,f.actor)).blockers.some(b=>b.operationId===op.id));
  await stepOperation(f.env,f.actor,op.id,true,f.deps);assert.equal(f.db.prepare('SELECT attempts FROM organization_management_operation_items WHERE operation_id=?').get(op.id).attempts,1);
});

test('storage drift between observation and reconciliation rolls back its receipt',async t=>{
  let armed=false;const f=fixture(t,{beforeBatch({db,statements}){if(armed&&statements.some(s=>s.sql.startsWith('INSERT INTO organization_operation_reconciliations'))){armed=false;db.exec("UPDATE organizations SET storage_status='PENDING' WHERE id=1");}}});
  const op=await f.operation({name:'Confirmed metadata'});await stepOperation(f.env,f.actor,op.id,false,f.deps);
  f.db.prepare("UPDATE organization_management_operation_items SET state='partial',error_code='STORAGE_UNCONFIRMED' WHERE operation_id=?").run(op.id);
  armed=true;await assert.rejects(runAuditRecoveryAction(f.env,f.actor,f.frame(op.id),{action:'query'},f.request,f.deps),/CHECK constraint/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_operation_reconciliations').get().n,0);
});

test('legacy operation consultation produces a new observation without invented original name',async t=>{
  const f=fixture(t);f.env.ADMIN_AUDIT_OPERATIONS_V1='false';const op=await f.operation({name:'Legacy'});f.env.ADMIN_AUDIT_OPERATIONS_V1='true';
  const result=await f.call(`/operations/${op.id}/consult`,{});assert.equal(result.status,200);assert.match(result.data.auditEventId,/^frame:/);
  const observed=f.frame(op.id);assert.equal(observed.event_type,'state_observed');assert.equal(observed.original_actor_name,null);assert.equal(observed.outcome,'requested');
});

test('arbitrary request bodies/secrets are excluded by detail and change allowlists',async t=>{
  const f=fixture(t);
  assert.deepEqual(safeAuditDetails({password:'secret',token:'secret',cookie:'secret',reason:'ok'}),{reason:'ok'});
  assert.deepEqual(safeAuditChanges({name:'Allowed',password:'secret',authorization:'secret'}),{name:'Allowed'});
  await f.env.DB.batch([auditFrameStatement(f.env,{source:'test',sourceEventId:'test',eventType:'requested',outcome:'requested',action:'organization.update',details:{payload:{token:'secret'},password:'secret',state:'pending'}})]);
  assert.equal(f.db.prepare("SELECT details_json FROM audit_operation_frames WHERE source='test'").get().details_json,'{"state":"pending"}');
});

function deletionFixture(t,options={}) {
  let exists=true,removes=0,lost=Boolean(options.lostResponse);
  const f=fixture(t,{...options.hooks,beforeProvider:async({op,args})=>{
    if(op==='get_metadata'&&args.path.startsWith('/organizations/'))return Response.json({error_summary:'path/not_found/'},{status:409});
    if(op==='get_metadata')return exists?Response.json({'.tag':'folder',id:'id:audit-delete',path_lower:'/projects/audit-delete'}):Response.json({error_summary:'path/not_found/'},{status:409});
    if(op==='list_folder')return Response.json({entries:[],has_more:false});
    if(op==='delete_v2'){removes++;assert.equal(args.path,'id:audit-delete');exists=false;if(lost){lost=false;return new Response('synthetic lost body',{status:200});}return Response.json({metadata:{'.tag':'folder',id:'id:audit-delete'}});}
    throw new Error('Unexpected provider '+op);
  }});
  f.db.exec("INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at) VALUES(3,'Audit delete','audit-delete','/projects/audit-delete',0,'DISABLED','2020-01-01')");
  f.startDelete=async()=>{const r=await f.call('/organizations/3/permanent-delete',{version:f.version(3),confirmation:'EXCLUIR PERMANENTEMENTE'});assert.equal(r.status,200,JSON.stringify(r.data));f.db.prepare("UPDATE organization_deletions SET not_before='2020-01-01T00:00:00Z' WHERE id=?").run(r.data.deletion.id);return r.data.deletion;};
  f.removes=()=>removes;return f;
}

test('deletion preserves historical identities and frames without audit becoming a blocker',async t=>{
  const f=deletionFixture(t),preview=await f.call('/organizations/3/deletion-preview');assert.equal(preview.data.eligible,true);
  const d=await f.startDelete();
  const requested=f.frames(d.id).find(frame=>frame.action==='organization.deletion_requested');assert.equal(requested.operation_id,d.id);
  const result=await f.call(`/deletions/${d.id}/step`,{});assert.equal(result.data.deletion.state,'completed');assert.equal(f.removes(),1);
  assert.equal(f.db.prepare('SELECT id FROM organizations WHERE id=3').get(),undefined);
  const frames=f.frames(d.id);assert.equal(frames.at(-1).outcome,'succeeded');assert.equal(frames.at(-1).organization_name,'Audit delete');
  assert.ok(frames.some(row=>row.event_type==='storage_delete_intent'));assert.ok(frames.some(row=>row.event_type==='storage_deleted'));
  assert.equal(frames.at(-1).original_actor_name,'Offline owner');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('uncertain provider result is inspected before resume; confirmed removed folder is never removed twice',async t=>{
  const f=deletionFixture(t,{lostResponse:true}),d=await f.startDelete();
  const interrupted=await f.call(`/deletions/${d.id}/step`,{});assert.equal(interrupted.data.deletion.state,'pending');assert.equal(f.removes(),1);
  const original=f.frame(d.id);assert.equal(original.outcome,'unknown');
  assert.ok(!(await getAuditRecoveryActions(f.env,f.actor,original)).some(action=>action.kind==='resume'));
  const queried=await runAuditRecoveryAction(f.env,f.actor,original,{action:'query'},f.request,f.deps);assert.equal(queried.inspection.recoverable,true);assert.equal(f.removes(),1);
  const actions=await getAuditRecoveryActions(f.env,f.actor,original),resume=actions.find(action=>action.kind==='resume');assert.ok(resume);
  const command={action:'resume',expectedVersion:resume.expectedVersion,confirmation:'EXCLUIR PERMANENTEMENTE',requestKey:crypto.randomUUID()};
  const completed=await runAuditRecoveryAction(f.env,f.actor,original,command,f.request,f.deps);assert.equal(completed.deletion.state,'completed');assert.equal(f.removes(),1);
  await runAuditRecoveryAction(f.env,f.actor,original,command,f.request,f.deps);assert.equal(f.removes(),1);
  assert.equal(f.db.prepare('SELECT outcome FROM audit_operation_frames WHERE id=?').get(original.id).outcome,'unknown');
});

test('automatic deletion snapshots Worker executor and durably records revoked-author blocker',async t=>{
  const f=deletionFixture(t);f.env.ORGANIZATION_DELETE_AUTOMATIC_ENABLED='true';const d=await f.startDelete();
  f.db.exec('UPDATE users SET active=0 WHERE id=1');await runScheduledOrganizationDeletion(f.env);
  const blocker=f.frame(d.id);assert.equal(blocker.event_type,'authorization_blocked');assert.equal(blocker.outcome,'blocked');assert.equal(blocker.executor_kind,'worker');assert.equal(f.removes(),0);
});

test('automatic deletion and manual resume coordinate the same lease and produce one provider effect',async t=>{
  const f=deletionFixture(t);f.env.ORGANIZATION_DELETE_AUTOMATIC_ENABLED='true';const d=await f.startDelete();
  await Promise.all([runScheduledOrganizationDeletion(f.env),f.call(`/deletions/${d.id}/step`,{})]);assert.equal(f.removes(),1);
  const attempts=f.frames(d.id).filter(frame=>frame.event_type==='attempt_started');assert.equal(attempts.length,1);assert.ok(['user','worker'].includes(attempts[0].executor_kind));
});

test('0045 compiles after the historical 0044 variant without applying its canonical alternative',async t=>{
  const db=openHistoricalFixture();t.after(()=>db.close());
  db.exec(readFileSync(new URL('../scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0045_operation_audit_frames.sql',import.meta.url),'utf8'));
  const env={ADMIN_AUDIT_OPERATIONS_V1:'true',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},all:async()=>({results:db.prepare(sql).all(...args)})};}}};
  await requireOperationAuditReady(env);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('a later pause does not turn incomplete activation into a successfully reconciled resume',async t=>{
  const f=fixture(t),op=await f.operation({},'resume'),key=`${op.id}:0`;
  f.db.prepare("UPDATE organizations SET management_version=management_version+1,management_actor_id=1,management_request_id=?,management_action='organization.resumed' WHERE id=1").run(key);
  f.db.prepare("UPDATE organization_management_operation_items SET state='partial',attempts=1,error_code='STORAGE_UNCONFIRMED' WHERE operation_id=?").run(op.id);
  f.db.exec("UPDATE organizations SET active=0,storage_status='DISABLED' WHERE id=1");
  const query=await runAuditRecoveryAction(f.env,f.actor,f.frame(op.id),{action:'query'},f.request,f.deps);
  assert.equal(query.reconciled,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_operation_reconciliations').get().n,0);
  assert.equal(f.db.prepare('SELECT state FROM organization_management_operation_items WHERE operation_id=?').get(op.id).state,'partial');
});

test('a consumed recovery request interrupted before claim remains replay-safe and allows a new explicit attempt after query',async t=>{
  let interrupt=false;
  const f=fixture(t,{beforeBatch({statements}){if(interrupt&&statements.some(s=>s.sql.startsWith("UPDATE organization_management_operation_items SET state='running'"))){interrupt=false;throw new Error('Synthetic stop before claim');}}});
  const op=await f.operation({name:'Explicit second intent'});let calls=0;
  const deps={...f.deps,updateLifecycle:async(...args)=>{calls++;if(calls===1)throw new ManagementError('Preparação em andamento.',409,'ORGANIZATION_STORAGE_IN_PROGRESS',true);return updateOrganizationLifecycle(...args);}};
  await stepOperation(f.env,f.actor,op.id,false,deps);const frame=f.frame(op.id),command={action:'retry',expectedVersion:f.version(1),requestKey:crypto.randomUUID()};
  interrupt=true;await assert.rejects(runAuditRecoveryAction(f.env,f.actor,frame,command,f.request,deps),/Synthetic stop before claim/);
  await runAuditRecoveryAction(f.env,f.actor,frame,command,f.request,deps);assert.equal(calls,1);
  await runAuditRecoveryAction(f.env,f.actor,frame,{action:'query'},f.request,deps);
  await runAuditRecoveryAction(f.env,f.actor,frame,{...command,requestKey:crypto.randomUUID()},f.request,deps);
  assert.equal(calls,2);assert.equal(f.db.prepare('SELECT state FROM organization_management_operation_items WHERE operation_id=?').get(op.id).state,'succeeded');
});

test('unattributed storage writes never inherit an older management operation identity',async t=>{
  const f=fixture(t),op=await f.operation({name:'Original command'});await stepOperation(f.env,f.actor,op.id,false,f.deps);
  f.db.exec("UPDATE organizations SET storage_status='PENDING' WHERE id=1");
  const observed=f.db.prepare("SELECT * FROM audit_operation_frames WHERE source='organization_storage_observation' ORDER BY id DESC LIMIT 1").get();
  assert.equal(observed.operation_id,null);assert.equal(observed.actor_id,null);assert.equal(observed.executor_kind,'unknown');
});

test('review recovery checks request version separately from organization version',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET name='New organization revision' WHERE id=1; INSERT INTO organization_limit_requests(id,organization_id,request_type,requested_plan,reason,created_by) VALUES(90,1,'projects_increase',NULL,'Separar versões',1)");
  assert.notEqual(f.version(1),0);
  const op=await startOperation(f.env,f.actor,crypto.randomUUID(),{kind:'review',items:[{id:90,version:0,organizationVersion:f.version(1),decision:'rejected',reason:'Separar versões do contrato'}]});
  let deny=true;const deps={...f.deps,authorizeOrganization:async()=>{if(deny)throw new ManagementError('Temporariamente ocupado.',409,'ORGANIZATION_STORAGE_IN_PROGRESS',true);return {user:f.actor};}};
  await stepOperation(f.env,f.actor,op.id,false,deps);const frame=f.frame(op.id),actions=await getAuditRecoveryActions(f.env,f.actor,frame);
  assert.ok(actions.some(action=>action.kind==='retry'&&action.enabled));deny=false;
  await runAuditRecoveryAction(f.env,f.actor,frame,{action:'retry',expectedVersion:f.version(1),requestKey:crypto.randomUUID()},f.request,deps);
  assert.equal(f.db.prepare('SELECT status FROM organization_limit_requests WHERE id=90').get().status,'rejected');
});

for(const changed of ['organization','request'])test('review recovery rejects a changed '+changed+' version independently',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET name='Separate organization revision' WHERE id=1; INSERT INTO organization_limit_requests(id,organization_id,request_type,requested_plan,reason,created_by) VALUES(90,1,'projects_increase',NULL,'Separar versões',1)");
  const version=f.version(1);
  const op=await startOperation(f.env,f.actor,crypto.randomUUID(),{kind:'review',items:[{id:90,version:0,organizationVersion:version,decision:'rejected',reason:'Separar versões do contrato'}]});
  const deps={...f.deps,authorizeOrganization:async()=>{throw new ManagementError('Temporariamente ocupado.',409,'ORGANIZATION_STORAGE_IN_PROGRESS',true);}};
  await stepOperation(f.env,f.actor,op.id,false,deps);
  if(changed==='organization')f.db.exec("UPDATE organizations SET name='Changed after failed review' WHERE id=1");
  else f.db.exec('UPDATE organization_limit_requests SET management_version=management_version+1 WHERE id=90');
  const frame=f.frame(op.id),actions=await getAuditRecoveryActions(f.env,f.actor,frame);
  assert.ok(actions.some(action=>action.kind==='review'&&!action.enabled&&action.reason.includes('versão')));
  assert.ok(!actions.some(action=>['retry','resume'].includes(action.kind)&&action.enabled));
  await assert.rejects(runAuditRecoveryAction(f.env,f.actor,frame,{action:'retry',expectedVersion:f.version(1),requestKey:crypto.randomUUID()},f.request,f.deps),error=>error.code==='AUDIT_RECOVERY_UNAVAILABLE');
  assert.equal(f.db.prepare('SELECT status FROM organization_limit_requests WHERE id=90').get().status,'pending');
  assert.equal(f.db.prepare('SELECT attempts FROM organization_management_operation_items WHERE operation_id=?').get(op.id).attempts,1);
});

test('audit-enabled deletion routes preserve the Free D1 invocation query budget',async t=>{
  const f=deletionFixture(t),original=f.env.DB;let calls=0;
  f.env.DB={...original,prepare(sql){const statement=original.prepare(sql);for(const method of ['first','all','run']){const run=statement[method];statement[method]=function(...args){calls++;return run.apply(this,args);};}return statement;},batch(statements){calls++;return original.batch(statements);}};
  const measured=async(label,run)=>{calls=0;const result=await run();assert.ok(calls<50,`${label}: ${calls} invocations`);t.diagnostic(`${label}: ${calls} D1 calls`);return result;};
  await measured('audit preview',()=>f.call('/organizations/3/deletion-preview'));
  const d=await measured('audit start',()=>f.startDelete());
  const result=await measured('audit step',()=>f.call(`/deletions/${d.id}/step`,{}));assert.equal(result.data.deletion.state,'completed');
  await measured('audit status',()=>f.call(`/deletions/${d.id}`));
});

for(const drift of ['storage','operation'])test('atomic deletion claim rejects '+drift+' drift after its single request inventory',async t=>{
  let armed=true;
  const f=deletionFixture(t,{hooks:{beforeBatch({db,statements}){if(armed&&statements.some(s=>s.sql.startsWith('INSERT INTO organization_deletions('))){armed=false;
    if(drift==='storage')db.exec("UPDATE organizations SET storage_status='PENDING' WHERE id=3");
    else {db.prepare('INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json) VALUES(?,1,?,?,?,?)').run('concurrent','concurrent-unique-key','hash','pause',JSON.stringify([{id:3,version:0,active:false,reason:'Concurrent command'}]));db.exec("INSERT INTO organization_management_operation_items(operation_id,item_index) VALUES('concurrent',0)");}
  }}}});
  const result=await f.call('/organizations/3/permanent-delete',{version:f.version(3),confirmation:'EXCLUIR PERMANENTEMENTE'});
  assert.ok(result.status>=400);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_deletions').get().n,0);assert.equal(f.removes(),0);
});

test('new management command cannot become an unresolved blocker after a deletion claim',async t=>{
  const f=deletionFixture(t),d=await f.startDelete();
  await assert.rejects(startOperation(f.env,f.actor,crypto.randomUUID(),{kind:'pause',items:[{id:3,version:f.version(3),reason:'Conflicting command'}]}),/CHECK constraint/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,0);
  assert.equal((await f.call(`/deletions/${d.id}/step`,{})).data.deletion.state,'completed');
});

test('creation recovery cannot overwrite configuration changed since its initial checkpoint',async t=>{
  const f=fixture(t),op=await startOperation(f.env,f.actor,crypto.randomUUID(),{kind:'create',items:[{name:'Creation audit recovery',description:'',plan:'free',ownerEmail:'other@offline.invalid'}]});
  const complete=await stepOperation(f.env,f.actor,op.id,false,f.deps);assert.equal(complete.items[0].state,'succeeded');
  const id=complete.items[0].result.id;
  f.db.prepare("UPDATE organization_management_operation_items SET state='partial',retryable=1,error_code='ORGANIZATION_STORAGE_PENDING' WHERE operation_id=?").run(op.id);
  f.db.prepare("UPDATE organizations SET plan='pro' WHERE id=?").run(id);
  const actions=await getAuditRecoveryActions(f.env,f.actor,f.frame(op.id));assert.ok(actions.some(action=>action.kind==='query'));assert.equal(actions.find(action=>action.kind==='review').enabled,false);assert.ok(!actions.some(action=>['resume','retry'].includes(action.kind)));
  assert.equal(f.db.prepare('SELECT plan FROM organizations WHERE id=?').get(id).plan,'pro');
});

test('real Audit HTTP query and resumed deletion keep the Free D1 query budget with authorization rechecks',async t=>{
  const f=deletionFixture(t,{lostResponse:true}),d=await f.startDelete();await f.call(`/deletions/${d.id}/step`,{});
  const frame=f.frame(d.id),original=f.env.DB;let calls=0;
  f.env.DB={...original,prepare(sql){const statement=original.prepare(sql);for(const method of ['first','all','run']){const run=statement[method];statement[method]=function(...args){calls++;return run.apply(this,args);};}return statement;},batch(statements){calls++;return original.batch(statements);}};
  const post=async(command)=>{calls=0;const request=new Request(`https://local.invalid/api/admin/audit/frame:${frame.id}/retry`,{method:'POST',headers:{...f.headers(1),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1','X-Maono-UI-Route':'/admin'},body:JSON.stringify(command)});
    const response=await auditRecoveryHttp({env:f.env,params:{eventId:`frame:${frame.id}`},request});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.ok(calls<50,`${command.action}: ${calls} D1 calls`);t.diagnostic(`Audit HTTP ${command.action}: ${calls} D1 calls`);return data;};
  await post({action:'query'});const result=await post({action:'resume',expectedVersion:0,confirmation:'EXCLUIR PERMANENTEMENTE',requestKey:crypto.randomUUID()});assert.equal(result.deletion.state,'completed');assert.equal(f.removes(),1);
});
