// TEST-ONLY synthetic snapshots and ephemeral keys. No real evidence or credentials.
import {LOCAL_PROVENANCE_FIELDS} from '../../scripts/d1-batch-rehearsal/local-identity-collector.mjs';
export async function makeLocalIdentityCollectorFixture(nowMs=100000){
 const bundleUtf8='// Synthetic bundle fixture, never a deployed Worker.\nexport default {};\n';
 const workerBundleSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bundleUtf8))),x=>x.toString(16).padStart(2,'0')).join('');
 const approved={accountId:'a'.repeat(32),databaseUuid:'00000000-0000-4000-8000-000000000044',databaseName:'maono_synthetic_rehearsal_collector',workerName:'maono-synthetic-rehearsal-collector',deploymentId:'00000000-0000-4000-8000-000000000001',versionId:'00000000-0000-4000-8000-000000000002',gitSha:'b'.repeat(40),payloadSha256:'c'.repeat(64),fixtureSha256:'d'.repeat(64),registryNamespaceId:'e'.repeat(32),workerBundleSha256,registryClassName:'SyntheticClaimRegistry',registryObjectName:'synthetic-claim-registry-v1',expiresAtMs:nowMs+60000};
 const provenanceKey=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const statement=Object.fromEntries(LOCAL_PROVENANCE_FIELDS.map(k=>[k,approved[k]]));
 const signature=await crypto.subtle.sign('HMAC',provenanceKey,new TextEncoder().encode('maono-local-provenance-v1\n'+JSON.stringify(statement)));
 const deployment={id:approved.deploymentId,versions:[{version_id:approved.versionId,percentage:100}],observedAtMs:nowMs};
 const fixtures={account:{id:approved.accountId,observedAtMs:nowMs},database:{uuid:approved.databaseUuid,name:approved.databaseName,observedAtMs:nowMs},deploymentBefore:structuredClone(deployment),deploymentAfter:structuredClone(deployment),version:{id:approved.versionId,observedAtMs:nowMs,resources:{bindings:[{type:'d1',name:'TARGET',id:approved.databaseUuid},{type:'durable_object_namespace',name:'REGISTRY',namespace_id:approved.registryNamespaceId,class_name:approved.registryClassName,script_name:approved.workerName}]}},bundleUtf8,provenance:{statement,signatureBase64url:Buffer.from(signature).toString('base64url')}};
 return {approved,fixtures,provenanceKey,nowMs};
}
