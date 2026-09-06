import { requireSession } from "./auth.js";
import { publicRequestLifecycle } from "./project-change-request-lifecycle.js";
import { isChangeRequestResubmissionSchemaReady } from "./project-change-request-stack-readiness.js";
import {
  buildChangeRequestSubmissionHash,
  ensureProjectChangeRequestSchema,
  normalizeChangeRequestSubmission,
} from "./project-change-requests.js";
import { getDb } from "./organizations.js";
import { can, recordAuditLog } from "./permissions.js";
import {
  PROJECT_MAP_ROUTE_MODES,
  resolveEffectiveProjectMapRoute,
} from "./project-map-route-policy.js";
import { getAuthorizedProject } from "./projects.js";

const RESUBMITTABLE_STATUSES = new Set(["rejected", "conflict"]);
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function domainError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function text(value, { required = false, maxLength = 2000 } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) {
    throw domainError("Campo obrigatório ausente.", 400, "CHANGE_REQUEST_FIELD_REQUIRED");
  }
  if (normalized.length > maxLength) {
    throw domainError("Campo excede o limite permitido.", 400, "CHANGE_REQUEST_FIELD_TOO_LONG");
  }
  return normalized;
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

async function requireViewerProject(env, request, slug) {
  const user = await requireSession(env, request);
  const project = await getAuthorizedProject(env, user, slug);
  if (!project) {
    throw domainError("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
  }
  const decision = await can(env, user, "project.view", projectContext(project));
  if (!decision.allowed) {
    throw domainError("Você não possui acesso a este projeto.", 403, "PROJECT_VIEW_FORBIDDEN");
  }
  const route = resolveEffectiveProjectMapRoute(user, project);
  if (route.mode !== PROJECT_MAP_ROUTE_MODES.VIEWER) {
    throw domainError(
      "O acompanhamento e a resubmissão pertencem ao workspace Viewer.",
      403,
      "CHANGE_REQUEST_VIEWER_ROUTE_REQUIRED",
    );
  }
  return { user, project };
}

export async function ensureChangeRequestResubmissionSchema(env) {
  await ensureProjectChangeRequestSchema(env);
  if (!(await isChangeRequestResubmissionSchemaReady(env))) {
    throw domainError(
      "A migration 0023_change_request_resubmissions.sql precisa ser aplicada integralmente antes de usar resubmissões.",
      503,
      "CHANGE_REQUEST_RESUBMISSION_SCHEMA_OUTDATED",
    );
  }
}

function publicTrackingRequest(row, operations = undefined) {
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
    resubmittedFromRequestId: row.resubmitted_from_request_id || null,
    resubmittedToRequestId: row.resubmitted_to_request_id || null,
  };
  if (operations) result.operations = operations;
  return result;
}

async function loadOperations(db, changeRequestId) {
  const result = await db
    .prepare(
      `SELECT id, sequence, operation_type, operation_json, created_at
       FROM project_change_operations
       WHERE change_request_id = ?
       ORDER BY sequence ASC`,
    )
    .bind(changeRequestId)
    .all();
  return (result?.results || []).map((row) => ({
    ...JSON.parse(row.operation_json),
    sequence: Number(row.sequence),
  }));
}

async function loadOwnedRequest(db, projectId, userId, requestId) {
  return db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o
                WHERE o.change_request_id = r.id) AS operation_count,
              (SELECT child.id FROM project_change_requests child
                WHERE child.resubmitted_from_request_id = r.id
                ORDER BY child.created_at DESC LIMIT 1) AS resubmitted_to_request_id
       FROM project_change_requests r
       WHERE r.id = ? AND r.project_id = ? AND r.requested_by_user_id = ?
       LIMIT 1`,
    )
    .bind(requestId, projectId, userId)
    .first();
}

async function loadRequestByIdempotency(
  db,
  organizationId,
  userId,
  idempotencyKey,
) {
  return db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o
                WHERE o.change_request_id = r.id) AS operation_count
       FROM project_change_requests r
       WHERE r.organization_id = ? AND r.requested_by_user_id = ? AND r.idempotency_key = ?
       LIMIT 1`,
    )
    .bind(organizationId, userId, idempotencyKey)
    .first();
}

function assertMatchingResubmissionReplay(existing, submissionHash, sourceId) {
  if (
    existing.submission_hash !== submissionHash ||
    existing.resubmitted_from_request_id !== sourceId
  ) {
    throw domainError(
      "A Idempotency-Key já foi utilizada com outro conteúdo ou outra solicitação de origem.",
      409,
      "CHANGE_REQUEST_IDEMPOTENCY_KEY_REUSED",
    );
  }
}

async function replayResult(db, existing) {
  return {
    status: 200,
    replayed: true,
    changeRequest: publicTrackingRequest(
      existing,
      await loadOperations(db, existing.id),
    ),
  };
}

async function safeAudit(env, event) {
  try {
    await recordAuditLog(env, event);
  } catch (error) {
    console.error("[Maono change request resubmission] Falha de auditoria:", error);
  }
}

function resubmissionTicket(changeRequestId, source, project, submission, user) {
  const code = `TKT-CR-${changeRequestId.slice(3)}`;
  const projectName = String(project.name || project.slug || "Projeto").trim();
  return {
    code,
    subject: `Correção de solicitação — ${projectName}`.slice(0, 160),
    description: [
      `Projeto: ${projectName}`,
      `Solicitação anterior: ${source.id}`,
      `Revisão-base da correção: ${submission.baseRevision}`,
      `Alterações: ${submission.operations.length}`,
      "",
      "Motivo da correção:",
      submission.reason,
    ].join("\n").slice(0, 5000),
    createdBy: user.id,
  };
}

export async function listOwnTrackedProjectChangeRequests(
  env,
  request,
  slug,
  options = {},
) {
  await ensureChangeRequestResubmissionSchema(env);
  const { user, project } = await requireViewerProject(env, request, slug);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const result = await getDb(env)
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o
                WHERE o.change_request_id = r.id) AS operation_count,
              (SELECT child.id FROM project_change_requests child
                WHERE child.resubmitted_from_request_id = r.id
                ORDER BY child.created_at DESC LIMIT 1) AS resubmitted_to_request_id
       FROM project_change_requests r
       WHERE r.project_id = ? AND r.requested_by_user_id = ?
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .bind(project.id, user.id, limit)
    .all();
  return (result?.results || []).map((row) => publicTrackingRequest(row));
}

export async function resubmitProjectChangeRequest(
  env,
  request,
  slug,
  sourceRequestId,
  input,
) {
  await ensureChangeRequestResubmissionSchema(env);
  const { user, project } = await requireViewerProject(env, request, slug);
  const submission = normalizeChangeRequestSubmission(input);
  const idempotencyKey = text(request.headers.get("Idempotency-Key"), {
    required: true,
    maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
  });
  const db = getDb(env);
  const source = await loadOwnedRequest(
    db,
    project.id,
    user.id,
    text(sourceRequestId, { required: true, maxLength: 120 }),
  );
  if (!source) {
    throw domainError("Solicitação original não encontrada.", 404, "CHANGE_REQUEST_NOT_FOUND");
  }

  const submissionHash = await buildChangeRequestSubmissionHash(project.id, submission);
  const existing = await loadRequestByIdempotency(
    db,
    project.organization_id,
    user.id,
    idempotencyKey,
  );

  if (existing) {
    assertMatchingResubmissionReplay(existing, submissionHash, source.id);
    return replayResult(db, existing);
  }

  if (!RESUBMITTABLE_STATUSES.has(source.status)) {
    throw domainError(
      "Somente solicitações rejeitadas ou em conflito podem ser corrigidas e reenviadas.",
      409,
      "CHANGE_REQUEST_RESUBMISSION_NOT_ALLOWED",
      { status: source.status },
    );
  }

  if (source.resubmitted_to_request_id) {
    throw domainError(
      "Esta solicitação já possui uma resubmissão.",
      409,
      "CHANGE_REQUEST_ALREADY_RESUBMITTED",
      { changeRequestId: source.resubmitted_to_request_id },
    );
  }

  const currentRevision = Number(project.config_revision || 0);
  if (currentRevision !== submission.baseRevision) {
    throw domainError(
      "O projeto mudou desde o início da correção. As alterações locais devem ser revistas antes do reenvio.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_STALE",
      { baseRevision: submission.baseRevision, currentRevision },
    );
  }

  const changeRequestId = `cr_${crypto.randomUUID()}`;
  const ticket = resubmissionTicket(
    changeRequestId,
    source,
    project,
    submission,
    user,
  );
  const ticketIdSql = `(SELECT id FROM organization_tickets WHERE organization_id = ? AND code = ? LIMIT 1)`;
  const statements = [
    db
      .prepare(
        `INSERT INTO organization_tickets (
          organization_id, code, subject, description, status, priority,
          category, created_by, active
        ) VALUES (?, ?, ?, ?, 'new', 'normal', 'map', ?, 1)`,
      )
      .bind(
        project.organization_id,
        ticket.code,
        ticket.subject,
        ticket.description,
        ticket.createdBy,
      ),
    db
      .prepare(
        `INSERT INTO project_change_requests (
          id, organization_id, project_id, requested_by_user_id, ticket_id,
          base_revision, status, reason, idempotency_key, submission_hash,
          resubmitted_from_request_id
        ) VALUES (?, ?, ?, ?, ${ticketIdSql}, ?, 'submitted', ?, ?, ?, ?)`,
      )
      .bind(
        changeRequestId,
        project.organization_id,
        project.id,
        user.id,
        project.organization_id,
        ticket.code,
        submission.baseRevision,
        submission.reason,
        idempotencyKey,
        submissionHash,
        source.id,
      ),
    ...submission.operations.map((operation, sequence) =>
      db
        .prepare(
          `INSERT INTO project_change_operations (
            id, change_request_id, sequence, operation_type, operation_json
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          `${changeRequestId}_op_${String(sequence + 1).padStart(4, "0")}`,
          changeRequestId,
          sequence,
          operation.type,
          JSON.stringify(operation),
        ),
    ),
    db
      .prepare(
        `INSERT INTO ticket_events (
          organization_id, ticket_id, event_type, actor_user_id, metadata
        ) VALUES (?, ${ticketIdSql}, 'ticket.created', ?, ?)`,
      )
      .bind(
        project.organization_id,
        project.organization_id,
        ticket.code,
        user.id,
        JSON.stringify({
          source: "project_change_request_resubmission",
          changeRequestId,
          resubmittedFromRequestId: source.id,
          projectId: project.id,
          baseRevision: submission.baseRevision,
          operationCount: submission.operations.length,
        }),
      ),
  ];

  try {
    await db.batch(statements);
  } catch (writeError) {
    // Duas correções podem atravessar os mesmos pre-checks simultaneamente.
    // O índice UNIQUE de 0023 continua sendo a autoridade no D1. Após uma
    // colisão, convertemos o erro de constraint em replay idempotente ou em
    // conflito de domínio, sem mascarar falhas de escrita não relacionadas.
    const concurrentReplay = await loadRequestByIdempotency(
      db,
      project.organization_id,
      user.id,
      idempotencyKey,
    );
    if (concurrentReplay) {
      assertMatchingResubmissionReplay(
        concurrentReplay,
        submissionHash,
        source.id,
      );
      return replayResult(db, concurrentReplay);
    }

    const racedSource = await loadOwnedRequest(db, project.id, user.id, source.id);
    if (racedSource?.resubmitted_to_request_id) {
      throw domainError(
        "Esta solicitação já possui uma resubmissão.",
        409,
        "CHANGE_REQUEST_ALREADY_RESUBMITTED",
        { changeRequestId: racedSource.resubmitted_to_request_id },
      );
    }

    throw writeError;
  }

  const row = await loadOwnedRequest(db, project.id, user.id, changeRequestId);
  const operations = await loadOperations(db, changeRequestId);
  await safeAudit(env, {
    action: "project.change_request.resubmitted",
    actorUserId: user.id,
    organizationId: project.organization_id,
    projectId: project.id,
    resourceType: "project_change_request",
    resourceId: changeRequestId,
    result: "success",
    request,
    metadata: {
      resubmittedFromRequestId: source.id,
      ticketId: row?.ticket_id || null,
      baseRevision: submission.baseRevision,
      operationCount: submission.operations.length,
    },
  });

  return {
    status: 201,
    replayed: false,
    changeRequest: publicTrackingRequest(row, operations),
  };
}
