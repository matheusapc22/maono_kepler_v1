import { recordAuditLog, requirePermission } from "./permissions.js";
import {
  createProjectRecord,
  normalizeProjectSlug,
} from "./project-service.js";
import {
  commitProjectQuota,
  isProjectQuotaReservationEnabled,
  markProjectQuotaProcessing,
  releaseProjectQuota,
  reserveProjectQuota,
} from "./organization-limit-service.js";
import {
  getRevisionedPreviewFileNameFromConfigFile,
  joinDropboxPath,
  uploadDropboxBinaryFile,
} from "./dropbox.js";
import {
  publicProjectPreview,
  sanitizeCaptureMethod,
} from "./project-preview.js";
import {
  PROJECT_LIFECYCLE_STATES,
  markProjectLifecycleFailed,
  normalizeLifecycleState,
  transitionProjectLifecycle,
} from "./project-lifecycle.js";
import { buildProjectConfigArtifact } from "./project-config-integrity.js";
import { saveVersionedProjectConfig } from "./project-config-service.js";

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

function safeErrorMessage(error) {
  const value = error instanceof Error ? error.message : String(error || "Erro desconhecido.");
  return value.slice(0, 800);
}

function createTransitionId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `transition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateKeplerConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "Envie uma configuração Kepler em formato JSON.";
  }
  if (!config.version) return "O JSON não possui campo version.";
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
    const error = new Error("A visualização do projeto deve ser uma imagem PNG, JPEG ou WebP.");
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
    const error = new Error("A visualização do projeto excede o limite permitido.");
    error.status = 400;
    error.code = "PROJECT_THUMBNAIL_TOO_LARGE";
    throw error;
  }
  return { bytes, contentType };
}

function validateIdempotencyKey(value) {
  const key = normalizeText(value);
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    const error = new Error("Identificador da tentativa de criação inválido.");
    error.status = 400;
    error.code = "PROJECT_IDEMPOTENCY_KEY_INVALID";
    throw error;
  }
  return key;
}

async function safeAudit(env, request, event) {
  try {
    await recordAuditLog(env, { ...event, request });
  } catch (error) {
    console.error("[Maono lifecycle] Falha de auditoria:", error);
  }
}

async function recordQuotaAudit(env, request, event) {
  await safeAudit(env, request, event);
}

async function recordLifecycleAudit(
  env,
  request,
  { user, organizationId, projectId, action, result = "success", metadata = {} },
) {
  await safeAudit(env, request, {
    actorUserId: user?.id ?? null,
    organizationId,
    projectId: projectId ?? null,
    action,
    resourceType: "project",
    resourceId: projectId ?? null,
    result,
    metadata,
  });
}

function getCreateProjectContext(body) {
  return {
    organizationId:
      body?.organizationId ?? body?.organization_id ?? body?.organization?.id ?? null,
  };
}

async function getActiveOrganization(env, organizationId) {
  return env.DB.prepare(
    `SELECT id, name, slug, dropbox_root_path, active
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
       organization_files.active AS reservation_active,
       organization_files.error_message,
       organization_files.idempotency_key,
       organization_files.updated_at AS reservation_updated_at,
       projects.*,
       organizations.name AS organization_name,
       organizations.slug AS organization_slug
     FROM organization_files
     LEFT JOIN projects ON projects.id = organization_files.project_id
     LEFT JOIN organizations ON organizations.id = organization_files.organization_id
     WHERE organization_files.organization_id = ?
       AND organization_files.idempotency_key = ?
     LIMIT 1`,
  )
    .bind(organizationId, idempotencyKey)
    .first();
}

async function getCreationProjectById(env, projectId) {
  return env.DB.prepare(
    `SELECT projects.*,
            organizations.name AS organization_name,
            organizations.slug AS organization_slug
       FROM projects
       LEFT JOIN organizations ON organizations.id = projects.organization_id
      WHERE projects.id = ?
      LIMIT 1`,
  )
    .bind(projectId)
    .first();
}

async function slugExists(env, slug) {
  const row = await env.DB.prepare("SELECT id FROM projects WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first();
  return Boolean(row);
}

async function reserveProjectCreation(
  env,
  { organization, name, idempotencyKey, actor },
) {
  const current = await getCreationReservation(env, organization.id, idempotencyKey);
  if (current) return current;

  const baseSlug = normalizeProjectSlug(name);
  if (!baseSlug) {
    const error = new Error("Não foi possível gerar um identificador para o projeto.");
    error.status = 400;
    error.code = "PROJECT_SLUG_REQUIRED";
    throw error;
  }

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
    if (await slugExists(env, slug)) continue;

    const projectRoot = `${normalizeDropboxRoot(organization.dropbox_root_path)}/${slug}`;
    const configPath = joinDropboxPath(projectRoot, DEFAULT_CONFIG_FILE);
    try {
      const reservation = await env.DB.prepare(
        `INSERT INTO organization_files (
           organization_id, project_id, name, original_name, file_name,
           dropbox_path, file_type, mime_type, size_bytes, status,
           error_message, idempotency_key, uploaded_by, is_project, active
         )
         VALUES (?, NULL, ?, ?, ?, ?, 'json', 'application/json', 0,
           'PENDING', NULL, ?, ?, 1, 0)
         RETURNING id AS reservation_id, organization_id, project_id,
           name AS reservation_name, file_name, dropbox_path,
           status AS reservation_status, active AS reservation_active,
           error_message, idempotency_key, updated_at AS reservation_updated_at`,
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
      const existing = await getCreationReservation(env, organization.id, idempotencyKey);
      if (existing) return existing;
      if (String(error?.message || "").toUpperCase().includes("UNIQUE")) continue;
      throw error;
    }
  }

  const error = new Error("Não foi possível gerar um slug disponível para o projeto.");
  error.status = 409;
  error.code = "PROJECT_SLUG_EXHAUSTED";
  throw error;
}

async function claimReservation(env, reservationId) {
  const result = await env.DB.prepare(
    `UPDATE organization_files
        SET status = 'PROCESSING',
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (
          status IN ('PENDING', 'ERROR')
          OR (status = 'PROCESSING' AND datetime(updated_at) < datetime('now', '-5 minutes'))
        )`,
  )
    .bind(reservationId)
    .run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

async function initializeProjectDraft(env, projectId, transitionId) {
  return env.DB.prepare(
    `UPDATE projects
        SET lifecycle_state = 'DRAFT',
            lifecycle_version = 1,
            lifecycle_updated_at = CURRENT_TIMESTAMP,
            lifecycle_transition_id = ?,
            lifecycle_attempts = 0,
            active = 0,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND lifecycle_state IS NULL
      RETURNING *`,
  )
    .bind(transitionId, projectId)
    .first();
}

export async function createOrLoadPendingProject(
  env,
  { reservation, organization, name, description, actor, transitionId },
) {
  if (reservation.project_id) {
    const existing = await getCreationProjectById(env, reservation.project_id);
    if (!existing) {
      const error = new Error("A reserva de criação aponta para um projeto inexistente.");
      error.status = 409;
      error.code = "PROJECT_CREATION_RESERVATION_INVALID";
      throw error;
    }
    if (
      normalizeText(existing.name) !== normalizeText(name) ||
      normalizeText(existing.description) !== normalizeText(description)
    ) {
      const error = new Error("Esta tentativa já está vinculada a outro título ou descrição.");
      error.status = 409;
      error.code = "PROJECT_CREATION_REQUEST_MISMATCH";
      throw error;
    }
    if (!existing.lifecycle_state) {
      return (await initializeProjectDraft(env, existing.id, transitionId)) || existing;
    }
    return existing;
  }

  const slug = reservation.slug || normalizeProjectSlug(
    reservation.dropbox_path?.split("/").slice(-2, -1)[0] || name,
  );
  const projectRoot = reservation.dropbox_root_path ||
    normalizeDropboxRoot(reservation.dropbox_path).replace(/\/config\.kepler\.json$/i, "");

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
  const draft = (await initializeProjectDraft(env, project.id, transitionId)) || project;

  await env.DB.prepare(
    `UPDATE organization_files
        SET project_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(project.id, reservation.reservation_id)
    .run();
  return draft;
}

async function enterPreparingStorage(env, project, organization, transitionId) {
  const state = normalizeLifecycleState(project.lifecycle_state);
  if (state === PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE) return project;
  if (state === PROJECT_LIFECYCLE_STATES.CONFIG_READY || state === PROJECT_LIFECYCLE_STATES.ACTIVE) {
    return project;
  }
  if (
    state !== PROJECT_LIFECYCLE_STATES.DRAFT &&
    state !== PROJECT_LIFECYCLE_STATES.FAILED
  ) {
    const error = new Error("Projeto em estado de criação desconhecido.");
    error.status = 409;
    error.code = "PROJECT_LIFECYCLE_STATE_INVALID";
    throw error;
  }

  return transitionProjectLifecycle(env, {
    projectId: project.id,
    organizationId: organization.id,
    fromState: state,
    expectedVersion: Number(project.lifecycle_version || 0),
    toState: PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
    transitionId,
  });
}

async function ensureInitialConfigPublished(
  env,
  { project, organization, config, actor },
) {
  const artifact = await buildProjectConfigArtifact(config);
  if (artifact.sizeBytes > MAX_CONFIG_BYTES) {
    const error = new Error("A configuração do mapa excede o limite permitido.");
    error.status = 400;
    error.code = "PROJECT_CONFIG_TOO_LARGE";
    throw error;
  }

  if (Number(project.config_revision || 0) > 0) {
    if (
      Number(project.config_revision) === 1 &&
      String(project.config_checksum || "").toLowerCase() === artifact.checksum
    ) {
      return { project, revision: 1, artifact, recovered: true };
    }
    const error = new Error("A tentativa de criação já possui outra revisão de configuração.");
    error.status = 409;
    error.code = "PROJECT_CREATION_REQUEST_MISMATCH";
    throw error;
  }

  return saveVersionedProjectConfig(env, {
    project,
    config,
    expectedConfigRevision: 0,
    actor,
    allowedLifecycleStates: [PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE],
    markPreviewPending: true,
  });
}

async function enterConfigReady(env, project, organization, transitionId) {
  if (project.lifecycle_state === PROJECT_LIFECYCLE_STATES.CONFIG_READY) return project;
  if (project.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE) return project;
  return transitionProjectLifecycle(env, {
    projectId: project.id,
    organizationId: organization.id,
    fromState: PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
    expectedVersion: Number(project.lifecycle_version || 0),
    toState: PROJECT_LIFECYCLE_STATES.CONFIG_READY,
    transitionId,
  });
}

async function linkProjectOwner(env, projectId, actorId) {
  await env.DB.prepare(
    `INSERT INTO user_projects (user_id, project_id, access_level)
     VALUES (?, ?, 'owner')
     ON CONFLICT(user_id, project_id)
     DO UPDATE SET access_level = 'owner'`,
  )
    .bind(actorId, projectId)
    .run();
}

async function markOrganizationFileActive(
  env,
  { reservation, project, artifact, actor },
) {
  await env.DB.prepare(
    `UPDATE organization_files
        SET project_id = ?,
            name = ?,
            original_name = ?,
            file_name = ?,
            file_type = 'json',
            mime_type = 'application/json',
            size_bytes = ?,
            sha256 = ?,
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
      artifact.sizeBytes,
      artifact.checksum,
      actor.id,
      reservation.reservation_id,
    )
    .run();
}

async function activateProject(env, project, organization, transitionId) {
  if (project.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE) return project;
  return transitionProjectLifecycle(env, {
    projectId: project.id,
    organizationId: organization.id,
    fromState: PROJECT_LIFECYCLE_STATES.CONFIG_READY,
    expectedVersion: Number(project.lifecycle_version || 0),
    toState: PROJECT_LIFECYCLE_STATES.ACTIVE,
    transitionId,
  });
}

async function saveLegacyCreationPreview(
  env,
  { project, thumbnail, thumbnailCapture, revision },
) {
  let previewStatus = "PENDING";
  let previewRevision = null;
  let previewAttempts = 0;
  let previewLastError = null;
  let preview = null;
  const previewCaptureMethod = thumbnail
    ? sanitizeCaptureMethod(thumbnailCapture?.method || "legacy-blocking")
    : null;

  if (thumbnail) {
    previewAttempts = 1;
    const previewFileName = getRevisionedPreviewFileNameFromConfigFile(
      project.default_config_file || DEFAULT_CONFIG_FILE,
      revision,
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
      previewRevision = revision;
      preview = {
        previewFileName,
        previewSizeBytes: thumbnail.bytes.byteLength,
        previewContentType: thumbnail.contentType,
      };
    } catch (error) {
      previewStatus = "FAILED";
      previewLastError = String(error?.code || "LEGACY_THUMBNAIL_UPLOAD_FAILED").slice(0, 160);
    }
  }

  const updated = await env.DB.prepare(
    `UPDATE projects
        SET preview_status = ?,
            preview_revision = ?,
            preview_updated_at = CASE
              WHEN ? IN ('READY', 'FAILED') THEN CURRENT_TIMESTAMP
              ELSE preview_updated_at
            END,
            preview_attempts = ?,
            preview_last_error = ?,
            preview_capture_method = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING *`,
  )
    .bind(
      previewStatus,
      previewRevision,
      previewStatus,
      previewAttempts,
      previewLastError,
      previewCaptureMethod,
      project.id,
    )
    .first();

  return {
    project: updated || project,
    thumbnail: {
      status: previewStatus,
      revision,
      thumbnailRevision: previewRevision,
    },
    preview,
  };
}

export async function markCreationFailed(
  env,
  {
    reservationId,
    project,
    organizationId,
    message,
    stage,
    errorCode,
    transitionId,
  },
) {
  let failedProject = project;
  if (project?.id) {
    const state = normalizeLifecycleState(project.lifecycle_state);
    if (
      state === PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE ||
      state === PROJECT_LIFECYCLE_STATES.CONFIG_READY
    ) {
      failedProject = await markProjectLifecycleFailed(env, {
        projectId: project.id,
        organizationId,
        currentState: state,
        expectedVersion: Number(project.lifecycle_version || 0),
        transitionId,
        failureStage: stage,
        failureCode: errorCode,
        retryable: true,
      }).catch(() => project);
    }
  }

  if (reservationId) {
    await env.DB.prepare(
      `UPDATE organization_files
          SET status = 'ERROR',
              active = 0,
              error_message = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(message, reservationId)
      .run();
  }
  return failedProject;
}

export async function finalizeProjectCreation(
  env,
  {
    project,
    reservation,
    organization,
    actor,
    config,
    thumbnail,
    thumbnailCapture,
    transitionId,
    onStage = () => {},
  },
) {
  let currentProject = await enterPreparingStorage(
    env,
    project,
    organization,
    transitionId,
  );

  onStage("preparing_files");
  const configResult = await ensureInitialConfigPublished(env, {
    project: currentProject,
    organization,
    config,
    actor,
  });
  currentProject = { ...currentProject, ...configResult.project };

  currentProject = await enterConfigReady(
    env,
    currentProject,
    organization,
    transitionId,
  );

  onStage("linking_user");
  await linkProjectOwner(env, currentProject.id, actor.id);
  await markOrganizationFileActive(env, {
    reservation,
    project: currentProject,
    artifact: configResult.artifact,
    actor,
  });

  onStage("finalizing");
  currentProject = await activateProject(
    env,
    currentProject,
    organization,
    transitionId,
  );

  const previewResult = await saveLegacyCreationPreview(env, {
    project: currentProject,
    thumbnail,
    thumbnailCapture,
    revision: Number(currentProject.config_revision || 1),
  });
  currentProject = { ...currentProject, ...previewResult.project };

  return {
    project: {
      ...currentProject,
      organization_name: organization.name,
      organization_slug: organization.slug,
      access_level: "owner",
      creator_user_id: project.created_by,
      creator_current_name: project.created_by_name_snapshot,
      updater_user_id: actor.id,
      updater_current_name: actor.name,
    },
    fileName: currentProject.default_config_file || DEFAULT_CONFIG_FILE,
    sizeBytes: configResult.artifact.sizeBytes,
    configRevision: Number(currentProject.config_revision || 1),
    thumbnail: previewResult.thumbnail,
    preview: previewResult.preview,
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

export async function createProjectFromKepler(
  env,
  request,
  user,
  body,
  { getActiveOrganizationId },
) {
  const activeOrganizationId = getActiveOrganizationId(user);
  const requestedContext = getCreateProjectContext(body);
  if (!activeOrganizationId) {
    const error = new Error("Nenhuma organização ativa foi selecionada.");
    error.status = 409;
    error.code = "ACTIVE_ORGANIZATION_REQUIRED";
    throw error;
  }
  if (
    requestedContext.organizationId &&
    !sameId(requestedContext.organizationId, activeOrganizationId)
  ) {
    const error = new Error("A organização informada não corresponde à organização ativa.");
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

  const organization = await getActiveOrganization(env, activeOrganizationId);
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
    const error = new Error("A organização não possui uma pasta de storage configurada.");
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
    const error = new Error("A descrição do projeto deve ter no máximo 1.000 caracteres.");
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

  const thumbnail = asyncThumbnailEnabled(env) ? null : decodeImageDataUrl(body?.thumbnailDataUrl);
  const actor = { id: user.id, name: user.name || "Usuário" };
  const transitionId = createTransitionId();
  let stage = "reserving_quota";
  let quotaReservation = null;
  let reservation = null;
  let project = null;

  try {
    if (isProjectQuotaReservationEnabled(env)) {
      quotaReservation = await reserveProjectQuota(env, {
        organizationId: organization.id,
        idempotencyKey,
        actorUserId: actor.id,
      });
      await recordQuotaAudit(env, request, {
        actorUserId: user.id,
        organizationId: organization.id,
        action: "projects.create.quota_reserved",
        resourceType: "organization",
        resourceId: organization.id,
        result: "success",
        metadata: { reservationId: quotaReservation.id, idempotencyKey, idempotent: quotaReservation.idempotent },
      });
    }

    stage = "reserving_project";
    reservation = await reserveProjectCreation(env, {
      organization,
      name,
      idempotencyKey,
      actor,
    });

    if (reservation.project_id) {
      const existing = await getCreationProjectById(env, reservation.project_id);
      if (existing?.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE) {
        const committedQuota = await commitProjectQuota(env, {
          reservationId: quotaReservation?.id,
          projectId: existing.id,
        });
        await recordLifecycleAudit(env, request, {
          user,
          organizationId: organization.id,
          projectId: existing.id,
          action: "project.create.idempotent",
          metadata: { idempotencyKey, transitionId, configRevision: existing.config_revision },
        });
        return {
          status: 200,
          idempotent: true,
          project: { ...existing, access_level: "owner" },
          fileName: existing.default_config_file || DEFAULT_CONFIG_FILE,
          sizeBytes: Number(existing.config_size_bytes || 0),
          configRevision: Number(existing.config_revision || 0),
          thumbnail: creationThumbnailState(existing),
          preview: null,
          quotaReservation: committedQuota,
        };
      }
    }

    const claimed = await claimReservation(env, reservation.reservation_id);
    if (!claimed) {
      const latest = await getCreationReservation(env, organization.id, idempotencyKey);
      if (latest?.project_id) {
        const existing = await getCreationProjectById(env, latest.project_id);
        if (existing?.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE) {
          const committedQuota = await commitProjectQuota(env, {
            reservationId: quotaReservation?.id,
            projectId: existing.id,
          });
          return {
            status: 200,
            idempotent: true,
            project: { ...existing, access_level: "owner" },
            fileName: existing.default_config_file || DEFAULT_CONFIG_FILE,
            sizeBytes: Number(existing.config_size_bytes || 0),
            configRevision: Number(existing.config_revision || 0),
            thumbnail: creationThumbnailState(existing),
            preview: null,
            quotaReservation: committedQuota,
          };
        }
      }
      const error = new Error("Esta tentativa de criação já está sendo processada.");
      error.status = 409;
      error.code = "PROJECT_CREATION_IN_PROGRESS";
      error.details = { stage: "creating_record", retryable: true, idempotencyKey };
      throw error;
    }

    await markProjectQuotaProcessing(env, quotaReservation?.id);
    stage = "creating_record";
    project = await createOrLoadPendingProject(env, {
      reservation,
      organization,
      name,
      description,
      actor,
      transitionId,
    });

    await recordLifecycleAudit(env, request, {
      user,
      organizationId: organization.id,
      projectId: project.id,
      action: "project.lifecycle.draft_created",
      metadata: { transitionId, idempotencyKey },
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
      transitionId,
      onStage(nextStage) {
        stage = nextStage;
      },
    });
    project = finalized.project;

    await recordLifecycleAudit(env, request, {
      user,
      organizationId: organization.id,
      projectId: project.id,
      action: "project.lifecycle.activated",
      metadata: {
        transitionId,
        idempotencyKey,
        revision: finalized.configRevision,
        schemaName: project.config_schema,
        schemaVersion: project.config_schema_version,
        sizeBytes: finalized.sizeBytes,
      },
    });

    stage = "committing_quota";
    const committedQuota = await commitProjectQuota(env, {
      reservationId: quotaReservation?.id,
      projectId: finalized.project.id,
    });
    if (committedQuota) {
      await recordQuotaAudit(env, request, {
        actorUserId: user.id,
        organizationId: organization.id,
        projectId: finalized.project.id,
        action: "projects.create.quota_committed",
        resourceType: "project",
        resourceId: finalized.project.id,
        result: "success",
        metadata: { reservationId: committedQuota.id, idempotent: false },
      });
    }

    await safeAudit(env, request, {
      actorUserId: user.id,
      organizationId: organization.id,
      projectId: finalized.project.id,
      action: "project.create.complete",
      resourceType: "project",
      resourceId: finalized.project.id,
      result: "success",
      metadata: {
        idempotencyKey,
        transitionId,
        slug: finalized.project.slug,
        lifecycleState: finalized.project.lifecycle_state,
        configRevision: finalized.configRevision,
        sizeBytes: finalized.sizeBytes,
      },
    });

    return {
      status: 201,
      idempotent: false,
      ...finalized,
    };
  } catch (error) {
    if (error?.code === "PROJECT_CREATION_IN_PROGRESS") throw error;

    const currentProject = project?.id
      ? await getCreationProjectById(env, project.id).catch(() => project)
      : project;
    const isActive = currentProject?.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE;
    let releasedQuota = null;
    if (!isActive) {
      releasedQuota = await releaseProjectQuota(env, {
        reservationId: quotaReservation?.id,
        errorCode: error?.code || "PROJECT_CREATION_FAILED",
      });
      project = await markCreationFailed(env, {
        reservationId: reservation?.reservation_id,
        project: currentProject,
        organizationId: organization.id,
        message: safeErrorMessage(error),
        stage,
        errorCode: error?.code || "PROJECT_CREATION_FAILED",
        transitionId,
      });
    }

    await safeAudit(env, request, {
      actorUserId: user.id,
      organizationId: organization.id,
      projectId: currentProject?.id ?? reservation?.project_id ?? null,
      action: "project.create.failed",
      resourceType: "project",
      resourceId: currentProject?.id ?? reservation?.reservation_id ?? null,
      result: "error",
      metadata: {
        idempotencyKey,
        transitionId,
        stage,
        retryable: true,
        reason: error?.code || "PROJECT_CREATION_FAILED",
        lifecycleState: currentProject?.lifecycle_state ?? null,
        quotaReleased: Boolean(releasedQuota),
      },
    });

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
      isActive
        ? "O projeto foi criado, mas a finalização operacional precisa ser retomada."
        : "A criação não foi concluída. O projeto permaneceu inativo e pode ser retomado.",
    );
    wrapped.status = 500;
    wrapped.code = isActive ? "PROJECT_CREATION_FINALIZATION_FAILED" : "PROJECT_CREATION_FAILED";
    wrapped.details = { stage, retryable: true, idempotencyKey, transitionId };
    throw wrapped;
  }
}
