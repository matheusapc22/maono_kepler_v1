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
const createFlowUrl = new URL(
  "../src/pages/Kepler/project-create-flow.ts",
  import.meta.url,
);
const createTransportUrl = new URL(
  "../src/pages/Kepler/project-create-transport.ts",
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
  createFlow,
  createTransport,
  packageSource,
] = await Promise.all([
  readFile(adminIndexUrl, "utf8"),
  readFile(adminIdUrl, "utf8"),
  readFile(projectsIndexUrl, "utf8"),
  readFile(creationServiceUrl, "utf8"),
  readFile(saveButtonUrl, "utf8"),
  readFile(createPanelUrl, "utf8"),
  readFile(createFlowUrl, "utf8"),
  readFile(createTransportUrl, "utf8"),
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

  const nextExport = source.indexOf("busy \\|\\| phase === "error"nexport ", position);
  const nextFunction = source.indexOf("busy \\|\\| phase === "error"nasync function ", position + 1);
  const nextPlainFunction = source.indexOf("busy \\|\\| phase === "error"nfunction ", position + 1);
  const candidates = [nextExport, nextFunction, nextPlainFunction]
    .filter((value) => value > position);

  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(position, end);
}

test("criação administrativa continua delegada ao serviço central", () => {
  assert.match(adminIndex, /createProjectRecord/);
  assert.doesNotMatch(
    functionBlock(adminIndex, "createProject"),
    /INSERTbusy \\|\\| phase === "error"s+INTObusy \\|\\| phase === "error"s+projects/i,
  );
  assert.match(
    functionBlock(adminIndex, "createProject"),
    /actor:busy \\|\\| phase === "error"s*busy \\|\\| phase === "error"{busy \\|\\| phase === "error"s*id:busy \\|\\| phase === "error"s*actorbusy \\|\\| phase === "error".id,busy \\|\\| phase === "error"s*name:busy \\|\\| phase === "error"s*actorbusy \\|\\| phase === "error".name/,
  );
});

test("ator administrativo vem da sessão e creator permanece imutável", () => {
  assert.doesNotMatch(adminIndex, /bodybusy \\|\\| phase === "error"?busy \\|\\| phase === "error".createdBy/);
  assert.doesNotMatch(adminIndex, /bodybusy \\|\\| phase === "error"?busy \\|\\| phase === "error".created_by/);

  const update = functionBlock(adminId, "updateProject");
  assert.match(update, /updated_bybusy \\|\\| phase === "error"s*=busy \\|\\| phase === "error"s*busy \\|\\| phase === "error"?/);
  assert.doesNotMatch(update, /created_bybusy \\|\\| phase === "error"s*=/);
});

test("metadataVersion administrativa continua condicional", () => {
  const update = functionBlock(adminId, "updateProject");

  assert.match(
    update,
    /metadataChangedbusy \\|\\| phase === "error"s*=busy \\|\\| phase === "error"s*changedFieldsbusy \\|\\| phase === "error".includesbusy \\|\\| phase === "error"("name"busy \\|\\| phase === "error")busy \\|\\| phase === "error"s*busy \\|\\| phase === "error"|busy \\|\\| phase === "error"|busy \\|\\| phase === "error"s*changedFieldsbusy \\|\\| phase === "error".includesbusy \\|\\| phase === "error"("description"busy \\|\\| phase === "error")/,
  );
  assert.match(
    update,
    /metadata_versionbusy \\|\\| phase === "error"s*=busy \\|\\| phase === "error"s*metadata_versionbusy \\|\\| phase === "error"s*busy \\|\\| phase === "error"+busy \\|\\| phase === "error"s*busy \\|\\| phase === "error"?/,
  );
});

test("POST público delega ao lifecycle service com project.create e organização ativa", () => {
  assert.match(projectsIndex, /createProjectFromKepler/);
  assert.match(creationService, /"projectbusy \\|\\| phase === "error".create"/);
  assert.match(creationService, /requirePermissionbusy \\|\\| phase === "error"(/);
  assert.match(creationService, /getActiveOrganizationIdbusy \\|\\| phase === "error"(userbusy \\|\\| phase === "error")/);
  assert.match(creationService, /ORGANIZATION_CONTEXT_MISMATCH/);
});

test("criação completa começa DRAFT e inativa antes da preparação", () => {
  const createPending = functionBlock(
    creationService,
    "createOrLoadPendingProject",
  );

  assert.match(createPending, /createProjectRecord/);
  assert.match(createPending, /active:busy \\|\\| phase === "error"s*false/);
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
  assert.match(creationService, /access_levelbusy \\|\\| phase === "error"s*busy \\|\\| phase === "error")busy \\|\\| phase === "error"s*VALUES busy \\|\\| phase === "error"(busy \\|\\| phase === "error"?, busy \\|\\| phase === "error"?, 'owner'busy \\|\\| phase === "error")/);
});

test("falha parcial mantém projeto fora de ACTIVE e auditado", () => {
  assert.match(creationService, /markCreationFailed/);
  assert.match(creationService, /markProjectLifecycleFailed/);
  assert.match(creationService, /PROJECT_LIFECYCLE_STATESbusy \\|\\| phase === "error".FAILED|toState:busy \\|\\| phase === "error"s*PROJECT_LIFECYCLE_STATESbusy \\|\\| phase === "error".FAILED/);
  assert.match(creationService, /action:busy \\|\\| phase === "error"s*"projectbusy \\|\\| phase === "error".createbusy \\|\\| phase === "error".failed"/);
  assert.match(creationService, /retryable:busy \\|\\| phase === "error"s*true/);
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
  assert.match(creationService, /projectbusy \\|\\| phase === "error".createbusy \\|\\| phase === "error".idempotent/);
  assert.match(creationService, /PROJECT_LIFECYCLE_STATESbusy \\|\\| phase === "error".FAILED/);
});

test("Novo mapa exibe botão somente com capacidade backend sem projectSlug", () => {
  assert.match(
    saveButton,
    /contextbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".capabilitiesbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".saveMap/,
  );
  assert.match(
    saveButton,
    /authenticatedbusy \\|\\| phase === "error"s*&&busy \\|\\| phase === "error"s*!projectSlugbusy \\|\\| phase === "error"s*&&busy \\|\\| phase === "error"s*activeOrganizationIdbusy \\|\\| phase === "error"s*&&busy \\|\\| phase === "error"s*contextbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".capabilitiesbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".saveMap/,
  );
  assert.match(
    saveButton,
    /const allowed = projectSlug busy \\|\\| phase === "error"? canSaveExisting : canCreateNew/,
  );
  assert.match(saveButton, /"Salvar como projeto"/);
  assert.match(saveButton, /<ProjectCreatePanel/);
});

test("mapa existente mantém PUT de config com optimistic concurrency", () => {
  assert.match(
    saveButton,
    /projectSlugbusy \\|\\| phase === "error"s*&&busy \\|\\| phase === "error"s*contextbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".capabilitiesbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".saveMap/,
  );
  assert.match(
    saveButton,
    /`busy \\|\\| phase === "error"/apibusy \\|\\| phase === "error"/projectsbusy \\|\\| phase === "error"/busy \\|\\| phase === "error"$busy \\|\\| phase === "error"{encodeURIComponentbusy \\|\\| phase === "error"(projectSlugbusy \\|\\| phase === "error")busy \\|\\| phase === "error"}busy \\|\\| phase === "error"/config`/,
  );
  assert.match(saveButton, /method:busy \\|\\| phase === "error"s*"PUT"/);
  assert.match(saveButton, /handleExistingProjectSave/);
  assert.match(saveButton, /expectedConfigRevision/);
  assert.match(saveButton, /contextbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".version/);
  assert.match(saveButton, /void refreshbusy \\|\\| phase === "error"(busy \\|\\| phase === "error")/);
});

test("criação serializa o mapa uma vez e delega a classificação de transporte", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  assert.equal(
    (create.match(/serializeProjectConfigbusy \\|\\| phase === "error"(mapStatebusy \\|\\| phase === "error")/g) || []).length,
    1,
  );
  assert.equal(
    (create.match(/captureProjectThumbnailbusy \\|\\| phase === "error"(/g) || []).length,
    0,
  );
  assert.match(create, /executeProjectCreateFlowbusy \\|\\| phase === "error"(/);
  assert.match(create, /idempotencyKey,/);
  assert.match(create, /config,/);
  assert.match(create, /legacy,/);
  assert.match(
    create,
    /enqueuePreviewbusy \\|\\| phase === "error"(resultbusy \\|\\| phase === "error".createdSlug, resultbusy \\|\\| phase === "error".revision, configbusy \\|\\| phase === "error")/,
  );
  assert.match(saveButton, /operationInFlightRefbusy \\|\\| phase === "error".current/);
});

test("criação escolhe inline ou metadata-first + streaming sem duplicar o JSON do MapConfig", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  const legacyCapture = functionBlock(saveButton, "legacyCapture");

  assert.match(create, /executeProjectCreateFlowbusy \\|\\| phase === "error"(/);
  assert.match(createTransport, /serializeMapConfigTransportbusy \\|\\| phase === "error"(attempt, config, 0busy \\|\\| phase === "error")/);
  assert.equal(
    (createTransport.match(/serializeMapConfigTransportbusy \\|\\| phase === "error"(attempt, config, 0busy \\|\\| phase === "error")/g) || []).length,
    1,
  );
  assert.match(createTransport, /largeConfig:busy \\|\\| phase === "error"s*true/);
  assert.match(createTransport, /configMetadata:/);
  assert.match(createTransport, /appendRawConfigToJsonEnvelope/);

  assert.match(createFlow, /fetchImplbusy \\|\\| phase === "error"("busy \\|\\| phase === "error"/apibusy \\|\\| phase === "error"/projects"/);
  assert.match(createFlow, /method:busy \\|\\| phase === "error"s*"POST"/);
  assert.match(createFlow, /forceJson:busy \\|\\| phase === "error"s*true/);
  assert.match(
    createFlow,
    /`busy \\|\\| phase === "error"/apibusy \\|\\| phase === "error"/projectsbusy \\|\\| phase === "error"/busy \\|\\| phase === "error"$busy \\|\\| phase === "error"{encodeURIComponentbusy \\|\\| phase === "error"(slugbusy \\|\\| phase === "error")busy \\|\\| phase === "error"}busy \\|\\| phase === "error"/config`/,
  );
  assert.match(createFlow, /method:busy \\|\\| phase === "error"s*"PUT"/);
  assert.match(createFlow, /"X-Maono-Creation-Key":busy \\|\\| phase === "error"s*idempotencyKey/);
  assert.match(createFlow, /body:busy \\|\\| phase === "error"s*preparedbusy \\|\\| phase === "error".configBody/);
  assert.match(createFlow, /preparedbusy \\|\\| phase === "error".large && !isProjectCreationActivebusy \\|\\| phase === "error"(finalDatabusy \\|\\| phase === "error")/);
  assert.match(createFlow, /if busy \\|\\| phase === "error"(!isProjectCreationActivebusy \\|\\| phase === "error"(finalDatabusy \\|\\| phase === "error")busy \\|\\| phase === "error")/);

  assert.match(create, /const legacy = await legacyCapturebusy \\|\\| phase === "error"(configbusy \\|\\| phase === "error")/);
  assert.match(
    legacyCapture,
    /if busy \\|\\| phase === "error"(ASYNC_THUMBNAIL_ENABLEDbusy \\|\\| phase === "error") busy \\|\\| phase === "error"{busy \\|\\| phase === "error"s*return null;/,
  );
});

test("sucesso só redireciona após o fluxo confirmar ACTIVE", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  const execute = functionBlock(createFlow, "executeProjectCreateFlow");

  assert.match(saveButton, /useNavigatebusy \\|\\| phase === "error"(busy \\|\\| phase === "error")/);
  assert.match(
    saveButton,
    /`busy \\|\\| phase === "error"/projectsbusy \\|\\| phase === "error"/busy \\|\\| phase === "error"$busy \\|\\| phase === "error"{encodeURIComponentbusy \\|\\| phase === "error"(resultbusy \\|\\| phase === "error".createdSlugbusy \\|\\| phase === "error")busy \\|\\| phase === "error"}busy \\|\\| phase === "error"/edit`/,
  );
  assert.match(saveButton, /busy \\|\\| phase === "error"{busy \\|\\| phase === "error"s*replace:busy \\|\\| phase === "error"s*truebusy \\|\\| phase === "error"s*busy \\|\\| phase === "error"}/);
  assert.match(execute, /if busy \\|\\| phase === "error"(!isProjectCreationActivebusy \\|\\| phase === "error"(finalDatabusy \\|\\| phase === "error")busy \\|\\| phase === "error")/);
  assert.ok(
    create.indexOf("executeProjectCreateFlow") <
      create.indexOf("navigate("),
  );
  assert.ok(
    create.indexOf("clearCreationKey(activeOrganizationId)") <
      create.indexOf("navigate("),
  );
});

test("retry reutiliza idempotency key e só limpa a chave após ACTIVE", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  assert.match(saveButton, /windowbusy \\|\\| phase === "error".sessionStoragebusy \\|\\| phase === "error".getItem/);
  assert.match(saveButton, /windowbusy \\|\\| phase === "error".sessionStoragebusy \\|\\| phase === "error".setItem/);
  assert.match(saveButton, /getOrCreateCreationKey/);
  assert.match(saveButton, /clearCreationKey/);
  assert.ok(
    create.indexOf("const idempotencyKey = getOrCreateCreationKey") <
      create.indexOf("executeProjectCreateFlow"),
  );
  assert.ok(
    create.indexOf("executeProjectCreateFlow") <
      create.indexOf("clearCreationKey(activeOrganizationId)"),
  );
  assert.match(
    createFlow,
    /preparedbusy \\|\\| phase === "error".large && !isProjectCreationActivebusy \\|\\| phase === "error"(finalDatabusy \\|\\| phase === "error")/,
  );
});

test("painel valida título e descrição sem campo de slug", () => {
  assert.match(createPanel, /name="name"/);
  assert.match(createPanel, /name="description"/);
  assert.match(createPanel, /minLength=busy \\|\\| phase === "error"{3busy \\|\\| phase === "error"}/);
  assert.match(createPanel, /maxLength=busy \\|\\| phase === "error"{120busy \\|\\| phase === "error"}/);
  assert.match(createPanel, /maxLength=busy \\|\\| phase === "error"{1000busy \\|\\| phase === "error"}/);
  assert.doesNotMatch(createPanel, /name="slug"/);
});

test("painel mostra organização, progresso e bloqueia fechamento crítico", () => {
  assert.match(createPanel, /Organização ativa/);
  assert.match(createPanel, /Criando registro/);
  assert.match(createPanel, /Preparando arquivos/);
  assert.match(createPanel, /Vinculando usuário/);
  assert.match(createPanel, /Finalizando/);
  assert.match(createPanel, /if busy \\|\\| phase === "error"(busybusy \\|\\| phase === "error") busy \\|\\| phase === "error"{busy \\|\\| phase === "error"s*return;/);
  assert.match(createPanel, /aria-modal="true"/);
  assert.match(createPanel, /eventbusy \\|\\| phase === "error".key !== "Tab"/);
});

test("retry mantém título e descrição da tentativa idempotente", () => {
  assert.match(saveButton, /setCreationDraftbusy \\|\\| phase === "error"(inputbusy \\|\\| phase === "error")/);
  assert.match(saveButton, /initialName=busy \\|\\| phase === "error"{creationDraftbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".namebusy \\|\\| phase === "error"}/);
  assert.match(
    saveButton,
    /initialDescription=busy \\|\\| phase === "error"{creationDraftbusy \\|\\| phase === "error"?busy \\|\\| phase === "error".descriptionbusy \\|\\| phase === "error"}/,
  );
  assert.match(createPanel, /initialNamebusy \\|\\| phase === "error"?: string/);
  assert.match(createPanel, /initialDescriptionbusy \\|\\| phase === "error"?: string/);
  assert.match(createPanel, /busy \\|\\| phase === "error"|busy \\|\\| phase === "error"|busy \\|\\| phase === "error"/);
});

test("package consolida metadata e lifecycle nos gates de projeto", () => {
  const script = packageJson.scripts["test:project-metadata"];

  assert.ok(script);
  assert.match(script, /project-metadata-migrationbusy \\|\\| phase === "error".testbusy \\|\\| phase === "error".mjs/);
  assert.match(script, /project-metadata-apibusy \\|\\| phase === "error".testbusy \\|\\| phase === "error".mjs/);
  assert.match(script, /project-card-actionsbusy \\|\\| phase === "error".testbusy \\|\\| phase === "error".mjs/);
  assert.match(script, /project-creation-metadatabusy \\|\\| phase === "error".testbusy \\|\\| phase === "error".mjs/);
  assert.match(packageJson.scripts["test:project-lifecycle"], /project-lifecyclebusy \\|\\| phase === "error".testbusy \\|\\| phase === "error".mjs/);
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

    assert.doesNotMatch(script, /busy \\|\\| phase === "error"b(seed|migration|migrations apply)busy \\|\\| phase === "error"b/i);
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
