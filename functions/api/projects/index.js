import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import {
  recordAuditLog,
  requirePermission,
} from "../../_lib/permissions.js";
import {
  listProjectsForActiveOrganization,
} from "../../_lib/project-list.js";
import {
  createProjectRecord,
  normalizeProjectSlug,
} from "../../_lib/project-service.js";
import {
  getActiveOrganizationId,
  publicProject,
} from "../../_lib/projects.js";
import {
  ensureDropboxFolder,
  getRevisionedPreviewFileNameFromConfigFile,
  joinDropboxPath,
  uploadDropboxBinaryFile,
  uploadDropboxTextFile,
} from "../../_lib/dropbox.js";
import {
  publicProjectPreview,
  sanitizeCaptureMethod,
} from "../../_lib/project-preview.js";

const DEFAULT_CONFIG_FILE = "config.kepler.json";
const MAX_CONFIG_BYTES = 25 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{12,128}$/;

function asyncThumbnailEnabled(env) {
  return String(env?.ASYNC_PROJECT_THUMBNAIL ?? "true").toLowerCase() !== "false";
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function sameId(left, right) {
  return String(left ?? "") === String(right ?? "");
}

function normalizeDropboxRoot(value) {
  return normalizeText(value).replace(/\/+$/g, "");
}

function jsonSizeBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function safeErrorMessage(error) {
  const value =
    error instanceof Error
      ? error.message
      : String(error || "Erro desconhecido.");

  return value.slice(0, 800);
}

function getCreateProjectContext(body) {
  return {
    organizationId:
      body?.organizationId ??
      body?.organization_id ??
      body?.organization?.id ??
      null,
  };
}

function validateKeplerConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "Envie uma configuração Kepler em formato JSON.";
  }

  if (!config.version) {
    return "O JSON não possui campo version.";
  }

  if (!config.config || typeof config.config !== "object") {
    return "O JSON não possui o objeto config.";
  }

  if (!Array.isArray(config.datasets)) {
    return "O JSON não possui datasets em formato de lista.";
  }

  return null;
}

function decodeImageDataUrl(value) {
  const match = normalizeText(value).match(
    /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i,
  );

  if (!match) {
    const error = new Error(
      "A visualização do projeto deve ser uma imagem PNG, JPEG ou WebP.",
    );
    error.status = 400;
    error.code = "PROJECT_THUMBNAIL_INVALID";
    throw error;
  }

  const contentType = match[1].toLowerCase();
  const binary = atob(match[3].replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    const error = new Error(
      "A visualização do projeto excede o limite permitido.",
    );
    error.status = 400;
    error.code = "PROJECT_THUMBNAIL_TOO_LARGE";
    throw error;
  }

  return { bytes, contentType };
}

function validateIdempotencyKey(value) {
  const key = normalizeText(value);

  if (!IDEMPOTENCY_PATTERN.test(key)) {
    const error = new Error(
      "Identificador da tentativa de criação inválido.",
    );
    error.status = 400;
    error.code = "PROJECT_IDEMPOTENCY_KEY_INVALID";
    throw error;
  }

  return key;
}

async function getActiveOrganization(env, organizationId) {
  return env.DB.prepare(
    `SELECT
      id,
      name,
      slug,
      dropbox_root_path,
      active
     FROM organizations
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();
}

async function getCreationReservation(env, organizationId, idempotencyKey) {
  return env.DB.prepare(
    `SELECT
      organization_files.id AS reservation_id,
      organization_files.organization_id,
      organization_files.project_id,
      organization_files.name AS reservation_name,
      organization_files.file_name,
      organization_files.dropbox_path,
      organization_files.status AS reservation_status,
      organization_files.error_message,
      organization_files.idempotency_key,
      organization_files.updated_at AS reservation_updated_at,
      projects.id,
      projects.name,
      projects.slug,
      projects.description,
      projects.dropbox_root_path,
      projects.default_config_file,
      projects.organization_file_id,
      projects.created_by,
      projects.created_by_name_snapshot,
      projects.updated_by,
      projects.updated_by_name_snapshot,
      projects.metadata_version,
      projects.active,
      projects.created_at,
      projects.updated_at,
      organizations.name AS organization_name,
      organizations.slug AS organization_slug
     FROM organization_files
     LEFT JOIN projects
       ON projects.id = organization_files.project_id
     LEFT JOIN organizations
       ON organizations.id = organization_files.organization_id
     WHERE organization_files.organization_id = ?
       AND organization_files.idempotency_key = ?
     LIMIT 1`,
  )
    .bind(organizationId, idempotencyKey)
    .first();
}

async function getCreationProjectById(env, projectId) {
  return env.DB.prepare(
    `SELECT
      projects.*,
      organizations.name AS organization_name,
      organizations.slug AS organization_slug
     FROM projects
     LEFT JOIN organizations
       ON organizations.id = projects.organization_id
     WHERE projects.id = ?
     LIMIT 1`,
  )
    .bind(projectId)
    .first();
}

async function slugExists(env, slug) {
  const row = await env.DB.prepare(
    `SELECT id
     FROM projects
     WHERE slug = ?
     LIMIT 1`,
  )
    .bind(slug)
    .first();

  return Boolean(row);
}

async function reserveProjectCreation(
  env,
  {
    organization,
    name,
    idempotencyKey,
    actor,
  },
) {
  const current = await getCreationReservation(
    env,
    organization.id,
    idempotencyKey,
  );

  if (current) {
    return current;
  }

  const baseSlug = normalizeProjectSlug(name);

  if (!baseSlug) {
    const error = new Error(
      "Não foi possível gerar um identificador para o projeto.",
    );
    error.status = 400;
    error.code = "PROJECT_SLUG_REQUIRED";
    throw error;
  }

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;

    if (await slugExists(env, slug)) {
      continue;
    }

    const projectRoot = `${normalizeDropboxRoot(
      organization.dropbox_root_path,
    )}/${slug}`;
    const configPath = joinDropboxPath(
      projectRoot,
      DEFAULT_CONFIG_FILE,
    );

    try {
      const reservation = await env.DB.prepare(
        `INSERT INTO organization_files (
          organization_id,
          project_id,
          name,
          original_name,
          file_name,
          dropbox_path,
          file_type,
          mime_type,
          size_bytes,
          status,
          error_message,
          idempotency_key,
          uploaded_by,
          is_project,
          active
        )
        VALUES (?, NULL, ?, ?, ?, ?, 'json', 'application/json', 0,
          'PENDING', NULL, ?, ?, 1, 0)
        RETURNING
          id AS reservation_id,
          organization_id,
          project_id,
          name AS reservation_name,
          file_name,
          dropbox_path,
          status AS reservation_status,
          error_message,
          idempotency_key,
          updated_at AS reservation_updated_at`,
      )
        .bind(
          organization.id,
          name,
          DEFAULT_CONFIG_FILE,
          DEFAULT_CONFIG_FILE,
          configPath,
          idempotencyKey,
          actor.id,
        )
        .first();

      return {
        ...reservation,
        slug,
        dropbox_root_path: projectRoot,
        organization_name: organization.name,
        organization_slug: organization.slug,
      };
    } catch (error) {
      const existing = await getCreationReservation(
        env,
        organization.id,
        idempotencyKey,
      );

      if (existing) {
        return existing;
      }

      if (String(error?.message || "").toUpperCase().includes("UNIQUE")) {
        continue;
      }

      throw error;
    }
  }

  const error = new Error(
    "Não foi possível gerar um slug disponível para o projeto.",
  );
  error.status = 409;
  error.code = "PROJECT_SLUG_EXHAUSTED";
  throw error;
}

async function claimReservation(env, reservationId) {
  const result = await env.DB.prepare(
    `UPDATE organization_files
     SET
       status = 'PROCESSING',
       error_message = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (
         status IN ('PENDING', 'ERROR')
         OR (
           status = 'PROCESSING'
           AND datetime(updated_at) < datetime('now', '-5 minutes')
         )
       )`,
  )
    .bind(reservationId)
    .run();

  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

async function createOrLoadPendingProject(
  env,
  {
    reservation,
    organization,
    name,
    description,
    actor,
  },
) {
  if (reservation.project_id) {
    const existing = await getCreationProjectById(
      env,
      reservation.project_id,
    );

    if (!existing) {
      const error = new Error(
        "A reserva de criação aponta para um projeto inexistente.",
      );
      error.status = 409;
      error.code = "PROJECT_CREATION_RESERVATION_INVALID";
      throw error;
    }

    if (
      normalizeText(existing.name) !== normalizeText(name) ||
      normalizeText(existing.description) !== normalizeText(description)
    ) {
      const error = new Error(
        "Esta tentativa já está vinculada a outro título ou descrição.",
      );
      error.status = 409;
      error.code = "PROJECT_CREATION_REQUEST_MISMATCH";
      throw error;
    }

    return existing;
  }

  const slug =
    reservation.slug ||
    normalizeProjectSlug(
      reservation.dropbox_path
        ?.split("/")
        .slice(-2, -1)[0] ||
      name,
    );
  const projectRoot =
    reservation.dropbox_root_path ||
    normalizeDropboxRoot(reservation.dropbox_path).replace(
      /\/config\.kepler\.json$/i,
      "",
    );

  const project = await createProjectRecord(env, {
    organizationId: organization.id,
    organizationFileId: reservation.reservation_id,
    name,
    slug,
    description,
    dropboxRootPath: projectRoot,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    active: false,
    actor,
  });

  await env.DB.prepare(
    `UPDATE organization_files
     SET
       project_id = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(project.id, reservation.reservation_id)
    .run();

  return project;
}

async function markCreationFailed(
  env,
  {
    reservationId,
    projectId,
    message,
  },
) {
  if (projectId) {
    await env.DB.prepare(
      `UPDATE projects
       SET active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(projectId)
      .run();
  }

  if (reservationId) {
    await env.DB.prepare(
      `UPDATE organization_files
       SET
         status = 'ERROR',
         active = 0,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(message, reservationId)
      .run();
  }
}

async function finalizeProjectCreation(
  env,
  {
    project,
    reservation,
    organization,
    actor,
    config,
    thumbnail,
    thumbnailCapture,
    onStage = () => {},
  },
) {
  const content = JSON.stringify(config, null, 2);
  const sizeBytes = jsonSizeBytes(content);

  if (sizeBytes > MAX_CONFIG_BYTES) {
    const error = new Error(
      "A configuração do mapa excede o limite permitido.",
    );
    error.status = 400;
    error.code = "PROJECT_CONFIG_TOO_LARGE";
    throw error;
  }

  await ensureDropboxFolder(env, project.dropbox_root_path);

  await uploadDropboxTextFile(
    env,
    project.dropbox_root_path,
    project.default_config_file || DEFAULT_CONFIG_FILE,
    content,
  );

  const configRevision = 1;
  let previewStatus = "PENDING";
  let previewRevision = null;
  let previewAttempts = 0;
  let previewLastError = null;
  let preview = null;
  const previewCaptureMethod = thumbnail
    ? sanitizeCaptureMethod(thumbnailCapture?.method || "legacy-blocking")
    : null;

  // A criação deixa de depender da captura. Este bloco só preserva o
  // rollback operacional quando ASYNC_PROJECT_THUMBNAIL=false.
  if (thumbnail) {
    previewAttempts = 1;
    const previewFileName = getRevisionedPreviewFileNameFromConfigFile(
      project.default_config_file || DEFAULT_CONFIG_FILE,
      configRevision,
    );

    try {
      await uploadDropboxBinaryFile(
        env,
        project.dropbox_root_path,
        previewFileName,
        thumbnail.bytes,
        thumbnail.contentType,
      );
      previewStatus = "READY";
      previewRevision = configRevision;
      preview = {
        previewFileName,
        previewSizeBytes: thumbnail.bytes.byteLength,
        previewContentType: thumbnail.contentType,
      };
    } catch (error) {
      previewStatus = "FAILED";
      previewLastError = String(
        error?.code || "LEGACY_THUMBNAIL_UPLOAD_FAILED",
      ).slice(0, 160);
    }
  }

  onStage("linking_user");

  await env.DB.prepare(
    `INSERT INTO user_projects (
      user_id,
      project_id,
      access_level
    )
    VALUES (?, ?, 'owner')
    ON CONFLICT(user_id, project_id)
    DO UPDATE SET access_level = 'owner'`,
  )
    .bind(actor.id, project.id)
    .run();

  onStage("finalizing");

  await env.DB.prepare(
    `UPDATE organization_files
     SET
       project_id = ?,
       name = ?,
       original_name = ?,
       file_name = ?,
       dropbox_path = ?,
       file_type = 'json',
       mime_type = 'application/json',
       size_bytes = ?,
       status = 'ACTIVE',
       error_message = NULL,
       uploaded_by = ?,
       is_project = 1,
       active = 1,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      project.id,
      project.name,
      project.default_config_file || DEFAULT_CONFIG_FILE,
      project.default_config_file || DEFAULT_CONFIG_FILE,
      joinDropboxPath(
        project.dropbox_root_path,
        project.default_config_file || DEFAULT_CONFIG_FILE,
      ),
      sizeBytes,
      actor.id,
      reservation.reservation_id,
    )
    .run();

  const activated = await env.DB.prepare(
    `UPDATE projects
     SET
       active = 1,
       organization_file_id = ?,
       updated_by = ?,
       updated_by_name_snapshot = ?,
       config_revision = ?,
       preview_status = ?,
       preview_revision = ?,
       preview_updated_at = CASE
         WHEN ? IN ('READY', 'FAILED') THEN CURRENT_TIMESTAMP
         ELSE NULL
       END,
       preview_attempts = ?,
       preview_last_error = ?,
       preview_capture_method = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND organization_id = ?
     RETURNING *`,
  )
    .bind(
      reservation.reservation_id,
      actor.id,
      actor.name || "Usuário",
      configRevision,
      previewStatus,
      previewRevision,
      previewStatus,
      previewAttempts,
      previewLastError,
      previewCaptureMethod,
      project.id,
      organization.id,
    )
    .first();

  return {
    project: {
      ...activated,
      organization_name: organization.name,
      organization_slug: organization.slug,
      access_level: "owner",
      creator_user_id: project.created_by,
      creator_current_name: project.created_by_name_snapshot,
      updater_user_id: actor.id,
      updater_current_name: actor.name,
    },
    fileName: project.default_config_file || DEFAULT_CONFIG_FILE,
    sizeBytes,
    configRevision,
    thumbnail: {
      status: previewStatus,
      revision: configRevision,
      thumbnailRevision: previewRevision,
    },
    preview,
  };
}

function publicCreatedProject(project) {
  return {
    ...publicProject(project),
    accessLevel: "owner",
    access_level: "owner",
    permissions: [],
    active: true,
    favorite: false,
  };
}

function creationThumbnailState(project) {
  const state = publicProjectPreview(project);

  return {
    status: state.thumbnailStatus,
    revision: state.configRevision,
    thumbnailRevision: state.thumbnailRevision,
    updatedAt: state.thumbnailUpdatedAt,
    attempts: state.thumbnailAttempts,
  };
}

async function createProjectFromKepler(env, request, user, body) {
  const activeOrganizationId = getActiveOrganizationId(user);
  const requestedContext = getCreateProjectContext(body);

  if (!activeOrganizationId) {
    const error = new Error(
      "Nenhuma organização ativa foi selecionada.",
    );
    error.status = 409;
    error.code = "ACTIVE_ORGANIZATION_REQUIRED";
    throw error;
  }

  if (
    requestedContext.organizationId &&
    !sameId(requestedContext.organizationId, activeOrganizationId)
  ) {
    const error = new Error(
      "A organização informada não corresponde à organização ativa.",
    );
    error.status = 403;
    error.code = "ORGANIZATION_CONTEXT_MISMATCH";
    throw error;
  }

  await requirePermission(
    env,
    request,
    "project.create",
    { organizationId: activeOrganizationId },
    {
      user,
      auditAction: "project.create.request",
      auditOnSuccess: false,
      resourceType: "organization",
      resourceId: activeOrganizationId,
    },
  );

  const organization = await getActiveOrganization(
    env,
    activeOrganizationId,
  );

  if (!organization) {
    const error = new Error("Organização não encontrada.");
    error.status = 404;
    error.code = "ORGANIZATION_NOT_FOUND";
    throw error;
  }

  if (!organization.active) {
    const error = new Error("Organização inativa.");
    error.status = 403;
    error.code = "ORGANIZATION_INACTIVE";
    throw error;
  }

  if (!organization.dropbox_root_path) {
    const error = new Error(
      "A organização não possui uma pasta Dropbox configurada.",
    );
    error.status = 409;
    error.code = "ORGANIZATION_STORAGE_NOT_CONFIGURED";
    throw error;
  }

  const name = normalizeText(body?.name);
  const description = normalizeText(body?.description);
  const idempotencyKey = validateIdempotencyKey(body?.idempotencyKey);
  const config = body?.config;
  const validationError = validateKeplerConfig(config);

  if (!name) {
    const error = new Error("Informe o título do projeto.");
    error.status = 400;
    error.code = "PROJECT_NAME_REQUIRED";
    throw error;
  }

  if (description.length > 1000) {
    const error = new Error(
      "A descrição do projeto deve ter no máximo 1.000 caracteres.",
    );
    error.status = 400;
    error.code = "PROJECT_DESCRIPTION_TOO_LONG";
    throw error;
  }

  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    error.code = "INVALID_KEPLER_CONFIG";
    throw error;
  }

  const thumbnail = asyncThumbnailEnabled(env)
    ? null
    : decodeImageDataUrl(body?.thumbnailDataUrl);
  const actor = {
    id: user.id,
    name: user.name || "Usuário",
  };

  let stage = "reserving";
  let reservation = null;
  let project = null;

  try {
    reservation = await reserveProjectCreation(env, {
      organization,
      name,
      idempotencyKey,
      actor,
    });

    if (reservation.project_id && reservation.active) {
      const activeProject = await getCreationProjectById(
        env,
        reservation.project_id,
      );

      if (activeProject?.active) {
        await recordAuditLog(env, {
          actorUserId: user.id,
          organizationId: organization.id,
          projectId: activeProject.id,
          action: "project.create.idempotent",
          resourceType: "project",
          resourceId: activeProject.id,
          result: "success",
          metadata: {
            idempotencyKey,
            slug: activeProject.slug,
          },
          request,
        });

        return {
          status: 200,
          idempotent: true,
          project: {
            ...activeProject,
            access_level: "owner",
          },
          fileName:
            activeProject.default_config_file || DEFAULT_CONFIG_FILE,
          configRevision: Number(activeProject.config_revision || 0),
          thumbnail: creationThumbnailState(activeProject),
          preview: null,
        };
      }
    }

    const claimed = await claimReservation(
      env,
      reservation.reservation_id,
    );

    if (!claimed) {
      const latest = await getCreationReservation(
        env,
        organization.id,
        idempotencyKey,
      );

      if (latest?.project_id && latest?.active) {
        const activeProject = await getCreationProjectById(
          env,
          latest.project_id,
        );

        if (activeProject?.active) {
          return {
            status: 200,
            idempotent: true,
            project: {
              ...activeProject,
              access_level: "owner",
            },
            fileName:
              activeProject.default_config_file || DEFAULT_CONFIG_FILE,
            configRevision: Number(activeProject.config_revision || 0),
            thumbnail: creationThumbnailState(activeProject),
            preview: null,
          };
        }
      }

      const error = new Error(
        "Esta tentativa de criação já está sendo processada.",
      );
      error.status = 409;
      error.code = "PROJECT_CREATION_IN_PROGRESS";
      error.details = {
        stage: "creating_record",
        retryable: true,
        idempotencyKey,
      };
      throw error;
    }

    stage = "creating_record";
    project = await createOrLoadPendingProject(env, {
      reservation,
      organization,
      name,
      description,
      actor,
    });

    stage = "preparing_files";
    const finalized = await finalizeProjectCreation(env, {
      project,
      reservation,
      organization,
      actor,
      config,
      thumbnail,
      thumbnailCapture: body?.thumbnailCapture,
      onStage(nextStage) {
        stage = nextStage;
      },
    });

    try {
      await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId: organization.id,
      projectId: finalized.project.id,
      action: "project.create.complete",
      resourceType: "project",
      resourceId: finalized.project.id,
      result: "success",
      metadata: {
        idempotencyKey,
        slug: finalized.project.slug,
        active: true,
        accessLevel: "owner",
        metadataVersion: Number(
          finalized.project.metadata_version || 1,
        ),
        fileName: finalized.fileName,
        sizeBytes: finalized.sizeBytes,
        configRevision: finalized.configRevision,
        thumbnail: finalized.thumbnail,
        preview: finalized.preview,
        thumbnailCapture: {
          method: normalizeText(body?.thumbnailCapture?.method).slice(
            0,
            160,
          ),
          diagnostics: normalizeText(
            body?.thumbnailCapture?.diagnostics,
          ).slice(0, 800),
        },
      },
        request,
      });
    } catch (auditError) {
      console.error(
        "[Maono projects] Projeto criado, mas auditoria de sucesso falhou:",
        auditError,
      );
    }

    return {
      status: 201,
      idempotent: false,
      ...finalized,
    };
  } catch (error) {
    if (error?.code === "PROJECT_CREATION_IN_PROGRESS") {
      throw error;
    }

    await markCreationFailed(env, {
      reservationId: reservation?.reservation_id,
      projectId: project?.id ?? reservation?.project_id,
      message: safeErrorMessage(error),
    });

    try {
      await recordAuditLog(env, {
        actorUserId: user.id,
        organizationId: organization.id,
        projectId: project?.id ?? reservation?.project_id ?? null,
        action: "project.create.failed",
        resourceType: "project",
        resourceId: project?.id ?? reservation?.reservation_id ?? null,
        result: "error",
        metadata: {
          idempotencyKey,
          stage,
          retryable: true,
          reason: error?.code || "PROJECT_CREATION_FAILED",
          errorMessage: safeErrorMessage(error),
        },
        request,
      });
    } catch (auditError) {
      console.error(
        "[Maono projects] Falha ao registrar auditoria de criação:",
        auditError,
      );
    }

    if (Number(error?.status || 500) < 500) {
      error.details = {
        ...(error?.details || {}),
        stage,
        retryable: true,
        idempotencyKey,
      };
      throw error;
    }

    const wrapped = new Error(
      "A criação não foi concluída. O projeto permaneceu inativo e pode ser retomado.",
    );
    wrapped.status = 500;
    wrapped.code = "PROJECT_CREATION_FAILED";
    wrapped.details = {
      stage,
      retryable: true,
      idempotencyKey,
    };
    throw wrapped;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!["GET", "POST"].includes(request.method)) {
    return methodNotAllowed(["GET", "POST"]);
  }

  try {
    const user = await requireSession(env, request);

    if (request.method === "GET") {
      const projects = await listProjectsForActiveOrganization(
        env,
        user,
      );

      return jsonResponse({
        ok: true,
        projects,
      });
    }

    const body = await readJsonBody(request);
    const result = await createProjectFromKepler(
      env,
      request,
      user,
      body,
    );

    return jsonResponse(
      {
        ok: true,
        status: "active",
        idempotent: result.idempotent,
        project: publicCreatedProject(result.project),
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
        configRevision: result.configRevision,
        thumbnail: result.thumbnail,
        preview: result.preview,
      },
      { status: result.status },
    );
  } catch (error) {
    const status = Number(error?.status || 500);
    const code = error?.code || "PROJECTS_ERROR";

    if (status >= 500) {
      console.error(
        "[Maono projects] Falha na criação completa do projeto:",
        error,
      );
    }

    return errorResponse(
      error?.message ||
        (request.method === "GET"
          ? "Não foi possível carregar os projetos."
          : "Não foi possível criar o projeto."),
      status,
      code,
      error?.details || null,
    );
  }
}
