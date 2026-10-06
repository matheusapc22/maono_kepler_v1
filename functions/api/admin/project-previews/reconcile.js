import { errorResponse,jsonResponse,methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getPreviewFileNameFromConfigFile,getRevisionedPreviewFileNameFromConfigFile,getDropboxMetadata,downloadDropboxBinaryFile } from "../../../_lib/dropbox.js";
import { getActiveOrganizationId } from "../../../_lib/projects.js";
import { readBoundedPreview,validatePreviewPng } from "../../../_lib/project-preview-png.js";
import { readPreviewJsonBody,previewArtifactFileName,previewStorageNotFound } from "../../../_lib/project-preview-payload.js";
// This formerly mutating route is now an inventory-only dry run. A proposed
// repair is evidence for a separately authorized, exact-snapshot action.
export async function onRequest({request,env}) {
  if (request.method!=="POST") return methodNotAllowed(["POST"]);
  try {
    const user=await requireSession(env,request);
    if (String(user?.role || '').toLowerCase()!=='super_admin') return errorResponse('A auditoria é exclusiva do Super Admin.',403,'SUPER_ADMIN_REQUIRED');
    const organizationId=getActiveOrganizationId(user);
    if (!organizationId) return errorResponse('Selecione uma organização ativa.',409,'ACTIVE_ORGANIZATION_REQUIRED');
    const body=await readPreviewJsonBody(request);
    if (body?.dryRun===false || body?.apply===true) return errorResponse('Este endpoint executa somente inspeção.',400,'PROJECT_PREVIEW_DRY_RUN_ONLY');
    const limit=Math.min(25,Math.max(1,Number(body?.limit) || 25)), afterId=Math.max(0,Number(body?.afterId) || 0);
    const ids=Array.isArray(body?.projectIds) ? body.projectIds.filter(n=>Number.isSafeInteger(n)&&n>0).slice(0,25) : [];
    const {results}=await env.DB.prepare(`SELECT * FROM projects WHERE organization_id=? AND active=1 AND id>?
      AND preview_status IN ('UNKNOWN','MISSING','FAILED','READY','PENDING') ${ids.length ? `AND id IN (${ids.map(()=>'?').join(',')})` : ''} ORDER BY id LIMIT ?`)
      .bind(organizationId,afterId,...ids,limit).all();
    const summary={inspected:0,ready:0,missing:0,corrupt:0,errors:0}, records=[];
    for (const project of results || []) {
      summary.inspected++;
      const revision=project.preview_revision ?? 0;
      const record={projectId:project.id,organizationId,slug:project.slug,configRevision:project.config_revision,thumbnailStatus:project.preview_status,
        thumbnailRevision:project.preview_revision,lastAttemptAt:project.preview_updated_at,lastError:project.preview_last_error,
        artifactId:project.preview_artifact_id ?? null,expectedSnapshot:{configRevision:project.config_revision,thumbnailStatus:project.preview_status,thumbnailRevision:project.preview_revision,artifactId:project.preview_artifact_id ?? null}};
      try {
        let artifact=null;
        if (project.preview_artifact_id) artifact=await env.DB.prepare("SELECT * FROM project_preview_operations WHERE id=? AND project_id=? AND organization_id=? AND state='READY'")
          .bind(project.preview_artifact_id,project.id,organizationId).first();
        if (project.preview_artifact_id && !artifact) throw Object.assign(new Error(),{status:422,code:'PROJECT_PREVIEW_ARTIFACT_REFERENCE_INVALID'});
        const fileName=artifact ? previewArtifactFileName(artifact) : revision>0 ? getRevisionedPreviewFileNameFromConfigFile(project.default_config_file || 'config.kepler.json',revision) : getPreviewFileNameFromConfigFile(project.default_config_file || 'config.kepler.json');
        const root=artifact?.storage_root || project.dropbox_root_path;
        const metadata=await getDropboxMetadata(env,root,fileName);
        const response=await downloadDropboxBinaryFile(env,root,fileName);
        const checked=await validatePreviewPng(await readBoundedPreview(response.body,{expectedBytes:artifact?.size_bytes ?? null}));
        if (artifact && checked.imageChecksum!==artifact.image_checksum) throw Object.assign(new Error(),{status:422,code:'THUMBNAIL_CHECKSUM_MISMATCH'});
        summary.ready++; Object.assign(record,{classification:'VERIFIED_PNG',imageRevision:artifact?.revision ?? revision,sizeBytes:checked.sizeBytes,imageChecksum:checked.imageChecksum,
          providerSize:metadata.size,proposal:project.preview_status==='READY' ? 'NONE' : 'REVIEW_CONDITIONAL_POINTER_REPAIR'});
      } catch(error) {
        const missing=previewStorageNotFound(error), corrupt=[413,422].includes(Number(error.status));
        summary[missing?'missing':corrupt?'corrupt':'errors']++;
        Object.assign(record,{classification:missing?'ABSENT':corrupt?'CORRUPT':'PROVIDER_UNAVAILABLE',errorCode:error.code || 'PROJECT_PREVIEW_INSPECTION_FAILED',
          proposal:missing?'CAPTURE_AUTHORIZED_SNAPSHOT':corrupt?'PUBLISH_NEW_ARTIFACT':'RESOLVE_ACCESS_OR_PROVIDER'});
      }
      records.push(record);
    }
    return jsonResponse({ok:true,dryRun:true,organizationId,limit,...summary,records,nextAfterId:records.length===limit ? records.at(-1).projectId : null},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return errorResponse('Não foi possível inspecionar as prévias.',Number(error.status || 500),error.code || 'PROJECT_PREVIEW_INSPECT_ERROR'); }
}
