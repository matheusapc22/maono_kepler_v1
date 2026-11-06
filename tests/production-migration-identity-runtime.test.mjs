import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { persistenceFixture } from './helpers/project-persistence-fixture.mjs';
import { onRequest } from '../functions/api/admin/organization-management/[[path]].js';
const sql=readFileSync(new URL('../migrations/0043_organization_creation_identity.sql',import.meta.url),'utf8');

for(const stage of ['0042','0043'])test('unchanged runtime real route/lifecycle works at '+stage,async t=>{
  // Real product route, session, ACL and lifecycle. Only Dropbox is simulated.
  const f=persistenceFixture(t);if(stage==='0043')f.db.exec(sql);
  f.env.ORGANIZATION_MANAGEMENT_V1='true';f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  async function call(path,body,headers={}){
    const request=new Request('https://local.invalid/api/admin/organization-management'+path,{method:body===undefined?'GET':'POST',
      headers:{...f.headers(1),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1',...headers},
      body:body===undefined?undefined:JSON.stringify(body)});
    const result=await onRequest({env:f.env,request});const data=await result.json();assert.equal(result.status,200,JSON.stringify(data));return data;
  }
  await call('/organizations');
  for(const kind of ['create','import']){
    const slug='legacy-'+kind;
    const operation=await call('/operations',{kind,items:[{name:'Old runtime '+kind,slug,description:'Offline',plan:'pro',ownerEmail:'other@offline.invalid'}]},
      {'Idempotency-Key':crypto.randomUUID()});
    const result=await call(`/operations/${operation.id}/step`,{});assert.equal(result.items[0].state,'succeeded',JSON.stringify(result));
    const row=f.db.prepare('SELECT * FROM organizations WHERE slug=?').get(slug);assert.equal(row.management_owner_id,2);assert.equal(row.storage_status,'READY');
    if(stage==='0043')assert.equal(row.canonical_name,null);
    const change=await call('/operations',{kind:'change',items:[{id:row.id,version:row.management_version,name:'Renamed '+kind,reason:'Offline compatibility'}]},
      {'Idempotency-Key':crypto.randomUUID()});
    assert.equal((await call(`/operations/${change.id}/step`,{})).items[0].state,'succeeded');
    await call('/organizations/'+row.id);
  }
});
