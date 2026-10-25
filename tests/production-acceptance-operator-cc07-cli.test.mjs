import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

async function cli(t,scenario){
 const dir=await mkdtemp(join(tmpdir(),'cc07-real-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const reportPath=join(dir,'requested report.json'),callsPath=join(dir,'calls.jsonl');await writeFile(callsPath,'');
 // Do not inherit credentials, NODE_OPTIONS, or external preload hooks.
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['systemroot','windir','temp','tmp'].includes(key.toLowerCase())));
 Object.assign(env,{CC07_CLI_SCENARIO:scenario,CC07_CLI_CALLS:callsPath,
  MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'fixture-only-pages-canary',MAONO_ACCEPTANCE_CC07_WORKER_TOKEN:'fixture-only-worker-canary',MAONO_ACCEPTANCE_CC07_D1_READ_TOKEN:'fixture-only-d1-canary',
  MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON:'invalid-on-purpose-must-not-authenticate',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'synthetic-owner',GITHUB_REPOSITORY_OWNER:'synthetic-owner',GITHUB_REF:'refs/heads/main'});
 const args=['--import',new URL('./helpers/cc07-cli-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../scripts/acceptance/operator.mjs',import.meta.url)),
  '--mode','preflight','--suite','cc07-notifications','--organization-id','1','--qa-user-ids','1,2,3','--expected-commit','a'.repeat(40),'--report',reportPath];
 const execution=await new Promise(resolve=>execFile(process.execPath,args,{cwd:dir,env,timeout:20000,maxBuffer:65536},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
 const raw=await readFile(reportPath,'utf8');
 const output=raw+execution.stdout+execution.stderr;
 for(const secret of ['fixture-only-pages-canary','fixture-only-worker-canary','fixture-only-d1-canary','invalid-on-purpose-must-not-authenticate','private-fixture-response'])assert.ok(!output.includes(secret),'Report/output must not expose fixture credentials or provider details');
 assert.ok(!output.includes('REPORT_REQUIRED'),'Report saving must not mask the operation result');
 const calls=(await readFile(callsPath,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 return {...execution,result:JSON.parse(raw),calls};
}

test('CC07 real CLI writes a successful read-only preflight to --report',async t=>{
 const {code,result,calls,stderr}=await cli(t,'success');assert.equal(code,0,stderr);
 assert.equal(result.ok,true);assert.equal(result.complete,true);assert.equal(result.writesPerformed,false);assert.equal(result.acceptanceExecuted,false);
 assert.equal(result.preflight.qa9OutboxCount,13);assert.equal(result.preflight.configuredFlags.MAONO_TICKET_COMMANDS_ENABLED.value,true);
 assert.equal(result.preflight.configuredFlags.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,false);
 assert.equal(calls.length,15);assert.equal(calls.filter(c=>c.method==='GET').length,6);assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/query')).length,9);
});
for(const [scenario,errorCode,callCount]of [['missing-plan','CC07_PLAN_REQUIRED',0],['code-drift','CC07_WORKER_CODE_DRIFT',6],['api-refused','CLOUDFLARE_API_FAILED',2]])test(`CC07 real CLI preserves ${errorCode} in its failure report`,async t=>{
 const {code,result,calls}=await cli(t,scenario);assert.equal(code,1);
 assert.equal(result.ok,false);assert.equal(result.complete,false);assert.equal(result.writesPerformed,false);assert.equal(result.acceptanceExecuted,false);
 assert.equal(result.error.code,errorCode);assert.equal(calls.length,callCount);
 assert.ok(calls.every(c=>c.method==='GET'));
 if(scenario==='api-refused')assert.match(result.error.message,/HTTP 403/);
});
