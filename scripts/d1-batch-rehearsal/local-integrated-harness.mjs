// LOCAL COMPOSITION TEST HARNESS ONLY. The target is an internal counter, never SQL.
import {createLocalInvocationVerifier} from './local-invocation-auth.mjs';
import {collectLocalSyntheticIdentity} from './local-identity-collector.mjs';
import {compareSyntheticIdentity} from './synthetic-identity-model.mjs';
import {modelInvocation,operationKey} from './remote-protocol-model.mjs';
export function createLocalIntegratedHarness({approved,spec,audience,invocationKey,transport,provenanceKey,store,clock}) {
 const fixedApproval=structuredClone(approved),fixedSpec=structuredClone(spec);
 operationKey(fixedSpec);
 if(typeof clock!=='function' || ['databaseUuid','databaseName','payloadSha256'].some(k=>fixedApproval[k]!==fixedSpec[k]))throw Error('LOCAL_INTEGRATED_CONFIG_DENIED');
 const verify=createLocalInvocationVerifier({databaseUuid:fixedSpec.databaseUuid,payloadSha256:fixedSpec.payloadSha256,auditSha256:fixedSpec.auditSha256,attemptId:fixedSpec.attemptId,deploymentId:fixedApproval.deploymentId,registryNamespaceId:fixedApproval.registryNamespaceId,audience},invocationKey);
 function freshTime(auth){const now=clock();if(!Number.isSafeInteger(now)||now<auth.authenticatedIssuedAtMs||now>=auth.authenticatedExpiresAtMs)throw Error('LOCAL_AUTH_EXPIRED');return now;}
 let simulatedTargetCalls=0;
 return Object.freeze({
  getSimulatedTargetCalls:()=>simulatedTargetCalls,
  async invoke(request) {
   try {
    // Authentication precedes any fixture collection or registry operation.
    freshTime(await verify(request,clock()));
    const evidence=await collectLocalSyntheticIdentity({approved:fixedApproval,transport,provenanceKey,nowMs:clock()});
    if(evidence.localEvidenceVerified!==true || evidence.remoteIdentityAuthenticated!==false || evidence.operationalAuthorization!==false)throw Error('LOCAL_EVIDENCE_ONLY');
    // Recheck freshness after asynchronous crypto/collection, before claiming.
    freshTime(await verify(request,clock()));
    compareSyntheticIdentity(fixedApproval,evidence.observed,clock());
    const outcome=await modelInvocation({store,spec:fixedSpec,executeFixedBatch:async()=>{const auth=await verify(request,clock());const now=freshTime(auth);compareSyntheticIdentity(fixedApproval,evidence.observed,now);simulatedTargetCalls++;}});
    return Object.freeze({...outcome,simulatedTargetCalls,simulationOnly:true,remoteIdentityAuthenticated:false,operationalAuthorization:false});
   } catch {throw Error('LOCAL_INTEGRATED_DENIED');}
  },
 });
}
