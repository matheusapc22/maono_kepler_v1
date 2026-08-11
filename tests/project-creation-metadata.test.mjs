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
const creationServiceUrl = new URL(
  "../functions/_lib/project-creation-lifecycle-service.js",
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
  creationService,
  saveButton,
  createPanel,
  packageSource,
] = await Promise.all([
  readFile(adminIndexUrl, "utf8"),
  readFile(adminIdUrl, "utf8"),
  readFile(projectsIndexUrl, "utf8"),
  readFile(creationServiceUrl, "utf8"),
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

test("POST público delega ao lifecycle service com project.create e organização ativa", () => {
  assert.match(projectsIndex, /createProjectFromKepler/);
  assert.match(creationService, /"project\.create"/);
  assert.match(creationService, /requirePermission\(/);
  assert.match(creationService, /getActiveOrganizationId\(user\)/);
  assert.match(creationService, /ORGANIZATION_CONTEXT_MISMATCH/);
});

test("criação completa começa DRAFT e inativa antes da preparação", () => {
  const createPending = functionBlock(
    creationService,
    "createOrLoadPendingProject",
  );

  assert.match(createPending, /createProjectRecord/);
  assert.match(createPending, /active:\s*false/);
  assert.match(createPending, /initializeProjectDraft/);
  assert.match(creationService, /lifecycle_state = 'DRAFT'/);
  assert.match(creationService, /status = 'PROCESSING'/);
  assert.match(creationService, /status = 'ERROR'/);
});

test("ativação exige revision pronta e owner, sem depender do preview", () => {
  const finalize = functionBlock(
    creationService,
    "finalizeProjectCreation",
  );

  const preparingIndex = finalize.indexOf("enterPreparingStorage");
  const configIndex = finalize.indexOf("ensureInitialConfigPublished");
  const readyIndex = finalize.indexOf("enterConfigReady");
  const ownerIndex = finalize.indexOf("linkProjectOwner");
  const fileIndex = finalize.indexOf("markOrganizationFileActive");
  const activateIndex = finalize.indexOf("activateProject");
  const previewIndex = finalize.indexOf("saveLegacyCreationPreview");

  assert.ok(preparingIndex >= 0);
  assert.ok(configIndex > preparingIndex);
  assert.ok(readyIndex > configIndex);
  assert.ok(ownerIndex > readyIndex);
  assert.ok(fileIndex > ownerIndex);
  assert.ok(activateIndex > fileIndex);
  assert.ok(previewIndex > activateIndex);
  assert.match(creationService, /PREPARING_STORAGE/);
  assert.match(creationService, /CONFIG_READY/);
  assert.match(creationService, /access_level\s*\)\s*VALUES \(\?, \?, 'owner'\)/);
});

test("falha parcial mantém projeto fora de ACTIVE e auditado", () => {
  assert.match(creationService, /markCreationFailed/);
  assert.match(creationService, /markProjectLifecycleFailed/);
  assert.match(creationService, /PROJECT_LIFECYCLE_STATES\.FAILED|toState:\s*PROJECT_LIFECYCLE_STATES\.FAILED/);
  assert.match(creationService, /action:\s*"project\.create\.failed"/);
  assert.match(creationService, /retryable:\s*true/);
  assert.match(
    creationService,
    /O projeto permaneceu inativo e pode ser retomado/,
  );
});

test("idempotência usa chave persistida, reserva única e retry de lifecycle", () => {
  assert.match(creationService, /idempotency_key/);
  assert.match(creationService, /getCreationReservation/);
  assert.match(creationService, /claimReservation/);
  assert.match(creationService, /PROJECT_CREATION_IN_PROGRESS/);
  assert.match(creationService, /project\.create\.idempotent/);
  assert.match(creationService, /PROJECT_LIFECYCLE_STATES\.FAILED/);
});

test("Novo mapa exibe botão somente com capacidade backend sem projectSlug", () => {
  assert.match(
    saveButton,
    /context\?\.capabilities\?\.saveMap/,
  );
  assert.match(
    saveButton,
    /authenticated\s*&&\s*!projectSlug\s*&&\s*activeOrganizationId\s*&&\s*context\?\.capabilities\?\.saveMap/,
  );
  assert.match(
    saveButton,
    /const allowed = projectSlug \? canSaveExisting : canCreateNew/,
  );
  assert.match(saveButton, /"Salvar como projeto"/);
  assert.match(saveButton, /<ProjectCreatePanel/);
});

test("mapa existente mantém PUT de config com optimistic concurrency", () => {
  assert.match(
    saveButton,
    /projectSlug\s*&&\s*context\?\.capabilities\?\.saveMap/,
  );
  assert.match(
    saveButton,
    /`\/api\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/config`/,
  );
  assert.match(saveButton, /method:\s*"PUT"/);
  assert.match(saveButton, /handleExistingProjectSave/);
  assert.match(saveButton, /expectedConfigRevision/);
  assert.match(saveButton, /context\?\.version/);
  assert.match(saveButton, /void refresh\(\)/);
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

test("package consolida metadata e lifecycle nos gates de projeto", () => {
  const script = packageJson.scripts["test:project-metadata"];

  assert.ok(script);
  assert.match(script, /project-metadata-migration\.test\.mjs/);
  assert.match(script, /project-metadata-api\.test\.mjs/);
  assert.match(script, /project-card-actions\.test\.mjs/);
  assert.match(script, /project-creation-metadata\.test\.mjs/);
  assert.match(packageJson.scripts["test:project-lifecycle"], /project-lifecycle\.test\.mjs/);
  assert.match(
    packageJson.scripts["test:projects"],
    /test:project-cards.*test:project-metadata.*test:project-lifecycle/,
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
