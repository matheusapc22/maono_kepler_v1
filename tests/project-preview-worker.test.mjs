import test from 'node:test';
import assert from 'node:assert/strict';
import {runProjectRecoveryDomains} from '../workers/project-save-operations.js';
import {fixture} from './helpers/project-preview-fixture.mjs';
test('shared scheduler leaves both disabled domains inert without database access',async()=>{
 const env={get DB(){throw new Error('must not access DB')}};
 const outcomes=await runProjectRecoveryDomains(env);assert.deepEqual(outcomes.map(value=>value.value),[{disabled:true},{disabled:true}]);
});
test('either recovery domain can reject without stopping its sibling and rejection is observable',async()=>{
 for(const failing of ['save','preview']){
  const called=[],logs=[],original=console.error;console.error=(...args)=>logs.push(args);
  try {
   const run=domain=>async()=>{called.push(domain);if(domain===failing)throw Object.assign(new Error('private secret not logged'),{code:'SYNTHETIC_FAILURE'});return {completed:true}};
   const outcomes=await runProjectRecoveryDomains({}, {saveRecovery:run('save'),previewRecovery:run('preview')});
   assert.deepEqual(called.sort(),['preview','save']);assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
   assert.deepEqual(logs,[['[Maono recovery] domain failed',{domain:failing,code:'SYNTHETIC_FAILURE'}]]);
  } finally {console.error=original}
 }
});
test('shared scheduled preview recovery publishes after JSON is already committed, with save worker off',async t=>{
 const f=await fixture(t);const accepted=await f.upload(await f.register());assert.equal(f.save.state,'PUBLISHED');assert.equal(accepted.state,'PAYLOAD_STORED');
 const outcomes=await runProjectRecoveryDomains(f.env);assert.deepEqual(outcomes[0].value,{disabled:true});assert.equal(outcomes[1].value.ready,1);assert.equal((await f.get()).state,'READY');
});
