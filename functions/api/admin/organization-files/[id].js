import { errorResponse, jsonResponse, methodNotAllowed, readJsonBody } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { deleteDropboxPath } from "../../../_lib/dropbox.js";
import { logAudit } from "../../../_lib/projects.js";

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

function publicOrganizationFile(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    fileName: row.file_name,
    dropboxPath: row.dropbox_path,
    fileType: row.file_type,
    sizeBytes: row.size_bytes,
    isProject: Boolean(row.is_project),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOrganizationFile(env, fileId) {
  return await env.DB.prepare(
    `SELECT * FROM organization_files WHERE id = ? LIMIT 1`
  )
    .bind(fileId)
    .first();
}

async function updateOrganizationFile(env, fileId, body) {
  const current = await getOrganizationFile(env, fileId);
  if (!current) {
    return { error: errorResponse("Arquivo não encontrado.", 404, "ORGANIZATION_FILE_NOT_FOUND") };
  }

  const name = String(body?.name ?? current.name).trim();
  const isProject = body?.isProject === true ? 1 : body?.isProject === false ? 0 : Number(current.is_project || 0);
  const active = body?.active === true ? 1 : body?.active === false ? 0 : Number(current.active || 0);

  if (!name) {
    return { error: errorResponse("Informe o nome do arquivo.", 400, "ORGANIZATION_FILE_NAME_REQUIRED") };
  }

  const updated = await env.DB.prepare(
    `UPDATE organization_files
     SET name = ?, is_project = ?, active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
     RETURNING *`
  )
    .bind(name, isProject, active, fileId)
    .first();

  return { file: updated };
}

async function deleteOrganizationFile(env, fileId, hardDeleteDropbox) {
  const current = await getOrganizationFile(env, fileId);
  if (!current) {
    return { error: errorResponse("Arquivo não encontrado.", 404, "ORGANIZATION_FILE_NOT_FOUND") };
  }

  const linkedProject = await env.DB.prepare(
    `SELECT id, name FROM projects WHERE organization_file_id = ? AND active = 1 LIMIT 1`
  )
    .bind(fileId)
    .first();

  if (linkedProject) {
    return {
      error: errorResponse(
        `Este arquivo está vinculado ao projeto ativo ${linkedProject.name}. Desative ou edite o projeto antes de excluir o arquivo.`,
        409,
        "ORGANIZATION_FILE_LINKED_PROJECT"
      ),
    };
  }

  await env.DB.prepare(
    `UPDATE organization_files SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  )
    .bind(fileId)
    .run();

  if (hardDeleteDropbox) {
    await deleteDropboxPath(env, current.dropbox_path);
  }

  return { file: current };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    const fileId = Number(params.id);
    if (!fileId) {
      return errorResponse("ID do arquivo inválido.", 400, "ORGANIZATION_FILE_ID_INVALID");
    }

    if (request.method === "GET") {
      const file = await getOrganizationFile(env, fileId);
      if (!file) {
        return errorResponse("Arquivo não encontrado.", 404, "ORGANIZATION_FILE_NOT_FOUND");
      }
      return jsonResponse({ ok: true, file: publicOrganizationFile(file) });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const body = await readJsonBody(request);
      const { file, error } = await updateOrganizationFile(env, fileId, body);
      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: "admin.organization_files.update",
        details: { fileId, dropboxPath: file.dropbox_path },
      });

      return jsonResponse({ ok: true, file: publicOrganizationFile(file) });
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const hardDeleteDropbox = url.searchParams.get("dropbox") === "true";
      const { file, error } = await deleteOrganizationFile(env, fileId, hardDeleteDropbox);
      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        action: hardDeleteDropbox ? "admin.organization_files.delete_dropbox" : "admin.organization_files.deactivate",
        details: { fileId, dropboxPath: file.dropbox_path },
      });

      return jsonResponse({ ok: true });
    }

    return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ORGANIZATION_FILE_ERROR");
  }
}
