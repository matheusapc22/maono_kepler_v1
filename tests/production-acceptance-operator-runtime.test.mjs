import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildProfiles,suiteContext,validateManifest,transitionFlags,PRODUCTION_D1_ID} from '../scripts/acceptance/production-acceptance-lib.mjs';
import {manifest} from '../scripts/acceptance/suites/cc04-selective-access.mjs';
import {main} from '../scripts/acceptance/operator.mjs';
const sha='a'.repeat(40);
const deployment=(commit=sha)=>({id:'deployment-test',environment:'production',url:'https://maono-kepler-v1.pages.dev',deployment_trigger:{metadata:{commit_hash:commit,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},env_vars:{MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:{type:'plain_text',value:'false'}}});
const cfFetch=(commit=sha,calls=[])=>async(url,options={})=>{
  calls.push(options.method||'GET');
  assert.equal(options.method||'GET','GET','fixture permits no Cloudflare writes');
  const result=String(url).includes('/deployments?')?[deployment(commit)]:{name:'maono-kepler-v1',production_branch:'mano_kepler_v1',subdomain:'maono-kepler-v1.pages.dev',deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:deployment(commit).env_vars}},canonical_deployment:deployment(commit)};
  return Response.json({success:true,result});
};
test('CC17 cleanup HTTP failure is retained and remaining cleanup actions still run',async()=>{
  const events=[];const ctx=suiteContext({baseUrl:'https://maono.test',organizationId:1,profiles:{manager:{cookie:'maono_session=synthetic'}},deps:{fetchImpl:async()=>Response.json({ok:false},{status:403})}});
  ctx.registerCleanup(async()=>events.push('continued'));
  ctx.registerCleanup(()=>ctx.cleanupApi('manager','/api/organizations/1/tickets/1/access',{method:'PUT',json:{}}));
  const errors=await ctx.cleanup();assert.equal(errors.length,1);assert.equal(errors[0].code,'CLEANUP_HTTP_FAILED');assert.deepEqual(events,['continued']);
});
test('CC17 case detail cannot overwrite declared case identity or outcome',()=>{
  const ctx=suiteContext({baseUrl:'https://maono.test',organizationId:1,profiles:{}});
  ctx.record('CT55','FAIL',{id:'CT56',status:'PASS'});assert.deepEqual(ctx.cases,[{id:'CT55',status:'FAIL'}]);
});
test('CC17 read-only suite rejects managed flags before any execution',()=>{
  assert.throws(()=>validateManifest({...manifest,mutationMode:'read_only'}),{code:'MANIFEST_INVALID'});
});
test('CC17 product drift during quiescence blocks flag PATCH before fail-safe is armed',async()=>{
  let armed=false;const calls=[];
  await assert.rejects(()=>transitionFlags({token:'synthetic',sourceDeploymentId:'deployment-test',commit:sha,manifest,values:{MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:true},deps:{fetchImpl:cfFetch('b'.repeat(40),calls)},onMutationStart(){armed=true;}}),{code:'PRODUCTION_DEPLOYMENT_MISMATCH'});
  assert.equal(armed,false);assert.ok(calls.every(v=>v==='GET'));
});
test('CC17 denied QA capability blocks run even if permissions array also contains it',async()=>{
  const fetchImpl=async(url)=>String(url).endsWith('/api/auth/login')?Response.json({ok:true},{headers:{'set-cookie':'maono_session=synthetic; Secure; HttpOnly'}}):Response.json({authenticated:true,activeOrganization:{id:1},user:{id:1,role:'editor'},permissions:['ticket.view'],deniedPermissions:['ticket.view']});
  await assert.rejects(()=>buildProfiles('https://maono.test',{reader:{email:'synthetic@cc17.test',password:'synthetic'}},{requiredProfiles:['reader'],requiredPermissions:{reader:['ticket.view']}},1,{fetchImpl}),{code:'QA_PERMISSION_MISSING'});
});
test('CC17 closure restores configuration without claiming resource cleanup or acceptance',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cc17-closure-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',cfFetch());t.mock.method(process.stdout,'write',()=>true);
  const path=join(dir,'report.json');const code=await main(['--mode','closure','--suite',manifest.id,'--organization-id','1','--expected-commit',sha,'--report',path],{MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'synthetic'});
  const report=JSON.parse(await readFile(path,'utf8'));assert.equal(code,1);assert.equal(report.configurationRestored,true);assert.equal(report.cleanupComplete,false);assert.equal(report.complete,false);assert.equal(report.acceptanceExecuted,false);assert.equal(report.error.code,'RESOURCE_CLEANUP_UNVERIFIED');
});
test('CC17 report persistence failure returns nonzero even after successful read-only preflight',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cc17-report-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',cfFetch());t.mock.method(process.stdout,'write',()=>true);t.mock.method(process.stderr,'write',()=>true);
  assert.equal(await main(['--mode','preflight','--suite',manifest.id,'--organization-id','1','--expected-commit',sha,'--report',dir],{MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'synthetic'}),1);
});
