import { getDropboxClient } from "./dropbox-client.js";
import { joinDropboxPath } from "./dropbox.js";
import {
  assertMapConfigStorageRef,
  getMapConfigRevisionFileName,
} from "./map-config-storage-ref.js";

const DROPBOX_TEMPORARY_LINK_URL =
  "https://api.dropboxapi.com/2/files/get_temporary_link";

function deliveryError(message, status, code, details = null) {
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

function normalizedHash(value) {
  return String(value || "").trim().toLowerCase();
}

function assertLedger(project, ledger, revision) {
  const projectId = positiveInteger(project?.id);
  const expectedRevision = positiveInteger(revision);
  if (!projectId || !expectedRevision) {
    throw deliveryError(
      "Projeto/revisão inválidos para entrega direta.",
      400,
      "PROJECT_CONFIG_DIRECT_REVISION_INVALID",
    );
  }
  if (!ledger || ledger.status !== "READY") {
    throw deliveryError(
      "A revisão-base não está disponível para entrega direta.",
      409,
      "CHANGE_REQUEST_BASE_REVISION_UNAVAILABLE",
      { baseRevision: expectedRevision },
    );
  }
  if (String(ledger.storage_provider || "").trim().toLowerCase() !== "dropbox") {
    throw deliveryError(
      "O storage da revisão não suporta entrega direta.",
      409,
      "PROJECT_CONFIG_DIRECT_PROVIDER_UNSUPPORTED",
    );
  }
  assertMapConfigStorageRef(ledger.storage_ref, projectId, expectedRevision);
  return { projectId, revision: expectedRevision };
}

export async function createProjectConfigRevisionDirectDescriptor(
  env,
  { project, ledger, revision, correlationId = null },
) {
  const identity = assertLedger(project, ledger, revision);
  const rootPath = String(project?.dropbox_root_path || "").trim();
  if (!rootPath) {
    throw deliveryError(
      "Storage do projeto não configurado.",
      409,
      "PROJECT_CONFIG_DIRECT_STORAGE_NOT_CONFIGURED",
    );
  }

  const fileName = getMapConfigRevisionFileName(
    project?.default_config_file || "config.kepler.json",
    identity.revision,
  );
  const path = joinDropboxPath(rootPath, fileName);
  const client = getDropboxClient(env);
  const response = await client.request({
    operation: "files.get_temporary_link",
    url: DROPBOX_TEMPORARY_LINK_URL,
    timeoutMs: 5_000,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw deliveryError(
      "Não foi possível preparar o download direto da revisão-base.",
      response.status >= 500 ? 503 : response.status,
      text.includes("path/not_found")
        ? "CHANGE_REQUEST_BASE_REVISION_STORAGE_MISSING"
        : "PROJECT_CONFIG_DIRECT_DESCRIPTOR_FAILED",
      { baseRevision: identity.revision },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw deliveryError(
      "O storage retornou um descriptor de revisão inválido.",
      502,
      "PROJECT_CONFIG_DIRECT_DESCRIPTOR_INVALID",
    );
  }

  const downloadUrl = String(payload?.link || "").trim();
  const metadata = payload?.metadata || null;
  let validUrl = false;
  try {
    validUrl = new URL(downloadUrl).protocol === "https:";
  } catch {
    validUrl = false;
  }
  if (!validUrl) {
    throw deliveryError(
      "O storage não retornou uma URL temporária válida.",
      502,
      "PROJECT_CONFIG_DIRECT_DESCRIPTOR_INVALID",
    );
  }

  const expectedSizeBytes = positiveInteger(ledger.size_bytes);
  const actualSizeBytes = positiveInteger(metadata?.size);
  if (
    expectedSizeBytes &&
    actualSizeBytes &&
    expectedSizeBytes !== actualSizeBytes
  ) {
    throw deliveryError(
      "O tamanho da revisão-base diverge do ledger publicado.",
      409,
      "PROJECT_CONFIG_SIZE_MISMATCH",
      {
        expectedSizeBytes,
        actualSizeBytes,
        baseRevision: identity.revision,
      },
    );
  }

  const expectedProviderHash = normalizedHash(ledger.storage_provider_hash);
  const actualProviderHash = normalizedHash(
    metadata?.content_hash ?? metadata?.contentHash,
  );
  if (
    expectedProviderHash &&
    actualProviderHash &&
    expectedProviderHash !== actualProviderHash
  ) {
    throw deliveryError(
      "O storage não confirmou a integridade da revisão-base.",
      409,
      "PROJECT_CONFIG_STORAGE_INTEGRITY_MISMATCH",
      { baseRevision: identity.revision },
    );
  }

  return {
    transport: "direct",
    downloadUrl,
    projectId: identity.projectId,
    revision: identity.revision,
    sizeBytes: actualSizeBytes || expectedSizeBytes || 0,
    schemaName: String(ledger.schema_name || "legacy-kepler"),
    schemaVersion: Number(ledger.schema_version || 1),
    correlationId: correlationId || null,
  };
}
