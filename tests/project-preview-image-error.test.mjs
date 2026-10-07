import test from 'node:test';import assert from 'node:assert/strict';
import {inspectPreviewImageFailure} from '../src/pages/Projects/components/preview-image-error.ts';
test('network, auth, permission, confirmed absence and invalid PNG failures remain distinct',async()=>{
 for(const [status,code,expected] of [[401,'SESSION_INVALID','session'],[403,'DENIED','permission'],[404,'PROJECT_THUMBNAIL_NOT_FOUND','missing'],[404,'PROJECT_NOT_FOUND','unverified'],[404,'PROJECT_THUMBNAIL_NOT_READY','unverified'],[422,'INVALID_THUMBNAIL_PNG','invalid-image']]){
  assert.equal(await inspectPreviewImageFailure('/private',undefined,async()=>new Response(JSON.stringify({error:{code}}),{status})),expected);
 }
 assert.equal(await inspectPreviewImageFailure('/private',undefined,async()=>{throw new TypeError('offline')}),'network');
 assert.equal(await inspectPreviewImageFailure('/private',undefined,async()=>new Response('png')),'unverified');
});
test('an unresponsive error probe times out without marking the project missing',async()=>{
 assert.equal(await inspectPreviewImageFailure('/private',undefined,()=>new Promise(()=>{}),10),'timeout');
});
test('dismissed failure probes settle even if the transport ignores cancellation',async()=>{
 const controller=new AbortController();const result=inspectPreviewImageFailure('/private',controller.signal,()=>new Promise(()=>{}));controller.abort();assert.equal(await result,'unverified');
});
