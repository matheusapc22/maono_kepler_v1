import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { restoreTicketRequestSchema } from './helpers/ticket-request-schema-preservation.mjs';
import { withRequestSchema } from '../functions/_lib/request-schema.js';
import { tableExists, getTableColumns } from '../functions/_lib/organizations.js';
import { createTicketCommandDb } from './helpers/ticket-command-db.mjs';
import { fixture } from '../scripts/central-chamados/benchmark-read-paths.mjs';
import { onRequestGet as listRoute } from '../functions/api/organizations/[id]/tickets.js';

test('read scope deduplicates concurrent introspection but preserves owned Sets and unscoped behavior',async t=>{
  const f=await createTicketCommandDb(t), scoped=withRequestSchema(f.env);
  f.statements.length=0;
  const [a,b]=await Promise.all([getTableColumns(scoped,'users'),getTableColumns(scoped,'users')]);
  assert.equal(f.statements.length,2);
  assert.deepEqual(a,b);a.clear();assert.ok(b.has('id'));
  assert.ok((await getTableColumns(scoped,'users')).has('id'));
  await tableExists(scoped,'users');assert.equal(f.statements.length,2);
  await tableExists(f.env,'users');await tableExists(f.env,'users');assert.equal(f.statements.length,4);
});
test('new request scopes observe schema changes and never mutate the shared env',async t=>{
  const f=await createTicketCommandDb(t), keys=Reflect.ownKeys(f.env);
  assert.equal(await tableExists(withRequestSchema(f.env),'synthetic_new'),false);
  f.sqlite.exec('CREATE TABLE synthetic_new(id INTEGER)');
  assert.equal(await tableExists(withRequestSchema(f.env),'synthetic_new'),true);
  assert.deepEqual(Reflect.ownKeys(f.env),keys);
  const other=await createTicketCommandDb(t);
  assert.equal(await tableExists(withRequestSchema(other.env),'synthetic_new'),false);
});
test('failed introspection is retryable within the same request',async()=>{
  let calls=0;
  const env=withRequestSchema({DB:{prepare(){return {bind(){return this;},async first(){if(++calls===1)throw Error('synthetic');return {name:'users'};}};}}});
  await assert.rejects(tableExists(env,'users'),/synthetic/);
  assert.equal(await tableExists(env,'users'),true);assert.equal(calls,2);
});
test('actual HTTP routes still reauthorize revoked tickets on every request',async()=>{
  const f=await fixture(80,true);
  try {
    await f.request('detail','','viewer');
    f.sqlite.exec("UPDATE organization_tickets SET visibility='private' WHERE id=1");
    await assert.rejects(f.request('detail','','viewer'),/Synthetic detail failed: (403|404)/);
    const {data}=await f.request('list','includeUndated=1','viewer');
    assert.equal(data.tickets.some(t=>t.id===1),false);
  } finally {await f.close();}
});
for (const revocation of ['session','membership']) test(`HTTP GET observes ${revocation} revocation after a successful read`,async()=>{
  const f=await fixture(5,false);
  try {
    await f.request('detail','','viewer');
    if(revocation==='session')f.sqlite.exec('DELETE FROM sessions WHERE user_id=3');
    else f.sqlite.exec('DELETE FROM organization_users WHERE user_id=3 AND organization_id=1');
    await assert.rejects(f.request('detail','','viewer'),/Synthetic detail failed: (401|403)/);
  }finally{await f.close();}
});
test('HTTP GET checks required schema again after a prior successful request',async()=>{
  const f=await fixture(5,false);
  try {
    await f.request('list');
    f.sqlite.exec('PRAGMA foreign_keys=OFF; DROP TABLE ticket_events');
    await assert.rejects(f.request('list'),/Synthetic list failed: 503/);
  }finally{await f.close();}
});
test('commands/triage OFF retains legacy import and authorization behavior',async t=>{
  const f=await createTicketCommandDb(t,{commandsEnabled:false,triageEnabled:false,marker:false});
  f.createLegacySource();
  f.sqlite.exec("INSERT INTO tickets(id,organization_id,subject,description,status,priority,category,created_by,active,created_at,updated_at) VALUES(1,1,'Synthetic','Synthetic','open','normal','support',1,1,'2026-01-01','2026-01-01')");
  const cookie=f.sessionCookie(1);
  for(let i=0;i<2;i++) {
    const response=await listRoute({env:f.env,params:{id:'1'},request:new Request('http://synthetic.test/api/organizations/1/tickets',{headers:{cookie}})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).tickets.length,1);
  }
  assert.equal(f.rows('organization_tickets').length,1);
});
test('authorized attachment count agrees between list and detail without exposing internal counts',async()=>{
  const f=await fixture(5,true);
  try{
    for(const profile of ['owner','viewer']){
      const listed=(await f.request('list','includeUndated=1',profile)).data.tickets.find(t=>t.id===1);
      const detail=(await f.request('detail','',profile)).data;
      assert.equal(detail.ticket.attachmentsCount,profile==='owner'?2:1);
      assert.equal(detail.ticket.attachmentsCount,detail.attachments.length);
      assert.equal(detail.ticket.attachmentsCount,listed.attachmentsCount);
      assert.equal(detail.ticket.etag,listed.etag);
      if(profile==='viewer')assert.equal(detail.attachments.some(a=>a.audience==='internal'),false);
    }
  }finally{await f.close();}
});
test('preservation inverse rejects modified schema wrappers and leaves unrelated drift detectable',()=>{
  const path='functions/_lib/organizations.js';
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.throws(()=>restoreTicketRequestSchema(path,source.replace('return new Set(names);','return new Set();')),/exact request-schema edit/);
  const restored=restoreTicketRequestSchema(path,source);
  assert.notEqual(restoreTicketRequestSchema(path,source.replace('export async function requireTable','export async function changedTable')),restored);
});
