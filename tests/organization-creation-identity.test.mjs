import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {persistenceFixture, deferred} from './helpers/project-persistence-fixture.mjs';
import {canonicalOrganizationName, organizationIdentity} from '../functions/_lib/organization-identity.js';
import {createOrganizationLifecycle, updateOrganizationLifecycle} from '../functions/_lib/organization-lifecycle.js';
import {onRequest} from '../functions/api/admin/organization-management/[[path]].js';
import {auditOrganizationIdentities} from '../scripts/migrations/preflight-organization-identity.mjs';
import {createInput, requestHash} from '../functions/_lib/organization-management-contract.js';

function fixture(t,hooks={}) {
  const f=persistenceFixture(t,hooks);
  f.env.ORGANIZATION_MANAGEMENT_V1='true';f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  f.call=async(path,body,key)=>{
    const response=await onRequest({env:f.env,request:new Request(`https://local.invalid/api/admin/organization-management${path}`,{
      method:body===undefined?'GET':'POST',headers:{...f.headers(),Origin:'https://local.invalid','Content-Type':'application/json','X-Maono-Management':'1',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),
    })});return {status:response.status,...await response.json()};
  };
  f.start=(name,key=crypto.randomUUID())=>f.call('/operations',{kind:'create',items:[{name,ownerEmail:'other@offline.invalid',plan:'free'}]},key);
  f.step=op=>f.call(`/operations/${op.id}/step`,{retry:true});return f;
}
test('canonical names retain accents, fold Unicode/case and whitespace without truncation',()=>{
  assert.equal(canonicalOrganizationName('  MÁÕNO\t  Gestão  '),canonicalOrganizationName('máõno gestão'));
  assert.equal(canonicalOrganizationName('Cafe\u0301'),canonicalOrganizationName('CAFÉ'));
  assert.notEqual(canonicalOrganizationName('Café'),canonicalOrganizationName('Cafe'));
  assert.notEqual(canonicalOrganizationName('x'.repeat(100)+'a'),canonicalOrganizationName('x'.repeat(100)+'b'));
});
test('read-only migration preflight reports Unicode names, numeric suffixes and paths without rewriting data',()=>{
  const rows=[{id:1,name:' Cafe\u0301  Azul ',slug:'a-123456789',dropbox_root_path:'/projects/a'},
    {id:2,name:'CAFÉ AZUL',slug:'b-123456789',dropbox_root_path:'/PROJECTS/A'}];
  const before=JSON.stringify(rows),report=auditOrganizationIdentities(rows);
  assert.equal(report.ok,false);assert.deepEqual(report.conflicts.map(c=>c.kind),['name','suffix','path']);
  assert.equal(JSON.stringify(rows),before);assert.equal(JSON.stringify(report).includes('CAFÉ'),false);
});
test('migration preflight rejects missing paths, malformed rows and duplicate inventory IDs',()=>{
  const row={id:1,name:'Synthetic',slug:'synthetic',dropbox_root_path:'/projects/synthetic'};
  assert.deepEqual(auditOrganizationIdentities([row]),{ok:true,organizations:1,conflicts:[]});
  assert.deepEqual(auditOrganizationIdentities([]),{ok:true,organizations:0,conflicts:[]});
  for(const input of [null,{},'inventory',42])assert.throws(()=>auditOrganizationIdentities(input),/Invalid organization inventory/);
  const invalid=[null,[],42,Object.create(row),{id:1,name:'Synthetic',slug:'synthetic'}];
  for(const key of ['id','name','slug','dropbox_root_path']){
    const missing={...row};delete missing[key];invalid.push(missing);
    for(const value of [undefined,null,{},[]])invalid.push({...row,[key]:value});
  }
  for(const id of [0,-1,1.5,'1',NaN,Number.MAX_SAFE_INTEGER+1])invalid.push({...row,id});
  for(const key of ['name','slug','dropbox_root_path'])for(const value of ['', '   ',42])invalid.push({...row,[key]:value});
  for(const invalidRow of invalid)assert.throws(()=>auditOrganizationIdentities([invalidRow]),/Invalid organization inventory/);
  assert.throws(()=>auditOrganizationIdentities([row,{...row,name:'Another',slug:'another',dropbox_root_path:'/projects/another'}]),/Invalid organization inventory/);
  assert.equal(row.dropbox_root_path,'/projects/synthetic');
});
test('crypto identity has exactly nine digits, bounded normalized base and safe fallback',()=>{
  const rng={getRandomValues:array=>{array[0]=42;return array;}};
  for(const name of [' Máõno -- Gestão / ação ', 'Á'.repeat(160), '🌍🧭']){
    const identity=organizationIdentity(name,rng);
    assert.match(identity.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*-000000042$/);assert.ok(identity.slug.length<=64);
  }
  assert.equal(organizationIdentity('🌍',rng).slug,'organizacao-000000042');
});
test('numeric collisions across different bases retry atomically and exhaustion leaves no operation',async t=>{
  const f=fixture(t);f.db.exec("INSERT INTO organizations(name,slug,dropbox_root_path) VALUES('Legacy','legacy-000000042','/projects/legacy-000000042')");
  let draws=0,forced=false;t.mock.method(crypto,'getRandomValues',a=>{a[0]=forced||++draws===1?42:43;return a;});
  const op=await f.start('Different base');assert.equal(op.status,200,JSON.stringify(op));
  assert.equal(f.db.prepare('SELECT suffix FROM organization_creation_identities').get().suffix,'000000043');assert.equal(draws,2);
  const before=f.db.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n;
  forced=true;
  const denied=await f.start('Another base');assert.equal(denied.error.code,'ORGANIZATION_IDENTITY_EXHAUSTED');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,before);
});
test('same idempotency key concurrently reserves one operation and identity and survives lost response',async t=>{
  const f=fixture(t),key=crypto.randomUUID();
  const [a,b]=await Promise.all([f.start('Repeated',key),f.start('Repeated',key)]);assert.equal(a.id,b.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_creation_identities').get().n,1);
  const recovered=await f.call(`/operations/by-key?key=${key}`);assert.equal(recovered.operation.id,a.id);
  const [first,second]=await Promise.all([f.step(a),f.step(b)]);assert.ok([first,second].some(r=>r.items[0].state==='succeeded'));
  const again=await f.start('Repeated',key);assert.equal(again.id,a.id);
  const row=f.db.prepare("SELECT * FROM organizations WHERE name='Repeated'").get();assert.match(row.slug,/-\d{9}$/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organizations WHERE name='Repeated'").get().n,1);
  const detail=await f.call(`/organizations/${row.id}`);assert.equal(detail.creationConfirmed,true);assert.equal(detail.creationOperationId,a.id);
});
test('new individual requests resolve identity on the server even for an old client supplying a slug',async t=>{
  const f=fixture(t);
  const op=await f.call('/operations',{kind:'create',items:[{name:'Automatic',slug:'manual-value',ownerEmail:'other@offline.invalid',plan:'free'}]},crypto.randomUUID());
  const out=await f.step(op);assert.equal(out.items[0].state,'succeeded');
  assert.match(f.db.prepare('SELECT slug FROM organizations WHERE id=?').get(out.items[0].result.id).slug,/^automatic-\d{9}$/);
});
test('an already persisted explicit-slug operation replays its old hash and identity',async t=>{
  const f=fixture(t),id=crypto.randomUUID(),key=crypto.randomUUID();
  const input=createInput({name:'Legacy operation',slug:'legacy-fixed',ownerEmail:'other@offline.invalid',plan:'free'});
  const hash=await requestHash({kind:'create',items:[input]});
  f.db.prepare("INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json) VALUES(?,1,?,?,'create',?)").run(id,key,hash,JSON.stringify([input]));
  f.db.prepare('INSERT INTO organization_management_operation_items(operation_id,item_index) VALUES(?,0)').run(id);
  const replay=await f.call('/operations',{kind:'create',items:[input]},key);assert.equal(replay.id,id);
  const out=await f.step(replay);assert.equal(out.items[0].state,'succeeded');
  assert.equal(f.db.prepare('SELECT slug FROM organizations WHERE id=?').get(out.items[0].result.id).slug,'legacy-fixed');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_creation_identities').get().n,0);
});
test('reservation checks the complete technical path and concurrent suffix claims',async t=>{
  const f=fixture(t);let draws=0;
  f.db.exec("INSERT INTO organizations(name,slug,dropbox_root_path) VALUES('Existing path','legacy-path','/projects/new-000000042')");
  t.mock.method(crypto,'getRandomValues',array=>{array[0]=++draws<=2?42:42+draws;return array;});
  const [a,b]=await Promise.all([f.start('New'),f.start('Different')]);assert.ok(a.id,JSON.stringify(a));assert.ok(b.id,JSON.stringify(b));
  const rows=f.db.prepare('SELECT suffix,path FROM organization_creation_identities').all();
  assert.equal(new Set(rows.map(row=>row.suffix)).size,2);assert.equal(rows.some(row=>row.path==='/projects/new-000000042'),false);
});
test('final confirmation requires the configured owner and plan, not just succeeded item',async t=>{
  const f=fixture(t),op=await f.start('Confirmed');const out=await f.step(op),id=out.items[0].result.id;
  assert.equal((await f.call(`/organizations/${id}`)).creationConfirmed,true);
  f.db.prepare("UPDATE organizations SET plan='pro' WHERE id=?").run(id);
  assert.equal((await f.call(`/organizations/${id}`)).creationConfirmed,false);
  f.db.prepare("UPDATE organizations SET plan='free',management_owner_id=NULL WHERE id=?").run(id);
  assert.equal((await f.call(`/organizations/${id}`)).creationConfirmed,false);
});
test('concurrent canonical names reach the unique constraint after both prevalidations',{timeout:10000},async t=>{
  const barrier=deferred();let reads=0;
  const f=fixture(t);
  const original=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare=sql=>{
    const statement=original(sql);
    if(sql==='SELECT id,name FROM organizations'){
      const all=statement.all.bind(statement);
      statement.all=async()=>{const rows=await all();if(++reads===2)barrier.resolve();await barrier.promise;return rows;};
    }return statement;
  };
  const [a,b]=await Promise.all([f.start('  Empresa  Á '),f.start('empresa á')]);
  assert.ok(a.id,JSON.stringify(a));assert.ok(b.id,JSON.stringify(b));
  const results=await Promise.all([f.step(a),f.step(b)]);
  assert.equal(results.filter(r=>r.items[0].state==='succeeded').length,1,JSON.stringify(results));
  assert.equal(results.filter(r=>r.items[0].code==='ORGANIZATION_NAME_EXISTS').length,1);
});
test('paused historical names and legacy creation/rename cannot bypass canonical checks',async t=>{
  const f=fixture(t);f.db.exec("UPDATE organizations SET name=' Café  Azul ',active=0 WHERE id=1");
  const available=await f.call('/name-availability?name='+encodeURIComponent('CAFÉ azul'));assert.equal(available.available,false);
  await assert.rejects(createOrganizationLifecycle(f.env,{name:'cafe\u0301 azul',slug:'another',active:false}),{code:'ORGANIZATION_NAME_EXISTS'});
  await assert.rejects(updateOrganizationLifecycle(f.env,2,{name:'CAFÉ AZUL'}),{code:'ORGANIZATION_NAME_EXISTS'});
  const imported=await f.call('/import/validate',{csv:'nome,slug,descricao,plano,responsavel_email\nCAFÉ AZUL,csv-name,,free,other@offline.invalid'});assert.equal(imported.valid,false);
});
test('exact active owner lookup is not truncated by partial matches and ineligible owner is rechecked',async t=>{
  const f=fixture(t);
  for(let i=0;i<22;i++)f.db.prepare('INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)').run(`a${i}-other@offline.invalid`,'Other candidate','client','not-a-login');
  const found=await f.call('/candidates?q=other%40offline.invalid&exact=1');assert.deepEqual(found.users.map(u=>u.id),[2]);
  const op=await f.start('Eligibility');f.db.exec('UPDATE users SET active=0 WHERE id=2');
  const out=await f.step(op);assert.equal(out.items[0].code,'ORGANIZATION_OWNER_INELIGIBLE');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organizations WHERE name='Eligibility'").get().n,0);
});
test('owner deactivation during configuration preserves a recoverable original operation',async t=>{
  let once=true;
  const f=fixture(t,{beforeBatch:({db,statements})=>{
    if(once&&statements.some(statement=>statement.sql.includes('INSERT INTO organization_users'))){once=false;db.exec('UPDATE users SET active=0 WHERE id=2');}
  }});
  const op=await f.start('Configuration race');let out=await f.step(op);
  assert.equal(out.items[0].state,'partial');assert.equal(out.items[0].code,'ORGANIZATION_OWNER_INELIGIBLE');assert.equal(out.items[0].retryable,true);
  const id=out.items[0].result.id;out=await f.step(op);assert.equal(out.items[0].state,'partial');assert.equal(out.items[0].result.id,id);
  f.db.exec('UPDATE users SET active=1 WHERE id=2');out=await f.step(op);assert.equal(out.items[0].state,'succeeded');assert.equal(out.items[0].result.id,id);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM organizations WHERE name='Configuration race'").get().n,1);
});
test('reserved suffix is protected from explicit import/legacy identities',async t=>{
  const f=fixture(t),op=await f.start('Reserved');assert.ok(op.id);
  const {suffix}=f.db.prepare('SELECT suffix FROM organization_creation_identities').get();
  await assert.rejects(createOrganizationLifecycle(f.env,{name:'Other',slug:`other-${suffix}`,active:false}),/ORGANIZATION_IDENTITY_COLLISION/);
});
test('migration fails on historical duplicate suffixes without changing old identities',()=>{
  const db=new DatabaseSync(':memory:');try{
    const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8').split('-- Organization creation identity (migration 0043)')[0];db.exec(schema);
    db.exec("INSERT INTO organizations(name,slug,dropbox_root_path) VALUES('A','a-123456789','/projects/a-123456789'),('B','b-123456789','/projects/b-123456789')");
    db.exec('BEGIN');assert.throws(()=>db.exec(readFileSync(new URL('../migrations/0043_organization_creation_identity.sql',import.meta.url),'utf8')),/UNIQUE/);db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM organizations').get().n,2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM pragma_table_info('organizations') WHERE name='canonical_name'").get().n,0);
  }finally{db.close();}
});
