import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fixtureSql} from './helpers/deletion-historical-fixture.mjs';
const migration='0044_organization_permanent_deletion_historical.sql';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'historical-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(join(root,'fixture.sqlite'));db.exec(fixtureSql);db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');db.close();return root;
}
const json=p=>JSON.parse(readFileSync(p,'utf8'));
function cli(root,script,{fault='',token='',report=script+'.json'}={}){
 return spawnSync(process.execPath,['--import',fileURLToPath(new URL('./helpers/historical-operator-preload.mjs',import.meta.url)),fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),
 '--migration',migration,'--report',join(root,report),...(script==='apply-production.mjs'?['--audit-report',join(root,'audit-production.mjs.json'),'--approval',token]:[])],{
 encoding:'utf8',timeout:60000,env:{...process.env,NODE_NO_WARNINGS:'1',IDENTITY_FIXTURE_ROOT:root,IDENTITY_FIXTURE_FAULT:fault,CLOUDFLARE_API_TOKEN:'synthetic-offline-only',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}});
}
function audit(root){const r=cli(root,'audit-production.mjs');assert.equal(r.status,0,r.stderr);return json(join(root,'audit-production.mjs.json'));}
test('historical CLI audit -> exact approval -> isolated apply -> postvalidate offline',t=>{
 const root=fixture(t),a=audit(root);assert.equal(a.schemaPreflight.compatible,true);assert.equal(a.migration.name,migration);assert.equal(existsSync(join(root,'writes.log')),false);
 const r=cli(root,'apply-production.mjs',{token:a.approval.token});assert.equal(r.status,0,r.stderr);
 assert.equal(readFileSync(join(root,'writes.log'),'utf8'),'apply-attempt\n');
 assert.equal(json(join(root,'apply-production.mjs.json')).historicalPostValidation.guards,'verified-installed');
 const p=cli(root,'post-validate-production.mjs');assert.equal(p.status,0,p.stderr);assert.equal(json(join(root,'post-validate-production.mjs.json')).ok,true);
 const repeat=cli(root,'apply-production.mjs',{token:a.approval.token});assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/DELETION_LEDGER_ALREADY_APPLIED/);assert.equal(readFileSync(join(root,'writes.log'),'utf8'),'apply-attempt\n');
});
for(const fault of ['wrong-token','schema-drift','final-drift','alternate-ledger','read-failure:DELETION_COLUMNS'])test('historical CLI prevents writes: '+fault,t=>{
 const root=fixture(t),a=audit(root);
 if(fault==='schema-drift'){const d=new DatabaseSync(join(root,'fixture.sqlite'));d.exec('CREATE TABLE unreviewed(id INTEGER);');d.close();}
 if(fault==='alternate-ledger'){const d=new DatabaseSync(join(root,'fixture.sqlite'));d.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run('0044_organization_permanent_deletion.sql','2026-11-16 12:00:00');d.close();}
 const r=cli(root,'apply-production.mjs',{token:fault==='wrong-token'?'forged':a.approval.token,fault});assert.notEqual(r.status,0,r.stdout);
 assert.equal(existsSync(join(root,'writes.log')),false);assert.doesNotMatch(r.stderr,/PRIVATE_TOKEN|PRIVATE_SECRET|ReferenceError/);
});
test('historical CLI missing post guard reports incomplete after write',t=>{
 const root=fixture(t),a=audit(root),r=cli(root,'apply-production.mjs',{token:a.approval.token,fault:'post-schema'});
 assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,/HISTORICAL_POSTSTATE_DRIFT/);assert.doesNotMatch(r.stderr,/ReferenceError/);
 const report=json(join(root,'apply-production.mjs.json.failure.json'));assert.equal(report.complete,false);assert.equal(report.applyStarted,true);assert.equal(report.applyCompleted,true);
});
test('historical CLI audit failure retains sanitized evidence',t=>{
 const root=fixture(t),r=cli(root,'audit-production.mjs',{fault:'read-failure:DELETION_COLUMNS'});assert.notEqual(r.status,0);const report=json(join(root,'audit-production.mjs.json.failure.json'));assert.equal(report.writesPerformed,false);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_/);
});
