import { normalizeDropboxFolderPath } from "./dropbox.js";

function slug(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A configured root is data, not an invitation to rename/move existing files.
export function organizationStoragePathPolicy(organization) {
  const configuredPath = normalizeDropboxFolderPath(organization?.dropbox_root_path);
  const expectedPath = `/projects/${slug(organization?.slug) || slug(organization?.name) || `organization-${organization?.id || "unknown"}`}`;
  const parts = configuredPath.split("/").slice(1);
  const valid = parts.length >= 2 && parts[0] === "projects" &&
    parts.slice(1).every((part) => part && part !== "." && part !== ".." && !/[\\\x00-\x1f]/.test(part));
  const legacy = valid && configuredPath.toLowerCase() !== expectedPath.toLowerCase();
  return {
    configuredPath,
    expectedPath,
    valid: Boolean(valid),
    legacy: Boolean(legacy),
    decisionRequired: !valid || legacy,
    reason: !valid ? "PATH_INVALID" : legacy ? "PATH_LEGACY" : null,
  };
}
