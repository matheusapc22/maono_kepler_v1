import {
  getDb,
  getTableColumns,
  tableExists,
} from "./organizations.js";

export const DOCUMENT_FOLDER_MAX_DEPTH = 5;
export const DOCUMENT_FOLDER_MAX_NAME = 120;

function folderError(message, status, code, stage = "document.folder") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.stage = stage;
  error.publicMessage = message;
  return error;
}

function timestamp() {
  return new Date().toISOString();
}

export async function requireDocumentFoldersSchema(env) {
  const hasFolders = await tableExists(env, "organization_file_folders");
  if (!hasFolders) {
    throw folderError(
      "A estrutura de pastas ainda não está disponível neste ambiente.",
      503,
      "DOCUMENT_FOLDERS_MIGRATION_REQUIRED",
      "document.folder.schema",
    );
  }

  const columns = await getTableColumns(env, "organization_files");
  const required = [
    "folder_id",
    "deleted_by",
    "purge_after",
    "trashed_from_folder_id",
    "purged_at",
  ];

  if (required.some((column) => !columns.has(column))) {
    throw folderError(
      "A estrutura de pastas ainda não está disponível neste ambiente.",
      503,
      "DOCUMENT_FOLDERS_MIGRATION_REQUIRED",
      "document.folder.schema",
    );
  }
}

export function normalizeDocumentFolderName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");

  if (!name) {
    throw folderError(
      "Informe um nome para a pasta.",
      400,
      "DOCUMENT_FOLDER_NAME_REQUIRED",
    );
  }
  if (name.length > DOCUMENT_FOLDER_MAX_NAME) {
    throw folderError(
      "O nome da pasta excede 120 caracteres.",
      400,
      "DOCUMENT_FOLDER_NAME_TOO_LONG",
    );
  }
  if (name === "." || name === ".." || /[\\/\u0000-\u001f]/.test(name)) {
    throw folderError(
      "O nome da pasta contém caracteres inválidos.",
      400,
      "DOCUMENT_FOLDER_NAME_INVALID",
    );
  }

  return name;
}

export function publicDocumentFolder(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function findFolder(env, organizationId, folderId) {
  return getDb(env)
    .prepare(`
      SELECT *
      FROM organization_file_folders
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `)
    .bind(folderId, organizationId)
    .first();
}

export async function getDocumentFolderOrThrow(env, organizationId, folderId) {
  await requireDocumentFoldersSchema(env);
  const folder = await findFolder(env, organizationId, folderId);

  if (!folder) {
    throw folderError(
      "Pasta não encontrada.",
      404,
      "DOCUMENT_FOLDER_NOT_FOUND",
      "document.folder.lookup",
    );
  }

  return folder;
}

export async function listDocumentFolders(env, organizationId) {
  await requireDocumentFoldersSchema(env);

  const result = await getDb(env)
    .prepare(`
      SELECT *
      FROM organization_file_folders
      WHERE organization_id = ?
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
        LOWER(name) ASC,
        id ASC
    `)
    .bind(organizationId)
    .all();

  return (result?.results || []).map(publicDocumentFolder);
}

async function folderDepth(env, organizationId, folderId) {
  if (!folderId) return 0;

  const row = await getDb(env)
    .prepare(`
      WITH RECURSIVE lineage(id, parent_id, depth) AS (
        SELECT id, parent_id, 1
        FROM organization_file_folders
        WHERE id = ?
          AND organization_id = ?
          AND deleted_at IS NULL
        UNION ALL
        SELECT parent.id, parent.parent_id, lineage.depth + 1
        FROM organization_file_folders parent
        INNER JOIN lineage ON parent.id = lineage.parent_id
        WHERE parent.organization_id = ?
          AND parent.deleted_at IS NULL
      )
      SELECT COALESCE(MAX(depth), 0) AS depth
      FROM lineage
    `)
    .bind(folderId, organizationId, organizationId)
    .first();

  return Number(row?.depth || 0);
}

async function subtreeHeight(env, organizationId, folderId) {
  if (!folderId) return 1;

  const row = await getDb(env)
    .prepare(`
      WITH RECURSIVE descendants(id, depth) AS (
        SELECT id, 1
        FROM organization_file_folders
        WHERE id = ?
          AND organization_id = ?
          AND deleted_at IS NULL
        UNION ALL
        SELECT child.id, descendants.depth + 1
        FROM organization_file_folders child
        INNER JOIN descendants ON child.parent_id = descendants.id
        WHERE child.organization_id = ?
          AND child.deleted_at IS NULL
      )
      SELECT COALESCE(MAX(depth), 1) AS height
      FROM descendants
    `)
    .bind(folderId, organizationId, organizationId)
    .first();

  return Number(row?.height || 1);
}

async function parentIsDescendant(env, organizationId, folderId, parentId) {
  if (!folderId || !parentId) return false;

  const row = await getDb(env)
    .prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id
        FROM organization_file_folders
        WHERE parent_id = ?
          AND organization_id = ?
          AND deleted_at IS NULL
        UNION ALL
        SELECT child.id
        FROM organization_file_folders child
        INNER JOIN descendants ON child.parent_id = descendants.id
        WHERE child.organization_id = ?
          AND child.deleted_at IS NULL
      )
      SELECT 1 AS found
      FROM descendants
      WHERE id = ?
      LIMIT 1
    `)
    .bind(folderId, organizationId, organizationId, parentId)
    .first();

  return Boolean(row?.found);
}

async function assertSiblingNameAvailable(
  env,
  organizationId,
  parentId,
  name,
  excludeFolderId = null,
) {
  const row = await getDb(env)
    .prepare(`
      SELECT id
      FROM organization_file_folders
      WHERE organization_id = ?
        AND COALESCE(parent_id, 0) = COALESCE(?, 0)
        AND LOWER(TRIM(name)) = LOWER(TRIM(?))
        AND deleted_at IS NULL
        AND (? IS NULL OR id <> ?)
      LIMIT 1
    `)
    .bind(
      organizationId,
      parentId,
      name,
      excludeFolderId,
      excludeFolderId,
    )
    .first();

  if (row?.id) {
    throw folderError(
      "Já existe uma pasta com esse nome neste nível.",
      409,
      "DOCUMENT_FOLDER_NAME_CONFLICT",
    );
  }
}

async function validateParent(
  env,
  organizationId,
  parentId,
  movingFolderId = null,
) {
  if (parentId === null || parentId === undefined) {
    const height = await subtreeHeight(env, organizationId, movingFolderId);
    if (height > DOCUMENT_FOLDER_MAX_DEPTH) {
      throw folderError(
        "A estrutura excede a profundidade máxima de 5 níveis.",
        400,
        "DOCUMENT_FOLDER_DEPTH_EXCEEDED",
      );
    }
    return null;
  }

  const numericParentId = Number(parentId);
  if (!Number.isInteger(numericParentId) || numericParentId <= 0) {
    throw folderError(
      "Pasta pai inválida.",
      400,
      "DOCUMENT_FOLDER_PARENT_INVALID",
    );
  }

  if (movingFolderId && Number(movingFolderId) === numericParentId) {
    throw folderError(
      "Uma pasta não pode ser pai de si mesma.",
      400,
      "DOCUMENT_FOLDER_SELF_PARENT",
    );
  }

  const parent = await findFolder(env, organizationId, numericParentId);
  if (!parent) {
    throw folderError(
      "Pasta pai não encontrada.",
      404,
      "DOCUMENT_FOLDER_PARENT_NOT_FOUND",
    );
  }

  if (
    movingFolderId &&
    await parentIsDescendant(
      env,
      organizationId,
      movingFolderId,
      numericParentId,
    )
  ) {
    throw folderError(
      "Não é possível criar um ciclo entre pastas.",
      400,
      "DOCUMENT_FOLDER_CYCLE",
    );
  }

  const parentDepth = await folderDepth(env, organizationId, numericParentId);
  const height = await subtreeHeight(env, organizationId, movingFolderId);

  if (parentDepth + height > DOCUMENT_FOLDER_MAX_DEPTH) {
    throw folderError(
      "A estrutura excede a profundidade máxima de 5 níveis.",
      400,
      "DOCUMENT_FOLDER_DEPTH_EXCEEDED",
    );
  }

  return parent;
}

function mapConstraintError(error) {
  const message = String(error?.message || "");

  if (
    message.includes("idx_organization_file_folders_sibling_name") ||
    message.includes("UNIQUE constraint failed")
  ) {
    return folderError(
      "Já existe uma pasta com esse nome neste nível.",
      409,
      "DOCUMENT_FOLDER_NAME_CONFLICT",
    );
  }
  if (message.includes("DOCUMENT_FOLDER_NOT_EMPTY")) {
    return folderError(
      "A pasta precisa estar vazia antes de ser excluída.",
      409,
      "DOCUMENT_FOLDER_NOT_EMPTY",
    );
  }
  if (
    message.includes("DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH") ||
    message.includes("ORGANIZATION_FILE_FOLDER_SCOPE_MISMATCH")
  ) {
    return folderError(
      "Pasta não encontrada.",
      404,
      "DOCUMENT_FOLDER_NOT_FOUND",
    );
  }
  if (
    message.includes("DOCUMENT_FOLDER_CYCLE") ||
    message.includes("DOCUMENT_FOLDER_SELF_PARENT")
  ) {
    return folderError(
      "A hierarquia de pastas é inválida.",
      400,
      "DOCUMENT_FOLDER_CYCLE",
    );
  }

  return error;
}

export async function createDocumentFolder(
  env,
  { organizationId, parentId = null, name, userId },
) {
  await requireDocumentFoldersSchema(env);
  const normalizedName = normalizeDocumentFolderName(name);
  const normalizedParentId =
    parentId === null || parentId === undefined || parentId === ""
      ? null
      : Number(parentId);

  await validateParent(env, organizationId, normalizedParentId);
  await assertSiblingNameAvailable(
    env,
    organizationId,
    normalizedParentId,
    normalizedName,
  );

  try {
    const result = await getDb(env)
      .prepare(`
        INSERT INTO organization_file_folders (
          organization_id,
          parent_id,
          name,
          created_by,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        organizationId,
        normalizedParentId,
        normalizedName,
        userId || null,
        timestamp(),
        timestamp(),
      )
      .run();

    return getDocumentFolderOrThrow(
      env,
      organizationId,
      Number(result?.meta?.last_row_id || result?.meta?.last_insert_rowid),
    );
  } catch (error) {
    throw mapConstraintError(error);
  }
}

export async function updateDocumentFolder(
  env,
  organizationId,
  folderId,
  patch = {},
) {
  await requireDocumentFoldersSchema(env);
  const current = await getDocumentFolderOrThrow(
    env,
    organizationId,
    folderId,
  );

  const hasName = Object.prototype.hasOwnProperty.call(patch, "name");
  const hasParent = Object.prototype.hasOwnProperty.call(patch, "parentId");

  if (!hasName && !hasParent) {
    throw folderError(
      "Nenhuma alteração informada.",
      400,
      "DOCUMENT_FOLDER_PATCH_EMPTY",
    );
  }

  const name = hasName
    ? normalizeDocumentFolderName(patch.name)
    : current.name;
  const parentId = hasParent
    ? patch.parentId === null || patch.parentId === ""
      ? null
      : Number(patch.parentId)
    : current.parent_id;

  await validateParent(env, organizationId, parentId, folderId);
  await assertSiblingNameAvailable(
    env,
    organizationId,
    parentId,
    name,
    folderId,
  );

  try {
    await getDb(env)
      .prepare(`
        UPDATE organization_file_folders
        SET name = ?,
            parent_id = ?,
            updated_at = ?
        WHERE id = ?
          AND organization_id = ?
          AND deleted_at IS NULL
      `)
      .bind(name, parentId, timestamp(), folderId, organizationId)
      .run();

    return getDocumentFolderOrThrow(env, organizationId, folderId);
  } catch (error) {
    throw mapConstraintError(error);
  }
}

export async function deleteDocumentFolder(env, organizationId, folderId) {
  await requireDocumentFoldersSchema(env);
  await getDocumentFolderOrThrow(env, organizationId, folderId);

  const contents = await getDb(env)
    .prepare(`
      SELECT
        EXISTS(
          SELECT 1
          FROM organization_file_folders child
          WHERE child.organization_id = ?
            AND child.parent_id = ?
            AND child.deleted_at IS NULL
        ) AS has_children,
        EXISTS(
          SELECT 1
          FROM organization_files file
          WHERE file.organization_id = ?
            AND file.folder_id = ?
            AND file.deleted_at IS NULL
            AND (file.active = 1 OR file.active IS NULL)
        ) AS has_files
    `)
    .bind(organizationId, folderId, organizationId, folderId)
    .first();

  if (contents?.has_children || contents?.has_files) {
    throw folderError(
      "A pasta precisa estar vazia antes de ser excluída.",
      409,
      "DOCUMENT_FOLDER_NOT_EMPTY",
    );
  }

  try {
    const at = timestamp();
    await getDb(env)
      .prepare(`
        UPDATE organization_file_folders
        SET deleted_at = ?,
            updated_at = ?
        WHERE id = ?
          AND organization_id = ?
          AND deleted_at IS NULL
      `)
      .bind(at, at, folderId, organizationId)
      .run();
  } catch (error) {
    throw mapConstraintError(error);
  }

  return { deleted: true };
}

export async function moveOrganizationFileToFolder(
  env,
  organizationId,
  fileId,
  folderId,
) {
  await requireDocumentFoldersSchema(env);

  const file = await getDb(env)
    .prepare(`
      SELECT *
      FROM organization_files
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
        AND (active = 1 OR active IS NULL)
      LIMIT 1
    `)
    .bind(fileId, organizationId)
    .first();

  if (!file) {
    throw folderError(
      "Arquivo não encontrado.",
      404,
      "ORGANIZATION_FILE_NOT_FOUND",
      "document.folder.file_lookup",
    );
  }

  const normalizedFolderId =
    folderId === null || folderId === undefined || folderId === ""
      ? null
      : Number(folderId);

  if (normalizedFolderId !== null) {
    if (!Number.isInteger(normalizedFolderId) || normalizedFolderId <= 0) {
      throw folderError(
        "Pasta inválida.",
        400,
        "DOCUMENT_FOLDER_INVALID",
      );
    }
    await getDocumentFolderOrThrow(
      env,
      organizationId,
      normalizedFolderId,
    );
  }

  try {
    await getDb(env)
      .prepare(`
        UPDATE organization_files
        SET folder_id = ?,
            updated_at = ?
        WHERE id = ?
          AND organization_id = ?
      `)
      .bind(normalizedFolderId, timestamp(), fileId, organizationId)
      .run();
  } catch (error) {
    throw mapConstraintError(error);
  }

  return getDb(env)
    .prepare(`
      SELECT *
      FROM organization_files
      WHERE id = ?
        AND organization_id = ?
      LIMIT 1
    `)
    .bind(fileId, organizationId)
    .first();
}
