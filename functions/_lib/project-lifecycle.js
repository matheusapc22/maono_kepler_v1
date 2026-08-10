export const PROJECT_LIFECYCLE_STATES = Object.freeze({
  DRAFT: "DRAFT",
  PREPARING_STORAGE: "PREPARING_STORAGE",
  CONFIG_READY: "CONFIG_READY",
  ACTIVE: "ACTIVE",
  FAILED: "FAILED",
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [PROJECT_LIFECYCLE_STATES.DRAFT]: new Set([
    PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
  ]),
  [PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE]: new Set([
    PROJECT_LIFECYCLE_STATES.CONFIG_READY,
    PROJECT_LIFECYCLE_STATES.FAILED,
  ]),
  [PROJECT_LIFECYCLE_STATES.CONFIG_READY]: new Set([
    PROJECT_LIFECYCLE_STATES.ACTIVE,
    PROJECT_LIFECYCLE_STATES.FAILED,
  ]),
  [PROJECT_LIFECYCLE_STATES.FAILED]: new Set([
    PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
  ]),
  [PROJECT_LIFECYCLE_STATES.ACTIVE]: new Set([
    PROJECT_LIFECYCLE_STATES.ACTIVE,
  ]),
});

function lifecycleError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

/**
 * Flag operacional de admissão/rollout.
 * IMPORTANTE: ela jamais faz um projeto que já possui lifecycle voltar ao
 * contrato legado. Uma linha com lifecycle_state válido continua sendo
 * governada pelo lifecycle mesmo se a flag for desligada depois.
 */
export function isProjectLifecycleEnabled(env) {
  return String(env?.PROJECT_LIFECYCLE_V1 ?? "true").toLowerCase() !== "false";
}

export function normalizeLifecycleState(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return Object.values(PROJECT_LIFECYCLE_STATES).includes(normalized)
    ? normalized
    : null;
}

export function isLifecycleManagedProject(project) {
  return Boolean(
    normalizeLifecycleState(project?.lifecycle_state ?? project?.lifecycleState),
  );
}

export function isProjectPublicable(project) {
  const state = normalizeLifecycleState(
    project?.lifecycle_state ?? project?.lifecycleState,
  );

  if (state) {
    return state === PROJECT_LIFECYCLE_STATES.ACTIVE;
  }

  return project?.active === 1 || project?.active === true;
}

export function assertLifecycleTransition(fromState, toState) {
  const from = normalizeLifecycleState(fromState);
  const to = normalizeLifecycleState(toState);

  if (!from || !to || !ALLOWED_TRANSITIONS[from]?.has(to)) {
    throw lifecycleError(
      `Transição de lifecycle inválida: ${fromState ?? "NULL"} → ${toState ?? "NULL"}.`,
      409,
      "PROJECT_LIFECYCLE_TRANSITION_INVALID",
      { fromState: fromState ?? null, toState: toState ?? null },
    );
  }

  return { from, to };
}

export function assertActiveProjectInvariant(project) {
  const revision = positiveInteger(project?.config_revision ?? project?.configRevision);
  const checksum = String(project?.config_checksum ?? project?.configChecksum ?? "").trim();
  const checksumAlgorithm = String(
    project?.config_checksum_algorithm ?? project?.configChecksumAlgorithm ?? "",
  ).trim().toLowerCase();
  const storageRef = String(
    project?.config_storage_ref ?? project?.configStorageRef ?? "",
  ).trim();
  const schema = String(project?.config_schema ?? project?.configSchema ?? "").trim();
  const schemaVersion = positiveInteger(
    project?.config_schema_version ?? project?.configSchemaVersion,
  );
  const sizeBytes = positiveInteger(
    project?.config_size_bytes ?? project?.configSizeBytes,
  );

  const missing = [];
  if (!revision) missing.push("config_revision");
  if (!checksum) missing.push("config_checksum");
  if (!checksumAlgorithm) missing.push("config_checksum_algorithm");
  if (!storageRef) missing.push("config_storage_ref");
  if (!schema) missing.push("config_schema");
  if (!schemaVersion) missing.push("config_schema_version");
  if (!sizeBytes) missing.push("config_size_bytes");

  if (missing.length > 0) {
    throw lifecycleError(
      "Projeto não satisfaz as invariantes necessárias para ACTIVE.",
      409,
      "PROJECT_ACTIVE_INVARIANT_VIOLATION",
      { missing },
    );
  }

  return true;
}

export function publicProjectLifecycle(project) {
  const state = normalizeLifecycleState(
    project?.lifecycle_state ?? project?.lifecycleState,
  );

  if (!state) return null;

  return {
    state,
    version:
      nonNegativeInteger(
        project?.lifecycle_version ?? project?.lifecycleVersion,
      ) ?? 0,
    configRevision:
      nonNegativeInteger(project?.config_revision ?? project?.configRevision) ?? 0,
    schema:
      project?.config_schema ?? project?.configSchema
        ? {
            name: project?.config_schema ?? project?.configSchema,
            version: positiveInteger(
              project?.config_schema_version ?? project?.configSchemaVersion,
            ),
          }
        : null,
    sizeBytes: nonNegativeInteger(
      project?.config_size_bytes ?? project?.configSizeBytes,
    ),
    integrity:
      project?.config_checksum_algorithm ?? project?.configChecksumAlgorithm
        ? {
            algorithm: String(
              project?.config_checksum_algorithm ??
                project?.configChecksumAlgorithm,
            ).toLowerCase(),
          }
        : null,
    updatedAt:
      project?.lifecycle_updated_at ?? project?.lifecycleUpdatedAt ?? null,
  };
}

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;
  if (!db || typeof db.prepare !== "function") {
    throw lifecycleError(
      "Banco de dados D1 não configurado.",
      500,
      "DATABASE_NOT_CONFIGURED",
    );
  }
  return db;
}

export async function getProjectLifecycleRow(env, { projectId, organizationId }) {
  const db = getDb(env);
  return db
    .prepare(
      `SELECT *
       FROM projects
      WHERE id = ?
        AND organization_id = ?
      LIMIT 1`,
    )
    .bind(projectId, organizationId)
    .first();
}

export async function transitionProjectLifecycle(
  env,
  {
    projectId,
    organizationId,
    fromState,
    expectedVersion,
    toState,
    transitionId = null,
    failureStage = null,
    failureCode = null,
    retryable = null,
  },
) {
  const db = getDb(env);
  const { from, to } = assertLifecycleTransition(fromState, toState);
  const version = nonNegativeInteger(expectedVersion);

  if (
    !positiveInteger(projectId) ||
    !positiveInteger(organizationId) ||
    version === null
  ) {
    throw lifecycleError(
      "Contexto de transição do lifecycle inválido.",
      400,
      "PROJECT_LIFECYCLE_CONTEXT_INVALID",
    );
  }

  if (to === PROJECT_LIFECYCLE_STATES.ACTIVE) {
    const current = await getProjectLifecycleRow(env, {
      projectId,
      organizationId,
    });
    if (!current) {
      throw lifecycleError("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
    }
    assertActiveProjectInvariant(current);
  }

  const failed = to === PROJECT_LIFECYCLE_STATES.FAILED;
  const preparing = to === PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE;
  const activated = to === PROJECT_LIFECYCLE_STATES.ACTIVE;

  const updated = await db
    .prepare(
      `UPDATE projects
        SET lifecycle_state = ?,
            lifecycle_version = lifecycle_version + 1,
            lifecycle_updated_at = CURRENT_TIMESTAMP,
            lifecycle_transition_id = ?,
            lifecycle_attempts = CASE
              WHEN ? = 1 THEN lifecycle_attempts + 1
              ELSE lifecycle_attempts
            END,
            lifecycle_failure_stage = ?,
            lifecycle_failure_code = ?,
            lifecycle_failure_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            lifecycle_retryable = ?,
            active = CASE WHEN ? = 1 THEN 1 ELSE 0 END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND organization_id = ?
        AND lifecycle_state = ?
        AND lifecycle_version = ?
      RETURNING *`,
    )
    .bind(
      to,
      transitionId,
      preparing ? 1 : 0,
      failed ? String(failureStage || "UNKNOWN").slice(0, 120) : null,
      failed
        ? String(failureCode || "PROJECT_LIFECYCLE_FAILED").slice(0, 160)
        : null,
      failed ? 1 : 0,
      failed ? (retryable === false ? 0 : 1) : null,
      activated ? 1 : 0,
      projectId,
      organizationId,
      from,
      version,
    )
    .first();

  if (!updated) {
    const current = await getProjectLifecycleRow(env, {
      projectId,
      organizationId,
    });
    throw lifecycleError(
      "O lifecycle do projeto foi alterado por outra execução.",
      409,
      "PROJECT_LIFECYCLE_VERSION_CONFLICT",
      {
        expectedState: from,
        expectedVersion: version,
        currentState: current?.lifecycle_state ?? null,
        currentVersion: current?.lifecycle_version ?? null,
      },
    );
  }

  return updated;
}

export async function markProjectLifecycleFailed(
  env,
  {
    projectId,
    organizationId,
    currentState,
    expectedVersion,
    transitionId = null,
    failureStage,
    failureCode,
    retryable = true,
  },
) {
  const state = normalizeLifecycleState(currentState);

  if (
    state !== PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE &&
    state !== PROJECT_LIFECYCLE_STATES.CONFIG_READY
  ) {
    return getProjectLifecycleRow(env, { projectId, organizationId });
  }

  return transitionProjectLifecycle(env, {
    projectId,
    organizationId,
    fromState: state,
    expectedVersion,
    toState: PROJECT_LIFECYCLE_STATES.FAILED,
    transitionId,
    failureStage,
    failureCode,
    retryable,
  });
}
