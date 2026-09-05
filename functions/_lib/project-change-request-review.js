import { requireSession } from "./auth.js";
import { can, recordAuditLog } from "./permissions.js";
import { getAuthorizedProject } from "./projects.js";
import {
  PROJECT_MAP_ROUTE_MODES,
  resolveEffectiveProjectMapRoute,
} from "./project-map-route-policy.js";
import {
  ensureProjectChangeRequestSchema,
} from "./project-change-requests.js";
import { getProjectConfigRevision } from "./project-config-revisions.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import {
  buildProjectConfigArtifact,
  validateProjectConfig,
  verifyProjectConfigBytes,
} from "./project-config-integrity.js";
import { saveVersionedProjectConfig } from "./project-config-service.js";
import {
  buildProjectChangeProposal,
  isProjectChangeOperationConflict,
} from "./project-change-request-operations.js";

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

async function requireReviewerProject(env, request, slug, { apply = false } = {}) {
  await ensureProjectChangeRequestSchema(env);
  const user = await requireSession(env, request);
  const project = await getAuthorizedProject(env, user, slug);
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
  return { ...context, db, row, operations };
}

async function readVerifiedBaseRevision(env, project, revision) {
  const ledger = await getProjectConfigRevision(env, project.id, revision);
  if (!ledger || ledger.status !== "READY") {
    throw reviewError(
      "A revisão-base da solicitação não está disponível para Review.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_UNAVAILABLE",
      { baseRevision: revision },
    );
  }

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

async function buildWorkspace(env, context) {
  const baseRevision = Number(context.row.base_revision || 0);
  const base = await readVerifiedBaseRevision(env, context.project, baseRevision);
  let proposal = null;
  let proposalConflict = null;

  try {
    const built = buildProjectChangeProposal({
      baseConfig: base.config,
      operations: context.operations,
    });
    const artifact = await buildProjectConfigArtifact(built.config);
    proposal = {
      checksum: artifact.checksum,
      sizeBytes: artifact.sizeBytes,
      schemaName: artifact.schemaName,
      schemaVersion: artifact.schemaVersion,
      operationCount: built.operationCount,
      operations: built.projections,
    };
  } catch (error) {
    if (!isProjectChangeOperationConflict(error)) throw error;
    proposalConflict = {
      code: error.code,
      message: error.message,
      details: error.details || null,
    };
  }

  const concurrencyConflict = revisionConflict(context.row, context.project);
  const conflict = proposalConflict || concurrencyConflict;
  const status = context.row.status;

  return {
    changeRequest: publicChangeRequest(context.row),
    project: {
      id: context.project.id,
      slug: context.project.slug,
      name: context.project.name,
      currentRevision: Number(context.project.config_revision || 0),
    },
    base: {
      revision: baseRevision,
      sizeBytes: Number(base.ledger?.size_bytes || 0),
      schemaVersion: Number(base.ledger?.schema_version || 0),
      config: base.config,
    },
    proposal,
    conflict,
    permissions: {
      canApprove:
        context.permissions.canReview &&
        !conflict &&
        (status === "submitted" || status === "under_review"),
      canReject:
        context.permissions.canReview &&
        (status === "submitted" || status === "under_review"),
      canApply:
        context.permissions.canApply &&
        !conflict &&
        ["under_review", "approved", "applying"].includes(status),
    },
  };
}

async function transitionStatus(db, row, fromStatuses, nextStatus) {
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

async function loadPublishedProposalHead(db, row) {
  return db
    .prepare(
      `SELECT id, slug, config_revision, config_checksum
         FROM projects
        WHERE id = ? AND organization_id = ?
        LIMIT 1`,
    )
    .bind(row.project_id, row.organization_id)
    .first();
}

function isSamePublishedProposal(head, baseRevision, checksum) {
  return Boolean(
    head &&
      Number(head.config_revision || 0) === Number(baseRevision) + 1 &&
      text(head.config_checksum).toLowerCase() === text(checksum).toLowerCase(),
  );
}

async function safeTicketEvent(db, row, actor, eventType, metadata = {}) {
  if (!row.ticket_id) return;
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
    console.warn("[Maono change request review] Falha ao registrar evento do ticket:", error?.message || error);
  }
}

async function safeAudit(env, request, row, actor, action, metadata = {}, result = "success") {
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
    console.warn("[Maono change request review] Falha de auditoria:", error?.message || error);
  }
}

async function ensureUnderReview(env, request, context) {
  let row = context.row;
  if (row.status !== "submitted") return row;
  const updated = await transitionStatus(context.db, row, "submitted", "under_review");
  row = updated || await reloadRow(context.db, row);
  if (updated && row?.status === "under_review") {
    await Promise.all([
      safeTicketEvent(context.db, row, context.user, "project.change_request.review_started"),
      safeAudit(env, request, row, context.user, "project.change_request.review_started"),
    ]);
  }
  return row;
}

async function ensureApproved(env, request, context) {
  let row = await ensureUnderReview(env, request, context);
  if (row.status === "approved" || row.status === "applying" || row.status === "applied") {
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
  const updated = await transitionStatus(context.db, row, "under_review", "approved");
  row = updated || await reloadRow(context.db, row);
  if (updated && row?.status === "approved") {
    await Promise.all([
      safeTicketEvent(context.db, row, context.user, "project.change_request.approved"),
      safeAudit(env, request, row, context.user, "project.change_request.approved"),
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
  );
  const current = updated || await reloadRow(context.db, row);
  if (!updated && current?.status !== "conflict") return current;
  await Promise.all([
    safeTicketEvent(context.db, current || row, context.user, "project.change_request.conflict", {
      code: error?.code || "CHANGE_REQUEST_REVIEW_CONFLICT",
      ...details,
    }),
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
  return buildWorkspace(env, context);
}

export async function reviewProjectChangeRequestAction(
  env,
  request,
  slug,
  requestId,
  input,
) {
  const action = text(input?.action).toLowerCase();
  const context = await requireReviewerChangeRequest(env, request, slug, requestId);

  if (action === "start") {
    context.row = await ensureUnderReview(env, request, context);
    return buildWorkspace(env, context);
  }

  if (action === "approve") {
    const workspace = await buildWorkspace(env, context);
    if (workspace.conflict) {
      throw reviewError(
        workspace.conflict.message,
        409,
        workspace.conflict.code,
        workspace.conflict,
      );
    }
    context.row = await ensureApproved(env, request, context);
    return buildWorkspace(env, context);
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
    );
    context.row = updated || await reloadRow(context.db, context.row);
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
        safeTicketEvent(context.db, context.row, context.user, "project.change_request.rejected", {
          comment: comment.slice(0, 2000),
        }),
        safeAudit(env, request, context.row, context.user, "project.change_request.rejected", {
          commentPresent: true,
        }),
      ]);
    }
    return buildWorkspace(env, context);
  }

  throw reviewError(
    "Ação de Review não suportada.",
    400,
    "CHANGE_REQUEST_REVIEW_ACTION_INVALID",
    { action },
  );
}

export async function applyProjectChangeRequest(env, request, slug, requestId) {
  const context = await requireReviewerChangeRequest(env, request, slug, requestId, {
    apply: true,
  });

  if (context.row.status === "applied") {
    return {
      workspace: await buildWorkspace(env, context),
      appliedRevision: Number(context.project.config_revision || 0),
      idempotent: true,
      projectIdentity: {
        id: context.project.id,
        slug: context.project.slug,
      },
    };
  }
  if (REVIEW_TERMINAL_STATUSES.has(context.row.status)) {
    throw reviewError(
      "A solicitação não pode mais ser aplicada.",
      409,
      "CHANGE_REQUEST_REVIEW_STATE_CONFLICT",
      { status: context.row.status },
    );
  }
  if (!REVIEW_ACTIVE_STATUSES.has(context.row.status)) {
    throw reviewError(
      "A solicitação está em estado desconhecido para aplicação.",
      409,
      "CHANGE_REQUEST_REVIEW_STATE_CONFLICT",
      { status: context.row.status },
    );
  }

  const baseRevision = Number(context.row.base_revision || 0);
  const base = await readVerifiedBaseRevision(env, context.project, baseRevision);
  let proposal;
  try {
    proposal = buildProjectChangeProposal({
      baseConfig: base.config,
      operations: context.operations,
    });
  } catch (error) {
    if (isProjectChangeOperationConflict(error)) {
      context.row = await ensureUnderReview(env, request, context);
      await markConflict(env, request, context, context.row, error, {
        currentRevision: Number(context.project.config_revision || 0),
      });
    }
    throw error;
  }

  const artifact = await buildProjectConfigArtifact(proposal.config);
  const currentRevision = Number(context.project.config_revision || 0);
  const recoveryAttempt =
    context.row.status === "applying" && currentRevision === baseRevision + 1;
  if (currentRevision !== baseRevision && !recoveryAttempt) {
    context.row = await ensureUnderReview(env, request, context);
    const conflict = reviewError(
      "O projeto foi alterado desde a revisão-base da solicitação.",
      409,
      "CHANGE_REQUEST_REVIEW_CONFLICT",
      { baseRevision, currentRevision },
    );
    await markConflict(env, request, context, context.row, conflict, {
      baseRevision,
      currentRevision,
    });
    throw conflict;
  }

  context.row = await ensureApproved(env, request, context);
  if (context.row.status === "approved") {
    const updated = await transitionStatus(context.db, context.row, "approved", "applying");
    context.row = updated || await reloadRow(context.db, context.row);
  }
  if (context.row?.status !== "applying" && context.row?.status !== "applied") {
    throw reviewError(
      "A solicitação mudou enquanto a aplicação era iniciada.",
      409,
      "CHANGE_REQUEST_REVIEW_STATE_CONFLICT",
      { status: context.row?.status || null },
    );
  }
  if (context.row.status === "applied") {
    return {
      workspace: await buildWorkspace(env, context),
      appliedRevision: Number(context.project.config_revision || 0),
      idempotent: true,
      projectIdentity: {
        id: context.project.id,
        slug: context.project.slug,
      },
    };
  }

  await Promise.all([
    safeTicketEvent(context.db, context.row, context.user, "project.change_request.applying", {
      proposalChecksum: artifact.checksum,
    }),
    safeAudit(env, request, context.row, context.user, "project.change_request.apply_started", {
      proposalChecksum: artifact.checksum,
    }),
  ]);

  let saved;
  try {
    saved = await saveVersionedProjectConfig(env, {
      project: context.project,
      config: proposal.config,
      expectedConfigRevision: baseRevision,
      actor: {
        id: context.user.id,
        name: context.user.name || context.user.email || "Editor",
      },
      markPreviewPending: true,
    });
  } catch (error) {
    let recoveredConcurrentApply = false;
    if (error?.code === "PROJECT_CONFIG_REVISION_CONFLICT") {
      const publishedHead = await loadPublishedProposalHead(context.db, context.row);
      if (isSamePublishedProposal(publishedHead, baseRevision, artifact.checksum)) {
        context.project = {
          ...context.project,
          config_revision: Number(publishedHead.config_revision),
        };
        saved = {
          revision: baseRevision + 1,
          idempotent: true,
        };
        recoveredConcurrentApply = true;
      }
    }

    if (
      !recoveredConcurrentApply &&
      (error?.code === "PROJECT_CONFIG_REVISION_CONFLICT" ||
        error?.code === "PROJECT_CONFIG_LIFECYCLE_CONFLICT")
    ) {
      await markConflict(env, request, context, context.row, error, {
        baseRevision,
        currentRevision: Number(error?.details?.currentConfigRevision ?? currentRevision),
      });
      throw reviewError(
        "O projeto mudou enquanto a solicitação era aplicada.",
        409,
        "CHANGE_REQUEST_REVIEW_CONFLICT",
        {
          baseRevision,
          currentRevision: Number(error?.details?.currentConfigRevision ?? currentRevision),
        },
      );
    }

    if (!recoveredConcurrentApply) {
      await safeAudit(
        env,
        request,
        context.row,
        context.user,
        "project.change_request.apply_failed",
        { code: error?.code || "PROJECT_CHANGE_REQUEST_APPLY_FAILED" },
        "error",
      );
      // Mantém `applying`: retry posterior reutiliza o pipeline idempotente de save.
      throw error;
    }
  }

  const appliedTransition = await transitionStatus(
    context.db,
    context.row,
    "applying",
    "applied",
  );
  context.row = appliedTransition || await reloadRow(context.db, context.row);
  if (context.row?.status !== "applied") {
    // A revisão já pode estar publicada. Manter erro retryable permite finalizar
    // o workflow sem gerar N+2; saveVersionedProjectConfig recupera N+1 por checksum.
    throw reviewError(
      "A revisão foi publicada, mas a finalização do Review não foi confirmada.",
      503,
      "CHANGE_REQUEST_APPLY_COMMIT_NOT_CONFIRMED",
      {
        retryable: true,
        appliedRevision: saved.revision,
        proposalChecksum: artifact.checksum,
      },
    );
  }

  if (appliedTransition) {
    await Promise.all([
      safeTicketEvent(context.db, context.row, context.user, "project.change_request.applied", {
        appliedRevision: saved.revision,
        proposalChecksum: artifact.checksum,
        operationCount: context.operations.length,
      }),
      safeAudit(env, request, context.row, context.user, "project.change_request.applied", {
        appliedRevision: saved.revision,
        proposalChecksum: artifact.checksum,
        operationCount: context.operations.length,
      }),
    ]);
  }

  // Recarrega o projeto para que o response reflita o novo HEAD sem trocar identidade.
  const refreshedProject = await getAuthorizedProject(env, context.user, slug);
  if (refreshedProject) context.project = refreshedProject;

  return {
    workspace: await buildWorkspace(env, context),
    appliedRevision: saved.revision,
    idempotent: Boolean(saved.idempotent),
    projectIdentity: {
      id: context.project.id,
      slug: context.project.slug,
    },
  };
}
