// Read compatibility for both historical revision refs and operation-owned objects.
// Publication lives exclusively in project-save-operations.js.
import { PROJECT_LIFECYCLE_STATES, assertActiveProjectInvariant, isLifecycleManagedProject, publicProjectLifecycle } from "./project-lifecycle.js";
import { verifyProjectConfigBytes } from "./project-config-integrity.js";
import { resolveMapConfigRepository } from "./map-config-repository-factory.js";

function serviceError(message, status, code, details = null) {
  return Object.assign(new Error(message), { status, code, details });
}
function decodeStoredConfig(stored, message) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes);
    return { text, config: JSON.parse(text) };
  } catch (error) {
    throw serviceError(message, 500, "INVALID_PROJECT_CONFIG", { cause: error?.name || "PARSE_ERROR" });
  }
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
