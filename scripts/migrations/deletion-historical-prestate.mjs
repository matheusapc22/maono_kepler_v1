// Supplemental evidence only. This module cannot produce an apply authorization.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {DELETION_SCHEMA_QUERIES,evaluateDeletionSchema} from './organization-deletion-schema-0044.mjs';
import {recognizeDefinition} from './deletion-semantic-diagnostics.mjs';
import {sha256Text,assertDeletionLedgerPrestate} from './production-migration-lib.mjs';
const PROFILE='deletion-safety-historical-v1';
const CONTRACT_PATH='scripts/migrations/references/deletion-historical-safety-v1.json';
const CONTRACT_HASH='6b4381bbcd2480d392dc513f4ba1ab0d0b21c4b3560f53bf3193d959cfbd9e04';
const CANDIDATE_HASH='b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa';
const FIXTURE='tests/fixtures/deletion-historical-safety/';
const readDefault=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const digest=value=>sha256Text(JSON.stringify(value));
const copy=value=>JSON.parse(JSON.stringify(value));
const demand=(value,code)=>{if(!value)throw Object.assign(new Error('Historical deletion evidence blocked.'),{code});};
const snapshot=db=>Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]));
export function historicalDeletionReference(read=readDefault){
 const contractText=read(CONTRACT_PATH);demand(sha256Text(contractText)===CONTRACT_HASH,'HISTORICAL_SOURCE_DRIFT');
 const contract=JSON.parse(contractText),files={};
 for(const [path,hash] of Object.entries(contract.sourcePins)){files[path]=read(path);demand(sha256Text(files[path])===hash,'HISTORICAL_SOURCE_DRIFT');}
 const manifest=JSON.parse(files[FIXTURE+'manifest.json']);
 for(const [key,pin] of Object.entries(manifest.sourcePins)){files[key]=read(pin.localPath);demand(sha256Text(files[key])===pin.sha256,'HISTORICAL_SOURCE_DRIFT');}
 const canonical=new DatabaseSync(':memory:');canonical.exec(files['schema.sql'].split('-- Organization permanent deletion (migration 0044)')[0]);
 try{for(const object of manifest.objects){
  if(object.category==='canonical-source')demand(canonical.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(object.name)?.sql===object.sql,'HISTORICAL_SOURCE_DRIFT');
  else if(object.category==='versioned-reconstruction'){
   const db=new DatabaseSync(':memory:');try{
    if(object.type!=='table'){const parent=manifest.objects.find(o=>o.name===object.table&&o.type==='table');demand(parent,'HISTORICAL_SOURCE_DRIFT');db.exec(parent.sql);}
    for(const step of object.steps){demand(sha256Text(step.statement)===step.sha256&&files[step.source]?.includes(step.statement),'HISTORICAL_SOURCE_DRIFT');db.exec(step.statement);}
    demand(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(object.name)?.sql===object.sql,'HISTORICAL_SOURCE_DRIFT');
   }finally{db.close();}
  }else demand(object.category==='reviewed-structural-projection','HISTORICAL_SOURCE_DRIFT');
 }}finally{canonical.close();}
 demand(manifest.objects.length===530&&Object.keys(contract.slots).length===7,'HISTORICAL_SOURCE_DRIFT');
 demand(Object.keys(contract.slots).sort().join()===Object.keys(manifest.syntheticDefaults).sort().join(),'HISTORICAL_SOURCE_DRIFT');
 const core=files['migrations/0044_organization_permanent_deletion.sql'],guards=files[FIXTURE+'additional-guards.test.sql'];
 demand(files[contract.candidate]===core+'\n'+guards&&sha256Text(files[contract.candidate])===CANDIDATE_HASH,'HISTORICAL_CANDIDATE_DRIFT');
 for(const name of contract.triggerContract.names){const object=manifest.objects.find(o=>o.name===name);demand(object?.type==='trigger'&&object.sql.endsWith(contract.triggerContract.body),'HISTORICAL_EFFECT_DRIFT');}
 demand(!manifest.objects.some(o=>o.type==='trigger'&&o.table==='project_save_authorization_generation'),'HISTORICAL_EFFECT_DRIFT');
 const db=new DatabaseSync(':memory:');try{
  db.exec(files[FIXTURE+'schema.sql']);const before=snapshot(db),report=evaluateDeletionSchema(before);
  demand(!before.foreignKeys.some(f=>f.table_name==='project_save_authorization_generation'||f.parent_table==='project_save_authorization_generation'),'HISTORICAL_EFFECT_DRIFT');
  db.exec(files[contract.candidate]);const planned=db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'org_delete_*' ORDER BY name").all().map(r=>r.name);
  demand(planned.length===147,'HISTORICAL_CANDIDATE_DRIFT');
  return {contract,manifest,report,planned,sourceDigest:digest(contract.sourcePins)};
 }finally{db.close();}
}
function maskedAst(ast,slots){
 const out=copy(ast);
 if(out.kind==='table')for(const col of out.items.filter(x=>x.kind==='column'))for(const c of col.constraints){const slot=out.name+'.'+col.name;if(slots[slot]&&c.kind==='default'){
  demand(c.expression.kind==='opaque-literal'&&c.expression.type===slots[slot].literalClass,'HISTORICAL_DEFAULT_EXPRESSION');
  c.expression={kind:'reviewed-deletion-only-scalar-slot',slot,type:slots[slot].literalClass};
 }}return out;
}
function maskedMetadata(metadata,reference){
 const out=copy(metadata),slots=reference.contract.slots;
 out.columns=out.columns.filter(c=>c.table!=='d1_migrations');out.indexes=out.indexes.filter(i=>i.table!=='d1_migrations');
 for(const c of out.columns){const slot=c.table+'.'+c.name;if(slots[slot]){demand(c.defaultPresent,'HISTORICAL_DEFAULT_EXPRESSION');c.defaultDigest='reviewed-deletion-only-scalar-slot';}}
 for(const i of out.indexes)if(reference.manifest.objects.some(o=>o.name===i.name&&o.category==='reviewed-structural-projection'))i.definitionDigest='complete-AST-compared';
 return out;
}
export function evaluateHistoricalDeletionPrestate(observed,context={},injected={}){
 const base={profileId:PROFILE,version:1,status:'blocked',scope:'deletion-safety-prestate-evidence-only',compatible:false,readyForAuthorization:false,approvalEligible:false,guards:'planned-not-installed',candidate:{name:'0044_organization_permanent_deletion_historical.sql',sha256:CANDIDATE_HASH,genericDiscovery:false},generalDdlEquivalent:false,productionLiteralsRecovered:false,atomicDatabaseSnapshot:false,ongoingMonitoring:false,integrityObservation:'same-audit-before-metadata-reads'};
 try{
  const ref=historicalDeletionReference(injected.readSource||readDefault),report=evaluateDeletionSchema(observed);
  demand(context.integrity?.quickCheck==='ok'&&context.integrity.quickCheckOk===true&&context.integrity.foreignKeyCheckOk===true&&Array.isArray(context.integrity.foreignKeyViolations)&&context.integrity.foreignKeyViolations.length===0,'HISTORICAL_INTEGRITY_REQUIRED');
  demand(Array.isArray(context.snapshotDigests)&&context.snapshotDigests.length===2&&context.snapshotDigests.every(h=>h===report.metadataDigest),'HISTORICAL_SNAPSHOT_DRIFT');
  demand(/^[a-f0-9]{40}$/.test(context.gitSha||'')&&/^[a-f0-9]{64}$/.test(context.pendingDigest||''),'HISTORICAL_CONTEXT_REQUIRED');
  assertDeletionLedgerPrestate(context.ledger);
  demand(observed.objects.some(o=>o.name==='d1_migrations')&&!report.mismatches.some(m=>['LEDGER_SCHEMA','PROTECTED_METADATA_REFERENCE'].includes(m.code)),'HISTORICAL_ENVELOPE_REQUIRED');
  const ignored=new Set(['d1_migrations',...report.protectedInternals.map(x=>x.name)]);
  const objects=observed.objects.filter(o=>!ignored.has(o.name));
  demand(isDeepStrictEqual(objects.map(o=>[o.type,o.name,o.tbl_name]).sort(),ref.manifest.objects.map(o=>[o.type,o.name,o.table]).sort()),'HISTORICAL_OBJECT_INVENTORY');
  for(const object of ref.manifest.objects){const got=objects.find(o=>o.name===object.name);
   if(object.category==='reviewed-structural-projection'){
    const parsed=recognizeDefinition(got);demand(parsed.status==='recognized-subset','HISTORICAL_UNSUPPORTED_DEFINITION');
    demand(isDeepStrictEqual(maskedAst(parsed.ast,ref.contract.slots),maskedAst(object.ast,ref.contract.slots)),'HISTORICAL_STRUCTURAL_DRIFT');
   }else demand(report.objects.find(o=>o.name===object.name)?.definitionDigest===ref.report.objects.find(o=>o.name===object.name)?.definitionDigest,'HISTORICAL_VERSIONED_DEFINITION_DRIFT');
  }
  demand(isDeepStrictEqual(maskedMetadata(report.structuralMetadata,ref),maskedMetadata(ref.report.structuralMetadata,ref)),'HISTORICAL_METADATA_DRIFT');
  const evidence={...base,status:'matched-prestate',canonicalCompatible:report.compatible,contractSha256:CONTRACT_HASH,sourceDigest:ref.sourceDigest,sourcePins:ref.contract.sourcePins,observedSnapshotDigest:report.metadataDigest,snapshotDigests:context.snapshotDigests,gitSha:context.gitSha,pendingDigest:context.pendingDigest,ledgerDigest:digest(context.ledger),integrity:{quickCheck:'ok',foreignKeyViolations:0},applicationObjects:530,plannedGuardCount:147,plannedGuards:ref.planned,scalarDefaultSlots:Object.keys(ref.contract.slots),propertyContract:'seven-fixed-scalar-slots-with-exact-remaining-schema-and-super-admin-runtime',applicationRowsRead:false};
  demand(report.compatible===false,'HISTORICAL_NOT_CANONICAL_FALLBACK');
  return {...evidence,evidenceDigest:digest(evidence)};
 }catch(error){
  const code=typeof error?.code==='string'&&/^(HISTORICAL_|DELETION_LEDGER_)[A-Z_]+$/.test(error.code)?error.code:'HISTORICAL_PRESTATE_UNPROVEN';
  return {...base,reason:code};
 }
}
