// LOCAL FIXTURE COLLECTOR ONLY. No real transport, API client, tokens or fetch.
import {compareSyntheticIdentity} from './synthetic-identity-model.mjs';
const fixtureStore=new WeakMap();
export const LOCAL_PROVENANCE_FIELDS=Object.freeze(['accountId','databaseUuid','databaseName','workerName','deploymentId','versionId','gitSha','payloadSha256','fixtureSha256','registryNamespaceId','workerBundleSha256','registryClassName','registryObjectName']);
const encoder=new TextEncoder();
function deny(){throw Error('LOCAL_IDENTITY_COLLECTION_DENIED');}
function exact(value,keys){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function fresh(time,now){return Number.isSafeInteger(time)&&time>=0&&time<=now&&now-time<=60000;}
function signatureBytes(s){
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(s))deny();
 const binary=atob(s.replace(/-/g,'+').replace(/_/g,'/'));
 if(btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==s)deny();
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
export function createLocalIdentityFixtureTransport(fixtures){
 // structuredClone forbids callback functions; no supplied transport is executed.
 try {
  const snapshot=structuredClone(fixtures);
  const transport=Object.freeze({mode:'synthetic-fixture-only'});
  fixtureStore.set(transport,snapshot);
  return transport;
 }catch{deny();}
}
export async function collectLocalSyntheticIdentity({approved,transport,provenanceKey,nowMs}){
 try {
  if(!fixtureStore.has(transport)||!Number.isSafeInteger(nowMs)||nowMs<0)deny();
  // Capture everything before the first async boundary; no caller mutation races.
  const a=structuredClone(approved),f=structuredClone(fixtureStore.get(transport));
  if(!(provenanceKey instanceof CryptoKey)||provenanceKey.type!=='secret'||provenanceKey.extractable||
    provenanceKey.algorithm.name!=='HMAC'||provenanceKey.algorithm.hash?.name!=='SHA-256'||
    provenanceKey.algorithm.length<256||!provenanceKey.usages.includes('verify'))deny();
  if(!f||!exact(f.provenance,['statement','signatureBase64url'])||!exact(f.provenance.statement,LOCAL_PROVENANCE_FIELDS))deny();
  const statement=f.provenance.statement;
  if(LOCAL_PROVENANCE_FIELDS.some(k=>typeof statement[k]!=='string'||statement[k]!==a[k]))deny();
  if(f.account?.id!==a.accountId||f.database?.uuid!==a.databaseUuid||f.database?.name!==a.databaseName||
    !fresh(f.account?.observedAtMs,nowMs)||!fresh(f.database?.observedAtMs,nowMs)||!fresh(f.version?.observedAtMs,nowMs))deny();
  // The fixture slots stand for active-deployment observations; no real API
  // active selector is implemented. Ambiguous/split deployments fail closed.
  for(const d of [f.deploymentBefore,f.deploymentAfter]){
   if(!d||d.id!==a.deploymentId||!fresh(d.observedAtMs,nowMs)||!Array.isArray(d.versions)||d.versions.length!==1||
      !exact(d.versions[0],['version_id','percentage'])||d.versions[0].version_id!==a.versionId||d.versions[0].percentage!==100)deny();
  }
  if(f.deploymentAfter.observedAtMs<f.deploymentBefore.observedAtMs||f.version.id!==a.versionId)deny();
  const bindings=f.version.resources?.bindings;
  if(!Array.isArray(bindings)||bindings.length!==2)deny();
  const d1=bindings.find(b=>b?.type==='d1'),registry=bindings.find(b=>b?.type==='durable_object_namespace');
  if(!exact(d1,['type','name','id'])||d1.name!=='TARGET'||d1.id!==a.databaseUuid||
     !exact(registry,['type','name','namespace_id','class_name','script_name'])||registry.name!=='REGISTRY'||
     registry.namespace_id!==a.registryNamespaceId||registry.class_name!==a.registryClassName||registry.script_name!==a.workerName)deny();
  if(typeof f.bundleUtf8!=='string')deny();
  const bundle=encoder.encode(f.bundleUtf8);if(bundle.length===0||bundle.length>1048576)deny();
  const actualHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bundle)),x=>x.toString(16).padStart(2,'0')).join('');
  if(actualHash!==a.workerBundleSha256)deny();
  const signed=encoder.encode('maono-local-provenance-v1\n'+JSON.stringify(Object.fromEntries(LOCAL_PROVENANCE_FIELDS.map(k=>[k,statement[k]]))));
  if(!await crypto.subtle.verify('HMAC',provenanceKey,signatureBytes(f.provenance.signatureBase64url),signed))deny();
  const observed={...statement,observedAtMs:Math.min(f.account.observedAtMs,f.database.observedAtMs,f.version.observedAtMs,f.deploymentBefore.observedAtMs,f.deploymentAfter.observedAtMs),
    d1Bindings:[{binding:'TARGET',databaseUuid:d1.id}],durableObjectBindings:[{binding:'REGISTRY',namespaceId:registry.namespace_id,className:registry.class_name}]};
  compareSyntheticIdentity(a,observed,nowMs);
  return Object.freeze({observed,localEvidenceVerified:true,remoteIdentityAuthenticated:false,operationalAuthorization:false});
 }catch{deny();}
}
