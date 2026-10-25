// Subprocess fixture only. Never forwards a request to the network.
import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import {cc07Digest} from '../../scripts/acceptance/cc07-infrastructure.mjs';
import {safeFlags,CF_ACCOUNT_ID,PRODUCTION_D1_ID} from '../../scripts/acceptance/production-acceptance-lib.mjs';
import {manifest} from '../../scripts/acceptance/suites/cc07-notifications.mjs';
import {preservedFixture} from './cc07-preserved-fixture.mjs';

const now=Date.now(),sha='a'.repeat(40),scenario=process.env.CC07_CLI_SCENARIO;
const outbox=Array.from({length:13},(_,i)=>({id:`synthetic-${i+1}`,organization_id:9,ticket_id:100,event_id:i+1,event_type:'created',status:'pending',created_at:new Date(now-60000).toISOString(),notification_attempts:0,notification_next_at:null,notification_lease_until:null,notification_error:null,notification_completed_at:null}));
const p={version:2,preserved:null,readiness:{waitSeconds:60},productSha:sha,organizationId:1,qaIds:{manager:1,allowed:2,restricted:3},
 worker:{offVersion:'11111111-1111-4111-8111-111111111111',onVersion:'22222222-2222-4222-8222-222222222222',codeEtag:'b'.repeat(64),cron:'* * * * *'},
 policy:{runId:'33333333-3333-4333-8333-333333333333',organizationId:1,managerId:1,startAt:new Date(now-1000).toISOString(),endAt:new Date(now+200*60000).toISOString(),maxEvents:3,maxAttempts:6,batchSize:1},
 approval:{actor:'synthetic-owner',confirmedAt:new Date(now-10000).toISOString(),writersPaused:true,syntheticOnly:true,workerVersionsReviewed:true,costAndVolumeApproved:true,humanRecoveryAvailable:true},
 qa9:{outboxCount:13,digest:cc07Digest({outbox,candidates:[],notices:[]})},limits:{deliveryWaitSeconds:60,quiescenceSeconds:125}};
const preserved=scenario.startsWith('preserved-')?preservedFixture(p):null;
process.env.MAONO_ACCEPTANCE_CC07_PLAN_JSON=scenario==='missing-plan'?'':JSON.stringify(p);
const vars=Object.fromEntries(Object.entries({...safeFlags(manifest),MAONO_RUNTIME_ENV:'production',MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt}).map(([k,v])=>[k,{type:'plain_text',value:String(v)}]));
const deployment={id:'synthetic-deployment',environment:'production',url:'https://maono-kepler-v1.pages.dev',deployment_trigger:{metadata:{commit_hash:sha,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},env_vars:vars};
const version=enabled=>({id:enabled?p.worker.onVersion:p.worker.offVersion,resources:{script:{etag:scenario==='code-drift'&&enabled?'c'.repeat(64):p.worker.codeEtag,handlers:['scheduled']},script_runtime:{compatibility_date:'2026-10-01'},bindings:[
 {name:'DB',type:'d1',id:PRODUCTION_D1_ID},{name:'CF_VERSION_METADATA',type:'version_metadata'},...Object.entries({MAONO_RUNTIME_ENV:'production',MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:'true',MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED:String(enabled),MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS:'1',MAONO_TICKET_NOTIFICATION_START_AT:p.policy.startAt,MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON:JSON.stringify(p.policy)}).map(([name,text])=>({name,type:'plain_text',text}))]}});
const root=`/client/v4/accounts/${CF_ACCOUNT_ID}`;
const pages=`${root}/pages/projects/maono-kepler-v1`,worker=`${root}/workers/scripts/maono-ticket-notifications`;
const selects=new Map([
 ["SELECT name FROM pragma_table_info('ticket_notifications') WHERE name IN ('dismissed_at','version','action_token') ORDER BY name",[{name:'action_token'},{name:'dismissed_at'},{name:'version'}]],
 ['SELECT id FROM organizations WHERE active=1 ORDER BY id',[{id:1},{id:9}]],
 ['SELECT id,organization_id,ticket_id,event_id,event_type,status,created_at,notification_attempts,notification_next_at,notification_lease_until,notification_error,notification_completed_at FROM ticket_command_outbox ORDER BY id',outbox],
 ['SELECT c.outbox_id,c.recipient_id,c.state,o.organization_id FROM ticket_notification_candidates c JOIN ticket_command_outbox o ON o.id=c.outbox_id ORDER BY c.outbox_id,c.recipient_id',[]],
 ['SELECT id,outbox_id,organization_id,ticket_id,event_id,recipient_id,channel,audience,created_at,read_at,dismissed_at,version FROM ticket_notifications ORDER BY id',[]],
 ['SELECT id,organization_id,created_by,status,visibility,version,active,created_at FROM organization_tickets WHERE organization_id=? ORDER BY id',[]],
 ['SELECT (SELECT COUNT(*) FROM ticket_command_outbox) AS outbox,(SELECT COUNT(*) FROM ticket_notification_candidates) AS candidates,(SELECT COUNT(*) FROM ticket_notifications) AS notices,(SELECT COUNT(*) FROM organization_tickets WHERE organization_id=?) AS tickets',[{outbox:13,candidates:0,notices:0,tickets:0}]],
 ["SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'",[]],
 ["SELECT organization_id FROM ticket_command_backfills WHERE organization_id=? AND status='ready' AND schema_version=1 AND pending_count=0 AND skipped_count=0",[{organization_id:1}]],
]);
const preservationQueries=new Map(preserved?[
 ['SELECT current_cycle_number,closed_at,closure_json IS NOT NULL AS closure_present,active_wait_json IS NULL AS no_active_wait,subject=? AS matches_origin FROM organization_tickets WHERE organization_id=? AND id=?',preserved.preservedRows.ticket],
 ['SELECT id,organization_id,ticket_id,event_type,actor_user_id,created_at,command_id,entity_version,corrects_event_id,audience FROM ticket_events WHERE organization_id=? AND ticket_id=? ORDER BY id',preserved.preservedRows.events],
 ['SELECT cycle_number,origin,opened_at,opened_by,closed_at,closure_json IS NOT NULL AS closure_present FROM ticket_cycles WHERE organization_id=? AND ticket_id=? ORDER BY cycle_number',preserved.preservedRows.cycles],
 ['SELECT principal_type,principal_id,action,effect,created_by,created_at FROM ticket_acl_entries WHERE organization_id=? AND ticket_id=? ORDER BY id',preserved.preservedRows.acl],
 ['SELECT policy_id FROM ticket_ticket_access_policies WHERE organization_id=? AND ticket_id=? ORDER BY policy_id',preserved.preservedRows.policies],
 ['SELECT (SELECT COUNT(*) FROM ticket_events WHERE organization_id=?1 AND ticket_id=?2) AS events,(SELECT COUNT(*) FROM ticket_cycles WHERE organization_id=?1 AND ticket_id=?2) AS cycles,(SELECT COUNT(*) FROM ticket_acl_entries WHERE organization_id=?1 AND ticket_id=?2) AS acl,(SELECT COUNT(*) FROM ticket_ticket_access_policies WHERE organization_id=?1 AND ticket_id=?2) AS policies',preserved.preservedRows.counts],
]:[]);
if(preserved){
 for(const sql of selects.keys()){
  if(sql.startsWith('SELECT id,organization_id,ticket_id,event_id,event_type'))selects.set(sql,[...outbox,...preserved.scoped.outbox]);
  if(sql.startsWith('SELECT c.outbox_id'))selects.set(sql,preserved.scoped.candidates);
  if(sql.startsWith('SELECT id,organization_id,created_by'))selects.set(sql,preserved.scoped.tickets);
  if(sql.startsWith('SELECT (SELECT COUNT(*) FROM ticket_command_outbox)'))selects.set(sql,[{outbox:15,candidates:2,notices:0,tickets:1}]);
 }
 if(scenario==='preserved-drift')preserved.preservedRows.events[0].actor_user_id=99;
}
globalThis.fetch=async (input,options)=>{
 const url=new URL(input),path=url.pathname,method=options.method;
 // Journal contains no headers, credentials or response bodies.
 appendFileSync(process.env.CC07_CLI_CALLS,JSON.stringify({path,method})+'\n');
 assert.equal(url.origin,'https://api.cloudflare.com');
 assert.equal(options.redirect,'error');
 if(scenario==='api-refused')return Response.json({success:false,errors:[{message:'private-fixture-response'}]},{status:403});
 let result;
 if(path===`${root}/d1/database/${PRODUCTION_D1_ID}/query`){
  assert.equal(method,'POST');const body=JSON.parse(options.body);
  assert.ok(selects.has(body.sql)||preservationQueries.has(body.sql),'Unexpected SQL; no network fallback');
  assert.deepEqual(body.params,preservationQueries.has(body.sql)?(body.sql.includes('subject=?')?[`QA-CC07-${p.preserved.runId}`,'1','70']:['1','70']):body.sql.includes('?')?['1']:[]);
  result=[{success:true,meta:{changed_db:false},results:selects.get(body.sql)||preservationQueries.get(body.sql)}];
 }else{
  assert.equal(method,'GET','Preflight must not mutate resources or authenticate QA');
  const responses=new Map([
   [pages,{name:'maono-kepler-v1',production_branch:'mano_kepler_v1',subdomain:'maono-kepler-v1.pages.dev',deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:vars}},canonical_deployment:deployment}],
   [`${pages}/deployments`,[deployment]],
   [`${worker}/versions/${p.worker.offVersion}`,version(false)],
   [`${worker}/versions/${p.worker.onVersion}`,version(true)],
   [`${worker}/deployments`,{deployments:[{id:'synthetic-worker-deployment',versions:[{version_id:p.worker.offVersion,percentage:100}]}]}],
   [`${worker}/schedules`,{schedules:[]}],
  ]);
  assert.ok(responses.has(path),'Unexpected path; no network fallback');result=responses.get(path);
 }
 return Response.json({success:true,result});
};
