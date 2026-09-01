import {
  PROJECT_LIFECYCLE_STATES,
  assertActiveProjectInvariant,
  isLifecycleManagedProject,
  publicProjectLifecycle,
} from "./project-lifecycle.js";
import {
  buildProjectConfigArtifact,
  buildProjectConfigArtifactFromBytes,
  serializeProjectConfigBytes,
  validateProjectConfig,
  verifyProjectConfigBytes,
} from "./project-config-integrity.js";
import {
  markProjectConfigRevisionFailed,
  markProjectConfigRevisionReady,
  publishProjectConfigRevision,
  reserveProjectConfigRevision,
} from "./project-config-revisions.js";
import { MAP_CONFIG_SAVE_MODES } from "./map-config-repository.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";
import { createMapConfigStorageRef } from "./map-config-storage-ref.js";
import { getSaveTraceForConfig } from "./save-observability.js";

function serviceError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function transitionId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `transition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runObservedStage(trace, stage, work) {
  return trace ? trace.stage(stage, work) : work();
}

function decodeJsonBytes(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { text, config: JSON.parse(text) };
}

function decodeStoredConfig(
  stored,
  message = "A configuração armazenada não contém JSON UTF-8 válido.",
) {
  try {
    return decodeJsonBytes(stored.bytes);
  } catch (error) {
    throw serviceError(message, 500, "INVALID_PROJECT_CONFIG", {
      cause: error?.name || "PARSE_ERROR",
    });
  }
}

function revisionHead(project, artifact, revision) {
  return {
    previousRevision: Math.max(0, Number(revision || 0) - 1),
    currentRevision: Number(revision || 0),
    contentHash: artifact?.checksum || project?.config_checksum || null,
    checksumAlgorithm:
      artifact?.checksumAlgorithm || project?.config_checksum_algorithm || null,
    sizeBytes: Number(artifact?.sizeBytes ?? project?.config_size_bytes ?? 0),
    schema: {
      name: artifact?.schemaName || project?.config_schema || null,
      version: Number(
        artifact?.schemaVersion ?? project?.config_schema_version ?? 0,
      ),
    },
  };
}

function assertPersistedSize(stored, artifact) {
  const actualSizeBytes = Number(stored?.sizeBytes ?? -1);
  if (actualSizeBytes !== Number(artifact.sizeBytes)) {
    throw serviceError(
      "O tamanho da revisão persistida não corresponde ao conteúdo preparado.",
      409,
      "PROJECT_CONFIG_SIZE_MISMATCH",
      {
        expectedSizeBytes: Number(artifact.sizeBytes),
        actualSizeBytes,
      },
    );
  }
}

async function verifyPersistedRevision(
  repository,
  {
    project,
    revision,
    storageRef,
    artifact,
    stored = null,
  },
) {
  if (stored?.contentVerified === true) {
    assertPersistedSize(stored, artifact);
    return {
      persisted: stored,
      verified: {
        checksum: artifact.checksum,
        contentHash: artifact.checksum,
        checksumAlgorithm: artifact.checksumAlgorithm,
        sizeBytes: artifact.sizeBytes,
      },
      verificationMethod: stored.verificationMethod || "repository-attestation",
    };
  }

  const persisted = await repository.getRevision({
    project,
    revision,
    storageRef,
  });
  const verified = await verifyProjectConfigBytes(persisted.bytes, {
    expectedChecksum: artifact.checksum,
    expectedAlgorithm: artifact.checksumAlgorithm,
    expectedSizeBytes: artifact.sizeBytes,
  });
  return {
    persisted,
    verified,
    verificationMethod: "readback-sha256",
  };
}

export async function readPublishedProjectConfig(
  env,
  project,
  { mapConfigRepository = null } = {},
) {
  const repository = resolveMapConfigRepository(env, mapConfigRepository);

  if (!isLifecycleManagedProject(project)) {
    const stored = await repository.load({ project });
    const decoded = decodeStoredConfig(
      stored,
      "O arquivo legado do projeto não contém JSON UTF-8 válido.",
    );
    return { config: decoded.config, lifecycle: null, legacy: true };
  }

  if (project.lifecycle_state !== PROJECT_LIFECYCLE_STATES.ACTIVE) {
    throw serviceError(
      "O projeto ainda não está publicável.",
      409,
      "PROJECT_LIFECYCLE_NOT_ACTIVE",
      { lifecycleState: project.lifecycle_state },
    );
  }

  assertActiveProjectInvariant(project);
  const stored = await repository.getRevision({
    project,
    revision: project.config_revision,
    storageRef: project.config_storage_ref,
  });
  await verifyProjectConfigBytes(stored.bytes, {
    expectedChecksum: project.config_checksum,
    expectedAlgorithm: project.config_checksum_algorithm,
    expectedSizeBytes: project.config_size_bytes,
  });

  const decoded = decodeStoredConfig(
    stored,
    "A revisão publicada não contém JSON UTF-8 válido.",
  );

  return {
    config: decoded.config,
    lifecycle: publicProjectLifecycle(project),
    legacy: false,
  };
}

async function updateLinkedOrganizationFile(env, project, artifact) {
  if (!project.organization_file_id) return null;
  const projectIsActive =
    project.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE;

  try {
    await env.DB.prepare(
      `UPDATE organization_files
          SET size_bytes = ?,
              sha256 = ?,
              is_project = 1,
              active = CASE WHEN ? = 1 THEN 1 ELSE active END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(
        artifact.sizeBytes,
        artifact.checksum,
        projectIsActive ? 1 : 0,
        project.organization_file_id,
      )
      .run();
    return null;
  } catch (error) {
    console.error(
      "[Maono projects] Falha auxiliar ao sincronizar organization_file:",
      {
        projectId: project?.id ?? null,
        organizationFileId: project?.organization_file_id ?? null,
        code: error?.code || "PROJECT_ORGANIZATION_FILE_SYNC_FAILED",
        message: error instanceof Error ? error.message : String(error || ""),
      },
    );
    return {
      stage: "organization_file_sync",
      code: error?.code || "PROJECT_ORGANIZATION_FILE_SYNC_FAILED",
      retryable: true,
    };
  }
}

function legacyCommitNotConfirmed(error) {
  const wrapped = serviceError(
    "O arquivo de configuração foi enviado ao storage, mas a confirmação do estado do projeto não foi concluída.",
    503,
    "PROJECT_CONFIG_COMMIT_NOT_CONFIRMED",
    {
      stage: "project_metadata_commit",
      retryable: true,
      storageWriteCompleted: true,
    },
  );
  wrapped.cause = error;
  return wrapped;
}

export async function saveLegacyProjectConfig(
  env,
  {
    project,
    config,
    actor,
    touchProjectAfterConfigSave,
    mapConfigRepository = null,
  },
) {
  const repository = resolveMapConfigRepository(env, mapConfigRepository);
  const trace = getSaveTraceForConfig(config);
  trace?.updateContext({
    projectId: project?.id ?? null,
    organizationId: project?.organization_id ?? null,
    expectedRevision: Math.max(0, Number(project?.config_revision || 0)),
    candidateRevision: Math.max(1, Number(project?.config_revision || 0) + 1),
    provider: repository.provider,
  });

  const serialized = await runObservedStage(trace, "SERIALIZE", async () =>
    serializeProjectConfigBytes(config),
  );
  const artifact = await runObservedStage(trace, "VALIDATE", async () => {
    validateProjectConfig(config, { bytes: serialized.bytes });
    const built = await buildProjectConfigArtifactFromBytes(serialized.bytes);
    return { text: serialized.text, ...built };
  });
  await runObservedStage(trace, "WRITE", () =>
    repository.saveRevision({
      project,
      revision: Math.max(1, Number(project.config_revision || 0) + 1),
      bytes: artifact.bytes,
      contentType: artifact.contentType,
      mode: MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE,
    }),
  );
  const organizationFileWarning = await updateLinkedOrganizationFile(
    env,
    project,
    artifact,
  );

  let updatedProject;
  try {
    updatedProject = await runObservedStage(trace, "PUBLISH", () =>
      touchProjectAfterConfigSave(env, {
        projectId: project.id,
        organizationId: project.organization_id,
        actor,
      }),
    );
  } catch (error) {
    throw legacyCommitNotConfirmed(error);
  }

  const revision = Number(updatedProject?.config_revision || 0);
  return {
    project: updatedProject,
    revision,
    revisionHead: revisionHead(updatedProject, artifact, revision),
    artifact,
    legacy: true,
    auxiliaryWarnings: organizationFileWarning
      ? [organizationFileWarning]
      : [],
  };
}

export async function saveVersionedProjectConfig(
  env,
  {
    project,
    config,
    expectedConfigRevision,
    actor,
    allowedLifecycleStates = [PROJECT_LIFECYCLE_STATES.ACTIVE],
    markPreviewPending = true,
    mapConfigRepository = null,
  },
) {
  const repository = resolveMapConfigRepository(env, mapConfigRepository);
  const trace = getSaveTraceForConfig(config);
  const expected = Number(expectedConfigRevision);
  trace?.updateContext({
    projectId: project?.id ?? null,
    organizationId: project?.organization_id ?? null,
    expectedRevision: expected,
    provider: repository.provider,
  });
  if (!Number.isInteger(expected) || expected < 0) {
    throw serviceError(
      "Informe a revisão de configuração que está sendo editada.",
      400,
      "PROJECT_CONFIG_EXPECTED_REVISION_REQUIRED",
    );
  }

  const expectedLifecycleState = allowedLifecycleStates[0];
  if (!expectedLifecycleState) {
    throw serviceError(
      "Lifecycle esperado para publicação não informado.",
      500,
      "PROJECT_CONFIG_LIFECYCLE_EXPECTATION_MISSING",
    );
  }

  let stage = "SERIALIZE";
  const serialized = await runObservedStage(trace, "SERIALIZE", async () =>
    serializeProjectConfigBytes(config),
  );
  stage = "VALIDATE";
  const artifact = await runObservedStage(trace, "VALIDATE", async () => {
    validateProjectConfig(config, { bytes: serialized.bytes });
    return buildProjectConfigArtifactFromBytes(serialized.bytes);
  });

  const nextRevision = expected + 1;
  trace?.updateContext({ candidateRevision: nextRevision });
  const id = transitionId();
  const storageRef = createMapConfigStorageRef(project.id, nextRevision);
  const storageProvider = repository.provider;
  let reservation = null;
  let publicationCompleted = false;

  try {
    stage = "RESERVE";
    reservation = await runObservedStage(trace, "RESERVE", () =>
      reserveProjectConfigRevision(env, {
        projectId: project.id,
        organizationId: project.organization_id,
        expectedCurrentRevision: expected,
        checksumAlgorithm: artifact.checksumAlgorithm,
        checksum: artifact.checksum,
        storageProvider,
        storageRef,
        schemaName: artifact.schemaName,
        schemaVersion: artifact.schemaVersion,
        sizeBytes: artifact.sizeBytes,
        contentType: artifact.contentType,
        actorUserId: actor?.id ?? null,
        transitionId: id,
        allowedLifecycleStates,
      }),
    );

    publicationCompleted = Boolean(reservation.alreadyPublished);

    if (reservation.alreadyPublished) {
      stage = "WRITE";
      const stored = await runObservedStage(trace, "WRITE", () =>
        repository.saveRevision({
          project: reservation.project,
          revision: nextRevision,
          storageRef,
          bytes: artifact.bytes,
          contentType: artifact.contentType,
          mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
        }),
      );
      stage = "VERIFY";
      await runObservedStage(trace, "VERIFY", () =>
        verifyPersistedRevision(repository, {
          project: reservation.project,
          revision: nextRevision,
          storageRef,
          artifact,
          stored,
        }),
      );
      const recoveredProject = reservation.project;
      const organizationFileWarning = await updateLinkedOrganizationFile(
        env,
        recoveredProject,
        artifact,
      );
      return {
        project: recoveredProject,
        revision: nextRevision,
        revisionHead: revisionHead(recoveredProject, artifact, nextRevision),
        artifact,
        ledger: reservation.revision,
        transitionId: id,
        legacy: false,
        idempotent: true,
        auxiliaryWarnings: organizationFileWarning
          ? [organizationFileWarning]
          : [],
      };
    }

    let ready = reservation.revision;

    stage = "WRITE";
    const stored = await runObservedStage(trace, "WRITE", () =>
      repository.saveRevision({
        project,
        revision: nextRevision,
        storageRef,
        bytes: artifact.bytes,
        contentType: artifact.contentType,
        mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
      }),
    );

    stage = "VERIFY";
    await runObservedStage(trace, "VERIFY", () =>
      verifyPersistedRevision(repository, {
        project,
        revision: nextRevision,
        storageRef,
        artifact,
        stored,
      }),
    );

    if (ready.status !== "READY") {
      stage = "READY";
      ready = await runObservedStage(trace, "READY", async () => {
        let providerVersion = stored.providerVersion ?? null;
        let providerHash = stored.providerHash ?? null;
        if (!providerVersion && !providerHash) {
          const metadata = await repository.getMetadata({
            project,
            revision: nextRevision,
            storageRef,
            mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
          });
          providerVersion = metadata?.providerVersion ?? null;
          providerHash = metadata?.providerHash ?? null;
        }

        return markProjectConfigRevisionReady(env, {
          projectId: project.id,
          revision: nextRevision,
          checksum: artifact.checksum,
          storageProviderVersion: providerVersion,
          storageProviderHash: providerHash,
        });
      });
    }

    stage = "PUBLISH";
    const updatedProject = await runObservedStage(trace, "PUBLISH", () =>
      publishProjectConfigRevision(env, {
        projectId: project.id,
        organizationId: project.organization_id,
        expectedCurrentRevision: expected,
        revision: nextRevision,
        actor,
        markPreviewPending,
        expectedLifecycleState,
      }),
    );
    publicationCompleted = true;

    const organizationFileWarning = await updateLinkedOrganizationFile(
      env,
      updatedProject,
      artifact,
    );

    return {
      project: updatedProject,
      revision: nextRevision,
      revisionHead: revisionHead(updatedProject, artifact, nextRevision),
      artifact,
      ledger: ready,
      transitionId: id,
      legacy: false,
      idempotent: Boolean(reservation.idempotent || stored.idempotent),
      auxiliaryWarnings: organizationFileWarning
        ? [organizationFileWarning]
        : [],
    };
  } catch (error) {
    if (
      reservation &&
      !publicationCompleted &&
      error?.code !== "PROJECT_CONFIG_REVISION_CONFLICT" &&
      error?.code !== "PROJECT_CONFIG_LIFECYCLE_CONFLICT"
    ) {
      await markProjectConfigRevisionFailed(env, {
        projectId: project.id,
        revision: nextRevision,
        errorCode: error?.code || "PROJECT_CONFIG_REVISION_FAILED",
        errorStage: stage,
      }).catch(() => null);
    }
    if (!error.details) error.details = {};
    if (!error.details.stage) error.details.stage = stage;
    throw error;
  }
}

export async function saveProjectConfig(
  env,
  {
    project,
    config,
    expectedConfigRevision,
    actor,
    touchProjectAfterConfigSave,
    mapConfigRepository = null,
  },
) {
  if (!isLifecycleManagedProject(project)) {
    return saveLegacyProjectConfig(env, {
      project,
      config,
      actor,
      touchProjectAfterConfigSave,
      mapConfigRepository,
    });
  }

  if (project.lifecycle_state !== PROJECT_LIFECYCLE_STATES.ACTIVE) {
    throw serviceError(
      "Somente projetos ACTIVE podem publicar uma nova revisão.",
      409,
      "PROJECT_CONFIG_LIFECYCLE_BLOCKED",
      { lifecycleState: project.lifecycle_state },
    );
  }

  return saveVersionedProjectConfig(env, {
    project,
    config,
    expectedConfigRevision,
    actor,
    allowedLifecycleStates: [PROJECT_LIFECYCLE_STATES.ACTIVE],
    markPreviewPending: true,
    mapConfigRepository,
  });
}
