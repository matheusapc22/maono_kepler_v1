import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminIndex, adminProject] = await Promise.all([
  readFile(
    new URL("../functions/api/admin/projects/index.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../functions/api/admin/projects/[id].js", import.meta.url),
    "utf8",
  ),
]);

test("admin cria apenas identidade DRAFT sem fabricar ACTIVE", () => {
  assert.match(adminIndex, /createProjectRecord/);
  assert.match(adminIndex, /active:\s*false/);
  assert.match(adminIndex, /lifecycle_state = 'DRAFT'/);
  assert.match(adminIndex, /lifecycle_version = 1/);
  assert.match(adminIndex, /project\.lifecycle\.draft_created/);
  assert.doesNotMatch(
    adminIndex.match(/async function createProject[\s\S]*?\n\}/)?.[0] || "",
    /active:\s*body\?\.active/,
  );
});

test("admin não pode alterar active de projeto gerenciado", () => {
  assert.match(adminProject, /isLifecycleManagedProject\(current\)/);
  assert.match(adminProject, /PROJECT_ACTIVE_MANAGED_BY_LIFECYCLE/);
  assert.match(adminProject, /requestedActive !== Number\(current\.active \|\| 0\)/);
});

test("storage físico de revisão gerenciada não muda por PATCH de metadata", () => {
  assert.match(adminProject, /PROJECT_STORAGE_LOCATION_MANAGED_BY_LIFECYCLE/);
  assert.match(adminProject, /PROJECT_CONFIG_FILE_MANAGED_BY_LIFECYCLE/);
  assert.match(
    adminProject,
    /dropboxRootPath !== normalizeDropboxPath\(current\.dropbox_root_path\)/,
  );
  assert.match(
    adminProject,
    /defaultConfigFile !== current\.default_config_file/,
  );
});

test("soft deactivate legado não cria estado implícito fora da máquina S03", () => {
  assert.match(adminProject, /PROJECT_LIFECYCLE_DEACTIVATION_UNSUPPORTED/);
  assert.match(adminProject, /!hardDelete && isLifecycleManagedProject\(current\)/);
});

test("flag de organization_file usa lifecycle ACTIVE e fallback legado somente NULL", () => {
  assert.match(adminProject, /lifecycle_state = 'ACTIVE'/);
  assert.match(adminProject, /lifecycle_state IS NULL AND active = 1/);
});

test("DTO administrativo também expõe lifecycle seguro", () => {
  assert.match(adminIndex, /publicProjectLifecycle\(project\)/);
  assert.match(adminProject, /publicProjectLifecycle\(project\)/);
  assert.doesNotMatch(
    adminIndex.match(/function publicAdminProject[\s\S]*?\n\}/)?.[0] || "",
    /config_storage_ref|config_checksum\s*:/,
  );
});
