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

function extension(name) {
  return String(name || "").match(/\.([a-z0-9]+)$/i)?.[1] || "";
}

export function normalizeOrganizationFileName(value, currentFile) {
  if (typeof value !== "string") {
    throw renameError("Nome de arquivo inválido.", 400, "DOCUMENT_FILE_NAME_INVALID");
  }
  // Reject control characters before whitespace normalization, including CR/LF.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw renameError("O nome do arquivo contém caracteres inválidos.", 400, "DOCUMENT_FILE_NAME_INVALID");
  }

  let name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw renameError("Informe um nome para o arquivo.", 400, "DOCUMENT_FILE_NAME_REQUIRED");
  }

  const currentExtension = extension(
    currentFile.original_name || currentFile.name || currentFile.file_name,
  ) || extension(currentFile.file_name);
  const nextExtension = extension(name);
  if (currentExtension && !nextExtension) {
    name += `.${currentExtension}`;
  } else if (nextExtension.toLowerCase() !== currentExtension.toLowerCase()) {
    throw renameError("Mantenha a extensão original do arquivo.", 400, "DOCUMENT_FILE_EXTENSION_IMMUTABLE");
  }

  if (name.length > ORGANIZATION_FILE_MAX_NAME) {
    throw renameError("O nome do arquivo excede 160 caracteres.", 400, "DOCUMENT_FILE_NAME_TOO_LONG");
  }
  // The download header uses this same sanitizer. Reject names that would
  // otherwise be silently changed or truncated when the user downloads them.
  if (sanitizeFileName(name) !== name || name.endsWith(".")) {
    throw renameError("O nome do arquivo contém caracteres inválidos.", 400, "DOCUMENT_FILE_NAME_INVALID");
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
  // that was moved to trash after the lookup.
  const renamed = await getDb(env)
    .prepare(`
      UPDATE organization_files
      SET name = ?, original_name = ?, updated_at = ?
      WHERE ${activeFile}
      RETURNING *
    `)
    .bind(normalizedName, normalizedName, new Date().toISOString(), fileId, organizationId)
    .first();
  if (!renamed) throw fileNotFound();

  return renamed;
}
