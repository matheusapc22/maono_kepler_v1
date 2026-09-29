import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {evaluateDelivery,DATABASE_ID} from '../scripts/central-chamados/cc18/delivery-gate.mjs';
const template=JSON.parse(await readFile(new URL('../docs/central-chamados/cc-18/delivery-template.json',import.meta.url)));
const sha='a'.repeat(40),url='https://evidence.example.test/synthetic-only',at='2026-09-29T23:00:00Z';
// Synthetic unit-test fixture. Never exported as an operational acceptance artifact.
function recorded(){
 const x=structuredClone(template),p={status:'PASS',productSha:sha,executor:'operator',executedAt:at,evidence:url};
 x.productSha=sha;
 for(const key of ['code','deployment','schema','qa','review','documentation','operations','handoff'])Object.assign(x[key],p);
 Object.assign(x.code,{merged:true,pullRequest:url,author:'author'});Object.assign(x.deployment,{servedSha:sha,canonicalUrl:url});
 Object.assign(x.schema,{quickCheck:'ok',foreignKeyViolations:0,ledgerEvidence:url,migrationDisposition:'none',diffEvidence:url});
 Object.assign(x.operations,{rolloutApproved:true,rolloutEvidence:url,cohortEvidence:url,newOrganizationChecklist:url});
 for(const r of x.requirements)Object.assign(r,p,{pullRequest:url});
 for(const t of x.tests)Object.assign(t,p,{environment:'production',observed:'Synthetic fixture only: expected result observed.'});
 Object.assign(x.tests.find(t=>t.id==='CT-59'),{diagnosis:url,reprocess:url,restore:url,cleanup:url});
 for(const pending of x.pendingItems)Object.assign(pending,p,{status:'RESOLVED',owner:'ops'});x.blockers=[];
 const y=x.cc17;Object.assign(y,{productSha:sha,servedSha:sha});Object.assign(y.window,{approved:true,approvedBy:'operator',approvedAt:at,evidence:url});
 y.schema={verified:true,evidence:url};y.review={approved:true,reviewer:'reviewer',evidence:url};y.cleanup={complete:true,evidence:url};y.configuration={restored:true,evidence:url};y.blockers=[];
 for(const t of y.cases)Object.assign(t,p);
 y.performance={budget:{approved:true,approvedBy:'operator',approvedAt:at,evidence:url,records:100,concurrency:2,durationSeconds:60,samples:20,maxErrorRate:0,p95Ms:{metrics:100,exports:200,uploads:300}},observed:{records:100,concurrency:2,durationSeconds:60},results:Object.fromEntries(['metrics','exports','uploads'].map(f=>[f,{p95Ms:10,errorRate:0,samples:20}])),invariantsPreserved:true,evidence:url};
 return x;
}
test('CT60 template, empty and merge-only evidence remain pending',()=>{for(const x of [null,[],{},template,{productSha:sha,code:{merged:true}}])assert.equal(evaluateDelivery(x,sha).status,'PENDING');});
test('complete synthetic record only requests final review; never authorizes release',()=>{const r=evaluateDelivery(recorded(),sha);assert.deepEqual(r.issues,[]);assert.equal(r.status,'READY_FOR_FINAL_REVIEW');assert.equal(r.releaseAuthorized,false);});
const negative={
 'green merge without schema':x=>delete x.schema,
 'CI does not substitute QA':x=>delete x.qa,
 'wrong served SHA':x=>x.deployment.servedSha='b'.repeat(40),
 'wrong DB':x=>x.schema.databaseId='other',
 'ledger missing despite no new SQL':x=>delete x.schema.ledgerEvidence,
 'integrity not numeric zero':x=>x.schema.foreignKeyViolations='0',
 'migration unconfirmed':x=>{x.schema.migrationDisposition='applied';x.schema.migrations=[];},
 'none cannot hide new SQL':x=>x.schema.migrations=[{filename:'example.sql'}],
 'migration postvalidation absent':x=>{x.schema.migrationDisposition='applied';x.schema.migrations=[{filename:'example.sql',sha256:'a'.repeat(64),approvalHash:'approval',appliedAt:at}];},
 'self review':x=>x.review.executor=' AUTHOR ',
 'CT59 by author':x=>x.tests.find(t=>t.id==='CT-59').executor='author',
 'CT59 without cleanup':x=>delete x.tests.find(t=>t.id==='CT-59').cleanup,
 'CT59 only local':x=>x.tests.find(t=>t.id==='CT-59').environment='local',
 'missing test':x=>x.tests.pop(),
 'duplicate test':x=>x.tests[59]=structuredClone(x.tests[0]),
 'unknown test':x=>x.tests[59].id='CT-99',
 'failed test':x=>x.tests[0].status='FAIL',
 'wrong test SHA':x=>x.tests[0].productSha='b'.repeat(40),
 'missing observed proof':x=>x.tests[0].evidence=null,
 'missing requirement':x=>x.requirements.pop(),
 'wrong requirement links':x=>x.requirements[0].tests=['CT-60'],
 'requirement without PR':x=>x.requirements[0].pullRequest=null,
 'CC17 unresolved':x=>x.cc17.cleanup.complete=false,
 'malformed CC17':x=>x.cc17.cases=[null],
 'missing observed result':x=>delete x.tests[0].observed,
 'wrong expected result':x=>x.tests[0].expected='different criterion',
 'removed inherited register':x=>x.pendingItems=[],
 'open human pending':x=>x.pendingItems=[{id:'human',reason:'budget',owner:'ops',blocking:false,status:'PENDING'}],
 'undeclared pending register':x=>delete x.pendingItems,
 'blocker present':x=>x.blockers=['unresolved'],
 'no cohort decision':x=>x.operations.rolloutApproved=false,
 'unsafe evidence URL':x=>x.qa.evidence='https://user:password@example.test/',
 'invalid timestamp':x=>x.qa.executedAt='yesterday',
 'missing handoff':x=>delete x.handoff
};
for(const[name,mutate]of Object.entries(negative))test('CT60 rejects '+name,()=>{const x=recorded();mutate(x);const r=evaluateDelivery(x,sha);assert.equal(r.status,'PENDING');assert.equal(r.releaseAuthorized,false);assert.ok(r.issues.length);});
test('explicitly resolved pending requires independent evidence fields',()=>{const x=recorded();x.pendingItems.push({...x.qa,id:'P1',reason:'corrected',owner:'ops',blocking:true,status:'RESOLVED'});assert.equal(evaluateDelivery(x,sha).status,'READY_FOR_FINAL_REVIEW');delete x.pendingItems[0].evidence;assert.equal(evaluateDelivery(x,sha).status,'PENDING');});
test('CLI preserves existing output and distinguishes pending from input error',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cc18-gate-'));try{
 const input=join(dir,'input.json'),out=join(dir,'output.json');await writeFile(input,JSON.stringify(template));
 const run=()=>spawnSync(process.execPath,['scripts/central-chamados/cc18/delivery-gate.mjs',input,sha,out],{encoding:'utf8'});
 assert.equal(run().status,1);const bytes=await readFile(out,'utf8');assert.equal(JSON.parse(bytes).releaseAuthorized,false);
 assert.equal(run().status,2);assert.equal(await readFile(out,'utf8'),bytes);
 await writeFile(input,'invalid sensitive fixture');assert.equal(run().stderr.includes('sensitive'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
