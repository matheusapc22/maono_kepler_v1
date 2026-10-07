import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture,requestHandler } from './helpers/project-preview-fixture.mjs';
import { publishPreviewRecord } from '../src/pages/Kepler/thumbnail/preview-recovery.ts';
import { previewSpoolKey,previewAccountKey } from '../src/pages/Kepler/thumbnail/preview-spool.ts';
import { reconcilePreviewOperations } from '../functions/_lib/project-preview-operations.js';
for (const lost of ['POST','PUT',null]) test(`browser controller → real Request handlers → SQLite/immutable PNG; lost=${lost}`,async t=>{
 const f=await fixture(t), history=[], removed=[];let lose=lost;
 const handlers={index:requestHandler(f),status:requestHandler(f,{},'status')};
 const fetchImpl=async(path,init={})=>{
  history.push(init.method);
  const url=new URL(path,'https://preview.invalid');
  const response=await handlers[url.pathname.endsWith('/status')?'status':'index']({env:f.env,params:{slug:'map'},request:new Request(url,init)});
  if (init.method===lose&&response.ok){lose=null;throw new TypeError('lost response after server action')}
  return response;
 };
 const blob=new Blob([f.bytes],{type:'image/png'}), now=Date.now();
 const record={key:previewSpoolKey('1',f.manifest),accountKey:previewAccountKey('1','1'),actorId:'1',organizationId:'1',slug:'map',manifest:f.manifest,blob,createdAt:now,expiresAt:now+86400000,attempts:0,nextAttemptAt:0,lastError:null,state:'LOCAL_READY'};
 const result=await publishPreviewRecord(record,{fetchImpl,wait:async()=>{},spool:{put:async()=>{},remove:async key=>removed.push(key)}});
 assert.equal(result,'READY');assert.equal(history.filter(method=>method==='POST').length,1);assert.equal(history.filter(method=>method==='PUT').length,1);
 assert.equal(removed.length,1);assert.equal(f.project().preview_status,'READY');assert.equal(f.row("SELECT COUNT(*) AS n FROM local_storage_objects WHERE path LIKE '%.png'").n,1);
 assert.equal(f.row('SELECT COUNT(*) AS n FROM project_preview_operations').n,1);
});
test('durable202 with a later worker publication completes the same browser operation',async t=>{
 const f=await fixture(t);f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='false';const handlers={index:requestHandler(f),status:requestHandler(f,{},'status')};let accepted=false;
 const fetchImpl=async(path,init={})=>{if(accepted&&init.method==='GET'){f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='true';await reconcilePreviewOperations(f.env)}
  const url=new URL(path,'https://preview.invalid');const response=await handlers[url.pathname.endsWith('/status')?'status':'index']({env:f.env,params:{slug:'map'},request:new Request(url,init)});
  if(init.method==='PUT'){assert.equal(response.status,202);accepted=true}return response};
 const now=Date.now(),record={key:previewSpoolKey('1',f.manifest),accountKey:previewAccountKey('1','1'),actorId:'1',organizationId:'1',slug:'map',manifest:f.manifest,blob:new Blob([f.bytes],{type:'image/png'}),createdAt:now,expiresAt:now+86400000,attempts:0,nextAttemptAt:0,lastError:null,state:'LOCAL_READY'};
 assert.equal(await publishPreviewRecord(record,{fetchImpl,wait:async()=>{},spool:{put:async()=>{},remove:async()=>{}}}),'READY');assert.equal(accepted,true);
});

test('PNG query identifiers and Pages slug params decode once without aliasing malformed or double-encoded IDs',async t=>{
 const f=await fixture(t);f.manifest.operationId='qa-preview:local-routing:small:create';
 const handlers={index:requestHandler(f,{getAuthorizedProject:async(_env,_user,slug)=>slug==='map'?f.project():null}),
  status:requestHandler(f,{getAuthorizedProject:async(_env,_user,slug)=>slug==='map'?f.project():null},'status')};
 const send=async(method,query='',body=null)=>{
  const path=`/api/projects/%6dap/thumbnail${method==='GET'?'/status':''}${query}`;
  return handlers[method==='GET'?'status':'index']({env:f.env,params:{slug:new URL(path,'https://preview.invalid').pathname.split('/')[3]},
   request:new Request(new URL(path,'https://preview.invalid'),{method,headers:{'Content-Type':body instanceof Uint8Array?'image/png':'application/json'},
    ...(body?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})})});
 };
 assert.equal((await send('POST','',f.manifest)).status,201);
 const query=`?operationId=${encodeURIComponent(f.manifest.operationId)}`;
 assert.equal((await send('PUT',query,f.bytes)).status,200);
 const state=await (await send('GET',query)).json();assert.equal(state.operation.state,'READY');assert.equal(state.operation.operationId,f.manifest.operationId);
 const writes=f.row('SELECT total_changes() AS n').n;
 for(const id of [encodeURIComponent(encodeURIComponent(f.manifest.operationId)),'%','%GG','%E0%A4%A','preview%2Foutside']) {
  for(const method of ['GET','PUT']) assert.equal((await send(method,`?operationId=${id}`,method==='PUT'?f.bytes:null)).status,404);
 }
 assert.equal(f.row('SELECT total_changes() AS n').n,writes);
 assert.equal(f.row("SELECT COUNT(*) AS n FROM local_storage_objects WHERE path LIKE '%.png'").n,1);
});
