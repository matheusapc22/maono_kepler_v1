import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { hashPreviewBlob } from '../src/pages/Kepler/thumbnail/preview-contract.ts';
import { publishPreviewRecord, bindCapturedPreview, previewRetryDelay, waitForPreview } from '../src/pages/Kepler/thumbnail/preview-recovery.ts';
import { previewAccountKey, previewSpoolKey } from '../src/pages/Kepler/thumbnail/preview-spool.ts';

async function setup() {
  const blob = new Blob([new Uint8Array(100)], {type:'image/png'});
  const manifest = { operationId:'preview-operation-0001', saveOperationId:'save-operation-0001', organizationId:'7', projectId:'19', revision:2,
    configChecksum:'a'.repeat(64), editorSessionId:'editor-session-0001', editGeneration:4, rendererVersion:'maono-png-v2',
    imageChecksum:await hashPreviewBlob(blob), sizeBytes:blob.size, captureMethod:'canvas-composite' };
  const record={key:previewSpoolKey('3',manifest),accountKey:previewAccountKey('3','7'),actorId:'3',organizationId:'7',slug:'synthetic',manifest,blob,
    createdAt:1000,expiresAt:1000000,attempts:0,nextAttemptAt:0,lastError:null,state:'LOCAL_READY'};
  const history=[];let clock=1000;
  const spool={put:async value=>history.push(['put',value]),remove:async key=>history.push(['remove',key]), promote:async(value,key,current)=>{if(!current())throw new DOMException('changed','AbortError');history.push(['put',value],['stage-removed',key])},removeStaged:async key=>history.push(['stage-removed',key])};
  const receipt={...manifest,artifactId:'immutable-artifact'};
  const operation=state=>({operationId:manifest.operationId,state,payloadStored:state==='READY',receipt:state==='READY'?receipt:null});
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const options={spool,now:()=>clock,wait:async ms=>{clock+=Math.max(1,ms)},onState:(...args)=>history.push(['state',...args])};
  return {record,history,spool,receipt,operation,response,options};
}
test('network TypeError retries the SAME operation with a status lookup before re-upload',async()=>{
  const f=await setup();let state='WAITING_CAPTURE',puts=0;const calls=[];
  const fetchImpl=async(url,init)=>{calls.push(init.method);if(init.method==='PUT'){puts++;if(puts===1)throw new TypeError('offline');state='READY'}return f.response({ok:true,operation:f.operation(state)})};
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),'READY');
  assert.equal(puts,2);assert.deepEqual(calls,['GET','PUT','GET','PUT','GET']);
  assert.ok(f.history.some(row=>row[0]==='put'&&row[1].state==='RETRY_WAIT'));
});
test('lost response after publication retrieves original receipt, without another upload',async()=>{
  const f=await setup();let state='WAITING_CAPTURE';const calls=[];
  const fetchImpl=async(url,init)=>{calls.push(init.method);if(init.method==='PUT'){state='READY';throw new TypeError('response lost')}return f.response({ok:true,operation:f.operation(state)})};
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),'READY');assert.deepEqual(calls,['GET','PUT','GET']);
  assert.equal(f.history.filter(row=>row[0]==='remove').length,1);
});
test('unavailable status does not prove absence and does not register or re-upload',async()=>{
  const f=await setup();let gets=0;const calls=[];
  const fetchImpl=async(url,init)=>{calls.push(init.method);if(++gets<3)throw new TypeError('status unavailable');return f.response({ok:true,operation:f.operation('READY')})};
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),'READY');assert.deepEqual(calls,['GET','GET','GET']);
});
test('a mismatched READY receipt never removes local PNG bytes',async()=>{
  const f=await setup();const fetchImpl=async()=>f.response({ok:true,operation:{...f.operation('READY'),receipt:{...f.receipt,projectId:'20'}}});
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),'FAILED');assert.ok(!f.history.some(row=>row[0]==='remove'));
  assert.equal(f.history.find(row=>row[0]==='put')[1].lastError,'PREVIEW_RECEIPT_UNVERIFIED');
});
for(const status of [401,403])test(`HTTP ${status} ${status===401?'pauses':'ends'} the operation without deleting bytes`,async()=>{
  const f=await setup();let calls=0;const fetchImpl=async()=>{calls++;return f.response({ok:false,error:{code:'ACCESS_DENIED'}},status)};
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),status===401?'PAUSED':'FAILED');assert.equal(calls,1);assert.ok(!f.history.some(row=>row[0]==='remove'));
});
test('retry attempts and expiry are persisted with a bounded final failure',async()=>{
  const f=await setup();let calls=0;
  const fetchImpl=async()=>{calls++;return f.response({ok:false,error:{code:'RETRY_LATER'}},503)};
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),'FAILED');assert.equal(calls,12);
  assert.equal(f.history.filter(row=>row[0]==='put').at(-1)[1].state,'FAILED_FINAL');
});
test('cancelling a pending delay settles and releases its timer/listener',async()=>{
  const controller=new AbortController();const pending=waitForPreview(60000,controller.signal);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(await waitForPreview(0),undefined);
});
test('server-accepted bytes outlive browser polling, retaining exact PNG until matching receipt',async()=>{
  const f=await setup();let calls=0;
  const fetchImpl=async()=>f.response({ok:true,operation:{...f.operation(++calls<7?'PAYLOAD_STORED':'READY'),payloadStored:true}});
  assert.equal(await publishPreviewRecord(f.record,{...f.options,fetchImpl}),'READY');assert.equal(calls,7);
  assert.equal(f.history.filter(row=>row[0]==='put').length,6);assert.equal(f.history.at(-2)[0],'remove');
});
test('Retry-After is a floor, not an ignored hint',()=>{assert.equal(previewRetryDelay(0,60000,()=>0),60000);assert.equal(previewRetryDelay(0,0,()=>0),800)});
test('PNG binds only to verified saved identity after payload cleanup, without JSON parsing',async()=>{
  const f=await setup();const staged={key:'stage',actorId:'3',organizationId:'7',saveOperationId:f.record.manifest.saveOperationId,editorSessionId:f.record.manifest.editorSessionId,
    editGeneration:4,rendererVersion:'maono-png-v2',blob:f.record.blob,imageChecksum:f.record.manifest.imageChecksum,captureMethod:'canvas-composite',createdAt:1000,expiresAt:1000000};
  const snapshot={scope:{actorId:'3',organizationId:'7',projectId:'19'},projectSlug:'synthetic',manifest:{operationId:staged.saveOperationId,contentHash:'a'.repeat(64)},editorSessionId:staged.editorSessionId,editGeneration:4,serialized:{body:null}};
  const receipt={operationId:staged.saveOperationId,organizationId:7,projectId:19,publishedRevision:2,checksum:'a'.repeat(64),checksumAlgorithm:'dropbox-content-hash'};
  const record=await bindCapturedPreview(snapshot,{receipt},staged,f.spool);assert.equal(record.manifest.revision,2);assert.equal(record.blob,staged.blob);
  await assert.rejects(()=>bindCapturedPreview(snapshot,{receipt:{...receipt,checksum:'b'.repeat(64)}},staged,f.spool),/PREVIEW_SAVE_RECEIPT_UNVERIFIED/);
});
test('save click starts capture before hashing and receipt handler never parses the map or awaits PNG',()=>{
  const source=readFileSync(new URL('../src/pages/Kepler/components/maono-save-button.tsx',import.meta.url),'utf8');
  assert.match(source,/prepareClickedPreview\(clicked, attempt.saveId, route\);[\s\S]*await prepareProjectUpdateSnapshot/);
  const accepted=source.slice(source.indexOf('async function accepted'),source.indexOf('async function runSnapshot'));
  assert.doesNotMatch(accepted,/JSON\.parse|body\.text|await enqueueProjectThumbnailJob|mapState:/);assert.match(accepted,/void enqueueProjectThumbnailJob/);
});

test('hung fetch and hung JSON responses both have bounded retryable request deadlines',async()=>{
 const {requestPreview}=await import('../src/pages/Kepler/thumbnail/thumbnail-api.ts');
 const hung=()=>new Promise(()=>{});
 for(const fetchImpl of [hung,async()=>({ok:true,status:200,json:hung})]){
  const started=Date.now();await assert.rejects(()=>requestPreview('map','/status',{method:'GET'},fetchImpl,10),error=>error.code==='PREVIEW_REQUEST_TIMEOUT'&&error.retryable);
  assert.ok(Date.now()-started<1000);
 }
});
test('session cancellation settles even if a transport ignores AbortSignal',async()=>{
 const {requestPreview}=await import('../src/pages/Kepler/thumbnail/thumbnail-api.ts');const controller=new AbortController();
 const pending=requestPreview('map','/status',{method:'GET',signal:controller.signal},()=>new Promise(()=>{}),1000);controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
});

test('prepared frame memory is released on archive, unmount, stale receipt and pre-persistence failure',()=>{
 const source=readFileSync(new URL('../src/pages/Kepler/components/maono-save-button.tsx',import.meta.url),'utf8');
 assert.match(source,/for \(const capture of previewCaptures.current.values\(\)\) capture.cancel\(\)/);
 assert.match(source,/previewCaptures.current.clear\(\)/);
 assert.match(source,/releasePreparedPreview\(pending.manifest.operationId\)/);
 assert.match(source,/clickedOperationId && !snapshotPersisted/);
 assert.match(source,/currentRevision !== revision\) capture\?\.cancel\(\)/);
 assert.doesNotMatch(source,/removeStaged|clearAccount/,'dropping in-memory references never deletes a recoverable PNG');
});

for (const reason of ['organization switch', 'explicit job cancellation']) test(`${reason} during persistence retains the durable PNG`, async () => {
  const f=await setup(); let current=true; const controller=new AbortController(); let retained=true;
  const spool={...f.spool,put:async (_record,guard)=>{assert.equal(guard(),true);if(reason==='organization switch')current=false;else controller.abort()},remove:async()=>{retained=false}};
  const fetchImpl=async()=>f.response({ok:true,operation:f.operation('PAYLOAD_STORED')});
  assert.equal(await publishPreviewRecord(f.record,{...f.options,spool,fetchImpl,signal:controller.signal,isCurrent:()=>current}),'CANCELLED');
  assert.equal(retained,true);
});
test('purge-epoch rejection cancels instead of retrying or uploading a memory fallback',async()=>{
  const f=await setup();let calls=0;const spool={...f.spool,put:async()=>{throw new DOMException('purged','AbortError')}};
  const fetchImpl=async()=>{calls++;return f.response({ok:true,operation:f.operation('PAYLOAD_STORED')})};
  assert.equal(await publishPreviewRecord(f.record,{...f.options,spool,fetchImpl}),'CANCELLED');assert.equal(calls,1);
  assert.ok(!f.history.some(row=>row[0]==='remove'));
});
test('receipt binding preserves the captured purge epoch rather than refreshing stale bytes',async()=>{
  const f=await setup();const m=f.record.manifest;
  const staged={key:'stage',actorId:'3',organizationId:'7',saveOperationId:m.saveOperationId,editorSessionId:m.editorSessionId,editGeneration:4,rendererVersion:'v2',blob:f.record.blob,imageChecksum:m.imageChecksum,captureMethod:'canvas-composite',createdAt:1000,expiresAt:1000000,purgeEpoch:4};
  const snapshot={scope:{actorId:'3',organizationId:'7',projectId:'19'},projectSlug:'synthetic',manifest:{operationId:staged.saveOperationId,contentHash:'a'.repeat(64)},editorSessionId:staged.editorSessionId,editGeneration:4};
  const receipt={operationId:staged.saveOperationId,organizationId:7,projectId:19,publishedRevision:2,checksum:'a'.repeat(64),checksumAlgorithm:'dropbox-content-hash'};
  assert.equal((await bindCapturedPreview(snapshot,{receipt},staged,f.spool)).purgeEpoch,4);
});
test('401 pause, organization switch, logout ABA and actor replacement have distinct lifecycles',async t=>{
  const {activatePreviewRecovery,capturePreviewSessionFence}=await import('../src/pages/Kepler/thumbnail/preview-recovery.ts');
  const {defaultPreviewSpool}=await import('../src/pages/Kepler/thumbnail/preview-spool.ts');
  const document=new EventTarget();document.visibilityState='hidden';
  const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window=new EventTarget();globalThis.document=document;
  t.after(()=>{globalThis.window=oldWindow;globalThis.document=oldDocument});
  const epochs=new Map(),cleared=[],reads=[];let release,block=false;
  t.mock.method(defaultPreviewSpool,'accountEpoch',async actor=>{reads.push(actor);return epochs.get(actor)||0});
  t.mock.method(defaultPreviewSpool,'clearAccount',async actor=>{if(block)await new Promise(resolve=>{release=resolve});cleared.push(actor);epochs.set(actor,(epochs.get(actor)||0)+1)});
  activatePreviewRecovery('3','7');const first=capturePreviewSessionFence('3','7');assert.equal(await first.purgeEpoch,0);
  activatePreviewRecovery('3','8');assert.equal(first.isCurrent(),false);await capturePreviewSessionFence('3','8').purgeEpoch;assert.deepEqual(cleared,[]);
  const beforeExpiry=capturePreviewSessionFence('3','8');activatePreviewRecovery(null,null);assert.equal(beforeExpiry.isCurrent(),false);assert.deepEqual(cleared,[]);
  activatePreviewRecovery('3','8');const resumed=capturePreviewSessionFence('3','8');assert.equal(await resumed.purgeEpoch,0);
  block=true;activatePreviewRecovery(null,null,'logout');activatePreviewRecovery('3','8');const afterLogout=capturePreviewSessionFence('3','8');const count=reads.length;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads.length,count,'new session cannot obtain an epoch before purge commits');assert.equal(resumed.isCurrent(),false);
  block=false;release();assert.equal(await afterLogout.purgeEpoch,1);assert.deepEqual(cleared,['3']);
  activatePreviewRecovery(null,null);activatePreviewRecovery('9','7');assert.equal(await capturePreviewSessionFence('9','7').purgeEpoch,0);assert.deepEqual(cleared,['3','3'],'replacement after expiration still purges the prior actor');
  activatePreviewRecovery(null,null,'logout');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(cleared,['3','3','9']);
});
test('session wiring marks only explicit logout as a purge and staging never removes bytes on pause',()=>{
  const session=readFileSync(new URL('../src/auth/session.tsx',import.meta.url),'utf8');
  assert.equal((session.match(/applySession\(EMPTY_SESSION, "logout"\)/g)||[]).length,1);
  assert.ok((session.match(/applySession\(EMPTY_SESSION\)/g)||[]).length>=2);
  const job=readFileSync(new URL('../src/pages/Kepler/thumbnail/background-thumbnail-job.ts',import.meta.url),'utf8');
  assert.match(job,/capturePreviewSessionFence\(input.actorId, input.organizationId\)/);assert.match(job,/stage\(staged, canPersist\)/);
  assert.doesNotMatch(job,/removeStaged/);assert.match(job,/purgeEpoch: await sessionFence.purgeEpoch/);
  const enqueue=job.slice(job.indexOf('export async function enqueueProjectThumbnailJob'));assert.ok(enqueue.indexOf('await sessionFence.purgeEpoch')<enqueue.indexOf('await defaultPreviewSpool.staged'));
});
test('failed logout purge fails closed for new same-account capture and recovery',async t=>{
  const {activatePreviewRecovery,capturePreviewSessionFence}=await import('../src/pages/Kepler/thumbnail/preview-recovery.ts');
  const {defaultPreviewSpool}=await import('../src/pages/Kepler/thumbnail/preview-spool.ts');
  const {defaultDurableSaveStore}=await import('../src/pages/Kepler/durable-save-controller.ts');
  const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.document.visibilityState='hidden';
  t.after(()=>{globalThis.window=oldWindow;globalThis.document=oldDocument});
  let epochReads=0,recoveryReads=0;const warnings=[];
  t.mock.method(console,'warn',message=>warnings.push(message));
  t.mock.method(defaultPreviewSpool,'accountEpoch',async()=>{epochReads++;return 0});
  t.mock.method(defaultPreviewSpool,'clearAccount',async()=>{throw new Error('fixture quota failure')});
  t.mock.method(defaultDurableSaveStore,'listAccount',async()=>{recoveryReads++;return []});
  activatePreviewRecovery('3','7');await capturePreviewSessionFence('3','7').purgeEpoch;
  activatePreviewRecovery(null,null,'logout');globalThis.document.visibilityState='visible';activatePreviewRecovery('3','7');
  await assert.rejects(capturePreviewSessionFence('3','7').purgeEpoch,/fixture quota failure/);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(epochReads,1);assert.equal(recoveryReads,0);assert.equal(warnings.length,1);
  activatePreviewRecovery(null,null);
});
