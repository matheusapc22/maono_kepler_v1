import {
  can,
  isKnownPermission,
  isNativeAdminOrOwnerPermission,
  recordAuditLog,
} from "./permissions.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const MAX_ORGANIZATION_FILE_BYTES = 50 * 1024 * 1024;

const EXPORT_TYPES = new Set([
  "projects_summary",
  "documents_index",
  "tickets_summary",
]);

const EXPORT_FORMATS = new Set(["csv", "json"]);

const TICKET_PRIORITIES = new Set(["low", "normal", "high"]);
const TICKET_STATUSES = new Set(["open", "in_progress", "resolved", "closed"]);

const USER_ROLES = new Set([
  "viewer",
  "editor",
  "owner",
  "admin",
  "super_admin",
]);

const ORGANIZATION_ACCESS_LEVELS = new Set([
  "viewer",
  "editor",
  "owner",
]);

const ROLE_RANK = {
  viewer: 1,
  editor: 2,
  owner: 3,
  admin: 4,
  super_admin: 5,
};

const OWNER_ASSIGNABLE_ROLES = new Set(["viewer", "editor"]);
const OWNER_ASSIGNABLE_ACCESS_LEVELS = new Set(["viewer", "editor"]);

const ADMIN_ASSIGNABLE_ROLES = new Set(["viewer", "editor", "owner", "admin"]);
const ADMIN_ASSIGNABLE_ACCESS_LEVELS = new Set(["viewer", "editor", "owner"]);

const OWNER_GRANTABLE_PERMISSIONS = new Set([
  "document.view",
  "document.upload",
  "document.download",
  "document.delete",

  "ticket.view",
  "ticket.create",
  "ticket.comment",

  "export.view",
  "export.create",

  "users.view",

  "organization.view",
  "organization.metrics.view",

  "limits.view",
  "limits.increase_request",
]);

const LIMIT_REQUEST_TYPES = new Set([
  "plan_upgrade",
  "users_increase",
  "projects_increase",
  "storage_increase",
  "exports_increase",
]);

const ORGANIZATION_PLANS = {
  free: {
    users: 10,
    projects: 5,
    storageMb: 500,
    exports: 50,
  },
  pro: {
    users: 50,
    projects: 50,
    storageMb: 10_000,
    exports: 1_000,
  },
  enterprise: {
    users: 500,
    projects: 500,
    storageMb: 100_000,
    exports: 10_000,
  },
};

export function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function methodNotAllowed(method, allowedMethods = []) {
  return jsonResponse(
    {
      ok: false,
      error: `Método ${method} não permitido.`,
      allowedMethods,
    },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
      },
    },
  );
}

export function handleApiError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;

  if (safeStatus >= 500) {
    console.error("[Maono organizations API]", error);
  }

  return jsonResponse(
    {
      ok: false,
      error:
        safeStatus >= 500
          ? "Erro interno ao processar a requisição."
          : error?.message || "Erro na requisição.",
      code: error?.code || undefined,
      reason: error?.reason || undefined,
    },
    { status: safeStatus },
  );
}

export function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    const error = new Error("Banco de dados D1 não configurado.");
    error.status = 500;
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  return db;
}

export function parsePositiveInteger(value, label = "id") {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`${label} inválido.`);
    error.status = 400;
    error.code = "INVALID_ID";
    throw error;
  }

  return id;
}

export function getRouteParam(params, key) {
  const value = params?.[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export async function readJsonBody(request) {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("JSON inválido.");
    error.status = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

export function normalizeText(value, { required = false, maxLength = 500 } = {}) {
  if (value === null || value === undefined) {
    if (required) {
      const error = new Error("Campo obrigatório ausente.");
      error.status = 400;
      error.code = "REQUIRED_FIELD";
      throw error;
    }

    return "";
  }

  const text = String(value).trim();

  if (required && !text) {
    const error = new Error("Campo obrigatório ausente.");
    error.status = 400;
    error.code = "REQUIRED_FIELD";
    throw error;
  }

  if (text.length > maxLength) {
    const error = new Error(`Campo excede o limite de ${maxLength} caracteres.`);
    error.status = 400;
    error.code = "FIELD_TOO_LONG";
    throw error;
  }

  return text;
}

export function sanitizeFileName(name) {
  const fallback = "documento";
  const rawName = String(name || fallback).trim() || fallback;

  return rawName
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 160) || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createApiError(message, status = 400, code = "BAD_REQUEST", extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;

  Object.assign(error, extra);

  return error;
}

function normalizeUserRole(value, fallback = "viewer") {
  const role = String(value || fallback).trim().toLowerCase();

  if (!USER_ROLES.has(role)) {
    throw createApiError("Role inválida.", 400, "INVALID_ROLE");
  }

  return role;
}

function normalizeOrganizationAccessLevel(value, fallback = "viewer") {
  const accessLevel = String(value || fallback).trim().toLowerCase();

  if (!ORGANIZATION_ACCESS_LEVELS.has(accessLevel)) {
    throw createApiError("Nível de acesso inválido.", 400, "INVALID_ACCESS_LEVEL");
  }

  return accessLevel;
}

function normalizeEmail(value) {
  const email = normalizeText(value, {
    required: true,
    maxLength: 254,
  }).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createApiError("E-mail inválido.", 400, "INVALID_EMAIL");
  }

  return email;
}

function normalizeBooleanPatch(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }

  throw createApiError("Valor booleano inválido.", 400, "INVALID_BOOLEAN");
}

function getActorRole(actor) {
  return normalizeUserRole(actor?.role || "viewer");
}

function assertKnownPermission(permission) {
  const normalized = normalizeText(permission, {
    required: true,
    maxLength: 120,
  });

  if (!isKnownPermission(normalized)) {
    throw createApiError("Permissão desconhecida.", 400, "UNKNOWN_PERMISSION");
  }

  return normalized;
}

function safeJsonParse(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

export async function tableExists(env, tableName) {
  const db = getDb(env);
  const row = await db
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
      `,
    )
    .bind(tableName)
    .first();

  return Boolean(row?.name);
}

export async function requireTable(env, tableName) {
  if (await tableExists(env, tableName)) {
    return true;
  }

  const error = new Error(`Tabela ${tableName} não encontrada. Aplique a migration correspondente antes de usar este endpoint.`);
  error.status = 500;
  error.code = "TABLE_NOT_FOUND";
  throw error;
}

export async function getTableColumns(env, tableName) {
  await requireTable(env, tableName);

  const db = getDb(env);
  const result = await db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();

  return new Set((result?.results || []).map((row) => String(row.name)));
}

function hasColumn(columns, column) {
  return columns.has(column);
}

export async function getOrganizationOrThrow(env, organizationId) {
  await requireTable(env, "organizations");

  const db = getDb(env);
  const organization = await db
    .prepare(
      `
      SELECT *
      FROM organizations
      WHERE id = ?
      LIMIT 1
      `,
    )
    .bind(organizationId)
    .first();

  if (!organization || organization.active === 0 || organization.active === "0") {
    const error = new Error("Organização não encontrada.");
    error.status = 404;
    error.code = "ORGANIZATION_NOT_FOUND";
    throw error;
  }

  return organization;
}

export async function getOrganizationById(env, organizationId) {
  const id = parsePositiveInteger(organizationId, "organizationId");

  return getOrganizationOrThrow(env, id);
}

export async function requireOrganizationAccess(env, user, organizationId, permission) {
  const id = parsePositiveInteger(organizationId, "organizationId");
  const organization = await getOrganizationById(env, id);

  const decision = await can(env, user, permission, {
    organizationId: id,
    scopeType: "organization",
  });

  if (!decision.allowed) {
    throw createApiError("Acesso negado.", 403, "FORBIDDEN", {
      reason: decision.reason,
      permission,
    });
  }

  return {
    organization,
    organizationId: id,
    decision,
  };
}

export async function listRowsByOrganization(env, tableName, organizationId) {
  const columns = await getTableColumns(env, tableName);

  if (!hasColumn(columns, "organization_id")) {
    const error = new Error(`Tabela ${tableName} não possui organization_id.`);
    error.status = 500;
    error.code = "INVALID_SCHEMA";
    throw error;
  }

  const where = ["organization_id = ?"];

  if (hasColumn(columns, "deleted_at")) {
    where.push("deleted_at IS NULL");
  }

  if (hasColumn(columns, "active")) {
    where.push("(active = 1 OR active IS NULL)");
  }

  const orderColumn = hasColumn(columns, "updated_at")
    ? "updated_at"
    : hasColumn(columns, "created_at")
      ? "created_at"
      : hasColumn(columns, "id")
        ? "id"
        : null;

  const sql = `
    SELECT *
    FROM ${quoteIdentifier(tableName)}
    WHERE ${where.join(" AND ")}
    ${orderColumn ? `ORDER BY ${quoteIdentifier(orderColumn)} DESC` : ""}
  `;

  const result = await getDb(env).prepare(sql).bind(organizationId).all();

  return result?.results || [];
}

export async function findRowByIdAndOrganization(env, tableName, rowId, organizationId) {
  const columns = await getTableColumns(env, tableName);

  if (!hasColumn(columns, "id") || !hasColumn(columns, "organization_id")) {
    const error = new Error(`Tabela ${tableName} precisa ter id e organization_id.`);
    error.status = 500;
    error.code = "INVALID_SCHEMA";
    throw error;
  }

  const where = ["id = ?", "organization_id = ?"];

  if (hasColumn(columns, "deleted_at")) {
    where.push("deleted_at IS NULL");
  }

  if (hasColumn(columns, "active")) {
    where.push("(active = 1 OR active IS NULL)");
  }

  const row = await getDb(env)
    .prepare(
      `
      SELECT *
      FROM ${quoteIdentifier(tableName)}
      WHERE ${where.join(" AND ")}
      LIMIT 1
      `,
    )
    .bind(rowId, organizationId)
    .first();

  return row || null;
}

export async function insertRow(env, tableName, data) {
  const columns = await getTableColumns(env, tableName);
  const entries = Object.entries(data).filter(
    ([column, value]) => value !== undefined && hasColumn(columns, column),
  );

  if (entries.length === 0) {
    const error = new Error(`Nenhuma coluna compatível para inserir em ${tableName}.`);
    error.status = 500;
    error.code = "INVALID_SCHEMA";
    throw error;
  }

  const columnNames = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const values = entries.map(([, value]) => value);

  const result = await getDb(env)
    .prepare(
      `
      INSERT INTO ${quoteIdentifier(tableName)} (${columnNames})
      VALUES (${placeholders})
      `,
    )
    .bind(...values)
    .run();

  const lastInsertId = result?.meta?.last_row_id || result?.meta?.last_insert_rowid;

  if (lastInsertId && hasColumn(columns, "id")) {
    const row = await getDb(env)
      .prepare(`SELECT * FROM ${quoteIdentifier(tableName)} WHERE id = ? LIMIT 1`)
      .bind(lastInsertId)
      .first();

    return row || { id: lastInsertId, ...data };
  }

  return { id: lastInsertId || null, ...data };
}

export async function updateRow(env, tableName, rowId, data) {
  const columns = await getTableColumns(env, tableName);
  const entries = Object.entries(data).filter(
    ([column, value]) => value !== undefined && hasColumn(columns, column),
  );

  if (entries.length === 0) {
    return null;
  }

  const assignments = entries
    .map(([column]) => `${quoteIdentifier(column)} = ?`)
    .join(", ");

  await getDb(env)
    .prepare(
      `
      UPDATE ${quoteIdentifier(tableName)}
      SET ${assignments}
      WHERE id = ?
      `,
    )
    .bind(...entries.map(([, value]) => value), rowId)
    .run();

  return getDb(env)
    .prepare(`SELECT * FROM ${quoteIdentifier(tableName)} WHERE id = ? LIMIT 1`)
    .bind(rowId)
    .first();
}

export async function deleteOrSoftDeleteRow(env, tableName, rowId) {
  const columns = await getTableColumns(env, tableName);

  if (hasColumn(columns, "deleted_at")) {
    await updateRow(env, tableName, rowId, {
      deleted_at: nowIso(),
      updated_at: nowIso(),
    });

    return;
  }

  if (hasColumn(columns, "active")) {
    await updateRow(env, tableName, rowId, {
      active: 0,
      updated_at: nowIso(),
    });

    return;
  }

  await getDb(env)
    .prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE id = ?`)
    .bind(rowId)
    .run();
}

export function normalizeOrganizationFile(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name:
      row.name ||
      row.file_name ||
      row.original_name ||
      row.title ||
      "Documento",
    mimeType: row.mime_type || row.content_type || null,
    size: row.size_bytes || row.size || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: row.created_by || row.uploaded_by || row.user_id || null,
  };
}

export function getFileDropboxPath(row) {
  return (
    row.dropbox_path ||
    row.path ||
    row.file_path ||
    row.storage_path ||
    null
  );
}

export function normalizeTicket(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subject: row.subject || row.title || "Chamado",
    description: row.description || row.body || null,
    status: row.status || "open",
    priority: row.priority || "normal",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: row.created_by || row.user_id || null,
    assignedTo: row.assigned_to || null,
  };
}

export function normalizeExport(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type || row.export_type,
    format: row.format || row.file_format,
    status: row.status || "queued",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    requestedBy: row.requested_by || row.created_by || null,
  };
}

export function sanitizeOrganization(row, metrics = null) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name || "Organização",
    slug: row.slug || null,
    active: row.active === undefined ? true : !(row.active === 0 || row.active === "0"),
    plan: row.plan || row.plan_slug || "free",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    metrics: metrics || undefined,
  };
}

export function sanitizeOrganizationUser(
  row,
  permissions = [],
  deniedPermissions = [],
) {
  if (!row) {
    return null;
  }

  const activeValue =
    row.user_active !== undefined
      ? row.user_active
      : row.active !== undefined
        ? row.active
        : 1;

  return {
    id: row.id || row.user_id,
    organizationId: row.organization_id,
    name: row.name || row.full_name || row.email || "Usuário",
    email: row.email || null,
    role: row.role || "viewer",
    accessLevel: row.access_level || "viewer",
    active: !(activeValue === 0 || activeValue === "0"),
    permissions,
    deniedPermissions,
    createdAt: row.created_at || row.user_created_at || null,
    updatedAt: row.updated_at || row.user_updated_at || null,
    membershipCreatedAt: row.membership_created_at || null,
  };
}

async function getOrganizationUserRow(env, organizationId, userId) {
  await requireTable(env, "users");
  await requireTable(env, "organization_users");

  const userColumns = await getTableColumns(env, "users");
  const membershipColumns = await getTableColumns(env, "organization_users");

  const select = [
    hasColumn(userColumns, "id") ? "u.id AS id" : "ou.user_id AS id",
    hasColumn(userColumns, "name") ? "u.name AS name" : "NULL AS name",
    hasColumn(userColumns, "full_name") ? "u.full_name AS full_name" : "NULL AS full_name",
    hasColumn(userColumns, "email") ? "u.email AS email" : "NULL AS email",
    hasColumn(userColumns, "role") ? "u.role AS role" : "'viewer' AS role",
    hasColumn(userColumns, "active") ? "u.active AS user_active" : "1 AS user_active",
    hasColumn(userColumns, "created_at") ? "u.created_at AS user_created_at" : "NULL AS user_created_at",
    hasColumn(userColumns, "updated_at") ? "u.updated_at AS user_updated_at" : "NULL AS user_updated_at",

    hasColumn(membershipColumns, "id") ? "ou.id AS membership_id" : "NULL AS membership_id",
    "ou.organization_id AS organization_id",
    "ou.user_id AS user_id",
    hasColumn(membershipColumns, "access_level") ? "ou.access_level AS access_level" : "'viewer' AS access_level",
    hasColumn(membershipColumns, "created_at") ? "ou.created_at AS membership_created_at" : "NULL AS membership_created_at",
  ];

  const where = ["ou.organization_id = ?", "ou.user_id = ?"];

  if (hasColumn(membershipColumns, "active")) {
    where.push("(ou.active = 1 OR ou.active IS NULL)");
  }

  return getDb(env)
    .prepare(
      `
      SELECT ${select.join(", ")}
      FROM organization_users ou
      INNER JOIN users u ON u.id = ou.user_id
      WHERE ${where.join(" AND ")}
      LIMIT 1
      `,
    )
    .bind(organizationId, userId)
    .first();
}

async function listOrganizationUserPermissions(env, organizationId, userIds) {
  if (!userIds.length || !(await tableExists(env, "user_permissions"))) {
    return new Map();
  }

  const columns = await getTableColumns(env, "user_permissions");

  if (!hasColumn(columns, "user_id") || !hasColumn(columns, "permission")) {
    return new Map();
  }

  const placeholders = userIds.map(() => "?").join(", ");
  const where = [`user_id IN (${placeholders})`];

  const params = [...userIds];

  if (hasColumn(columns, "organization_id")) {
    where.push("organization_id = ?");
    params.push(organizationId);
  }

  if (hasColumn(columns, "active")) {
    where.push("(active = 1 OR active IS NULL)");
  }

  if (hasColumn(columns, "expires_at")) {
    where.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(nowIso());
  }

  const result = await getDb(env)
    .prepare(
      `
      SELECT user_id, permission
      FROM user_permissions
      WHERE ${where.join(" AND ")}
      ORDER BY permission ASC
      `,
    )
    .bind(...params)
    .all();

  const map = new Map();

  for (const row of result?.results || []) {
    const key = String(row.user_id);

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(row.permission);
  }

  return map;
}

async function listOrganizationUserPermissionDenials(
  env,
  organizationId,
  userIds,
) {
  if (
    !userIds.length ||
    !(await tableExists(env, "user_permission_denials"))
  ) {
    return new Map();
  }

  const placeholders = userIds.map(() => "?").join(", ");
  const result = await getDb(env)
    .prepare(
      `
      SELECT user_id, permission
      FROM user_permission_denials
      WHERE user_id IN (${placeholders})
        AND organization_id = ?
      ORDER BY permission ASC
      `,
    )
    .bind(...userIds, organizationId)
    .all();

  const map = new Map();

  for (const row of result?.results || []) {
    const key = String(row.user_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.permission);
  }

  return map;
}

export async function listOrganizationUsers(env, organizationId) {
  const id = parsePositiveInteger(organizationId, "organizationId");

  await getOrganizationById(env, id);
  await requireTable(env, "users");
  await requireTable(env, "organization_users");

  const userColumns = await getTableColumns(env, "users");
  const membershipColumns = await getTableColumns(env, "organization_users");

  const select = [
    "u.id AS id",
    hasColumn(userColumns, "name") ? "u.name AS name" : "NULL AS name",
    hasColumn(userColumns, "full_name") ? "u.full_name AS full_name" : "NULL AS full_name",
    hasColumn(userColumns, "email") ? "u.email AS email" : "NULL AS email",
    hasColumn(userColumns, "role") ? "u.role AS role" : "'viewer' AS role",
    hasColumn(userColumns, "active") ? "u.active AS user_active" : "1 AS user_active",
    hasColumn(userColumns, "created_at") ? "u.created_at AS user_created_at" : "NULL AS user_created_at",
    hasColumn(userColumns, "updated_at") ? "u.updated_at AS user_updated_at" : "NULL AS user_updated_at",

    "ou.organization_id AS organization_id",
    "ou.user_id AS user_id",
    hasColumn(membershipColumns, "access_level") ? "ou.access_level AS access_level" : "'viewer' AS access_level",
    hasColumn(membershipColumns, "created_at") ? "ou.created_at AS membership_created_at" : "NULL AS membership_created_at",
  ];

  const where = ["ou.organization_id = ?"];

  if (hasColumn(membershipColumns, "active")) {
    where.push("(ou.active = 1 OR ou.active IS NULL)");
  }

  const result = await getDb(env)
    .prepare(
      `
      SELECT ${select.join(", ")}
      FROM organization_users ou
      INNER JOIN users u ON u.id = ou.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE ou.access_level
          WHEN 'owner' THEN 1
          WHEN 'editor' THEN 2
          ELSE 3
        END,
        u.email ASC
      `,
    )
    .bind(id)
    .all();

  const rows = result?.results || [];
  const userIds = rows.map((row) => row.id);
  const [permissionsByUser, denialsByUser] = await Promise.all([
    listOrganizationUserPermissions(env, id, userIds),
    listOrganizationUserPermissionDenials(env, id, userIds),
  ]);

  return rows.map((row) =>
    sanitizeOrganizationUser(
      row,
      permissionsByUser.get(String(row.id)) || [],
      denialsByUser.get(String(row.id)) || [],
    ),
  );
}

export async function countActiveOwners(env, organizationId) {
  const id = parsePositiveInteger(organizationId, "organizationId");

  await requireTable(env, "users");
  await requireTable(env, "organization_users");

  const userColumns = await getTableColumns(env, "users");
  const membershipColumns = await getTableColumns(env, "organization_users");

  const ownerChecks = [];

  if (hasColumn(membershipColumns, "access_level")) {
    ownerChecks.push("LOWER(ou.access_level) = 'owner'");
  }

  if (hasColumn(userColumns, "role")) {
    ownerChecks.push("LOWER(u.role) = 'owner'");
  }

  if (!ownerChecks.length) {
    return 0;
  }

  const where = [
    "ou.organization_id = ?",
    `(${ownerChecks.join(" OR ")})`,
  ];

  if (hasColumn(membershipColumns, "active")) {
    where.push("(ou.active = 1 OR ou.active IS NULL)");
  }

  if (hasColumn(userColumns, "active")) {
    where.push("(u.active = 1 OR u.active IS NULL)");
  }

  const row = await getDb(env)
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM organization_users ou
      INNER JOIN users u ON u.id = ou.user_id
      WHERE ${where.join(" AND ")}
      `,
    )
    .bind(id)
    .first();

  return Number(row?.total || 0);
}

export function assertCanAssignRoleOrAccessLevel(actor, targetRole, targetAccessLevel) {
  const actorRole = getActorRole(actor);
  const role = normalizeUserRole(targetRole || "viewer");
  const accessLevel = normalizeOrganizationAccessLevel(targetAccessLevel || "viewer");

  if (actorRole === "super_admin") {
    return { role, accessLevel };
  }

  if (actorRole === "admin") {
    if (!ADMIN_ASSIGNABLE_ROLES.has(role)) {
      throw createApiError("Admin não pode atribuir esta role.", 403, "ROLE_ESCALATION_BLOCKED");
    }

    if (!ADMIN_ASSIGNABLE_ACCESS_LEVELS.has(accessLevel)) {
      throw createApiError("Admin não pode atribuir este nível de acesso.", 403, "ACCESS_ESCALATION_BLOCKED");
    }

    return { role, accessLevel };
  }

  if (actorRole === "owner") {
    if (!OWNER_ASSIGNABLE_ROLES.has(role)) {
      throw createApiError("Owner não pode criar ou promover usuários para esta role.", 403, "ROLE_ESCALATION_BLOCKED");
    }

    if (!OWNER_ASSIGNABLE_ACCESS_LEVELS.has(accessLevel)) {
      throw createApiError("Owner não pode atribuir este nível de acesso.", 403, "ACCESS_ESCALATION_BLOCKED");
    }

    return { role, accessLevel };
  }

  throw createApiError("Usuário não pode atribuir acessos.", 403, "FORBIDDEN");
}

export async function assertNotLastOwnerRemoval(env, organizationId, targetUserId, nextPayload = {}) {
  const id = parsePositiveInteger(organizationId, "organizationId");
  const userId = parsePositiveInteger(targetUserId, "userId");

  const current = await getOrganizationUserRow(env, id, userId);

  if (!current) {
    throw createApiError("Usuário não encontrado na organização.", 404, "USER_NOT_FOUND");
  }

  const currentRole = normalizeUserRole(current.role || "viewer");
  const currentAccessLevel = normalizeOrganizationAccessLevel(current.access_level || "viewer");
  const currentActive = !(current.user_active === 0 || current.user_active === "0");

  const patchedActive = normalizeBooleanPatch(nextPayload.active);

  const nextActive =
    patchedActive === undefined
      ? currentActive
      : patchedActive;

  const nextRole =
    nextPayload.role === undefined
      ? currentRole
      : normalizeUserRole(nextPayload.role);

  const nextAccessLevel =
    nextPayload.accessLevel === undefined && nextPayload.access_level === undefined
      ? currentAccessLevel
      : normalizeOrganizationAccessLevel(nextPayload.accessLevel || nextPayload.access_level);

  const currentIsOwner =
    currentActive && (currentRole === "owner" || currentAccessLevel === "owner");

  const nextIsOwner =
    nextActive && (nextRole === "owner" || nextAccessLevel === "owner");

  if (!currentIsOwner || nextIsOwner) {
    return;
  }

  const owners = await countActiveOwners(env, id);

  if (owners <= 1) {
    throw createApiError(
      "A organização precisa manter pelo menos um Owner ativo.",
      409,
      "LAST_OWNER_REQUIRED",
    );
  }
}

async function findUserByEmail(env, email) {
  await requireTable(env, "users");

  const columns = await getTableColumns(env, "users");

  if (!hasColumn(columns, "email")) {
    throw createApiError("Tabela users precisa possuir coluna email.", 500, "INVALID_SCHEMA");
  }

  return getDb(env)
    .prepare(
      `
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1
      `,
    )
    .bind(email)
    .first();
}

async function createUserRow(env, data) {
  const columns = await getTableColumns(env, "users");
  const now = nowIso();

  const insertPayload = {
    name: data.name,
    full_name: data.name,
    email: data.email,
    role: data.role,
    active: 1,
    organization_id: data.organizationId,
    active_organization_id: data.organizationId,
    created_at: now,
    updated_at: now,
  };

  if (hasColumn(columns, "password_hash")) {
    insertPayload.password_hash = "pending_invite";
  }

  const user = await insertRow(env, "users", insertPayload);

  if (!user?.id && hasColumn(columns, "id")) {
    throw createApiError("Não foi possível criar usuário.", 500, "USER_CREATE_FAILED");
  }

  return user;
}

async function ensureOrganizationMembership(env, organizationId, userId, accessLevel) {
  await requireTable(env, "organization_users");

  const existing = await getOrganizationUserRow(env, organizationId, userId);
  const now = nowIso();

  if (existing?.membership_id) {
    await updateRow(env, "organization_users", existing.membership_id, {
      access_level: accessLevel,
      active: 1,
      updated_at: now,
    });

    return getOrganizationUserRow(env, organizationId, userId);
  }

  await insertRow(env, "organization_users", {
    organization_id: organizationId,
    user_id: userId,
    access_level: accessLevel,
    active: 1,
    created_at: now,
    updated_at: now,
  });

  return getOrganizationUserRow(env, organizationId, userId);
}

export async function createOrganizationUser(env, organizationId, payload, actor) {
  const id = parsePositiveInteger(organizationId, "organizationId");

  await getOrganizationById(env, id);

  const name = normalizeText(payload.name || payload.fullName, {
    required: true,
    maxLength: 160,
  });

  const email = normalizeEmail(payload.email);
  const { role, accessLevel } = assertCanAssignRoleOrAccessLevel(
    actor,
    payload.role || "viewer",
    payload.accessLevel || payload.access_level || "viewer",
  );

  let user = await findUserByEmail(env, email);

  if (!user) {
    user = await createUserRow(env, {
      name,
      email,
      role,
      organizationId: id,
    });
  } else {
    const userColumns = await getTableColumns(env, "users");

    if (hasColumn(userColumns, "role")) {
      const currentRank = ROLE_RANK[normalizeUserRole(user.role || "viewer")] || 1;
      const nextRank = ROLE_RANK[role] || 1;

      if (nextRank > currentRank) {
        await updateRow(env, "users", user.id, {
          role,
          updated_at: nowIso(),
        });
      }
    }

    if (hasColumn(userColumns, "name") || hasColumn(userColumns, "full_name")) {
      await updateRow(env, "users", user.id, {
        name,
        full_name: name,
        updated_at: nowIso(),
      });
    }
  }

  const membership = await ensureOrganizationMembership(
    env,
    id,
    user.id,
    accessLevel,
  );

  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId: id,
    action: "users.create",
    resourceType: "user",
    resourceId: user.id,
    metadata: {
      role,
      accessLevel,
    },
  });

  return sanitizeOrganizationUser({
    ...membership,
    ...user,
    id: user.id,
    organization_id: id,
    access_level: accessLevel,
  });
}

export async function updateOrganizationUser(env, organizationId, targetUserId, payload, actor) {
  const id = parsePositiveInteger(organizationId, "organizationId");
  const userId = parsePositiveInteger(targetUserId, "userId");

  await getOrganizationById(env, id);

  const current = await getOrganizationUserRow(env, id, userId);

  if (!current) {
    throw createApiError("Usuário não encontrado na organização.", 404, "USER_NOT_FOUND");
  }

  const patchUser = {};
  const patchMembership = {};

  if (payload.name !== undefined || payload.fullName !== undefined) {
    patchUser.name = normalizeText(payload.name || payload.fullName, {
      required: true,
      maxLength: 160,
    });
    patchUser.full_name = patchUser.name;
  }

  const active = normalizeBooleanPatch(payload.active);

  if (active !== undefined) {
    patchUser.active = active ? 1 : 0;
  }

  if (
    payload.role !== undefined ||
    payload.accessLevel !== undefined ||
    payload.access_level !== undefined
  ) {
    const next = assertCanAssignRoleOrAccessLevel(
      actor,
      payload.role || current.role || "viewer",
      payload.accessLevel || payload.access_level || current.access_level || "viewer",
    );

    patchUser.role = next.role;
    patchMembership.access_level = next.accessLevel;
  }

  await assertNotLastOwnerRemoval(env, id, userId, {
    active,
    role: patchUser.role,
    accessLevel: patchMembership.access_level,
  });

  const now = nowIso();

  if (Object.keys(patchUser).length > 0) {
    patchUser.updated_at = now;
    await updateRow(env, "users", userId, patchUser);
  }

  if (Object.keys(patchMembership).length > 0 && current.membership_id) {
    patchMembership.updated_at = now;
    await updateRow(env, "organization_users", current.membership_id, patchMembership);
  }

  const updated = await getOrganizationUserRow(env, id, userId);

  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId: id,
    action: active === false ? "users.disable" : "users.edit",
    resourceType: "user",
    resourceId: userId,
    metadata: {
      changedUserFields: Object.keys(patchUser),
      changedMembershipFields: Object.keys(patchMembership),
    },
  });

  return sanitizeOrganizationUser(updated);
}

function assertCanManagePermission(actor, permission) {
  const actorRole = getActorRole(actor);

  if (actorRole === "super_admin") {
    return;
  }

  if (permission === "organization.projects.geojson.view") {
    throw createApiError(
      "Somente Super Admin pode gerenciar o acesso amplo a GeoJSON.",
      403,
      "PERMISSION_ESCALATION_BLOCKED",
    );
  }

  if (actorRole === "admin") {
    if (permission === "admin.panel.access" || permission.startsWith("audit.")) {
      throw createApiError("Admin não pode gerenciar esta permissão.", 403, "PERMISSION_ESCALATION_BLOCKED");
    }

    return;
  }

  if (actorRole === "owner") {
    if (!OWNER_GRANTABLE_PERMISSIONS.has(permission)) {
      throw createApiError("Owner não pode conceder ou revogar esta permissão.", 403, "PERMISSION_ESCALATION_BLOCKED");
    }

    return;
  }

  throw createApiError("Usuário não pode gerenciar permissões.", 403, "FORBIDDEN");
}

export async function grantOrganizationPermission(env, organizationId, targetUserId, permission, actor, options = {}) {
  const id = parsePositiveInteger(organizationId, "organizationId");
  const userId = parsePositiveInteger(targetUserId, "userId");
  const normalizedPermission = assertKnownPermission(permission);

  await getOrganizationById(env, id);

  const target = await getOrganizationUserRow(env, id, userId);

  if (!target) {
    throw createApiError("Usuário não encontrado na organização.", 404, "USER_NOT_FOUND");
  }

  assertCanManagePermission(actor, normalizedPermission);

  if (isNativeAdminOrOwnerPermission(target, normalizedPermission)) {
    if (getActorRole(actor) !== "super_admin") {
      throw createApiError(
        "Somente Super Admin pode restaurar uma capacidade nativa.",
        403,
        "SUPER_ADMIN_REQUIRED",
      );
    }

    await requireTable(env, "user_permission_denials");
    await getDb(env)
      .prepare(
        `DELETE FROM user_permission_denials
         WHERE user_id = ? AND organization_id = ? AND permission = ?`,
      )
      .bind(userId, id, normalizedPermission)
      .run();

    await recordAuditLog(env, {
      actorUserId: actor?.id,
      organizationId: id,
      action: "permission.native.restore",
      resourceType: "user",
      resourceId: userId,
      metadata: {
        permission: normalizedPermission,
        targetRole: target.role || null,
        targetAccessLevel: target.access_level || null,
      },
    });

    return {
      userId,
      organizationId: id,
      permission: normalizedPermission,
      native: true,
      denied: false,
    };
  }

  if (await tableExists(env, "user_permission_denials")) {
    await getDb(env)
      .prepare(
        `DELETE FROM user_permission_denials
         WHERE user_id = ? AND organization_id = ? AND permission = ?`,
      )
      .bind(userId, id, normalizedPermission)
      .run();
  }

  await requireTable(env, "user_permissions");

  const columns = await getTableColumns(env, "user_permissions");

  if (!hasColumn(columns, "user_id") || !hasColumn(columns, "permission")) {
    throw createApiError("Tabela user_permissions inválida.", 500, "INVALID_SCHEMA");
  }

  const existing = await getDb(env)
    .prepare(
      `
      SELECT *
      FROM user_permissions
      WHERE user_id = ?
        AND permission = ?
        ${hasColumn(columns, "organization_id") ? "AND organization_id = ?" : ""}
      LIMIT 1
      `,
    )
    .bind(
      ...[
        userId,
        normalizedPermission,
        ...(hasColumn(columns, "organization_id") ? [id] : []),
      ],
    )
    .first();

  if (existing?.id) {
    await updateRow(env, "user_permissions", existing.id, {
      active: 1,
      updated_at: nowIso(),
    });
  } else {
    await insertRow(env, "user_permissions", {
      user_id: userId,
      permission: normalizedPermission,
      organization_id: id,
      scope_type: "organization",
      active: 1,
      created_by: actor?.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId: id,
    action: "permission.grant",
    resourceType: "user",
    resourceId: userId,
    metadata: {
      permission: normalizedPermission,
      warningAcknowledged: Boolean(options.warningAcknowledged),
      justification: options.justification
        ? String(options.justification).slice(0, 500)
        : null,
      targetRole: target.role || null,
    },
  });

  return {
    userId,
    organizationId: id,
    permission: normalizedPermission,
  };
}

export async function revokeOrganizationPermission(env, organizationId, targetUserId, permission, actor) {
  const id = parsePositiveInteger(organizationId, "organizationId");
  const userId = parsePositiveInteger(targetUserId, "userId");
  const normalizedPermission = assertKnownPermission(permission);

  await getOrganizationById(env, id);

  const target = await getOrganizationUserRow(env, id, userId);

  if (!target) {
    throw createApiError("Usuário não encontrado na organização.", 404, "USER_NOT_FOUND");
  }

  assertCanManagePermission(actor, normalizedPermission);

  if (isNativeAdminOrOwnerPermission(target, normalizedPermission)) {
    if (getActorRole(actor) !== "super_admin") {
      throw createApiError(
        "Somente Super Admin pode negar uma capacidade nativa.",
        403,
        "SUPER_ADMIN_REQUIRED",
      );
    }

    await requireTable(env, "user_permission_denials");
    const now = nowIso();
    await getDb(env)
      .prepare(
        `INSERT INTO user_permission_denials
          (user_id, organization_id, permission, denied_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, organization_id, permission)
         DO UPDATE SET denied_by = excluded.denied_by, updated_at = excluded.updated_at`,
      )
      .bind(userId, id, normalizedPermission, actor?.id || null, now, now)
      .run();

    await recordAuditLog(env, {
      actorUserId: actor?.id,
      organizationId: id,
      action: "permission.native.deny",
      resourceType: "user",
      resourceId: userId,
      metadata: {
        permission: normalizedPermission,
        targetRole: target.role || null,
        targetAccessLevel: target.access_level || null,
      },
    });

    return {
      userId,
      organizationId: id,
      permission: normalizedPermission,
      native: true,
      denied: true,
    };
  }

  await requireTable(env, "user_permissions");

  const columns = await getTableColumns(env, "user_permissions");

  const existing = await getDb(env)
    .prepare(
      `
      SELECT *
      FROM user_permissions
      WHERE user_id = ?
        AND permission = ?
        ${hasColumn(columns, "organization_id") ? "AND organization_id = ?" : ""}
      LIMIT 1
      `,
    )
    .bind(
      ...[
        userId,
        normalizedPermission,
        ...(hasColumn(columns, "organization_id") ? [id] : []),
      ],
    )
    .first();

  if (existing?.id) {
    if (hasColumn(columns, "active")) {
      await updateRow(env, "user_permissions", existing.id, {
        active: 0,
        updated_at: nowIso(),
      });
    } else {
      await getDb(env)
        .prepare("DELETE FROM user_permissions WHERE id = ?")
        .bind(existing.id)
        .run();
    }
  }

  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId: id,
    action: "permission.revoke",
    resourceType: "user",
    resourceId: userId,
    metadata: {
      permission: normalizedPermission,
    },
  });

  return {
    userId,
    organizationId: id,
    permission: normalizedPermission,
  };
}

async function countOrganizationRows(env, tableName, organizationId) {
  if (!(await tableExists(env, tableName))) {
    return 0;
  }

  const columns = await getTableColumns(env, tableName);

  if (!hasColumn(columns, "organization_id")) {
    return 0;
  }

  const where = ["organization_id = ?"];

  if (hasColumn(columns, "deleted_at")) {
    where.push("deleted_at IS NULL");
  }

  if (hasColumn(columns, "active")) {
    where.push("(active = 1 OR active IS NULL)");
  }

  const row = await getDb(env)
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM ${quoteIdentifier(tableName)}
      WHERE ${where.join(" AND ")}
      `,
    )
    .bind(organizationId)
    .first();

  return Number(row?.total || 0);
}

async function sumOrganizationStorageMb(env, organizationId) {
  if (!(await tableExists(env, "organization_files"))) {
    return 0;
  }

  const columns = await getTableColumns(env, "organization_files");

  if (!hasColumn(columns, "organization_id")) {
    return 0;
  }

  const sizeColumn = hasColumn(columns, "size_bytes")
    ? "size_bytes"
    : hasColumn(columns, "size")
      ? "size"
      : null;

  if (!sizeColumn) {
    return 0;
  }

  const where = ["organization_id = ?"];

  if (hasColumn(columns, "deleted_at")) {
    where.push("deleted_at IS NULL");
  }

  const row = await getDb(env)
    .prepare(
      `
      SELECT COALESCE(SUM(${quoteIdentifier(sizeColumn)}), 0) AS totalBytes
      FROM organization_files
      WHERE ${where.join(" AND ")}
      `,
    )
    .bind(organizationId)
    .first();

  return Math.round((Number(row?.totalBytes || 0) / 1024 / 1024) * 100) / 100;
}

async function listPendingLimitRequests(env, organizationId) {
  if (!(await tableExists(env, "organization_limit_requests"))) {
    return [];
  }

  const rows = await listRowsByOrganization(
    env,
    "organization_limit_requests",
    organizationId,
  );

  return rows
    .filter((row) => String(row.status || "pending") === "pending")
    .map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      requestType: row.request_type,
      requestedPlan: row.requested_plan || null,
      requestedLimits: row.requested_limits_json
        ? safeJsonParse(row.requested_limits_json, null)
        : null,
      reason: row.reason || null,
      status: row.status || "pending",
      requestedBy: row.requested_by || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));
}

export async function getOrganizationLimits(env, organizationId) {
  const id = parsePositiveInteger(organizationId, "organizationId");
  const organization = await getOrganizationById(env, id);

  const plan = organization.plan || organization.plan_slug || "free";
  const planLimits = ORGANIZATION_PLANS[plan] || ORGANIZATION_PLANS.free;

  const usedUsers = await countOrganizationRows(env, "organization_users", id);
  const usedProjects = await countOrganizationRows(env, "projects", id);
  const usedFiles = await countOrganizationRows(env, "organization_files", id);
  const usedTickets = await countOrganizationRows(env, "organization_tickets", id);
  const usedExports = await countOrganizationRows(env, "organization_exports", id);
  const storageMb = await sumOrganizationStorageMb(env, id);

  return {
    plan,
    users: {
      used: usedUsers,
      limit: planLimits.users,
    },
    projects: {
      used: usedProjects,
      limit: planLimits.projects,
    },
    storageMb: {
      used: storageMb,
      limit: planLimits.storageMb,
    },
    exports: {
      used: usedExports,
      limit: planLimits.exports,
    },
    metrics: {
      files: usedFiles,
      tickets: usedTickets,
      exports: usedExports,
    },
    pendingRequests: await listPendingLimitRequests(env, id),
  };
}

export async function createLimitIncreaseRequest(env, organizationId, payload, actor) {
  const id = parsePositiveInteger(organizationId, "organizationId");

  await getOrganizationById(env, id);
  await requireTable(env, "organization_limit_requests");

  const requestType = normalizeText(payload.requestType || payload.request_type, {
    required: true,
    maxLength: 80,
  });

  if (!LIMIT_REQUEST_TYPES.has(requestType)) {
    throw createApiError("Tipo de solicitação inválido.", 400, "INVALID_LIMIT_REQUEST_TYPE");
  }

  const requestedPlan = payload.requestedPlan || payload.requested_plan
    ? normalizeText(payload.requestedPlan || payload.requested_plan, {
        required: false,
        maxLength: 80,
      })
    : "";

  const reason = normalizeText(payload.reason || payload.message, {
    required: false,
    maxLength: 3000,
  });

  const requestedLimits =
    payload.requestedLimits || payload.requested_limits || null;

  const row = await insertRow(env, "organization_limit_requests", {
    organization_id: id,
    requested_by: actor?.id,
    request_type: requestType,
    requested_plan: requestedPlan || null,
    requested_limits_json: requestedLimits
      ? JSON.stringify(requestedLimits)
      : null,
    reason: reason || null,
    status: "pending",
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId: id,
    action: "limits.increase_request",
    resourceType: "organization",
    resourceId: id,
    metadata: {
      requestType,
      requestedPlan: requestedPlan || null,
    },
  });

  return {
    id: row.id,
    organizationId: id,
    requestType,
    requestedPlan: requestedPlan || null,
    status: row.status || "pending",
    createdAt: row.created_at || null,
  };
}

export function validateTicketCreatePayload(payload) {
  const subject = normalizeText(payload.subject || payload.title, {
    required: true,
    maxLength: 160,
  });

  const description = normalizeText(payload.description || payload.body, {
    required: true,
    maxLength: 5000,
  });

  const priority = normalizeText(payload.priority || "normal", {
    required: false,
    maxLength: 20,
  }) || "normal";

  if (!TICKET_PRIORITIES.has(priority)) {
    const error = new Error("Prioridade inválida.");
    error.status = 400;
    error.code = "INVALID_PRIORITY";
    throw error;
  }

  return { subject, description, priority };
}

export function validateTicketPatchPayload(payload) {
  const patch = {};

  if (payload.status !== undefined) {
    const status = normalizeText(payload.status, { required: true, maxLength: 30 });

    if (!TICKET_STATUSES.has(status)) {
      const error = new Error("Status inválido.");
      error.status = 400;
      error.code = "INVALID_STATUS";
      throw error;
    }

    patch.status = status;
  }

  if (payload.priority !== undefined) {
    const priority = normalizeText(payload.priority, { required: true, maxLength: 20 });

    if (!TICKET_PRIORITIES.has(priority)) {
      const error = new Error("Prioridade inválida.");
      error.status = 400;
      error.code = "INVALID_PRIORITY";
      throw error;
    }

    patch.priority = priority;
  }

  if (Object.keys(patch).length === 0) {
    const error = new Error("Nenhuma alteração válida informada.");
    error.status = 400;
    error.code = "EMPTY_PATCH";
    throw error;
  }

  return patch;
}

export function validateExportPayload(payload) {
  const type = normalizeText(payload.type || payload.exportType, {
    required: true,
    maxLength: 80,
  });

  const format = normalizeText(payload.format || "csv", {
    required: true,
    maxLength: 20,
  });

  if (!EXPORT_TYPES.has(type)) {
    const error = new Error("Tipo de exportação inválido.");
    error.status = 400;
    error.code = "INVALID_EXPORT_TYPE";
    throw error;
  }

  if (!EXPORT_FORMATS.has(format)) {
    const error = new Error("Formato de exportação inválido.");
    error.status = 400;
    error.code = "INVALID_EXPORT_FORMAT";
    throw error;
  }

  return { type, format };
}

export async function readUploadedOrganizationFile(request) {
  const formData = await request.formData();
  const file = formData.get("file") || formData.get("document");

  if (!file || typeof file.arrayBuffer !== "function") {
    const error = new Error("Arquivo não enviado. Use o campo file.");
    error.status = 400;
    error.code = "FILE_REQUIRED";
    throw error;
  }

  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength <= 0) {
    const error = new Error("Arquivo vazio.");
    error.status = 400;
    error.code = "EMPTY_FILE";
    throw error;
  }

  if (arrayBuffer.byteLength > MAX_ORGANIZATION_FILE_BYTES) {
    const error = new Error("Arquivo excede o limite permitido.");
    error.status = 413;
    error.code = "FILE_TOO_LARGE";
    throw error;
  }

  const name = sanitizeFileName(file.name || formData.get("name") || "documento");
  const mimeType = file.type || "application/octet-stream";

  return {
    arrayBuffer,
    name,
    mimeType,
    size: arrayBuffer.byteLength,
  };
}

function getDropboxToken(env) {
  return env.DROPBOX_ACCESS_TOKEN || env.DROPBOX_TOKEN || env.MAONO_DROPBOX_ACCESS_TOKEN || null;
}

function assertDropboxPathSafe(path) {
  const normalized = String(path || "").trim();

  if (!normalized || normalized === "/" || normalized === "\\" || normalized.split("/").filter(Boolean).length < 2) {
    const error = new Error("Caminho Dropbox inseguro.");
    error.status = 400;
    error.code = "UNSAFE_DROPBOX_PATH";
    throw error;
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

async function parseDropboxError(response) {
  const text = await response.text();

  try {
    const data = text ? JSON.parse(text) : null;

    return data?.error_summary || data?.error?.[".tag"] || text || "Erro no Dropbox.";
  } catch {
    return text || "Erro no Dropbox.";
  }
}

export function buildOrganizationDocumentPath(organizationId, fileName) {
  const safeName = sanitizeFileName(fileName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `/organizations/${organizationId}/documents/${stamp}-${safeName}`;
}

export async function uploadBufferToDropbox(env, path, arrayBuffer) {
  const token = getDropboxToken(env);

  if (!token) {
    const error = new Error("Token Dropbox não configurado.");
    error.status = 500;
    error.code = "DROPBOX_NOT_CONFIGURED";
    throw error;
  }

  const safePath = assertDropboxPathSafe(path);

  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({
        path: safePath,
        mode: "add",
        autorename: false,
        mute: false,
        strict_conflict: false,
      }),
      "Content-Type": "application/octet-stream",
    },
    body: arrayBuffer,
  });

  if (!response.ok) {
    const error = new Error(await parseDropboxError(response));
    error.status = response.status;
    error.code = "DROPBOX_UPLOAD_FAILED";
    throw error;
  }

  return response.json();
}

export async function downloadFromDropbox(env, path) {
  const token = getDropboxToken(env);

  if (!token) {
    const error = new Error("Token Dropbox não configurado.");
    error.status = 500;
    error.code = "DROPBOX_NOT_CONFIGURED";
    throw error;
  }

  const safePath = assertDropboxPathSafe(path);

  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({
        path: safePath,
      }),
    },
  });

  if (!response.ok) {
    const error = new Error(await parseDropboxError(response));
    error.status = response.status;
    error.code = "DROPBOX_DOWNLOAD_FAILED";
    throw error;
  }

  return response;
}

export async function deleteFromDropbox(env, path) {
  const token = getDropboxToken(env);

  if (!token) {
    const error = new Error("Token Dropbox não configurado.");
    error.status = 500;
    error.code = "DROPBOX_NOT_CONFIGURED";
    throw error;
  }

  const safePath = assertDropboxPathSafe(path);

  const response = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: safePath,
    }),
  });

  if (!response.ok) {
    const error = new Error(await parseDropboxError(response));
    error.status = response.status;
    error.code = "DROPBOX_DELETE_FAILED";
    throw error;
  }

  return response.json();
}

export function fileDownloadHeaders(fileRow, dropboxResponse) {
  const name = sanitizeFileName(
    fileRow.name ||
      fileRow.file_name ||
      fileRow.original_name ||
      "documento",
  );

  return {
    "Content-Type":
      fileRow.mime_type ||
      fileRow.content_type ||
      dropboxResponse.headers.get("Content-Type") ||
      "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, no-store",
  };
}

export function now() {
  return nowIso();
}
