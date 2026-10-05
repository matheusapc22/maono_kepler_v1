import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metadataUrl = new URL(
  "../functions/api/projects/[slug]/metadata.js",
  import.meta.url,
);
const configUrl = new URL(
  "../functions/api/projects/[slug]/config.js",
  import.meta.url,
);
const serviceUrl = new URL(
  "../functions/_lib/project-service.js",
  import.meta.url,
);
const configServiceUrl = new URL(
  "../functions/_lib/project-config-service.js",
  import.meta.url,
);
const revisionsUrl = new URL(
  "../functions/_lib/project-save-operations.js",
  import.meta.url,
);

const [metadataSource, configSource, serviceSource, configServiceSource, revisionsSource] =
  await Promise.all([
    readFile(metadataUrl, "utf8"),
    readFile(configUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
    readFile(configServiceUrl, "utf8"),
    readFile(revisionsUrl, "utf8"),
  ]);

function compact(source) {
  return source.replace(/\s+/g, " ");
}

test("endpoint de metadados aceita somente GET e PATCH", () => {
  assert.match(
    metadataSource,
    /const\s+ALLOWED_METHODS\s*=\s*\[\s*"GET"\s*,\s*"PATCH"\s*\]/,
  );
  assert.match(metadataSource, /methodNotAllowed\(ALLOWED_METHODS\)/);
  assert.doesNotMatch(
    metadataSource,
    /ALLOWED_METHODS\s*=\s*\[[^\]]*"PUT"/,
  );
  assert.doesNotMatch(
    metadataSource,
    /ALLOWED_METHODS\s*=\s*\[[^\]]*"POST"/,
  );
});

test("GET e PATCH exigem permissões distintas", () => {
  assert.match(metadataSource, /"projects\.metadata\.read"/);
  assert.match(metadataSource, /"projects\.metadata\.update"/);
  assert.match(metadataSource, /"project\.view"/);
  assert.match(metadataSource, /"project\.edit"/);
  assert.match(metadataSource, /await\s+can\(/);
  assert.match(metadataSource, /status\s*=\s*403/);
});

test("organização ativa e projeto autorizado são resolvidos antes da operação", () => {
  assert.match(metadataSource, /getAuthorizedProject\(env,\s*user,\s*slug\)/);
  assert.match(metadataSource, /getProjectOrganizationId\(project\)/);
  assert.match(
    metadataSource,
    /getProjectMetadataBySlug\(env,\s*\{[\s\S]*organizationId/,
  );
  assert.match(
    metadataSource,
    /updateProjectMetadata\(env,\s*\{[\s\S]*organizationId/,
  );
});

test("campos internos e imutáveis são rejeitados pelo serviço central", () => {
  for (const field of [
    "createdBy",
    "slug",
    "organizationId",
    "dropboxRootPath",
    "defaultConfigFile",
    "active",
  ]) {
    assert.match(
      serviceSource,
      new RegExp(`"${field}"`),
      `O campo ${field} deve estar na lista de campos bloqueados.`,
    );
  }

  assert.match(serviceSource, /PROJECT_METADATA_FIELD_NOT_EDITABLE/);
  assert.match(metadataSource, /patch:\s*body/);
});

test("serviço valida limites, normaliza e exige metadataVersion", () => {
  assert.match(serviceSource, /PROJECT_NAME_MIN_LENGTH\s*=\s*3/);
  assert.match(serviceSource, /PROJECT_NAME_MAX_LENGTH\s*=\s*120/);
  assert.match(serviceSource, /PROJECT_DESCRIPTION_MAX_LENGTH\s*=\s*1000/);
  assert.match(serviceSource, /normalizeProjectName/);
  assert.match(serviceSource, /normalizeProjectDescription/);
  assert.match(serviceSource, /PROJECT_METADATA_VERSION_REQUIRED/);
  assert.match(serviceSource, /metadata_version\s*=\s*\?/);
});

test("conflito usa 409, código padronizado e snapshot atual", () => {
  assert.match(serviceSource, /PROJECT_METADATA_VERSION_CONFLICT/);
  assert.match(
    serviceSource,
    /createProjectServiceError\([\s\S]*409[\s\S]*PROJECT_METADATA_VERSION_CONFLICT/,
  );
  assert.match(metadataSource, /status\s*===\s*409/);
  assert.match(metadataSource, /currentProject:\s*error\?\.currentProject/);
});

test("auditoria registra campos alterados sem copiar descrição completa", () => {
  assert.match(metadataSource, /changedMetadataFields\(body\)/);
  assert.match(metadataSource, /changedFields,/);
  assert.match(metadataSource, /previousVersion,/);
  assert.match(metadataSource, /newVersion:\s*updated\.metadataVersion/);

  const updateAuditBlock = compact(metadataSource).match(
    /"projects\.metadata\.update", "success", \{([^}]+)\}/,
  );
  assert.ok(updateAuditBlock, "O bloco de auditoria de atualização deve existir.");
  assert.doesNotMatch(updateAuditBlock[1], /body\.description/);
  assert.doesNotMatch(updateAuditBlock[1], /description:/);
});

test("payload público de metadados não expõe e-mail nem campos Dropbox", () => {
  const publicSerializer = serviceSource.match(
    /export function serializePublicProjectMetadata\(project\) \{([\s\S]*?)\n\}/,
  );

  assert.ok(publicSerializer, "Serializador público deve existir.");
  assert.doesNotMatch(publicSerializer[1], /\bemail\b/i);
  assert.doesNotMatch(publicSerializer[1], /dropbox/i);
  assert.doesNotMatch(publicSerializer[1], /default_config_file/i);
  assert.doesNotMatch(metadataSource, /\bemail\s*:/i);
});

test("salvamento mantém autoria no commit atômico sem reescrever metadataVersion", () => {
  assert.match(revisionsSource,/updated_by = \?/);
  assert.match(revisionsSource,/updated_by_name_snapshot = \?/);
  assert.doesNotMatch(revisionsSource,/metadata_version\s*=\s*metadata_version/);
  assert.doesNotMatch(serviceSource,/export async function touchProjectAfterConfigSave/);
});
test("preview permanece independente do recibo publicado",()=>{
  assert.match(revisionsSource,/preview_status = CASE/);
  assert.match(revisionsSource,/operation.kind === 'legacy-promotion'/);
  assert.match(revisionsSource,/receipt_json/);
});
test("leitura compatível conserva metadata e lifecycle públicos sem storage privado",()=>{
  assert.match(configSource,/publicProject\(project\)/);
  assert.match(configSource,/publicProjectLifecycle\(project\)/);
  assert.match(configServiceSource,/readPublishedProjectConfig/);
  assert.doesNotMatch(configSource,/config_storage_ref\s*:|config_checksum\s*:/);
});
