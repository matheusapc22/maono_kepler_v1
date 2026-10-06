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
  "../functions/_lib/project-creation-reservation.js",
  import.meta.url,
);
const saveButtonUrl = new URL(
  "../src/pages/Kepler/components/maono-save-button.tsx",
  import.meta.url,
);
const saveResilienceUrl = new URL(
  "../src/pages/Kepler/durable-save-controller.ts",
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
  saveResilience,
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
  readFile(saveResilienceUrl, "utf8"),
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

  const nextExport = source.indexOf("\nexport ", position);
  const nextFunction = source.indexOf("\nasync function ", position + 1);
  const nextPlainFunction = source.indexOf("\nfunction ", position + 1);
  const nested = /\n  (?:async )?function /.exec(source.slice(position + 1));
  const nextNested = nested ? position + 1 + nested.index : -1;
  const candidates = [nextExport, nextFunction, nextPlainFunction, nextNested]
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

test("POST público reserva metadata com project.create e organização ativa antes do upload", () => {
  assert.match(projectsIndex, /reserveProjectCreation/);
  assert.match(creationService, /"project\.create"/);
  assert.match(creationService, /requirePermission\(/);
  assert.match(creationService, /getActiveOrganizationId\(user\)/);
  assert.match(creationService, /ORGANIZATION_CONTEXT_MISMATCH/);
  assert.match(creationService, /createProjectRecord/);
  assert.match(creationService, /active:\s*false/);
  assert.match(creationService, /idempotency_key/);
  assert.match(creationService, /getCreationByKey/);
});

test("Novo mapa e mapa existente exigem capability, conta e organização", () => {
  assert.match(saveButton, /authenticated && actorId && organizationId && context\?\.capabilities\?\.saveMap/);
  assert.match(saveButton, /if \(!allowed\) \{ return null;/);
  assert.match(saveButton, /"Salvar como projeto"/);
  assert.match(saveButton, /<ProjectCreatePanel/);
});

test("mapa existente mantém optimistic concurrency e nunca remonta o rascunho após resposta", () => {
  assert.match(saveResilience, /save-operations/);
  assert.match(saveResilience, /mutate\(`\$\{path\}\/payload`, "PUT", snapshot\.serialized\.body\)/);
  assert.match(saveButton, /handleExistingProjectSave/);
  assert.match(saveButton, /expectedConfigRevision/);
  assert.match(saveButton, /context\?\.version/);
  assert.doesNotMatch(saveButton, /\brefresh\(/);
  assert.match(saveButton, /if \(matches\) expectedRevisionRef\.current/);
});

test("criação serializa o clique uma vez; thumbnail independente usa snapshot salvo", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  assert.equal((create.match(/captureClickedConfig\(\)/g) || []).length, 1);
  assert.match(create, /executeProjectCreateFlow\(/);
  assert.match(create, /config: clicked\.config/);
  assert.match(saveButton, /savedConfig: clicked\.config/);
  assert.match(create, /prepareClickedPreview/);
  assert.match(saveButton, /enqueueProjectThumbnailJob/);
  assert.match(saveButton, /operationInFlightRef\.current/);
});

test("todo tamanho usa reserva durável e os mesmos bytes sem envelope inline", () => {
  assert.equal((createTransport.match(/serializeMapConfigTransport\(attempt, config, 0\)/g) || []).length, 1);
  assert.match(createTransport, /durableSave: true/);
  assert.match(createTransport, /configMetadata:/);
  assert.doesNotMatch(createTransport, /appendRawConfigToJsonEnvelope/);
  assert.match(createFlow, /fetchImpl\("\/api\/projects"/);
  assert.match(createFlow, /transport: prepared\.configTransport/);
  assert.match(createFlow, /executePreparedProjectUpdate/);
  assert.match(saveResilience, /headers\["X-Maono-Creation-Key"\] = creation\.idempotencyKey/);
});

test("sucesso só redireciona após ACTIVE e se não houve edição posterior", () => {
  const create = functionBlock(saveButton, "handleCreateProject");
  assert.match(saveButton, /useNavigate\(\)/);
  assert.match(createFlow, /if \(!isProjectCreationActive\(result\.data\)\)/);
  assert.ok(create.indexOf("executeProjectCreateFlow") < create.indexOf("navigate("));
  assert.match(create, /if \(confirmationMatchesEditor\(result\.snapshot, editorSessionId\.current, editGeneration\.current\)\) navigate/);
  assert.match(saveButton, /Exporte as edições posteriores/);
});

test("retry reutiliza metadata, idempotency key e bytes persistidos antes da reserva", () => {
  assert.doesNotMatch(saveButton, /sessionStorage/);
  assert.match(createFlow, /await store\.put\(snapshot\)/);
  assert.match(createFlow, /body: snapshot\.creation\.requestBody/);
  assert.match(createFlow, /snapshot = recovery/);
  assert.match(createFlow, /if \(!snapshot\.projectSlug\)/);
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
  assert.match(createPanel, /busy \|\| phase === "error"/);
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
