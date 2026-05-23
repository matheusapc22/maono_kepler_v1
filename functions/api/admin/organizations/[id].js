import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import {
  deleteDropboxPath,
  ensureDropboxFolder,
  normalizeDropboxFolderPath,
} from "../../../_lib/dropbox.js";
import { logAudit } from "../../../_lib/projects.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isDropboxNotFoundError(error) {
  const message = String(error?.message || "");
  return message.includes("path/not_found") || message.includes("path_lookup/not_found");
}

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

function publicOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    dropboxRootPath: row.dropbox_root_path,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOrganizationById(env, organizationId) {
  return await env.DB.prepare(
    `SELECT id, name, slug, description, dropbox_root_path, active, created_at, updated_at
     FROM organizations
     WHERE id = ?
     LIMIT 1`
  )
    .bind(organizationId)
    .first();
}

async function updateOrganization(env, organizationId, body) {
  const current = await getOrganizationById(env, organizationId);
  if (!current) {
    return { error: errorResponse("Organização não encontrada.", 404, "ORGANIZATION_NOT_FOUND") };
  }

  const name = normalizeText(body?.name ?? current.name);
  const slug = normalizeSlug(body?.slug ?? current.slug);
  const description = normalizeText(body?.description ?? current.description);
  const active = body?.active === false ? 0 : body?.active === true ? 1 : Number(current.active || 0);
  const dropboxRootPath = normalizeDropboxFolderPath(
    body?.dropboxRootPath ?? body?.dropbox_root_path ?? current.dropbox_root_path
  );

  if (!name) {
    return { error: errorResponse("Informe o nome da organização.", 400, "ORGANIZATION_NAME_REQUIRED") };
  }

  if (!slug) {
    return { error: errorResponse("Informe um identificador válido para a organização.", 400, "ORGANIZATION_SLUG_REQUIRED") };
  }

  if (!dropboxRootPath || !dropboxRootPath.startsWith("/projects/")) {
    return {
      error: errorResponse(
        "A pasta da organização deve ficar dentro de /projects. Exemplo: /projects/cliente-a.",
        400,
        "ORGANIZATION_PATH_INVALID"
      ),
    };
  }

  await ensureDropboxFolder(env, dropboxRootPath);

  try {
    const updated = await env.DB.prepare(
      `UPDATE organizations
       SET name = ?, slug = ?, description = ?, dropbox_root_path = ?, active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
      .bind(name, slug, description || null, dropboxRootPath, active, organizationId)
      .first();

    return { organization: updated };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return { error: errorResponse("Já existe outra organização com este identificador ou pasta Dropbox.", 409, "ORGANIZATION_EXISTS") };
    }
    throw error;
  }
}

async function deleteOrganization(env, organizationId, hardDeleteDropbox) {
  const current = await getOrganizationById(env, organizationId);
  if (!current) {
    return { error: errorResponse("Organização não encontrada.", 404, "ORGANIZATION_NOT_FOUND") };
  }

  const linkedProjects = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM projects WHERE organization_id = ? AND active = 1`
  )
    .bind(organizationId)
    .first();

  if (linkedProjects?.total > 0) {
    return {
      error: errorResponse(
        "Esta organização possui projetos ativos. Desative ou remova os projetos antes de excluir a organização.",
        409,
        "ORGANIZATION_HAS_ACTIVE_PROJECTS"
      ),
    };
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM organization_users WHERE organization_id = ?`).bind(organizationId),
    env.DB.prepare(`UPDATE organization_files SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?`).bind(organizationId),
    env.DB.prepare(`UPDATE organizations SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(organizationId),
  ]);

  let dropboxDeleted = false;
  let dropboxAlreadyMissing = false;

  if (hardDeleteDropbox) {
    try {
      await deleteDropboxPath(env, current.dropbox_root_path);
      dropboxDeleted = true;
    } catch (error) {
      if (isDropboxNotFoundError(error)) {
        dropboxAlreadyMissing = true;
      } else {
        throw error;
      }
    }
  }

  return { organization: current, dropboxDeleted, dropboxAlreadyMissing };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const organizationId = Number(params.id);
    if (!organizationId) {
      return errorResponse("ID da organização inválido.", 400, "ORGANIZATION_ID_INVALID");
    }

    if (request.method === "GET") {
      const organization = await getOrganizationById(env, organizationId);
      if (!organization) {
        return errorResponse("Organização não encontrada.", 404, "ORGANIZATION_NOT_FOUND");
      }
      return jsonResponse({ ok: true, organization: publicOrganization(organization) });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const body = await readJsonBody(request);
      const { organization, error } = await updateOrganization(env, organizationId, body);
      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: "admin.organizations.update",
        details: { organizationId, slug: organization.slug, dropboxRootPath: organization.dropbox_root_path },
      });

      return jsonResponse({ ok: true, organization: publicOrganization(organization) });
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const hardDeleteDropbox = url.searchParams.get("dropbox") === "true";
      const { organization, dropboxDeleted, dropboxAlreadyMissing, error } = await deleteOrganization(env, organizationId, hardDeleteDropbox);
      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: hardDeleteDropbox ? "admin.organizations.delete_dropbox" : "admin.organizations.deactivate",
        details: {
          organizationId,
          slug: organization.slug,
          dropboxRootPath: organization.dropbox_root_path,
          dropboxDeleted,
          dropboxAlreadyMissing,
        },
      });

      return jsonResponse({ ok: true, dropboxDeleted, dropboxAlreadyMissing });
    }

    return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ORGANIZATION_ERROR");
  }
}
