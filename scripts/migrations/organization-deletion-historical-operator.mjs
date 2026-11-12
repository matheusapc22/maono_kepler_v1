// Dedicated fixed historical lifecycle. Generic migration dispatch remains denied.
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DELETION_SCHEMA_QUERIES} from './organization-deletion-schema-0044.mjs';
import {historicalDeletionReference} from './deletion-historical-prestate.mjs';
import {HISTORICAL_CANDIDATE_NAME,HISTORICAL_CANDIDATE_PATH,HISTORICAL_CANDIDATE_SHA256,HISTORICAL_CATALOG_QUERY,HISTORICAL_LEDGER_QUERY,buildHistoricalLocalEvidence,minimizedMigrationEvidence,validateLifecycleSnapshot,lifecycleDigest,historicalExpectedDelta} from './organization-deletion-historical-lifecycle.mjs';
import {renderHistoricalExecution} from './organization-deletion-historical-execution.mjs';
import {reconcileHistoricalSanitizedOutcome} from './organization-deletion-historical-recovery.mjs';
import {PRODUCTION_DATABASE_NAME,PRODUCTION_DATABASE_ID,WRANGLER_VERSION,runWranglerJson,rowsFromD1Json,extractD1Identity,assertProductionIdentity,requireCloudflareEnvironment,readGitSnapshot,listLocalMigrations,sha256Text,queryIntegrity,captureTimeTravelBookmark,makeTemporaryWranglerConfig,writeJsonReport,safeError,gateError} from './production-migration-lib.mjs';
export const HISTORICAL_OPERATOR_CONTRACT='historical-0044-operator-v1';
export const HISTORICAL_OBSERVATION_DOMAIN='maono-production-historical-0044-observation-v1';
const fail=code=>{throw gateError(code,'Historical migration operator blocked; inspect sanitized stage and re-audit.');};
const need=(condition,code='HISTORICAL_OPERATOR_INVALID')=>{if(!condition)fail(code);};
const keys=(o,want)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===want.slice().sort().join();
const hash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
const equal=(a,b)=>lifecycleDigest(a)===lifecycleDigest(b);
const sourceRead=async path=>(await readFile(new URL('../../'+path,import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const validTime=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x);
const integritySummary=i=>{need(i.quickCheck==='ok'&&i.quickCheckOk===true&&i.foreignKeyCheckOk===true&&Array.isArray(i.foreignKeyViolations)&&i.foreignKeyViolations.length===0,'HISTORICAL_INTEGRITY');return {quickCheck:'ok',quickCheckOk:true,foreignKeyCheckOk:true,foreignKeyViolations:[]};};
const bookmarkValid=b=>keys(b,['bookmark','capturedAt'])&&/^[a-zA-Z0-9._:-]{10,200}$/.test(b.bookmark||'')&&validTime(b.capturedAt);
export function historicalObservationHash(material){return lifecycleDigest({domain:HISTORICAL_OBSERVATION_DOMAIN,material});}
function executionMaterial(execution,rendererSha256,deltaDigest){return {sourceSha256:execution.sourceSha256,sha256:execution.sha256,requestSha256:execution.requestSha256,requestBodySha256:execution.requestBodySha256,requestHashDomain:execution.requestHashDomain,fullSnapshotDigest:execution.fullSnapshotDigest,rendererSha256,expectedDeltaDigest:deltaDigest,assertionCount:execution.assertionCount,bytes:execution.bytes};}
function validateEvidenceShape(e){
 need(keys(e,['contractId','phase','profileId','readyForAuthorization','approvalEligible','compatible','gitSha','database','sourceDigest','contractSha256','candidate','catalogDigest','metadataDigest','ledgerDigest','connectionDigest','fullSnapshotDigest','migrations','atomicObservation','operationalAuthorization']));
 need(e.contractId==='historical-0044-isolated-apply-v1'&&e.phase==='local-proof-only'&&e.profileId==='deletion-safety-historical-v1'&&e.readyForAuthorization===false&&e.approvalEligible===false&&e.compatible===false&&e.atomicObservation===false&&e.operationalAuthorization===false);
 need(/^[a-f0-9]{40}$/.test(e.gitSha||'')&&keys(e.database,['name','uuid'])&&e.database.name===PRODUCTION_DATABASE_NAME&&e.database.uuid===PRODUCTION_DATABASE_ID);
 need(keys(e.candidate,['name','sha256'])&&e.candidate.name===HISTORICAL_CANDIDATE_NAME&&e.candidate.sha256===HISTORICAL_CANDIDATE_SHA256);
 for(const k of ['sourceDigest','contractSha256','catalogDigest','metadataDigest','ledgerDigest','connectionDigest','fullSnapshotDigest'])need(hash(e[k]));
 need(keys(e.migrations,['ledger','ledgerDigest','pending','pendingDigest','persistedChecksumAvailable'])&&e.migrations.persistedChecksumAvailable===false&&e.migrations.ledgerDigest===e.ledgerDigest&&hash(e.migrations.pendingDigest));
 need(Array.isArray(e.migrations.ledger)&&e.migrations.ledger.length<=10000&&Array.isArray(e.migrations.pending)&&e.migrations.pending.length<=10000);
 for(const r of e.migrations.ledger)need(keys(r,['id','name','appliedAt','sourceChecksum','sourceChecksumUnavailable'])&&Number.isSafeInteger(r.id)&&r.id>0&&typeof r.name==='string'&&typeof r.appliedAt==='string'&&(r.sourceChecksumUnavailable===true?r.sourceChecksum===null:r.sourceChecksumUnavailable===false&&hash(r.sourceChecksum)));
 for(const r of e.migrations.pending)need(keys(r,['name','sha256','selection'])&&typeof r.name==='string'&&hash(r.sha256)&&['selected','excluded-mutually-exclusive-alternative','not-selected'].includes(r.selection));
 const oldLedger=e.migrations.ledger.map(({id,name,appliedAt})=>({id,name,appliedAt}));
 const files=[...e.migrations.pending.map(({name,sha256})=>({name,sha256})),...e.migrations.ledger.filter(r=>!r.sourceChecksumUnavailable).map(r=>({name:r.name,sha256:r.sourceChecksum}))];
 need(equal(minimizedMigrationEvidence(oldLedger,files),e.migrations));
}
export function validateHistoricalAudit(report,approval){
 need(hash(approval),'HISTORICAL_EVIDENCE_ID_REQUIRED');
 need(keys(report,['contractId','version','phase','generatedAt','writesPerformed','readyForAuthorization','approvalEligible','transportBlocker','material','integrity','backup','evidenceIdentity']));
 need(report.contractId===HISTORICAL_OPERATOR_CONTRACT&&report.version===1&&report.phase==='historical-audit-transport-blocked'&&report.writesPerformed===false&&report.readyForAuthorization===false&&report.approvalEligible===false&&equal(report.transportBlocker,{code:'WRANGLER_LEDGER_BOOTSTRAP_RACE'})&&validTime(report.generatedAt));
 const m=report.material;need(keys(m,['database','gitSha','migration','wranglerVersion','sourcePins','evidence','execution','risk']));
 validateEvidenceShape(m.evidence);
 const fixedPins={...historicalDeletionReference().contract.sourcePins};
 for(const path of ['scripts/migrations/organization-deletion-historical-operator.mjs','scripts/migrations/organization-deletion-historical-lifecycle.mjs','scripts/migrations/organization-deletion-historical-execution.mjs','scripts/migrations/organization-deletion-historical-recovery.mjs'])fixedPins[path]=sha256Text(readFileSync(new URL('../../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
 need(equal(m.sourcePins,fixedPins),'HISTORICAL_SOURCE_DRIFT');
 const ref=historicalDeletionReference();need(m.evidence.sourceDigest===ref.sourceDigest&&m.evidence.contractSha256===sha256Text(readFileSync(new URL('./references/deletion-historical-safety-v1.json',import.meta.url),'utf8').replace(/\r\n/g,'\n')),'HISTORICAL_SOURCE_DRIFT');
 need(equal(m.database,m.evidence.database)&&m.gitSha===m.evidence.gitSha&&equal(m.migration,m.evidence.candidate)&&m.wranglerVersion===WRANGLER_VERSION);
 need(keys(m.execution,['sourceSha256','sha256','requestSha256','requestBodySha256','requestHashDomain','fullSnapshotDigest','rendererSha256','expectedDeltaDigest','assertionCount','bytes']));
 for(const k of ['sourceSha256','sha256','requestSha256','requestBodySha256','fullSnapshotDigest','rendererSha256','expectedDeltaDigest'])need(hash(m.execution[k]));
 need(m.execution.rendererSha256===fixedPins['scripts/migrations/organization-deletion-historical-execution.mjs']&&m.execution.expectedDeltaDigest===historicalExpectedDelta().deltaDigest,'HISTORICAL_EXECUTION_DRIFT');
 need(m.execution.sourceSha256===HISTORICAL_CANDIDATE_SHA256&&m.execution.fullSnapshotDigest===m.evidence.fullSnapshotDigest&&m.execution.requestHashDomain==='concatenated-sql-payload'&&Number.isSafeInteger(m.execution.bytes)&&m.execution.bytes>0&&m.execution.bytes<=8000000&&Number.isSafeInteger(m.execution.assertionCount)&&m.execution.assertionCount>0);
 need(equal(m.risk,{kind:'additive-schema-only',createTables:3,createTriggers:147,businessRowWrites:false,featureActivation:false}));
 need(report.evidenceIdentity===approval&&historicalObservationHash(m)===approval);
 need(equal(report.integrity,integritySummary(report.integrity))&&bookmarkValid(report.backup));
 return report;
}
async function localState(){
 const git=await readGitSnapshot();need(git.clean,'HISTORICAL_DIRTY_GIT');
 const ref=historicalDeletionReference(),source=await sourceRead(HISTORICAL_CANDIDATE_PATH);need(sha256Text(source)===HISTORICAL_CANDIDATE_SHA256,'HISTORICAL_SOURCE_DRIFT');
 const names=await listLocalMigrations(),localFiles=[];
 for(const name of names)localFiles.push({name,sha256:sha256Text(await sourceRead('migrations/'+name))});
 localFiles.push({name:HISTORICAL_CANDIDATE_NAME,sha256:HISTORICAL_CANDIDATE_SHA256});
 const pins={...ref.contract.sourcePins};
 for(const path of ['scripts/migrations/organization-deletion-historical-operator.mjs','scripts/migrations/organization-deletion-historical-lifecycle.mjs','scripts/migrations/organization-deletion-historical-execution.mjs','scripts/migrations/organization-deletion-historical-recovery.mjs'])pins[path]=sha256Text(await sourceRead(path));
 return {git,ref,source,localFiles,pins,rendererSha256:pins['scripts/migrations/organization-deletion-historical-execution.mjs']};
}
export async function validateHistoricalOperatorSources(){const local=await localState();return {contractId:HISTORICAL_OPERATOR_CONTRACT,version:1,candidate:{name:HISTORICAL_CANDIDATE_NAME,sha256:HISTORICAL_CANDIDATE_SHA256},gitSha:local.git.sha,sourcePins:local.pins};}
async function fixedRows(config,sql){return rowsFromD1Json(await runWranglerJson(['d1','execute',PRODUCTION_DATABASE_NAME,'--remote','--command',sql],config,{},'DELETION_OBJECTS'));}
async function snapshot(config,setStage){
 setStage('HISTORICAL_CATALOG');const catalog=await fixedRows(config,HISTORICAL_CATALOG_QUERY);
 const metadata={};for(const [key,sql] of Object.entries(DELETION_SCHEMA_QUERIES)){setStage('HISTORICAL_METADATA_'+key.toUpperCase());metadata[key]=await fixedRows(config,sql);}
 setStage('HISTORICAL_LEDGER');const ledger=await fixedRows(config,HISTORICAL_LEDGER_QUERY);
 setStage('HISTORICAL_PRAGMAS');const rows=await fixedRows(config,'SELECT (SELECT foreign_keys FROM pragma_foreign_keys) AS foreign_keys,(SELECT recursive_triggers FROM pragma_recursive_triggers) AS recursive_triggers,(SELECT defer_foreign_keys FROM pragma_defer_foreign_keys) AS defer_foreign_keys;');need(rows.length===1);
 const result={catalog,metadata,ledger,pragmas:rows[0]};validateLifecycleSnapshot(result);return result;
}
async function observation(config,setStage){
 setStage('HISTORICAL_DATABASE');const identity=extractD1Identity(await runWranglerJson(['d1','info',PRODUCTION_DATABASE_NAME],config,{},'D1_INFO'));assertProductionIdentity(identity);
 setStage('HISTORICAL_INTEGRITY');const integrity=integritySummary(await queryIntegrity(config));
 const first=await snapshot(config,setStage),second=await snapshot(config,setStage);need(equal(first,second),'HISTORICAL_SNAPSHOT_DRIFT');
 return {snapshot:second,integrity,database:{name:identity.name,uuid:identity.id}};
}
async function auditCurrent(config,setStage){
 const local=await localState(),observed=await observation(config,setStage),s=observed.snapshot;
 const evidence=buildHistoricalLocalEvidence(s,{gitSha:local.git.sha,database:observed.database,localFiles:local.localFiles,integrity:observed.integrity,fullSnapshotDigests:[lifecycleDigest(s),lifecycleDigest(s)]});
 const execution=renderHistoricalExecution({catalog:s.catalog,ledger:s.ledger,pragmas:s.pragmas,indexList:s.metadata.indexes,fullSnapshotDigest:lifecycleDigest(s)},local.source);
 const material={database:observed.database,gitSha:local.git.sha,migration:{name:HISTORICAL_CANDIDATE_NAME,sha256:HISTORICAL_CANDIDATE_SHA256},wranglerVersion:WRANGLER_VERSION,sourcePins:local.pins,evidence,execution:executionMaterial(execution,local.rendererSha256,historicalExpectedDelta().deltaDigest),risk:{kind:'additive-schema-only',createTables:3,createTriggers:147,businessRowWrites:false,featureActivation:false}};
 setStage('HISTORICAL_BOOKMARK');const backup=await captureTimeTravelBookmark(config),hash=historicalObservationHash(material);
 const report={contractId:HISTORICAL_OPERATOR_CONTRACT,version:1,phase:'historical-audit-transport-blocked',generatedAt:new Date().toISOString(),writesPerformed:false,readyForAuthorization:false,approvalEligible:false,transportBlocker:{code:'WRANGLER_LEDGER_BOOTSTRAP_RACE'},material,integrity:observed.integrity,backup,evidenceIdentity:hash};
 validateHistoricalAudit(report,hash);return {report,execution,local};
}
async function readAudit(path){const text=await readFile(resolve(path),'utf8');need(Buffer.byteLength(text)<=2000000);return {text,report:JSON.parse(text)};}
export async function runHistoricalOperator(mode,args){
 let stage='HISTORICAL_ARGUMENTS',temporary,audit=null,provenance=null;
 const setStage=value=>{stage=value;};
 const reportPath=resolve(args.report||`.tmp/production-migrations/historical-${mode}-${Date.now()}.json`);
 try{
  if(mode==='apply')fail('HISTORICAL_TRANSPORT_BLOCKED');
  need(['audit','postvalidate'].includes(mode)&&args.migration===HISTORICAL_CANDIDATE_NAME,'HISTORICAL_TARGET');
  const allowed=mode==='audit'?['migration','report']:['migration','report','audit-report','approval'];need(Object.keys(args).every(k=>allowed.includes(k)));
  if(mode!=='audit'){
   need(args['audit-report']&&hash(args.approval),'HISTORICAL_EVIDENCE_ID_REQUIRED');const loaded=await readAudit(args['audit-report']);audit=validateHistoricalAudit(loaded.report,args.approval);
   if(mode==='postvalidate'){
    stage='HISTORICAL_AUDIT_ORIGIN';
    const {validateHistoricalAuditOrigin}=await import('./historical-audit-artifact.mjs');
    const verified=await validateHistoricalAuditOrigin(resolve(args['audit-report']),args.approval);
    provenance=verified.provenance;need(equal(verified.audit,audit),'HISTORICAL_AUDIT_ORIGIN');
    need(provenance&&provenance.auditSha256===sha256Text(loaded.text),'HISTORICAL_AUDIT_ORIGIN');
   }
  }
  // Everything above is credential-free validation/provenance. No trust in sidecar flags.
  stage='HISTORICAL_LOCAL_SOURCES';const initialLocal=await localState();
  if(audit)need(audit.material.gitSha===initialLocal.git.sha&&equal(audit.material.sourcePins,initialLocal.pins),'HISTORICAL_LOCAL_DRIFT');
  stage='HISTORICAL_CREDENTIALS';const {accountId}=requireCloudflareEnvironment();temporary=await makeTemporaryWranglerConfig(accountId);
  if(mode==='postvalidate'){
   const observed=await observation(temporary.configPath,setStage);need(equal(observed.database,audit.material.database));
   const recovery=reconcileHistoricalSanitizedOutcome(JSON.stringify(audit.material.evidence),observed.snapshot,observed.integrity);
   need(recovery.outcome==='poststate-corresponds-to-supplied-artifact','HISTORICAL_POSTSTATE');
   stage='HISTORICAL_POST_BOOKMARK';const currentBookmark=await captureTimeTravelBookmark(temporary.configPath);
   await writeJsonReport(reportPath,{contractId:HISTORICAL_OPERATOR_CONTRACT,version:1,phase:'historical-postvalidate-read-only',backup:{...audit.backup,source:'original-audit'},currentBookmark,writesPerformed:false,ok:true,evidenceIdentity:args.approval,provenance,integrity:observed.integrity,recovery,gitSha:initialLocal.git.sha});return;
  }
  stage='HISTORICAL_READ_ONLY_AUDIT';const fresh=await auditCurrent(temporary.configPath,setStage);
  await writeJsonReport(reportPath,fresh.report);process.stdout.write('Historical read-only evidence collected; transport blocked; no apply authorization.\nEvidence identity: '+fresh.report.evidenceIdentity+'\n');
 }catch(error){
  const failure={contractId:HISTORICAL_OPERATOR_CONTRACT,version:1,phase:'historical-operator-failed',stage,ok:false,complete:false,applyStarted:false,applyCompleted:false,writesMayHaveOccurred:false,retryAllowed:false,error:safeError(error)};
  try{await writeJsonReport(reportPath+'.failure.json',failure);}catch{/* Never echo original exception/SQL. */}
  process.stderr.write(JSON.stringify(failure)+'\n');process.exitCode=1;
 }finally{await temporary?.cleanup().catch(()=>{});}
}
