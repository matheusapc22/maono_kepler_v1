import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import { savePreparedDomainOperation } from "./project-save-domain-adapter.js";
import { publicProjectSaveOperation } from "./project-save-operations.js";

// This is a domain adapter, never an independent pointer/revision writer.
export async function reconcileLegacyProjectLifecycle(env,project,{actorUserId=null,mapConfigRepository=null}={}) {
  if (!project?.id || !project?.organization_id || !actorUserId) throw Object.assign(new Error("Contexto de reconciliação inválido."),{status:400,code:"LEGACY_PROJECT_INVALID"});
  if (project.lifecycle_state) return {project,idempotent:true,skipped:true};
  if (!project.active) throw Object.assign(new Error("Projeto inativo exige revisão manual."),{status:409,code:"LEGACY_INACTIVE_PROJECT_UNRESOLVED"});
  const repository=resolveMapConfigRepository(env,mapConfigRepository);
  const source=await repository.loadLegacyStream({project});
  const {body,...manifest}=source;
  const operation=await savePreparedDomainOperation(env,{
    project,actor:{id:actorUserId},operationId:`legacy-reconcile-${project.id}-${manifest.checksum}`,
    kind:"legacy-promotion",expectedConfigRevision:Number(project.config_revision || 0),manifest,body,mapConfigRepository:repository,
  });
  const current=await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND organization_id = ?").bind(project.id,project.organization_id).first();
  const status=publicProjectSaveOperation(operation,current);
  if (["CONFLICT","FAILED_FINAL"].includes(status.state)) throw Object.assign(new Error("A promoção exige intervenção; o arquivo legado foi preservado."),{status:409,code:status.errorCode || "LEGACY_PROJECT_RECONCILIATION_BLOCKED"});
  return {project:current,pending:status.state!=="PUBLISHED",operation:status,
    revision:status.receipt?.publishedRevision ?? status.receipt?.revision ?? null,
    checksum:manifest.checksum,sizeBytes:manifest.sizeBytes,idempotent:status.state==="PUBLISHED",skipped:false};
}
