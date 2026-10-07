import {errorResponseFromError,jsonResponse,methodNotAllowed} from "../../../../_lib/http.js";
import {requireSession} from "../../../../_lib/auth.js";
import {requirePermission} from "../../../../_lib/permissions.js";
import {publicProject} from "../../../../_lib/projects.js";
import {reserveProjectCreation,authorizeProjectCreation} from "../../../../_lib/project-creation-reservation.js";
import {resolveMapConfigRepository} from "../../../../_lib/map-config-repository-factory.js";
import {savePreparedDomainOperation} from "../../../../_lib/project-save-domain-adapter.js";
import {getProjectSaveOperation,publicProjectSaveOperation} from "../../../../_lib/project-save-operations.js";
import {assertSaveDeployCompatibility} from "../../../../_lib/save-deploy-contract.js";
import {assertSameSaveOrigin,primarySaveEnvironment,readBoundedSaveJsonBody} from "../../../../_lib/project-save-protocol.js";

const fail=(message,status,code)=>Object.assign(new Error(message),{status,code});
export async function onRequest(context) {
  const {request,params}=context,env=primarySaveEnvironment(context.env);
  if(request.method!=="POST")return methodNotAllowed(["POST"]);
  try {
    assertSameSaveOrigin(request);
    await assertSaveDeployCompatibility(env,request);
    const sessionUser=await requireSession(env,request);
    const body=await readBoundedSaveJsonBody(request);
    const orgId=Number(body?.organizationId);
    if(!Number.isSafeInteger(orgId) || orgId<1)throw fail("Informe a organização selecionada do arquivo.",400,"ORGANIZATION_ID_INVALID");
    // AdminFiles selects an organization independently of the session. Scope only
    // this request; never mutate the user's active organization as a side effect.
    const user={...sessionUser,activeOrganizationId:orgId,active_organization_id:orgId};
    await requirePermission(env,request,"admin.panel.access",{organizationId:orgId,scopeType:"organization"},{user,auditOnSuccess:false});
    const operationId=String(body?.operationId || "");
    if(!/^[A-Za-z0-9:_-]{12,128}$/.test(operationId))throw fail("Identificador da tentativa inválido.",400,"PROJECT_SAVE_OPERATION_ID_INVALID");
    const existing=await getProjectSaveOperation(env,{organizationId:orgId,actorUserId:user.id,operationId});
    if(existing) {
      const domain=JSON.parse(existing.domain_json);
      if(Number(domain.importFileId)!==Number(params.id))throw fail("A tentativa pertence a outro arquivo.",409,"OPERATION_PAYLOAD_MISMATCH");
      if(Boolean(domain.copyOrganizationAccess)!==(body?.copyOrganizationAccess!==false))throw fail("A tentativa usa outra política de acesso.",409,"OPERATION_PAYLOAD_MISMATCH");
      const target=await env.DB.prepare("SELECT name FROM projects WHERE id=? AND organization_id=?").bind(existing.project_id,orgId).first();
      if(target && body?.name && target.name!==body.name)throw fail("A tentativa usa outro título.",409,"OPERATION_PAYLOAD_MISMATCH");
      if(existing.payload_stored_at || ["PUBLISHED","CONFLICT","FAILED_FINAL"].includes(existing.state)) {
        const project=await env.DB.prepare("SELECT * FROM projects WHERE id=? AND organization_id=?").bind(existing.project_id,orgId).first();
        return jsonResponse({ok:true,pending:existing.state!=="PUBLISHED",operation:publicProjectSaveOperation(existing,project),project:project ? publicProject(project):null},{status:existing.state==="PUBLISHED" ? 200:202});
      }
    }
    const file=await env.DB.prepare(`SELECT f.*,o.dropbox_root_path AS organization_root,o.active AS organization_active
      FROM organization_files f JOIN organizations o ON o.id=f.organization_id
      WHERE f.id=? AND f.organization_id=?`).bind(Number(params.id),orgId).first();
    if(!file)throw fail("Arquivo não encontrado.",404,"ORGANIZATION_FILE_NOT_FOUND");
    if(!file.active || !file.organization_active || file.deleted_at)throw fail("Arquivo ou organização inativa.",409,"ORGANIZATION_FILE_INACTIVE");
    if(!/\.json$/i.test(file.file_name))throw fail("Somente mapas JSON podem virar projetos.",400,"ORGANIZATION_FILE_NOT_JSON");
    const sourcePath=String(file.dropbox_path),root=String(file.organization_root).replace(/\/+$/g,"");
    if(!sourcePath.startsWith(`${root}/`) || sourcePath.includes("/../"))throw fail("Arquivo fora da organização.",403,"ORGANIZATION_FILE_SCOPE_INVALID");
    const split=sourcePath.lastIndexOf("/");
    const repository=resolveMapConfigRepository(env);
    const source=await repository.loadLegacyStream({project:{id:1,organization_id:orgId,dropbox_root_path:sourcePath.slice(0,split),default_config_file:sourcePath.slice(split+1)}});
    const {body:payload,...manifest}=source;
    const reserved=await reserveProjectCreation(env,request,user,{
      organizationId:orgId,name:body?.name || file.name,description:body?.description || `Projeto criado a partir de ${file.file_name}.`,
      idempotencyKey:operationId,configMetadata:{sizeBytes:manifest.sizeBytes,datasetCount:null,configVersion:null,schemaName:"legacy-kepler",schemaVersion:1},
    },{allowUnknown:true});
    const headers=new Headers(request.headers);headers.set("X-Maono-Creation-Key",operationId);headers.set("X-Maono-Expected-Revision","0");
    const creation=await authorizeProjectCreation(env,new Request(request.url,{headers}),user,reserved.project.slug);
    const operation=await savePreparedDomainOperation(env,{
      project:creation.project,actor:user,operationId,kind:"create",expectedConfigRevision:0,manifest,body:payload,mapConfigRepository:repository,
      domain:{creationKey:operationId,reservationId:creation.project.reservation_id || creation.project.organization_file_id,
        quotaReservationId:creation.quotaReservationId,importFileId:Number(file.id),copyOrganizationAccess:body?.copyOrganizationAccess!==false},
    });
    const project=await env.DB.prepare("SELECT * FROM projects WHERE id=? AND organization_id=?").bind(reserved.project.id,orgId).first();
    return jsonResponse({ok:true,pending:operation.state!=="PUBLISHED",operation:publicProjectSaveOperation(operation,project),project:publicProject(project)}, {status:operation.state==="PUBLISHED"?201:202});
  }catch(error){return errorResponseFromError(error);}
}
