// Explicit historical lifecycle. No fallback from canonical; no provider operations.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {evaluateHistoricalDeletionPrestate,historicalDeletionReference} from './deletion-historical-prestate.mjs';
import {readDeletionSchemaEvidence,evaluateDeletionSchema,DELETION_SCHEMA_QUERIES} from './organization-deletion-schema-0044.mjs';
import {HISTORICAL_DELETION_MIGRATION,assertDeletionLedgerPoststate,sha256Text,gateError} from './production-migration-lib.mjs';
const hash=value=>sha256Text(JSON.stringify(value));
const requireMatch=(value,code)=>{if(!value)throw gateError(code,'Historical deletion profile blocked.');};
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export function evaluateHistoricalOperation(evidence,context,phase='pre'){
 requireMatch(['pre','post'].includes(phase),'HISTORICAL_PHASE_INVALID');
 const ref=historicalDeletionReference();
 const actual=evaluateDeletionSchema(evidence.snapshot);
 requireMatch(evidence.snapshotDigests?.length===2&&evidence.snapshotDigests.every(d=>d===actual.metadataDigest),'HISTORICAL_SNAPSHOT_DRIFT');
 let pre=evidence.snapshot,ledger=context.ledger;
 if(phase==='post'){
  assertDeletionLedgerPoststate(ledger,HISTORICAL_DELETION_MIGRATION);
  requireMatch(ledger.some(r=>r.name===HISTORICAL_DELETION_MIGRATION),'HISTORICAL_LEDGER_MISSING');
  const db=new DatabaseSync(':memory:');let expected;
  try{db.exec(read('tests/fixtures/deletion-historical-safety/schema.sql'));db.exec(read(ref.contract.candidate));expected=Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]));}finally{db.close();}
  const baseNames=new Set(ref.manifest.objects.map(o=>o.name));
  const additions=expected.objects.filter(o=>!baseNames.has(o.name));
  const names=new Set(additions.map(o=>o.name));
  const tables=new Set(additions.filter(o=>o.type==='table').map(o=>o.name));
  const project=s=>Object.fromEntries(Object.entries(s).map(([key,rows])=>[key,rows.filter(r=>key==='objects'?names.has(r.name):tables.has(r.table_name))]));
  // Definitions and all metadata for the exact added objects must match, not just names.
  requireMatch(isDeepStrictEqual(JSON.parse(JSON.stringify(project(evidence.snapshot))),JSON.parse(JSON.stringify(project(expected)))),'HISTORICAL_POSTSTATE_DRIFT');
  pre=Object.fromEntries(Object.entries(pre).map(([key,rows])=>[key,rows.filter(r=>key==='objects'?!names.has(r.name):!tables.has(r.table_name))]));
  ledger=ledger.filter(r=>r.name!==HISTORICAL_DELETION_MIGRATION);
 }
 const preDigest=evaluateDeletionSchema(pre).metadataDigest;
 if(context.expectedPreMetadataDigest) requireMatch(preDigest===context.expectedPreMetadataDigest,'HISTORICAL_POST_PRESTATE_DRIFT');
 const result=evaluateHistoricalDeletionPrestate(pre,{...context,ledger,snapshotDigests:[preDigest,preDigest]});
 requireMatch(result.status==='matched-prestate',result.reason||'HISTORICAL_PRESTATE_UNPROVEN');
 const binding={profile:'historical-deletion-operation-v2',phase,migration:HISTORICAL_DELETION_MIGRATION,candidateSha256:result.candidate.sha256,contractSha256:result.contractSha256,sourceDigest:result.sourceDigest,metadataDigest:actual.metadataDigest,ledgerDigest:hash(context.ledger),gitSha:context.gitSha,pendingDigest:context.pendingDigest};
 return {...binding,preMetadataDigest:preDigest,compatible:true,digest:hash(binding),writesPerformed:false,guards:phase==='pre'?'planned-not-installed':'verified-installed'};
}
export async function readHistoricalOperation(configPath,context,phase='pre',injected={}){
 return evaluateHistoricalOperation(await readDeletionSchemaEvidence(configPath,injected),context,phase);
}
