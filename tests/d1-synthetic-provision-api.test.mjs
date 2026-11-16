// Fake API/Memory journal tests only, NOT evidence of remote creation or durable disk state.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {provisionFixedPilot} from '../scripts/d1-synthetic-provision/api-core.mjs';
const plan=()=>({...JSON.parse(readFileSync(new URL('../ops/d1-synthetic-provision/plan.json',import.meta.url),'utf8')),enabled:true});
const clock=10000000,token='synthetic-test-token-no-real-access',dbUuid='00000000-0000-4000-8000-000000000044';
const observation=()=>({accountId:plan().accountId,plan:'free',monthlyBaseUSD:0,observedAtMs:clock,source:'cloudflare-dashboard',operatorObservationOnly:true});
function fixture({failCall,throwCall,timeoutCall,journalFailAt,beginResult=true,mutateResponse}={}){
 const calls=[],events=[];let claimed=false;
 const replies=[[],[],[],{uuid:dbUuid,name:plan().databaseName},{id:plan().workerName},{enabled:false,previews_enabled:false},{enabled:false,previews_enabled:false},{bindings:[{type:'d1',name:'TARGET',id:dbUuid},{type:'durable_object_namespace',name:'REGISTRY',class_name:'SyntheticClaimRegistry',namespace_id:'a'.repeat(32)}]}];
 const fetchImpl=async(url,options)=>{calls.push({url,options});const n=calls.length;if(n===throwCall)throw Error('PRIVATE '+token);if(n===timeoutCall)return new Promise(()=>{});if(n===failCall)return new Response('PRIVATE',{status:403});let result=structuredClone(replies[n-1]);if(mutateResponse)result=mutateResponse(result,n);return Response.json({success:true,errors:[],messages:[],result});};
 const journal={async begin(record){events.push({phase:'begin',...record});if(claimed)return false;claimed=true;return beginResult;},async record(record){events.push(structuredClone(record));if(events.length===journalFailAt)throw Error('PRIVATE disk details');return true;}};
 const args={plan:plan(),freeObservation:observation(),token,fetchImpl,journal,now:()=>clock,timeoutMs:20};
 return {calls,events,args};
}
test('FAKE fixed sequence: empty-account GETs then exactly D1 POST, Worker PUT, subdomain POST, read-only verification',async()=>{
 const f=fixture(),r=await provisionFixedPilot(f.args);assert.equal(r.status,'provisioned-deny-all');assert.equal(r.writeAttempts,3);assert.equal(r.inventory.length,3);assert.equal(r.inventory[0].uuid,dbUuid);assert.equal(r.inventory[2].uuid,'a'.repeat(32));assert.equal(r.workersDevEnabled,false);assert.equal(r.previewsEnabled,false);assert.equal(r.zeroCostGuarantee,false);assert.equal(r.allPublicRoutingVerified,false);assert.equal(r.expiresAtMs,clock+86400000);
 assert.deepEqual(f.calls.map(c=>c.options.method),['GET','GET','GET','POST','PUT','POST','GET','GET']);assert.deepEqual(f.events.map(e=>e.phase),['begin','before-write','write-acknowledged','before-write','write-acknowledged','before-write','write-acknowledged','verified-deny-all']);
 for(const c of f.calls){assert.equal(new URL(c.url).origin,'https://api.cloudflare.com');assert.ok(c.url.includes('/accounts/1988481e4c75c760516161104b7e1e50/'));assert.equal(c.options.redirect,'error');assert.equal(c.options.credentials,'omit');assert.ok(!c.url.includes('/query'));}
 assert.ok(!JSON.stringify({r,events:f.events}).includes(token));assert.equal((await provisionFixedPilot(f.args)).status,'blocked-before-write');assert.equal(f.calls.length,8);
});
test('FAKE disabled/wrong plan, missing/stale/paid observation block before I/O or claim',async()=>{
 for(const mutate of [a=>{a.plan.enabled=false;},a=>{a.plan.accountId='09d455fa1cf988b0d9db89987b73eaff';},a=>{a.plan.allowSql=true;},a=>{a.plan.extra=true;},a=>{a.freeObservation=null;},a=>{a.freeObservation.observedAtMs=clock-3600001;},a=>{a.freeObservation.plan='paid';},a=>{a.freeObservation.monthlyBaseUSD=5;},a=>{a.freeObservation.accountId='bad';},a=>{a.freeObservation.operatorObservationOnly=false;}]){const f=fixture();mutate(f.args);assert.equal((await provisionFixedPilot(f.args)).status,'blocked-before-write');assert.equal(f.calls.length,0);assert.equal(f.events.length,0);}
});
test('FAKE existing resources, denied preflight and journal refusal never produce writes',async()=>{
 for(const options of [{beginResult:false},{failCall:1},{mutateResponse:(r,n)=>n===2?[{id:'existing'}]:r}]){const f=fixture(options),r=await provisionFixedPilot(f.args);assert.equal(r.status,'blocked-before-write');assert.equal(r.writeAttempts,0);assert.ok(f.calls.every(c=>c.options.method==='GET'));}
});
test('FAKE unknown write acknowledgement stops without retry/rollback and preserves partial inventory',async()=>{
 for(const n of [4,5,6]){const f=fixture({throwCall:n}),r=await provisionFixedPilot(f.args);assert.equal(r.status,'unknown-stop');assert.equal(r.writeAttempts,n-3);assert.equal(f.calls.length,n);assert.equal(r.retryAllowed,false);assert.equal(r.inventory[0].name,plan().databaseName);if(n>4)assert.equal(r.inventory[0].uuid,dbUuid);if(n>4)assert.equal(r.inventory[1].name,plan().workerName);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!f.calls.some(c=>c.options.method==='DELETE'));}
});
test('FAKE timeout and malformed write ACK are unknown, never automatic repeat',async()=>{
 for(const options of [{timeoutCall:4},{mutateResponse:(r,n)=>n===4?{uuid:'malformed',name:plan().databaseName}:r},{failCall:5}]){const f=fixture(options),r=await provisionFixedPilot(f.args);assert.equal(r.status,'unknown-stop');assert.equal(r.retryAllowed,false);assert.ok(f.calls.length<=5);}
});
test('FAKE journal loss before next write stops with prior resource receipt, no next operation',async()=>{
 const f=fixture({journalFailAt:4}),r=await provisionFixedPilot(f.args);assert.equal(r.status,'unknown-stop');assert.equal(r.writeAttempts,1);assert.equal(r.inventory[0].uuid,dbUuid);assert.equal(f.calls.length,4);
});
test('FAKE public URL or binding verification failure never claims complete or deletes resources',async()=>{
 for(const mutateResponse of [(r,n)=>n===7?{enabled:true,previews_enabled:false}:r,(r,n)=>n===8?{bindings:[]}:r]){const f=fixture({mutateResponse}),r=await provisionFixedPilot(f.args);assert.equal(r.status,'unknown-stop');assert.equal(r.writeAttempts,3);assert.equal(r.inventory[0].uuid,dbUuid);assert.ok(!f.calls.some(c=>c.options.method==='DELETE'));}
});

test('FAKE pagination ambiguity and observation expiring during durable journal block before writes',async()=>{
 const f=fixture();f.args.fetchImpl=async()=>Response.json({success:true,errors:[],messages:[],result:[],result_info:{cursors:{after:'more'}}});const r=await provisionFixedPilot(f.args);assert.equal(r.status,'blocked-before-write');assert.equal(r.writeAttempts,0);
 const g=fixture();let time=clock;g.args.now=()=>time;g.args.journal.record=async()=>{time=clock+3600001;return true;};const expired=await provisionFixedPilot(g.args);assert.equal(expired.status,'blocked-before-write');assert.equal(expired.writeAttempts,0);assert.equal(g.calls.length,3);
});

test('FAKE invalid clock and unexpected lateral pagination fail closed',async()=>{
 const f=fixture();f.args.now=()=>NaN;assert.equal((await provisionFixedPilot(f.args)).status,'blocked-before-write');assert.equal(f.calls.length,0);
 const g=fixture();g.args.fetchImpl=async()=>Response.json({success:true,errors:[],messages:[],result:[],next:'cursor-not-allowed'});assert.equal((await provisionFixedPilot(g.args)).status,'blocked-before-write');
 const h=fixture();const original=h.args.fetchImpl;h.args.fetchImpl=async(...args)=>{const response=await original(...args);if(h.calls.length===4){const envelope=await response.json();envelope.result_info={page:1};return Response.json(envelope);}return response;};const r=await provisionFixedPilot(h.args);assert.equal(r.status,'unknown-stop');assert.equal(h.calls.length,4);
});
