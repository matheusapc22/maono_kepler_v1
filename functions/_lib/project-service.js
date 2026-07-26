const PROJECT_NAME_MIN_LENGTH = 3;
const PROJECT_NAME_MAX_LENGTH = 120;
const PROJECT_DESCRIPTION_MAX_LENGTH = 1000;

const EDITABLE_METADATA_FIELDS = new Set([
  "name",
  "description",
  "metadataVersion",
]);

const BLOCKED_METADATA_FIELDS = new Set([
  "id",
  "slug",
  "organization",
  "organizationId",
  "organization_id",
  "createdBy",
  "created_by",
  "createdByNameSnapshot",
  "created_by_name_snapshot",
  "updatedBy",
  "updated_by",
  "updatedByNameSnapshot",
  "updated_by_name_snapshot",
  "dropboxRootPath",
  "dropbox_root_path",
  "defaultConfigFile",
  "default_config_file",
  "organizationFileId",
  "organization_file_id",
  "active",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "permissions",
  "accessLevel",
  "access_level",
]);

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    throw createProjectServiceError(
      "Banco de dados D1 não configurado.",
      500,
      "DATABASE_NOT_CONFIGURED",
    );
  }

  return db;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizePositiveInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function actorSnapshotName(actor) {
  const name = normalizeText(actor?.name);
  return name || "Usuário";
}

function normalizeProjectActor(actor, { required = true } = {}) {
  const id =
    actor?.id ??
    actor?.userId ??
    actor?.user_id ??
    null;
  const normalizedId = normalizePositiveInteger(id);

  if (!normalizedId) {
    if (!required) return null;

    throw createProjectServiceError(
      "Usuário responsável pela operação não informado.",
      400,
      "PROJECT_ACTOR_REQUIRED",
    );
  }

  return {
    id: normalizedId,
    name: actorSnapshotName(actor),
  };
}

export function createProjectServiceError(
  message,
  status = 400,
  code = "PROJECT_SERVICE_ERROR",
  details = null,
) {
  const error = new Error(message);
  error.status = status;
  error.code = code;

  if (details !== null && details !== undefined) {
    error.details = details;
  }

  return error;
}

export function createProjectMetadataVersionConflictError(currentProject = null) {
  const error = createProjectServiceError(
    "Este projeto foi alterado por outra pessoa. Atualize os dados antes de salvar novamente.",
    409,
    "PROJECT_METADATA_VERSION_CONFLICT",
  );

  if (currentProject) {
    error.currentProject = currentProject;
  }

  return error;
}

export function normalizeProjectName(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

export function normalizeProjectDescription(value) {
  return normalizeText(value);
}

export function normalizeProjectSlug(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateProjectName(value) {
  const name = normalizeProjectName(value);

  if (name.length < PROJECT_NAME_MIN_LENGTH) {
    throw createProjectServiceError(
      `O título do projeto deve ter pelo menos ${PROJECT_NAME_MIN_LENGTH} caracteres.`,
      400,
      "PROJECT_NAME_TOO_SHORT",
    );
  }

  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    throw createProjectServiceError(
      `O título do projeto deve ter no máximo ${PROJECT_NAME_MAX_LENGTH} caracteres.`,
      400,
      "PROJECT_NAME_TOO_LONG",
    );
  }

  return name;
}

export function validateProjectDescription(value) {
  const description = normalizeProjectDescription(value);

  if (description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw createProjectServiceError(
      `A descrição do projeto deve ter no máximo ${PROJECT_DESCRIPTION_MAX_LENGTH} caracteres.`,
      400,
      "PROJECT_DESCRIPTION_TOO_LONG",
    );
  }

  return description;
}

export function assertProjectMetadataPatchFields(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw createProjectServiceError(
      "Envie os metadados do projeto em um objeto JSON.",
      400,
      "PROJECT_METADATA_BODY_INVALID",
    );
  }

  const fields = Object.keys(patch);

  for (const field of fields) {
    if (BLOCKED_METADATA_FIELDS.has(field)) {
      throw createProjectServiceError(
        `O campo "${field}" não pode ser alterado pelo painel de metadados.`,
        400,
        "PROJECT_METADATA_FIELD_NOT_EDITABLE",
        { field },
      );
    }

    if (!EDITABLE_METADATA_FIELDS.has(field)) {
      throw createProjectServiceError(
        `O campo "${field}" não é reconhecido pela API de metadados.`,
        400,
        "PROJECT_METADATA_FIELD_UNKNOWN",
        { field },
      );
    }
  }

  if (!fields.includes("metadataVersion")) {
    throw createProjectServiceError(
      "Informe a versão atual dos metadados.",
      400,
      "PROJECT_METADATA_VERSION_REQUIRED",
    );
  }

  return patch;
}

export function serializeProjectActor(project, kind = "created") {
  if (!project || (kind !== "created" && kind !== "updated")) {
    return null;
  }

  const isCreated = kind === "created";
  const id = isCreated
    ? project.created_by ?? project.createdById ?? project.creator_user_id ?? null
    : project.updated_by ?? project.updatedById ?? project.updater_user_id ?? null;

  const snapshot = normalizeText(
    isCreated
      ? project.created_by_name_snapshot ?? project.createdByNameSnapshot
      : project.updated_by_name_snapshot ?? project.updatedByNameSnapshot,
  );

  const currentName = normalizeText(
    isCreated
      ? project.creator_current_name ?? project.creator_name
      : project.updater_current_name ?? project.updater_name,
  );

  if (id === null || id === undefined || id === "") {
    if (!snapshot) return null;

    return {
      id: null,
      name: snapshot,
    };
  }

  return {
    id,
    name: snapshot || currentName || "Usuário",
  };
}

export function serializePublicProjectMetadata(project) {
  if (!project) {
    return null;
  }

  const organizationId =
    project.organization_id ??
    project.organizationId ??
    null;
  const organizationName =
    project.organization_name ??
    project.organizationName ??
    null;
  const organizationSlug =
    project.organization_slug ??
    project.organizationSlug ??
    null;

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description ?? undefined,
    organizationId,
    organization_id: organizationId,
    organization:
      organizationId || organizationName || organizationSlug
        ? {
            id: organizationId,
            name: organizationName || "Organização",
            slug: organizationSlug || null,
          }
        : null,
    createdBy: serializeProjectActor(project, "created"),
    updatedBy: serializeProjectActor(project, "updated"),
    metadataVersion: Number(project.metadata_version ?? project.metadataVersion ?? 1),
    active: project.active === 1 || project.active === true,
    createdAt: project.created_at ?? project.createdAt ?? undefined,
    updatedAt: project.updated_at ?? project.updatedAt ?? undefined,
  };
}

function validateProjectCreationInput(input) {
  const organizationId = normalizePositiveInteger(
    input?.organizationId ?? input?.organization_id,
  );
  const organizationFileId = normalizePositiveInteger(
    input?.organizationFileId ?? input?.organization_file_id,
  );
  const name = validateProjectName(input?.name);
  const slug = normalizeProjectSlug(input?.slug || name);
  const description = validateProjectDescription(input?.description);
  const dropboxRootPath = normalizeText(
    input?.dropboxRootPath ?? input?.dropbox_root_path,
  ).replace(/\/+$/g, "");
  const defaultConfigFile =
    normalizeText(
      input?.defaultConfigFile ?? input?.default_config_file,
    ) || "config.kepler.json";
  const active = input?.active === false ? 0 : 1;
  const actor = normalizeProjectActor(input?.actor);

  if (!organizationId) {
    throw createProjectServiceError(
      "Informe a organização do projeto.",
      400,
      "PROJECT_ORGANIZATION_REQUIRED",
    );
  }

  if (!slug) {
    throw createProjectServiceError(
      "Não foi possível gerar um slug válido para o projeto.",
      400,
      "PROJECT_SLUG_REQUIRED",
    );
  }

  if (!dropboxRootPath || !dropboxRootPath.startsWith("/")) {
    throw createProjectServiceError(
      "A pasta Dropbox deve começar com /.",
      400,
      "PROJECT_PATH_INVALID",
    );
  }

  if (!defaultConfigFile) {
    throw createProjectServiceError(
      "Informe o arquivo de configuração principal do projeto.",
      400,
      "PROJECT_FILE_REQUIRED",
    );
  }

  return {
    organizationId,
    organizationFileId,
    name,
    slug,
    description,
    dropboxRootPath,
    defaultConfigFile,
    active,
    actor,
  };
}

export async function createProjectRecord(env, input) {
  const db = getDb(env);
  const values = validateProjectCreationInput(input);

  try {
    const project = await db.prepare(
      `INSERT INTO projects (
        name,
        slug,
        description,
        dropbox_root_path,
        default_config_file,
        organization_id,
        organization_file_id,
        created_by,
        created_by_name_snapshot,
        updated_by,
        updated_by_name_snapshot,
        metadata_version,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      RETURNING *`,
    )
      .bind(
        values.name,
        values.slug,
        values.description || null,
        values.dropboxRootPath,
        values.defaultConfigFile,
        values.organizationId,
        values.organizationFileId,
        values.actor.id,
        values.actor.name,
        values.actor.id,
        values.actor.name,
        values.active,
      )
      .first();

    return project;
  } catch (error) {
    if (String(error?.message || "").toUpperCase().includes("UNIQUE")) {
      throw createProjectServiceError(
        "Já existe um projeto com este slug.",
        409,
        "PROJECT_SLUG_EXISTS",
      );
    }

    throw error;
  }
}

const PROJECT_METADATA_SELECT = `
  SELECT
    projects.id,
    projects.name,
    projects.slug,
    projects.description,
    projects.organization_id,
    projects.created_by,
    projects.created_by_name_snapshot,
    projects.updated_by,
    projects.updated_by_name_snapshot,
    projects.metadata_version,
    projects.active,
    projects.created_at,
    projects.updated_at,
    organizations.name AS organization_name,
    organizations.slug AS organization_slug,
    creator.id AS creator_user_id,
    creator.name AS creator_current_name,
    updater.id AS updater_user_id,
    updater.name AS updater_current_name
  FROM projects
  LEFT JOIN organizations
    ON organizations.id = projects.organization_id
  LEFT JOIN users AS creator
    ON creator.id = projects.created_by
  LEFT JOIN users AS updater
    ON updater.id = projects.updated_by
`;

async function getProjectMetadataRowById(db, projectId, organizationId) {
  return db.prepare(
    `${PROJECT_METADATA_SELECT}
     WHERE projects.id = ?
       AND projects.organization_id = ?
     LIMIT 1`,
  )
    .bind(projectId, organizationId)
    .first();
}

export async function getProjectMetadataBySlug(
  env,
  {
    slug,
    organizationId,
    includeInactive = false,
  } = {},
) {
  const db = getDb(env);
  const normalizedSlug = normalizeProjectSlug(slug);
  const normalizedOrganizationId = normalizePositiveInteger(organizationId);

  if (!normalizedSlug) {
    throw createProjectServiceError(
      "Slug do projeto não informado.",
      400,
      "PROJECT_SLUG_REQUIRED",
    );
  }

  if (!normalizedOrganizationId) {
    throw createProjectServiceError(
      "Informe o contexto da organização.",
      400,
      "PROJECT_ORGANIZATION_REQUIRED",
    );
  }

  const project = await db.prepare(
    `${PROJECT_METADATA_SELECT}
     WHERE projects.slug = ?
       AND projects.organization_id = ?
       ${includeInactive ? "" : "AND projects.active = 1"}
     LIMIT 1`,
  )
    .bind(normalizedSlug, normalizedOrganizationId)
    .first();

  return serializePublicProjectMetadata(project);
}

export async function updateProjectMetadata(
  env,
  {
    projectId,
    organizationId,
    patch,
    actor,
  } = {},
) {
  const db = getDb(env);
  const normalizedProjectId = normalizePositiveInteger(projectId);
  const normalizedOrganizationId = normalizePositiveInteger(organizationId);
  const normalizedActor = normalizeProjectActor(actor);
  const safePatch = assertProjectMetadataPatchFields(patch);
  const expectedVersion = normalizePositiveInteger(safePatch.metadataVersion);

  if (!normalizedProjectId || !normalizedOrganizationId) {
    throw createProjectServiceError(
      "Projeto ou organização inválidos.",
      400,
      "PROJECT_METADATA_CONTEXT_INVALID",
    );
  }

  if (!expectedVersion) {
    throw createProjectServiceError(
      "Versão dos metadados inválida.",
      400,
      "PROJECT_METADATA_VERSION_INVALID",
    );
  }

  const current = await getProjectMetadataRowById(
    db,
    normalizedProjectId,
    normalizedOrganizationId,
  );

  if (!current) {
    throw createProjectServiceError(
      "Projeto não encontrado.",
      404,
      "PROJECT_NOT_FOUND",
    );
  }

  if (Number(current.metadata_version || 1) !== expectedVersion) {
    throw createProjectMetadataVersionConflictError(
      serializePublicProjectMetadata(current),
    );
  }

  const name =
    safePatch.name === undefined
      ? current.name
      : validateProjectName(safePatch.name);
  const description =
    safePatch.description === undefined
      ? normalizeProjectDescription(current.description)
      : validateProjectDescription(safePatch.description);

  const currentDescription = normalizeProjectDescription(current.description);
  const changed =
    name !== current.name ||
    description !== currentDescription;

  if (!changed) {
    return serializePublicProjectMetadata(current);
  }

  const updated = await db.prepare(
    `UPDATE projects
     SET
       name = ?,
       description = ?,
       updated_by = ?,
       updated_by_name_snapshot = ?,
       updated_at = CURRENT_TIMESTAMP,
       metadata_version = metadata_version + 1
     WHERE id = ?
       AND organization_id = ?
       AND metadata_version = ?
     RETURNING *`,
  )
    .bind(
      name,
      description || null,
      normalizedActor.id,
      normalizedActor.name,
      normalizedProjectId,
      normalizedOrganizationId,
      expectedVersion,
    )
    .first();

  if (!updated) {
    const latest = await getProjectMetadataRowById(
      db,
      normalizedProjectId,
      normalizedOrganizationId,
    );

    throw createProjectMetadataVersionConflictError(
      serializePublicProjectMetadata(latest),
    );
  }

  const enriched = {
    ...updated,
    organization_name: current.organization_name,
    organization_slug: current.organization_slug,
    creator_user_id: current.creator_user_id,
    creator_current_name: current.creator_current_name,
    updater_user_id: normalizedActor.id,
    updater_current_name: normalizedActor.name,
  };

  return serializePublicProjectMetadata(enriched);
}

export async function touchProjectAfterConfigSave(
  env,
  {
    projectId,
    organizationId = null,
    actor,
  } = {},
) {
  const db = getDb(env);
  const normalizedProjectId = normalizePositiveInteger(projectId);
  const normalizedOrganizationId = normalizePositiveInteger(organizationId);
  const normalizedActor = normalizeProjectActor(actor);

  if (!normalizedProjectId) {
    throw createProjectServiceError(
      "Projeto inválido.",
      400,
      "PROJECT_ID_INVALID",
    );
  }

  const organizationClause = normalizedOrganizationId
    ? "AND organization_id = ?"
    : "";
  const statement = db.prepare(
    `UPDATE projects
     SET
       updated_by = ?,
       updated_by_name_snapshot = ?,
       updated_at = CURRENT_TIMESTAMP,
       config_revision = config_revision + 1,
       preview_status = 'PENDING',
       preview_attempts = 0,
       preview_last_error = NULL,
       preview_capture_method = NULL
     WHERE id = ?
       ${organizationClause}
     RETURNING *`,
  );

  const updated = normalizedOrganizationId
    ? await statement
        .bind(
          normalizedActor.id,
          normalizedActor.name,
          normalizedProjectId,
          normalizedOrganizationId,
        )
        .first()
    : await statement
        .bind(
          normalizedActor.id,
          normalizedActor.name,
          normalizedProjectId,
        )
        .first();

  if (!updated) {
    throw createProjectServiceError(
      "Projeto não encontrado.",
      404,
      "PROJECT_NOT_FOUND",
    );
  }

  // metadata_version não é incrementada: salvar o mapa não deve gerar
  // conflito artificial no formulário de título e descrição.
  return updated;
}
