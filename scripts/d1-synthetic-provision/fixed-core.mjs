// Fixed API payloads. Execution requires separate reviewed/approved protected CLI.
// Deny-all may be briefly public; disabling is a separate verified operation.
import {createHash} from 'node:crypto';
const ACCOUNT='1988481e4c75c760516161104b7e1e50';
const DATABASE='maono_synthetic_rehearsal_pilot_20261116';
const WORKER='maono-synthetic-rehearsal-pilot-20261116';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const SCRIPT=BASE+'/workers/scripts/'+WORKER;
const PRODUCTION_UUID='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const DENY_ALL_SCAFFOLD=`// Fixed diagnostic scaffold only. No D1 calls, storage, claims, secrets or handlers with effects.
import {DurableObject} from 'cloudflare:workers';
export class SyntheticClaimRegistry extends DurableObject {
 fetch(){return new Response('SYNTHETIC_PILOT_NOT_ENABLED',{status:403});}
}
export default {fetch(){return new Response('SYNTHETIC_PILOT_NOT_ENABLED',{status:403});}};
`;
export const SCAFFOLD_SHA256=createHash('sha256').update(DENY_ALL_SCAFFOLD).digest('hex');
function deny(){throw Error('FIXED_PROVISION_PREPARATION_DENIED');}
export function describeFixedProvisioning(){
 return Object.freeze({status:'disabled-until-protected-approval',accountId:ACCOUNT,databaseName:DATABASE,workerName:WORKER,
  registryClassName:'SyntheticClaimRegistry',workerSourceSha256:SCAFFOLD_SHA256,
  maxWorkers:1,maxDatabases:1,maxNamespaces:1,maxLifetimeHours:24,spendingLimitUSD:0,
  freePlanVerified:false,nonPublicCreationVerified:false,writeTransportImplemented:true,
  durableRunJournalImplemented:false,duplicatePreflightImplemented:true,operationalAuthorization:false});
}
export function buildFixedCreateD1Request(){
 return {url:BASE+'/d1/database',method:'POST',redirect:'error',credentials:'omit',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({name:DATABASE})};
}
// Only a syntactically valid create receipt supplies the opaque D1 UUID. This
// does not authenticate receipt provenance and must never itself authorize upload.
export function buildFixedWorkerUploadFromReceipt(receipt){
 if(!receipt||receipt.success!==true||!Array.isArray(receipt.errors)||receipt.errors.length!==0||
    !receipt.result||receipt.result.name!==DATABASE||typeof receipt.result.uuid!=='string'||
    !uuid.test(receipt.result.uuid)||receipt.result.uuid===PRODUCTION_UUID)deny();
 const metadata={main_module:'worker.mjs',compatibility_date:'2026-09-23',
  bindings:[{type:'d1',name:'TARGET',id:receipt.result.uuid},{type:'durable_object_namespace',name:'REGISTRY',class_name:'SyntheticClaimRegistry'}],
  migrations:{new_tag:'pilot-initial-v1',new_sqlite_classes:['SyntheticClaimRegistry']}};
 const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 body.set('worker.mjs',new Blob([DENY_ALL_SCAFFOLD],{type:'application/javascript+module'}),'worker.mjs');
 return {url:SCRIPT,method:'PUT',redirect:'error',credentials:'omit',body};
}
export function buildFixedDisablePublicEndpointsRequest(){
 // Separate post-upload call is NOT atomic private creation. Preparation only.
 return {url:SCRIPT+'/subdomain',method:'POST',redirect:'error',credentials:'omit',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false,previews_enabled:false})};
}
export {provisionFixedPilot} from './api-core.mjs';
