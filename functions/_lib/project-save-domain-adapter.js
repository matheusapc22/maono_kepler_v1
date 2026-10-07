// Domain adapters may prepare a proposal/reservation; only the operation core
// is allowed to publish a project pointer or issue a success receipt.
import { dropboxContentHashHex } from "./dropbox-content-hash.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import { registerProjectSaveOperation, acquireProjectSaveUpload, markProjectSavePayloadStored, processProjectSaveOperation, getProjectSaveOperation, failProjectSaveUpload } from "./project-save-operations.js";

export async function manifestForProjectBytes(bytes, config) {
  return {
    checksumAlgorithm:"dropbox-content-hash",checksum:await dropboxContentHashHex(bytes),sizeBytes:bytes.byteLength,
    serializationVersion:1,schemaName:"legacy-kepler",schemaVersion:1,contentType:"application/json; charset=utf-8",
    configVersion:String(config.version),datasetCount:config.datasets.length,
  };
}

export async function savePreparedDomainOperation(env,{project,actor,operationId,kind,expectedConfigRevision,manifest,domain=null,body,mapConfigRepository=null}) {
  let operation=await registerProjectSaveOperation(env,{
    organizationId:project.organization_id,project,actor,operationId,kind,expectedConfigRevision,manifest,domain,
  });
  if (["PUBLISHED","CONFLICT","FAILED_FINAL"].includes(operation.state)) return operation;
  if (["AWAITING_UPLOAD","RECEIVING"].includes(operation.state)) {
    operation=await acquireProjectSaveUpload(env,{operation});
    const repository=resolveMapConfigRepository(env,mapConfigRepository);
    if (!["AWAITING_UPLOAD","RECEIVING"].includes(operation.state)) return operation;
    let artifact;
    try { artifact=await repository.uploadOperationPayload({project,operation,body}); }
    catch(error) {
      await failProjectSaveUpload(env,{operation,uploadEpoch:operation.upload_epoch,error}).catch(()=>null);
      throw error;
    }
    operation=await markProjectSavePayloadStored(env,{operation,uploadEpoch:operation.upload_epoch,artifact});
  }
  if(String(env.PROJECT_DURABLE_SAVE_INLINE_ENABLED ?? "true").toLowerCase() === "false") return operation;
  try { return await processProjectSaveOperation(env,{operation}); }
  catch(error) {
    console.warn("[Maono save] accepted domain operation deferred",{operationId,code:error?.code || "SAVE_PROCESS_DEFERRED"});
    return await getProjectSaveOperation(env,{organizationId:project.organization_id,actorUserId:actor.id,projectId:project.id,operationId}) || operation;
  }
}
