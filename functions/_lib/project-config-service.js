import {
  PROJECT_LIFECYCLE_STATES,
  assertActiveProjectInvariant,
  isLifecycleManagedProject,
  publicProjectLifecycle,
} from "./project-lifecycle.js";
import {
  buildProjectConfigArtifact,
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

function decodeJsonBytes(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { text, config: JSON.parse(text) };
}

function decodeStoredConfig(stored, message = "A configuração armazenada não contém JSON UTF-8 válido.") {
  try {
    return decodeJsonBytes(stored.bytes);
  } catch (error) {
    throw serviceError(message, 500, "INVALID_PROJECT_CONFIG", {
      cause: error?.name || "PARSE_ERROR",
    });
  }
}

export async function readPublishedProjectConfig(
  env,
  project,
  { mapConfigRepository = null } = {},
) {
  const repository = resolveMapConfigRepository(env, mapConfigRepository);

  // lifecycle_state não nulo é uma fronteira irreversível do rollout: uma vez
  // reconciliado/criado pela S03, o projeto nunca volta a ler o alias legado.
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
    // organization_files é projeção auxiliar. O config/revision pointer é a
    // autoridade e um erro nesta sincronização não pode transformar um save
    // já persistido/publicado em falso 500 para o usuário.
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
  const artifact = await buildProjectConfigArtifact(config);
  await repository.saveRevision({
    project,
    revision: Math.max(1, Number(project.config_revision || 0) + 1),
    bytes: artifact.bytes,
    contentType: artifact.contentType,
    mode: MAP_CONFIG_SAVE_MODES.LEGACY_OVERWRITE,
  });
  const organizationFileWarning = await updateLinkedOrganizationFile(
    env,
    project,
    artifact,
  );

  let updatedProject;
  try {
    updatedProject = await touchProjectAfterConfigSave(env, {
      projectId: project.id,
      organizationId: project.organization_id,
      actor,
    });
  } catch (error) {
    throw legacyCommitNotConfirmed(error);
  }

  return {
    project: updatedProject,
    revision: Number(updatedProject?.config_revision || 0),
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
  const expected = Number(expectedConfigRevision);
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

  const artifact = await buildProjectConfigArtifact(config);
  const nextRevision = expected + 1;
  const id = transitionId();
  const storageRef = createMapConfigStorageRef(project.id, nextRevision);
  const storageProvider = repository.provider;
  const reservation = await reserveProjectConfigRevision(env, {
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
  });

  let publicationCompleted = Boolean(reservation.alreadyPublished);

  try {
    if (reservation.alreadyPublished) {
      const recoveredProject = reservation.project;
      const organizationFileWarning = await updateLinkedOrganizationFile(
        env,
        recoveredProject,
        artifact,
      );
      return {
        project: recoveredProject,
        revision: nextRevision,
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

    if (ready.status !== "READY") {
      const stored = await repository.saveRevision({
        project,
        revision: nextRevision,
        storageRef,
        bytes: artifact.bytes,
        contentType: artifact.contentType,
        mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
      });
      ready = await markProjectConfigRevisionReady(env, {
        projectId: project.id,
        revision: nextRevision,
        checksum: artifact.checksum,
        storageProviderVersion: stored.providerVersion,
        storageProviderHash: stored.providerHash,
      });
    } else {
      const stored = await repository.getRevision({
        project,
        revision: nextRevision,
        storageRef,
      });
      await verifyProjectConfigBytes(stored.bytes, {
        expectedChecksum: artifact.checksum,
        expectedAlgorithm: artifact.checksumAlgorithm,
      });
    }

    const updatedProject = await publishProjectConfigRevision(env, {
      projectId: project.id,
      organizationId: project.organization_id,
      expectedCurrentRevision: expected,
      revision: nextRevision,
      actor,
      markPreviewPending,
      expectedLifecycleState,
    });
    publicationCompleted = true;
    const organizationFileWarning = await updateLinkedOrganizationFile(
      env,
      updatedProject,
      artifact,
    );

    return {
      project: updatedProject,
      revision: nextRevision,
      artifact,
      ledger: ready,
      transitionId: id,
      legacy: false,
      idempotent: Boolean(reservation.idempotent),
      auxiliaryWarnings: organizationFileWarning
        ? [organizationFileWarning]
        : [],
    };
  } catch (error) {
    if (
      !publicationCompleted &&
      error?.code !== "PROJECT_CONFIG_REVISION_CONFLICT" &&
      error?.code !== "PROJECT_CONFIG_LIFECYCLE_CONFLICT" &&
      error?.code !== "PROJECT_CONFIG_INTEGRITY_MISMATCH"
    ) {
      await markProjectConfigRevisionFailed(env, {
        projectId: project.id,
        revision: nextRevision,
        errorCode: error?.code || "PROJECT_CONFIG_REVISION_FAILED",
        errorStage: "STORAGE_OR_PUBLICATION",
      }).catch(() => null);
    }
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
