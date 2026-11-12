import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,mkdirSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixtureSql} from './helpers/deletion-historical-fixture.mjs';
import {validateHistoricalAudit,historicalObservationHash} from '../scripts/migrations/organization-deletion-historical-operator.mjs';
const name='0044_organization_permanent_deletion_historical.sql';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'historical-operator-offline-'));symlinkSync(fileURLToPath(new URL('../migrations',import.meta.url)),join(root,'migrations'),'junction');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(join(root,'fixture.sqlite'));db.exec(fixtureSql);db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); INSERT INTO d1_migrations VALUES(1,'0001_old.sql','2020-01-01 00:00:00');");db.close();
 const report=join(root,'audit.json'),post=join(root,'post.json');
 function run(script,args=[],fault='',credentials=true,origin=false){return spawnSync(process.execPath,['--import',new URL('./helpers/historical-operator-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../scripts/migrations/'+script,import.meta.url)),'--migration',name,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,HISTORICAL_FIXTURE_ROOT:root,HISTORICAL_FIXTURE_FAULT:fault,NODE_NO_WARNINGS:'1',CLOUDFLARE_API_TOKEN:credentials?'synthetic-not-a-real-token':'',CLOUDFLARE_ACCOUNT_ID:credentials?'a'.repeat(32):'',HISTORICAL_FIXTURE_GITHUB:origin?'1':'',GITHUB_TOKEN:origin?'synthetic-github-token':'',AUDIT_RUN_ID:origin?'33':'',TRUSTED_REPOSITORY_ID:'11',TRUSTED_OWNER_ID:'22',TRUSTED_WORKFLOW_SHA:'b'.repeat(40),TRUSTED_WORKFLOW_REF:'matheusapc22/maono_kepler_v1/.github/workflows/production-d1-migration-operator.yml@refs/heads/main'}});}
 return {root,report,post,run};
}
function audited(t){const f=fixture(t),r=f.run('audit-production.mjs',['--report',f.report]);assert.equal(r.status,0,r.stderr);assert.deepEqual(readdirSync(f.root).filter(n=>n.endsWith('.json')),['audit.json']);return {...f,audit:JSON.parse(readFileSync(f.report,'utf8'))};}
test('actual historical audit is read-only transport-blocked evidence, never authorization',t=>{
 const f=audited(t);assert.equal(f.audit.phase,'historical-audit-transport-blocked');assert.equal(f.audit.readyForAuthorization,false);assert.equal(f.audit.approvalEligible,false);assert.equal(f.audit.transportBlocker.code,'WRANGLER_LEDGER_BOOTSTRAP_RACE');assert.equal(f.audit.approval,undefined);validateHistoricalAudit(f.audit,f.audit.evidenceIdentity);
 assert.doesNotMatch(readFileSync(f.report,'utf8'),/CREATE TABLE|fixture_scope|dflt_value|PRIVATE|Autorizo|applyCommand/);assert.equal(existsSync(join(f.root,'writes.log')),false);
});
for(const credentials of [false,true])for(const supplied of ['none','forged','real-evidence'])test('historical apply is blocked before credentials or any D1 access '+credentials+'/'+supplied,t=>{
 const f=supplied==='real-evidence'?audited(t):fixture(t);const reads=existsSync(join(f.root,'reads.log'))?readFileSync(join(f.root,'reads.log'),'utf8'):'';
 const args=['--report',f.post];if(supplied!=='none'){if(supplied==='forged')writeFileSync(f.report,JSON.stringify({phase:'historical-audit-ready',readyForAuthorization:true,approval:{hash:'a'.repeat(64)}}));args.push('--audit-report',f.report,'--approval',supplied==='real-evidence'?f.audit.evidenceIdentity:'a'.repeat(64));}
 const r=f.run('apply-production.mjs',args,'',credentials);assert.equal(r.status,1);assert.match(r.stderr,/HISTORICAL_TRANSPORT_BLOCKED/);assert.doesNotMatch(r.stderr,/CLOUDFLARE_TOKEN_MISSING/);assert.equal(existsSync(join(f.root,'writes.log')),false);assert.equal(existsSync(join(f.root,'reads.log'))?readFileSync(join(f.root,'reads.log'),'utf8'):'',reads);
 const failed=JSON.parse(readFileSync(f.post+'.failure.json','utf8'));assert.equal(failed.applyStarted,false);assert.equal(failed.writesMayHaveOccurred,false);assert.equal(failed.retryAllowed,false);
});
test('dedicated operator contains no reachable or dormant remote write executor',()=>{const source=readFileSync(new URL('../scripts/migrations/organization-deletion-historical-operator.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/runWranglerApply|isolatedHistoricalConfig|createWranglerConfig/);});
test('fresh bookmark/time do not change read-only evidence identity',t=>{const f=audited(t),path=join(f.root,'audit2.json'),r=f.run('audit-production.mjs',['--report',path]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(readFileSync(path,'utf8')).evidenceIdentity,f.audit.evidenceIdentity);});
test('strict evidence rejects extra/missing fields and forged readiness even with recomputed hash',t=>{const f=audited(t);for(const change of [r=>r.extra='PRIVATE',r=>r.material.extra=true,r=>delete r.integrity,r=>r.material.sourcePins.extra='a'.repeat(64),r=>r.material.evidence.extra=true,r=>r.readyForAuthorization=true,r=>r.approval={hash:r.evidenceIdentity}]){const r=structuredClone(f.audit);change(r);if(r.material)r.evidenceIdentity=historicalObservationHash(r.material);assert.throws(()=>validateHistoricalAudit(r,r.evidenceIdentity));}});
test('post mode refuses unauthenticated evidence before D1 and never applies',t=>{const f=audited(t),reads=readFileSync(join(f.root,'reads.log'),'utf8');const r=f.run('post-validate-production.mjs',['--audit-report',f.report,'--approval',f.audit.evidenceIdentity,'--report',f.post],'',false);assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/CLOUDFLARE_TOKEN_MISSING/);assert.equal(readFileSync(join(f.root,'reads.log'),'utf8'),reads);assert.equal(existsSync(join(f.root,'writes.log')),false);});
test('actual post CLI checks a synthetic already-applied state with authenticated blocked-audit evidence and zero writes',t=>{
 const f=audited(t);const db=new DatabaseSync(join(f.root,'fixture.sqlite'));db.exec(readFileSync(new URL('../scripts/migrations/candidates/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n'));db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run(name,'2026-11-12 00:00:00');db.close();
 const fixed=join(f.root,'.tmp','production-migrations','original-audit.json');mkdirSync(join(f.root,'.tmp','production-migrations'),{recursive:true});writeFileSync(fixed,readFileSync(f.report),{flag:'wx'});
 const path=join(f.root,'verified.json');const r=f.run('post-validate-production.mjs',['--audit-report',fixed,'--approval',f.audit.evidenceIdentity,'--report',path],'',true,true);assert.equal(r.status,0,r.stderr);
 const post=JSON.parse(readFileSync(path,'utf8'));assert.equal(post.writesPerformed,false);assert.equal(post.provenance.artifactAuthenticityVerified,true);assert.equal(post.provenance.writeAuthorization,false);assert.equal(post.backup.source,'original-audit');assert.ok(post.currentBookmark.bookmark);assert.equal(existsSync(join(f.root,'writes.log')),false);
});
for(const stage of ['D1_INFO','DELETION_OBJECTS','D1_FOREIGN_KEY_CHECK'])test('historical failed reads emit only sanitized evidence: '+stage,t=>{const f=fixture(t),r=f.run('audit-production.mjs',['--report',f.report],'read-failure:'+stage);assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/PRIVATE|Bearer|SELECT|private\.example|synthetic-not-a-real-token/);const failed=JSON.parse(readFileSync(f.report+'.failure.json','utf8'));assert.equal(failed.applyStarted,false);assert.equal(failed.retryAllowed,false);assert.equal(existsSync(join(f.root,'writes.log')),false);});
