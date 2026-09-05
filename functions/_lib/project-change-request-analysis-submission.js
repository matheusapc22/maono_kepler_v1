import { requireSession } from "./auth.js";
import { getDb } from "./organizations.js";
import { can, recordAuditLog } from "./permissions.js";
import { getAuthorizedProject } from "./projects.js";
import {
  PROJECT_MAP_ROUTE_MODES,
  resolveEffectiveProjectMapRoute,
} from "./project-map-route-policy.js";
import {
  buildChangeRequestSubmissionHash,
  ensureProjectChangeRequestSchema,
  normalizeChangeRequestSubmission,
} from "./project-change-requests.js";
import {
  isFrozenAnalysisOperation,
  validateFrozenAnalysisOperation,
} from "./project-change-request-analysis-operations.js";

const MAX_OPERATIONS = 100;
const MAX_OPERATION_JSON_BYTES = 256 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function error(message, status, code, details = null) {
  const failure = new Error(message);
  failure.status = status;
  failure.code = code;
  if (details) failure.details = details;
  return failure;
}

function text(value, { required = false, maxLength = 2000 } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) {
    throw error("Campo obrigatório ausente.", 400, "CHANGE_REQUEST_FIELD_REQUIRED");
  }
  if (normalized.length > maxLength) {
    throw error("Campo excede o limite permitido.", 400, "CHANGE_REQUEST_FIELD_TOO_LONG");
  }
  return normalized;
}

function baseRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw error("Revisão-base inválida.", 400, "CHANGE_REQUEST_BASE_REVISION_INVALID");
  }
  return revision;
}

function normalizeAnalysisOperation(operation, index) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw error("Operação inválida.", 400, "CHANGE_REQUEST_OPERATION_INVALID");
  }
  validateFrozenAnalysisOperation(operation);
  const normalized = {
    id: text(operation.id || `op-${index + 1}`, { required: true, maxLength: 120 }),
    type: String(operation.type).trim(),
    version: 1,
    payload: operation.payload,
    createdAt: text(operation.createdAt, { required: true, maxLength: 64 }),
  };
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_OPERATION_JSON_BYTES) {
    throw error("Operação excede o limite permitido.", 413, "CHANGE_REQUEST_OPERATION_TOO_LARGE");
  }
  return normalized;
}

export function normalizeAnalysisAwareChangeRequestSubmission(input) {
  const source = input && typeof input === "object" ? input : {};
  const revision = baseRevision(source.baseRevision);
  const reason = text(source.reason, { required: true, maxLength: 2000 });
  const operations = Array.isArray(source.operations) ? source.operations : [];
  if (operations.length < 1 || operations.length > MAX_OPERATIONS) {
    throw error(
      `A solicitação deve conter entre 1 e ${MAX_OPERATIONS} operações.`,
      400,
      "CHANGE_REQUEST_OPERATION_COUNT_INVALID",
    );
  }

  return {
    baseRevision: revision,
    reason,
    operations: operations.map((operation, index) => {
      if (isFrozenAnalysisOperation(operation)) {
        return normalizeAnalysisOperation(operation, index);
      }
      return normalizeChangeRequestSubmission({
        baseRevision: revision,
        reason,
        operations: [operation],
      }).operations[0];
    }),
  };
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
  if (!project) throw error("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
  const viewDecision = await can(env, user, "project.view", projectContext(project));
  if (!viewDecision.allowed) {
    throw error("Você não possui acesso a este projeto.", 403, "PROJECT_VIEW_FORBIDDEN");
  }
  const route = resolveEffectiveProjectMapRoute(user, project);
  if (route.mode !== PROJECT_MAP_ROUTE_MODES.VIEWER) {
    throw error(
      "Solicitações de alteração são criadas somente pelo workspace Viewer.",
      403,
      "CHANGE_REQUEST_VIEWER_ROUTE_REQUIRED",
    );
  }
  return { user, project };
}

async function loadOperations(db, changeRequestId) {
  const result = await db
    .prepare(
      `SELECT sequence, operation_json
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

async function loadRequest(db, projectId, userId, requestId) {
  return db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o WHERE o.change_request_id = r.id) AS operation_count
         FROM project_change_requests r
        WHERE r.id = ? AND r.project_id = ? AND r.requested_by_user_id = ?
        LIMIT 1`,
    )
    .bind(requestId, projectId, userId)
    .first();
}

function publicRequest(row, operations) {
  return {
    id: row.id,
    organizationId: Number(row.organization_id),
    projectId: Number(row.project_id),
    requestedByUserId: Number(row.requested_by_user_id),
    ticketId: row.ticket_id ? Number(row.ticket_id) : null,
    baseRevision: Number(row.base_revision),
    status: row.status,
    reason: row.reason,
    operationCount: Number(row.operation_count ?? operations.length),
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    operations,
  };
}

async function safeAudit(env, event) {
  try {
    await recordAuditLog(env, event);
  } catch (auditError) {
    console.error("[Maono change request] Falha de auditoria:", auditError);
  }
}

export async function submitAnalysisAwareProjectChangeRequest(env, request, slug, input) {
  await ensureProjectChangeRequestSchema(env);
  const { user, project } = await requireViewerProject(env, request, slug);
  const submission = normalizeAnalysisAwareChangeRequestSubmission(input);
  const idempotencyKey = text(request.headers.get("Idempotency-Key"), {
    required: true,
    maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
  });
  const submissionHash = await buildChangeRequestSubmissionHash(project.id, submission);
  const db = getDb(env);

  const existing = await db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o WHERE o.change_request_id = r.id) AS operation_count
         FROM project_change_requests r
        WHERE r.organization_id = ? AND r.requested_by_user_id = ? AND r.idempotency_key = ?
        LIMIT 1`,
    )
    .bind(project.organization_id, user.id, idempotencyKey)
    .first();
  if (existing) {
    if (existing.submission_hash !== submissionHash) {
      throw error(
        "A Idempotency-Key já foi utilizada com outro conteúdo.",
        409,
        "CHANGE_REQUEST_IDEMPOTENCY_KEY_REUSED",
      );
    }
    const operations = await loadOperations(db, existing.id);
    return { status: 200, replayed: true, changeRequest: publicRequest(existing, operations) };
  }

  const currentRevision = Number(project.config_revision || 0);
  if (currentRevision !== submission.baseRevision) {
    throw error(
      "O projeto mudou desde o início das alterações locais.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_STALE",
      { baseRevision: submission.baseRevision, currentRevision },
    );
  }

  const changeRequestId = `cr_${crypto.randomUUID()}`;
  const code = `TKT-CR-${changeRequestId.slice(3)}`;
  const projectName = String(project.name || project.slug || "Projeto").trim();
  const subject = `Solicitação de alterações — ${projectName}`.slice(0, 160);
  const description = [
    `Projeto: ${projectName}`,
    `Revisão-base: ${submission.baseRevision}`,
    `Alterações: ${submission.operations.length}`,
    "",
    "Motivo:",
    submission.reason,
  ].join("\n").slice(0, 5000);
  const ticketIdSql = `(SELECT id FROM organization_tickets WHERE organization_id = ? AND code = ? LIMIT 1)`;

  const statements = [
    db.prepare(
      `INSERT INTO organization_tickets (
         organization_id, code, subject, description, status, priority,
         category, created_by, active
       ) VALUES (?, ?, ?, ?, 'new', 'normal', 'map', ?, 1)`,
    ).bind(project.organization_id, code, subject, description, user.id),
    db.prepare(
      `INSERT INTO project_change_requests (
         id, organization_id, project_id, requested_by_user_id, ticket_id,
         base_revision, status, reason, idempotency_key, submission_hash
       ) VALUES (?, ?, ?, ?, ${ticketIdSql}, ?, 'submitted', ?, ?, ?)`,
    ).bind(
      changeRequestId,
      project.organization_id,
      project.id,
      user.id,
      project.organization_id,
      code,
      submission.baseRevision,
      submission.reason,
      idempotencyKey,
      submissionHash,
    ),
    ...submission.operations.map((operation, sequence) =>
      db.prepare(
        `INSERT INTO project_change_operations (
           id, change_request_id, sequence, operation_type, operation_json
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        `${changeRequestId}_op_${String(sequence + 1).padStart(4, "0")}`,
        changeRequestId,
        sequence,
        operation.type,
        JSON.stringify(operation),
      ),
    ),
    db.prepare(
      `INSERT INTO ticket_events (
         organization_id, ticket_id, event_type, actor_user_id, metadata
       ) VALUES (?, ${ticketIdSql}, 'ticket.created', ?, ?)`,
    ).bind(
      project.organization_id,
      project.organization_id,
      code,
      user.id,
      JSON.stringify({
        source: "project_change_request",
        changeRequestId,
        projectId: project.id,
        baseRevision: submission.baseRevision,
        operationCount: submission.operations.length,
      }),
    ),
  ];
  await db.batch(statements);

  const row = await loadRequest(db, project.id, user.id, changeRequestId);
  const operations = await loadOperations(db, changeRequestId);
  await safeAudit(env, {
    action: "project.change_request.submitted",
    actorUserId: user.id,
    organizationId: project.organization_id,
    projectId: project.id,
    resourceType: "project_change_request",
    resourceId: changeRequestId,
    result: "success",
    request,
    metadata: {
      baseRevision: submission.baseRevision,
      operationCount: submission.operations.length,
      ticketId: row?.ticket_id || null,
      operationTypes: submission.operations.map((operation) => operation.type),
    },
  });

  return {
    status: 201,
    replayed: false,
    changeRequest: publicRequest(row, operations),
  };
}
