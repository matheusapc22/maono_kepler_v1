import {
  buildProjectConfigArtifactFromBytes,
  verifyProjectConfigBytes,
} from "./project-config-integrity.js";
import { MAP_CONFIG_SAVE_MODES } from "./map-config-repository.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import { createMapConfigStorageRef } from "./map-config-storage-ref.js";

function reconcileError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function validateLegacyConfig(bytes) {
  let config;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    config = JSON.parse(text);
  } catch {
    throw reconcileError(
      "O config legado não contém JSON UTF-8 válido.",
      409,
      "LEGACY_PROJECT_CONFIG_INVALID",
    );
  }

  if (
    !config ||
    typeof config !== "object" ||
    !config.version ||
    !config.config ||
    typeof config.config !== "object" ||
    !Array.isArray(config.datasets)
  ) {
    throw reconcileError(
      "O config legado não satisfaz o contrato Kepler esperado.",
      409,
      "LEGACY_PROJECT_CONFIG_SCHEMA_INVALID",
    );
  }
  return config;
}

async function existingLedger(env, projectId, revision) {
  return env.DB.prepare(
    `SELECT * FROM project_config_revisions
      WHERE project_id = ? AND revision = ?
      LIMIT 1`,
  )
    .bind(projectId, revision)
    .first();
}

export async function reconcileLegacyProjectLifecycle(
  env,
  project,
  {
    actorUserId = null,
    transitionId = null,
    mapConfigRepository = null,
  } = {},
) {
  if (!project?.id || !project?.organization_id) {
    throw reconcileError("Projeto legado inválido.", 400, "LEGACY_PROJECT_INVALID");
  }
  if (project.lifecycle_state) {
    return { project, idempotent: true, skipped: true };
  }
  if (!(project.active === 1 || project.active === true)) {
    throw reconcileError(
      "Projeto inativo não pode ser classificado automaticamente.",
      409,
      "LEGACY_INACTIVE_PROJECT_UNRESOLVED",
    );
  }

  const repository = resolveMapConfigRepository(env, mapConfigRepository);
  const legacyStored = await repository.load({ project });
  const bytes = legacyStored.bytes;
  validateLegacyConfig(bytes);
  const artifact = await buildProjectConfigArtifactFromBytes(bytes);
  const revision = Math.max(1, Number(project.config_revision || 0));
  const storageRef = createMapConfigStorageRef(project.id, revision);
  const provider = repository.provider;
  const existing = await existingLedger(env, project.id, revision);

  if (existing) {
    if (
      String(existing.checksum_algorithm).toLowerCase() !== artifact.checksumAlgorithm ||
      String(existing.checksum).toLowerCase() !== artifact.checksum ||
      String(existing.storage_ref) !== storageRef
    ) {
      throw reconcileError(
        "O ledger existente diverge do objeto legado atual.",
        409,
        "LEGACY_PROJECT_REVISION_CONFLICT",
        { projectId: project.id, revision },
      );
    }
  }

  let providerMetadata;
  if (existing?.status === "READY") {
    try {
      const stored = await repository.getRevision({
        project,
        revision,
        storageRef,
      });
      await verifyProjectConfigBytes(stored.bytes, {
        expectedChecksum: artifact.checksum,
        expectedAlgorithm: artifact.checksumAlgorithm,
      });
      providerMetadata = {
        provider,
        providerVersion: existing.storage_provider_version,
        providerHash: existing.storage_provider_hash,
      };
    } catch {
      providerMetadata = await repository.saveRevision({
        project,
        revision,
        storageRef,
        bytes: artifact.bytes,
        contentType: artifact.contentType,
        mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
      });
    }
  } else {
    providerMetadata = await repository.saveRevision({
      project,
      revision,
      storageRef,
      bytes: artifact.bytes,
      contentType: artifact.contentType,
      mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
    });
  }

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO project_config_revisions (
         project_id, revision, status,
         checksum_algorithm, checksum,
         storage_provider, storage_ref,
         storage_provider_version, storage_provider_hash,
         schema_name, schema_version,
         size_bytes, content_type,
         created_by, transition_id,
         ready_at, published_at
       )
       VALUES (?, ?, 'READY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
      .bind(
        project.id,
        revision,
        artifact.checksumAlgorithm,
        artifact.checksum,
        provider,
        storageRef,
        providerMetadata?.providerVersion ?? null,
        providerMetadata?.providerHash ?? null,
        artifact.schemaName,
        artifact.schemaVersion,
        artifact.sizeBytes,
        artifact.contentType,
        actorUserId,
        transitionId,
      )
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE project_config_revisions
          SET status = 'READY',
              storage_provider_version = COALESCE(?, storage_provider_version),
              storage_provider_hash = COALESCE(?, storage_provider_hash),
              ready_at = COALESCE(ready_at, CURRENT_TIMESTAMP),
              published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP,
              error_code = NULL,
              error_stage = NULL
        WHERE id = ?`,
    )
      .bind(
        providerMetadata?.providerVersion ?? null,
        providerMetadata?.providerHash ?? null,
        existing.id,
      )
      .run();
  }

  const updated = await env.DB.prepare(
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
            lifecycle_state = 'ACTIVE',
            lifecycle_version = CASE
              WHEN lifecycle_version < 1 THEN 1
              ELSE lifecycle_version + 1
            END,
            lifecycle_updated_at = CURRENT_TIMESTAMP,
            lifecycle_transition_id = ?,
            lifecycle_failure_stage = NULL,
            lifecycle_failure_code = NULL,
            lifecycle_failure_at = NULL,
            lifecycle_retryable = NULL,
            active = 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND organization_id = ?
        AND lifecycle_state IS NULL
        AND active = 1
      RETURNING *`,
  )
    .bind(
      revision,
      artifact.checksum,
      artifact.checksumAlgorithm,
      provider,
      storageRef,
      providerMetadata?.providerVersion ?? null,
      providerMetadata?.providerHash ?? null,
      artifact.schemaName,
      artifact.schemaVersion,
      artifact.sizeBytes,
      artifact.contentType,
      transitionId,
      project.id,
      project.organization_id,
    )
    .first();

  const reconciled = updated || await env.DB.prepare(
    `SELECT * FROM projects WHERE id = ? LIMIT 1`,
  )
    .bind(project.id)
    .first();

  if (project.organization_file_id) {
    await env.DB.prepare(
      `UPDATE organization_files
          SET size_bytes = ?,
              sha256 = ?,
              active = 1,
              status = CASE WHEN status = 'ERROR' THEN 'ACTIVE' ELSE status END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(artifact.sizeBytes, artifact.checksum, project.organization_file_id)
      .run();
  }

  return {
    project: reconciled,
    revision,
    checksum: artifact.checksum,
    sizeBytes: artifact.sizeBytes,
    idempotent: Boolean(existing),
    skipped: false,
  };
}
