import { normalizeRole } from "./auth.js";
import { joinDropboxPath } from "./dropbox.js";
import {
  isProjectQuotaReservationEnabled,
  markProjectQuotaProcessing,
  reserveProjectQuota,
} from "./organization-limit-service.js";
import {
  PROJECT_LIFECYCLE_STATES,
  getProjectLifecycleRow,
  normalizeLifecycleState,
  transitionProjectLifecycle,
} from "./project-lifecycle.js";
import {
  createProjectRecord,
  normalizeProjectSlug,
  validateProjectDescription,
  validateProjectName,
} from "./project-service.js";
import { getActiveOrganizationId, getAuthorizedProject } from "./projects.js";
import { recordAuditLog, requirePermission } from "./permissions.js";

export const PROJECT_CREATE_CONTEXT_HEADER = "X-Maono-Creation-Key";
export const PROJECT_CREATE_FLAG = "PROJECT_DURABLE_SAVE_V1";

const DEFAULT_CONFIG_FILE = "config.kepler.json";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{12,128}$/;
const DEFAULT_LARGE_CREATE_RESERVATION_TTL_SECONDS = 60 * 60;

function largeCreateError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
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

function transitionId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `large-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateIdempotencyKey(value) {
  const key = normalizeText(value);
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw largeCreateError(
      "Identificador da tentativa de criação inválido.",
      400,
      "PROJECT_IDEMPOTENCY_KEY_INVALID",
      { retryable: false },
    );
  }
  return key;
}

function normalizeConfigMetadata(body, {allowUnknown = false} = {}) {
  const metadata = body?.configMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw largeCreateError(
      "Metadados do MapConfig grande não informados.",
      400,
      "PROJECT_LARGE_CREATE_METADATA_INVALID",
      { retryable: false },
    );
  }

  const sizeBytes = Number(metadata.sizeBytes);
  const datasetCount = metadata.datasetCount == null && allowUnknown ? null : Number(metadata.datasetCount);
  const schemaName = normalizeText(metadata.schemaName || "legacy-kepler");
  const schemaVersion = Number(metadata.schemaVersion || 1);
  const configVersion = normalizeText(metadata.configVersion);

  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 100 * 1024 * 1024) {
    throw largeCreateError(
      "O tamanho do mapa deve estar entre 1 byte e 100 MiB.",
      400,
      "PROJECT_LARGE_CREATE_NOT_REQUIRED",
      {
        retryable: false,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      },
    );
  }
  if (datasetCount !== null && (!Number.isInteger(datasetCount) || datasetCount < 0)) {
    throw largeCreateError(
      "Quantidade de datasets inválida para criação durável.",
      400,
      "PROJECT_LARGE_CREATE_METADATA_INVALID",
      { retryable: false, field: "datasetCount" },
    );
  }
  if (schemaName !== "legacy-kepler" || schemaVersion !== 1 || (!configVersion && !allowUnknown)) {
    throw largeCreateError(
      "Schema ou versão do MapConfig grande não suportados.",
      400,
      "PROJECT_CONFIG_SCHEMA_UNSUPPORTED",
      { retryable: false, schemaName, schemaVersion },
    );
  }

  return {
    sizeBytes,
    datasetCount,
    schemaName,
    schemaVersion,
    configVersion: configVersion ? configVersion.slice(0, 80) : null,
  };
}

export function isProjectCreationAdmissionEnabled(env) {
  return String(env?.[PROJECT_CREATE_FLAG] ?? "false").trim().toLowerCase() === "true";
}

export function hasProjectCreationContext(request) {
  return Boolean(normalizeText(request?.headers?.get?.(PROJECT_CREATE_CONTEXT_HEADER)));
}

export function getProjectCreationKeyFromRequest(request) {
  return validateIdempotencyKey(
    request?.headers?.get?.(PROJECT_CREATE_CONTEXT_HEADER),
  );
}

function largeReservationTtlSeconds(env) {
  const value = Number(env?.PROJECT_CREATE_LARGE_RESERVATION_TTL_SECONDS);
  return Number.isInteger(value) && value >= 15 * 60
    ? value
    : DEFAULT_LARGE_CREATE_RESERVATION_TTL_SECONDS;
}

async function safeAudit(env, request, event) {
  try {
    await recordAuditLog(env, { ...event, request });
  } catch (error) {
    console.warn("[Maono large create] Falha auxiliar de auditoria", {
      action: event?.action ?? null,
      code: error?.code || "AUDIT_WRITE_FAILED",
    });
  }
}

async function assertCurrentCreationMembership(env,user,organizationId) {
  const organization=await env.DB.prepare("SELECT active FROM organizations WHERE id=?").bind(organizationId).first();
  const membership=await env.DB.prepare("SELECT 1 AS present FROM organization_users WHERE organization_id=? AND user_id=?").bind(organizationId,user.id).first();
  if(Number(organization?.active)!==1 || (!membership && normalizeRole(user.role)!=="super_admin")) {
    throw largeCreateError("Acesso atual à organização não disponível.",403,"PROJECT_CREATION_CONTEXT_FORBIDDEN");
  }
}

async function getOrganization(env, organizationId) {
  return env.DB.prepare(
    `SELECT id, name, slug, dropbox_root_path, active
       FROM organizations
      WHERE id = ?
      LIMIT 1`,
  )
    .bind(organizationId)
    .first();
}

async function getCreationByKey(env, organizationId, idempotencyKey) {
  return env.DB.prepare(
    `SELECT
       organization_files.id AS reservation_id,
       organization_files.organization_id AS reservation_organization_id,
       organization_files.project_id AS reservation_project_id,
       organization_files.status AS reservation_status,
       organization_files.active AS reservation_active,
       organization_files.idempotency_key,
       organization_files.uploaded_by,
       organization_files.dropbox_path AS reservation_dropbox_path,
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

async function getCreationBySlug(env, organizationId, slug) {
  return env.DB.prepare(
    `SELECT
       organization_files.id AS reservation_id,
       organization_files.organization_id AS reservation_organization_id,
       organization_files.project_id AS reservation_project_id,
       organization_files.status AS reservation_status,
       organization_files.active AS reservation_active,
       organization_files.idempotency_key,
       organization_files.uploaded_by,
       organization_files.dropbox_path AS reservation_dropbox_path,
       projects.*,
       organizations.name AS organization_name,
       organizations.slug AS organization_slug
     FROM projects
     INNER JOIN organizations ON organizations.id = projects.organization_id
     INNER JOIN organization_files
       ON organization_files.id = projects.organization_file_id
      AND organization_files.organization_id = projects.organization_id
     WHERE projects.organization_id = ?
       AND projects.slug = ?
     LIMIT 1`,
  )
    .bind(organizationId, slug)
    .first();
}

async function quotaReservationByKey(env, organizationId, idempotencyKey) {
  if (!isProjectQuotaReservationEnabled(env)) return null;
  return env.DB.prepare(
    `SELECT *
       FROM organization_resource_reservations
      WHERE organization_id = ?
        AND resource_type = 'project'
        AND idempotency_key = ?
      LIMIT 1`,
  )
    .bind(organizationId, idempotencyKey)
    .first();
}

async function touchQuotaReservation(env, organizationId, idempotencyKey) {
  if (!isProjectQuotaReservationEnabled(env)) return null;
  const expiresAt = new Date(
    Date.now() + largeReservationTtlSeconds(env) * 1000,
  ).toISOString();
  return env.DB.prepare(
    `UPDATE organization_resource_reservations
        SET expires_at = ?,
            status = CASE WHEN status = 'RESERVED' THEN 'PROCESSING' ELSE status END,
            updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ?
        AND resource_type = 'project'
        AND idempotency_key = ?
        AND status IN ('RESERVED', 'PROCESSING')
      RETURNING *`,
  )
    .bind(expiresAt, organizationId, idempotencyKey)
    .first();
}

async function slugExists(env, slug) {
  const row = await env.DB.prepare(
    "SELECT id FROM projects WHERE slug = ? LIMIT 1",
  )
    .bind(slug)
    .first();
  return Boolean(row);
}

async function insertCreationReservation(
  env,
  { organization, name, idempotencyKey, actor },
) {
  const existing = await getCreationByKey(
    env,
    organization.id,
    idempotencyKey,
  );
  if (existing) return { record: existing, inserted: false };

  const baseSlug = normalizeProjectSlug(name);
  if (!baseSlug) {
    throw largeCreateError(
      "Não foi possível gerar um identificador para o projeto.",
      400,
      "PROJECT_SLUG_REQUIRED",
      { retryable: false },
    );
  }

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
    if (await slugExists(env, slug)) continue;
    const projectRoot = `${normalizeDropboxRoot(organization.dropbox_root_path)}/${slug}`;
    const configPath = joinDropboxPath(projectRoot, DEFAULT_CONFIG_FILE);

    try {
      const row = await env.DB.prepare(
        `INSERT INTO organization_files (
           organization_id, project_id, name, original_name, file_name,
           dropbox_path, file_type, mime_type, size_bytes, status,
           error_message, idempotency_key, uploaded_by, is_project, active
         )
         VALUES (?, NULL, ?, ?, ?, ?, 'json', 'application/json', 0,
           'PROCESSING', NULL, ?, ?, 1, 0)
         RETURNING id AS reservation_id, organization_id AS reservation_organization_id,
           project_id AS reservation_project_id, status AS reservation_status,
           active AS reservation_active, idempotency_key, uploaded_by,
           dropbox_path AS reservation_dropbox_path`,
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
        inserted: true,
        record: {
          ...row,
          slug,
          dropbox_root_path: projectRoot,
          organization_name: organization.name,
          organization_slug: organization.slug,
        },
      };
    } catch (error) {
      const concurrent = await getCreationByKey(
        env,
        organization.id,
        idempotencyKey,
      );
      if (concurrent) return { record: concurrent, inserted: false };
      if (/unique/i.test(String(error?.message || ""))) continue;
      throw error;
    }
  }

  throw largeCreateError(
    "Não foi possível gerar um slug disponível para o projeto.",
    409,
    "PROJECT_SLUG_EXHAUSTED",
    { retryable: false },
  );
}

async function initializeDraft(env, projectId, id) {
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
    .bind(id, projectId)
    .first();
}

async function createPendingProject(
  env,
  { reservation, organization, name, description, actor, id },
) {
  if (reservation.reservation_project_id || reservation.project_id) {
    const projectId = reservation.reservation_project_id || reservation.project_id;
    return getProjectLifecycleRow(env, {
      projectId,
      organizationId: organization.id,
    });
  }

  const slug = reservation.slug || normalizeProjectSlug(
    normalizeText(reservation.reservation_dropbox_path)
      .split("/")
      .slice(-2, -1)[0] || name,
  );
  const projectRoot = reservation.dropbox_root_path ||
    normalizeText(reservation.reservation_dropbox_path)
      .replace(/\/config\.kepler\.json$/i, "");

  // A response/process may disappear after INSERT projects but before the
  // reservation's forward link. Recover the reverse link before inserting.
  const findReservedProject = () => env.DB.prepare(`SELECT * FROM projects
    WHERE organization_id = ? AND organization_file_id = ? LIMIT 1`)
    .bind(organization.id,reservation.reservation_id).first();
  let project = await findReservedProject();
  if (!project) {
    try {
      project = await createProjectRecord(env, {
        organizationId:organization.id, organizationFileId:reservation.reservation_id,
        name,slug,description,dropboxRootPath:projectRoot,defaultConfigFile:DEFAULT_CONFIG_FILE,
        active:false,actor,
      });
    } catch(error) {
      // A concurrent same-key reservation may have won the identical insert.
      project = await findReservedProject();
      if (!project) throw error;
    }
  }
  if (!sameId(project.created_by,actor.id) || !sameId(project.organization_id,organization.id) ||
      normalizeText(project.name)!==normalizeText(name) || normalizeText(project.description)!==normalizeText(description)) {
    throw largeCreateError("A reserva pertence a outra criação.",409,"PROJECT_CREATION_REQUEST_MISMATCH");
  }
  const draft = (await initializeDraft(env, project.id, id)) || project;
  const linked = await env.DB.prepare(`UPDATE organization_files
    SET project_id = ?, status = CASE WHEN status = 'ACTIVE' THEN status ELSE 'PROCESSING' END,
        error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ? AND uploaded_by = ?
      AND (project_id IS NULL OR project_id = ?) RETURNING id`)
    .bind(project.id,reservation.reservation_id,organization.id,actor.id,project.id).first();
  if (!linked) throw largeCreateError("A reserva mudou durante a criação.",409,"PROJECT_CREATION_RESERVATION_INVALID");

  return draft;
}

async function ensurePreparingStorage(env, project, organizationId, id) {
  let current = project;
  let state = normalizeLifecycleState(current?.lifecycle_state);

  if (!state && current?.id) {
    current = (await initializeDraft(env, current.id, id)) || current;
    state = normalizeLifecycleState(current?.lifecycle_state);
  }

  if (state === PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE) return current;
  if (
    state === PROJECT_LIFECYCLE_STATES.CONFIG_READY ||
    state === PROJECT_LIFECYCLE_STATES.ACTIVE
  ) {
    return current;
  }
  if (
    state !== PROJECT_LIFECYCLE_STATES.DRAFT &&
    state !== PROJECT_LIFECYCLE_STATES.FAILED
  ) {
    throw largeCreateError(
      "Projeto em estado incompatível com criação durável.",
      409,
      "PROJECT_LIFECYCLE_STATE_INVALID",
      { lifecycleState: state, retryable: false },
    );
  }

  return transitionProjectLifecycle(env, {
    projectId: current.id,
    organizationId,
    fromState: state,
    expectedVersion: Number(current.lifecycle_version || 0),
    toState: PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
    transitionId: id,
  });
}

function assertCreationOwnership(record, user, idempotencyKey) {
  if (!record?.id) {
    throw largeCreateError(
      "Projeto de criação durável não encontrado.",
      404,
      "PROJECT_NOT_FOUND",
      { retryable: false },
    );
  }
  if (
    !sameId(record.created_by, user?.id) ||
    !sameId(record.uploaded_by, user?.id) ||
    normalizeText(record.idempotency_key) !== idempotencyKey
  ) {
    throw largeCreateError(
      "O contexto de criação não pertence à sessão atual.",
      403,
      "PROJECT_CREATION_CONTEXT_FORBIDDEN",
      { retryable: false },
    );
  }
}

function assertCreationShape(record, name, description) {
  if (
    normalizeText(record?.name) !== normalizeText(name) ||
    normalizeText(record?.description) !== normalizeText(description)
  ) {
    throw largeCreateError(
      "Esta tentativa já está vinculada a outro título ou descrição.",
      409,
      "PROJECT_CREATION_REQUEST_MISMATCH",
      { retryable: false },
    );
  }
}

export async function reserveProjectCreation(
  env,
  request,
  user,
  body,
  options = {},
) {

  const activeOrganizationId = getActiveOrganizationId(user);
  const requestedOrganizationId =
    body?.organizationId ?? body?.organization_id ?? null;
  if (!activeOrganizationId) {
    throw largeCreateError(
      "Nenhuma organização ativa foi selecionada.",
      409,
      "ACTIVE_ORGANIZATION_REQUIRED",
      { retryable: false },
    );
  }
  if (
    requestedOrganizationId &&
    !sameId(requestedOrganizationId, activeOrganizationId)
  ) {
    throw largeCreateError(
      "A organização informada não corresponde à organização ativa.",
      403,
      "ORGANIZATION_CONTEXT_MISMATCH",
      { retryable: false },
    );
  }

  await assertCurrentCreationMembership(env,user,activeOrganizationId);
  await requirePermission(
    env,
    request,
    "project.create",
    { organizationId: activeOrganizationId },
    {
      user,
      auditAction: "project.create.large.reserve",
      auditOnSuccess: false,
      resourceType: "organization",
      resourceId: activeOrganizationId,
    },
  );

  const organization = await getOrganization(env, activeOrganizationId);
  if (!organization) {
    throw largeCreateError(
      "Organização não encontrada.",
      404,
      "ORGANIZATION_NOT_FOUND",
      { retryable: false },
    );
  }
  if (Number(organization.active) !== 1) {
    throw largeCreateError(
      "Organização inativa.",
      403,
      "ORGANIZATION_INACTIVE",
      { retryable: false },
    );
  }
  if (!normalizeText(organization.dropbox_root_path)) {
    throw largeCreateError(
      "A organização não possui uma pasta de storage configurada.",
      409,
      "ORGANIZATION_STORAGE_NOT_CONFIGURED",
      { retryable: false },
    );
  }

  const name = validateProjectName(body?.name);
  const description = validateProjectDescription(body?.description);
  const idempotencyKey = validateIdempotencyKey(body?.idempotencyKey);
  const configMetadata = normalizeConfigMetadata(body,options);
  const existing = await getCreationByKey(env, organization.id, idempotencyKey);
  if (existing && (!sameId(existing.uploaded_by,user.id) || normalizeText(existing.idempotency_key)!==idempotencyKey)) {
    throw largeCreateError("Esta reserva pertence a outra conta.",403,"PROJECT_CREATION_CONTEXT_FORBIDDEN");
  }
  if (!existing && !isProjectCreationAdmissionEnabled(env)) {
    throw largeCreateError("Novas criações estão pausadas. Preserve suas alterações.", 503, "PROJECT_DURABLE_SAVE_ADMISSION_PAUSED", { retryable:true });
  }
  const actor = { id: user.id, name: user.name || "Usuário" };
  const id = transitionId();

  let quotaReservation = null;
  if (isProjectQuotaReservationEnabled(env)) {
    quotaReservation = await reserveProjectQuota(env, {
      organizationId: organization.id,
      idempotencyKey,
      actorUserId: actor.id,
    });
    await markProjectQuotaProcessing(env, quotaReservation?.id);
    await touchQuotaReservation(env, organization.id, idempotencyKey);
  }

  const reserved = await insertCreationReservation(env, {
    organization,
    name,
    idempotencyKey,
    actor,
  });
  let record = reserved.record;
  if (!sameId(record.uploaded_by,user.id) || normalizeText(record.idempotency_key)!==idempotencyKey) {
    throw largeCreateError("Esta reserva pertence a outra conta.",403,"PROJECT_CREATION_CONTEXT_FORBIDDEN");
  }
  if (record?.id) {
    assertCreationOwnership(record, user, idempotencyKey);
    assertCreationShape(record, name, description);
  }

  let project = await createPendingProject(env, {
    reservation: record,
    organization,
    name,
    description,
    actor,
    id,
  });
  if (!project) {
    throw largeCreateError(
      "A reserva de criação não pôde ser vinculada ao projeto.",
      409,
      "PROJECT_CREATION_RESERVATION_INVALID",
      { retryable: true },
    );
  }

  if (project.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE) {
    return {
      status: 200,
      idempotent: true,
      project: {
        ...project,
        organization_name: organization.name,
        organization_slug: organization.slug,
        access_level: "owner",
      },
      configMetadata,
      idempotencyKey,
      transitionId: id,
    };
  }

  project = await ensurePreparingStorage(
    env,
    project,
    organization.id,
    id,
  );

  await env.DB.prepare(
    `UPDATE organization_files
        SET status = 'PROCESSING', active = 0, error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(project.organization_file_id || record.reservation_id)
    .run();

  await safeAudit(env, request, {
    actorUserId: user.id,
    organizationId: organization.id,
    projectId: project.id,
    action: "project_create_reserved",
    resourceType: "project",
    resourceId: project.id,
    result: "success",
    metadata: {
      transitionId: id,
      idempotencyKey,
      slug: project.slug,
      payloadBytes: configMetadata.sizeBytes,
      transport: "durable-operation",
      quotaReservationId: quotaReservation?.id ?? null,
      idempotent: !reserved.inserted,
    },
  });

  return {
    status: 202,
    idempotent: !reserved.inserted,
    project: {
      ...project,
      organization_name: organization.name,
      organization_slug: organization.slug,
      access_level: "owner",
    },
    configMetadata,
    idempotencyKey,
    transitionId: id,
  };
}

export async function authorizeProjectCreation(
  env,
  request,
  user,
  slug,
) {

  const organizationId = getActiveOrganizationId(user);
  if (!organizationId) {
    throw largeCreateError(
      "Nenhuma organização ativa foi selecionada.",
      409,
      "ACTIVE_ORGANIZATION_REQUIRED",
      { retryable: false },
    );
  }
  const idempotencyKey = getProjectCreationKeyFromRequest(request);

  await assertCurrentCreationMembership(env,user,organizationId);
  await requirePermission(
    env,
    request,
    "project.create",
    { organizationId },
    {
      user,
      auditAction: "project.create.large.stream",
      auditOnSuccess: false,
      resourceType: "organization",
      resourceId: organizationId,
    },
  );

  const record = await getCreationBySlug(env, organizationId, slug);
  assertCreationOwnership(record, user, idempotencyKey);

  const state = normalizeLifecycleState(record.lifecycle_state);
  if (state === PROJECT_LIFECYCLE_STATES.ACTIVE && !(await getAuthorizedProject(env,user,slug))) {
    throw largeCreateError("Projeto não encontrado ou sem acesso atual.",404,"PROJECT_NOT_FOUND");
  }
  const allowedStates = new Set([
    PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
    PROJECT_LIFECYCLE_STATES.CONFIG_READY,
    PROJECT_LIFECYCLE_STATES.ACTIVE,
  ]);
  if (!allowedStates.has(state)) {
    throw largeCreateError(
      "O projeto não está pronto para receber a revisão inicial por streaming.",
      409,
      "PROJECT_CONFIG_LIFECYCLE_BLOCKED",
      { lifecycleState: state, retryable: state === PROJECT_LIFECYCLE_STATES.FAILED },
    );
  }

  const expectedRevision = Number(
    request.headers.get("X-Maono-Expected-Revision"),
  );
  if (expectedRevision !== 0) {
    throw largeCreateError(
      "A criação durável deve usar expectedRevision=0.",
      409,
      "PROJECT_CREATION_REVISION_INVALID",
      { retryable: false, expectedRevision },
    );
  }

  await touchQuotaReservation(env, organizationId, idempotencyKey);
  return {
    project: record,
    idempotencyKey,
    organizationId,
    quotaReservationId: (await quotaReservationByKey(env, organizationId, idempotencyKey))?.id ?? null,
  };
}
