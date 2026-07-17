import {
  ensureDropboxFolder,
  normalizeDropboxFolderPath,
} from "./dropbox.js";
import {
  getDb,
  getTableColumns,
  updateRow,
} from "./organizations.js";

const PROJECTS_ROOT = "/projects";
const DOCUMENTS_FOLDER = "documents";
const MAX_REPAIR_BATCH = 500;

function nowIso() {
  return new Date().toISOString();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isActiveOrganization(organization) {
  return !(
    organization?.active === 0 ||
    organization?.active === "0" ||
    organization?.active === false
  );
}

function storageError(message, status, code, stage, cause = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.stage = stage;
  error.publicMessage = message;
  if (cause) error.cause = cause;
  return error;
}

export async function ensureOrganizationStorageSchema(env) {
  const columns = await getTableColumns(env, "organizations");

  if (!columns.has("dropbox_root_path")) {
    throw storageError(
      "A migration de armazenamento das organizações ainda não foi aplicada.",
      500,
      "ORGANIZATION_STORAGE_SCHEMA_OUTDATED",
      "organization.storage.schema",
    );
  }

  return columns;
}

export function canonicalOrganizationRoot(organization) {
  const configured = normalizeDropboxFolderPath(
    organization?.dropbox_root_path,
  );

  if (
    configured &&
    configured !== PROJECTS_ROOT &&
    configured.startsWith(`${PROJECTS_ROOT}/`)
  ) {
    return configured;
  }

  const slug =
    normalizeSlug(organization?.slug) ||
    normalizeSlug(organization?.name) ||
    `organization-${organization?.id || "unknown"}`;

  return `${PROJECTS_ROOT}/${slug}`;
}

export function organizationDocumentsRoot(organization) {
  return `${canonicalOrganizationRoot(organization)}/${DOCUMENTS_FOLDER}`;
}

async function persistStorageState(env, organizationId, data) {
  await ensureOrganizationStorageSchema(env);

  return updateRow(env, "organizations", organizationId, {
    dropbox_root_path: data.rootPath,
    storage_status: data.status,
    storage_error: data.error || null,
    storage_checked_at: data.checkedAt || nowIso(),
    updated_at: nowIso(),
  });
}

export async function ensureOrganizationStorage(
  env,
  organization,
  { provisionDocuments = true } = {},
) {
  if (!organization?.id) {
    throw storageError(
      "Organização inválida para provisionamento de armazenamento.",
      500,
      "ORGANIZATION_STORAGE_CONTEXT_INVALID",
      "organization.storage.context",
    );
  }

  await ensureOrganizationStorageSchema(env);

  const rootPath = canonicalOrganizationRoot(organization);
  const documentsRoot = `${rootPath}/${DOCUMENTS_FOLDER}`;
  const configuredPath = normalizeDropboxFolderPath(
    organization.dropbox_root_path,
  );
  const repairedPath = configuredPath !== rootPath;

  if (!isActiveOrganization(organization)) {
    const updated = await persistStorageState(env, organization.id, {
      rootPath,
      status: "DISABLED",
      error: null,
    });

    return {
      organization: updated || {
        ...organization,
        dropbox_root_path: rootPath,
        storage_status: "DISABLED",
      },
      rootPath,
      documentsRoot,
      ready: false,
      repairedPath,
    };
  }

  await persistStorageState(env, organization.id, {
    rootPath,
    status: "PENDING",
    error: null,
  });

  try {
    await ensureDropboxFolder(
      env,
      provisionDocuments ? documentsRoot : rootPath,
    );

    const updated = await persistStorageState(env, organization.id, {
      rootPath,
      status: "READY",
      error: null,
    });

    return {
      organization: updated || {
        ...organization,
        dropbox_root_path: rootPath,
        storage_status: "READY",
        storage_error: null,
        storage_checked_at: nowIso(),
      },
      rootPath,
      documentsRoot,
      ready: true,
      repairedPath,
    };
  } catch (cause) {
    const technicalMessage = String(
      cause?.message || "Falha desconhecida ao provisionar o Dropbox.",
    ).slice(0, 1000);

    try {
      await persistStorageState(env, organization.id, {
        rootPath,
        status: "ERROR",
        error: technicalMessage,
      });
    } catch (metadataError) {
      console.error(
        `[Maono organization storage][${organization.id}][metadata]`,
        metadataError,
      );
    }

    throw storageError(
      "Não foi possível criar ou validar a pasta Dropbox da organização.",
      502,
      "ORGANIZATION_STORAGE_PROVISION_FAILED",
      "organization.storage.provision",
      cause,
    );
  }
}

export function publicOrganizationStorage(result) {
  const organization = result?.organization || {};

  return {
    status: organization.storage_status || (result?.ready ? "READY" : "PENDING"),
    ready: Boolean(result?.ready),
    repaired: Boolean(result?.repairedPath),
    checkedAt: organization.storage_checked_at || null,
  };
}

export async function repairActiveOrganizationStorages(
  env,
  { limit = 100 } = {},
) {
  await ensureOrganizationStorageSchema(env);

  const numericLimit = Number(limit);
  const safeLimit = Math.max(
    1,
    Math.min(Number.isInteger(numericLimit) ? numericLimit : 100, MAX_REPAIR_BATCH),
  );

  const result = await getDb(env)
    .prepare(
      `SELECT *
       FROM organizations
       WHERE active = 1
       ORDER BY id ASC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all();

  const repaired = [];
  const failed = [];

  for (const organization of result?.results || []) {
    try {
      const storage = await ensureOrganizationStorage(env, organization);
      repaired.push({
        organizationId: organization.id,
        status: "READY",
        repairedPath: storage.repairedPath,
      });
    } catch (error) {
      failed.push({
        organizationId: organization.id,
        status: "ERROR",
        code: error?.code || "ORGANIZATION_STORAGE_PROVISION_FAILED",
        stage: error?.stage || "organization.storage.provision",
      });
    }
  }

  return {
    checked: repaired.length + failed.length,
    ready: repaired.length,
    failed: failed.length,
    organizations: [...repaired, ...failed],
  };
}
