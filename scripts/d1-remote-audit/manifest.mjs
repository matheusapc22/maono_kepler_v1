import {createHash} from 'node:crypto';
export const EXCLUDED_ACCOUNT='09d455fa1cf988b0d9db89987b73eaff';
export const EXCLUDED_DATABASE='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
const id32=/^[a-f0-9]{32}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
const rules={accountId:id32,databaseUuid:uuid,databaseName:/^maono_synthetic_rehearsal_[a-z0-9_]+$/,workerName:/^maono-synthetic-rehearsal-[a-z0-9-]+$/,deploymentId:uuid,versionId:uuid,registryNamespaceId:id32};
function deny(){throw Error('SYNTHETIC_MANIFEST_DENIED');}
export function validateManifest(m){
 if(!m||m.schemaVersion!==1||m.purpose!=='synthetic-readonly-audit'||typeof m.readOnlyAuditEnabled!=='boolean'||!m.target||!m.artifact||!m.scope||!m.cleanup)deny();
 if(JSON.stringify(m.scope.allowedHttpMethods)!=='["GET"]'||['createResources','deployWorker','executeSql','modifySecrets','deleteResources'].some(k=>m.scope[k]!==false))deny();
 if(m.cleanup.automaticDeletion!==false||m.cleanup.requireExactResourceConfirmation!==true||m.cleanup.preserveAuditArtifacts!==true||
    !Array.isArray(m.cleanup.neverDeleteDatabaseNames)||!Array.isArray(m.cleanup.neverDeleteDatabaseUuids)||!m.cleanup.neverDeleteDatabaseNames.includes('maono_maps')||!m.cleanup.neverDeleteDatabaseUuids.includes(EXCLUDED_DATABASE))deny();
 if(m.target.accountId===EXCLUDED_ACCOUNT||m.target.databaseUuid===EXCLUDED_DATABASE||m.target.registryClassName!=='SyntheticClaimRegistry')deny();
 let configured=true;
 for(const[k,re]of Object.entries(rules)){const v=m.target[k];if(v===null){configured=false;continue;}if(typeof v!=='string'||!re.test(v))deny();}
 for(const k of ['gitSha','workerBundleSha256','payloadSha256','fixtureSha256']){const v=m.artifact[k];if(v===null){configured=false;continue;}if(typeof v!=='string'||!(k==='gitSha'?/^[a-f0-9]{40}$/:hash).test(v))deny();}
 if(m.readOnlyAuditEnabled&&!configured)deny();
 return {configured,auditEnabled:m.readOnlyAuditEnabled,remoteIdentityAuthenticated:false,operationalAuthorization:false};
}
export function parsePinnedManifest(bytes,expectedSha256,{requireEnabled=false}={}){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>16384||typeof expectedSha256!=='string'||!hash.test(expectedSha256))deny();
 const digest=createHash('sha256').update(bytes).digest('hex');if(digest!==expectedSha256)deny();
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{deny();}
 const status=validateManifest(manifest);if(requireEnabled&&(!status.configured||!status.auditEnabled))deny();
 return {manifest,status,manifestSha256:digest};
}
