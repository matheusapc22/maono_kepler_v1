import test from 'node:test';import assert from 'node:assert/strict';
import {createLocalIdentityFixtureTransport,collectLocalSyntheticIdentity} from '../scripts/d1-batch-rehearsal/local-identity-collector.mjs';
import {makeLocalIdentityCollectorFixture} from './helpers/local-identity-collector-fixture.mjs';
const run=f=>collectLocalSyntheticIdentity({...f,transport:createLocalIdentityFixtureTransport(f.fixtures)});
const denied=/LOCAL_IDENTITY_COLLECTION_DENIED/;
test('local signed snapshots yield correspondence only, with distinct deployment and version IDs',async()=>{
 const f=await makeLocalIdentityCollectorFixture(),result=await run(f);
 assert.equal(result.localEvidenceVerified,true);assert.equal(result.remoteIdentityAuthenticated,false);assert.equal(result.operationalAuthorization,false);
 assert.equal(result.observed.versionId,f.approved.versionId);assert.notEqual(result.observed.versionId,result.observed.deploymentId);
});
test('only branded local fixture transport accepted; callbacks/network substitutes never invoked',async()=>{
 const f=await makeLocalIdentityCollectorFixture();let calls=0;
 await assert.rejects(collectLocalSyntheticIdentity({...f,transport:{mode:'synthetic-fixture-only',fetch(){calls++;}}}),denied);
 assert.throws(()=>createLocalIdentityFixtureTransport({...f.fixtures,callback(){calls++;}}),denied);assert.equal(calls,0);
 const transport=createLocalIdentityFixtureTransport(f.fixtures);f.fixtures.database.uuid='bad';
 assert.equal((await collectLocalSyntheticIdentity({...f,transport})).localEvidenceVerified,true);
});
test('active deployment drift, multi-version traffic, wrong version and stale observations denied',async()=>{
 const mutations=[f=>{f.deploymentAfter.id='00000000-0000-4000-8000-000000000099';},f=>{f.deploymentAfter.versions[0].version_id='00000000-0000-4000-8000-000000000099';},f=>{f.deploymentBefore.versions.push({...f.deploymentBefore.versions[0]});},f=>{f.deploymentBefore.versions[0].percentage=99;},f=>{f.version.id='00000000-0000-4000-8000-000000000099';},f=>{f.deploymentAfter.observedAtMs=100001;},f=>{f.account.observedAtMs=1;},f=>{f.deploymentAfter.observedAtMs=99999;}];
 for(const mutate of mutations){const f=await makeLocalIdentityCollectorFixture();mutate(f.fixtures);await assert.rejects(run(f),denied);}
});
test('account/database and binding substitutions or extra access rejected',async()=>{
 const mutations=[f=>{f.account.id='f'.repeat(32);},f=>{f.database.uuid='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';},f=>{f.database.name='maono_maps';},f=>{f.version.resources.bindings.push({type:'service',name:'EXTRA',service:'other'});},f=>{f.version.resources.bindings[0].id='00000000-0000-4000-8000-000000000099';},f=>{f.version.resources.bindings[1].namespace_id='f'.repeat(32);},f=>{f.version.resources.bindings[1].script_name='other';},f=>{f.version.resources.bindings[1].extra='unexpected';}];
 for(const mutate of mutations){const f=await makeLocalIdentityCollectorFixture();mutate(f.fixtures);await assert.rejects(run(f),denied);}
});
test('missing, forged or wrong-key provenance and changed bundle fail closed',async()=>{
 for(const mutate of [f=>{delete f.provenance;},f=>{f.provenance.signatureBase64url='A'.repeat(43);},f=>{f.bundleUtf8+='// changed';},f=>{f.provenance.statement.gitSha='f'.repeat(40);},f=>{f.provenance.statement.extra='forged';}]){const f=await makeLocalIdentityCollectorFixture();mutate(f.fixtures);await assert.rejects(run(f),denied);}
 const f=await makeLocalIdentityCollectorFixture();f.provenanceKey=(await makeLocalIdentityCollectorFixture()).provenanceKey;await assert.rejects(run(f),denied);
});
test('forged approved and statement hashes cannot manufacture a valid signature',async()=>{
 const f=await makeLocalIdentityCollectorFixture();f.approved.gitSha='f'.repeat(40);f.fixtures.provenance.statement.gitSha=f.approved.gitSha;await assert.rejects(run(f),denied);
 const p=await makeLocalIdentityCollectorFixture();p.approved.databaseUuid='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';await assert.rejects(run(p),denied);
});
