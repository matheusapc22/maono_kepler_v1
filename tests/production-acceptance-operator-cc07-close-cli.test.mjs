import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

for(const [scenario,expected]of [['normal',0],['no-close-response',0],['delete-failure',1],['delete-timeout',1],['original-and-delete',1],['connect-timeout',1],['readiness-timeout',1],['disconnect',1]])test(`CC07 real CLI exits naturally after ${scenario}, preserving reports and cleanup`,async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cc07-close-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const reportPath=join(dir,'report.json'),observationPath=join(dir,'transport.json');
 // A child cannot inherit real credentials, proxy settings or NODE_OPTIONS.
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['systemroot','windir','temp','tmp'].includes(k.toLowerCase())));
 Object.assign(env,{CC07_CLOSE_SCENARIO:scenario,CC07_CLOSE_OBSERVATION:observationPath});
 const args=['--import',new URL('./helpers/cc07-close-cli-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../scripts/acceptance/operator.mjs',import.meta.url)),
  '--mode','run','--suite','cc07-notifications','--organization-id','1','--qa-user-ids','1,2,3','--expected-commit','a'.repeat(40),'--report',reportPath];
 const result=await new Promise(resolve=>execFile(process.execPath,args,{cwd:dir,env,timeout:15000,maxBuffer:65536,windowsHide:true},(error,stdout,stderr)=>resolve({code:error?.code??0,killed:error?.killed===true,stdout,stderr})));
 const raw=await readFile(reportPath,'utf8'),report=JSON.parse(raw),observation=JSON.parse(await readFile(observationPath,'utf8'));
 assert.equal(result.killed,false,'CLI must exit without the test watchdog killing it');assert.equal(result.code,expected,JSON.stringify({error:report.error,telemetryError:report.telemetryError,cleanupError:report.cleanupError,stderr:result.stderr}));
 for(const secret of ['local-tail-canary','local-fixture-only','private-provider-canary','wss://tail.developers'])assert.ok(!(raw+result.stdout+result.stderr).includes(secret),'No credential or raw transport detail in evidence');
 assert.equal(report.configurationRestored,true);assert.equal(report.cleanupComplete,true);assert.equal(report.final.workerStopped,true);
 assert.equal(report.final.flags.MAONO_TICKET_COMMANDS_ENABLED.value,true);assert.equal(report.final.flags.MAONO_TICKET_NOTIFICATIONS_ENABLED.value,false);
 assert.deepEqual(observation.calls,['POST','DELETE'],'Repeated cleanup must not issue a second remote deletion');
 assert.equal(observation.telemetry.transportClosed,true);assert.equal(observation.readyState,3);
 assert.equal(report.budget.closureReserveMinutes,75);
 if(expected===0){assert.equal(report.operationalTestsPassed,true);assert.equal(report.complete,true);assert.equal(report.telemetryClosed,true);assert.equal(report.cases.length,5);}
 else{assert.equal(report.complete,false);assert.equal(report.ok,false);}
 if(scenario==='no-close-response')assert.equal(report.telemetry.transportTerminated,true);
 if(scenario==='normal')assert.equal(report.telemetry.transportTerminated,false);
 if(scenario==='delete-timeout')assert.equal(observation.deleteAborted,true,'Pending DELETE must observe its actual abort signal');
 if(scenario.startsWith('delete-')||scenario==='original-and-delete'){
  assert.equal(report.telemetryClosed,false);assert.equal(report.telemetry.deleted,false);assert.equal(report.telemetry.transportClosed,true);
  assert.equal(report.telemetryError.code,'CC07_TAIL_CLEANUP_UNCONFIRMED');assert.equal(observation.repeatedError,'CC07_TAIL_CLEANUP_UNCONFIRMED');
 }
 if(scenario==='original-and-delete')assert.equal(report.error.code,'CC07_CRON_HANDLER_FAILED');
 if(scenario==='connect-timeout')assert.equal(report.error.code,'CC07_TAIL_CONNECT_FAILED');
 if(scenario==='readiness-timeout')assert.equal(report.error.code,'CC07_CRON_READINESS_TIMEOUT');
});
