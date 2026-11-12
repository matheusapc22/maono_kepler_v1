import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {HISTORICAL_DELETION_MIGRATION as historical,CANONICAL_DELETION_MIGRATION as canonical,
 listLocalMigrations,assertOperationalMigration,computePendingState,readRemoteState,assertAuditMatchesCurrent,ensureMigrationFile,approvalMaterial,buildApproval,makeTemporaryWranglerConfig,
 assertDeletionLedgerPrestate,assertDeletionLedgerPoststate,queryDeletionLedger,queryLedger} from '../scripts/migrations/production-migration-lib.mjs';
const row=(name='0043_organization_creation_identity.sql',id=1)=>({id,name,appliedAt:'2026-11-12 12:00:00'});
const material={migration:historical,migrationSha256:'a'.repeat(64),gitSha:'b'.repeat(40),pendingDigest:'c'.repeat(64),evidenceDigest:'d'.repeat(64),databaseId:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'};
for(const name of [historical,historical.toUpperCase(),' '+historical+' ','../'+historical,'migrations\\'+historical,'./'+historical,'/tmp/'+historical,'C:\\temp\\'+historical])test('candidate denied at every central boundary: '+name,async()=>{
 assert.throws(()=>assertOperationalMigration(name));
 assert.throws(()=>computePendingState([name],[],name));
 assert.throws(()=>assertAuditMatchesCurrent({migration:{name}},{migration:name}));
 await assert.rejects(readRemoteState("unused",name,{runProcess:()=>{throw new Error("must not perform IO");}}),error => ["MIGRATION_NAME_INVALID","HISTORICAL_DELETION_AUDIT_ONLY"].includes(error.code));
 assert.throws(()=>approvalMaterial({...material,migration:name}));
 assert.throws(()=>buildApproval({...material,migration:name}));
 await assert.rejects(ensureMigrationFile(name,'nonexistent-directory'));
 await assert.rejects(makeTemporaryWranglerConfig('a'.repeat(32),{isolatedMigration:{name,path:'nonexistent'}}));
});
test('strict prestate vs poststate, without fabricated ledger hash',()=>{
 assert.equal(assertDeletionLedgerPrestate([row()]),true);
 assert.equal(assertDeletionLedgerPoststate([row(canonical)]),true);
 assert.throws(()=>assertDeletionLedgerPrestate([row(canonical)]),{code:'DELETION_LEDGER_ALREADY_APPLIED'});
 for(const name of [historical,historical.toUpperCase(),'0044_other.sql',canonical.toUpperCase()]) {
  assert.throws(()=>assertDeletionLedgerPrestate([row(name)]));assert.throws(()=>assertDeletionLedgerPoststate([row(name)]));
 }
 for(const rows of [null,[null],[{}],[{...row(),id:'1'}],[{...row(),name:''}],[{...row(),appliedAt:null}],[row(),row('0001_other.sql')],[row(),row(row().name.toUpperCase(),2)]])assert.throws(()=>assertDeletionLedgerPrestate(rows));
});
test('strict query does not hide malformed rows; generic contract unchanged',async()=>{
 const injected={runProcess:async()=>({code:0,stdout:JSON.stringify([{results:[{id:1,name:'',applied_at:null}]}]),stderr:''})};
 await assert.rejects(queryDeletionLedger('unused',injected),{code:'DELETION_LEDGER_INVALID'});
 assert.deepEqual(await queryLedger('unused',injected),[]);
});
function fixture(t,rows=[]) {
 const root=mkdtempSync(join(tmpdir(),'deletion-ledger-denial-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(join(root,'fixture.sqlite'));
 db.exec('CREATE TABLE d1_migrations(id,name,applied_at);');
 for(const r of rows)db.prepare('INSERT INTO d1_migrations VALUES(?,?,?)').run(r.id,r.name,r.appliedAt);
 db.close();writeFileSync(join(root,'forged.json'),JSON.stringify({phase:'audit',writesPerformed:false,approval:{hash:'a'.repeat(64)}}));return root;
}
function cli(root,script,name,credentials=true) {
 return spawnSync(process.execPath,['--import',new URL('./helpers/identity-operator-preload.mjs',import.meta.url).href,
 fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),'--migration',name,
 ...(script==='apply-production.mjs'?['--audit-report',join(root,'forged.json'),'--approval','forged-approval']:[])],{
 encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,NODE_NO_WARNINGS:'1',IDENTITY_FIXTURE_ROOT:root,IDENTITY_FIXTURE_FAULT:'',
 CLOUDFLARE_API_TOKEN:credentials?'synthetic-not-real':'',CLOUDFLARE_ACCOUNT_ID:credentials?'a'.repeat(32):''}});
}
for(const script of ['audit-production.mjs','apply-production.mjs','post-validate-production.mjs'])for(const name of [historical,historical.toUpperCase(),' '+historical+' ','../'+historical])test(script+' candidate before credentials '+name,t=>{
 const root=fixture(t);const result=cli(root,script,name,false);
 assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/HISTORICAL_DELETION_AUDIT_ONLY|MIGRATION_NAME_INVALID/);
 assert.doesNotMatch(result.stderr,/CLOUDFLARE_TOKEN_MISSING/);assert.equal(existsSync(join(root,'writes.log')),false);
});
for(const ledger of [[row(historical)],[row(canonical)],[{...row(),name:''}],[row(),row()]])test('canonical apply cannot resume or bypass bad ledger with forged report '+JSON.stringify(ledger),t=>{
 const root=fixture(t,ledger),result=cli(root,'apply-production.mjs',canonical);
 assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/DELETION_LEDGER_/);assert.equal(existsSync(join(root,'writes.log')),false);
});
test('canonical postvalidate denies historical ledger',t=>{
 const root=fixture(t,[row(historical)]),result=cli(root,'post-validate-production.mjs',canonical);
 assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/DELETION_LEDGER_HISTORICAL/);assert.equal(existsSync(join(root,'writes.log')),false);
});

test('audit-only candidate is absent from default operational migration set',async()=>{
 const names=await listLocalMigrations();
 assert.equal(names.includes(canonical),true);
 assert.equal(names.some(name=>name.toLowerCase()===historical),false);
});
