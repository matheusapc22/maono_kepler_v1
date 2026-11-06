// Real pinned Wrangler transport, synthetic loopback API, SQLite rollback model.
// This verifies what the actual CLI sends; it is NOT a remote D1 acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess, runWranglerJson, runWranglerApply, WRANGLER_VERSION, sha256Text } from '../scripts/migrations/production-migration-lib.mjs';
import { IDENTITY_MIGRATION, IDENTITY_SNAPSHOT_SQL, validateIdentitySnapshot, guardedIdentityMigration } from '../scripts/migrations/organization-identity-0043.mjs';
const packageDir=resolve(process.env.IDENTITY_WRANGLER_PACKAGE || '.tmp/wrangler-0043/node_modules/wrangler');
assert.equal(JSON.parse(readFileSync(join(packageDir,'package.json'),'utf8')).version,WRANGLER_VERSION);

for(const fault of ['none','inventory-drift','late-ledger-failure'])test('Wrangler '+WRANGLER_VERSION+' one atomic migration payload: '+fault,async t=>{
  const inherited=process.env.WRANGLER_WRITE_LOGS;
  process.env.WRANGLER_WRITE_LOGS='true';
  t.after(()=>{if(inherited===undefined)delete process.env.WRANGLER_WRITE_LOGS;else process.env.WRANGLER_WRITE_LOGS=inherited;});
  const root=mkdtempSync(join(tmpdir(),'wrangler-0043-offline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);');
  for(const name of ['0007_create_organization_limit_requests.sql','0016_map_panel_navigation_and_quota.sql','0042_organization_management.sql'])db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  db.exec("INSERT INTO organizations(name,slug,dropbox_root_path) VALUES('PRIVATE offline é','synthetic','/synthetic')");
  const execution=guardedIdentityMigration(validateIdentitySnapshot(db.prepare(IDENTITY_SNAPSHOT_SQL).get(),'pre'));
  mkdirSync(join(root,'migrations'));writeFileSync(join(root,'migrations',IDENTITY_MIGRATION),execution.sql);
  const databaseId='00000000-0000-4000-8000-000000000043';const accountId='0'.repeat(32);
  const configPath=join(root,'wrangler.json');
  writeFileSync(configPath,JSON.stringify({name:'offline-identity-test',compatibility_date:'2026-09-26',account_id:accountId,
    d1_databases:[{binding:'DB',database_name:'offline_identity_test',database_id:databaseId,migrations_dir:'migrations'}]}));
  const batches=[];const failures=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    try {
      assert.equal(req.method,'POST');assert.equal(req.url,`/accounts/${accountId}/d1/database/${databaseId}/query`);
      const {sql}=JSON.parse(text);assert.equal(typeof sql,'string');let rows=[];
      if(sql.includes('ALTER TABLE organizations ADD COLUMN canonical_name')){
        batches.push(sql);
        if(fault==='inventory-drift')db.exec("UPDATE organizations SET name='Changed after audit' WHERE id=1");
        if(fault==='late-ledger-failure')db.exec("CREATE TRIGGER synthetic_ledger_failure BEFORE INSERT ON d1_migrations BEGIN SELECT RAISE(ABORT,'synthetic failure after DDL'); END");
        db.exec('BEGIN IMMEDIATE');try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      } else if(sql===IDENTITY_SNAPSHOT_SQL)rows=[db.prepare(sql).get()];
      else if(/CREATE TABLE IF NOT EXISTS/.test(sql))db.exec(sql);
      else {assert.match(sql,/SELECT \*\s+FROM "d1_migrations"/);rows=db.prepare(sql).all();}
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,result:[{success:true,results:rows,meta:{duration:1}}]}));
    } catch(error){failures.push(error.message);res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({success:false,errors:[{code:7500,message:'synthetic SQL failure'}]}));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const logPath=join(root,'wrangler.log');
  // Exercise the production library's env merge, replacing only the launcher
  // and database name for the pinned package and synthetic loopback fixture.
  const cli={runProcess:async(command,args,options)=>{
    assert.equal(command,'npx');assert.deepEqual(args.slice(0,2),['--yes',`wrangler@${WRANGLER_VERSION}`]);
    assert.equal(options.env.WRANGLER_WRITE_LOGS,'false');
    return await runProcess(process.execPath,[join(packageDir,'bin/wrangler.js'),...args.slice(2).map(a=>a==='maono_maps'?'offline_identity_test':a)],{
      ...options,cwd:root,env:{CLOUDFLARE_API_TOKEN:'synthetic-token-not-valid',CLOUDFLARE_ACCOUNT_ID:accountId,
        CLOUDFLARE_API_BASE_URL:`http://127.0.0.1:${server.address().port}`,WRANGLER_LOG_PATH:logPath,
        XDG_CONFIG_HOME:root,...options.env}});
  }};
  const read=await runWranglerJson(['d1','execute','offline_identity_test','--remote','--command',IDENTITY_SNAPSHOT_SQL],configPath,cli);
  assert.ok(JSON.stringify(read).includes('PRIVATE offline é'));
  assert.equal(existsSync(logPath),false,'Sensitive snapshot must not create a Wrangler disk log');
  let error;
  try{await runWranglerApply(configPath,cli);}catch(e){error=e;}
  const logFiles=readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.log'));
  for(const file of logFiles) {
    const contents=readFileSync(join(root,file),'utf8');
    for(const value of ['PRIVATE offline é','synthetic','/synthetic']) {
      assert.equal(contents.includes(value),false);assert.equal(contents.includes(Buffer.from(value).toString('hex')),false);
    }
  }
  assert.deepEqual(logFiles,[],'No disk log even when inherited WRANGLER_WRITE_LOGS=true or apply fails');
  assert.equal(batches.length,1,JSON.stringify({failures,error:error?.details?.stderr}));
  assert.equal(batches[0],execution.sql+`\nINSERT INTO "d1_migrations" (name)\nvalues ('${IDENTITY_MIGRATION}');`);
  assert.equal(sha256Text(batches[0]),execution.requestSha256);
  assert.equal(Boolean(error),fault!=='none');
  assert.equal(Boolean(db.prepare("SELECT 1 FROM pragma_table_info('organizations') WHERE name='canonical_name'").get()),fault==='none');
  assert.equal(Boolean(db.prepare('SELECT 1 FROM d1_migrations WHERE name=?').get(IDENTITY_MIGRATION)),fault==='none');
});
