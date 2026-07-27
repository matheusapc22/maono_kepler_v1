const PROJECT_RESOURCE_TYPE = "project";
const ACTIVE_RESERVATION_STATUSES = new Set(["RESERVED", "PROCESSING"]);
const TERMINAL_RESERVATION_STATUSES = new Set([
  "FAILED",
  "RELEASED",
  "EXPIRED",
]);
const READY_STORAGE_STATUSES = new Set(["READY", "ACTIVE", "CONFIGURED"]);
const DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60;

const DEFAULT_PLAN_LIMITS = Object.freeze({
  free: Object.freeze({
    projects: 5,
    storageMb: 500,
  }),
  pro: Object.freeze({
    projects: 50,
    storageMb: 10_000,
  }),
  enterprise: Object.freeze({
    projects: 500,
    storageMb: 100_000,
  }),
});

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    throw createOrganizationLimitError(
      "Banco de dados D1 não configurado.",
      500,
      "DATABASE_NOT_CONFIGURED",
    );
  }

  return db;
}

function normalizeId(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createOrganizationLimitError(
      `${fieldName} inválido.`,
      400,
      "ORGANIZATION_LIMIT_CONTEXT_INVALID",
      { field: fieldName },
    );
  }

  return parsed;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function addSecondsIso(date, seconds) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function reservationTtlSeconds(env) {
  return normalizePositiveInteger(
    env?.PROJECT_QUOTA_RESERVATION_TTL_SECONDS,
    DEFAULT_RESERVATION_TTL_SECONDS,
  );
}

export function isFeatureFlagEnabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return !["0", "false", "off", "no", "disabled"].includes(
    String(value).trim().toLowerCase(),
  );
}

export function isProjectQuotaReservationEnabled(env) {
  return isFeatureFlagEnabled(env?.PROJECT_QUOTA_RESERVATION_V1, false);
}

export function createOrganizationLimitError(
  message,
  status = 409,
  code = "ORGANIZATION_PROJECT_LIMIT_REACHED",
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

function parseJsonObject(value) {
  if (!value) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function resolvePlanName(organization) {
  const plan = normalizeText(
    organization?.plan ??
      organization?.plan_slug ??
      organization?.subscription_plan ??
      "free",
  ).toLowerCase();

  return Object.prototype.hasOwnProperty.call(DEFAULT_PLAN_LIMITS, plan)
    ? plan
    : "free";
}

function resolveOrganizationPolicy(organization, env) {
  const plan = resolvePlanName(organization);
  const defaults = DEFAULT_PLAN_LIMITS[plan];
  const limitsJson = parseJsonObject(
    organization?.limits_json ??
      organization?.plan_limits_json ??
      organization?.limits,
  );
  const projectLimit = normalizePositiveInteger(
    organization?.project_limit ??
      organization?.projects_limit ??
      limitsJson?.projects?.limit ??
      limitsJson?.projects ??
      env?.[`PROJECT_LIMIT_${plan.toUpperCase()}`],
    defaults.projects,
  );
  const storageLimitMb = normalizePositiveInteger(
    organization?.storage_limit_mb ??
      limitsJson?.storageMb?.limit ??
      limitsJson?.storageMb ??
      env?.[`STORAGE_LIMIT_MB_${plan.toUpperCase()}`],
    defaults.storageMb,
  );

  return {
    plan,
    projects: projectLimit,
    storageMb: storageLimitMb,
  };
}

async function getOrganization(env, organizationId) {
  const organization = await getDb(env)
    .prepare(
      `SELECT *
       FROM organizations
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first();

  if (!organization) {
    throw createOrganizationLimitError(
      "Organização não encontrada.",
      404,
      "ORGANIZATION_NOT_FOUND",
    );
  }

  if (
    organization.active !== undefined &&
    Number(organization.active) !== 1
  ) {
    throw createOrganizationLimitError(
      "Organização inativa.",
      403,
      "ORGANIZATION_INACTIVE",
    );
  }

  return organization;
}

function getStorageReadiness(organization) {
  const rootPath = normalizeText(organization?.dropbox_root_path);
  const status = normalizeStatus(organization?.storage_status);
  const hasKnownStatus = Boolean(status);
  const statusReady = !hasKnownStatus || READY_STORAGE_STATUSES.has(status);
  const ready = Boolean(rootPath) && statusReady;

  return {
    ready,
    status: status || (rootPath ? "LEGACY_CONFIGURED" : "NOT_CONFIGURED"),
  };
}

async function countActiveProjects(env, organizationId) {
  const row = await getDb(env)
    .prepare(
      `SELECT COUNT(*) AS total
       FROM projects
       WHERE organization_id = ?
         AND active = 1`,
    )
    .bind(organizationId)
    .first();

  return normalizeNonNegativeNumber(row?.total);
}

async function countActiveReservations(env, organizationId, currentTime) {
  const row = await getDb(env)
    .prepare(
      `SELECT COUNT(*) AS total
       FROM organization_resource_reservations
       WHERE organization_id = ?
         AND resource_type = ?
         AND status IN ('RESERVED', 'PROCESSING')
         AND expires_at > ?`,
    )
    .bind(organizationId, PROJECT_RESOURCE_TYPE, currentTime)
    .first();

  return normalizeNonNegativeNumber(row?.total);
}

async function sumOrganizationStorageMb(env, organizationId) {
  const row = await getDb(env)
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes
       FROM organization_files
       WHERE organization_id = ?
         AND active = 1
         AND deleted_at IS NULL`,
    )
    .bind(organizationId)
    .first();

  const bytes = normalizeNonNegativeNumber(row?.total_bytes);
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

export async function expireStaleReservations(
  env,
  organizationId = null,
  currentTime = nowIso(),
) {
  const params = [currentTime];
  let organizationClause = "";

  if (organizationId !== null && organizationId !== undefined) {
    organizationClause = " AND organization_id = ?";
    params.push(normalizeId(organizationId, "organizationId"));
  }

  return getDb(env)
    .prepare(
      `UPDATE organization_resource_reservations
       SET status = 'EXPIRED',
           error_code = COALESCE(error_code, 'RESERVATION_EXPIRED'),
           updated_at = CURRENT_TIMESTAMP
       WHERE resource_type = 'project'
         AND status IN ('RESERVED', 'PROCESSING')
         AND expires_at <= ?${organizationClause}`,
    )
    .bind(...params)
    .run();
}

export async function getOrganizationLimitsSnapshot(
  env,
  organizationId,
  options = {},
) {
  const id = normalizeId(organizationId, "organizationId");
  const currentTime = options.now
    ? nowIso(options.now)
    : nowIso();
  const organization = options.organization || await getOrganization(env, id);
  const policy = resolveOrganizationPolicy(organization, env);
  const storage = getStorageReadiness(organization);

  if (isProjectQuotaReservationEnabled(env)) {
    await expireStaleReservations(env, id, currentTime);
  }

  const [used, reserved, storageUsedMb] = await Promise.all([
    countActiveProjects(env, id),
    isProjectQuotaReservationEnabled(env)
      ? countActiveReservations(env, id, currentTime)
      : Promise.resolve(0),
    sumOrganizationStorageMb(env, id),
  ]);
  const remaining = Math.max(0, policy.projects - used - reserved);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    plan: policy.plan,
    projects: {
      used,
      reserved,
      limit: policy.projects,
      remaining,
    },
    storageMb: {
      used: storageUsedMb,
      limit: policy.storageMb,
      remaining: Math.max(0, policy.storageMb - storageUsedMb),
      ready: storage.ready,
      status: storage.status,
    },
    reservationTtlSeconds: reservationTtlSeconds(env),
  };
}

export async function assertCanOpenNewMapEditor(
  env,
  organizationId,
  options = {},
) {
  const snapshot = await getOrganizationLimitsSnapshot(
    env,
    organizationId,
    options,
  );

  if (!snapshot.storageMb.ready) {
    return {
      allowed: false,
      reason: "ORGANIZATION_STORAGE_NOT_CONFIGURED",
      snapshot,
    };
  }

  if (snapshot.projects.remaining < 1) {
    return {
      allowed: false,
      reason: "ORGANIZATION_PROJECT_LIMIT_REACHED",
      snapshot,
    };
  }

  return {
    allowed: true,
    reason: null,
    snapshot,
  };
}

async function getReservationByKey(env, organizationId, idempotencyKey) {
  return getDb(env)
    .prepare(
      `SELECT *
       FROM organization_resource_reservations
       WHERE organization_id = ?
         AND resource_type = ?
         AND idempotency_key = ?
       LIMIT 1`,
    )
    .bind(organizationId, PROJECT_RESOURCE_TYPE, idempotencyKey)
    .first();
}

function publicReservation(row, idempotent = false) {
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    resourceType: row.resource_type,
    idempotencyKey: row.idempotency_key,
    projectId: row.project_id ?? null,
    actorUserId: row.actor_user_id,
    status: normalizeStatus(row.status),
    expiresAt: row.expires_at,
    errorCode: row.error_code ?? null,
    idempotent,
  };
}

function isUnexpiredActiveReservation(row, currentTime) {
  return (
    row &&
    ACTIVE_RESERVATION_STATUSES.has(normalizeStatus(row.status)) &&
    new Date(row.expires_at).getTime() > new Date(currentTime).getTime()
  );
}

function buildCapacityPredicate() {
  return `(
    SELECT COUNT(*)
    FROM projects
    WHERE organization_id = ?
      AND active = 1
  ) + (
    SELECT COUNT(*)
    FROM organization_resource_reservations
    WHERE organization_id = ?
      AND resource_type = 'project'
      AND status IN ('RESERVED', 'PROCESSING')
      AND expires_at > ?
  ) < ?`;
}

async function reactivateTerminalReservation(
  env,
  reservation,
  {
    organizationId,
    actorUserId,
    currentTime,
    expiresAt,
    limit,
  },
) {
  const row = await getDb(env)
    .prepare(
      `UPDATE organization_resource_reservations
       SET project_id = NULL,
           actor_user_id = ?,
           status = 'RESERVED',
           expires_at = ?,
           error_code = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('FAILED', 'RELEASED', 'EXPIRED')
         AND ${buildCapacityPredicate()}
       RETURNING *`,
    )
    .bind(
      actorUserId,
      expiresAt,
      reservation.id,
      organizationId,
      organizationId,
      currentTime,
      limit,
    )
    .first();

  return publicReservation(row, Boolean(row));
}

async function insertReservation(
  env,
  {
    organizationId,
    idempotencyKey,
    actorUserId,
    currentTime,
    expiresAt,
    limit,
  },
) {
  const row = await getDb(env)
    .prepare(
      `INSERT INTO organization_resource_reservations (
         organization_id,
         resource_type,
         idempotency_key,
         project_id,
         actor_user_id,
         status,
         expires_at,
         error_code,
         created_at,
         updated_at
       )
       SELECT ?, 'project', ?, NULL, ?, 'RESERVED', ?, NULL,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       WHERE ${buildCapacityPredicate()}
       ON CONFLICT (organization_id, resource_type, idempotency_key)
       DO NOTHING
       RETURNING *`,
    )
    .bind(
      organizationId,
      idempotencyKey,
      actorUserId,
      expiresAt,
      organizationId,
      organizationId,
      currentTime,
      limit,
    )
    .first();

  return publicReservation(row);
}

export async function reserveProjectQuota(
  env,
  {
    organizationId,
    idempotencyKey,
    actorUserId,
    now = new Date(),
  },
) {
  const id = normalizeId(organizationId, "organizationId");
  const actorId = normalizeId(actorUserId, "actorUserId");
  const key = normalizeText(idempotencyKey);

  if (!key) {
    throw createOrganizationLimitError(
      "Chave de idempotência não informada.",
      400,
      "PROJECT_IDEMPOTENCY_KEY_INVALID",
    );
  }

  if (!isProjectQuotaReservationEnabled(env)) {
    return {
      id: null,
      organizationId: id,
      resourceType: PROJECT_RESOURCE_TYPE,
      idempotencyKey: key,
      projectId: null,
      actorUserId: actorId,
      status: "DISABLED",
      expiresAt: null,
      errorCode: null,
      idempotent: false,
    };
  }

  const currentTime = nowIso(now);
  const ttlSeconds = reservationTtlSeconds(env);
  const expiresAt = addSecondsIso(now, ttlSeconds);
  await expireStaleReservations(env, id, currentTime);

  const snapshot = await getOrganizationLimitsSnapshot(env, id, {
    now,
  });
  let existing = await getReservationByKey(env, id, key);

  if (
    existing &&
    (
      normalizeStatus(existing.status) === "COMMITTED" ||
      isUnexpiredActiveReservation(existing, currentTime)
    )
  ) {
    return publicReservation(existing, true);
  }

  if (
    existing &&
    TERMINAL_RESERVATION_STATUSES.has(normalizeStatus(existing.status))
  ) {
    const reactivated = await reactivateTerminalReservation(env, existing, {
      organizationId: id,
      actorUserId: actorId,
      currentTime,
      expiresAt,
      limit: snapshot.projects.limit,
    });

    if (reactivated) {
      return reactivated;
    }
  } else if (!existing) {
    const inserted = await insertReservation(env, {
      organizationId: id,
      idempotencyKey: key,
      actorUserId: actorId,
      currentTime,
      expiresAt,
      limit: snapshot.projects.limit,
    });

    if (inserted) {
      return inserted;
    }
  }

  existing = await getReservationByKey(env, id, key);

  if (
    existing &&
    (
      normalizeStatus(existing.status) === "COMMITTED" ||
      isUnexpiredActiveReservation(existing, currentTime)
    )
  ) {
    return publicReservation(existing, true);
  }

  const latest = await getOrganizationLimitsSnapshot(env, id, {
    now,
  });

  throw createOrganizationLimitError(
    "A organização atingiu o limite de projetos.",
    409,
    "ORGANIZATION_PROJECT_LIMIT_REACHED",
    {
      used: latest.projects.used,
      reserved: latest.projects.reserved,
      limit: latest.projects.limit,
      remaining: latest.projects.remaining,
    },
  );
}

export async function markProjectQuotaProcessing(env, reservationId) {
  if (!reservationId || !isProjectQuotaReservationEnabled(env)) {
    return null;
  }

  const expiresAt = addSecondsIso(
    new Date(),
    reservationTtlSeconds(env),
  );
  const row = await getDb(env)
    .prepare(
      `UPDATE organization_resource_reservations
       SET status = 'PROCESSING',
           expires_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'RESERVED'
       RETURNING *`,
    )
    .bind(expiresAt, reservationId)
    .first();

  return publicReservation(row);
}

export async function commitProjectQuota(
  env,
  {
    reservationId,
    projectId,
  },
) {
  if (!reservationId || !isProjectQuotaReservationEnabled(env)) {
    return null;
  }

  const normalizedProjectId = normalizeId(projectId, "projectId");
  const row = await getDb(env)
    .prepare(
      `UPDATE organization_resource_reservations
       SET project_id = ?,
           status = 'COMMITTED',
           error_code = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('RESERVED', 'PROCESSING', 'COMMITTED')
       RETURNING *`,
    )
    .bind(normalizedProjectId, reservationId)
    .first();

  return publicReservation(row);
}

export async function releaseProjectQuota(
  env,
  {
    reservationId,
    errorCode = "PROJECT_CREATION_FAILED",
  },
) {
  if (!reservationId || !isProjectQuotaReservationEnabled(env)) {
    return null;
  }

  const row = await getDb(env)
    .prepare(
      `UPDATE organization_resource_reservations
       SET status = 'RELEASED',
           error_code = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('RESERVED', 'PROCESSING')
       RETURNING *`,
    )
    .bind(normalizeText(errorCode).slice(0, 120), reservationId)
    .first();

  return publicReservation(row);
}
