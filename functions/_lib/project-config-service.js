import { downloadDropboxTextFile, uploadDropboxTextFile } from "./dropbox.js";
import {
  PROJECT_LIFECYCLE_STATES,
  assertActiveProjectInvariant,
  isLifecycleManagedProject,
  isProjectLifecycleEnabled,
  publicProjectLifecycle,
} from "./project-lifecycle.js";
import {
  buildProjectConfigArtifact,
  verifyProjectConfigBytes,
} from "./project-config-integrity.js";
import {
  createProjectConfigStorageRef,
  getProjectConfigStorageProvider,
  putProjectConfigRevision,
  readProjectConfigRevision,
} from "./project-config-repository.js";
import {
  markProjectConfigRevisionFailed,
  markProjectConfigRevisionReady,
  publishProjectConfigRevision,
  reserveProjectConfigRevision,
} from "./project-config-revisions.js";

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

export async function readPublishedProjectConfig(env, project) {
  if (!isProjectLifecycleEnabled(env) || !isLifecycleManagedProject(project, env)) {
    const fileName = project.default_config_file || "config.kepler.json";
    const text = await downloadDropboxTextFile(env, project.dropbox_root_path, fileName);
    return { config: JSON.parse(text), lifecycle: null, legacy: true };
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
  const stored = await readProjectConfigRevision(env, {
    project,
    revision: project.config_revision,
    storageRef: project.config_storage_ref,
  });
  await verifyProjectConfigBytes(stored.bytes, {
    expectedChecksum: project.config_checksum,
    expectedAlgorithm: project.config_checksum_algorithm,
  });

  let decoded;
  try {
    decoded = decodeJsonBytes(stored.bytes);
  } catch (error) {
    throw serviceError(
      "A revisão publicada não contém JSON UTF-8 válido.",
      500,
      "INVALID_PROJECT_CONFIG",
      { cause: error?.name || "PARSE_ERROR" },
    );
  }

  return {
    config: decoded.config,
    lifecycle: publicProjectLifecycle(project),
    legacy: false,
  };
}

async function updateLinkedOrganizationFile(env, project, artifact) {
  if (!project.organization_file_id) return;
  const projectIsActive = project.lifecycle_state === PROJECT_LIFECYCLE_STATES.ACTIVE;
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
}

export async function saveLegacyProjectConfig(
  env,
  { project, config, actor, touchProjectAfterConfigSave },
) {
  const artifact = await buildProjectConfigArtifact(config);
  await uploadDropboxTextFile(
    env,
    project.dropbox_root_path,
    project.default_config_file || "config.kepler.json",
    artifact.text,
  );
  await updateLinkedOrganizationFile(env, project, artifact);
  const updatedProject = await touchProjectAfterConfigSave(env, {
    projectId: project.id,
    organizationId: project.organization_id,
    actor,
  });
  return {
    project: updatedProject,
    revision: Number(updatedProject?.config_revision || 0),
    artifact,
    legacy: true,
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
  },
) {
  const expected = Number(expectedConfigRevision);
  if (!Number.isInteger(expected) || expected < 0) {
    throw serviceError(
      "Informe a revisão de configuração que está sendo editada.",
      400,
      "PROJECT_CONFIG_EXPECTED_REVISION_REQUIRED",
    );
  }

  const artifact = await buildProjectConfigArtifact(config);
  const nextRevision = expected + 1;
  const id = transitionId();
  const storageRef = createProjectConfigStorageRef(project.id, nextRevision);
  const storageProvider = getProjectConfigStorageProvider(env);
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

  try {
    let ready = reservation.revision;

    if (ready.status !== "READY") {
      const stored = await putProjectConfigRevision(env, {
        project,
        revision: nextRevision,
        storageRef,
        bytes: artifact.bytes,
        contentType: artifact.contentType,
      });
      ready = await markProjectConfigRevisionReady(env, {
        projectId: project.id,
        revision: nextRevision,
        checksum: artifact.checksum,
        storageProviderVersion: stored.providerVersion,
        storageProviderHash: stored.providerHash,
      });
    } else {
      const stored = await readProjectConfigRevision(env, {
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
    });
    await updateLinkedOrganizationFile(env, updatedProject, artifact);

    return {
      project: updatedProject,
      revision: nextRevision,
      artifact,
      ledger: ready,
      transitionId: id,
      legacy: false,
    };
  } catch (error) {
    if (
      error?.code !== "PROJECT_CONFIG_REVISION_CONFLICT" &&
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
  { project, config, expectedConfigRevision, actor, touchProjectAfterConfigSave },
) {
  if (!isProjectLifecycleEnabled(env) || !isLifecycleManagedProject(project, env)) {
    return saveLegacyProjectConfig(env, {
      project,
      config,
      actor,
      touchProjectAfterConfigSave,
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
  });
}
