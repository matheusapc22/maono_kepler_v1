import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fixture,png,request,requestHandler,chunk } from './helpers/project-preview-fixture.mjs';
import { acquirePreviewUpload,markPreviewPayloadStored,failPreviewUpload,processPreviewOperation,recoverPreviewUpload,failWaitingPreview,reconcilePreviewOperations,publicPreviewOperation } from '../functions/_lib/project-preview-operations.js';
import { uploadPreviewPayload,verifyStoredPreview,previewArtifactFileName } from '../functions/_lib/project-preview-payload.js';
import { validatePreviewPng,readBoundedPreview,previewSha256 } from '../functions/_lib/project-preview-png.js';
import { uploadLocalStorageFile } from '../functions/_lib/local-storage.js';

const corrupt=()=>Object.assign(new Error('synthetic failure'),{status:503,code:'DROPBOX_UNAVAILABLE'});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
test('additive0040 is independent, foreign keys valid, identities and terminal receipts immutable',async t=>{
 const f=await fixture(t),op=await f.ready();assert.equal(op.state,'READY');
 assert.equal(f.row('PRAGMA quick_check').quick_check,'ok');assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.throws(()=>f.sqlite.prepare('UPDATE project_preview_operations SET image_checksum=? WHERE id=?').run('b'.repeat(64),op.id),/IMMUTABLE/);
 assert.throws(()=>f.sqlite.prepare('DELETE FROM project_preview_operations WHERE id=?').run(op.id),/RETAINED/);
 const sql=readFileSync(new URL('../migrations/0040_project_preview_operations.sql',import.meta.url),'utf8');assert.doesNotMatch(sql,/UPDATE\s+schema_versions|ALTER\s+TABLE\s+project_save_operations/i);
});
test('registration binds every receipt field and exact manifest; no latest receipt substitution',async t=>{
 const f=await fixture(t);const op=await f.register();assert.equal((await f.register()).id,op.id);
 for(const change of [{configChecksum:'b'.repeat(64)},{revision:2},{saveOperationId:'nonexistent-save-key'},{organizationId:'2'},{projectId:'2'},{imageChecksum:'c'.repeat(64)}])await assert.rejects(f.register(change));
 assert.equal(f.row('SELECT COUNT(*) AS n FROM project_preview_operations').n,1);
 assert.equal(await f.env.DB.prepare('SELECT receipt_json FROM project_save_operations WHERE id=?').bind(f.save.id).first().then(r=>r.receipt_json),f.save.receipt_json);
});
test('admission flag pauses only new operations and processing flag pauses only processing',async t=>{
 const f=await fixture(t),op=await f.register();f.env.PROJECT_PREVIEW_OPERATIONS_V1='false';assert.equal((await f.register()).id,op.id);
 await assert.rejects(f.register({operationId:'new-preview-operation'}),{code:'PROJECT_PREVIEW_ADMISSION_PAUSED'});
 const stored=await f.upload(op);f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='false';assert.equal((await f.process(stored)).state,'PAYLOAD_STORED');
 f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='true';assert.equal((await f.process(stored)).state,'READY');
});
test('HTTP waits for bytes and atomic outbox; waitUntil can never cause premature202',async t=>{
 const f=await fixture(t),op=await f.register(),gate=deferred();let entered=false,settled=false;
 const pending=request(f,'PUT','?operationId='+op.operation_id,f.bytes,{uploadPreviewPayload:async(...args)=>{entered=true;await gate.promise;return uploadPreviewPayload(...args)}}).then(r=>{settled=true;return r});
 while(!entered)await new Promise(r=>setTimeout(r,1));assert.equal(settled,false);assert.equal((await f.get()).state,'RECEIVING');assert.equal(f.row('SELECT COUNT(*) AS n FROM project_preview_outbox').n,0);
 gate.resolve();const response=await pending;assert.equal(response.status,200);assert.equal((await response.json()).operation.state,'READY');
});
test('durable202 means verified PNG plus journal; processor can finish with admission off',async t=>{
 const f=await fixture(t);await f.register();f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='false';const response=await request(f,'PUT','?operationId='+f.manifest.operationId,f.bytes);
 assert.equal(response.status,202);assert.equal((await response.json()).operation.payloadStored,true);assert.equal(f.row('SELECT COUNT(*) AS n FROM project_preview_outbox').n,1);
 f.env.PROJECT_PREVIEW_OPERATIONS_V1='false';f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='true';assert.equal((await reconcilePreviewOperations(f.env)).ready,1);
});
test('failure between storage and journal is recoverable from operation-owned immutable path',async t=>{
 const f=await fixture(t),op=await acquirePreviewUpload(f.env,{operation:await f.register()});
 const artifact=await uploadPreviewPayload(f.env,{operation:op,project:f.project(),body:f.bytes});
 f.failAt(2);await assert.rejects(markPreviewPayloadStored(f.env,{operation:op,artifact}));assert.equal((await f.get()).state,'RECEIVING');
 f.sqlite.exec('UPDATE project_preview_operations SET lease_until=0');const recovered=await recoverPreviewUpload(f.env,{operation:op});assert.equal(recovered.state,'PAYLOAD_STORED');
 assert.equal((await f.process(recovered)).state,'READY');assert.equal(f.row("SELECT COUNT(*) AS n FROM local_storage_objects WHERE path LIKE '%.png'").n,1);
});
test('reclaimed lease makes delayed failure and delayed success harmless',async t=>{
 const f=await fixture(t),old=await acquirePreviewUpload(f.env,{operation:await f.register()});
 const artifact=await uploadPreviewPayload(f.env,{operation:old,project:f.project(),body:f.bytes});f.sqlite.exec('UPDATE project_preview_operations SET lease_until=0');
 const current=await recoverPreviewUpload(f.env,{operation:old});const ready=await f.process(current);assert.equal(ready.state,'READY');
 assert.equal((await failPreviewUpload(f.env,{operation:old,error:corrupt()})).state,'READY');assert.equal((await markPreviewPayloadStored(f.env,{operation:old,artifact})).state,'READY');assert.equal(f.project().preview_status,'READY');
});
test('two captures of same revision have unique immutable files and newer registration fences old writer',async t=>{
 const f=await fixture(t),first=await f.upload(await f.register()),second=await f.upload(await f.register({operationId:'preview-operation-0002',rendererVersion:'v3'}));
 assert.notEqual(first.storage_ref,second.storage_ref);assert.equal((await f.process(second)).state,'READY');assert.equal((await f.process(first)).state,'SUPERSEDED');
 assert.equal(f.project().preview_artifact_id,second.id);assert.equal(f.row("SELECT COUNT(*) AS n FROM local_storage_objects WHERE path LIKE '%.png'").n,2);
});
test('same-revision new failure preserves READY and PATCH cannot downgrade READY or a foreign operation',async t=>{
 const f=await fixture(t),ready=await f.ready(),next=await f.register({operationId:'preview-operation-next'});
 await failWaitingPreview(f.env,{operation:next,errorCode:'CLIENT_CAPTURE_FAILED'});assert.equal(f.project().preview_status,'READY');assert.equal(f.project().preview_artifact_id,ready.id);
 assert.equal((await request(f,'PATCH','',{operationId:ready.operation_id,errorCode:'CLIENT_CAPTURE_FAILED'})).status,200);assert.equal(f.project().preview_status,'READY');
 assert.equal((await request(f,'PATCH','',{revision:1,errorCode:'CLIENT_CAPTURE_FAILED'})).status,400);
 assert.equal((await request(f,'PATCH','',{operationId:'unknown-preview-key'})).status,404);
});
test('revision advances during storage verification: superseded job never deletes fallback',async t=>{
 const f=await fixture(t),first=await f.ready(),second=await f.upload(await f.register({operationId:'preview-operation-new'}));
 const result=await processPreviewOperation(f.env,{operation:second,verifyPayload:async(...args)=>{
 const artifact=await verifyStoredPreview(...args);f.sqlite.exec("UPDATE projects SET config_revision=2,config_checksum='b',preview_status='FAILED'");return artifact;}});
 assert.equal(result.state,'SUPERSEDED');assert.equal(f.project().preview_artifact_id,first.id);assert.equal(f.project().preview_status,'FAILED');
 assert.equal((await request(f,'GET','?artifactId='+first.id+'&v=1')).status,200);
});
test('zero-row project CAS rolls back artifact, receipt and outbox; next worker retries',async t=>{
 const f=await fixture(t),op=await f.upload(await f.register());f.failAt(2);assert.equal((await f.process(op)).state,'RETRY_WAIT');
 assert.equal(f.project().preview_artifact_id,null);assert.equal((await f.get()).receipt_json,null);f.sqlite.exec('UPDATE project_preview_operations SET next_attempt_at=0');
 assert.equal((await f.process(op)).state,'READY');assert.equal(f.row("SELECT COUNT(*) AS n FROM project_preview_outbox WHERE state='DONE'").n,1);
});
test('fresh ACL generation, denial, membership, lifecycle and storage fences block commit races',async t=>{
 for(const mutation of ["DELETE FROM organization_users WHERE organization_id=1 AND user_id=1","INSERT INTO user_permission_denials(user_id,organization_id,permission) VALUES(1,1,'project.save')",'UPDATE users SET active=0 WHERE id=1',"UPDATE user_projects SET access_level='viewer' WHERE user_id=1 AND project_id=1",'UPDATE organizations SET active=0 WHERE id=1',"UPDATE projects SET lifecycle_state='FAILED' WHERE id=1","UPDATE projects SET dropbox_root_path='/different' WHERE id=1"]){
 const f=await fixture(t),op=await f.upload(await f.register());f.beforeBatch(db=>db.exec(mutation));const result=await f.process(op);
 assert.ok(['FAILED_FINAL','SUPERSEDED'].includes(result.state),mutation+': '+result.state);assert.equal(f.project().preview_artifact_id,null);assert.equal(result.receipt_json,null);
 }
});
test('unrelated ACL changes retry and never use stale generation',async t=>{
 const f=await fixture(t),op=await f.upload(await f.register());f.beforeBatch(db=>db.exec("UPDATE users SET name='Changed' WHERE id=3"));
 assert.equal((await f.process(op)).state,'RETRY_WAIT');f.sqlite.exec('UPDATE project_preview_operations SET next_attempt_at=0');assert.equal((await f.process(op)).state,'READY');
});
test('lost READY response returns same receipt, but PUT does not falsely confirm a now-missing object',async t=>{
 const f=await fixture(t),op=await f.ready();const response=await request(f,'PUT','?operationId='+op.operation_id,f.bytes);
 assert.deepEqual((await response.json()).operation.receipt,publicPreviewOperation(op).receipt);
 f.sqlite.prepare('DELETE FROM local_storage_objects WHERE path=?').run(op.storage_ref);const absent=await request(f,'PUT','?operationId='+op.operation_id,f.bytes);
 assert.equal(absent.status,404);assert.equal((await f.get()).state,'READY');
});
test('create-mode conflict never overwrites different bytes and terminal budget is finite',async t=>{
 const f=await fixture(t),op=await acquirePreviewUpload(f.env,{operation:await f.register()});
 await uploadLocalStorageFile(f.env,op.storage_root,previewArtifactFileName(op),png({shade:19}),'image/png',{writeMode:'create'});
 await assert.rejects(uploadPreviewPayload(f.env,{operation:op,project:f.project(),body:f.bytes}));
 const current=await f.get();f.sqlite.prepare('UPDATE project_preview_operations SET upload_attempts=8 WHERE id=?').run(op.id);
 const terminal=await failPreviewUpload(f.env,{operation:{...current,upload_attempts:8},error:corrupt()});assert.equal(terminal.state,'FAILED_FINAL');
});
test('PNG validation rejects signature-only, wrong dimensions, truncation, CRC, malformed stream, bad filter and decoded bomb',async()=>{
 assert.equal((await validatePreviewPng(png())).width,960);
 const valid=png(),badCrc=new Uint8Array(valid);badCrc[45]^=1;
 const cases=[valid.slice(0,8),png({width:1,height:1}),valid.slice(0,-4),badCrc,png({filter:5}),png({raw:Buffer.alloc(9000000)}),
 new Uint8Array(Buffer.concat([Buffer.from(valid.subarray(0,33)),chunk('IDAT',Buffer.from('not deflate')),chunk('IEND',Buffer.alloc(0))]))];
 for(const bytes of cases)await assert.rejects(validatePreviewPng(bytes));
});
test('stream limiter cancels dishonest and chunked bodies without arrayBuffer allocation',async()=>{
 let canceled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024));},cancel(){canceled=true;}});
 await assert.rejects(readBoundedPreview(stream,{maxBytes:4096}),{code:'THUMBNAIL_TOO_LARGE'});assert.equal(canceled,true);
});
test('GET legacy and operation artifacts are readonly and authenticated private no-cache including304',async t=>{
 const f=await fixture(t),op=await f.ready(),before=f.project();const response=await request(f,'GET','?artifactId='+op.id+'&v=1');
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-cache');const etag=response.headers.get('ETag');
 assert.equal((await request(f,'GET','?artifactId='+op.id+'&v=1',null,{}, {'If-None-Match':etag})).status,304);
 assert.equal((await request(f,'GET','?artifactId='+op.id+'&v=1',null,{requireProjectPermission:async()=>{throw Object.assign(new Error(),{status:403});}},{'If-None-Match':etag})).status,403);
 assert.deepEqual(f.project(),before);
});
test('status receipts are actor scoped; global PENDING without a capture is WAITING_CAPTURE',async t=>{
 const f=await fixture(t),handler=requestHandler(f,{},'status');let response=await handler({env:f.env,params:{slug:'map'},request:new Request('https://p.invalid/status')});
 assert.equal((await response.json()).jobState,'WAITING_CAPTURE');await f.register();
 response=await handler({env:f.env,params:{slug:'map'},request:new Request('https://p.invalid/status?operationId='+f.manifest.operationId)});assert.equal((await response.json()).operation.state,'WAITING_CAPTURE');
});

test('READY PUT rechecks permission after storage and refuses a revoked session',async t=>{
 const f=await fixture(t),op=await f.ready();let sessions=0;
 const response=await request(f,'PUT','?operationId='+op.operation_id,f.bytes,{requireSession:async()=>{
 sessions++;if(sessions===2)throw Object.assign(new Error(),{status:401,code:'SESSION_REVOKED'});return{id:1,role:'owner'};}});
 assert.equal(response.status,401);assert.equal(sessions,2);assert.equal(f.project().preview_status,'READY');
});
test('RECEIVING reports lease expiry so reconnect can resume without a scheduled worker',async t=>{
 const f=await fixture(t),op=await acquirePreviewUpload(f.env,{operation:await f.register()});
 assert.equal(publicPreviewOperation(op).nextAttemptAt,op.lease_until);
 f.sqlite.exec('UPDATE project_preview_operations SET lease_until=0');
 const response=await request(f,'PUT','?operationId='+op.operation_id,f.bytes);assert.equal(response.status,200);assert.equal((await response.json()).operation.state,'READY');
});
test('recovery expires abandoned capture and bounded processing attempts without touching saved JSON',async t=>{
 const f=await fixture(t);const waiting=await f.register();
 f.sqlite.prepare("UPDATE project_preview_operations SET created_at=datetime('now','-2 days') WHERE id=?").run(waiting.id);
 assert.equal((await reconcilePreviewOperations(f.env)).failed,1);assert.equal((await f.get()).error_code,'PROJECT_PREVIEW_CAPTURE_EXPIRED');
 const next=await f.upload(await f.register({operationId:'preview-expired-retry'}));
 f.sqlite.prepare('UPDATE project_preview_operations SET attempts=8 WHERE id=?').run(next.id);
 assert.equal((await f.process(next)).state,'FAILED_FINAL');assert.equal(f.project().config_revision,1);assert.equal(f.project().config_checksum,'a'.repeat(64));
});
test('two processors and same-operation duplicate request publish exactly one immutable receipt',async t=>{
 const f=await fixture(t),op=await f.upload(await f.register());const results=await Promise.all([f.process(op),f.process(op)]);
 assert.ok(results.some(r=>r.state==='READY'));const final=await f.get();assert.equal(final.state,'READY');assert.equal(f.project().preview_artifact_id,op.id);
 const again=await f.process(op);assert.equal(again.receipt_json,final.receipt_json);assert.equal(f.row('SELECT COUNT(*) AS n FROM project_preview_operations').n,1);
});
test('a storage object corrupted after admission never gets a READY pointer',async t=>{
 const f=await fixture(t),op=await f.upload(await f.register());f.sqlite.prepare('UPDATE local_storage_objects SET content=? WHERE path=?').run(f.bytes.slice(0,8),op.storage_ref);
 const result=await f.process(op);assert.equal(result.state,'FAILED_FINAL');assert.equal(f.project().preview_artifact_id,null);assert.equal(f.project().config_revision,1);
});
test('HTTP POST and owned status retain exact identity across lost registration response',async t=>{
 const f=await fixture(t);const first=await request(f,'POST','',f.manifest);assert.equal(first.status,201);const a=(await first.json()).operation;
 const second=await request(f,'POST','',f.manifest);const b=(await second.json()).operation;
 assert.equal(a.artifactId,b.artifactId);assert.equal(a.payloadStored,false);assert.equal(a.receipt,null);
 const handler=requestHandler(f,{requireSession:async()=>({id:2,role:'editor'})},'status');
 const forbidden=await handler({env:f.env,params:{slug:'map'},request:new Request('https://p.invalid/status?operationId='+f.manifest.operationId)});assert.equal(forbidden.status,404);
});
test('real HTTP chunked transport retains the same registered operation through PUT and GET',async t=>{
 const {createServer}=await import('node:http');const {Readable}=await import('node:stream');const f=await fixture(t);const handler=requestHandler(f);
 const server=createServer(async(req,res)=>{try{
 const response=await handler({env:f.env,params:{slug:'map'},request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,
 ...(req.method!=='GET' ? {body:Readable.toWeb(req),duplex:'half'} : {})})});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.manifest)})).status,201);
 let at=0;const body=new ReadableStream({pull(c){if(at>=f.bytes.length){c.close();return;}c.enqueue(f.bytes.subarray(at,at+113));at+=113;}});
 const response=await fetch(base+'?operationId='+f.manifest.operationId,{method:'PUT',headers:{'Content-Type':'image/png'},body,duplex:'half'});
 assert.equal(response.status,200);const op=(await response.json()).operation;
 const image=await fetch(base+'?artifactId='+op.artifactId+'&v=1');assert.equal(image.status,200);assert.equal(await previewSha256(new Uint8Array(await image.arrayBuffer())),f.manifest.imageChecksum);
});

test('authorized editor recaptures another actor save only through its immutable revision link',async t=>{
 const f=await fixture(t);const {registerPreviewOperation}=await import('../functions/_lib/project-preview-operations.js');
 const op=await registerPreviewOperation(f.env,{actor:{id:2},project:f.project(),manifest:f.manifest});assert.equal(op.actor_user_id,2);assert.equal(op.save_operation_id,f.save.id);
 assert.equal((await f.process(await f.upload(op))).state,'READY');
});

test('explicit historical artifact GET fences storage context changes during provider read',async t=>{
 const f=await fixture(t), op=await f.ready();
 const {downloadDropboxBinaryFile}=await import('../functions/_lib/dropbox.js');
 for (const change of ["UPDATE projects SET dropbox_root_path='/moved'", "UPDATE projects SET default_config_file='changed.json'"]) {
  const original=f.project();
  const response=await request(f,'GET',`?artifactId=${op.id}&v=1`,null,{downloadDropboxBinaryFile:async(...args)=>{
   const bytes=await downloadDropboxBinaryFile(...args); f.sqlite.exec(change);return bytes;
  }});
  assert.equal(response.status,404);
  f.sqlite.prepare('UPDATE projects SET dropbox_root_path=?,default_config_file=?').run(original.dropbox_root_path,original.default_config_file);
 }
});

test('JSON manifest registration and diagnostics are byte-limited before parsing',async t=>{
 const f=await fixture(t);
 assert.equal((await request(f,'POST','',{...f.manifest,padding:'x'.repeat(17000)})).status,413);
 assert.equal(f.row('SELECT COUNT(*) AS n FROM project_preview_operations').n,0);
 const handler=requestHandler(f);const response=await handler({env:f.env,params:{slug:'map'},request:new Request('https://preview.invalid/api/projects/map/thumbnail',{method:'POST',body:'{invalid'})});
 assert.equal(response.status,400);
});
