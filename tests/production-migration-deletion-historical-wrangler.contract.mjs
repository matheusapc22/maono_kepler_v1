// Explicit opt-in contract: actual pinned CLI/local D1; loopback is transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {DELETION_SCHEMA_QUERIES} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
import {sha256Text} from '../scripts/migrations/production-migration-lib.mjs';
import {lifecycleDigest,reconcileHistoricalLocalOutcome} from '../scripts/migrations/organization-deletion-historical-lifecycle.mjs';
import {fixtureSql,fixtureSnapshot,openHistoricalFixture} from './helpers/deletion-historical-fixture.mjs';
import {renderHistoricalExecution,HISTORICAL_EXECUTION_QUERIES,historicalWranglerRequest} from '../scripts/migrations/organization-deletion-historical-execution.mjs';
const pkg=resolve(process.env.IDENTITY_WRANGLER_PACKAGE||'.tmp/wrangler-0043/node_modules/wrangler');
assert.equal(JSON.parse(readFileSync(join(pkg,'package.json'))).version,'4.140.0');
const require=createRequire(join(pkg,'package.json'));
assert.equal(require('miniflare/package.json').version,'5.20260923.0-alpha');
assert.equal(require('workerd/package.json').version,'1.20260923.1');
const source=readFileSync(new URL('../scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const ledger='CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);';
const migration='0044_organization_permanent_deletion_historical.sql';
function setup(t){const root=mkdtempSync(join(tmpdir(),'historical-execution-contract-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'migrations'));writeFileSync(join(root,'wrangler.json'),JSON.stringify({name:'synthetic-historical-proof',compatibility_date:'2026-09-23',account_id:'0'.repeat(32),d1_databases:[{binding:'DB',database_name:'synthetic_history',database_id:'00000000-0000-4000-8000-000000000044',migrations_dir:'migrations'}]}));return root;}
async function cli(root,args,extra={}){return await new Promise((res,rej)=>{const p=spawn(process.execPath,[join(pkg,'bin/wrangler.js'),...args,'--config',join(root,'wrangler.json')],{cwd:root,windowsHide:true,env:{...process.env,CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',CI:'true',...extra}});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);const timer=setTimeout(()=>{p.kill();rej(new Error('Bounded CLI timeout'));},90000);p.on('error',rej);p.on('close',code=>{clearTimeout(timer);res({code,stdout,stderr});});});}
async function query(root,sql){const r=await cli(root,['d1','execute','synthetic_history','--local','--command',sql,'--json']);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout).map(x=>x.results);}
for(const fault of ['none','late-ledger','timed-payload'])test('real pinned CLI/full fixture/workerd '+fault,{timeout:180000},async t=>{
 const root=setup(t);writeFileSync(join(root,'setup.sql'),fixtureSql+'\n'+ledger+(fault==='late-ledger'?"CREATE TRIGGER synthetic_abort BEFORE INSERT ON d1_migrations BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END;":''));
 let r=await cli(root,['d1','execute','synthetic_history','--local','--file',join(root,'setup.sql')]);assert.equal(r.code,0,r.stderr);
 const [catalog,ledgerRows,indexList,fk,recursive,defer]=await query(root,[HISTORICAL_EXECUTION_QUERIES.catalog,HISTORICAL_EXECUTION_QUERIES.ledger,HISTORICAL_EXECUTION_QUERIES.indexList,'PRAGMA foreign_keys','PRAGMA recursive_triggers','PRAGMA defer_foreign_keys'].join(';'));
 const metadataRows=await query(root,Object.values(DELETION_SCHEMA_QUERIES).join(''));
 const metadata=Object.fromEntries(Object.keys(DELETION_SCHEMA_QUERIES).map((k,i)=>[k,metadataRows[i]]));
 const fullState={catalog,metadata,ledger:ledgerRows.map(r=>({id:r.id,name:r.name,appliedAt:r.applied_at})),pragmas:{...fk[0],...recursive[0],...defer[0]}};
 const execution=renderHistoricalExecution({catalog,ledger:ledgerRows.map(r=>({id:r.id,name:r.name,appliedAt:r.applied_at})),indexList,pragmas:{...fk[0],...recursive[0],...defer[0]},fullSnapshotDigest:lifecycleDigest(fullState)},source);
 writeFileSync(join(root,'migrations',migration),execution.sql);const started=performance.now();
 if(fault==='timed-payload'){writeFileSync(join(root,'request.sql'),historicalWranglerRequest(execution.sql));r=await cli(root,['d1','execute','synthetic_history','--local','--file',join(root,'request.sql'),'--json']);const results=JSON.parse(r.stdout);const engineDurationMs=results.reduce((sum,result)=>{assert.equal(result.success,true);assert.ok(Number.isFinite(result.meta.duration));return sum+result.meta.duration;},0);t.diagnostic(JSON.stringify({engineDurationMs,statementResults:results.length,measurement:'sum of local D1 statement meta.duration, excludes CLI startup; not remote SLA'}));assert.ok(engineDurationMs<30000,'Local statement execution regression budget');}
 else r=await cli(root,['d1','migrations','apply','synthetic_history','--local']);
 assert.equal(r.code,fault==='late-ledger'?1:0,r.stderr);const [tables,rows]=await query(root,"SELECT name FROM sqlite_schema WHERE name='organization_deletions'; SELECT name FROM d1_migrations;");assert.equal(tables.length,fault==='late-ledger'?0:1);assert.equal(rows.length,fault==='late-ledger'?0:1);t.diagnostic(JSON.stringify({bytes:execution.bytes,assertions:execution.assertionCount,elapsedMs:Math.round(performance.now()-started),scope:'local-full-synthetic-fixture'}));
});
test('lost response: one pinned transport request, read-only reconciliation, never replay',{timeout:180000},async t=>{
 const root=setup(t),db=openHistoricalFixture();t.after(()=>db.close());db.exec(ledger);const capture=()=>({catalog:db.prepare(HISTORICAL_EXECUTION_QUERIES.catalog).all(),metadata:fixtureSnapshot(db),ledger:db.prepare('SELECT id,name,applied_at AS appliedAt FROM d1_migrations').all(),pragmas:{foreign_keys:1,recursive_triggers:0,defer_foreign_keys:0}});const before=capture();const execution=renderHistoricalExecution({catalog:db.prepare(HISTORICAL_EXECUTION_QUERIES.catalog).all(),ledger:[],indexList:db.prepare(HISTORICAL_EXECUTION_QUERIES.indexList).all(),pragmas:{foreign_keys:1,recursive_triggers:0,defer_foreign_keys:0},fullSnapshotDigest:lifecycleDigest(before)},source);writeFileSync(join(root,'migrations',migration),execution.sql);
 let applyRequests=0,readRequests=0;
 const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;try{const {sql}=JSON.parse(body);let results=[];
 if(sql.includes('CREATE TABLE organization_deletions')){applyRequests++;assert.equal(sql,historicalWranglerRequest(execution.sql));assert.equal(sha256Text(body),execution.requestBodySha256);db.exec('BEGIN IMMEDIATE');try{db.exec(sql);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}res.destroy();return;}
 if(sql.includes('CREATE TABLE IF NOT EXISTS'))db.exec(sql);else {readRequests++;results=db.prepare(sql).all();}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,result:[{success:true,results,meta:{duration:1}}]}));
 }catch{res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({success:false,errors:[{code:7500,message:'synthetic failure'}]}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const env={CLOUDFLARE_API_TOKEN:'synthetic-invalid-token',CLOUDFLARE_ACCOUNT_ID:'0'.repeat(32),CLOUDFLARE_API_BASE_URL:`http://127.0.0.1:${server.address().port}`};
 const r=await cli(root,['d1','migrations','apply','synthetic_history','--remote'],env);assert.notEqual(r.code,0);assert.equal(applyRequests,1);
 const read=await cli(root,['d1','execute','synthetic_history','--remote','--command',"SELECT name FROM d1_migrations WHERE name='"+migration+"'",'--json'],env);assert.equal(read.code,0,read.stderr);assert.equal(JSON.parse(read.stdout)[0].results.length,1);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='organization_deletions'").get().n,1);assert.equal(applyRequests,1);assert.ok(readRequests>=2);
 const reconciled=reconcileHistoricalLocalOutcome(before,capture(),{quickCheck:'ok',quickCheckOk:true,foreignKeyCheckOk:true,foreignKeyViolations:[]});
 assert.equal(reconciled.outcome,'committed-poststate-observed');assert.equal(reconciled.retryAllowed,false);assert.equal(applyRequests,1);
 // This is only transport uncertainty proof. SQLite supplies the mock transaction;
 // operational reconciliation must independently validate full expected poststate.
});


test('pinned CLI recreates dropped ledger outside failed guarded migration: transport blocked',{timeout:180000},async t=>{
 const root=setup(t);
 // Synthetic precheck observed a valid ledger; a competing writer drops it afterwards.
 await query(root,"CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO d1_migrations(name) VALUES('0001_synthetic.sql');");
 assert.equal((await query(root,'SELECT name FROM d1_migrations'))[0].length,1);
 await query(root,'DROP TABLE d1_migrations;');
 assert.equal((await query(root,"SELECT name FROM sqlite_schema WHERE name='d1_migrations'"))[0].length,0);
 writeFileSync(join(root,'migrations',migration),"CREATE TABLE synthetic_guard(v INTEGER CHECK(v=1)); INSERT INTO synthetic_guard(v) SELECT CASE WHEN (SELECT COUNT(*) FROM d1_migrations WHERE name='0001_synthetic.sql')=1 THEN 1 ELSE 0 END; CREATE TABLE synthetic_candidate(id INTEGER);");
 const result=await cli(root,['d1','migrations','apply','synthetic_history','--local']);
 assert.notEqual(result.code,0);
 const [ledgerTables,rows,candidate]=await query(root,"SELECT name FROM sqlite_schema WHERE name='d1_migrations'; SELECT name FROM d1_migrations; SELECT name FROM sqlite_schema WHERE name IN ('synthetic_guard','synthetic_candidate');");
 assert.equal(ledgerTables.length,1,'init creates ledger despite guarded migration failure');assert.equal(rows.length,0);assert.equal(candidate.length,0,'guarded payload rolled back, but initialization did not');
 t.diagnostic('Real Wrangler 4.140.0/local workerd: ledger absent before apply, present and empty after failed migration. No production or remote endpoint.');
});
