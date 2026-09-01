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
  "../functions/_lib/project-config-revisions.js",
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

test("salvamento do mapa mantém último editor no Control Plane", () => {
  assert.match(configSource, /saveProjectConfig/);
  assert.match(configSource, /touchProjectAfterConfigSave/);
  assert.match(
    configSource,
    /actor:\s*\{\s*id:\s*user\.id,\s*name:\s*user\.name/,
  );
  assert.match(configServiceSource, /touchProjectAfterConfigSave\(env/);
  assert.match(revisionsSource, /updated_by = \?/);
  assert.match(revisionsSource, /updated_by_name_snapshot = \?/);
});

test("salvar mapa não incrementa metadata_version", () => {
  const touchFunction = serviceSource.match(
    /export async function touchProjectAfterConfigSave\([\s\S]*?\n\}/,
  );

  assert.ok(touchFunction, "touchProjectAfterConfigSave deve existir.");
  assert.match(touchFunction[0], /updated_by\s*=/);
  assert.match(touchFunction[0], /updated_by_name_snapshot\s*=/);
  assert.match(touchFunction[0], /updated_at\s*=\s*CURRENT_TIMESTAMP/);
  assert.doesNotMatch(
    touchFunction[0],
    /metadata_version\s*=\s*metadata_version\s*\+\s*1/,
  );
  assert.doesNotMatch(revisionsSource, /metadata_version\s*=\s*metadata_version/);
});

test("política de preview continua independente do salvamento do JSON", () => {
  assert.match(configSource, /const saved = await saveProjectConfig/);
  assert.match(configSource, /asyncThumbnailEnabled\(env\)/);
  assert.match(configSource, /configRevision/);
  assert.match(configSource, /preview_status = 'PENDING'|thumbnailState/);
  assert.match(
    configSource,
    /combineHeaders\(saveTrace,\s*deploymentMetadata\)/,
  );
  assert.match(configServiceSource, /publishProjectConfigRevision/);

  const saveIndex = configSource.indexOf("const saved = await saveProjectConfig");
  const previewIndex = configSource.indexOf("!asyncThumbnailEnabled(env)");
  assert.ok(saveIndex >= 0 && previewIndex > saveIndex);
});

test("resposta do config inclui último editor, versão e lifecycle seguro", () => {
  assert.match(configSource, /updatedBy:\s*base\.updatedBy\s*\?\?\s*null/);
  assert.match(configSource, /metadataVersion:\s*Number\(/);
  assert.match(configSource, /publicProjectForConfigResponse\(updatedProject\)/);
  assert.match(configSource, /lifecycle:\s*publicProjectLifecycle\(updatedProject\)/);
  assert.doesNotMatch(
    configSource.match(/function publicProjectForConfigResponse[\s\S]*?\n\}/)?.[0] || "",
    /config_storage_ref|config_checksum\s*:/,
  );
});
