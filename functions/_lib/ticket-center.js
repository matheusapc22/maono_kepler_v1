import {
  appendOrganizationBinaryUpload,
  buildStoredFileName,
  deleteOrganizationBinary,
  downloadOrganizationBinary,
  finishOrganizationBinaryUpload,
  organizationFileDropboxPath,
  splitDropboxFilePath,
  startOrganizationBinaryUpload,
  uploadOrganizationBinary,
} from "./organization-files.js";
import {
  canonicalOrganizationRoot,
  ensureOrganizationStorage,
} from "./organization-storage.js";
import {
  fileDownloadHeaders,
  getDb,
  getOrganizationOrThrow,
  getTableColumns,
  insertRow,
  jsonResponse,
  sanitizeFileName,
  tableExists,
  updateRow,
} from "./organizations.js";
import { recordAuditLog } from "./permissions.js";

export const TICKET_STATUSES = [
  "new",
  "open",
  "in_progress",
  "in_review",
  "closed",
];

export const TICKET_PRIORITIES = ["low", "normal", "high"];

export const TICKET_CATEGORIES = [
  "map",
  "database",
  "permission",
  "export",
  "support",
  "other",
];

const STATUS_ALIASES = {
  pending: "open",
  progress: "in_progress",
  review: "in_review",
  resolved: "closed",
};

const MEBIBYTE = 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 80 * MEBIBYTE;
const MAX_TICKET_ATTACHMENT_BYTES = 150 * MEBIBYTE;
const MAX_MULTIPART_ATTACHMENT_BYTES = 10 * MEBIBYTE;
const MAX_UPLOAD_CHUNK_BYTES = 8 * MEBIBYTE;
const MAX_ATTACHMENTS_PER_TICKET = 5;
const PENDING_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

export const TICKET_ATTACHMENT_LIMITS = Object.freeze({
  maxFiles: MAX_ATTACHMENTS_PER_TICKET,
  maxFileBytes: MAX_ATTACHMENT_BYTES,
  maxTicketBytes: MAX_TICKET_ATTACHMENT_BYTES,
  chunkBytes: MAX_UPLOAD_CHUNK_BYTES,
});

const ATTACHMENT_TYPES = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "application/octet-stream",
  ],
  zip: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream",
  ],
  txt: ["text/plain"],
};

const SORT_SQL = {
  updated_desc: "t.updated_at DESC, t.id DESC",
  updated_asc: "t.updated_at ASC, t.id ASC",
  due_asc:
    "CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.updated_at DESC",
  priority_desc:
    "CASE t.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC",
};

function apiError(message, status = 400, code = "BAD_REQUEST", extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function ticketCenterErrorResponse(error, request) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const requestId =
    request?.headers?.get("X-Request-Id")?.trim() || crypto.randomUUID();
  const code = error?.code || "TICKET_CENTER_INTERNAL_ERROR";
  const message =
    safeStatus >= 500
      ? error?.publicMessage || "Erro interno ao processar a requisição."
      : error?.message || "Erro na requisição.";

  if (safeStatus >= 500) {
    console.error(`[Maono ticket center][${requestId}][${code}]`, error);
  }

  return jsonResponse(
    {
      ok: false,
      error: message,
      code,
      requestId,
      stage: error?.stage || undefined,
    },
    {
      status: safeStatus,
      headers: { "X-Request-Id": requestId },
    },
  );
}

function cleanText(value, { required = false, maxLength = 500 } = {}) {
  const text = String(value ?? "").trim();

  if (required && !text) {
    throw apiError("Campo obrigatório ausente.", 400, "REQUIRED_FIELD");
  }

  if (text.length > maxLength) {
    throw apiError(
      `Campo excede o limite de ${maxLength} caracteres.`,
      400,
      "FIELD_TOO_LONG",
    );
  }

  return text;
}

function toPositiveInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function isoNow() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function extensionFromName(fileName) {
  return String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function sha256Hex(arrayBuffer) {
  return crypto.subtle.digest("SHA-256", arrayBuffer).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
}

function startsWithBytes(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function assertFileSignature(extension, arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer.slice(0, 16));
  const isPdf = startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46]);
  const isPng = startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47]);
  const isJpeg = startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  const isZip =
    startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08]);
  const isWebp =
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const isLegacyOffice = startsWithBytes(bytes, [
    0xd0,
    0xcf,
    0x11,
    0xe0,
    0xa1,
    0xb1,
    0x1a,
    0xe1,
  ]);
  const noNullBytes = !bytes.includes(0);

  const valid =
    (extension === "pdf" && isPdf) ||
    (extension === "png" && isPng) ||
    ((extension === "jpg" || extension === "jpeg") && isJpeg) ||
    (extension === "webp" && isWebp) ||
    (["zip", "xlsx", "docx"].includes(extension) && isZip) ||
    (extension === "xls" && (isLegacyOffice || isZip)) ||
    (["csv", "txt"].includes(extension) && noNullBytes);

  if (!valid) {
    throw apiError(
      "O conteúdo do arquivo não corresponde ao tipo informado.",
      415,
      "ATTACHMENT_SIGNATURE_INVALID",
    );
  }
}

export function normalizeTicketStatus(value, fallback = "open") {
  const normalized = String(value || fallback).trim().toLowerCase();
  const canonical = STATUS_ALIASES[normalized] || normalized;

  if (!TICKET_STATUSES.includes(canonical)) {
    throw apiError("Status inválido.", 400, "INVALID_STATUS");
  }

  return canonical;
}

function normalizePriority(value, fallback = "normal") {
  const priority = String(value || fallback).trim().toLowerCase();

  if (!TICKET_PRIORITIES.includes(priority)) {
    throw apiError("Prioridade inválida.", 400, "INVALID_PRIORITY");
  }

  return priority;
}

function normalizeCategory(value, fallback = "support") {
  const category = String(value || fallback).trim().toLowerCase();

  if (!TICKET_CATEGORIES.includes(category)) {
    throw apiError("Categoria inválida.", 400, "INVALID_CATEGORY");
  }

  return category;
}

function normalizeOptionalDate(value, label = "Data") {
  if (value === null || value === undefined || value === "") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw apiError(`${label} inválida.`, 400, "INVALID_DATE");
  }

  return date.toISOString();
}

function publicPerson(id, name, email) {
  if (!id) return null;

  return {
    id,
    name: name || email || "Usuário",
    email: email || null,
  };
}

export function publicTicket(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code || `TKT-${String(row.id || "").padStart(6, "0")}`,
    subject: row.subject || "Chamado",
    description: row.description || "",
    status: normalizeTicketStatus(row.status || "open"),
    priority: normalizePriority(row.priority || "normal"),
    category: normalizeCategory(row.category || "support"),
    dueAt: row.due_at || null,
    closedAt: row.closed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy:
      publicPerson(
        row.creator_id || row.created_by,
        row.creator_name,
        row.creator_email,
      ) || null,
    assignedTo:
      publicPerson(
        row.assignee_id || row.assigned_to,
        row.assignee_name,
        row.assignee_email,
      ) || null,
    attachmentsCount: Number(row.attachments_count || 0),
  };
}

export function publicTicketAttachment(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ticketId: row.ticket_id,
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes || 0),
    status: row.status,
    createdAt: row.created_at || null,
    uploadedBy:
      publicPerson(
        row.uploader_id || row.uploaded_by,
        row.uploader_name,
        row.uploader_email,
      ) || null,
  };
}

export function publicTicketEvent(row) {
  return {
    id: row.id,
    type: row.event_type,
    metadata: safeJsonParse(row.metadata, {}),
    createdAt: row.created_at,
    actor:
      publicPerson(
        row.actor_id || row.actor_user_id,
        row.actor_name,
        row.actor_email,
      ) || null,
  };
}

export async function ensureTicketCenterSchema(env) {
  const required = [
    "organization_tickets",
    "ticket_attachments",
    "ticket_events",
  ];

  for (const table of required) {
    if (!(await tableExists(env, table))) {
      throw apiError(
        "A migration 0010_ticket_center.sql ainda não foi aplicada.",
        503,
        "TICKET_CENTER_SCHEMA_OUTDATED",
      );
    }
  }
}

function legacyText(value, fallback, maxLength) {
  const text = String(value ?? "").trim() || fallback;
  return text.slice(0, maxLength);
}

function legacyEnum(normalize, value, fallback) {
  try {
    return normalize(value || fallback);
  } catch {
    return fallback;
  }
}

function legacyDate(value, fallback = null) {
  try {
    return normalizeOptionalDate(value) || fallback;
  } catch {
    return fallback;
  }
}

export function normalizeLegacyTicketRow(
  row,
  { organizationId, fallbackUserId, validUserIds = null } = {},
) {
  const legacyId = toPositiveInteger(row?.id);
  const fallbackCreator = toPositiveInteger(fallbackUserId);
  const candidateCreator =
    toPositiveInteger(row?.created_by) || toPositiveInteger(row?.user_id);
  const candidateIsValid =
    candidateCreator &&
    (!validUserIds || validUserIds.has(String(candidateCreator)));
  const createdBy = candidateIsValid ? candidateCreator : fallbackCreator;

  if (!legacyId || !createdBy || !toPositiveInteger(organizationId)) {
    return null;
  }

  const subject = legacyText(
    row?.subject || row?.title,
    "Chamado legado",
    160,
  );
  const description = legacyText(
    row?.description || row?.body,
    subject,
    5000,
  );
  const createdAt = legacyDate(row?.created_at, isoNow());
  const assignedToCandidate = toPositiveInteger(row?.assigned_to);
  const assignedTo =
    assignedToCandidate &&
    (!validUserIds || validUserIds.has(String(assignedToCandidate)))
      ? assignedToCandidate
      : null;

  return {
    organizationId: Number(organizationId),
    legacyId,
    code: `TKT-L${organizationId}-${String(legacyId).padStart(6, "0")}`,
    subject,
    description,
    status: legacyEnum(normalizeTicketStatus, row?.status, "open"),
    priority: legacyEnum(normalizePriority, row?.priority, "normal"),
    category: legacyEnum(normalizeCategory, row?.category, "support"),
    assignedTo,
    dueAt: legacyDate(row?.due_at || row?.scheduled_at),
    closedAt: legacyDate(row?.closed_at),
    createdBy,
    createdAt,
    updatedAt: legacyDate(row?.updated_at || row?.created_at, createdAt),
  };
}

export async function migrateLegacyTickets(
  env,
  organizationId,
  fallbackUserId,
) {
  try {
    if (!(await tableExists(env, "tickets"))) {
      return { migrated: 0, skipped: 0 };
    }

    const columns = await getTableColumns(env, "tickets");
    if (!columns.has("id") || !columns.has("organization_id")) {
      console.warn(
        "[Maono ticket center][legacy] Tabela tickets incompatível; importação ignorada.",
      );
      return { migrated: 0, skipped: 0 };
    }

    const activeFilter = columns.has("active")
      ? "AND (legacy.active = 1 OR legacy.active IS NULL)"
      : "";
    const result = await getDb(env)
      .prepare(
        `SELECT legacy.*
         FROM tickets legacy
         WHERE legacy.organization_id = ?
           ${activeFilter}
           AND NOT EXISTS (
             SELECT 1
             FROM organization_tickets canonical
             WHERE canonical.organization_id = ?
               AND canonical.legacy_ticket_id = legacy.id
           )
         ORDER BY legacy.id ASC
         LIMIT 100`,
      )
      .bind(organizationId, organizationId)
      .all();
    const userResult = await getDb(env)
      .prepare("SELECT id FROM users")
      .all();
    const validUserIds = new Set(
      (userResult?.results || []).map((row) => String(row.id)),
    );

    let migrated = 0;
    let skipped = 0;
    for (const row of result?.results || []) {
      try {
        const ticket = normalizeLegacyTicketRow(row, {
          organizationId,
          fallbackUserId,
          validUserIds,
        });
        if (!ticket) {
          skipped += 1;
          continue;
        }

        await getDb(env)
          .prepare(
            `INSERT OR IGNORE INTO organization_tickets (
              organization_id, legacy_ticket_id, code, subject, description,
              status, priority, category, assigned_to, due_at, closed_at,
              created_by, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(
            ticket.organizationId,
            ticket.legacyId,
            ticket.code,
            ticket.subject,
            ticket.description,
            ticket.status,
            ticket.priority,
            ticket.category,
            ticket.assignedTo,
            ticket.dueAt,
            ticket.closedAt,
            ticket.createdBy,
            ticket.createdAt,
            ticket.updatedAt,
          )
          .run();
        migrated += 1;
      } catch (error) {
        skipped += 1;
        console.warn(
          `[Maono ticket center][legacy][organization:${organizationId}][ticket:${row?.id || "unknown"}]`,
          error,
        );
      }
    }

    return { migrated, skipped };
  } catch (error) {
    // A compatibilidade com registros antigos nunca deve indisponibilizar a
    // Central canônica. O erro fica nos logs e os chamados novos seguem ativos.
    console.warn(
      `[Maono ticket center][legacy][organization:${organizationId}] Importação ignorada.`,
      error,
    );
    return { migrated: 0, skipped: 0, failed: true };
  }
}

export function parseTicketListOptions(requestUrl) {
  const url = new URL(requestUrl);
  const q = cleanText(url.searchParams.get("q"), { maxLength: 160 });
  const rawStatus = url.searchParams.get("status");
  const rawPriority = url.searchParams.get("priority");
  const rawAssignee = url.searchParams.get("assigneeId");
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const page = Math.max(1, toPositiveInteger(url.searchParams.get("page"), 1));
  const limit = Math.min(
    100,
    Math.max(1, toPositiveInteger(url.searchParams.get("limit"), 50)),
  );
  const sort = SORT_SQL[url.searchParams.get("sort")] ?
    url.searchParams.get("sort") :
    "updated_desc";

  let assigneeId = null;
  let unassigned = false;
  if (rawAssignee === "unassigned") unassigned = true;
  else if (rawAssignee) {
    assigneeId = toPositiveInteger(rawAssignee);
    if (!assigneeId) {
      throw apiError("Atendente inválido.", 400, "INVALID_ASSIGNEE");
    }
  }

  return {
    q,
    status: rawStatus ? normalizeTicketStatus(rawStatus) : null,
    priority: rawPriority ? normalizePriority(rawPriority) : null,
    assigneeId,
    unassigned,
    from: rawFrom ? normalizeOptionalDate(`${rawFrom}T00:00:00.000Z`) : null,
    to: rawTo ? normalizeOptionalDate(`${rawTo}T23:59:59.999Z`) : null,
    includeUndated: url.searchParams.get("includeUndated") === "1",
    overdueOnly: url.searchParams.get("overdueOnly") === "1",
    page,
    limit,
    sort,
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildTicketWhere(organizationId, options, { includeStatus = true } = {}) {
  const clauses = ["t.organization_id = ?", "t.active = 1"];
  const values = [organizationId];

  if (options.q) {
    clauses.push(
      "(LOWER(t.code) LIKE ? ESCAPE '\\' OR LOWER(t.subject) LIKE ? ESCAPE '\\' OR LOWER(t.description) LIKE ? ESCAPE '\\')",
    );
    const pattern = `%${escapeLike(options.q.toLowerCase())}%`;
    values.push(pattern, pattern, pattern);
  }

  if (includeStatus && options.status) {
    clauses.push("t.status = ?");
    values.push(options.status);
  }

  if (options.overdueOnly) {
    clauses.push("t.status <> 'closed'");
    clauses.push("t.due_at IS NOT NULL");
    clauses.push("t.due_at < ?");
    values.push(isoNow());
  }

  if (options.priority) {
    clauses.push("t.priority = ?");
    values.push(options.priority);
  }

  if (options.assigneeId) {
    clauses.push("t.assigned_to = ?");
    values.push(options.assigneeId);
  } else if (options.unassigned) {
    clauses.push("t.assigned_to IS NULL");
  }

  if (options.from || options.to) {
    const dateClauses = [];
    const dateValues = [];

    if (options.from) {
      dateClauses.push("t.due_at >= ?");
      dateValues.push(options.from);
    }

    if (options.to) {
      dateClauses.push("t.due_at <= ?");
      dateValues.push(options.to);
    }

    clauses.push(
      options.includeUndated
        ? `(t.due_at IS NULL OR (${dateClauses.join(" AND ")}))`
        : `(${dateClauses.join(" AND ")})`,
    );
    values.push(...dateValues);
  }

  return {
    sql: clauses.join(" AND "),
    values,
  };
}

async function listTicketAssignees(env, organizationId) {
  const result = await getDb(env)
    .prepare(
      `SELECT users.id, users.name, users.email
       FROM organization_users
       INNER JOIN users ON users.id = organization_users.user_id
       WHERE organization_users.organization_id = ?
         AND users.active = 1
       ORDER BY COALESCE(users.name, users.email) ASC`,
    )
    .bind(organizationId)
    .all();

  return (result?.results || []).map((row) =>
    publicPerson(row.id, row.name, row.email),
  );
}

export async function listTickets(env, organizationId, options) {
  const where = buildTicketWhere(organizationId, options);
  const facetsWhere = buildTicketWhere(organizationId, options, {
    includeStatus: false,
  });
  const offset = (options.page - 1) * options.limit;

  const countRow = await getDb(env)
    .prepare(
      `SELECT COUNT(*) AS total
       FROM organization_tickets t
       WHERE ${where.sql}`,
    )
    .bind(...where.values)
    .first();

  const result = await getDb(env)
    .prepare(
      `SELECT
        t.*,
        creator.id AS creator_id,
        creator.name AS creator_name,
        creator.email AS creator_email,
        assignee.id AS assignee_id,
        assignee.name AS assignee_name,
        assignee.email AS assignee_email,
        (
          SELECT COUNT(*)
          FROM ticket_attachments a
          WHERE a.organization_id = t.organization_id
            AND a.ticket_id = t.id
            AND a.status = 'ACTIVE'
            AND a.deleted_at IS NULL
        ) AS attachments_count
       FROM organization_tickets t
       LEFT JOIN users creator ON creator.id = t.created_by
       LEFT JOIN users assignee ON assignee.id = t.assigned_to
       WHERE ${where.sql}
       ORDER BY ${SORT_SQL[options.sort]}
       LIMIT ? OFFSET ?`,
    )
    .bind(...where.values, options.limit, offset)
    .all();

  const facetResult = await getDb(env)
    .prepare(
      `SELECT
        t.status,
        COUNT(*) AS total
       FROM organization_tickets t
       WHERE ${facetsWhere.sql}
       GROUP BY t.status`,
    )
    .bind(...facetsWhere.values)
    .all();

  const overdueRow = await getDb(env)
    .prepare(
      `SELECT COUNT(*) AS total
       FROM organization_tickets t
       WHERE ${facetsWhere.sql}
         AND t.status <> 'closed'
         AND t.due_at IS NOT NULL
         AND t.due_at < ?`,
    )
    .bind(...facetsWhere.values, isoNow())
    .first();

  const byStatus = Object.fromEntries(
    TICKET_STATUSES.map((status) => [status, 0]),
  );
  for (const row of facetResult?.results || []) {
    byStatus[normalizeTicketStatus(row.status)] = Number(row.total || 0);
  }

  const total = Number(countRow?.total || 0);

  return {
    tickets: (result?.results || []).map(publicTicket),
    attachmentLimits: TICKET_ATTACHMENT_LIMITS,
    pagination: {
      page: options.page,
      limit: options.limit,
      total,
      hasMore: offset + (result?.results?.length || 0) < total,
      totalPages: Math.max(1, Math.ceil(total / options.limit)),
    },
    facets: {
      byStatus,
      overdue: Number(overdueRow?.total || 0),
    },
    range: {
      from: options.from,
      to: options.to,
    },
    assignees: await listTicketAssignees(env, organizationId),
  };
}

async function findTicketRow(env, organizationId, ticketId) {
  return getDb(env)
    .prepare(
      `SELECT
        t.*,
        creator.id AS creator_id,
        creator.name AS creator_name,
        creator.email AS creator_email,
        assignee.id AS assignee_id,
        assignee.name AS assignee_name,
        assignee.email AS assignee_email,
        (
          SELECT COUNT(*)
          FROM ticket_attachments a
          WHERE a.organization_id = t.organization_id
            AND a.ticket_id = t.id
            AND a.status = 'ACTIVE'
            AND a.deleted_at IS NULL
        ) AS attachments_count
       FROM organization_tickets t
       LEFT JOIN users creator ON creator.id = t.created_by
       LEFT JOIN users assignee ON assignee.id = t.assigned_to
       WHERE t.id = ?
         AND t.organization_id = ?
         AND t.active = 1
       LIMIT 1`,
    )
    .bind(ticketId, organizationId)
    .first();
}

export async function getTicketOrThrow(env, organizationId, ticketId) {
  const row = await findTicketRow(env, organizationId, ticketId);

  if (!row) {
    throw apiError("Chamado não encontrado.", 404, "TICKET_NOT_FOUND");
  }

  return row;
}

export async function listTicketAttachments(env, organizationId, ticketId) {
  const result = await getDb(env)
    .prepare(
      `SELECT
        a.*,
        uploader.id AS uploader_id,
        uploader.name AS uploader_name,
        uploader.email AS uploader_email
       FROM ticket_attachments a
       LEFT JOIN users uploader ON uploader.id = a.uploaded_by
       WHERE a.organization_id = ?
         AND a.ticket_id = ?
         AND a.status = 'ACTIVE'
         AND a.deleted_at IS NULL
       ORDER BY a.created_at DESC, a.id DESC`,
    )
    .bind(organizationId, ticketId)
    .all();

  return (result?.results || []).map(publicTicketAttachment);
}

async function listTicketEvents(env, organizationId, ticketId) {
  const result = await getDb(env)
    .prepare(
      `SELECT
        e.*,
        actor.id AS actor_id,
        actor.name AS actor_name,
        actor.email AS actor_email
       FROM ticket_events e
       LEFT JOIN users actor ON actor.id = e.actor_user_id
       WHERE e.organization_id = ? AND e.ticket_id = ?
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 200`,
    )
    .bind(organizationId, ticketId)
    .all();

  return (result?.results || []).map(publicTicketEvent);
}

export async function getTicketDetails(env, organizationId, ticketId) {
  const row = await getTicketOrThrow(env, organizationId, ticketId);

  return {
    ticket: publicTicket(row),
    attachments: await listTicketAttachments(env, organizationId, ticketId),
    events: await listTicketEvents(env, organizationId, ticketId),
    assignees: await listTicketAssignees(env, organizationId),
    attachmentLimits: TICKET_ATTACHMENT_LIMITS,
  };
}

async function validateAssignee(env, organizationId, assignedTo) {
  if (!assignedTo) return null;

  const row = await getDb(env)
    .prepare(
      `SELECT users.id
       FROM organization_users
       INNER JOIN users ON users.id = organization_users.user_id
       WHERE organization_users.organization_id = ?
         AND organization_users.user_id = ?
         AND users.active = 1
       LIMIT 1`,
    )
    .bind(organizationId, assignedTo)
    .first();

  if (!row) {
    throw apiError(
      "O atendente não pertence à organização ativa.",
      400,
      "ASSIGNEE_NOT_IN_ORGANIZATION",
    );
  }

  return assignedTo;
}

export function validateTicketCreatePayload(payload = {}) {
  const subject = cleanText(payload.subject || payload.title, {
    required: true,
    maxLength: 160,
  });
  const description = cleanText(payload.description || payload.body, {
    required: true,
    maxLength: 5000,
  });
  const assignedTo =
    payload.assignedTo === null || payload.assignedTo === ""
      ? null
      : toPositiveInteger(payload.assignedTo);

  if (payload.assignedTo && !assignedTo) {
    throw apiError("Atendente inválido.", 400, "INVALID_ASSIGNEE");
  }

  return {
    subject,
    description,
    priority: normalizePriority(payload.priority),
    category: normalizeCategory(payload.category),
    dueAt: normalizeOptionalDate(payload.dueAt),
    assignedTo,
  };
}

export function validateTicketPatchPayload(payload = {}) {
  const patch = {};

  if (payload.subject !== undefined) {
    patch.subject = cleanText(payload.subject, {
      required: true,
      maxLength: 160,
    });
  }

  if (payload.description !== undefined) {
    patch.description = cleanText(payload.description, {
      required: true,
      maxLength: 5000,
    });
  }

  if (payload.status !== undefined) {
    patch.status = normalizeTicketStatus(payload.status);
  }

  if (payload.priority !== undefined) {
    patch.priority = normalizePriority(payload.priority);
  }

  if (payload.category !== undefined) {
    patch.category = normalizeCategory(payload.category);
  }

  if (payload.dueAt !== undefined) {
    patch.dueAt = normalizeOptionalDate(payload.dueAt);
  }

  if (payload.assignedTo !== undefined) {
    if (payload.assignedTo === null || payload.assignedTo === "") {
      patch.assignedTo = null;
    } else {
      const assignedTo = toPositiveInteger(payload.assignedTo);
      if (!assignedTo) {
        throw apiError("Atendente inválido.", 400, "INVALID_ASSIGNEE");
      }
      patch.assignedTo = assignedTo;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw apiError("Nenhuma alteração válida informada.", 400, "EMPTY_PATCH");
  }

  return patch;
}

async function enforceRateLimit(env, kind, organizationId, userId) {
  const isUpload = kind === "attachment";
  const table = isUpload ? "ticket_attachments" : "organization_tickets";
  const actorColumn = isUpload ? "uploaded_by" : "created_by";
  const limit = isUpload ? 20 : 10;
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const row = await getDb(env)
    .prepare(
      `SELECT COUNT(*) AS total
       FROM ${table}
       WHERE organization_id = ?
         AND ${actorColumn} = ?
         AND created_at >= ?`,
    )
    .bind(organizationId, userId, cutoff)
    .first();

  if (Number(row?.total || 0) >= limit) {
    throw apiError(
      "Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.",
      429,
      "TICKET_RATE_LIMITED",
      { retryAfter: 600 },
    );
  }
}

export async function recordTicketEvent(
  env,
  { organizationId, ticketId, type, actorUserId, metadata = {} },
) {
  return insertRow(env, "ticket_events", {
    organization_id: organizationId,
    ticket_id: ticketId,
    event_type: type,
    actor_user_id: actorUserId || null,
    metadata: JSON.stringify(metadata),
    created_at: isoNow(),
  });
}

export async function createTicket(
  env,
  organizationId,
  user,
  payload,
  request,
) {
  const data = validateTicketCreatePayload(payload);
  await validateAssignee(env, organizationId, data.assignedTo);
  await enforceRateLimit(env, "create", organizationId, user.id);

  const timestamp = isoNow();
  const inserted = await insertRow(env, "organization_tickets", {
    organization_id: organizationId,
    subject: data.subject,
    description: data.description,
    status: "new",
    priority: data.priority,
    category: data.category,
    assigned_to: data.assignedTo,
    due_at: data.dueAt,
    created_by: user.id,
    active: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const code = `TKT-${String(inserted.id).padStart(6, "0")}`;
  await updateRow(env, "organization_tickets", inserted.id, { code });

  await recordTicketEvent(env, {
    organizationId,
    ticketId: inserted.id,
    type: "ticket.created",
    actorUserId: user.id,
    metadata: {
      code,
      priority: data.priority,
      category: data.category,
      assignedTo: data.assignedTo,
      dueAt: data.dueAt,
    },
  });

  await recordAuditLog(env, {
    actorUserId: user.id,
    organizationId,
    action: "ticket.created",
    resourceType: "ticket",
    resourceId: inserted.id,
    metadata: { code },
    request,
  });

  return publicTicket(
    await getTicketOrThrow(env, organizationId, inserted.id),
  );
}

function changed(previous, next) {
  return String(previous ?? "") !== String(next ?? "");
}

export async function updateTicket(
  env,
  organizationId,
  ticketId,
  user,
  payload,
  request,
) {
  const current = await getTicketOrThrow(env, organizationId, ticketId);
  const patch = validateTicketPatchPayload(payload);

  if (Object.prototype.hasOwnProperty.call(patch, "assignedTo")) {
    await validateAssignee(env, organizationId, patch.assignedTo);
  }

  const updates = {
    subject: patch.subject,
    description: patch.description,
    status: patch.status,
    priority: patch.priority,
    category: patch.category,
    assigned_to: patch.assignedTo,
    due_at: patch.dueAt,
    updated_at: isoNow(),
  };

  if (patch.status === "closed" && current.status !== "closed") {
    updates.closed_at = isoNow();
  } else if (patch.status && patch.status !== "closed") {
    updates.closed_at = null;
  }

  await updateRow(env, "organization_tickets", ticketId, updates);

  const events = [];
  if (patch.status && changed(current.status, patch.status)) {
    events.push({
      type: "ticket.status.changed",
      metadata: { from: current.status, to: patch.status },
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, "assignedTo") &&
    changed(current.assigned_to, patch.assignedTo)
  ) {
    events.push({
      type: "ticket.assigned",
      metadata: {
        from: current.assigned_to || null,
        to: patch.assignedTo || null,
      },
    });
  }
  if (patch.dueAt !== undefined && changed(current.due_at, patch.dueAt)) {
    events.push({
      type: "ticket.due.changed",
      metadata: { from: current.due_at || null, to: patch.dueAt || null },
    });
  }
  if (
    patch.priority &&
    changed(current.priority || "normal", patch.priority)
  ) {
    events.push({
      type: "ticket.priority.changed",
      metadata: { from: current.priority || "normal", to: patch.priority },
    });
  }

  for (const event of events) {
    await recordTicketEvent(env, {
      organizationId,
      ticketId,
      type: event.type,
      actorUserId: user.id,
      metadata: event.metadata,
    });
  }

  await recordAuditLog(env, {
    actorUserId: user.id,
    organizationId,
    action: events[0]?.type || "ticket.updated",
    resourceType: "ticket",
    resourceId: ticketId,
    metadata: { fields: Object.keys(patch) },
    request,
  });

  return publicTicket(await getTicketOrThrow(env, organizationId, ticketId));
}

export async function readTicketAttachmentUpload(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    throw apiError(
      "Não foi possível interpretar o formulário de upload.",
      400,
      "ATTACHMENT_FORM_INVALID",
    );
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw apiError("Arquivo não enviado.", 400, "ATTACHMENT_REQUIRED");
  }

  const originalName = sanitizeFileName(file.name || "anexo");
  const extension = extensionFromName(originalName);
  const allowedMimeTypes = ATTACHMENT_TYPES[extension];

  if (!allowedMimeTypes) {
    throw apiError(
      "Tipo de arquivo não permitido.",
      415,
      "ATTACHMENT_TYPE_NOT_ALLOWED",
    );
  }

  const mimeType = String(file.type || "application/octet-stream").toLowerCase();
  if (!allowedMimeTypes.includes(mimeType)) {
    throw apiError(
      "O MIME do arquivo não é permitido.",
      415,
      "ATTACHMENT_MIME_NOT_ALLOWED",
    );
  }

  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength <= 0) {
    throw apiError("Arquivo vazio.", 400, "ATTACHMENT_EMPTY");
  }

  if (arrayBuffer.byteLength > MAX_MULTIPART_ATTACHMENT_BYTES) {
    throw apiError(
      "Envios tradicionais aceitam até 10 MB. Use o envio em partes para arquivos maiores.",
      413,
      "ATTACHMENT_CHUNK_UPLOAD_REQUIRED",
    );
  }

  assertFileSignature(extension, arrayBuffer);

  return {
    arrayBuffer,
    originalName,
    mimeType,
    size: arrayBuffer.byteLength,
    sha256: await sha256Hex(arrayBuffer),
  };
}

async function expireStaleTicketUploads(env, organizationId, ticketId) {
  const cutoff = new Date(Date.now() - PENDING_UPLOAD_TTL_MS).toISOString();
  await getDb(env)
    .prepare(
      `UPDATE ticket_attachments
       SET status = 'FAILED',
           error_message = 'Sessão de upload expirada.',
           updated_at = ?
       WHERE organization_id = ?
         AND ticket_id = ?
         AND status = 'PENDING'
         AND updated_at < ?`,
    )
    .bind(isoNow(), organizationId, ticketId, cutoff)
    .run();
}

async function assertAttachmentCapacity(env, organizationId, ticketId, size) {
  await expireStaleTicketUploads(env, organizationId, ticketId);
  const row = await getDb(env)
    .prepare(
      `SELECT COUNT(*) AS total_files, COALESCE(SUM(size_bytes), 0) AS total_bytes
       FROM ticket_attachments
       WHERE organization_id = ?
         AND ticket_id = ?
         AND status IN ('ACTIVE', 'PENDING')
         AND deleted_at IS NULL`,
    )
    .bind(organizationId, ticketId)
    .first();

  if (Number(row?.total_files || 0) >= MAX_ATTACHMENTS_PER_TICKET) {
    throw apiError(
      "O chamado já possui o limite de 5 anexos.",
      409,
      "ATTACHMENT_COUNT_LIMIT",
    );
  }

  if (Number(row?.total_bytes || 0) + size > MAX_TICKET_ATTACHMENT_BYTES) {
    throw apiError(
      "Os anexos do chamado não podem ultrapassar 150 MB.",
      413,
      "ATTACHMENT_TOTAL_LIMIT",
    );
  }
}

export function validateTicketAttachmentMetadata(payload = {}) {
  const originalName = sanitizeFileName(
    payload.name || payload.fileName || "anexo",
  );
  const extension = extensionFromName(originalName);
  const allowedMimeTypes = ATTACHMENT_TYPES[extension];

  if (!allowedMimeTypes) {
    throw apiError(
      "Tipo de arquivo não permitido.",
      415,
      "ATTACHMENT_TYPE_NOT_ALLOWED",
    );
  }

  const mimeType = String(
    payload.mimeType || payload.type || "application/octet-stream",
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    !allowedMimeTypes.includes(mimeType) &&
    mimeType !== "application/octet-stream"
  ) {
    throw apiError(
      "O MIME do arquivo não é permitido.",
      415,
      "ATTACHMENT_MIME_NOT_ALLOWED",
    );
  }

  const size = Number(payload.size);
  if (!Number.isInteger(size) || size <= 0) {
    throw apiError("Arquivo vazio ou tamanho inválido.", 400, "ATTACHMENT_EMPTY");
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    throw apiError(
      "Cada anexo pode ter no máximo 80 MB.",
      413,
      "ATTACHMENT_TOO_LARGE",
    );
  }

  return { originalName, extension, mimeType, size };
}

export async function initiateTicketAttachmentUpload(
  env,
  organizationId,
  ticketId,
  user,
  payload,
) {
  const ticket = await getTicketOrThrow(env, organizationId, ticketId);
  if (ticket.status === "closed") {
    throw apiError(
      "Não é possível anexar arquivos a um chamado concluído.",
      409,
      "TICKET_CLOSED",
    );
  }

  await enforceRateLimit(env, "attachment", organizationId, user.id);
  const upload = validateTicketAttachmentMetadata(payload);
  await assertAttachmentCapacity(env, organizationId, ticketId, upload.size);

  const organization = await getOrganizationOrThrow(env, organizationId);
  const storage = await ensureOrganizationStorage(env, organization, {
    provisionDocuments: false,
  });
  const rootPath = `${storage.rootPath || canonicalOrganizationRoot(organization)}/tickets/${ticketId}/attachments`;
  const storedName = buildStoredFileName(upload.originalName);
  const storageKey = organizationFileDropboxPath(rootPath, storedName);
  const timestamp = isoNow();
  let pending = null;

  try {
    pending = await insertRow(env, "ticket_attachments", {
      organization_id: organizationId,
      ticket_id: ticketId,
      original_name: upload.originalName,
      stored_name: storedName,
      storage_key: storageKey,
      mime_type: upload.mimeType,
      size_bytes: upload.size,
      sha256: null,
      status: "PENDING",
      uploaded_by: user.id,
      dropbox_rev: "0",
      created_at: timestamp,
      updated_at: timestamp,
    });

    const session = await startOrganizationBinaryUpload(env, rootPath);
    if (!session?.session_id) {
      throw apiError(
        "O provedor de arquivos não iniciou a sessão de upload.",
        502,
        "ATTACHMENT_UPLOAD_SESSION_INVALID",
      );
    }

    const activePending = await updateRow(
      env,
      "ticket_attachments",
      pending.id,
      {
        dropbox_file_id: session.session_id,
        dropbox_rev: "0",
        error_message: null,
        updated_at: isoNow(),
      },
    );

    return {
      attachment: publicTicketAttachment(activePending || pending),
      upload: {
        attachmentId: pending.id,
        offset: 0,
        chunkSize: MAX_UPLOAD_CHUNK_BYTES,
        size: upload.size,
      },
    };
  } catch (error) {
    if (pending?.id) {
      try {
        await updateRow(env, "ticket_attachments", pending.id, {
          status: "FAILED",
          error_message: String(error?.message || "Falha ao iniciar upload").slice(
            0,
            1000,
          ),
          updated_at: isoNow(),
        });
      } catch (metadataError) {
        console.error("[Maono ticket upload][start metadata]", metadataError);
      }
    }
    throw error;
  }
}

async function getPendingTicketAttachmentOrThrow(
  env,
  organizationId,
  ticketId,
  attachmentId,
) {
  const row = await getDb(env)
    .prepare(
      `SELECT *
       FROM ticket_attachments
       WHERE id = ?
         AND organization_id = ?
         AND ticket_id = ?
         AND status = 'PENDING'
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(attachmentId, organizationId, ticketId)
    .first();

  if (!row) {
    throw apiError(
      "Sessão de upload não encontrada ou já concluída.",
      404,
      "ATTACHMENT_UPLOAD_NOT_FOUND",
    );
  }
  return row;
}

function parseUploadOffset(request) {
  const rawOffset = request.headers.get("Upload-Offset");
  const offset = Number(rawOffset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw apiError(
      "Offset do upload inválido.",
      400,
      "ATTACHMENT_UPLOAD_OFFSET_INVALID",
    );
  }
  return offset;
}

export async function uploadTicketAttachmentChunk(
  env,
  organizationId,
  ticketId,
  attachmentId,
  user,
  request,
) {
  const ticket = await getTicketOrThrow(env, organizationId, ticketId);
  if (ticket.status === "closed") {
    throw apiError(
      "Não é possível anexar arquivos a um chamado concluído.",
      409,
      "TICKET_CLOSED",
    );
  }

  const pending = await getPendingTicketAttachmentOrThrow(
    env,
    organizationId,
    ticketId,
    attachmentId,
  );
  if (String(pending.uploaded_by) !== String(user.id)) {
    throw apiError(
      "Esta sessão de upload pertence a outro usuário.",
      403,
      "ATTACHMENT_UPLOAD_FORBIDDEN",
    );
  }

  const offset = parseUploadOffset(request);
  const expectedOffset = Number(pending.dropbox_rev || 0);
  if (offset !== expectedOffset) {
    throw apiError(
      `O envio está fora de sequência. Retome a partir do byte ${expectedOffset}.`,
      409,
      "ATTACHMENT_UPLOAD_OFFSET_MISMATCH",
      { expectedOffset },
    );
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_UPLOAD_CHUNK_BYTES) {
    throw apiError(
      "Cada parte do upload pode ter no máximo 8 MB.",
      413,
      "ATTACHMENT_CHUNK_TOO_LARGE",
    );
  }

  const arrayBuffer = await request.arrayBuffer();
  if (arrayBuffer.byteLength <= 0) {
    throw apiError("Parte do upload vazia.", 400, "ATTACHMENT_CHUNK_EMPTY");
  }
  if (arrayBuffer.byteLength > MAX_UPLOAD_CHUNK_BYTES) {
    throw apiError(
      "Cada parte do upload pode ter no máximo 8 MB.",
      413,
      "ATTACHMENT_CHUNK_TOO_LARGE",
    );
  }

  const nextOffset = offset + arrayBuffer.byteLength;
  const expectedSize = Number(pending.size_bytes || 0);
  if (nextOffset > expectedSize) {
    throw apiError(
      "O conteúdo enviado ultrapassa o tamanho declarado do arquivo.",
      409,
      "ATTACHMENT_UPLOAD_SIZE_MISMATCH",
    );
  }
  if (offset === 0) {
    assertFileSignature(extensionFromName(pending.original_name), arrayBuffer);
  }

  const sessionId = String(pending.dropbox_file_id || "");
  if (!sessionId) {
    throw apiError(
      "Sessão de upload inválida.",
      409,
      "ATTACHMENT_UPLOAD_SESSION_INVALID",
    );
  }

  const complete = nextOffset === expectedSize;
  try {
    if (!complete) {
      await appendOrganizationBinaryUpload(
        env,
        sessionId,
        offset,
        arrayBuffer,
      );
      await updateRow(env, "ticket_attachments", attachmentId, {
        dropbox_rev: String(nextOffset),
        error_message: null,
        updated_at: isoNow(),
      });
      return { attachment: null, offset: nextOffset, complete: false };
    }

    const { rootPath, fileName } = splitDropboxFilePath(pending.storage_key);
    const metadata = await finishOrganizationBinaryUpload(
      env,
      sessionId,
      offset,
      rootPath,
      fileName,
      arrayBuffer,
    );
    const active = await updateRow(env, "ticket_attachments", attachmentId, {
      status: "ACTIVE",
      dropbox_file_id: metadata?.id || null,
      dropbox_rev: metadata?.rev || null,
      error_message: null,
      updated_at: isoNow(),
    });

    await recordTicketEvent(env, {
      organizationId,
      ticketId,
      type: "ticket.attachment.added",
      actorUserId: user.id,
      metadata: {
        attachmentId,
        fileName: pending.original_name,
        size: expectedSize,
      },
    });
    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "ticket.attachment.added",
      resourceType: "ticket_attachment",
      resourceId: attachmentId,
      metadata: { ticketId, fileName: pending.original_name },
      request,
    });

    return {
      attachment: publicTicketAttachment(active || { ...pending, status: "ACTIVE" }),
      offset: nextOffset,
      complete: true,
    };
  } catch (error) {
    try {
      await updateRow(env, "ticket_attachments", attachmentId, {
        error_message: String(error?.message || "Falha no upload").slice(0, 1000),
        updated_at: isoNow(),
      });
    } catch (metadataError) {
      console.error("[Maono ticket upload][chunk metadata]", metadataError);
    }
    throw error;
  }
}

export async function createTicketAttachment(
  env,
  organizationId,
  ticketId,
  user,
  request,
) {
  const ticket = await getTicketOrThrow(env, organizationId, ticketId);
  if (ticket.status === "closed") {
    throw apiError(
      "Não é possível anexar arquivos a um chamado concluído.",
      409,
      "TICKET_CLOSED",
    );
  }

  await enforceRateLimit(env, "attachment", organizationId, user.id);
  const upload = await readTicketAttachmentUpload(request);
  await assertAttachmentCapacity(
    env,
    organizationId,
    ticketId,
    upload.size,
  );

  const organization = await getOrganizationOrThrow(env, organizationId);
  const storage = await ensureOrganizationStorage(env, organization, {
    provisionDocuments: false,
  });
  const rootPath = `${storage.rootPath || canonicalOrganizationRoot(organization)}/tickets/${ticketId}/attachments`;
  const storedName = buildStoredFileName(upload.originalName);
  const storageKey = organizationFileDropboxPath(rootPath, storedName);
  const timestamp = isoNow();

  let pending = null;
  let uploaded = false;

  try {
    pending = await insertRow(env, "ticket_attachments", {
      organization_id: organizationId,
      ticket_id: ticketId,
      original_name: upload.originalName,
      stored_name: storedName,
      storage_key: storageKey,
      mime_type: upload.mimeType,
      size_bytes: upload.size,
      sha256: upload.sha256,
      status: "PENDING",
      uploaded_by: user.id,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const metadata = await uploadOrganizationBinary(
      env,
      rootPath,
      storedName,
      upload.arrayBuffer,
    );
    uploaded = true;

    const active = await updateRow(env, "ticket_attachments", pending.id, {
      status: "ACTIVE",
      dropbox_file_id: metadata?.id || null,
      dropbox_rev: metadata?.rev || null,
      error_message: null,
      updated_at: isoNow(),
    });

    await recordTicketEvent(env, {
      organizationId,
      ticketId,
      type: "ticket.attachment.added",
      actorUserId: user.id,
      metadata: {
        attachmentId: pending.id,
        fileName: upload.originalName,
        size: upload.size,
      },
    });

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "ticket.attachment.added",
      resourceType: "ticket_attachment",
      resourceId: pending.id,
      metadata: { ticketId, fileName: upload.originalName },
      request,
    });

    return publicTicketAttachment(
      active || { ...pending, status: "ACTIVE" },
    );
  } catch (error) {
    if (pending?.id) {
      try {
        await updateRow(env, "ticket_attachments", pending.id, {
          status: "FAILED",
          error_message: String(error?.message || "Falha no upload").slice(0, 1000),
          updated_at: isoNow(),
        });
      } catch (metadataError) {
        console.error("[Maono ticket attachment][metadata]", metadataError);
      }
    }

    if (uploaded) {
      try {
        await deleteOrganizationBinary(env, storageKey);
      } catch (cleanupError) {
        console.error("[Maono ticket attachment][cleanup]", cleanupError);
      }
    }

    throw error;
  }
}

export async function getTicketAttachmentRecordOrThrow(
  env,
  organizationId,
  ticketId,
  attachmentId,
  statuses = ["ACTIVE"],
) {
  const allowedStatuses = statuses.filter((status) =>
    ["PENDING", "ACTIVE", "FAILED", "DELETED"].includes(status),
  );
  if (allowedStatuses.length === 0) {
    throw apiError("Estado de anexo inválido.", 500, "ATTACHMENT_STATUS_INVALID");
  }
  const statusPlaceholders = allowedStatuses.map(() => "?").join(", ");
  const row = await getDb(env)
    .prepare(
      `SELECT
        a.*,
        uploader.id AS uploader_id,
        uploader.name AS uploader_name,
        uploader.email AS uploader_email
       FROM ticket_attachments a
       LEFT JOIN users uploader ON uploader.id = a.uploaded_by
       WHERE a.id = ?
         AND a.organization_id = ?
         AND a.ticket_id = ?
         AND a.status IN (${statusPlaceholders})
         AND a.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(attachmentId, organizationId, ticketId, ...allowedStatuses)
    .first();

  if (!row) {
    throw apiError("Anexo não encontrado.", 404, "ATTACHMENT_NOT_FOUND");
  }

  return row;
}

export async function getTicketAttachmentOrThrow(
  env,
  organizationId,
  ticketId,
  attachmentId,
) {
  return getTicketAttachmentRecordOrThrow(
    env,
    organizationId,
    ticketId,
    attachmentId,
    ["ACTIVE"],
  );
}

export async function downloadTicketAttachment(
  env,
  organizationId,
  ticketId,
  attachmentId,
) {
  await getTicketOrThrow(env, organizationId, ticketId);
  const attachment = await getTicketAttachmentOrThrow(
    env,
    organizationId,
    ticketId,
    attachmentId,
  );
  const response = await downloadOrganizationBinary(env, attachment.storage_key);

  return {
    attachment,
    response,
    headers: fileDownloadHeaders(
      {
        original_name: attachment.original_name,
        name: attachment.original_name,
        file_name: attachment.stored_name,
        mime_type: attachment.mime_type,
      },
      response,
    ),
  };
}

export async function deleteTicketAttachment(
  env,
  organizationId,
  ticketId,
  attachmentId,
  user,
  request,
) {
  await getTicketOrThrow(env, organizationId, ticketId);
  const attachment = await getTicketAttachmentRecordOrThrow(
    env,
    organizationId,
    ticketId,
    attachmentId,
    ["ACTIVE", "PENDING"],
  );

  if (attachment.status === "ACTIVE") {
    await deleteOrganizationBinary(env, attachment.storage_key);
  }
  await updateRow(env, "ticket_attachments", attachmentId, {
    status: attachment.status === "PENDING" ? "FAILED" : "DELETED",
    error_message:
      attachment.status === "PENDING" ? "Upload cancelado pelo usuário." : null,
    deleted_at: isoNow(),
    updated_at: isoNow(),
  });

  await recordTicketEvent(env, {
    organizationId,
    ticketId,
    type:
      attachment.status === "PENDING"
        ? "ticket.attachment.upload_cancelled"
        : "ticket.attachment.deleted",
    actorUserId: user.id,
    metadata: {
      attachmentId,
      fileName: attachment.original_name,
    },
  });

  await recordAuditLog(env, {
    actorUserId: user.id,
    organizationId,
    action:
      attachment.status === "PENDING"
        ? "ticket.attachment.upload_cancelled"
        : "ticket.attachment.deleted",
    resourceType: "ticket_attachment",
    resourceId: attachmentId,
    metadata: { ticketId, fileName: attachment.original_name },
    request,
  });
}

export function canCreatorDeleteAttachment(ticket, attachment, userId) {
  if (
    attachment.status === "PENDING" &&
    String(attachment.uploaded_by) === String(userId)
  ) {
    return true;
  }

  return (
    ticket.status !== "closed" &&
    String(attachment.uploaded_by) === String(userId)
  );
}
