import { errorResponse,jsonResponse,methodNotAllowed } from "../../../../_lib/http.js";
import { requireSession } from "../../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../../_lib/projects.js";
import { requireProjectPermission } from "../../../../_lib/permissions.js";
import { downloadDropboxBinaryFile,getPreviewFileNameFromConfigFile,getRevisionedPreviewFileNameFromConfigFile } from "../../../../_lib/dropbox.js";
import { getProjectPreviewState,normalizePreviewRevision,normalizePreviewStatus,publicProjectPreview } from "../../../../_lib/project-preview.js";
import { readBoundedPreview,validatePreviewPng,previewError,MAX_PREVIEW_BYTES } from "../../../../_lib/project-preview-png.js";
import { readPreviewJsonBody,previewArtifactFileName,previewStorageNotFound,uploadPreviewPayload } from "../../../../_lib/project-preview-payload.js";
import { registerPreviewOperation,getPreviewOperation,publicPreviewOperation,acquirePreviewUpload,markPreviewPayloadStored,processPreviewOperation,
  failPreviewUpload,failWaitingPreview,previewDatabase,verifyReadyPreviewReceipt } from "../../../../_lib/project-preview-operations.js";

function organization(project) { return project.organization_id ?? project.organizationId; }
async function permission(env,request,user,project,action) {
  await requireProjectPermission(env,request,action,{project,projectId:project.id,projectSlug:project.slug,organizationId:organization(project)},
    {user,auditOnSuccess:false,auditAction:'projects.thumbnail',resourceType:'project',resourceId:project.slug});
}
function snapshot(state) { return JSON.stringify([state?.organization_id,state?.config_revision,state?.config_checksum,state?.dropbox_root_path,
  state?.default_config_file,state?.preview_artifact_id,state?.preview_revision,state?.preview_status]); }
async function handleGet({env,request},user,project) {
  await permission(env,request,user,project,'project.view');
  const state=await getProjectPreviewState(env,{projectId:project.id,organizationId:organization(project)});
  if (!state) throw previewError('PROJECT_NOT_FOUND',404);
  const url=new URL(request.url), requestedArtifact=url.searchParams.get('artifactId');
  const rawRevision=url.searchParams.get('v'), revision=normalizePreviewRevision(rawRevision);
  if (rawRevision!==null && revision===null) throw previewError('THUMBNAIL_REVISION_INVALID',400);
  const status=normalizePreviewStatus(state.preview_status), known=normalizePreviewRevision(state.preview_revision);
  const artifactId=requestedArtifact || state.preview_artifact_id;
  let fileName,root=state.dropbox_root_path,imageRevision,artifact=null;
  if (artifactId) {
    artifact=await previewDatabase(env).prepare("SELECT * FROM project_preview_operations WHERE id=? AND organization_id=? AND project_id=? AND state='READY'")
      .bind(artifactId,organization(project),project.id).first();
    if (!artifact || (revision!==null && artifact.revision!==revision)) throw previewError('PROJECT_THUMBNAIL_REVISION_NOT_FOUND',404);
    imageRevision=artifact.revision; fileName=previewArtifactFileName(artifact); root=artifact.storage_root;
    if (root!==state.dropbox_root_path) throw previewError('PROJECT_THUMBNAIL_REVISION_NOT_FOUND',404);
  } else {
    const fallback=known!==null && revision!==null && ['FAILED','PENDING'].includes(status);
    if (!['READY','UNKNOWN'].includes(status) && !fallback) throw previewError('PROJECT_THUMBNAIL_NOT_READY',404);
    imageRevision=status==='UNKNOWN' ? 0 : known;
    if (imageRevision===null) throw previewError('PROJECT_THUMBNAIL_NOT_READY',404);
    if (revision!==null && revision!==imageRevision) return errorResponse('A revisão solicitada não está disponível.',404,'PROJECT_THUMBNAIL_REVISION_NOT_FOUND',
      {...publicProjectPreview(state),thumbnailRevision:imageRevision});
    fileName=imageRevision>0 ? getRevisionedPreviewFileNameFromConfigFile(state.default_config_file || 'config.kepler.json',imageRevision)
      : getPreviewFileNameFromConfigFile(state.default_config_file || 'config.kepler.json');
  }
  const downloaded=await downloadDropboxBinaryFile(env,root,fileName);
  const bytes=await readBoundedPreview(downloaded.body,{expectedBytes:artifact?.size_bytes ?? null});
  const checked=await validatePreviewPng(bytes);
  if (artifact && checked.imageChecksum!==artifact.image_checksum) throw previewError('THUMBNAIL_CHECKSUM_MISMATCH');
  // Revalidate both identity and permission after the provider read, before 200/304.
  const current=await getProjectPreviewState(env,{projectId:project.id,organizationId:organization(project)});
  const sameStorage = current && current.id === state.id && current.organization_id === state.organization_id &&
    current.dropbox_root_path === state.dropbox_root_path && current.default_config_file === state.default_config_file &&
    (current.organization_file_id ?? null) === (state.organization_file_id ?? null);
  if (!sameStorage || (!requestedArtifact && snapshot(current)!==snapshot(state))) throw previewError('PROJECT_THUMBNAIL_REVISION_NOT_FOUND',404);
  const freshUser=await requireSession(env,request), freshProject=await getAuthorizedProject(env,freshUser,project.slug);
  if (!freshProject || freshProject.id!==project.id || organization(freshProject)!==organization(project)) throw previewError('PROJECT_NOT_FOUND',404);
  await permission(env,request,freshUser,freshProject,'project.view');
  const etag=`"png-${checked.imageChecksum}"`;
  const headers={'Content-Type':'image/png','Cache-Control':'private, no-cache','ETag':etag,'Vary':'Cookie, Authorization',
    'X-Content-Type-Options':'nosniff','X-Maono-Thumbnail-Revision':String(imageRevision)};
  if (artifact) headers['X-Maono-Thumbnail-Artifact']=artifact.id;
  const matches=(request.headers.get('If-None-Match') || '').split(',').map(s=>s.trim()).includes(etag);
  return new Response(matches ? null : bytes,{status:matches ? 304 : 200,headers});
}
function envelope(operation,status=200) {
  return jsonResponse({ok:true,operation:publicPreviewOperation(operation)}, {status,headers:{'Cache-Control':'no-store',...(status===202 ? {'Retry-After':'2'} : {})}});
}
async function findOperation(env,user,project,operationId) {
  if (!operationId) throw previewError('PROJECT_PREVIEW_OPERATION_ID_REQUIRED',400);
  const op=await getPreviewOperation(env,{organizationId:organization(project),projectId:project.id,actorUserId:user.id,operationId});
  if (!op) throw previewError('PROJECT_PREVIEW_OPERATION_NOT_FOUND',404); return op;
}
async function handlePut({env,request},user,project) {
  const operationId=new URL(request.url).searchParams.get('operationId');
  let op=await findOperation(env,user,project,operationId);
  if (op.state==='READY') {
    op=await verifyReadyPreviewReceipt(env,{operation:op});
    const freshUser=await requireSession(env,request), freshProject=await getAuthorizedProject(env,freshUser,project.slug);
    if (!freshProject || freshUser.id!==user.id || freshProject.id!==project.id || organization(freshProject)!==organization(project)) throw previewError('PROJECT_NOT_FOUND',404);
    await permission(env,request,freshUser,freshProject,'project.save');
    return envelope(op);
  }
  if (['FAILED_FINAL','SUPERSEDED'].includes(op.state)) return envelope(op,409);
  if (!op.payload_stored_at) {
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()!=='image/png') throw previewError('INVALID_THUMBNAIL_CONTENT_TYPE',400);
    if (Number(request.headers.get('Content-Length') || 0)>MAX_PREVIEW_BYTES) throw previewError('THUMBNAIL_TOO_LARGE',413);
    op=await acquirePreviewUpload(env,{operation:op});
    if (['FAILED_FINAL','SUPERSEDED'].includes(op.state)) return envelope(op,409);
    if (!op.payload_stored_at) {
      try {
        const artifact=await uploadPreviewPayload(env,{operation:op,project,body:request.body});
        op=await markPreviewPayloadStored(env,{operation:op,artifact});
      } catch(error) { await failPreviewUpload(env,{operation:op,error}); throw error; }
    }
  }
  op=await processPreviewOperation(env,{operation:op});
  if (['FAILED_FINAL','SUPERSEDED'].includes(op.state)) return envelope(op,409);
  if (!op.payload_stored_at) throw previewError('PROJECT_PREVIEW_UPLOAD_BUSY',409);
  // 202 is legal only after immutable bytes AND the journal/outbox transaction.
  return envelope(op,op.state==='READY' ? 200 : 202);
}
export async function onRequest(context) {
  const {request,params}=context;
  const env={...context.env,DB:context.env.DB?.withSession ? context.env.DB.withSession('first-primary') : context.env.DB};
  if (!['GET','POST','PUT','PATCH'].includes(request.method)) return methodNotAllowed(['GET','POST','PUT','PATCH']);
  try {
    const user=await requireSession(env,request);
    let slug; try { slug=decodeURIComponent(String(params?.slug || '')).trim(); } catch { throw previewError('PROJECT_SLUG_REQUIRED',400); }
    if (!slug) throw previewError('PROJECT_SLUG_REQUIRED',400);
    const project=await getAuthorizedProject(env,user,slug);
    if (!project) throw previewError('PROJECT_NOT_FOUND',404);
    if (request.method==='GET') return await handleGet({...context,env},user,project);
    await permission(env,request,user,project,'project.save');
    if (request.method==='PUT') return await handlePut({...context,env},user,project);
    const body=await readPreviewJsonBody(request);
    if (request.method==='POST') return envelope(await registerPreviewOperation(env,{actor:user,project,manifest:body?.manifest || body}),201);
    const operation=await findOperation(env,user,project,body?.operationId);
    return envelope(await failWaitingPreview(env,{operation,errorCode:body?.errorCode}));
  } catch(error) {
    return errorResponse('Não foi possível processar a visualização deste projeto.',previewStorageNotFound(error) ? 404 : Number(error.status || 500),
      previewStorageNotFound(error) ? 'PROJECT_THUMBNAIL_NOT_FOUND' : error.code || 'PROJECT_THUMBNAIL_ERROR');
  }
}
