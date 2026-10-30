import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { main } from '../scripts/acceptance/operator.mjs';
import { getSuite, publicManifest } from '../scripts/acceptance/registry.mjs';
import { manifest, verifyPreflight, run } from '../scripts/acceptance/suites/organization-management-readiness.mjs';
import {
  validateManifest, activeFlags, safeFlags, readProduction, assertProduction,
  ORGANIZATION_OBSERVED_FLAGS, CF_PROJECT_NAME, CF_API_ORIGIN, CF_ACCOUNT_ID,
  PRODUCTION_D1_ID, PRODUCTION_APP_ORIGIN,
} from '../scripts/acceptance/production-acceptance-lib.mjs';

const sha='b'.repeat(40);
function fixture(values=[false,false,false]) {
  const flags=Object.fromEntries(ORGANIZATION_OBSERVED_FLAGS.map((n,i)=>[n,{type:'plain_text',value:String(values[i])}]));
  flags.UNRELATED_SECRET={type:'secret_text',value:'NEVER_EXPORT'};
  const deployment={id:'synthetic-deployment',environment:'production',url:'https://synthetic.pages.dev',
    deployment_trigger:{metadata:{commit_hash:sha,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},
    env_vars:structuredClone(flags)};
  const project={name:CF_PROJECT_NAME,subdomain:'maono-kepler-v1.pages.dev',production_branch:'mano_kepler_v1',
    deployment_configs:{production:{d1_databases:{DB:{id:PRODUCTION_D1_ID}},env_vars:flags}},
    canonical_deployment:deployment};
  const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(url.origin,CF_API_ORIGIN);
    assert.equal(options.method,'GET');
    assert.equal(options.body,undefined);
    const base='/client/v4/accounts/'+CF_ACCOUNT_ID+'/pages/projects/'+CF_PROJECT_NAME;
    assert.ok(url.pathname===base || url.pathname===base+'/deployments');
    calls.push({url:String(url),method:options.method});
    return new Response(JSON.stringify({success:true,result:url.pathname.endsWith('/deployments')?[deployment]:project}),
      {headers:{'Content-Type':'application/json'}});
  };
  return {project,deployment,calls,fetchImpl};
}

test('organization readiness is registered, observable only and cannot transition flags', () => {
  assert.equal(getSuite(manifest.id).manifest,manifest);
  assert.equal(publicManifest(manifest.id).preflightOnly,true);
  assert.deepEqual(publicManifest(manifest.id).observedFlags,[...ORGANIZATION_OBSERVED_FLAGS]);
  assert.deepEqual(activeFlags(manifest),{});
  assert.deepEqual(safeFlags(manifest),{});
  assert.equal(manifest.requiredProfiles.length,0);
  assert.doesNotThrow(()=>validateManifest(manifest));
});

for (const [label, changes] of [
  ['foreign suite',{id:'other'}],
  ['run capability',{preflightOnly:false}],
  ['mutation capability',{mutationMode:'controlled_mutation'}],
  ['arbitrary flag',{observedFlags:[...ORGANIZATION_OBSERVED_FLAGS,'UNRELATED_SECRET']}],
  ['missing flag',{observedFlags:ORGANIZATION_OBSERVED_FLAGS.slice(1)}],
  ['profile credentials',{requiredProfiles:['admin']}],
  ['browser execution',{requiresBrowser:true}],
  ['flag transition',{managedFlags:{ORGANIZATION_MANAGEMENT_V1:{requiredBefore:false,activeValue:true,safeValue:false}}}],
]) test('organization observation allowlist rejects '+label,()=>{
  assert.throws(()=>validateManifest({...manifest,...changes}),{code:'MANIFEST_INVALID'});
});

test('organization names remain forbidden as managed flags in functional suites',()=>{
  assert.throws(()=>validateManifest({id:'organization-functional',mutationMode:'controlled_mutation',
    requiredProfiles:[],cases:['future'],managedFlags:{ORGANIZATION_MANAGEMENT_V1:{requiredBefore:false,activeValue:true,safeValue:false}}}),
    {code:'MANIFEST_INVALID'});
});

for (const values of [[false,false,false],[true,true,true],[false,true,true]]) {
  test('readiness reports actual matching booleans without assuming OFF: '+values.join(','),async()=>{
    const f=fixture(values);
    const p=await readProduction('SYNTHETIC_TOKEN',manifest,{fetchImpl:f.fetchImpl});
    assertProduction(p,sha,manifest);
    const evidence=verifyPreflight(p);
    assert.deepEqual(Object.keys(p.configuredFlags),[...ORGANIZATION_OBSERVED_FLAGS]);
    assert.deepEqual(Object.values(p.configuredFlags).map(v=>v.value),values);
    assert.equal(evidence.applicationRuntimeVerified,false);
    assert.equal(evidence.databaseSchemaVerified,false);
    assert.equal(evidence.rolloutAuthorized,false);
    assert.equal(evidence.functionalAcceptanceExecuted,false);
    assert.equal(JSON.stringify(evidence).includes('NEVER_EXPORT'),false);
    assert.equal(f.calls.length,2);
  });
}

for (const [label,entry,state] of [
  ['absent',undefined,'absent'],
  ['secret',{type:'secret_text',value:'NEVER_EXPORT'},'not_plain_text'],
  ['invalid',{type:'plain_text',value:'not-a-boolean'},'invalid'],
]) test('readiness preserves '+label+' state and refuses success',async()=>{
  const f=fixture();
  const flags=f.project.deployment_configs.production.env_vars;
  if(entry===undefined) delete flags.ORGANIZATION_MANAGEMENT_V1;
  else flags.ORGANIZATION_MANAGEMENT_V1=entry;
  const p=await readProduction('SYNTHETIC_TOKEN',manifest,{fetchImpl:f.fetchImpl});
  assert.equal(p.configuredFlags.ORGANIZATION_MANAGEMENT_V1.state,state);
  assert.throws(()=>verifyPreflight(p),{code:'ORGANIZATION_READINESS_FLAG_UNOBSERVED'});
  assert.equal(JSON.stringify(p.configuredFlags).includes('NEVER_EXPORT'),false);
});

test('readiness refuses configured/canonical drift and wrong origin',async()=>{
  const f=fixture();
  f.deployment.env_vars.ORGANIZATION_MANAGEMENT_V1.value='true';
  const p=await readProduction('SYNTHETIC_TOKEN',manifest,{fetchImpl:f.fetchImpl});
  assert.throws(()=>verifyPreflight(p),{code:'ORGANIZATION_READINESS_FLAG_DRIFT'});
  assert.throws(()=>verifyPreflight({...p,baseUrl:'https://different.test'}),{code:'ORGANIZATION_READINESS_ORIGIN_MISMATCH'});
});

test('existing canonical commit, binding and pending-deploy gates still apply',async()=>{
  const f=fixture();
  const p=await readProduction('SYNTHETIC_TOKEN',manifest,{fetchImpl:f.fetchImpl});
  for (const [changes,code] of [
    [{databaseId:'wrong'},'PRODUCTION_D1_MISMATCH'],
    [{canonical:{...p.canonical,commit:'a'.repeat(40)}},'PRODUCTION_DEPLOYMENT_MISMATCH'],
    [{pendingProductionDeployments:[{id:'pending'}]},'PRODUCTION_DEPLOYMENT_IN_PROGRESS'],
  ]) assert.throws(()=>assertProduction({...p,...changes},sha,manifest),{code});
  assert.equal(p.baseUrl,PRODUCTION_APP_ORIGIN);
});

async function invoke(t,mode,f) {
  const root=resolve(tmpdir()),dir=await mkdtemp(join(root,'maono-org-readiness-test-'));
  t.after(async()=>{
    assert.equal(dirname(dir),root);assert.ok(basename(dir).startsWith('maono-org-readiness-test-'));
    await rm(dir,{recursive:true});
  });
  const path=join(dir,'report.json');
  const code=await main(['--mode',mode,'--suite',manifest.id,'--organization-id','9','--expected-commit',sha,'--report',path],
    {MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:'SYNTHETIC_TOKEN'},{fetchImpl:f.fetchImpl});
  return {code,report:JSON.parse(await readFile(path,'utf8'))};
}

test('operator preflight performs only two control-plane GETs and exports explicit limitations',async t=>{
  const f=fixture();
  const {code,report}=await invoke(t,'preflight',f);
  assert.equal(code,0);assert.equal(report.complete,true);
  assert.equal(report.acceptanceExecuted,false);assert.equal(report.writesPerformed,false);
  assert.equal(report.suitePreflight.scope,'pages_control_plane_only');
  assert.equal(report.suitePreflight.compiledUiFlagVerified,false);
  assert.equal(f.calls.length,2);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_TOKEN'),false);
  assert.equal(JSON.stringify(report).includes('NEVER_EXPORT'),false);
});
for (const mode of ['run','closure']) test('operator refuses '+mode+' before any network request',async t=>{
  const f=fixture();
  const {code,report}=await invoke(t,mode,f);
  assert.equal(code,1);assert.equal(report.error.code,'SUITE_PREFLIGHT_ONLY');
  assert.equal(report.acceptanceExecuted,false);assert.equal(f.calls.length,0);
});
test('suite run sentinel cannot bypass the operator guard',async()=>{
  await assert.rejects(run(),{code:'SUITE_PREFLIGHT_ONLY'});
});
test('control-plane403 is propagated without retry or application endpoint fallback',async t=>{
  const f=fixture(); let attempts=0;
  f.fetchImpl=async(url,options)=>{
    attempts++;assert.equal(url.origin,CF_API_ORIGIN);assert.equal(options.method,'GET');
    return new Response(JSON.stringify({success:false}),{status:403,headers:{'Content-Type':'application/json'}});
  };
  const {code,report}=await invoke(t,'preflight',f);
  assert.equal(code,1);assert.equal(report.error.code,'CLOUDFLARE_API_FAILED');
  assert.equal(attempts,2); // The two independent initial GETs, no retry.
  assert.equal(report.acceptanceExecuted,false);
});
