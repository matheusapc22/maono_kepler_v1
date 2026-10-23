import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildProfiles,suiteContext,validateManifest,transitionFlags,PRODUCTION_D1_ID,parseArgs} from '../scripts/acceptance/production-acceptance-lib.mjs';
import {manifest} from '../scripts/acceptance/suites/cc04-selective-access.mjs';
import {main} from '../scripts/acceptance/operator.mjs';
const sha='a'.repeat(40);
const deployment=(commit=sha,selective=true)=>({id:'deployment-test',environment:'production',url:'https://maono-kepler-v1.pages.dev',deployment_trigger:{metadata:{commit_hash:commit,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},env_vars:{MAONO_TICKET_COMMANDS_ENABLED:{type:'plain_text',value:'false'},MAONO_TICKET_SELECTIVE_ACCESS_ENABLED:{type:'plain_text',value:String(selective)}}});
const cfFetch=(commit=sha,calls=[],selective=true)=>async(url,options={})=>{
  calls.push(options.method||'GET');
  assert.equal(options.method||'GET','GET','fixture permits no Cloudflare writes');
  const result=String(url).includes('/deployments?')?[deployment(commit,selective)]:{name:'maono-kepler-v1',production_branch:'mano_kepler_v1',subdomain:'maono-kepler-v1.pages.dev',deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:deployment(commit,selective).env_vars}},canonical_deployment:deployment(commit,selective)};
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

test('CC04 preflight accepts enabled selective access and rejects a disabled baseline without writes',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cc04-baseline-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  t.mock.method(process.stdout,'write',()=>true);
  for(const selective of [true,false]) {
    const calls=[];const path=join(dir,`preflight-${selective}.json`);
    const code=await main(['--mode','preflight','--suite',manifest.id,'--organization-id','1','--expected-commit',sha,'--report',path],
      {MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'synthetic'}, {fetchImpl:cfFetch(sha,calls,selective)});
    const report=JSON.parse(await readFile(path,'utf8'));
    assert.equal(code,selective?0:1);
    assert.equal(report.acceptanceExecuted,false);
    assert.equal(report.writesPerformed,false);
    assert.ok(calls.length>0);
    assert.ok(calls.every(method=>method==='GET'));
    if(!selective) assert.equal(report.error.code,'PRODUCTION_FLAG_BASELINE_MISMATCH');
  }
});

test('CC04 approved identity input accepts only three distinct positive numeric IDs',()=>{
  const args=['--mode','run','--suite',manifest.id,'--organization-id','1','--expected-commit',sha,'--report','synthetic.json'];
  assert.deepEqual(parseArgs([...args,'--qa-user-ids','10,11,12']).qaUserIds,{manager:10,allowed:11,restricted:12});
  for(const value of ['1,1,2','0,2,3','1,2','1,2,3;echo secret','a,2,3','1,2,9007199254740992']) assert.throws(()=>parseArgs([...args,'--qa-user-ids',value]));
});

test('CC04 missing approved IDs blocks all remote requests; mismatched sessions block fixture and flag mutations',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cc04-approved-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  t.mock.method(process.stdout,'write',()=>true);
  for(const supplied of [false,true]) {
    const path=join(dir,`report-${supplied}.json`),calls=[];let profile=0;
    const fetchImpl=async(url,options)=>{
      assert.equal(supplied,true,'no requests before approved IDs');
      if(new URL(url).hostname==='api.cloudflare.com') return cfFetch(sha,calls)(url,options);
      const pathname=new URL(url).pathname;
      calls.push(`${options.method} ${pathname}`);
      if(pathname==='/api/auth/login') { profile++;return Response.json({ok:true},{headers:{'set-cookie':'maono_session=synthetic; HttpOnly; Secure'}}); }
      assert.equal(pathname,'/api/session');
      return Response.json({authenticated:true,activeOrganization:{id:1},user:{id:profile,role:'editor'},
        permissions:profile===1?['ticket.view','ticket.create','ticket.manage','ticket.access.manage']:['ticket.view']});
    };
    const args=['--mode','run','--suite',manifest.id,'--organization-id','1','--expected-commit',sha,'--report',path,
      ...(supplied?['--qa-user-ids','11,12,13']:[])];
    const credentials=Object.fromEntries(['manager','allowed','restricted'].map(name=>[name,{email:`${name}@example.test`,password:'synthetic'}]));
    assert.equal(await main(args,{MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'synthetic',MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON:JSON.stringify(credentials)},{fetchImpl}),1);
    const report=JSON.parse(await readFile(path,'utf8'));
    assert.equal(report.error.code,supplied?'QA_IDENTITY_MISMATCH':'QA_IDENTITIES_REQUIRED');
    assert.equal(report.acceptanceExecuted,false);
    assert.ok(calls.every(call=>call==='GET'||call==='POST /api/auth/login'||call==='GET /api/session'));
  }
});
