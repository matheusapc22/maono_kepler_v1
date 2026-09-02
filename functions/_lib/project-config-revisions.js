import {
  PROJECT_LIFECYCLE_STATES,
  normalizeLifecycleState,
} from "./project-lifecycle.js";
import {
  deleteDropboxPathIfExists,
  joinDropboxPath,
} from "./dropbox.js";
import { getMapConfigRevisionFileName } from "./map-config-storage-ref.js";

const ABANDONED_READY_GRACE_SECONDS = 30;

function revisionError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;
  if (!db || typeof db.prepare !== "function") {
    throw revisionError(
      "Banco de dados D1 não configurado.",
      500,
      "DATABASE_NOT_CONFIGURED",
    );
  }
  return db;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw revisionError("Identificador inválido.", 400, code);
  }
  return number;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw revisionError("Revisão esperada inválida.", 400, code);
  }
  return number;
}

async function getProjectForRevision(db, projectId, organizationId) {
  return db
    .prepare(
      `SELECT * FROM projects
      WHERE id = ? AND organization_id = ?
      LIMIT 1`,
    )
    .bind(projectId, organizationId)
    .first();
}

export async function getProjectConfigRevision(env, projectId, revision) {
  return getDb(env)
    .prepare(
      `SELECT *
       FROM project_config_revisions
      WHERE project_id = ? AND revision = ?
      LIMIT 1`,
    )
    .bind(projectId, revision)
    .first();
}

async function claimAbandonedReadyRevision(db, existing) {
  if (
    existing?.status !== "READY" ||
    existing?.published_at !== null && existing?.published_at !== undefined
  ) {
    return null;
  }

  return db
    .prepare(
      `UPDATE project_config_revisions
          SET status = 'FAILED',
              error_code = 'PROJECT_CONFIG_READY_ABANDONED',
              error_stage = 'PUBLISH',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'READY'
          AND published_at IS NULL
          AND updated_at <= datetime('now', '-${ABANDONED_READY_GRACE_SECONDS} seconds')
        RETURNING *`,
    )
    .bind(existing.id)
    .first();
}

async function removeUnpublishedRevisionArtifact(
  env,
  project,
  revision,
  storageProvider,
) {
  if (String(storageProvider || "").trim().toLowerCase() !== "dropbox") {
    return false;
  }
  if (!project?.dropbox_root_path) {
    return false;
  }

  const fileName = getMapConfigRevisionFileName(
    project.default_config_file || "config.kepler.json",
    revision,
  );
  const path = joinDropboxPath(project.dropbox_root_path, fileName);
  await deleteDropboxPathIfExists(env, path);
  return true;
}

async function recycleUnpublishedRevisionCandidate(
  env,
  {
    db,
    project,
    existing,
    projectId,
    organizationId,
    expected,
    nextRevision,
    checksumAlgorithm,
    checksum,
    storageProvider,
    storageRef,
    schemaName,
    schemaVersion,
    sizeBytes,
    contentType,
    actorUserId,
    transitionId,
  },
) {
  let reclaimable = existing;

  if (existing?.status === "READY") {
    reclaimable = await claimAbandonedReadyRevision(db, existing);
  }

  if (
    !reclaimable ||
    reclaimable.status !== "FAILED" ||
    (reclaimable.published_at !== null && reclaimable.published_at !== undefined)
  ) {
    return null;
  }

  const current = await getProjectForRevision(db, projectId, organizationId);
  const currentRevision = Number(current?.config_revision || 0);
  if (currentRevision !== expected) {
    throw revisionError(
      "O projeto foi alterado por outra operação.",
      409,
      "PROJECT_CONFIG_REVISION_CONFLICT",
      {
        expectedConfigRevision: expected,
        currentConfigRevision,
      },
    );
  }

  const removed = await removeUnpublishedRevisionArtifact(
    env,
    project,
    nextRevision,
    reclaimable.storage_provider || storageProvider,
  );

  if (!removed) {
    return null;
  }

  const recycled = await db
    .prepare(
      `UPDATE project_config_revisions
          SET status = 'WRITING',
              checksum_algorithm = ?,
              checksum = ?,
              storage_provider = ?,
              storage_ref = ?,
              storage_provider_version = NULL,
              storage_provider_hash = NULL,
              schema_name = ?,
              schema_version = ?,
              size_bytes = ?,
              content_type = ?,
              created_by = ?,
              transition_id = ?,
              attempts = attempts + 1,
              ready_at = NULL,
              published_at = NULL,
              error_code = NULL,
              error_stage = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'FAILED'
          AND published_at IS NULL
        RETURNING *`,
    )
    .bind(
      String(checksumAlgorithm).toLowerCase(),
      String(checksum).toLowerCase(),
      storageProvider,
      storageRef,
      schemaName,
      schemaVersion,
      sizeBytes,
      contentType,
      actorUserId,
      transitionId,
      reclaimable.id,
    )
    .first();

  if (!recycled) {
    return null;
  }

  return {
    revision: recycled,
    project: current,
    idempotent: false,
    retry: true,
    replacedUnpublishedCandidate: true,
    alreadyPublished: false,
  };
}

export async function reserveProjectConfigRevision(
  env,
  {
    projectId,
    organizationId,
    expectedCurrentRevision,
    checksumAlgorithm,
    checksum,
    storageProvider,
    storageRef,
    schemaName,
    schemaVersion,
    sizeBytes,
    contentType,
    actorUserId = null,
    transitionId = null,
    allowedLifecycleStates = [PROJECT_LIFECYCLE_STATES.ACTIVE],
  },
) {
  const db = getDb(env);
  const normalizedProjectId = positiveInteger(projectId, "PROJECT_ID_INVALID");
  const normalizedOrganizationId = positiveInteger(
    organizationId,
    "PROJECT_ORGANIZATION_INVALID",
  );
  const expected = nonNegativeInteger(
    expectedCurrentRevision,
    "PROJECT_CONFIG_EXPECTED_REVISION_INVALID",
  );
  const nextRevision = expected + 1;
  const project = await getProjectForRevision(
    db,
    normalizedProjectId,
    normalizedOrganizationId,
  );

  if (!project) {
    throw revisionError("Projeto não encontrado.", 404, "PROJECT_NOT_FOUND");
  }

  const lifecycleState = normalizeLifecycleState(project.lifecycle_state);
  const allowed = new Set(
    allowedLifecycleStates.map(normalizeLifecycleState).filter(Boolean),
  );
  if (lifecycleState && !allowed.has(lifecycleState)) {
    throw revisionError(
      "O projeto não está em estado compatível com publicação de configuração.",
      409,
      "PROJECT_CONFIG_LIFECYCLE_BLOCKED",
      { lifecycleState, allowedLifecycleStates: Array.from(allowed) },
    );
  }

  const currentRevision = Number(project.config_revision || 0);
  const normalizedChecksum = String(checksum).toLowerCase();

  // Recupera com sucesso quando a publicação N+1 já ocorreu, mas a resposta
  // anterior se perdeu depois do CAS. Conteúdo idêntico já publicado é o
  // resultado desejado e não deve virar falso conflito.
  if (
    currentRevision === nextRevision &&
    String(project.config_checksum || "").toLowerCase() === normalizedChecksum
  ) {
    const publishedLedger = await getProjectConfigRevision(
      env,
      normalizedProjectId,
      nextRevision,
    );
    if (
      publishedLedger?.status === "READY" &&
      String(publishedLedger.checksum || "").toLowerCase() === normalizedChecksum
    ) {
      return {
        revision: publishedLedger,
        project,
        idempotent: true,
        retry: false,
        alreadyPublished: true,
      };
    }
  }

  if (currentRevision !== expected) {
    throw revisionError(
      "O projeto foi alterado por outra operação.",
      409,
      "PROJECT_CONFIG_REVISION_CONFLICT",
      {
        expectedConfigRevision: expected,
        currentConfigRevision: currentRevision,
      },
    );
  }

  const existing = await getProjectConfigRevision(
    env,
    normalizedProjectId,
    nextRevision,
  );

  if (existing) {
    if (
      String(existing.checksum_algorithm).toLowerCase() !==
        String(checksumAlgorithm).toLowerCase() ||
      String(existing.checksum).toLowerCase() !== normalizedChecksum
    ) {
      const recycled = await recycleUnpublishedRevisionCandidate(env, {
        db,
        project,
        existing,
        projectId: normalizedProjectId,
        organizationId: normalizedOrganizationId,
        expected,
        nextRevision,
        checksumAlgorithm,
        checksum: normalizedChecksum,
        storageProvider,
        storageRef,
        schemaName,
        schemaVersion,
        sizeBytes,
        contentType,
        actorUserId,
        transitionId,
      });

      if (recycled) {
        return recycled;
      }

      throw revisionError(
        "A próxima revisão já foi reservada por outro conteúdo.",
        409,
        "PROJECT_CONFIG_REVISION_CONFLICT",
        {
          expectedConfigRevision: expected,
          reservedRevision: nextRevision,
          reservedStatus: existing.status || null,
          unpublishedCandidate: existing.published_at == null,
        },
      );
    }

    if (existing.status === "FAILED") {
      const retried = await db
        .prepare(
          `UPDATE project_config_revisions
            SET status = 'WRITING',
                attempts = attempts + 1,
                transition_id = ?,
                error_code = NULL,
                error_stage = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'FAILED'
          RETURNING *`,
        )
        .bind(transitionId, existing.id)
        .first();
      return {
        revision: retried || existing,
        idempotent: true,
        retry: true,
        alreadyPublished: false,
      };
    }

    return {
      revision: existing,
      idempotent: true,
      retry: false,
      alreadyPublished: false,
    };
  }

  try {
    const created = await db
      .prepare(
        `INSERT INTO project_config_revisions (
         project_id,
         revision,
         status,
         checksum_algorithm,
         checksum,
         storage_provider,
         storage_ref,
         schema_name,
         schema_version,
         size_bytes,
         content_type,
         created_by,
         transition_id
       )
       VALUES (?, ?, 'WRITING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .bind(
        normalizedProjectId,
        nextRevision,
        String(checksumAlgorithm).toLowerCase(),
        normalizedChecksum,
        storageProvider,
        storageRef,
        schemaName,
        schemaVersion,
        sizeBytes,
        contentType,
        actorUserId,
        transitionId,
      )
      .first();

    return {
      revision: created,
      idempotent: false,
      retry: false,
      alreadyPublished: false,
    };
  } catch (error) {
    if (String(error?.message || "").toUpperCase().includes("UNIQUE")) {
      return reserveProjectConfigRevision(env, {
        projectId,
        organizationId,
        expectedCurrentRevision,
        checksumAlgorithm,
        checksum,
        storageProvider,
        storageRef,
        schemaName,
        schemaVersion,
        sizeBytes,
        contentType,
        actorUserId,
        transitionId,
        allowedLifecycleStates,
      });
    }
    throw error;
  }
}

export async function markProjectConfigRevisionReady(
  env,
  {
    projectId,
    revision,
    checksum,
    storageProviderVersion = null,
    storageProviderHash = null,
  },
) {
  const updated = await getDb(env)
    .prepare(
      `UPDATE project_config_revisions
        SET status = 'READY',
            storage_provider_version = ?,
            storage_provider_hash = ?,
            ready_at = COALESCE(ready_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP,
            error_code = NULL,
            error_stage = NULL
      WHERE project_id = ?
        AND revision = ?
        AND checksum = ?
        AND status IN ('WRITING', 'READY')
      RETURNING *`,
    )
    .bind(
      storageProviderVersion,
      storageProviderHash,
      projectId,
      revision,
      String(checksum).toLowerCase(),
    )
    .first();

  if (!updated) {
    throw revisionError(
      "Não foi possível confirmar a revisão armazenada.",
      409,
      "PROJECT_CONFIG_REVISION_READY_CONFLICT",
    );
  }

  return updated;
}

export async function markProjectConfigRevisionFailed(
  env,
  { projectId, revision, errorCode, errorStage },
) {
  return getDb(env)
    .prepare(
      `UPDATE project_config_revisions
        SET status = 'FAILED',
            error_code = ?,
            error_stage = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ?
        AND revision = ?
        AND status <> 'READY'
      RETURNING *`,
    )
    .bind(
      String(errorCode || "PROJECT_CONFIG_REVISION_FAILED").slice(0, 160),
      String(errorStage || "UNKNOWN").slice(0, 120),
      projectId,
      revision,
    )
    .first();
}

export async function publishProjectConfigRevision(
  env,
  {
    projectId,
    organizationId,
    expectedCurrentRevision,
    revision,
    actor,
    markPreviewPending = true,
    expectedLifecycleState = PROJECT_LIFECYCLE_STATES.ACTIVE,
  },
) {
  const db = getDb(env);
  const expected = nonNegativeInteger(
    expectedCurrentRevision,
    "PROJECT_CONFIG_EXPECTED_REVISION_INVALID",
  );
  const normalizedRevision = positiveInteger(
    revision,
    "PROJECT_CONFIG_REVISION_INVALID",
  );
  const lifecycleState = normalizeLifecycleState(expectedLifecycleState);
  if (!lifecycleState) {
    throw revisionError(
      "Lifecycle esperado para publicação inválido.",
      400,
      "PROJECT_CONFIG_LIFECYCLE_EXPECTATION_INVALID",
    );
  }

  const ledger = await getProjectConfigRevision(
    env,
    projectId,
    normalizedRevision,
  );

  if (!ledger || ledger.status !== "READY") {
    throw revisionError(
      "A revisão ainda não está pronta para publicação.",
      409,
      "PROJECT_CONFIG_REVISION_NOT_READY",
    );
  }

  if (normalizedRevision !== expected + 1) {
    throw revisionError(
      "A revisão a publicar não é sucessora da revisão vigente.",
      409,
      "PROJECT_CONFIG_REVISION_SEQUENCE_INVALID",
    );
  }

  const updated = await db
    .prepare(
      `UPDATE projects
        SET config_revision = ?,
            config_checksum = ?,
            config_checksum_algorithm = ?,
            config_storage_provider = ?,
            config_storage_ref = ?,
            config_storage_provider_version = ?,
            config_storage_provider_hash = ?,
            config_schema = ?,
            config_schema_version = ?,
            config_size_bytes = ?,
            config_content_type = ?,
            updated_by = ?,
            updated_by_name_snapshot = ?,
            updated_at = CURRENT_TIMESTAMP,
            preview_status = CASE WHEN ? = 1 THEN 'PENDING' ELSE preview_status END,
            preview_attempts = CASE WHEN ? = 1 THEN 0 ELSE preview_attempts END,
            preview_last_error = CASE WHEN ? = 1 THEN NULL ELSE preview_last_error END,
            preview_capture_method = CASE WHEN ? = 1 THEN NULL ELSE preview_capture_method END
      WHERE id = ?
        AND organization_id = ?
        AND config_revision = ?
        AND lifecycle_state = ?
      RETURNING *`,
    )
    .bind(
      normalizedRevision,
      ledger.checksum,
      ledger.checksum_algorithm,
      ledger.storage_provider,
      ledger.storage_ref,
      ledger.storage_provider_version,
      ledger.storage_provider_hash,
      ledger.schema_name,
      ledger.schema_version,
      ledger.size_bytes,
      ledger.content_type,
      actor?.id ?? null,
      actor?.name ?? "Usuário",
      markPreviewPending ? 1 : 0,
      markPreviewPending ? 1 : 0,
      markPreviewPending ? 1 : 0,
      markPreviewPending ? 1 : 0,
      projectId,
      organizationId,
      expected,
      lifecycleState,
    )
    .first();

  if (!updated) {
    const current = await getProjectForRevision(
      db,
      projectId,
      organizationId,
    );
    throw revisionError(
      "O projeto foi alterado por outra operação.",
      409,
      current?.lifecycle_state !== lifecycleState
        ? "PROJECT_CONFIG_LIFECYCLE_CONFLICT"
        : "PROJECT_CONFIG_REVISION_CONFLICT",
      {
        expectedConfigRevision: expected,
        currentConfigRevision: Number(current?.config_revision || 0),
        expectedLifecycleState: lifecycleState,
        currentLifecycleState: current?.lifecycle_state ?? null,
      },
    );
  }

  // published_at é lineage auxiliar. O ponteiro em projects já é a autoridade;
  // uma indisponibilidade ao carimbar essa metadata não deve converter um save
  // efetivamente publicado em falha. O reconciliador pode reparar o carimbo.
  try {
    await db
      .prepare(
        `UPDATE project_config_revisions
        SET published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      )
      .bind(ledger.id)
      .run();
  } catch (error) {
    console.warn(
      "[Maono lifecycle] Revisão publicada sem carimbo published_at:",
      error?.message || error,
    );
  }

  return updated;
}
