import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { serializeProjectActor } from "../../../_lib/project-service.js";
import { logAudit } from "../../../_lib/projects.js";
import {
  isLifecycleManagedProject,
  publicProjectLifecycle,
} from "../../../_lib/project-lifecycle.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePositiveInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeDropboxPath(value) {
  const clean = normalizeText(value).replace(/\/+$/g, "");
  return clean || "/";
}

function isDropboxPathInsideOrganizationRoot(projectPath, organizationRootPath) {
  const normalizedProjectPath = normalizeDropboxPath(projectPath).toLowerCase();
  const normalizedOrganizationRootPath = normalizeDropboxPath(
    organizationRootPath,
  ).toLowerCase();

  if (!normalizedProjectPath || !normalizedOrganizationRootPath) return false;

  return (
    normalizedProjectPath === normalizedOrganizationRootPath ||
    normalizedProjectPath.startsWith(`${normalizedOrganizationRootPath}/`)
  );
}

async function requireAdminPanelAccessForProject(
  env,
  request,
  user,
  project,
  action,
) {
  const organizationId = normalizePositiveInteger(project.organization_id);
  const projectId = normalizePositiveInteger(project.id);

  const permissionContext = organizationId
    ? { organizationId, projectId, scopeType: "organization" }
    : { projectId, scopeType: "global" };

  return requirePermission(
    env,
    request,
    "admin.panel.access",
    permissionContext,
    {
      user,
      resourceType: organizationId ? "organization" : "project",
      resourceId: organizationId || projectId,
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicAdminProject(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    dropboxRootPath: project.dropbox_root_path,
    defaultConfigFile: project.default_config_file,
    organizationId: project.organization_id || null,
    organization: project.organization_id
      ? {
          id: project.organization_id,
          name: project.organization_name,
          slug: project.organization_slug,
        }
      : null,
    organizationFileId: project.organization_file_id || null,
    active: Boolean(project.active),
    lifecycle: publicProjectLifecycle(project),
    createdBy: serializeProjectActor(project, "created"),
    updatedBy: serializeProjectActor(project, "updated"),
    metadataVersion: Number(project.metadata_version || 1),
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

async function getProjectById(env, projectId) {
  return env.DB.prepare(
    `SELECT
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.dropbox_root_path,
      projects.default_config_file,
      projects.organization_id,
      projects.organization_file_id,
      projects.created_by,
      projects.created_by_name_snapshot,
      projects.updated_by,
      projects.updated_by_name_snapshot,
      projects.metadata_version,
      projects.active,
      projects.config_revision,
      projects.config_checksum_algorithm,
      projects.config_schema,
      projects.config_schema_version,
      projects.config_size_bytes,
      projects.lifecycle_state,
      projects.lifecycle_version,
      projects.lifecycle_updated_at,
      projects.created_at,
      projects.updated_at,
      organizations.name AS organization_name,
      organizations.slug AS organization_slug,
      organizations.dropbox_root_path AS organization_dropbox_root_path,
      creator.id AS creator_user_id,
      creator.name AS creator_current_name,
      updater.id AS updater_user_id,
      updater.name AS updater_current_name
    FROM projects
    LEFT JOIN organizations ON organizations.id = projects.organization_id
    LEFT JOIN users AS creator ON creator.id = projects.created_by
    LEFT JOIN users AS updater ON updater.id = projects.updated_by
    WHERE projects.id = ?
    LIMIT 1`,
  )
    .bind(projectId)
    .first();
}

async function syncOrganizationFileProjectFlag(env, organizationFileId) {
  if (!organizationFileId) return;

  const publicableProject = await env.DB.prepare(
    `SELECT id
       FROM projects
      WHERE organization_file_id = ?
        AND (
          lifecycle_state = 'ACTIVE'
          OR (lifecycle_state IS NULL AND active = 1)
        )
      LIMIT 1`,
  )
    .bind(organizationFileId)
    .first();

  await env.DB.prepare(
    `UPDATE organization_files
        SET is_project = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(publicableProject ? 1 : 0, organizationFileId)
    .run();
}

function changedProjectFields(current, next) {
  const fields = [];

  if (next.name !== current.name) fields.push("name");
  if (next.slug !== current.slug) fields.push("slug");
  if (next.description !== normalizeText(current.description)) fields.push("description");
  if (next.dropboxRootPath !== normalizeDropboxPath(current.dropbox_root_path)) {
    fields.push("dropboxRootPath");
  }
  if (next.defaultConfigFile !== current.default_config_file) {
    fields.push("defaultConfigFile");
  }
  if (Number(next.active) !== Number(current.active || 0)) fields.push("active");

  return fields;
}

function requestedActiveValue(body) {
  if (body?.active === true) return 1;
  if (body?.active === false) return 0;
  return null;
}

async function updateProject(env, current, body, actor) {
  const projectId = current.id;
  const name = normalizeText(body?.name ?? current.name);
  const slug = normalizeSlug(body?.slug ?? current.slug);
  const description = normalizeText(body?.description ?? current.description);
  const dropboxRootPath = normalizeDropboxPath(
    body?.dropboxRootPath ??
      body?.dropbox_root_path ??
      current.dropbox_root_path,
  );
  const defaultConfigFile = normalizeText(
    body?.defaultConfigFile ??
      body?.default_config_file ??
      current.default_config_file,
  );
  const requestedActive = requestedActiveValue(body);
  const managedLifecycle = isLifecycleManagedProject(current);

  if (
    managedLifecycle &&
    dropboxRootPath !== normalizeDropboxPath(current.dropbox_root_path)
  ) {
    return {
      error: errorResponse(
        "A pasta física de storage não pode ser alterada por edição de metadata em um projeto gerenciado.",
        409,
        "PROJECT_STORAGE_LOCATION_MANAGED_BY_LIFECYCLE",
        { lifecycleState: current.lifecycle_state },
      ),
    };
  }

  if (
    managedLifecycle &&
    defaultConfigFile !== current.default_config_file
  ) {
    return {
      error: errorResponse(
        "O arquivo base de configuração não pode ser alterado por edição de metadata em um projeto gerenciado.",
        409,
        "PROJECT_CONFIG_FILE_MANAGED_BY_LIFECYCLE",
        { lifecycleState: current.lifecycle_state },
      ),
    };
  }

  if (
    managedLifecycle &&
    requestedActive !== null &&
    requestedActive !== Number(current.active || 0)
  ) {
    return {
      error: errorResponse(
        "O campo active é controlado pelo lifecycle deste projeto.",
        409,
        "PROJECT_ACTIVE_MANAGED_BY_LIFECYCLE",
        {
          lifecycleState: current.lifecycle_state,
          currentActive: Boolean(current.active),
        },
      ),
    };
  }

  const active = managedLifecycle
    ? Number(current.active || 0)
    : requestedActive ?? Number(current.active || 0);

  if (!name) {
    return {
      error: errorResponse("Informe o nome do projeto.", 400, "PROJECT_NAME_REQUIRED"),
    };
  }
  if (!slug) {
    return {
      error: errorResponse(
        "Informe um slug válido para o projeto.",
        400,
        "PROJECT_SLUG_REQUIRED",
      ),
    };
  }
  if (!dropboxRootPath.startsWith("/")) {
    return {
      error: errorResponse(
        "A pasta Dropbox deve começar com /. Exemplo: /projects/cliente-a.",
        400,
        "PROJECT_PATH_INVALID",
      ),
    };
  }
  if (
    current.organization_id &&
    !isDropboxPathInsideOrganizationRoot(
      dropboxRootPath,
      current.organization_dropbox_root_path,
    )
  ) {
    return {
      error: errorResponse(
        "A pasta Dropbox do projeto precisa ficar dentro da pasta da organização.",
        400,
        "PROJECT_PATH_OUTSIDE_ORGANIZATION",
      ),
    };
  }
  if (!defaultConfigFile) {
    return {
      error: errorResponse(
        "Informe o arquivo JSON principal do projeto.",
        400,
        "PROJECT_FILE_REQUIRED",
      ),
    };
  }

  const next = {
    name,
    slug,
    description,
    dropboxRootPath,
    defaultConfigFile,
    active,
  };
  const changedFields = changedProjectFields(current, next);
  const metadataChanged =
    changedFields.includes("name") || changedFields.includes("description");
  const previousVersion = Number(current.metadata_version || 1);

  if (changedFields.length === 0) {
    return {
      project: current,
      changedFields,
      previousVersion,
      newVersion: previousVersion,
    };
  }

  try {
    const updated = await env.DB.prepare(
      `UPDATE projects
          SET name = ?,
              slug = ?,
              description = ?,
              dropbox_root_path = ?,
              default_config_file = ?,
              active = ?,
              updated_by = ?,
              updated_by_name_snapshot = ?,
              updated_at = CURRENT_TIMESTAMP,
              metadata_version = metadata_version + ?
        WHERE id = ?
        RETURNING *`,
    )
      .bind(
        name,
        slug,
        description || null,
        dropboxRootPath,
        defaultConfigFile,
        active,
        actor.id,
        actor.name || "Usuário",
        metadataChanged ? 1 : 0,
        projectId,
      )
      .first();

    await syncOrganizationFileProjectFlag(env, updated.organization_file_id);

    const newVersion = Number(updated.metadata_version || previousVersion);
    return {
      project: {
        ...updated,
        organization_name: current.organization_name,
        organization_slug: current.organization_slug,
        organization_dropbox_root_path: current.organization_dropbox_root_path,
        creator_user_id: current.creator_user_id,
        creator_current_name: current.creator_current_name,
        updater_user_id: actor.id,
        updater_current_name: actor.name,
      },
      changedFields,
      previousVersion,
      newVersion,
    };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return {
        error: errorResponse(
          "Já existe outro projeto com este slug.",
          409,
          "PROJECT_SLUG_EXISTS",
        ),
      };
    }
    throw error;
  }
}

async function deleteProject(env, current, { hardDelete = true, actor }) {
  const projectId = current.id;

  if (!hardDelete && isLifecycleManagedProject(current)) {
    const error = new Error(
      "Projetos gerenciados pelo lifecycle ainda não suportam desativação pelo campo active.",
    );
    error.status = 409;
    error.code = "PROJECT_LIFECYCLE_DEACTIVATION_UNSUPPORTED";
    error.details = { lifecycleState: current.lifecycle_state };
    throw error;
  }

  if (hardDelete) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM user_projects WHERE project_id = ?`).bind(projectId),
      env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM user_projects WHERE project_id = ?`).bind(projectId),
      env.DB.prepare(
        `UPDATE projects
            SET active = 0,
                updated_by = ?,
                updated_by_name_snapshot = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(actor.id, actor.name || "Usuário", projectId),
    ]);
  }

  await syncOrganizationFileProjectFlag(env, current.organization_file_id);
  return {
    project: current,
    changedFields: hardDelete ? ["deleted"] : ["active"],
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    if (
      request.method !== "GET" &&
      request.method !== "PUT" &&
      request.method !== "PATCH" &&
      request.method !== "DELETE"
    ) {
      return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
    }

    const sessionUser = await requireSession(env, request);
    const projectId = normalizePositiveInteger(params.id);

    if (!projectId) {
      return errorResponse("ID do projeto inválido.", 400, "PROJECT_ID_INVALID");
    }

    const currentProject = await getProjectById(env, projectId);
    if (!currentProject) {
      return errorResponse("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
    }

    if (request.method === "GET") {
      await requireAdminPanelAccessForProject(
        env,
        request,
        sessionUser,
        currentProject,
        currentProject.organization_id
          ? "admin.projects.organization_view"
          : "admin.projects.global_view",
      );
      return jsonResponse({ ok: true, project: publicAdminProject(currentProject) });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const { user } = await requireAdminPanelAccessForProject(
        env,
        request,
        sessionUser,
        currentProject,
        "admin.projects.update",
      );
      const body = await readJsonBody(request);
      const { project, error, changedFields, previousVersion, newVersion } =
        await updateProject(env, currentProject, body, {
          id: user.id,
          name: user.name,
        });

      if (error) return error;

      await logAudit(env, {
        userId: user.id,
        projectId: project.id,
        action: "admin.projects.update",
        details: {
          projectId: project.id,
          organizationId: project.organization_id || null,
          slug: project.slug,
          active: Boolean(project.active),
          lifecycleState: project.lifecycle_state ?? null,
          changedFields,
          previousVersion,
          newVersion,
        },
      });

      return jsonResponse({ ok: true, project: publicAdminProject(project) });
    }

    if (request.method === "DELETE") {
      const { user } = await requireAdminPanelAccessForProject(
        env,
        request,
        sessionUser,
        currentProject,
        "admin.projects.delete",
      );
      const url = new URL(request.url);
      const hardDelete = url.searchParams.get("deactivate") !== "true";
      const { project, changedFields } = await deleteProject(env, currentProject, {
        hardDelete,
        actor: { id: user.id, name: user.name },
      });

      await logAudit(env, {
        userId: user.id,
        projectId: hardDelete ? null : project.id,
        action: hardDelete
          ? "admin.projects.delete"
          : "admin.projects.deactivate",
        details: {
          projectId,
          organizationId: project.organization_id || null,
          slug: project.slug,
          name: project.name,
          hardDelete,
          lifecycleState: project.lifecycle_state ?? null,
          changedFields,
          previousVersion: Number(project.metadata_version || 1),
          newVersion: Number(project.metadata_version || 1),
        },
      });

      return jsonResponse({
        ok: true,
        deleted: hardDelete,
        deactivated: !hardDelete,
      });
    }

    return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "ADMIN_PROJECT_ERROR",
      error.details || null,
    );
  }
}
