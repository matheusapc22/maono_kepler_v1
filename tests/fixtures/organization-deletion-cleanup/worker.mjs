// Local synthetic proof Worker only; never a production entry point.
import {startDeletion,stepDeletion,deletionPreview} from '../../../functions/_lib/organization-permanent-deletion.js';
const actor={id:1,role:'super_admin'};
const absent=async()=>{throw Object.assign(new Error('Synthetic missing'),{code:'DROPBOX_PATH_NOT_FOUND'});};
const storage={metadata:absent,metadataLegacy:absent,metadataId:absent};
const check=(ok,label)=>{if(!ok)throw new Error('PROOF_FAILED:'+label);};
export default {async fetch(request,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/proof')return new Response('Not found',{status:404});
 const db=env.DB,run=(sql,...args)=>db.prepare(sql).bind(...args),get=async(sql,...args)=>(await run(sql,...args).first());
 const runtime={...env,ORGANIZATION_PERMANENT_DELETE_V1:'true'};
 await db.batch([
 run("INSERT INTO users(id,email,name,role,password_hash) VALUES(1,'local-proof@offline.invalid','Local','super_admin','not-a-login')"),
 run("INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status) VALUES(2,'Other','other','/projects/other',0,'DISABLED')"),
 run("INSERT INTO projects(id,name,slug,dropbox_root_path,organization_id) VALUES(99,'Other project','other-project','/projects/other/p',2)"),
 run("INSERT INTO user_permissions(user_id,permission,organization_id,project_id) VALUES(1,'global',NULL,NULL),(1,'project-only',NULL,99)"),
 run("INSERT INTO organization_access_delegations(id,organization_id,delegate_user_id,granted_by,updated_by) VALUES(21,2,1,1,1)")
 ]);
 for(const id of [3,4,5,6])await db.batch([
 run("INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at) VALUES(?,?,?, ?,0,'DISABLED','2020-01-01 00:00:00')",id,'Local '+id,'local-'+id,'/projects/local-'+id),
 run("INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(?,1,'owner')",id),
 run("INSERT INTO organization_access_delegations(id,organization_id,delegate_user_id,granted_by,updated_by) VALUES(?,?,1,1,1)",id*10,id),
 run("INSERT INTO delegation_permissions(delegation_id,permission) VALUES(?,'projects.view')",id*10),
 run("INSERT INTO delegation_target_levels(delegation_id,access_level) VALUES(?,'viewer')",id*10),
 run("INSERT INTO user_permissions(user_id,permission,organization_id) VALUES(1,'local',?)",id),
 run("INSERT INTO sessions(token_hash,user_id,active_organization_id,expires_at) VALUES(?,1,?,'2099-01-01')",'synthetic-'+id,id),
 run("INSERT INTO organization_management_events(organization_id,actor_id,action,version) VALUES(?,1,'synthetic.proof',1)",id)
 ]);
 const start=async id=>{const org=await get('SELECT management_version FROM organizations WHERE id=?',id);const d=(await startDeletion(runtime,actor,id,crypto.randomUUID(),{version:org.management_version,confirmation:'EXCLUIR PERMANENTEMENTE'})).deletion;await run("UPDATE organization_deletions SET not_before='2020-01-01T00:00:00Z' WHERE id=?",d.id).run();return d;};
 const step=async d=>(await stepDeletion(runtime,actor,d.id,{deletionStorage:storage})).deletion;
 const success=await start(3);check((await step(success)).state==='completed','success');
 check(!(await get('SELECT id FROM organizations WHERE id=3')),'target deleted');
 check(!(await get('SELECT id FROM delegation_permissions WHERE delegation_id=30')),'permissions cascade');
 check(!(await get('SELECT id FROM delegation_target_levels WHERE delegation_id=30')),'levels cascade');
 check((await get('SELECT enabled FROM organization_access_delegations WHERE id=21')).enabled===1,'other org');
 check((await get('SELECT COUNT(*) n FROM user_permissions WHERE organization_id IS NULL')).n===2,'global project-only');
 check((await get("SELECT active_organization_id x FROM sessions WHERE token_hash='synthetic-3'")).x===null,'detach');
 check((await get('SELECT COUNT(*) n FROM organization_deleted_management_events WHERE organization_id=3')).n>0,'archive');
 const rollback=await start(4);
 await run("CREATE TRIGGER local_proof_failure BEFORE DELETE ON organizations WHEN OLD.id=4 BEGIN SELECT RAISE(ABORT,'LOCAL_SYNTHETIC_FAILURE'); END").run();
 const epochs=await get('SELECT (SELECT version FROM project_save_authorization_generation) p,(SELECT version FROM ticket_export_generation) t');
 const failed=await step(rollback);check(failed.state==='storage_deleted'&&failed.errorCode==='ORGANIZATION_DELETE_INTERRUPTED','rollback result');
 check(!!(await get('SELECT id FROM delegation_permissions WHERE delegation_id=40')),'rollback cascade');
 check(!!(await get('SELECT id FROM organization_users WHERE organization_id=4')),'rollback membership');
 check((await get("SELECT active_organization_id x FROM sessions WHERE token_hash='synthetic-4'")).x===4,'rollback detach');
 check((await get('SELECT COUNT(*) n FROM organization_deleted_management_events WHERE organization_id=4')).n===0,'rollback archive');
 const after=await get('SELECT (SELECT version FROM project_save_authorization_generation) p,(SELECT version FROM ticket_export_generation) t');check(epochs.p===after.p&&epochs.t===after.t,'rollback epochs');
 await run("INSERT INTO user_permissions(user_id,permission,organization_id,project_id,active,expires_at) VALUES(1,'mixed',5,99,0,'2000-01-01')").run();
 check((await deletionPreview(runtime,5)).blockers.some(b=>b.code==='MIXED_SCOPE_PERMISSION'&&b.count===1),'mixed preview');
 let blocked=false;try{await start(5);}catch(e){blocked=e.code==='ORGANIZATION_DELETE_BLOCKED';}check(blocked,'mixed claim');
 const racing=await Promise.allSettled([start(6),run("INSERT INTO projects(name,slug,dropbox_root_path,organization_id) VALUES('Race','local-race','/projects/local-6/p',6)").run()]);
 const state=await get('SELECT (SELECT COUNT(*) FROM organization_deletions WHERE organization_id=6) claims,(SELECT COUNT(*) FROM projects WHERE organization_id=6) projects');
 check(!(state.claims&&state.projects),'parallel requests safety');
 check(racing.some(x=>x.status==='rejected'),'parallel conflict visible');
 const integrity=await run('PRAGMA foreign_key_check').all();check(integrity.results.length===0,'integrity');
 return Response.json({success:true,realD1Batch:true,checks:['cleanup','two-acl-cascades','other-org','global-project-only','archive','detach','atomic-rollback-including-epochs','mixed-preview-claim','parallel-claim-business-insert','foreign-key-check'],parallelOutcome:racing.map(x=>x.status),scope:'synthetic-versioned-subset-not-historical-certification'});
}};
