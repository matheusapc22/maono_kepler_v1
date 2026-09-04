import { requireSession } from "./auth.js";
import { getDb, jsonResponse, tableExists } from "./organizations.js";
import { can, recordAuditLog } from "./permissions.js";
import { getAuthorizedProject } from "./projects.js";
import {
  PROJECT_MAP_ROUTE_MODES,
  resolveEffectiveProjectMapRoute,
} from "./project-map-route-policy.js";

export const CHANGE_REQUEST_STATUSES = Object.freeze([
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "conflict",
  "applying",
  "applied",
  "superseded",
]);

export const CHANGE_REQUEST_TRANSITIONS = Object.freeze({
  submitted: ["under_review", "rejected", "superseded"],
  under_review: ["approved", "rejected", "conflict"],
  approved: ["applying"],
  applying: ["applied", "conflict"],
  rejected: [],
  conflict: [],
  applied: [],
  superseded: [],
});

const MAX_OPERATIONS = 100;
const MAX_OPERATION_JSON_BYTES = 256 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function domainError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeText(value, { required = false, maxLength = 2000 } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) {
    throw domainError("Campo obrigatório ausente.", 400, "CHANGE_REQUEST_FIELD_REQUIRED");
  }
  if (text.length > maxLength) {
    throw domainError("Campo excede o limite permitido.", 400, "CHANGE_REQUEST_FIELD_TOO_LONG");
  }
  return text;
}

function normalizeBaseRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw domainError("Revisão-base inválida.", 400, "CHANGE_REQUEST_BASE_REVISION_INVALID");
  }
  return revision;
}

function assertPointCreatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw domainError("Payload de point.create inválido.", 400, "CHANGE_REQUEST_OPERATION_INVALID");
  }
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw domainError("Coordenadas de point.create inválidas.", 400, "CHANGE_REQUEST_OPERATION_INVALID");
  }
}

export const PROJECT_CHANGE_OPERATION_REGISTRY = Object.freeze({
  "point.create": Object.freeze({ version: 1, validate: assertPointCreatePayload }),
});

function normalizeOperation(operation, index) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw domainError("Operação inválida.", 400, "CHANGE_REQUEST_OPERATION_INVALID");
  }
  const type = String(operation.type || "").trim();
  const registryEntry = PROJECT_CHANGE_OPERATION_REGISTRY[type];
  if (!registryEntry) {
    throw domainError("Tipo de operação não suportado.", 400, "CHANGE_REQUEST_OPERATION_UNSUPPORTED", { type });
  }
  const version = Number(operation.version ?? registryEntry.version);
  if (version !== registryEntry.version) {
    throw domainError("Versão de operação não suportada.", 400, "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED", { type, version });
  }
  registryEntry.validate(operation.payload);
  const normalized = {
    id: normalizeText(operation.id || `op-${index + 1}`, { required: true, maxLength: 120 }),
    type,
    version,
    payload: operation.payload,
    createdAt: normalizeText(operation.createdAt, { required: true, maxLength: 64 }),
  };
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > MAX_OPERATION_JSON_BYTES) {
    throw domainError("Operação excede o limite permitido.", 413, "CHANGE_REQUEST_OPERATION_TOO_LARGE");
  }
  return normalized;
}

export function normalizeChangeRequestSubmission(input) {
  const source = input && typeof input === "object" ? input : {};
  const operations = Array.isArray(source.operations) ? source.operations : [];
  if (operations.length < 1 || operations.length > MAX_OPERATIONS) {
    throw domainError(
      `A solicitação deve conter entre 1 e ${MAX_OPERATIONS} operações.`,
      400,
      "CHANGE_REQUEST_OPERATION_COUNT_INVALID",
    );
  }
  return {
    baseRevision: normalizeBaseRevision(source.baseRevision),
    reason: normalizeText(source.reason, { required: true, maxLength: 2000 }),
    operations: operations.map(normalizeOperation),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

export async function buildChangeRequestSubmissionHash(projectId, submission) {
  const payload = JSON.stringify(
    canonicalize({
      projectId: String(projectId),
      baseRevision: submission.baseRevision,
      reason: submission.reason,
      operations: submission.operations,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function ensureProjectChangeRequestSchema(env) {
  for (const table of [
    "project_change_requests",
    "project_change_operations",
    "organization_tickets",
    "ticket_events",
  ]) {
    if (!(await tableExists(env, table))) {
      throw domainError(
        "O schema de solicitações de alteração ainda não está disponível neste ambiente.",
        503,
        "PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED",
      );
    }
  }
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

async function requireChangeRequestProject(env, request, slug, { viewerOnly = false } = {}) {
  const user = await requireSession(env, request);
  const project = await getAuthorizedProject(env, user, slug);
  if (!project) {
    throw domainError("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
  }
  const viewDecision = await can(env, user, "project.view", projectContext(project));
  if (!viewDecision.allowed) {
    throw domainError("Você não possui acesso a este projeto.", 403, "PROJECT_VIEW_FORBIDDEN");
  }
  const route = resolveEffectiveProjectMapRoute(user, project);
  if (viewerOnly && route.mode !== PROJECT_MAP_ROUTE_MODES.VIEWER) {
    throw domainError(
      "Solicitações de alteração são criadas somente pelo workspace Viewer.",
      403,
      "CHANGE_REQUEST_VIEWER_ROUTE_REQUIRED",
    );
  }
  return { user, project, route };
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
  return (result?.results || []).map((row) => {
    const operation = JSON.parse(row.operation_json);
    return { ...operation, sequence: Number(row.sequence) };
  });
}

async function loadOwnedRequest(db, projectId, userId, requestId) {
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

async function safeAudit(env, event) {
  try {
    await recordAuditLog(env, event);
  } catch (error) {
    console.error("[Maono change request] Falha de auditoria:", error);
  }
}

function changeRequestTicket(changeRequestId, project, submission, user) {
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

  return {
    code,
    subject,
    description,
    createdBy: user.id,
  };
}

export async function submitProjectChangeRequest(env, request, slug, input) {
  await ensureProjectChangeRequestSchema(env);
  const { user, project } = await requireChangeRequestProject(env, request, slug, { viewerOnly: true });
  const submission = normalizeChangeRequestSubmission(input);
  const idempotencyKey = normalizeText(request.headers.get("Idempotency-Key"), {
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
      throw domainError(
        "A Idempotency-Key já foi utilizada com outro conteúdo.",
        409,
        "CHANGE_REQUEST_IDEMPOTENCY_KEY_REUSED",
      );
    }
    return {
      status: 200,
      replayed: true,
      changeRequest: publicChangeRequest(existing, await loadOperations(db, existing.id)),
    };
  }

  const currentRevision = Number(project.config_revision || 0);
  if (currentRevision !== submission.baseRevision) {
    throw domainError(
      "O projeto mudou desde o início das alterações locais.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_STALE",
      { baseRevision: submission.baseRevision, currentRevision },
    );
  }

  const changeRequestId = `cr_${crypto.randomUUID()}`;
  const ticket = changeRequestTicket(changeRequestId, project, submission, user);
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
          base_revision, status, reason, idempotency_key, submission_hash
        ) VALUES (?, ?, ?, ?, ${ticketIdSql}, ?, 'submitted', ?, ?, ?)`,
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
          source: "project_change_request",
          changeRequestId,
          projectId: project.id,
          baseRevision: submission.baseRevision,
          operationCount: submission.operations.length,
        }),
      ),
  ];

  await db.batch(statements);

  const row = await loadOwnedRequest(db, project.id, user.id, changeRequestId);
  const operations = await loadOperations(db, changeRequestId);

  await Promise.all([
    safeAudit(env, {
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
      },
    }),
    safeAudit(env, {
      action: "ticket.created",
      actorUserId: user.id,
      organizationId: project.organization_id,
      projectId: project.id,
      resourceType: "ticket",
      resourceId: row?.ticket_id || ticket.code,
      result: "success",
      request,
      metadata: {
        source: "project_change_request",
        changeRequestId,
        code: ticket.code,
      },
    }),
  ]);

  return {
    status: 201,
    replayed: false,
    changeRequest: publicChangeRequest(row, operations),
  };
}

export async function listOwnProjectChangeRequests(env, request, slug, options = {}) {
  await ensureProjectChangeRequestSchema(env);
  const { user, project } = await requireChangeRequestProject(env, request, slug);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const result = await getDb(env)
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM project_change_operations o WHERE o.change_request_id = r.id) AS operation_count
       FROM project_change_requests r
       WHERE r.project_id = ? AND r.requested_by_user_id = ?
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .bind(project.id, user.id, limit)
    .all();
  return (result?.results || []).map((row) => publicChangeRequest(row));
}

export async function getOwnProjectChangeRequest(env, request, slug, requestId) {
  await ensureProjectChangeRequestSchema(env);
  const { user, project } = await requireChangeRequestProject(env, request, slug);
  const db = getDb(env);
  const row = await loadOwnedRequest(db, project.id, user.id, requestId);
  if (!row) {
    throw domainError("Solicitação não encontrada.", 404, "CHANGE_REQUEST_NOT_FOUND");
  }
  return publicChangeRequest(row, await loadOperations(db, row.id));
}

export function projectChangeRequestErrorResponse(error, request) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const requestId =
    request?.headers?.get("X-Request-Id")?.trim() ||
    request?.headers?.get("X-Correlation-Id")?.trim() ||
    crypto.randomUUID();
  const code = error?.code || "PROJECT_CHANGE_REQUEST_INTERNAL_ERROR";
  const message =
    safeStatus >= 500
      ? error?.publicMessage || "Erro interno ao processar a solicitação de alteração."
      : error?.message || "Erro na solicitação de alteração.";
  if (safeStatus >= 500) {
    console.error(`[Maono change request][${requestId}][${code}]`, error);
  }
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        requestId,
        details: error?.details || undefined,
      },
    },
    { status: safeStatus, headers: { "X-Request-Id": requestId } },
  );
}
