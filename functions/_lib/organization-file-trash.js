import { getDb } from "./organizations.js";
import { requireDocumentFoldersSchema } from "./organization-file-folders.js";

export const ORGANIZATION_FILE_TRASH_RETENTION_DAYS = 10;
const RETENTION_MS = ORGANIZATION_FILE_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function trashError(message, status, code, stage = "document.trash") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.stage = stage;
  error.publicMessage = message;
  return error;
}

export function purgeAfterFromDeletedAt(deletedAt) {
  const deleted = new Date(deletedAt);
  if (Number.isNaN(deleted.getTime())) {
    throw trashError("Data de exclusão inválida.", 500, "DOCUMENT_TRASH_DATE_INVALID");
  }
  return new Date(deleted.getTime() + RETENTION_MS).toISOString();
}

export async function findTrashedOrganizationFile(env, organizationId, fileId) {
  await requireDocumentFoldersSchema(env);
  return (await getDb(env)
    .prepare(`
      SELECT *
      FROM organization_files
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NOT NULL
        AND purge_after IS NOT NULL
        AND purged_at IS NULL
        AND UPPER(COALESCE(status, '')) = 'TRASHED'
      LIMIT 1
    `)
    .bind(fileId, organizationId)
    .first()) || null;
}

export async function trashOrganizationFile(
  env,
  { organizationId, fileId, userId, now = new Date() },
) {
  await requireDocumentFoldersSchema(env);
  const db = getDb(env);
  const existing = await db
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

  if (!existing) {
    throw trashError("Arquivo não encontrado.", 404, "ORGANIZATION_FILE_NOT_FOUND", "document.trash.lookup");
  }

  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) {
    throw trashError("Data de lixeira inválida.", 500, "DOCUMENT_TRASH_DATE_INVALID");
  }
  const deletedAt = current.toISOString();
  const purgeAfter = purgeAfterFromDeletedAt(deletedAt);

  const result = await db
    .prepare(`
      UPDATE organization_files
      SET status = 'TRASHED',
          active = 0,
          deleted_at = ?,
          deleted_by = ?,
          purge_after = ?,
          trashed_from_folder_id = folder_id,
          folder_id = NULL,
          purged_at = NULL,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
        AND (active = 1 OR active IS NULL)
    `)
    .bind(deletedAt, userId, purgeAfter, deletedAt, fileId, organizationId)
    .run();

  if (!Number(result?.meta?.changes || 0)) {
    throw trashError("O documento não pôde ser movido para a Lixeira.", 409, "DOCUMENT_TRASH_CONFLICT");
  }

  return db
    .prepare("SELECT * FROM organization_files WHERE id = ? AND organization_id = ? LIMIT 1")
    .bind(fileId, organizationId)
    .first();
}

async function validRestoreFolder(env, organizationId, folderId) {
  if (!folderId) return null;
  const row = await getDb(env)
    .prepare(`
      SELECT id
      FROM organization_file_folders
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `)
    .bind(folderId, organizationId)
    .first();
  return row?.id ?? null;
}

export async function restoreOrganizationFile(
  env,
  { organizationId, fileId, now = new Date() },
) {
  const file = await findTrashedOrganizationFile(env, organizationId, fileId);
  if (!file) {
    throw trashError("Documento não encontrado na Lixeira.", 404, "ORGANIZATION_FILE_TRASH_NOT_FOUND", "document.restore.lookup");
  }

  const currentTime = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(currentTime.getTime())) {
    throw trashError("Data de restauração inválida.", 500, "DOCUMENT_RESTORE_DATE_INVALID");
  }
  const purgeAfter = new Date(file.purge_after);
  if (!Number.isNaN(purgeAfter.getTime()) && purgeAfter.getTime() <= currentTime.getTime()) {
    throw trashError("O prazo de restauração deste documento expirou.", 409, "DOCUMENT_RESTORE_EXPIRED", "document.restore.expired");
  }

  const previousFolderId = file.trashed_from_folder_id ?? null;
  const restoreFolderId = await validRestoreFolder(env, organizationId, previousFolderId);
  const originalFolderMissing = previousFolderId != null && restoreFolderId == null;
  const restoredAt = currentTime.toISOString();

  const result = await getDb(env)
    .prepare(`
      UPDATE organization_files
      SET status = 'ACTIVE',
          active = 1,
          folder_id = ?,
          deleted_at = NULL,
          deleted_by = NULL,
          purge_after = NULL,
          trashed_from_folder_id = NULL,
          purged_at = NULL,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
        AND organization_id = ?
        AND deleted_at IS NOT NULL
        AND purged_at IS NULL
        AND UPPER(COALESCE(status, '')) = 'TRASHED'
    `)
    .bind(restoreFolderId, restoredAt, fileId, organizationId)
    .run();

  if (!Number(result?.meta?.changes || 0)) {
    throw trashError("O documento não pôde ser restaurado.", 409, "DOCUMENT_RESTORE_CONFLICT", "document.restore");
  }

  const restored = await getDb(env)
    .prepare("SELECT * FROM organization_files WHERE id = ? AND organization_id = ? LIMIT 1")
    .bind(fileId, organizationId)
    .first();

  return { file: restored, restoredToRoot: restoreFolderId == null, originalFolderMissing };
}
