import { getDb, sanitizeFileName } from "./organizations.js";

export const ORGANIZATION_FILE_MAX_NAME = 160;

function renameError(message, status, code) {
  return Object.assign(new Error(message), {
    status,
    code,
    stage: "document.rename",
    publicMessage: message,
  });
}

function fileNotFound() {
  return renameError("Arquivo não encontrado.", 404, "ORGANIZATION_FILE_NOT_FOUND");
}

// Treat only the last, non-leading dot as the extension separator. Preserve
// the exact suffix (including case); storage filenames are not display names.
export function splitOrganizationFileName(name) {
  const value = String(name || "");
  const dot = value.lastIndexOf(".");
  return dot > 0 && dot < value.length - 1
    ? { baseName: value.slice(0, dot), extension: value.slice(dot) }
    : { baseName: value, extension: "" };
}

export function normalizeOrganizationFileName(value, currentFile) {
  if (typeof value !== "string") {
    throw renameError("Nome de arquivo inválido.", 400, "DOCUMENT_FILE_NAME_INVALID");
  }
  // Reject control characters before whitespace normalization, including CR/LF.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw renameError("O nome do arquivo contém caracteres inválidos.", 400, "DOCUMENT_FILE_NAME_INVALID");
  }

  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw renameError("Informe um nome para o arquivo.", 400, "DOCUMENT_FILE_NAME_REQUIRED");
  }

  if (name.length > ORGANIZATION_FILE_MAX_NAME) {
    throw renameError("O nome do arquivo excede 160 caracteres.", 400, "DOCUMENT_FILE_NAME_TOO_LONG");
  }
  // The download header uses this same sanitizer. Reject names that would
  // otherwise be silently changed or truncated when the user downloads them.
  if (sanitizeFileName(name) !== name || name.endsWith(".")) {
    throw renameError("O nome do arquivo contém caracteres inválidos.", 400, "DOCUMENT_FILE_NAME_INVALID");
  }

  const currentExtension = splitOrganizationFileName(
    currentFile.original_name || currentFile.name || currentFile.file_name,
  ).extension;
  const nextExtension = splitOrganizationFileName(name).extension;
  if (nextExtension !== currentExtension) {
    throw renameError("Mantenha a extensão original do arquivo.", 400, "DOCUMENT_FILE_EXTENSION_IMMUTABLE");
  }

  return name;
}

export async function renameOrganizationFile(env, organizationId, fileId, name) {
  const activeFile = `id = ? AND organization_id = ?
    AND deleted_at IS NULL AND purged_at IS NULL
    AND (active = 1 OR active IS NULL)
    AND (status = 'ACTIVE' OR status IS NULL)`;
  const file = await getDb(env)
    .prepare(`SELECT * FROM organization_files WHERE ${activeFile} LIMIT 1`)
    .bind(fileId, organizationId)
    .first();
  if (!file) throw fileNotFound();

  const normalizedName = normalizeOrganizationFileName(name, file);
  // These fields are display metadata. Stored filename, content, provider
  // identity, folder/project links and trash state must remain unchanged.
  // Repeat the active-state predicates at write time to avoid renaming a file
  // that was moved to trash after the lookup. Compare display metadata too,
  // preventing a concurrent rename from being overwritten with a stale suffix.
  const renamed = await getDb(env)
    .prepare(`
      UPDATE organization_files
      SET name = ?, original_name = ?, updated_at = ?
      WHERE ${activeFile}
        AND name IS ? AND original_name IS ? AND file_name IS ?
      RETURNING *
    `)
    .bind(normalizedName, normalizedName, new Date().toISOString(), fileId, organizationId,
      file.name ?? null, file.original_name ?? null, file.file_name ?? null)
    .first();
  if (!renamed) {
    const current = await getDb(env)
      .prepare(`SELECT id FROM organization_files WHERE ${activeFile} LIMIT 1`)
      .bind(fileId, organizationId)
      .first();
    if (!current) throw fileNotFound();
    throw renameError("O arquivo foi alterado. Atualize e tente novamente.", 409, "DOCUMENT_FILE_RENAME_CONFLICT");
  }

  return renamed;
}
