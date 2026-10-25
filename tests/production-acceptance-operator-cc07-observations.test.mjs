import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCc07Inventory,summarizeCc07Worker} from '../scripts/acceptance/cc07-observations.mjs';

test('CC07 inventory diagnostics retain counters and timestamps without row content or lease material',()=>{
 const audit={startedAt:'2026-01-01T00:00:00Z',completedAt:'2026-01-01T00:00:01Z',scoped:{
  tickets:[{subject:'private-canary'}],outbox:[{status:'pending',notification_attempts:0,notification_error:'private-canary',notification_token:'private-canary'}],
  candidates:[{state:'pending',recipient_id:99}],notices:[]}};
 const result=summarizeCc07Inventory(audit);
 assert.equal(result.evidence,'NO_PERSISTED_PROCESSING_OBSERVED');assert.equal(result.counts.outbox,1);assert.equal(result.candidateStates.pending,1);
 assert.equal(result.oldestQueryAt,audit.startedAt);assert.ok(!JSON.stringify(result).includes('private-canary'));assert.ok(!JSON.stringify(result).includes('recipient_id'));
 audit.scoped.outbox[0].notification_attempts=1;assert.equal(summarizeCc07Inventory(audit).evidence,'PERSISTED_PROCESSING_OBSERVED');
});
test('CC07 worker diagnostics preserve only validated control identity, never bindings or raw metadata',()=>{
 const result=summarizeCc07Worker({deployments:{deployments:[{id:'deployment',author_email:'private-canary',versions:[{version_id:'version',percentage:100}]}]},schedules:{schedules:[{cron:'* * * * *'}]},off:{resources:{bindings:[{text:'private-canary'}]}}},{active:true,observedAt:'2026-01-01T00:00:00Z'});
 assert.deepEqual(result,{observedAt:'2026-01-01T00:00:00Z',active:true,deploymentId:'deployment',versionId:'version',percentage:100,crons:['* * * * *'],configurationReadbackOnly:true});
 assert.ok(!JSON.stringify(result).includes('private-canary'));
});
