import {
  listDropboxFolderAll,
  normalizeDropboxFolderPath,
} from "./dropbox.js";
import { createCorrelationId } from "./maono-error.js";
import {
  canonicalOrganizationRoot,
  ensureOrganizationStorage,
  ensureOrganizationStorageSchema,
  ORGANIZATION_STORAGE_STATUS,
} from "./organization-storage.js";
import { normalizeOrganizationSlug } from "./organization-lifecycle.js";
import { getDb } from "./organizations.js";

export const ORGANIZATION_STORAGE_DRIFT_CODE = Object.freeze({
  PATH_INVALID: "ORGANIZATION_PATH_INVALID",
  PATH_LEGACY: "ORGANIZATION_PATH_LEGACY",
  READY_MISSING_PHYSICAL: "READY_MISSING_PHYSICAL_FOLDER",
  MISSING_PHYSICAL: "MISSING_PHYSICAL_FOLDER",
  PHYSICAL_PRESENT_NOT_READY: "PHYSICAL_PRESENT_STORAGE_NOT_READY",
  READY_WITH_ERROR: "READY_WITH_STORAGE_ERROR",
  STATE_INVALID: "STORAGE_STATE_INVALID",
  INACTIVE_WITH_PHYSICAL: "INACTIVE_WITH_PHYSICAL_FOLDER",
  ORPHAN_PHYSICAL: "ORPHAN_PHYSICAL_FOLDER",
  ROOT_FILE: "UNEXPECTED_PROJECTS_ROOT_FILE",
  FILE_PATH_OUTSIDE_ORGANIZATION: "FILE_PATH_OUTSIDE_ORGANIZATION",
  ACTIVE_FILE_ON_INACTIVE_ORGANIZATION:
    "ACTIVE_FILE_ON_INACTIVE_ORGANIZATION",
});

const REPAIRABLE_CODES = new Set([
  ORGANIZATION_STORAGE_DRIFT_CODE.READY_MISSING_PHYSICAL,
  ORGANIZATION_STORAGE_DRIFT_CODE.MISSING_PHYSICAL,
  ORGANIZATION_STORAGE_DRIFT_CODE.PHYSICAL_PRESENT_NOT_READY,
  ORGANIZATION_STORAGE_DRIFT_CODE.READY_WITH_ERROR,
  ORGANIZATION_STORAGE_DRIFT_CODE.STATE_INVALID,
]);

function normalizedStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return Object.values(ORGANIZATION_STORAGE_STATUS).includes(status)
    ? status
    : null;
}

function activeOrganization(row) {
  return !(
    row?.active === 0 ||
    row?.active === "0" ||
    row?.active === false
  );
}

function pathKey(value) {
  return normalizeDropboxFolderPath(value).toLowerCase();
}

function expectedOrganizationPath(organization) {
  const slug =
    normalizeOrganizationSlug(organization?.slug) ||
    normalizeOrganizationSlug(organization?.name) ||
    `organization-${organization?.id || "unknown"}`;
  return `/projects/${slug}`;
}

function validProjectOrganizationPath(value) {
  const path = normalizeDropboxFolderPath(value);
  return Boolean(
    path &&
      path !== "/projects" &&
      path.startsWith("/projects/"),
  );
}

function issue(code, details = {}) {
  return {
    code,
    repairable: REPAIRABLE_CODES.has(code),
    details,
  };
}

async function defaultListOrganizations(env) {
  const result = await getDb(env)
    .prepare(
      `SELECT
         id,
         name,
         slug,
         description,
         active,
         dropbox_root_path,
         storage_status,
         storage_error,
         storage_checked_at,
         created_at,
         updated_at
       FROM organizations
       ORDER BY id ASC`,
    )
    .all();

  return result?.results || [];
}

async function defaultListOrganizationFiles(env) {
  const result = await getDb(env)
    .prepare(
      `SELECT
         id,
         organization_id,
         dropbox_path,
         active,
         is_project,
         updated_at
       FROM organization_files
       ORDER BY organization_id ASC, id ASC`,
    )
    .all();

  return result?.results || [];
}

async function defaultListProjectsRoot(env, rootPath) {
  return listDropboxFolderAll(env, rootPath);
}

function buildPhysicalIndex(entries) {
  const folders = new Map();
  const rootFiles = [];

  for (const entry of entries || []) {
    const tag = String(entry?.[".tag"] || "").trim().toLowerCase();
    const path = normalizeDropboxFolderPath(
      entry?.path_display || entry?.path_lower,
    );

    if (!path) continue;

    if (tag === "folder") {
      folders.set(pathKey(path), {
        name: entry?.name || path.split("/").pop() || "",
        path,
        pathLower: pathKey(path),
        id: entry?.id || null,
      });
      continue;
    }

    if (tag === "file") {
      rootFiles.push({
        code: ORGANIZATION_STORAGE_DRIFT_CODE.ROOT_FILE,
        path,
        name: entry?.name || path.split("/").pop() || "",
        repairable: false,
      });
    }
  }

  return { folders, rootFiles };
}

function classifyOrganization(
  organization,
  {
    folders,
    filesByOrganization,
  },
) {
  const active = activeOrganization(organization);
  const configuredPath = normalizeDropboxFolderPath(
    organization?.dropbox_root_path,
  );
  const expectedPath = expectedOrganizationPath(organization);
  const validPath = validProjectOrganizationPath(configuredPath);
  const physical = validPath
    ? folders.get(pathKey(configuredPath)) || null
    : null;
  const status = normalizedStatus(organization?.storage_status);
  const organizationIssues = [];

  if (!validPath) {
    organizationIssues.push(
      issue(ORGANIZATION_STORAGE_DRIFT_CODE.PATH_INVALID, {
        configuredPath: configuredPath || null,
        expectedPath,
      }),
    );
  } else if (pathKey(configuredPath) !== pathKey(expectedPath)) {
    organizationIssues.push(
      issue(ORGANIZATION_STORAGE_DRIFT_CODE.PATH_LEGACY, {
        configuredPath,
        expectedPath,
      }),
    );
  }

  if (!status) {
    organizationIssues.push(
      issue(ORGANIZATION_STORAGE_DRIFT_CODE.STATE_INVALID, {
        storageStatus: organization?.storage_status || null,
      }),
    );
  }

  if (active && validPath && !physical) {
    organizationIssues.push(
      issue(
        status === ORGANIZATION_STORAGE_STATUS.READY
          ? ORGANIZATION_STORAGE_DRIFT_CODE.READY_MISSING_PHYSICAL
          : ORGANIZATION_STORAGE_DRIFT_CODE.MISSING_PHYSICAL,
        {
          configuredPath,
          storageStatus: status,
        },
      ),
    );
  }

  if (
    active &&
    physical &&
    status &&
    status !== ORGANIZATION_STORAGE_STATUS.READY
  ) {
    organizationIssues.push(
      issue(
        ORGANIZATION_STORAGE_DRIFT_CODE.PHYSICAL_PRESENT_NOT_READY,
        {
          configuredPath,
          storageStatus: status,
        },
      ),
    );
  }

  if (
    active &&
    physical &&
    status === ORGANIZATION_STORAGE_STATUS.READY &&
    String(organization?.storage_error || "").trim()
  ) {
    organizationIssues.push(
      issue(ORGANIZATION_STORAGE_DRIFT_CODE.READY_WITH_ERROR, {
        configuredPath,
        storageErrorCode: String(organization.storage_error).trim(),
      }),
    );
  }

  if (!active && physical) {
    organizationIssues.push(
      issue(
        ORGANIZATION_STORAGE_DRIFT_CODE.INACTIVE_WITH_PHYSICAL,
        { configuredPath },
      ),
    );
  }

  const fileIssues = [];
  for (const file of filesByOrganization.get(Number(organization.id)) || []) {
    const filePath = normalizeDropboxFolderPath(file?.dropbox_path);
    const activeFile = !(
      file?.active === 0 ||
      file?.active === "0" ||
      file?.active === false
    );

    if (
      activeFile &&
      validPath &&
      filePath &&
      !pathKey(filePath).startsWith(`${pathKey(configuredPath)}/`)
    ) {
      fileIssues.push({
        code:
          ORGANIZATION_STORAGE_DRIFT_CODE.FILE_PATH_OUTSIDE_ORGANIZATION,
        fileId: file.id,
        dropboxPath: filePath,
        configuredPath,
        repairable: false,
      });
    }

    if (activeFile && !active) {
      fileIssues.push({
        code:
          ORGANIZATION_STORAGE_DRIFT_CODE
            .ACTIVE_FILE_ON_INACTIVE_ORGANIZATION,
        fileId: file.id,
        dropboxPath: filePath || null,
        repairable: false,
      });
    }
  }

  const pathDecisionRequired = organizationIssues.some(
    (item) =>
      item.code === ORGANIZATION_STORAGE_DRIFT_CODE.PATH_INVALID ||
      item.code === ORGANIZATION_STORAGE_DRIFT_CODE.PATH_LEGACY,
  );

  return {
    id: Number(organization.id),
    name: organization.name || null,
    slug: organization.slug || null,
    active,
    configuredPath: configuredPath || null,
    expectedPath,
    physicalFolderExists: Boolean(physical),
    storageStatus: status || null,
    storageErrorCode: organization.storage_error || null,
    storageCheckedAt: organization.storage_checked_at || null,
    issues: organizationIssues,
    fileIssues,
    repairable:
      !pathDecisionRequired &&
      organizationIssues.some((item) => item.repairable),
    pathDecisionRequired,
    _row: organization,
  };
}

function summarizeReport(organizations, orphanFolders, rootFiles) {
  const byCode = {};
  let organizationIssues = 0;
  let fileIssues = 0;
  let repairableOrganizations = 0;

  for (const organization of organizations) {
    if (organization.repairable) repairableOrganizations += 1;

    for (const item of organization.issues) {
      organizationIssues += 1;
      byCode[item.code] = (byCode[item.code] || 0) + 1;
    }

    for (const item of organization.fileIssues) {
      fileIssues += 1;
      byCode[item.code] = (byCode[item.code] || 0) + 1;
    }
  }

  for (const orphan of orphanFolders) {
    byCode[orphan.code] = (byCode[orphan.code] || 0) + 1;
  }

  for (const rootFile of rootFiles) {
    byCode[rootFile.code] = (byCode[rootFile.code] || 0) + 1;
  }

  return {
    organizations: organizations.length,
    organizationsWithIssues: organizations.filter(
      (item) =>
        item.issues.length > 0 ||
        item.fileIssues.length > 0,
    ).length,
    repairableOrganizations,
    organizationIssues,
    fileIssues,
    orphanFolders: orphanFolders.length,
    rootFiles: rootFiles.length,
    byCode,
  };
}

export async function buildOrganizationStorageDriftReport(
  env,
  {
    correlationId = createCorrelationId(),
    rootPath = "/projects",
    nowFn = Date.now,
    listOrganizations = defaultListOrganizations,
    listOrganizationFiles = defaultListOrganizationFiles,
    listProjectsRoot = defaultListProjectsRoot,
    requireSchema = ensureOrganizationStorageSchema,
  } = {},
) {
  await requireSchema(env, { correlationId });

  const normalizedRoot = normalizeDropboxFolderPath(rootPath);
  if (normalizedRoot !== "/projects") {
    const error = new Error(
      "O inventário de drift deve usar a raiz /projects.",
    );
    error.status = 400;
    error.code = "ORGANIZATION_STORAGE_DRIFT_ROOT_INVALID";
    error.category = "STORAGE";
    error.publicMessage = error.message;
    error.correlationId = correlationId;
    throw error;
  }

  const [organizations, organizationFiles, physicalPage] =
    await Promise.all([
      listOrganizations(env),
      listOrganizationFiles(env),
      listProjectsRoot(env, normalizedRoot),
    ]);

  const { folders, rootFiles } = buildPhysicalIndex(
    physicalPage?.entries || [],
  );
  const filesByOrganization = new Map();

  for (const file of organizationFiles || []) {
    const organizationId = Number(file?.organization_id);
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      continue;
    }

    if (!filesByOrganization.has(organizationId)) {
      filesByOrganization.set(organizationId, []);
    }
    filesByOrganization.get(organizationId).push(file);
  }

  const classified = (organizations || []).map((organization) =>
    classifyOrganization(organization, {
      folders,
      filesByOrganization,
    }),
  );

  const referencedPaths = new Set(
    classified
      .map((organization) => pathKey(organization.configuredPath))
      .filter(Boolean),
  );

  const orphanFolders = [...folders.values()]
    .filter((folder) => !referencedPaths.has(folder.pathLower))
    .map((folder) => ({
      code: ORGANIZATION_STORAGE_DRIFT_CODE.ORPHAN_PHYSICAL,
      path: folder.path,
      name: folder.name,
      repairable: false,
    }))
    .sort((left, right) =>
      String(left.path).localeCompare(String(right.path)),
    );

  const publicOrganizations = classified.map(
    ({ _row, ...organization }) => organization,
  );
  const generatedAt = new Date(
    Number(nowFn()) || Date.now(),
  ).toISOString();

  return {
    correlationId,
    generatedAt,
    rootPath: normalizedRoot,
    complete: physicalPage?.has_more !== true,
    providerPages: Number(physicalPage?.pages || 1),
    summary: summarizeReport(
      publicOrganizations,
      orphanFolders,
      rootFiles,
    ),
    organizations: publicOrganizations,
    orphanFolders,
    rootFiles,
    _rowsById: new Map(
      classified.map((organization) => [
        organization.id,
        organization._row,
      ]),
    ),
  };
}

function normalizeApprovedIds(values) {
  const ids = [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter(
          (value) => Number.isInteger(value) && value > 0,
        ),
    ),
  ];

  if (ids.length === 0) {
    const error = new Error(
      "Informe ao menos uma organização aprovada para o backfill.",
    );
    error.status = 400;
    error.code = "ORGANIZATION_STORAGE_DRIFT_APPROVAL_REQUIRED";
    error.category = "STORAGE";
    error.publicMessage = error.message;
    throw error;
  }

  if (ids.length > 50) {
    const error = new Error(
      "O backfill aceita no máximo 50 organizações por execução.",
    );
    error.status = 400;
    error.code = "ORGANIZATION_STORAGE_DRIFT_BATCH_TOO_LARGE";
    error.category = "STORAGE";
    error.publicMessage = error.message;
    throw error;
  }

  return ids;
}

export async function applyOrganizationStorageDriftRepairs(
  env,
  {
    approvedOrganizationIds,
    confirmation,
    correlationId = createCorrelationId(),
    nowFn = Date.now,
    buildReport = buildOrganizationStorageDriftReport,
    ensureStorage = ensureOrganizationStorage,
  } = {},
) {
  if (confirmation !== "APPLY_APPROVED_STORAGE_DRIFT") {
    const error = new Error(
      "Confirmação explícita obrigatória para aplicar o backfill.",
    );
    error.status = 400;
    error.code = "ORGANIZATION_STORAGE_DRIFT_CONFIRMATION_REQUIRED";
    error.category = "STORAGE";
    error.publicMessage = error.message;
    error.correlationId = correlationId;
    throw error;
  }

  const approvedIds = normalizeApprovedIds(
    approvedOrganizationIds,
  );
  const report = await buildReport(env, {
    correlationId,
    nowFn,
  });
  const organizationsById = new Map(
    report.organizations.map((organization) => [
      Number(organization.id),
      organization,
    ]),
  );
  const rowsById = report._rowsById || new Map();
  const repaired = [];
  const skipped = [];
  const failed = [];

  for (const organizationId of approvedIds) {
    const inventory = organizationsById.get(organizationId);
    const row = rowsById.get(organizationId);

    if (!inventory || !row) {
      skipped.push({
        organizationId,
        reason: "ORGANIZATION_NOT_FOUND_IN_REPORT",
        correlationId,
      });
      continue;
    }

    if (!inventory.active) {
      skipped.push({
        organizationId,
        reason: "ORGANIZATION_INACTIVE",
        correlationId,
      });
      continue;
    }

    const repairableIssues = inventory.issues
      .filter((item) => item.repairable)
      .map((item) => item.code);

    if (!inventory.repairable || repairableIssues.length === 0) {
      skipped.push({
        organizationId,
        reason: "NO_APPROVED_REPAIRABLE_DRIFT",
        issues: inventory.issues.map((item) => item.code),
        correlationId,
      });
      continue;
    }

    try {
      const storage = await ensureStorage(env, row, {
        correlationId,
        nowFn,
        revalidateReady: true,
      });

      if (storage.ready) {
        repaired.push({
          organizationId,
          status: storage.status,
          issues: repairableIssues,
          repairedPath: Boolean(storage.repairedPath),
          superseded: Boolean(storage.superseded),
          correlationId,
        });
      } else {
        skipped.push({
          organizationId,
          reason: storage.busy
            ? "CLAIM_IN_PROGRESS"
            : "STATE_CHANGED",
          issues: repairableIssues,
          correlationId,
        });
      }
    } catch (error) {
      failed.push({
        organizationId,
        code:
          error?.code ||
          "ORGANIZATION_STORAGE_DRIFT_REPAIR_FAILED",
        stage:
          error?.stage ||
          "organization.storage.drift.repair",
        correlationId:
          error?.correlationId || correlationId,
      });
    }
  }

  return {
    correlationId,
    approved: approvedIds.length,
    repaired: repaired.length,
    skipped: skipped.length,
    failed: failed.length,
    organizations: [...repaired, ...skipped, ...failed],
  };
}

export function publicOrganizationStorageDriftReport(report) {
  const { _rowsById, ...publicReport } = report || {};
  return publicReport;
}

export const __organizationStorageDriftTesting = Object.freeze({
  pathKey,
  expectedOrganizationPath,
  validProjectOrganizationPath,
  classifyOrganization,
  summarizeReport,
  normalizeApprovedIds,
  REPAIRABLE_CODES,
});
