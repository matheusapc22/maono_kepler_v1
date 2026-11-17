import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fixtureSql} from './helpers/deletion-historical-fixture.mjs';
import {DELETION_SCHEMA_QUERIES,evaluateDeletionSchema} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
import {evaluateHistoricalOperation} from '../scripts/migrations/deletion-historical-operation.mjs';
import {HISTORICAL_DELETION_MIGRATION as name,listLocalMigrations,ensureMigrationFile,assertDeletionLedgerPoststate,assertDeletionLedgerPrestate,approvalMaterial,buildApproval,assertApprovalToken,sha256Text} from '../scripts/migrations/production-migration-lib.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const snap=db=>Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]));
const evidence=db=>{const snapshot=snap(db);return {snapshot,snapshotDigests:Array(2).fill(evaluateDeletionSchema(snapshot).metadataDigest)};};
const context={integrity:{quickCheck:'ok',quickCheckOk:true,foreignKeyCheckOk:true,foreignKeyViolations:[]},ledger:[],gitSha:'a'.repeat(40),pendingDigest:'b'.repeat(64)};
const row={id:44,name,appliedAt:'2026-11-16 12:00:00'};
function db(t){const d=new DatabaseSync(':memory:');t.after(()=>d.close());d.exec(fixtureSql);d.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');return d;}
test('explicit historical operation accepts reviewed prestate, installs exact poststate',t=>{
 const d=db(t),before=evaluateHistoricalOperation(evidence(d),context);assert.equal(before.compatible,true);
 d.exec(read('scripts/migrations/candidates/'+name));
 const after=evaluateHistoricalOperation(evidence(d),{...context,ledger:[row]},'post');assert.equal(after.guards,'verified-installed');assert.notEqual(after.digest,before.digest);
 assert.throws(()=>evaluateHistoricalOperation(evidence(d),context));
});
test('historical stays outside generic discovery but explicit file has pinned hash',async()=>{
 assert.equal((await listLocalMigrations()).includes(name),false);
 assert.equal((await ensureMigrationFile(name)).sha256,'b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa');
});
test('ledger profiles mutually exclusive; no reapply',()=>{
 assert.equal(assertDeletionLedgerPoststate([row],name),true);
 assert.throws(()=>assertDeletionLedgerPoststate([row]));
 assert.throws(()=>assertDeletionLedgerPrestate([row],name));
 assert.throws(()=>assertDeletionLedgerPoststate([{...row,name:'0044_organization_permanent_deletion.sql'}],name));
});
for(const change of ['missing guard','modified guard','extra table'])test('poststate rejects '+change,t=>{
 const d=db(t);d.exec(read('scripts/migrations/candidates/'+name));
 if(change==='missing guard')d.exec('DROP TRIGGER org_delete_guard_tickets_insert;');
 if(change==='modified guard')d.exec("DROP TRIGGER org_delete_guard_tickets_insert; CREATE TRIGGER org_delete_guard_tickets_insert BEFORE INSERT ON tickets BEGIN SELECT 1; END;");
 if(change==='extra table')d.exec('CREATE TABLE unexpected(id INTEGER);');
 assert.throws(()=>evaluateHistoricalOperation(evidence(d),{...context,ledger:[row]},'post'));
});
test('no fallback canonical or changed snapshot',t=>{
 const d=db(t),e=evidence(d);e.snapshotDigests[0]='0'.repeat(64);assert.throws(()=>evaluateHistoricalOperation(e,context));
 const canonical=new DatabaseSync(':memory:');t.after(()=>canonical.close());canonical.exec(read('schema.sql').split('-- Organization permanent deletion (migration 0044)')[0]);assert.throws(()=>evaluateHistoricalOperation(evidence(canonical),context));
});

test('poststate binds approved raw prestate, not merely safe default class',t=>{
 const d=db(t),before=evaluateHistoricalOperation(evidence(d),context);
 d.exec(read('scripts/migrations/candidates/'+name));
 assert.throws(()=>evaluateHistoricalOperation(evidence(d),{...context,ledger:[row],expectedPreMetadataDigest:'f'.repeat(64)},'post'),{code:'HISTORICAL_POST_PRESTATE_DRIFT'});
 assert.equal(evaluateHistoricalOperation(evidence(d),{...context,ledger:[row],expectedPreMetadataDigest:before.preMetadataDigest},'post').compatible,true);
});

test('historical approval requires metadata binding and binds filename',()=>{
 const m={migration:name,migrationSha256:'a'.repeat(64),gitSha:'b'.repeat(40),pendingDigest:'c'.repeat(64),databaseId:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'};
 assert.throws(()=>approvalMaterial(m),{code:'DELETION_EVIDENCE_REQUIRED'});
 const material=approvalMaterial({...m,evidenceDigest:'d'.repeat(64)});assert.ok(material.includes(name));assert.ok(material.includes('evidenceDigest='));
});
test('reviewed runtime pin revision invalidates previous evidence and approval token',t=>{
 const current=evaluateHistoricalOperation(evidence(db(t)),context);
 // Reconstruct the previous binding with identical DB/Git/candidate inputs:
 // changing only reviewed contract/runtime identity must invalidate authorization.
 const oldBinding=Object.fromEntries(['profile','phase','migration','candidateSha256','contractSha256','sourceDigest','metadataDigest','ledgerDigest','gitSha','pendingDigest'].map(k=>[k,current[k]]));
 oldBinding.contractSha256='6b4381bbcd2480d392dc513f4ba1ab0d0b21c4b3560f53bf3193d959cfbd9e04';
 oldBinding.sourceDigest='5a00c916b961ee4a8f44ff8349bc103b8850fedb5ca0df83515ca57d562daf95';
 const previousDigest=sha256Text(JSON.stringify(oldBinding));assert.notEqual(current.digest,previousDigest);
 const args={migration:name,migrationSha256:current.candidateSha256,gitSha:context.gitSha,pendingDigest:context.pendingDigest};
 const old=buildApproval({...args,evidenceDigest:previousDigest}),fresh=buildApproval({...args,evidenceDigest:current.digest});
 assert.notEqual(old.token,fresh.token);
 assert.throws(()=>assertApprovalToken(old.token,fresh.token),{code:'PRODUCTION_AUTHORIZATION_MISMATCH'});
 assert.equal(current.candidateSha256,'b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa');
});
