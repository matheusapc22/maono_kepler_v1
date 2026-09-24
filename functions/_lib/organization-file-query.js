import { getDb } from "./organizations.js";

export const ORGANIZATION_FILE_DEFAULT_LIMIT = 50;
export const ORGANIZATION_FILE_MAX_LIMIT = 100;
export const ORGANIZATION_FILE_DEFAULT_SORT = "updated_desc";

const SORTS = Object.freeze({
  updated_desc: {
    expression: "COALESCE(datetime(f.updated_at), datetime(f.created_at), '')",
    direction: "DESC",
  },
  updated_asc: {
    expression: "COALESCE(datetime(f.updated_at), datetime(f.created_at), '')",
    direction: "ASC",
  },
  name_asc: {
    expression: "LOWER(COALESCE(f.original_name, f.name, f.file_name, ''))",
    direction: "ASC",
  },
  name_desc: {
    expression: "LOWER(COALESCE(f.original_name, f.name, f.file_name, ''))",
    direction: "DESC",
  },
  size_asc: {
    expression: "COALESCE(f.size_bytes, 0)",
    direction: "ASC",
  },
  size_desc: {
    expression: "COALESCE(f.size_bytes, 0)",
    direction: "DESC",
  },
});

const GEOJSON_PREDICATE = `(
  LOWER(COALESCE(f.file_type, '')) IN ('geojson', 'json')
  OR LOWER(COALESCE(f.original_name, f.name, f.file_name, '')) LIKE '%.geojson'
  OR LOWER(COALESCE(f.original_name, f.name, f.file_name, '')) LIKE '%.json'
  OR LOWER(COALESCE(f.mime_type, '')) LIKE '%geo+json%'
)`;

function queryError(message, code = "ORGANIZATION_FILE_QUERY_INVALID") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  error.stage = "file.list_query";
  error.publicMessage = message;
  return error;
}

function normalizeText(value, maxLength, label) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw queryError(`${label} excede o limite permitido.`);
  }
  return normalized;
}

function parsePositiveInteger(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw queryError(`${label} inválido.`);
  }
  return parsed;
}

function parseFolderId(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "root") return "root";
  return parsePositiveInteger(value, "folderId");
}

function parseLimit(value) {
  if (value === null || value === undefined || value === "") {
    return ORGANIZATION_FILE_DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > ORGANIZATION_FILE_MAX_LIMIT) {
    throw queryError(`limit deve estar entre 1 e ${ORGANIZATION_FILE_MAX_LIMIT}.`);
  }
  return parsed;
}

function normalizeDateBound(value, endOfDay = false) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : normalized;
  const date = new Date(candidate);

  if (Number.isNaN(date.getTime())) {
    throw queryError("Período inválido.");
  }

  return date.toISOString();
}

function normalizeSort(value) {
  const normalized = String(value || ORGANIZATION_FILE_DEFAULT_SORT).trim();
  if (!Object.hasOwn(SORTS, normalized)) {
    throw queryError("Ordenação inválida.");
  }
  return normalized;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeOrganizationFileCursor(payload) {
  return utf8ToBase64(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeOrganizationFileCursor(value) {
  if (!value) return null;
  if (String(value).length > 1024) {
    throw queryError("Cursor inválido.", "ORGANIZATION_FILE_CURSOR_INVALID");
  }

  try {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(base64ToUtf8(padded));

    const sort = SORTS[payload?.sort];
    const numericSort = payload?.sort === "size_asc" || payload?.sort === "size_desc";
    const validValue = numericSort
      ? typeof payload?.value === "number" && Number.isFinite(payload.value)
      : typeof payload?.value === "string";

    if (
      payload?.v !== 1 ||
      !sort ||
      !validValue ||
      !Number.isInteger(Number(payload?.id)) ||
      Number(payload.id) <= 0
    ) {
      throw new Error("invalid cursor");
    }

    return {
      v: 1,
      sort: payload.sort,
      value: payload.value,
      id: Number(payload.id),
    };
  } catch {
    throw queryError("Cursor inválido.", "ORGANIZATION_FILE_CURSOR_INVALID");
  }
}

export function parseOrganizationFileListQuery(request) {
  const url = new URL(request.url);
  const search = normalizeText(url.searchParams.get("search"), 160, "Busca");
  const type = normalizeText(url.searchParams.get("type"), 64, "Tipo")?.toLowerCase() || null;
  const projectId = parsePositiveInteger(url.searchParams.get("projectId"), "projectId");
  const folderId = parseFolderId(url.searchParams.get("folderId"));
  const updatedFrom = normalizeDateBound(url.searchParams.get("updatedFrom"), false);
  const updatedTo = normalizeDateBound(url.searchParams.get("updatedTo"), true);
  const sort = normalizeSort(url.searchParams.get("sort"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeOrganizationFileCursor(url.searchParams.get("cursor"));

  if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
    throw queryError("O início do período deve ser anterior ao fim.");
  }

  if (cursor && cursor.sort !== sort) {
    throw queryError("Cursor incompatível com a ordenação atual.", "ORGANIZATION_FILE_CURSOR_SORT_MISMATCH");
  }

  return {
    search,
    type,
    projectId,
    folderId,
    updatedFrom,
    updatedTo,
    sort,
    limit,
    cursor,
  };
}

function baseWhere(organizationId, canViewGeoJson) {
  const where = [
    "f.organization_id = ?",
    "f.deleted_at IS NULL",
    "(f.active = 1 OR f.active IS NULL)",
  ];
  const bindings = [organizationId];

  if (!canViewGeoJson) where.push(`NOT ${GEOJSON_PREDICATE}`);

  return { where, bindings };
}

function applyFilters(where, bindings, query) {
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    where.push(`(
      COALESCE(f.original_name, '') LIKE ? ESCAPE '\\'
      OR COALESCE(f.name, '') LIKE ? ESCAPE '\\'
      OR COALESCE(f.file_name, '') LIKE ? ESCAPE '\\'
    )`);
    bindings.push(pattern, pattern, pattern);
  }

  if (query.type) {
    where.push("LOWER(COALESCE(NULLIF(f.file_type, ''), 'other')) = ?");
    bindings.push(query.type);
  }

  if (query.projectId) {
    where.push("f.project_id = ?");
    bindings.push(query.projectId);
  }

  if (query.folderId === "root") {
    where.push("f.folder_id IS NULL");
  } else if (query.folderId) {
    where.push("f.folder_id = ?");
    bindings.push(query.folderId);
  }

  if (query.updatedFrom) {
    where.push("datetime(COALESCE(f.updated_at, f.created_at)) >= datetime(?)");
    bindings.push(query.updatedFrom);
  }

  if (query.updatedTo) {
    where.push("datetime(COALESCE(f.updated_at, f.created_at)) <= datetime(?)");
    bindings.push(query.updatedTo);
  }
}

function applyCursor(where, bindings, query) {
  if (!query.cursor) return;

  const sort = SORTS[query.sort];
  const comparator = sort.direction === "DESC" ? "<" : ">";

  where.push(`(
    ${sort.expression} ${comparator} ?
    OR (${sort.expression} = ? AND f.id ${comparator} ?)
  )`);
  bindings.push(query.cursor.value, query.cursor.value, query.cursor.id);
}

export function buildOrganizationFileListSql(
  organizationId,
  query,
  { canViewGeoJson = false, includeCursor = true } = {},
) {
  const { where, bindings } = baseWhere(organizationId, canViewGeoJson);
  applyFilters(where, bindings, query);
  if (includeCursor) applyCursor(where, bindings, query);

  const sort = SORTS[query.sort];
  return {
    sql: `
      SELECT f.*, p.name AS project_name, ${sort.expression} AS __sort_value
      FROM organization_files f
      LEFT JOIN projects p
        ON p.id = f.project_id
       AND p.organization_id = f.organization_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${sort.expression} ${sort.direction}, f.id ${sort.direction}
      LIMIT ?
    `,
    bindings: [...bindings, query.limit + 1],
  };
}

function buildCountSql(organizationId, query, canViewGeoJson) {
  const { where, bindings } = baseWhere(organizationId, canViewGeoJson);
  applyFilters(where, bindings, query);
  return {
    sql: `SELECT COUNT(*) AS total FROM organization_files f WHERE ${where.join(" AND ")}`,
    bindings,
  };
}

function buildFacetWhere(organizationId, canViewGeoJson) {
  return baseWhere(organizationId, canViewGeoJson);
}

async function listFacets(env, organizationId, canViewGeoJson) {
  const db = getDb(env);
  const typeScope = buildFacetWhere(organizationId, canViewGeoJson);
  const projectScope = buildFacetWhere(organizationId, canViewGeoJson);
  const folderScope = buildFacetWhere(organizationId, canViewGeoJson);

  const [typesResult, projectsResult, foldersResult] = await Promise.all([
    db.prepare(`
      SELECT LOWER(COALESCE(NULLIF(f.file_type, ''), 'other')) AS value
      FROM organization_files f
      WHERE ${typeScope.where.join(" AND ")}
      GROUP BY LOWER(COALESCE(NULLIF(f.file_type, ''), 'other'))
      ORDER BY value ASC
    `).bind(...typeScope.bindings).all(),
    db.prepare(`
      SELECT p.id, p.name
      FROM organization_files f
      INNER JOIN projects p
        ON p.id = f.project_id
       AND p.organization_id = f.organization_id
      WHERE ${projectScope.where.join(" AND ")}
        AND p.active = 1
      GROUP BY p.id, p.name
      ORDER BY LOWER(p.name) ASC, p.id ASC
    `).bind(...projectScope.bindings).all(),
    db.prepare(`
      SELECT f.folder_id, COUNT(*) AS count
      FROM organization_files f
      WHERE ${folderScope.where.join(" AND ")}
      GROUP BY f.folder_id
    `).bind(...folderScope.bindings).all(),
  ]);

  const folderRows = foldersResult?.results || [];

  return {
    types: (typesResult?.results || []).map((row) => row.value).filter(Boolean),
    projects: (projectsResult?.results || []).map((row) => ({
      id: row.id,
      name: row.name || `Projeto ${row.id}`,
    })),
    rootCount: Number(folderRows.find((row) => row.folder_id == null)?.count || 0),
    folderCounts: folderRows
      .filter((row) => row.folder_id != null)
      .map((row) => ({
        folderId: row.folder_id,
        count: Number(row.count || 0),
      })),
  };
}

export async function listOrganizationFilesPage(
  env,
  organizationId,
  query,
  { canViewGeoJson = false } = {},
) {
  const db = getDb(env);
  const pageSql = buildOrganizationFileListSql(organizationId, query, {
    canViewGeoJson,
  });
  const countSql = buildCountSql(organizationId, query, canViewGeoJson);

  const [pageResult, countResult, facets] = await Promise.all([
    db.prepare(pageSql.sql).bind(...pageSql.bindings).all(),
    db.prepare(countSql.sql).bind(...countSql.bindings).first(),
    listFacets(env, organizationId, canViewGeoJson),
  ]);

  const fetchedRows = pageResult?.results || [];
  const hasMore = fetchedRows.length > query.limit;
  const rows = hasMore ? fetchedRows.slice(0, query.limit) : fetchedRows;
  const last = rows.at(-1);
  const nextCursor = hasMore && last
    ? encodeOrganizationFileCursor({
        v: 1,
        sort: query.sort,
        value: last.__sort_value,
        id: Number(last.id),
      })
    : null;

  return {
    rows,
    facets,
    pagination: {
      limit: query.limit,
      total: Number(countResult?.total || 0),
      hasMore,
      nextCursor,
      sort: query.sort,
    },
  };
}
