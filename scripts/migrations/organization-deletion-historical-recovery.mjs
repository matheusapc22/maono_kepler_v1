// Local inversion proof only. Artifact authenticity is NOT established here.
import {buildHistoricalLocalEvidence,historicalExpectedDelta,HISTORICAL_CANDIDATE_NAME,validateLifecycleSnapshot,lifecycleDigest,reconcileHistoricalLocalOutcome} from './organization-deletion-historical-lifecycle.mjs';
const need=value=>{if(!value)throw new Error('Historical recovery correspondence blocked.');};
const equal=(a,b)=>lifecycleDigest(a)===lifecycleDigest(b);
const copy=x=>JSON.parse(JSON.stringify(x));
function subtractExact(actual,delta){
 const remaining=new Map();for(const row of delta){const key=lifecycleDigest(row);remaining.set(key,(remaining.get(key)||0)+1);}
 const result=[];for(const row of actual){const key=lifecycleDigest(row),count=remaining.get(key)||0;if(count)remaining.set(key,count-1);else result.push(row);}
 need([...remaining.values()].every(n=>n===0));return result;
}
function localSources(evidence){
 const migrations=evidence?.migrations;
 need(Array.isArray(migrations?.pending)&&migrations.pending.length<=10000&&Array.isArray(migrations.ledger)&&migrations.ledger.length<=10000&&migrations.persistedChecksumAvailable===false);
 const files=migrations.pending.map(r=>({name:r.name,sha256:r.sha256}));
 for(const row of migrations.ledger){
  need(typeof row.sourceChecksumUnavailable==='boolean');
  if(row.sourceChecksumUnavailable)need(row.sourceChecksum===null);
  else {need(typeof row.sourceChecksum==='string');files.push({name:row.name,sha256:row.sourceChecksum});}
 }
 return files;
}
function matchArtifact(evidence,reconstructed,integrity){
 const digests=validateLifecycleSnapshot(reconstructed);
 // Rebuilding proves correspondence only. Supplied Git/database/source claims are
 // not an authenticated workflow record and cannot authorize any operation.
 const rebuilt=buildHistoricalLocalEvidence(reconstructed,{localFiles:localSources(evidence),database:evidence.database,gitSha:evidence.gitSha,integrity,fullSnapshotDigests:[digests.fullSnapshotDigest,digests.fullSnapshotDigest]});
 need(equal(rebuilt,evidence));
 return digests;
}
export function reconcileHistoricalSanitizedOutcome(serializedAudit,freshSnapshot,integrity){
 const boundary={retryAllowed:false,operationalAuthorization:false,artifactAuthenticityVerified:false,correspondenceOnly:true};
 try{
  need(typeof serializedAudit==='string'&&Buffer.byteLength(serializedAudit)<=2000000);
  const evidence=JSON.parse(serializedAudit);validateLifecycleSnapshot(freshSnapshot);
  const historical=freshSnapshot.ledger.filter(r=>r.name===HISTORICAL_CANDIDATE_NAME);
  if(historical.length===0){matchArtifact(evidence,freshSnapshot,integrity);return {...boundary,outcome:'prestate-corresponds-to-supplied-artifact'};}
  need(historical.length===1);
  const delta=historicalExpectedDelta(),pre=copy(freshSnapshot);
  const names=new Set(delta.catalog.map(r=>r.name));
  const added=pre.catalog.filter(r=>names.has(r.name));
  need(added.length===delta.catalog.length&&added.every(r=>delta.catalog.some(d=>{const {rowid,...definition}=r;return equal(d,definition);})));
  pre.catalog=pre.catalog.filter(r=>!names.has(r.name));
  need(added.every(r=>r.rowid>Math.max(0,...pre.catalog.map(o=>o.rowid))));
  for(const key of Object.keys(delta.metadata))pre.metadata[key]=subtractExact(pre.metadata[key],delta.metadata[key]);
  pre.ledger=pre.ledger.filter(r=>r.name!==HISTORICAL_CANDIDATE_NAME);
  matchArtifact(evidence,pre,integrity);
  const post=reconcileHistoricalLocalOutcome(pre,freshSnapshot,integrity);
  need(post.outcome==='committed-poststate-observed');
  return {...boundary,outcome:'poststate-corresponds-to-supplied-artifact',candidateSha256:delta.sourceSha256,deltaDigest:delta.deltaDigest,reconstructedSnapshotDigest:lifecycleDigest(pre),addedObjects:150,addedGuards:147};
 }catch{return {...boundary,outcome:'blocked-or-partial'};}
}
