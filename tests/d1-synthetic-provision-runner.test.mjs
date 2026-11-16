import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {validateProvisionPlan} from '../scripts/d1-synthetic-provision/plan.mjs';
import {createRunJournal} from '../scripts/d1-synthetic-provision/journal.mjs';
import {assertProvisionGate} from '../scripts/d1-synthetic-provision/github-gate.mjs';
const bytes=readFileSync(new URL('../ops/d1-synthetic-provision/plan.json',import.meta.url));
const fixture=()=>({environment:{name:'synthetic-d1-provision',can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:172453089,login:'matheusapc22'}}]}]},runs:{total_count:1,workflow_runs:[{id:123,event:'workflow_dispatch',run_attempt:1,head_branch:'main',actor:{id:172453089},path:'.github/workflows/d1-synthetic-provision.yml'}]},options:{actorId:'172453089',repository:'matheusapc22/maono_kepler_v1',runId:'123',runAttempt:'1'}});
test('fixed provision plan enforces Free/$0 and isolation in either reviewed boolean state',()=>{
 const r=validateProvisionPlan(bytes);assert.equal(r.executionEnabled,r.plan.enabled);assert.equal(r.plan.accountId,'1988481e4c75c760516161104b7e1e50');
 for(const change of [{accountId:'09d455fa1cf988b0d9db89987b73eaff'},{spendingLimitUSD:1},{maxDatabases:2},{allowSql:true},{enabled:'true'},{extra:true}])assert.throws(()=>validateProvisionPlan(Buffer.from(JSON.stringify({...r.plan,...change}))));
 assert.equal(validateProvisionPlan(Buffer.from(bytes.toString().replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'))).sha256,r.sha256);
 for(const invalid of [Buffer.from('\uFEFF'+bytes),Buffer.from('{}'),Buffer.from('{bad')])assert.throws(()=>validateProvisionPlan(invalid));
});
test('journal atomically reserves local run and persists before return; reopen forbidden',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'maono-provision-journal-')),'journal.jsonl');const a=createRunJournal(path);
 assert.equal(a.begin({event:'begin',planId:'fixed'}),true);assert.equal(a.record({event:'intent',step:'d1-create'}),true);a.close();
 assert.deepEqual(readFileSync(path,'utf8').trim().split('\n').map(JSON.parse),[{event:'begin',planId:'fixed'},{event:'intent',step:'d1-create'}]);
 const b=createRunJournal(path);assert.throws(()=>b.begin({}));b.close();assert.throws(()=>a.record({}));
});
test('gate requires exact owner protected environment and first-ever dispatch attempt',()=>{
 const f=fixture();assert.equal(assertProvisionGate(f.environment,f.runs,f.options).independentReview,false);
 for(const mutate of [x=>x.environment.name='production-d1-migrations',x=>x.environment.can_admins_bypass=true,x=>x.environment.protection_rules=[],x=>x.runs.total_count=2,x=>x.runs.workflow_runs.push({...x.runs.workflow_runs[0]}),x=>x.runs.workflow_runs[0].head_branch='other',x=>x.runs.workflow_runs[0].actor.id=1,x=>x.runs.workflow_runs[0].run_attempt=2,x=>x.options.runAttempt='2',x=>x.options.runId='124',x=>x.runs.workflow_runs[0].path='other.yml',x=>x.options.actorId='1']){const a=fixture();mutate(a);assert.throws(()=>assertProvisionGate(a.environment,a.runs,a.options));}
});
test('runner validates without credentials; untrusted invocation fails before journal or I/O',()=>{
 const a=spawnSync(process.execPath,['scripts/d1-synthetic-provision/runner.mjs','--validate'],{encoding:'utf8'});assert.equal(a.status,0,a.stderr);assert.equal(JSON.parse(a.stdout).executionEnabled,validateProvisionPlan(bytes).executionEnabled);
 const b=spawnSync(process.execPath,['scripts/d1-synthetic-provision/runner.mjs','--provision'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_EVENT_NAME:'local-test',MAONO_SYNTHETIC_PROVISION_TOKEN:'FAKE-NOT-REAL'}});assert.equal(b.status,1);assert.equal(b.stdout,'');assert.equal(b.stderr.trim(),'SYNTHETIC_PROVISION_RUNNER_FAILED_CLOSED');
});
test('workflow default disabled, secret only protected job, fixed main and exact plan input, no autoapproval',()=>{
 const w=readFileSync(new URL('../.github/workflows/d1-synthetic-provision.yml',import.meta.url),'utf8');
 assert.match(w,/environment: synthetic-d1-provision/);assert.match(w,/cancel-in-progress: false/);assert.match(w,/needs\.validate\.outputs\.enabled == 'true'/);assert.match(w,/refs\/heads\/main/);assert.match(w,/assertProvisionGate/);assert.match(w,/event=workflow_dispatch&per_page=100/);assert.match(w,/needs: \[validate, protection\]/);assert.ok(!/pull_request_target|MAONO_D1_MIGRATION_API_TOKEN|pending_deployments|approve|DELETE/.test(w));
 const protection=w.slice(w.indexOf('  protection:'),w.indexOf('  provision:'));assert.ok(!protection.includes('secrets.'));assert.match(protection,/actions: read/);
});

test('workflow emits exact GitHub enabled output for disabled and enabled fixtures without remote I/O',()=>{
 const w=readFileSync(new URL('../.github/workflows/d1-synthetic-provision.yml',import.meta.url),'utf8');
 const line=w.split(/\r?\n/).find(l=>l.includes("appendFileSync(process.env.GITHUB_OUTPUT"));
 const script=line.match(/node --input-type=module -e "(.*)"/)?.[1];assert.ok(script);
 for(const enabled of [false,true]){
  const fixture={...validateProvisionPlan(bytes).plan,enabled};
  const result=validateProvisionPlan(Buffer.from(JSON.stringify(fixture)));assert.equal(result.executionEnabled,enabled);
  const output=join(mkdtempSync(join(tmpdir(),'maono-github-output-')),'output');
  const injected=script.replace("readFileSync('ops/d1-synthetic-provision/plan.json')",'Buffer.from('+JSON.stringify(JSON.stringify(fixture))+')');
  const child=spawnSync(process.execPath,['--input-type=module','-e',injected],{encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output}});
  assert.equal(child.status,0,child.stderr);assert.equal(readFileSync(output,'utf8'),'enabled='+enabled+'\n');
 }
});
