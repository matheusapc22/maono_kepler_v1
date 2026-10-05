import {requestChangeInformation} from './project-change-request-feedback.js';
import { resolveChangeProjectContext } from './change-project-context.js';
import { isChangeRequestLifecycleSchemaReady, transitionRequestLifecycle, publicRequestLifecycle, cc08Enabled } from './project-change-request-lifecycle.js';
import { INLINE_CONFIG_HARD_LIMIT_BYTES, isLargeProjectConfigRequest } from './project-save-operation-payload.js';
import { savePreparedDomainOperation, manifestForProjectBytes } from './project-save-domain-adapter.js';
import { publicProjectSaveOperation, getProjectSaveOperation } from './project-save-operations.js';
import { assertSaveDeployCompatibility } from './save-deploy-contract.js';
import { primarySaveEnvironment } from './project-save-protocol.js';
import { bindApplyArtifact, readApplyArtifact } from './project-change-request-apply-artifact.js';
import { requireSession } from "./auth.js";
import { can, recordAuditLog } from "./permissions.js";
import { getAuthorizedProject } from "./projects.js";
import {
  PROJECT_MAP_ROUTE_MODES,
  resolveEffectiveProjectMapRoute,
} from "./project-map-route-policy.js";
import { ensureProjectChangeRequestSchema } from "./project-change-requests.js";
import { getProjectConfigRevision } from "./project-config-revisions.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import {
  buildProjectConfigArtifact,
  validateProjectConfig,
  verifyProjectConfigBytes,
} from "./project-config-integrity.js";
import {
  buildProjectChangeProposal,
  isProjectChangeOperationConflict,
} from "./project-change-request-operations.js";
import { createProjectConfigRevisionDirectDescriptor } from "./project-config-revision-direct-delivery.js";

const REVIEW_CONTRACT_VERSION = 2;
const REVIEW_ACTIVE_STATUSES = new Set([
  "submitted",
  "under_review",
  "approved",
  "applying",
]);
const REVIEW_TERMINAL_STATUSES = new Set([
  "rejected",
  "conflict",
  "applied",
  "superseded",
]);

function reviewError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;
  if (!db || typeof db.prepare !== "function") {
    throw reviewError(
      "Banco de dados D1 não configurado.",
      500,
      "DATABASE_NOT_CONFIGURED",
    );
  }
  return db;
}

function text(value) {
  return String(value ?? "").trim();
}

function correlationId(request) {
  return (
    request?.headers?.get("X-Correlation-Id")?.trim() ||
    request?.headers?.get("X-Request-Id")?.trim() ||
    crypto.randomUUID()
  );
}

function projectContext(project) {
  return {
    project,
    projectId: project.id,
    projectSlug: project.slug,
    organizationId: project.organization_id,
    scopeType: "project",
  };
}

function publicChangeRequest(row, operations = undefined) {
  const result = {
    ...publicRequestLifecycle(row),
    id: row.id,
    organizationId: Number(row.organization_id),
    projectId: Number(row.project_id),
    requestedByUserId: Number(row.requested_by_user_id),
    ticketId: row.ticket_id ? Number(row.ticket_id) : null,
    baseRevision: Number(row.base_revision),
    status: row.status,
    reason: row.reason,
    operationCount: Number(row.operation_count ?? operations?.length ?? 0),
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (operations) result.operations = operations;
  return result;
}

async function loadChangeRequest(db, projectId, requestId) {
  return db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o
                WHERE o.change_request_id = r.id) AS operation_count
         FROM project_change_requests r
        WHERE r.id = ? AND r.project_id = ?
        LIMIT 1`,
    )
    .bind(requestId, projectId)
    .first();
}

async function loadOperations(db, requestId) {
  const result = await db
    .prepare(
      `SELECT id, sequence, operation_type, operation_json, created_at
         FROM project_change_operations
        WHERE change_request_id = ?
        ORDER BY sequence ASC`,
    )
    .bind(requestId)
    .all();
  return (result?.results || []).map((row) => {
    const parsed = JSON.parse(row.operation_json);
    return { ...parsed, sequence: Number(row.sequence) };
  });
}

export async function requireReviewerProject(env, request, slug, { apply = false } = {}) {
  await ensureProjectChangeRequestSchema(env);
  const sessionUser = await requireSession(env, request);
  const {user, project} = await resolveChangeProjectContext(env, sessionUser, slug);
  if (!project) {
    throw reviewError("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
  }

  const context = projectContext(project);
  const viewDecision = await can(env, user, "project.view", context);
  if (!viewDecision.allowed) {
    throw reviewError(
      "Você não possui acesso a este projeto.",
      403,
      "PROJECT_VIEW_FORBIDDEN",
    );
  }

  const route = resolveEffectiveProjectMapRoute(user, project);
  const editDecision = await can(env, user, "project.map.edit", context);
  if (route.mode !== PROJECT_MAP_ROUTE_MODES.EDITOR || !editDecision.allowed) {
    throw reviewError(
      "Somente um Editor do projeto pode revisar solicitações de alteração.",
      403,
      "CHANGE_REQUEST_REVIEW_FORBIDDEN",
    );
  }

  const saveDecision = await can(env, user, "project.save", context);
  if (apply && !saveDecision.allowed) {
    throw reviewError(
      "Você não possui permissão para aplicar alterações neste projeto.",
      403,
      "CHANGE_REQUEST_APPLY_FORBIDDEN",
    );
  }

  return {
    user,
    project,
    route,
    permissions: {
      canReview: true,
      canApply: saveDecision.allowed,
    },
  };
}

async function requireReviewerChangeRequest(
  env,
  request,
  slug,
  requestId,
  options = {},
) {
  const context = await requireReviewerProject(env, request, slug, options);
  const db = getDb(env);
  const row = await loadChangeRequest(db, context.project.id, requestId);
  if (!row) {
    throw reviewError(
      "Solicitação de alteração não encontrada.",
      404,
      "CHANGE_REQUEST_NOT_FOUND",
    );
  }
  if (Number(row.organization_id) !== Number(context.project.organization_id)) {
    throw reviewError(
      "Solicitação de alteração não encontrada.",
      404,
      "CHANGE_REQUEST_NOT_FOUND",
    );
  }
  const operations = await loadOperations(db, row.id);
  return { ...context, db, row, operations, canonical: await isChangeRequestLifecycleSchemaReady(env) };
}

async function baseRevisionLedger(env, project, revision) {
  const ledger = await getProjectConfigRevision(env, project.id, revision);
  if (!ledger || ledger.status !== "READY") {
    throw reviewError(
      "A revisão-base da solicitação não está disponível para Review.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_UNAVAILABLE",
      { baseRevision: revision },
    );
  }
  return ledger;
}

async function readVerifiedBaseRevisionForApply(env, project, revision) {
  const ledger = await baseRevisionLedger(env, project, revision);
  if(Number(ledger.size_bytes)>INLINE_CONFIG_HARD_LIMIT_BYTES) throw reviewError('Use o transporte em blocos para aplicar este mapa.',413,'CHANGE_REQUEST_LARGE_APPLY_REQUIRED');
  const repository = resolveMapConfigRepository(env);
  const stored = await repository.getRevision({
    project,
    revision,
    storageRef: ledger.storage_ref,
  });
  await verifyProjectConfigBytes(stored.bytes, {
    expectedChecksum: ledger.checksum,
    expectedAlgorithm: ledger.checksum_algorithm,
    expectedSizeBytes: ledger.size_bytes,
  });

  let config;
  try {
    const textValue = new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes);
    config = JSON.parse(textValue);
  } catch (error) {
    throw reviewError(
      "A revisão-base não contém JSON UTF-8 válido.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_INVALID",
      { baseRevision: revision, cause: error?.name || "PARSE_ERROR" },
    );
  }
  validateProjectConfig(config, { bytes: stored.bytes });
  return { config, ledger };
}

function revisionConflict(row, project) {
  const baseRevision = Number(row.base_revision || 0);
  const currentRevision = Number(project.config_revision || 0);
  if (row.status === "applied") return null;
  if (currentRevision === baseRevision) return null;
  if (row.status === "applying" && currentRevision === baseRevision + 1) {
    return null;
  }
  return {
    code: "CHANGE_REQUEST_REVIEW_CONFLICT",
    message: `A solicitação foi criada sobre a REV ${baseRevision}, mas o projeto está na REV ${currentRevision}.`,
    baseRevision,
    currentRevision,
  };
}

async function buildWorkspace(env, request, context) {
  const baseRevision = Number(context.row.base_revision || 0);
  const ledger = await baseRevisionLedger(env, context.project, baseRevision);
  const delivery = await createProjectConfigRevisionDirectDescriptor(env, {
    project: context.project,
    ledger,
    revision: baseRevision,
    correlationId: correlationId(request),
  });
  let operationSummary=null;
  try {
    operationSummary=await context.db.prepare(`SELECT operation_id AS operationId,state,error_code AS errorCode,payload_stored_at AS payloadStoredAt
      FROM project_save_operations WHERE organization_id=? AND project_id=? AND kind='change-request'
        AND json_extract(domain_json,'$.changeRequestId')=? ORDER BY created_at DESC LIMIT 1`)
      .bind(context.project.organization_id,context.project.id,context.row.id).first();
  }catch(error){if(!/no such table/i.test(String(error?.message)))throw error;}
  const blocked=operationSummary && ["CONFLICT","FAILED_FINAL"].includes(operationSummary.state);
  const conflict = blocked ? {
    code:operationSummary.errorCode || "CHANGE_REQUEST_APPLY_BLOCKED",
    message:"A publicação desta proposta foi bloqueada. A proposta original foi preservada para revisão.",
    baseRevision,currentRevision:Number(context.project.config_revision || 0),
  } : revisionConflict(context.row, context.project);
  const status = context.row.status;
  const information=context.canonical ? await context.db.prepare('SELECT feedback,version,created_at FROM project_change_request_feedback WHERE change_request_id=? ORDER BY version DESC LIMIT 1').bind(context.row.id).first():null;

  return {
    contractVersion: REVIEW_CONTRACT_VERSION,
    changesEnabled: cc08Enabled(env),
    canonicalLifecycle: context.canonical,
    informationRequested: information,
    saveOperation: operationSummary,
    changeRequest: publicChangeRequest(context.row),
    project: {
      id: context.project.id,
      slug: context.project.slug,
      name: context.project.name,
      currentRevision: Number(context.project.config_revision || 0),
    },
    base: {
      revision: baseRevision,
      sizeBytes: Number(ledger.size_bytes || delivery.sizeBytes || 0),
      schemaName: String(ledger.schema_name || delivery.schemaName || "legacy-kepler"),
      schemaVersion: Number(ledger.schema_version || delivery.schemaVersion || 1),
      delivery,
    },
    operations: context.operations,
    conflict,
    permissions: {
      canApprove:
        context.permissions.canReview &&
        !information &&
        !conflict &&
        (status === "submitted" || status === "under_review"),
      canReject:
        context.permissions.canReview &&
        (status === "submitted" || status === "under_review"),
      canApply:
        context.permissions.canApply &&
        !conflict &&
        (context.canonical ? ["approved","applying"] : ["under_review", "approved", "applying"]).includes(status),
    },
  };
}

async function transitionStatus(db, row, fromStatuses, nextStatus, options = {}) {
  if (row.lifecycle_version !== undefined) return transitionRequestLifecycle(db,row,fromStatuses,nextStatus,options);
  const expected = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
  if (row.status === nextStatus) return row;
  if (!expected.includes(row.status)) return null;
  const placeholders = expected.map(() => "?").join(", ");
  return db
    .prepare(
      `UPDATE project_change_requests
          SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND project_id = ? AND status IN (${placeholders})
        RETURNING *`,
    )
    .bind(nextStatus, row.id, row.project_id, ...expected)
    .first();
}

async function reloadRow(db, row) {
  return loadChangeRequest(db, row.project_id, row.id);
}





async function safeTicketEvent(db, row, actor, eventType, metadata = {}) {
  if (!row.ticket_id || row.lifecycle_version !== undefined) return;
  try {
    await db
      .prepare(
        `INSERT INTO ticket_events (
           organization_id, ticket_id, event_type, actor_user_id, metadata
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        row.organization_id,
        row.ticket_id,
        eventType,
        actor?.id ?? null,
        JSON.stringify({
          source: "project_change_request_review",
          changeRequestId: row.id,
          projectId: row.project_id,
          baseRevision: Number(row.base_revision || 0),
          ...metadata,
        }),
      )
      .run();
  } catch (error) {
    console.warn(
      "[Maono change request review] Falha ao registrar evento do ticket:",
      error?.message || error,
    );
  }
}

async function safeAudit(
  env,
  request,
  row,
  actor,
  action,
  metadata = {},
  result = "success",
) {
  try {
    await recordAuditLog(env, {
      actorUserId: actor?.id ?? null,
      organizationId: row.organization_id,
      projectId: row.project_id,
      action,
      resourceType: "project_change_request",
      resourceId: row.id,
      result,
      metadata: {
        changeRequestId: row.id,
        ticketId: row.ticket_id || null,
        baseRevision: Number(row.base_revision || 0),
        ...metadata,
      },
      request,
    });
  } catch (error) {
    console.warn(
      "[Maono change request review] Falha de auditoria:",
      error?.message || error,
    );
  }
}

async function ensureUnderReview(env, request, context) {
  let row = context.row;
  if (row.status !== "submitted") return row;
  const updated = await transitionStatus(context.db, row, "submitted", "under_review", {actor:context.user});
  row = updated || (await reloadRow(context.db, row));
  if (updated && row?.status === "under_review") {
    await Promise.all([
      safeTicketEvent(
        context.db,
        row,
        context.user,
        "project.change_request.review_started",
      ),
      safeAudit(
        env,
        request,
        row,
        context.user,
        "project.change_request.review_started",
      ),
    ]);
  }
  return row;
}

async function ensureApproved(env, request, context) {
  let row = await ensureUnderReview(env, request, context);
  if (
    row.status === "approved" ||
    row.status === "applying" ||
    row.status === "applied"
  ) {
    return row;
  }
  if (row.status !== "under_review") {
    throw reviewError(
      "A solicitação não está em estado compatível com aprovação.",
      409,
      "CHANGE_REQUEST_REVIEW_STATE_CONFLICT",
      { status: row.status },
    );
  }
  const updated = await transitionStatus(context.db, row, "under_review", "approved", {actor:context.user});
  row = updated || (await reloadRow(context.db, row));
  if (updated && row?.status === "approved") {
    await Promise.all([
      safeTicketEvent(
        context.db,
        row,
        context.user,
        "project.change_request.approved",
      ),
      safeAudit(
        env,
        request,
        row,
        context.user,
        "project.change_request.approved",
      ),
    ]);
  }
  return row;
}

async function markConflict(env, request, context, row, error, details = {}) {
  const updated = await transitionStatus(
    context.db,
    row,
    ["under_review", "approved", "applying"],
    "conflict",
    {actor:context.user},
  );
  const current = updated || (await reloadRow(context.db, row));
  if (!updated && current?.status !== "conflict") return current;
  await Promise.all([
    safeTicketEvent(
      context.db,
      current || row,
      context.user,
      "project.change_request.conflict",
      {
        code: error?.code || "CHANGE_REQUEST_REVIEW_CONFLICT",
        ...details,
      },
    ),
    safeAudit(
      env,
      request,
      current || row,
      context.user,
      "project.change_request.conflict",
      { code: error?.code || "CHANGE_REQUEST_REVIEW_CONFLICT", ...details },
      "conflict",
    ),
  ]);
  return current;
}

export async function getProjectChangeRequestReview(env, request, slug, requestId) {
  const context = await requireReviewerChangeRequest(env, request, slug, requestId);
  return buildWorkspace(env, request, context);
}

export async function reviewProjectChangeRequestAction(
  env,
  request,
  slug,
  requestId,
  input,
) {
  assertMutationOrigin(request);
  const action = text(input?.action).toLowerCase();
  const context = await requireReviewerChangeRequest(env, request, slug, requestId);

  if(action==='request_information' && context.canonical && cc08Enabled(env)) {
    await requestChangeInformation(context,input?.comment);
    return buildWorkspace(env,request,context);
  }
  if (action === "start") {
    context.row = await ensureUnderReview(env, request, context);
    return buildWorkspace(env, request, context);
  }

  if (action === "approve") {
    if(context.canonical && await context.db.prepare('SELECT 1 FROM project_change_request_feedback WHERE change_request_id=? LIMIT 1').bind(context.row.id).first()) throw reviewError('Aguarde o reenvio da proposta.',409,'CHANGE_INFORMATION_PENDING');
    const conflict = revisionConflict(context.row, context.project);
    if (conflict) {
      throw reviewError(
        conflict.message,
        409,
        conflict.code,
        conflict,
      );
    }
    if(context.canonical && cc08Enabled(env)) {
      await bindApplyArtifact(context, input?.artifact);
    }
    context.row = await ensureApproved(env, request, context);
    return buildWorkspace(env, request, context);
  }

  if (action === "reject") {
    const comment = text(input?.comment);
    if (!comment) {
      throw reviewError(
        "Informe o motivo da rejeição.",
        400,
        "CHANGE_REQUEST_REJECTION_REASON_REQUIRED",
      );
    }
    if (!["submitted", "under_review"].includes(context.row.status)) {
      throw reviewError(
        "A solicitação não está em estado compatível com rejeição.",
        409,
        "CHANGE_REQUEST_REVIEW_STATE_CONFLICT",
        { status: context.row.status },
      );
    }
    const updated = await transitionStatus(
      context.db,
      context.row,
      ["submitted", "under_review"],
      "rejected",
      {actor:context.user,feedback:comment},
    );
    context.row = updated || (await reloadRow(context.db, context.row));
    if (context.row?.status !== "rejected") {
      throw reviewError(
        "A solicitação mudou enquanto a rejeição era processada.",
        409,
        "CHANGE_REQUEST_REVIEW_STATE_CONFLICT",
        { status: context.row?.status || null },
      );
    }
    if (updated) {
      await Promise.all([
        safeTicketEvent(
          context.db,
          context.row,
          context.user,
          "project.change_request.rejected",
          { comment: comment.slice(0, 2000) },
        ),
        safeAudit(
          env,
          request,
          context.row,
          context.user,
          "project.change_request.rejected",
          { commentPresent: true },
        ),
      ]);
    }
    return buildWorkspace(env, request, context);
  }

  throw reviewError(
    "Ação de Review não suportada.",
    400,
    "CHANGE_REQUEST_REVIEW_ACTION_INVALID",
    { action },
  );
}

function canonicalAppliedRevision(context) {
 const revision=context.row.applied_revision;
 if(context.canonical && !Number.isSafeInteger(revision)) throw reviewError('A revisão aplicada histórica exige reconciliação com evidências.',409,'CHANGE_REQUEST_APPLIED_REVISION_UNKNOWN');
 return context.canonical ? revision : Number(context.row.base_revision)+1;
}
function assertMutationOrigin(request) {
 const origin=request.headers.get('Origin');
 if(origin && origin!==new URL(request.url).origin) throw reviewError('Origem inválida.',403,'CHANGE_REQUEST_ORIGIN_DENIED');
}
export async function applyProjectChangeRequest(env, request, slug, requestId) {
  env = primarySaveEnvironment(env);
  assertMutationOrigin(request);
  await assertSaveDeployCompatibility(env, request);
  const context = await requireReviewerChangeRequest(env, request, slug, requestId, {apply:true});
  if (context.row.status === "applied") {
    return {workspace:await buildWorkspace(env,request,context),appliedRevision:canonicalAppliedRevision(context),idempotent:true,projectIdentity:{id:context.project.id,slug:context.project.slug}};
  }
  if (!context.canonical) throw reviewError("Atualize a estrutura de revisão antes de aplicar.",503,"CHANGE_REQUEST_LIFECYCLE_SCHEMA_OUTDATED");
  if (!["approved","applying"].includes(context.row.status)) throw reviewError("Aprove a proposta antes de aplicar.",409,"CHANGE_REQUEST_APPROVAL_REQUIRED");
  const baseRevision=Number(context.row.base_revision);
  const streaming=isLargeProjectConfigRequest(request);
  if (cc08Enabled(env) && !streaming) throw reviewError("Use o artefato aprovado para aplicar.",409,"CHANGE_REQUEST_APPROVED_ARTIFACT_REQUIRED");
  let manifest,body;
  if (streaming) {
    const artifact=await readApplyArtifact(context,request);
    manifest={
      checksumAlgorithm:"dropbox-content-hash",checksum:artifact.checksum,sizeBytes:artifact.sizeBytes,
      serializationVersion:1,schemaName:"legacy-kepler",schemaVersion:1,contentType:"application/json; charset=utf-8",
      configVersion:request.headers.get("X-Maono-Config-Version"),datasetCount:Number(request.headers.get("X-Maono-Dataset-Count")),
    };
    body=request.body;
  } else {
    const base=await readVerifiedBaseRevisionForApply(env,context.project,baseRevision);
    let proposal;
    try {proposal=buildProjectChangeProposal({baseConfig:base.config,operations:context.operations});}
    catch(error){if(isProjectChangeOperationConflict(error))await markConflict(env,request,context,context.row,error);throw error;}
    const artifact=await buildProjectConfigArtifact(proposal.config);
    body=artifact.bytes;
    manifest=await manifestForProjectBytes(body,proposal.config);
    await context.db.prepare('INSERT INTO project_change_request_apply_artifacts(change_request_id,checksum,size_bytes,base_revision,approved_by) VALUES(?,?,?,?,?) ON CONFLICT(change_request_id) DO NOTHING').bind(context.row.id,manifest.checksum,manifest.sizeBytes,baseRevision,context.user.id).run();
    const approved=await context.db.prepare('SELECT * FROM project_change_request_apply_artifacts WHERE change_request_id=?').bind(context.row.id).first();
    if(approved.checksum!==manifest.checksum || Number(approved.size_bytes)!==manifest.sizeBytes) throw reviewError('O artefato diverge da proposta aprovada.',409,'CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT');
  }
  if (context.row.status==="approved") {
    context.row=await transitionStatus(context.db,context.row,"approved","applying",{actor:context.user}) || await reloadRow(context.db,context.row);
  }
  if (context.row.status!=="applying") throw reviewError("A solicitação mudou durante a aplicação.",409,"CHANGE_REQUEST_REVIEW_STATE_CONFLICT");
  const operation=await savePreparedDomainOperation(env,{
    project:context.project,actor:context.user,operationId:`change-request-${context.row.id}`,
    kind:"change-request",expectedConfigRevision:baseRevision,manifest,body,
    domain:{changeRequestId:context.row.id,changeRequestVersion:Number(context.row.lifecycle_version)},
  });
  context.row=await reloadRow(context.db,context.row);
  const refreshedProject=await getAuthorizedProject(env,context.user,slug);
  if(refreshedProject)context.project=refreshedProject;
  const status=publicProjectSaveOperation(operation,context.project);
  if(status.state==="CONFLICT") throw reviewError("O projeto mudou antes da publicação. A proposta foi preservada.",409,"CHANGE_REQUEST_REVIEW_CONFLICT");
  if(status.state==="FAILED_FINAL") throw reviewError("Não foi possível publicar a proposta. Consulte o motivo da operação.",409,"CHANGE_REQUEST_APPLY_FAILED_FINAL",{operation:status});
  return {
    workspace:await buildWorkspace(env,request,context),
    appliedRevision:status.receipt?.publishedRevision ?? status.receipt?.revision ?? null,
    pending:status.state!=="PUBLISHED",operation:status,
    idempotent:status.state==="PUBLISHED",projectIdentity:{id:context.project.id,slug:context.project.slug},
  };
}

export async function getProjectChangeRequestApplyStatus(env,request,slug,requestId) {
  env=primarySaveEnvironment(env);
  const context=await requireReviewerChangeRequest(env,request,slug,requestId);
  const operation=await getProjectSaveOperation(env,{organizationId:context.project.organization_id,actorUserId:context.user.id,projectId:context.project.id,operationId:`change-request-${context.row.id}`});
  if (!operation) throw reviewError("Operação não encontrada.",404,"SAVE_OPERATION_NOT_FOUND");
  return publicProjectSaveOperation(operation,context.project);
}
