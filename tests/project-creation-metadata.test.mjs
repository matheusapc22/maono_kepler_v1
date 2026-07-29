import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminIndexUrl = new URL(
  "../functions/api/admin/projects/index.js",
  import.meta.url,
);
const adminIdUrl = new URL(
  "../functions/api/admin/projects/[id].js",
  import.meta.url,
);
const projectsIndexUrl = new URL(
  "../functions/api/projects/index.js",
  import.meta.url,
);
const saveButtonUrl = new URL(
  "../src/pages/Kepler/components/maono-save-button.tsx",
  import.meta.url,
);
const createPanelUrl = new URL(
  "../src/pages/Kepler/components/project-create-panel.tsx",
  import.meta.url,
);
const packageUrl = new URL("../package.json", import.meta.url);

const [
  adminIndex,
  adminId,
  projectsIndex,
  saveButton,
  createPanel,
  packageSource,
] = await Promise.all([
  readFile(adminIndexUrl, "utf8"),
  readFile(adminIdUrl, "utf8"),
  readFile(projectsIndexUrl, "utf8"),
  readFile(saveButtonUrl, "utf8"),
  readFile(createPanelUrl, "utf8"),
  readFile(packageUrl, "utf8"),
]);

const packageJson = JSON.parse(packageSource);

function functionBlock(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  const asyncStart = source.indexOf(`async function ${functionName}`);
  const position =
    asyncStart >= 0 && (start < 0 || asyncStart < start)
      ? asyncStart
      : start;

  assert.notEqual(position, -1, `A função ${functionName} deve existir.`);

  const nextExport = source.indexOf("\nexport ", position);
  const nextFunction = source.indexOf("\nasync function ", position + 1);
  const nextPlainFunction = source.indexOf("\nfunction ", position + 1);
  const candidates = [nextExport, nextFunction, nextPlainFunction]
    .filter((value) => value > position);

  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(position, end);
}

test("criação administrativa continua delegada ao serviço central", () => {
  assert.match(adminIndex, /createProjectRecord/);
  assert.doesNotMatch(
    functionBlock(adminIndex, "createProject"),
    /INSERT\s+INTO\s+projects/i,
  );
  assert.match(
    functionBlock(adminIndex, "createProject"),
    /actor:\s*\{\s*id:\s*actor\.id,\s*name:\s*actor\.name/,
  );
});

test("ator administrativo vem da sessão e creator permanece imutável", () => {
  assert.doesNotMatch(adminIndex, /body\?\.createdBy/);
  assert.doesNotMatch(adminIndex, /body\?\.created_by/);

  const update = functionBlock(adminId, "updateProject");
  assert.match(update, /updated_by\s*=\s*\?/);
  assert.doesNotMatch(update, /created_by\s*=/);
});

test("metadataVersion administrativa continua condicional", () => {
  const update = functionBlock(adminId, "updateProject");

  assert.match(
    update,
    /metadataChanged\s*=\s*changedFields\.includes\("name"\)\s*\|\|\s*changedFields\.includes\("description"\)/,
  );
  assert.match(
    update,
    /metadata_version\s*=\s*metadata_version\s*\+\s*\?/,
  );
});

test("POST público exige project.create e organização ativa", () => {
  assert.match(projectsIndex, /"project\.create"/);
  assert.match(projectsIndex, /requirePermission\(/);
  assert.match(projectsIndex, /getActiveOrganizationId\(user\)/);
  assert.match(projectsIndex, /ORGANIZATION_CONTEXT_MISMATCH/);
});

test("criação completa começa inativa antes dos arquivos", () => {
  const createPending = functionBlock(
    projectsIndex,
    "createOrLoadPendingProject",
  );

  assert.match(createPending, /createProjectRecord/);
  assert.match(createPending, /active:\s*false/);
  assert.match(projectsIndex, /status = 'PROCESSING'/);
  assert.match(projectsIndex, /status = 'ERROR'/);
});

test("ativação depende do JSON e owner, sem bloquear no preview assíncrono", () => {
  const finalize = functionBlock(
    projectsIndex,
    "finalizeProjectCreation",
  );

  const folderIndex = finalize.indexOf("ensureDropboxFolder");
  const configIndex = finalize.indexOf("uploadDropboxTextFile");
  const ownerIndex = finalize.indexOf("INSERT INTO user_projects");
  const activateIndex = finalize.indexOf("active = 1");

  assert.ok(folderIndex >= 0);
  assert.ok(configIndex > folderIndex);
  assert.ok(ownerIndex > configIndex);
  assert.ok(activateIndex > ownerIndex);
  assert.match(finalize, /let previewStatus = "PENDING"/);
  assert.match(finalize, /if \(thumbnail\)/);
  assert.match(finalize, /access_level\s*\)\s*VALUES \(\?, \?, 'owner'\)/);
});

test("falha parcial mantém projeto invisível e auditado", () => {
  assert.match(projectsIndex, /markCreationFailed/);
  assert.match(projectsIndex, /SET active = 0/);
  assert.match(projectsIndex, /action:\s*"project\.create\.failed"/);
  assert.match(projectsIndex, /retryable:\s*true/);
  assert.match(
    projectsIndex,
    /O projeto permaneceu inativo e pode ser retomado/,
  );
});

test("idempotência usa chave persistida e reserva única", () => {
  assert.match(projectsIndex, /idempotency_key/);
  assert.match(projectsIndex, /getCreationReservation/);
  assert.match(projectsIndex, /claimReservation/);
  assert.match(projectsIndex, /PROJECT_CREATION_IN_PROGRESS/);
  assert.match(projectsIndex, /project\.create\.idempotent/);
});

test("Novo mapa exige contexto create e capabilities backend", () => {
  assert.match(
    saveButton,
    /context\?\.mode === "create"/,
  );

  for (const capability of [
    "openCreateWorkspace",
    "createProject",
    "initializeMap",
    "saveMap",
  ]) {
    assert.match(
      saveButton,
      new RegExp(\`context\\\\.capabilities\\\\.\${capability}\`),
      capability,
    );
  }

  assert.match(
    saveButton,
    /const allowed = projectSlug \? canSaveExisting : canCreateNew/,
  );
  assert.match(saveButton, /"Salvar como projeto"/);
  assert.match(saveButton, /<ProjectCreatePanel/);
});

test("mapa existente mantém PUT de config", () => {
  assert.match(
    saveButton,
    /projectSlug\s*&&\s*context\?\.capabilities\?\.saveMap/,
  );
  assert.match(
    saveButton,
    /`\/api\/projects\/\$\{encodeURIComponent\(\s*projectSlug/,
  );
  assert.match(saveButton, /method:\s*"PUT"/);
  assert.match(saveButton, /handleExistingProjectSave/);
});

test("criação serializa uma vez e não captura no caminho crítico", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  assert.equal(
    (create.match(/serializeProjectConfig\(mapState\)/g) || []).length,
    1,
  );
  assert.equal(
    (create.match(/captureProjectThumbnail\(/g) || []).length,
    0,
  );
  assert.match(create, /enqueuePreview\(createdSlug, revision, config\)/);
  assert.match(saveButton, /operationInFlightRef\.current/);
});

test("criação confirma JSON antes de enfileirar preview", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  const legacyCapture = functionBlock(saveButton, "legacyCapture");

  assert.match(create, /fetch\("\/api\/projects"/);
  assert.match(create, /method:\s*"POST"/);
  assert.match(create, /idempotencyKey,/);
  assert.match(create, /config,/);
  assert.match(create, /const legacy = await legacyCapture\(config\)/);
  assert.match(create, /thumbnailDataUrl:\s*legacy\.dataUrl/);
  assert.match(
    legacyCapture,
    /if \(ASYNC_THUMBNAIL_ENABLED\) \{\s*return null;/,
  );
  assert.ok(
    create.indexOf("!response.ok") <
      create.indexOf("enqueuePreview(createdSlug, revision, config)"),
  );
});

test("sucesso redireciona para a rota do projeto criado", () => {
  assert.match(saveButton, /useNavigate\(\)/);
  assert.match(
    saveButton,
    /`\/projects\/\$\{encodeURIComponent\(createdSlug\)\}\/edit`/,
  );
  assert.match(saveButton, /\{\s*replace:\s*true\s*\}/);
});

test("retry reutiliza idempotency key da organização", () => {
  assert.match(saveButton, /window\.sessionStorage\.getItem/);
  assert.match(saveButton, /window\.sessionStorage\.setItem/);
  assert.match(saveButton, /getOrCreateCreationKey/);
  assert.match(saveButton, /clearCreationKey/);
});

test("painel valida título e descrição sem campo de slug", () => {
  assert.match(createPanel, /name="name"/);
  assert.match(createPanel, /name="description"/);
  assert.match(createPanel, /minLength=\{3\}/);
  assert.match(createPanel, /maxLength=\{120\}/);
  assert.match(createPanel, /maxLength=\{1000\}/);
  assert.doesNotMatch(createPanel, /name="slug"/);
});

test("painel mostra organização, progresso e bloqueia fechamento crítico", () => {
  assert.match(createPanel, /Organização ativa/);
  assert.match(createPanel, /Criando registro/);
  assert.match(createPanel, /Preparando arquivos/);
  assert.match(createPanel, /Vinculando usuário/);
  assert.match(createPanel, /Finalizando/);
  assert.match(createPanel, /if \(busy\) \{\s*return;/);
  assert.match(createPanel, /aria-modal="true"/);
  assert.match(createPanel, /event\.key !== "Tab"/);
});

test("retry mantém título e descrição da tentativa idempotente", () => {
  assert.match(saveButton, /setCreationDraft\(input\)/);
  assert.match(saveButton, /initialName=\{creationDraft\?\.name\}/);
  assert.match(
    saveButton,
    /initialDescription=\{creationDraft\?\.description\}/,
  );
  assert.match(createPanel, /initialName\?: string/);
  assert.match(createPanel, /initialDescription\?: string/);
  assert.match(createPanel, /busy \|\| stage === "error"/);
});

test("package consolida os quatro testes de metadata", () => {
  const script = packageJson.scripts["test:project-metadata"];

  assert.ok(script);
  assert.match(script, /project-metadata-migration\.test\.mjs/);
  assert.match(script, /project-metadata-api\.test\.mjs/);
  assert.match(script, /project-card-actions\.test\.mjs/);
  assert.match(script, /project-creation-metadata\.test\.mjs/);
  assert.match(
    packageJson.scripts["test:projects"],
    /test:project-cards.*test:project-metadata/,
  );
});

test("build não dispara seed ou migration", () => {
  for (const scriptName of [
    "build",
    "postinstall",
    "prebuild",
    "deploy",
  ]) {
    const script = packageJson.scripts[scriptName];

    if (!script) {
      continue;
    }

    assert.doesNotMatch(script, /\b(seed|migration|migrations apply)\b/i);
  }
});

test("nenhuma dependência nova foi adicionada", () => {
  assert.ok(packageJson.dependencies.react);
  assert.ok(packageJson.dependencies["react-router"]);
  assert.equal(
    packageJson.dependencies["uuid"],
    undefined,
  );
});
