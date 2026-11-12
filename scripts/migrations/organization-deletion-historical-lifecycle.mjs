// Phase A: local proof only. No remote executor or authorization is exported.
import {readFileSync} from 'node:fs';
import {renderHistoricalExecution} from './organization-deletion-historical-execution.mjs';
import {DatabaseSync} from 'node:sqlite';
import {DELETION_SCHEMA_QUERIES,evaluateDeletionSchema} from './organization-deletion-schema-0044.mjs';
import {evaluateHistoricalDeletionPrestate,historicalDeletionReference} from './deletion-historical-prestate.mjs';
import {sha256Text,assertDeletionLedgerPrestate} from './production-migration-lib.mjs';
export const HISTORICAL_LIFECYCLE_ID='historical-0044-isolated-apply-v1';
export const HISTORICAL_PROFILE_ID='deletion-safety-historical-v1';
export const HISTORICAL_CANDIDATE_PATH='scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql';
export const HISTORICAL_CANDIDATE_NAME='0044_organization_permanent_deletion_historical.sql';
export const HISTORICAL_CANDIDATE_SHA256='b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa';
export const HISTORICAL_CATALOG_QUERY='SELECT rowid,type,name,tbl_name,sql FROM sqlite_schema ORDER BY rowid;';
export const HISTORICAL_LEDGER_QUERY='SELECT id,name,applied_at AS appliedAt FROM d1_migrations ORDER BY id;';
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const lifecycleDigest=x=>sha256Text(JSON.stringify(canonical(x)));
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error('Historical lifecycle local proof blocked.'),{code});};
const identifier=x=>typeof x==='string'&&/^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const equal=(a,b)=>lifecycleDigest(a)===lifecycleDigest(b);
const rows=x=>x.map(canonical).map(JSON.stringify).sort();
const exactKeys=(v,keys)=>v&&Object.keys(v).sort().join()===keys.slice().sort().join();
export function validateLifecycleSnapshot(s){
 need(exactKeys(s,['catalog','metadata','ledger','pragmas']),'LIFECYCLE_SNAPSHOT_SHAPE');
 need(Array.isArray(s.catalog)&&s.catalog.length>0&&s.catalog.length<=20000,'LIFECYCLE_CATALOG_LIMIT');
 const names=new Set(),ids=new Set();
 for(const r of s.catalog){
  need(exactKeys(r,['rowid','type','name','tbl_name','sql'])&&Number.isSafeInteger(r.rowid)&&r.rowid>0&&!ids.has(r.rowid)&&identifier(r.name)&&identifier(r.tbl_name)&&!names.has(r.name.toLowerCase())&&['table','index','trigger','view'].includes(r.type)&&(r.sql===null||typeof r.sql==='string'&&Buffer.byteLength(r.sql)<=200000),'LIFECYCLE_CATALOG_SHAPE');
  names.add(r.name.toLowerCase());ids.add(r.rowid);
  if(r.name.startsWith('sqlite_'))need(r.name==='sqlite_sequence'&&r.type==='table'&&r.sql==='CREATE TABLE sqlite_sequence(name,seq)'||r.name.startsWith('sqlite_autoindex_')&&r.type==='index'&&r.sql===null,'LIFECYCLE_UNKNOWN_INTERNAL');
 }
 need(s.catalog.every((r,i)=>!i||s.catalog[i-1].rowid<r.rowid),'LIFECYCLE_CATALOG_ORDER');
 need(exactKeys(s.pragmas,['foreign_keys','recursive_triggers','defer_foreign_keys'])&&s.pragmas.foreign_keys===1&&[0,1].includes(s.pragmas.recursive_triggers)&&s.pragmas.defer_foreign_keys===0,'LIFECYCLE_CONNECTION_SETTINGS');
 const report=evaluateDeletionSchema(s.metadata);
 need(hash(report.metadataDigest),'LIFECYCLE_METADATA_INVALID');
 const objects=s.catalog.filter(r=>!r.name.startsWith('sqlite_')).map(({rowid,...r})=>r);
 need(equal(rows(objects),rows(s.metadata.objects)),'LIFECYCLE_CATALOG_METADATA_MISMATCH');
 for(const r of s.catalog.filter(r=>r.name.startsWith('sqlite_autoindex_')))need(s.metadata.indexes.some(i=>i.index_name===r.name&&i.table_name===r.tbl_name),'LIFECYCLE_AUTO_INDEX_MISMATCH');
 need(Array.isArray(s.ledger)&&s.ledger.every(r=>exactKeys(r,['id','name','appliedAt'])),'LIFECYCLE_LEDGER_SHAPE');
 return {catalogDigest:lifecycleDigest(s.catalog),metadataDigest:report.metadataDigest,ledgerDigest:lifecycleDigest(s.ledger),connectionDigest:lifecycleDigest(s.pragmas),fullSnapshotDigest:lifecycleDigest(s)};
}
export function minimizedMigrationEvidence(ledger,localFiles){
 assertDeletionLedgerPrestate(ledger);
 need(Array.isArray(localFiles)&&localFiles.length<=10000,'LIFECYCLE_FILES_INVALID');
 const seen=new Set();
 const files=localFiles.map(f=>{need(exactKeys(f,['name','sha256'])&&/^[0-9]{4}_[A-Za-z0-9_]+\.sql$/.test(f.name)&&hash(f.sha256)&&!seen.has(f.name.toLowerCase()),'LIFECYCLE_FILES_INVALID');seen.add(f.name.toLowerCase());return {...f};}).sort((a,b)=>a.name.localeCompare(b.name));
 need(files.every(f=>!f.name.toLowerCase().startsWith('0044_')||[HISTORICAL_CANDIDATE_NAME,'0044_organization_permanent_deletion.sql'].includes(f.name)),'LIFECYCLE_UNKNOWN_ALTERNATIVE');
 need(files.some(f=>f.name===HISTORICAL_CANDIDATE_NAME&&f.sha256===HISTORICAL_CANDIDATE_SHA256),'LIFECYCLE_CANDIDATE_MISSING');
 const evidence=ledger.map(r=>({...r,sourceChecksum:files.find(f=>f.name===r.name)?.sha256||null,sourceChecksumUnavailable:!files.some(f=>f.name===r.name)}));
 const pending=files.filter(f=>!ledger.some(r=>r.name===f.name)).map(f=>({...f,selection:f.name===HISTORICAL_CANDIDATE_NAME?'selected':f.name==='0044_organization_permanent_deletion.sql'?'excluded-mutually-exclusive-alternative':'not-selected'}));
 return {ledger:evidence,ledgerDigest:lifecycleDigest(ledger),pending,pendingDigest:lifecycleDigest(pending),persistedChecksumAvailable:false};
}
export function buildHistoricalLocalEvidence(snapshot,context){
 const digests=validateLifecycleSnapshot(snapshot);assertDeletionLedgerPrestate(snapshot.ledger);
 const files=minimizedMigrationEvidence(snapshot.ledger,context.localFiles);
 need(exactKeys(context.database,['name','uuid'])&&context.database?.name==='maono_maps'&&context.database?.uuid==='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db','LIFECYCLE_DATABASE');
 need(Array.isArray(context.fullSnapshotDigests)&&context.fullSnapshotDigests.length===2&&context.fullSnapshotDigests.every(x=>x===digests.fullSnapshotDigest),'LIFECYCLE_SNAPSHOT_DRIFT');
 const supplement=evaluateHistoricalDeletionPrestate(snapshot.metadata,{...context,ledger:snapshot.ledger,pendingDigest:files.pendingDigest,snapshotDigests:[digests.metadataDigest,digests.metadataDigest]});
 need(supplement.status==='matched-prestate','LIFECYCLE_PRESTATE_UNPROVEN');
 return {contractId:HISTORICAL_LIFECYCLE_ID,phase:'local-proof-only',profileId:HISTORICAL_PROFILE_ID,readyForAuthorization:false,approvalEligible:false,compatible:false,gitSha:context.gitSha,database:clone(context.database),sourceDigest:supplement.sourceDigest,contractSha256:supplement.contractSha256,candidate:{name:HISTORICAL_CANDIDATE_NAME,sha256:HISTORICAL_CANDIDATE_SHA256},...digests,migrations:files,atomicObservation:false,operationalAuthorization:false};
}
export function historicalExpectedDelta(){
 historicalDeletionReference();
 const db=new DatabaseSync(':memory:');
 try{
  const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  db.exec(read('tests/fixtures/deletion-historical-safety/schema.sql'));
  const capture=()=>({catalog:db.prepare(HISTORICAL_CATALOG_QUERY).all(),metadata:Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]))});
  const before=capture(),sql=read(HISTORICAL_CANDIDATE_PATH);need(sha256Text(sql)===HISTORICAL_CANDIDATE_SHA256,'LIFECYCLE_SOURCE_DRIFT');db.exec(sql);const after=capture();
  const catalog=after.catalog.filter(r=>!before.catalog.some(b=>b.name===r.name)).map(({rowid,...r})=>r);
  const metadata=Object.fromEntries(Object.keys(DELETION_SCHEMA_QUERIES).map(k=>{const old=new Set(rows(before.metadata[k]));return [k,after.metadata[k].filter(r=>!old.has(JSON.stringify(canonical(r))))];}));
  need(catalog.filter(r=>r.sql!==null).length===150&&catalog.filter(r=>r.type==='trigger').length===147,'LIFECYCLE_DELTA_INVALID');
  return {catalog,metadata,sourceSha256:HISTORICAL_CANDIDATE_SHA256,deltaDigest:lifecycleDigest({catalog,metadata})};
 }finally{db.close();}
}
export function reconcileHistoricalLocalOutcome(before,after,integrity){
 // Read-only classification, never retries. Inputs stay private; result contains no SQL.
 try{
  const beforeDigests=validateLifecycleSnapshot(before);validateLifecycleSnapshot(after);assertDeletionLedgerPrestate(before.ledger);
  // These placeholders request only the structural matcher, not an audit/approval.
  const prestate=evaluateHistoricalDeletionPrestate(before.metadata,{integrity,ledger:before.ledger,gitSha:'0'.repeat(40),pendingDigest:'0'.repeat(64),snapshotDigests:[beforeDigests.metadataDigest,beforeDigests.metadataDigest]});
  need(prestate.status==='matched-prestate','LIFECYCLE_PRESTATE_UNPROVEN');
  need(integrity?.quickCheckOk===true&&integrity.quickCheck==='ok'&&integrity.foreignKeyCheckOk===true&&Array.isArray(integrity.foreignKeyViolations)&&integrity.foreignKeyViolations.length===0,'LIFECYCLE_INTEGRITY');
  if(equal(before,after))return {outcome:'prestate-observed',retryAllowed:false,operationalAuthorization:false};
  need(equal(before.pragmas,after.pragmas),'LIFECYCLE_CONNECTION_DRIFT');
  const added=after.ledger.filter(r=>!before.ledger.some(b=>equal(b,r)));
  need(added.length===1&&added[0].name===HISTORICAL_CANDIDATE_NAME&&Number.isSafeInteger(added[0].id)&&added[0].id>Math.max(0,...before.ledger.map(r=>r.id))&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/.test(added[0].appliedAt)&&after.ledger.length===before.ledger.length+1&&before.ledger.every(b=>after.ledger.some(r=>equal(b,r))),'LIFECYCLE_LEDGER_POSTSTATE');
  const expected=historicalExpectedDelta();
  need(before.catalog.every(b=>after.catalog.some(r=>equal(b,r))),'LIFECYCLE_PREEXISTING_DRIFT');
  const newObjects=after.catalog.filter(r=>!before.catalog.some(b=>b.name===r.name)).map(({rowid,...r})=>r);
  need(equal(rows(newObjects),rows(expected.catalog)),'LIFECYCLE_POST_CATALOG');
  for(const key of Object.keys(DELETION_SCHEMA_QUERIES))need(equal(rows(after.metadata[key]),rows([...before.metadata[key],...expected.metadata[key]])),'LIFECYCLE_POST_METADATA');
  return {outcome:'committed-poststate-observed',retryAllowed:false,operationalAuthorization:false,candidateSha256:HISTORICAL_CANDIDATE_SHA256,deltaDigest:expected.deltaDigest,addedObjects:150,addedGuards:147};
 }catch{return {outcome:'blocked-or-partial',retryAllowed:false,operationalAuthorization:false};}
}
export function historicalLocalActionBinding(evidence,snapshot,execution){
 need(evidence?.phase==='local-proof-only'&&evidence.operationalAuthorization===false&&evidence.readyForAuthorization===false,'LIFECYCLE_NOT_AUTHORIZATION');
 const digests=validateLifecycleSnapshot(snapshot);
 for(const [key,value] of Object.entries(digests))need(evidence[key]===value,'LIFECYCLE_BINDING_SNAPSHOT');
 need(evidence.candidate?.name===HISTORICAL_CANDIDATE_NAME&&evidence.candidate?.sha256===HISTORICAL_CANDIDATE_SHA256,'LIFECYCLE_BINDING_SOURCE');
 const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const recomputed=renderHistoricalExecution({catalog:snapshot.catalog,ledger:snapshot.ledger,pragmas:snapshot.pragmas,indexList:snapshot.metadata.indexes,fullSnapshotDigest:digests.fullSnapshotDigest},read(HISTORICAL_CANDIDATE_PATH));
 need(equal(recomputed,execution),'LIFECYCLE_BINDING_EXECUTION');
 const material={executionSha256:recomputed.sha256,requestSha256:recomputed.requestSha256,requestBodySha256:recomputed.requestBodySha256,requestHashDomain:recomputed.requestHashDomain,sourceSha256:recomputed.sourceSha256,fullSnapshotDigest:recomputed.fullSnapshotDigest,rendererSha256:sha256Text(read('scripts/migrations/organization-deletion-historical-execution.mjs')),expectedDeltaDigest:historicalExpectedDelta().deltaDigest,wranglerVersion:'4.140.0'};
 return {phase:'local-proof-only',operationalAuthorization:false,readyForAuthorization:false,localActionDigest:lifecycleDigest({domain:HISTORICAL_LIFECYCLE_ID,evidence,execution:material})};
}
