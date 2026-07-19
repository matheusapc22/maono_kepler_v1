import { can, recordAuditLog } from "./permissions.js";

export const ORGANIZATION_GEOJSON_VIEW_PERMISSION =
  "organization.projects.geojson.view";

function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;
  if (!db?.prepare) throw forbidden("DATABASE_NOT_CONFIGURED");
  return db;
}

function extension(name) {
  return String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

export function isProjectGeoJsonFile(file) {
  const type = String(file.file_type || "").toLowerCase();
  const ext = extension(file.original_name || file.name || file.file_name);
  const mime = String(file.mime_type || file.content_type || "").toLowerCase();
  // Registros legados podem não ter project_id nem file_type. Em dúvida,
  // classifique JSON/GeoJSON como protegido para não expor dados geográficos.
  return type === "geojson" || type === "json" || ext === "geojson" ||
    ext === "json" || mime.includes("geo+json");
}

function forbidden(reason) {
  // Não revele que o arquivo existe para quem não possui a permissão
  // explícita. A mesma resposta é usada para um identificador inexistente.
  const error = new Error("Arquivo não encontrado.");
  error.status = 404;
  error.code = "ORGANIZATION_FILE_NOT_FOUND";
  error.stage = "geojson.authorization";
  error.reason = reason;
  error.publicMessage = error.message;
  return error;
}

export async function decideProjectGeoJsonAccess(env, user, organizationId, projectId) {
  if (!user?.id || !organizationId) {
    return { allowed: false, reason: "CONTEXT_REQUIRED" };
  }

  if (projectId) {
    const project = await getDb(env)
      .prepare(`
        SELECT p.id, p.organization_id, p.active AS project_active,
               o.active AS organization_active
        FROM projects p
        INNER JOIN organizations o ON o.id = p.organization_id
        WHERE p.id = ?
        LIMIT 1
      `)
      .bind(projectId)
      .first();
    if (!project || String(project.organization_id) !== String(organizationId)) {
      return { allowed: false, reason: "PROJECT_ORGANIZATION_MISMATCH" };
    }
    if (project.project_active === 0 || project.organization_active === 0) {
      return { allowed: false, reason: "INACTIVE_CONTEXT" };
    }
  }

  const context = {
    organizationId,
    projectId,
    scopeType: "organization",
    resourceType: "project_geojson",
  };
  const broad = await can(
    env,
    user,
    ORGANIZATION_GEOJSON_VIEW_PERMISSION,
    context,
  );
  if (broad.allowed) {
    return { allowed: true, reason: broad.reason, mode: "organization" };
  }

  // A autorização é exclusivamente explícita e organizacional. Ter acesso ao
  // projeto ou a document.view não permite inferir a existência do GeoJSON.
  return { allowed: false, reason: broad.reason || "DENY_BY_DEFAULT" };
}

export async function requireProjectGeoJsonAccess(env, request, user, organizationId, file, options = {}) {
  if (!isProjectGeoJsonFile(file)) return { allowed: true, mode: "regular_document" };

  const decision = await decideProjectGeoJsonAccess(
    env,
    user,
    organizationId,
    file.project_id,
  );
  if (!decision.allowed) {
    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId,
      projectId: file.project_id,
      action: "organization.projects.geojson.access_denied",
      resourceType: "project_geojson",
      resourceId: file.id,
      result: "denied",
      metadata: { reason: decision.reason, surface: options.surface || "unknown" },
      request,
    });
    throw forbidden(decision.reason);
  }

  if (options.auditAllowed) {
    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId,
      projectId: file.project_id,
      action: "organization.projects.geojson.access_allowed",
      resourceType: "project_geojson",
      resourceId: file.id,
      result: "success",
      metadata: { mode: decision.mode, surface: options.surface || "unknown" },
      request,
    });
  }
  return decision;
}

export async function filterVisibleOrganizationFiles(env, request, user, organizationId, files) {
  const visible = [];
  for (const file of files) {
    if (!isProjectGeoJsonFile(file)) {
      visible.push(file);
      continue;
    }
    const decision = await decideProjectGeoJsonAccess(env, user, organizationId, file.project_id);
    if (decision.allowed) visible.push(file);
  }
  return visible;
}
