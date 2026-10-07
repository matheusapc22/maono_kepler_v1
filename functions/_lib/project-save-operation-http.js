import {createSaveTrace} from "./save-observability.js";
import {getOrCreateCorrelationId} from "./maono-error.js";
import { requireSession } from "./auth.js";
import { can } from "./permissions.js";
import { getAuthorizedProject, getActiveOrganizationId, publicProject } from "./projects.js";
import { getProjectLifecycleRow, publicProjectLifecycle } from "./project-lifecycle.js";
import { assertProjectPersistenceRoute } from "./project-map-route-policy.js";
import { authorizeProjectCreation, hasProjectCreationContext } from "./project-creation-reservation.js";
import { assertSaveDeployCompatibility, saveDeployResponseHeaders } from "./save-deploy-contract.js";
import { assertSameSaveOrigin, primarySaveEnvironment, readBoundedSaveJsonBody } from "./project-save-protocol.js";
import { errorResponseFromError, jsonResponse, methodNotAllowed } from "./http.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import {
  registerProjectSaveOperation, getProjectSaveOperation, publicProjectSaveOperation,
  acquireProjectSaveUpload, markProjectSavePayloadStored, processProjectSaveOperation, failProjectSaveUpload,
} from "./project-save-operations.js";

function httpError(message,status,code) { return Object.assign(new Error(message),{status,code}); }


async function authorizedContext(env,request,slug,{write=false}={}) {
  const user=await requireSession(env,request);
  let project, creation=null;
  if (!write && hasProjectCreationContext(request)) {
    // A completed creation receipt requires current project-view access, not a
    // continuing grant to create other projects after the original publication.
    const visible=await getAuthorizedProject(env,user,slug);
    if (visible) {
      const decision=await can(env,user,"project.view",{project:visible,projectId:visible.id,organizationId:visible.organization_id});
      if (!decision.allowed) throw httpError("Acesso negado.",403,"FORBIDDEN");
      return {user,project:visible,creation:null};
    }
    const reserved=await env.DB.prepare("SELECT lifecycle_state FROM projects WHERE slug=? AND organization_id=?").bind(slug,getActiveOrganizationId(user)).first();
    if (reserved?.lifecycle_state === "ACTIVE") throw httpError("Projeto não encontrado.",404,"PROJECT_NOT_FOUND");
  }
  if (hasProjectCreationContext(request)) {
    creation=await authorizeProjectCreation(env,request,user,slug);
    project=creation.project;
  } else {
    project=await getAuthorizedProject(env,user,slug);
    if (!project) throw httpError("Projeto não encontrado.",404,"PROJECT_NOT_FOUND");
    const lifecycle=await getProjectLifecycleRow(env,{projectId:project.id,organizationId:project.organization_id});
    project={...project,...lifecycle};
    const permission=write ? "project.save":"project.view";
    const decision=await can(env,user,permission,{project,projectId:project.id,projectSlug:project.slug,organizationId:project.organization_id});
    if (!decision.allowed) throw httpError("Acesso negado.",403,"FORBIDDEN");
    if (write) assertProjectPersistenceRoute(user,project);
  }
  return {user,project,creation};
}

async function responseFor(env,operation,project,deployment,status=200) {
  const current=await getProjectLifecycleRow(env,{projectId:project.id,organizationId:project.organization_id});
  const head={...project,...current};
  const result=publicProjectSaveOperation(operation,head);
  if (operation.state === "PUBLISHED") deployment.trace?.finishSuccess({httpStatus:status});
  return jsonResponse({
    ok:true,operation:result,
    project:{...publicProject(head),lifecycle:publicProjectLifecycle(head)},
    configRevision:result.receipt?.publishedRevision ?? result.receipt?.revision ?? undefined,
    currentRevision:Number(head.config_revision || 0),
  }, {status,headers:{...saveDeployResponseHeaders(deployment),...deployment.trace?.responseHeaders()}});
}

export async function handleProjectSaveOperation(context,action) {
  const {request,params}=context;
  const env=primarySaveEnvironment(context.env);
  const allowed={register:"POST",status:"GET",payload:"PUT"}[action];
  if (request.method!==allowed) return methodNotAllowed([allowed]);
  const trace=createSaveTrace({request,saveId:params?.operationId || request.headers.get("X-Maono-Save-Id"),correlationId:getOrCreateCorrelationId(request),operation:hasProjectCreationContext(request)?"create":"update"});
  try {
    if (action!=="status") assertSameSaveOrigin(request);
    // Status remains readable to compatible rollback builds while new admissions pause.
    const deployment={...await trace.stage("VALIDATE",()=>assertSaveDeployCompatibility(env,request)),trace};
    const {user,project,creation}=await authorizedContext(env,request,String(params?.slug || ""),{write:action!=="status"});
    const requestedProjectId=Number(request.headers.get("X-Maono-Project-Id"));
    if(!Number.isSafeInteger(requestedProjectId) || requestedProjectId<1)throw httpError("A identidade do projeto não foi informada. Preserve o mapa e confira o projeto aberto.",409,"PROJECT_IDENTITY_REQUIRED");
    if(requestedProjectId!==Number(project.id))throw httpError("Este endereço agora pertence a outro projeto. A tentativa original foi preservada.",409,"PROJECT_IDENTITY_CHANGED");
    const scope={organizationId:project.organization_id,actorUserId:user.id,projectId:project.id};
    trace.updateContext({projectId:project.id,organizationId:project.organization_id,expectedRevision:Number(project.config_revision || 0)});
    let operation;
    if (action==="register") {
      const input=await readBoundedSaveJsonBody(request);
      if (input?.operation === "create" && !creation) throw httpError("Contexto de criação ausente.",403,"PROJECT_CREATION_CONTEXT_FORBIDDEN");
      if (input?.operation && !["update","create"].includes(input.operation)) throw httpError("Tipo de salvamento inválido.",400,"SAVE_OPERATION_KIND_INVALID");
      if (creation && input.operation!=="create") throw httpError("Operação incompatível com a reserva.",409,"OPERATION_PAYLOAD_MISMATCH");
      operation=await registerProjectSaveOperation(env,{
        ...scope,actor:user,project,operationId:input.operationId,
        kind:creation ? "create" : "update",
        expectedConfigRevision:input.expectedConfigRevision,
        manifest:{checksumAlgorithm:input.checksumAlgorithm,checksum:input.contentHash,sizeBytes:input.payloadBytes,
          serializationVersion:input.serializationVersion,schemaName:input.schemaName,schemaVersion:input.schemaVersion,
          configVersion:input.configVersion,datasetCount:input.datasetCount,contentType:"application/json; charset=utf-8"},
        domain:creation ? {reservationId:project.reservation_id || project.organization_file_id,quotaReservationId:creation.quotaReservationId,creationKey:creation.idempotencyKey}:null,
      });
      return responseFor(env,operation,project,deployment,201);
    }
    operation=await getProjectSaveOperation(env,{...scope,operationId:String(params?.operationId || "")});
    if (!operation) throw httpError("Operação não encontrada.",404,"SAVE_OPERATION_NOT_FOUND");
    if (action==="status") return responseFor(env,operation,project,deployment);
    if (["PUBLISHED","CONFLICT","FAILED_FINAL"].includes(operation.state)) return responseFor(env,operation,project,deployment);
    if (["PAYLOAD_STORED","PROCESSING","RETRY_WAIT"].includes(operation.state)) return responseFor(env,operation,project,deployment,202);
    const contentType=String(request.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("application/json") && !contentType.startsWith("application/vnd.maono.map-config+json")) throw httpError("Envie os bytes JSON do mapa.",415,"SAVE_PAYLOAD_CONTENT_TYPE_INVALID");
    operation=await acquireProjectSaveUpload(env,{operation});
    if (["PUBLISHED","CONFLICT","FAILED_FINAL"].includes(operation.state)) return responseFor(env,operation,project,deployment);
    if (["PAYLOAD_STORED","PROCESSING","RETRY_WAIT"].includes(operation.state)) return responseFor(env,operation,project,deployment,202);
    const repository=resolveMapConfigRepository(env);
    let artifact;
    try { artifact=await trace.stage("WRITE",()=>repository.uploadOperationPayload({project,operation,body:request.body})); }
    catch(error) {
      await failProjectSaveUpload(env,{operation,uploadEpoch:operation.upload_epoch,error}).catch(()=>null);
      throw error;
    }
    operation=await trace.stage("READY",()=>markProjectSavePayloadStored(env,{operation,uploadEpoch:operation.upload_epoch,artifact}));
    // An immediate worker is latency optimization; the durable outbox is authority.
    try { if(String(env.PROJECT_DURABLE_SAVE_INLINE_ENABLED ?? "true").toLowerCase() !== "false") operation=await trace.stage("PUBLISH",()=>processProjectSaveOperation(env,{operation})); }
    catch (error) {
      console.warn("[Maono save] immediate processor deferred",{operationId:operation.operation_id,code:error?.code || "SAVE_PROCESS_DEFERRED"});
      operation=await getProjectSaveOperation(env,{...scope,operationId:operation.operation_id}) || operation;
    }
    return responseFor(env,operation,project,deployment,operation.state==="PUBLISHED" ? 200:202);
  } catch(error) { trace.fail(error); return errorResponseFromError(error,{headers:trace.responseHeaders()}); }
}
