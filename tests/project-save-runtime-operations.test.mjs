import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {persistenceFixture} from './helpers/project-persistence-fixture.mjs';
import {create,config,status} from './helpers/durable-project-http.mjs';
import {runProjectSaveRecovery} from '../workers/project-save-operations.js';

test('HTTP fast path disabled returns only durable acceptance; independent worker publishes with no browser',async t=>{
 const f=persistenceFixture(t);f.env.PROJECT_DURABLE_SAVE_INLINE_ENABLED='false';f.env.PROJECT_DURABLE_SAVE_WORKER_ENABLED='true';
 const accepted=await create(f,config('scheduled'));
 assert.equal(accepted.status,202);assert.equal(accepted.data.operation.state,'PAYLOAD_STORED');
 assert.equal(accepted.data.operation.payloadStored,true);assert.equal(accepted.data.operation.receipt,null);
 assert.equal(f.project().active,0);
 const result=await runProjectSaveRecovery(f.env);assert.equal(result.published,1);
 const recovered=await status(f,accepted.registered.input.operationId,{key:accepted.key});
 assert.equal(recovered.data.operation.state,'PUBLISHED');assert.equal(f.project().active,1);
});
test('disabled independent worker is inert, without touching DB or provider',async()=>{
 const result=await runProjectSaveRecovery({DB:{get prepare(){throw Error('must not read');}}});
 assert.deepEqual(result,{disabled:true});
});
test('cutover and health audit SQL are read-only and executable against real schema',t=>{
 const f=persistenceFixture(t);const before=f.db.prepare('SELECT total_changes() AS n').get().n;
 for(const path of ['project-save-cutover-readonly.sql','project-save-health-readonly.sql']) {
  const sql=readFileSync(new URL('../scripts/audits/'+path,import.meta.url),'utf8');
  assert.doesNotMatch(sql.replace(/--[^\n]*/g,''),/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE)\b/i);
  f.db.exec(sql);
 }
 assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before);
});
