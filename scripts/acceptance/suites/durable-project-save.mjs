import { validateBeforeEvidence, RUN_MAX_AGE_MS } from "../manual-evidence.mjs";
import { createHash } from "node:crypto";
import { assertHttpResponse, fail } from "../production-acceptance-lib.mjs";
import { buildLargeCreateFixture } from "../../large-create/build-large-create-fixture.mjs";

const QA = Object.freeze({ id: 9, slug: "maono-preview-qa" });
const LARGE_BYTES = 94 * 1024 * 1024;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 8 * 60_000;

export const manifest = Object.freeze({
  id: "durable-project-save",
  version: 2,
  description: "Synthetic durable creation, historical receipts and independent outbox recovery",
  mutationMode: "controlled_mutation",
  mutationBudgetMs: 45 * 60_000,
  requiresBrowser: false,
  manualAdministration: true,
  requiredProfiles: ["creator"],
  requiredRoles: { creator: "editor" },
  requiredOrganization: QA,
  requiredPermissions: { creator: ["project.create"] },
  managedFlags: {
    PROJECT_DURABLE_SAVE_V1: { requiredBefore: false, activeValue: true, safeValue: false },
    PROJECT_DURABLE_SAVE_INLINE_ENABLED: { requiredBefore: true, activeValue: false, safeValue: true },
  },
  prerequisites: [
    "Migration 0039 separately audited, authorized, applied and post-validated",
    "Pages and independent scheduled Worker bindings audited; Worker provisioning/deployment separately approved",
    "Dedicated QA9 editor credential only; human Super Admin supplies checked inventory/cleanup exports without credentials in CI",
    "Fresh before-inventory export bound to suite, production SHA and run UUID in the QA bundle; no concurrent human QA changes during the bounded window",
    "PROJECT_QUOTA_RESERVATION_V1 absent or false in configured and canonical Pages environment; active quota cleanup has no public API",
  ],
  cleanup: {
    resources: "At most two new run-ID-scoped projects and their generated organization-file records",
    method: "CI never deletes. Human separately approves exact synthetic IDs, uses existing admin APIs and exports observed cleanup for offline verification",
    retention: "Immutable operation-owned storage objects, historical receipts and operation tombstones retained; no storage deletion or garbage collection",
    interruption: "Manual cleanup remains incomplete; uncertain reservation/closure blocks certification. Separate closure restores flags only",
  },
  cases: ["DS-SMALL", "DS-LARGE", "DS-IDEMPOTENT", "DS-LOST-ACK", "DS-HISTORICAL", "DS-STALE-CAS", "DS-OLD-CLIENT", "DS-CLEANUP"],
});

function check(condition, message, code = "ACCEPTANCE_ASSERTION_FAILED") {
  if (!condition) fail(code, message);
}
function status(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assertHttpResponse(response, allowed.includes(response.status) && response.body?.ok !== false, `${label}: HTTP ${response.status}, esperado ${allowed.join("/")}.`);
  return response.body;
}
function same(left, right, label) {
  check(JSON.stringify(left) === JSON.stringify(right), label);
}
function id(value) {
  check(Number.isSafeInteger(Number(value)) && Number(value) > 0, "Identidade sintética inválida.");
  return Number(value);
}
function assertContext(ctx) {
  check(ctx.organizationId === QA.id, "Organização fora do QA registrado.", "QA_ORGANIZATION_MISMATCH");
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.runId), "runId deve ser UUID do operador.", "QA_RUN_ID_INVALID");
  check(!ctx.projectSlug, "Esta suite cria projetos sintéticos; não aceita projeto existente.", "QA_EXISTING_PROJECT_FORBIDDEN");
  for (const name of manifest.requiredProfiles) {
    const profile = ctx.profiles[name];
    check(profile?.user?.role === manifest.requiredRoles[name], `Papel QA incorreto: ${name}.`, "QA_ROLE_MISMATCH");
    check(Number(profile.organization?.id) === QA.id && profile.organization?.slug === QA.slug, "Organização autenticada divergente.", "QA_ORGANIZATION_MISMATCH");
    id(profile.user.id);
  }
  check(ctx.manualInventory && ctx.profiles.creator.user.id !== ctx.manualInventory.administratorUserId, "Editor e operador humano devem ser distintos.", "QA_IDENTITIES_NOT_DISTINCT");
}

// No new input or secret: inspect only known, read-only configuration from the
// operator's existing Pages preflight. Never switch quota off for acceptance.
export function verifyPreflight(project, options) {
  check(Number(options.organizationId) === QA.id && !options.projectSlug, "Use somente a organização QA registrada e nenhum projeto existente.", "QA_ORGANIZATION_MISMATCH");
  for (const container of [project.raw?.deployment_configs?.production?.env_vars, project.raw?.canonical_deployment?.env_vars]) {
    check(container && typeof container === "object", "Configuração completa necessária para comprovar cleanup de quota.", "QUOTA_CLEANUP_UNSUPPORTED");
    const value = container.PROJECT_QUOTA_RESERVATION_V1;
    check(!value || (value.type === "plain_text" && typeof value.value === "string" && /^(false|0|off|no|disabled)$/i.test(value.value.trim())),
      "Quota ativa ou não verificável: cleanup de reservas incompletas exige implementação revisada antes desta suite.", "QUOTA_CLEANUP_UNSUPPORTED");
  }
}

async function inventory(ctx) {
  const before = validateBeforeEvidence(ctx.manualInventory, { suite: ctx.manualInventory?.suite, expectedCommit: ctx.expectedCommit,
    organizationId: ctx.organizationId, baseUrl: ctx.baseUrl, runId: ctx.runId, maxAgeMs: RUN_MAX_AGE_MS });
  const current = status(await ctx.api("creator", "/api/projects"), 200, "inventário visível do editor QA");
  check(Array.isArray(current.projects) && current.projects.every(project => Number(project.organizationId) === QA.id), "Inventário visível diverge do QA.", "QA_INVENTORY_INVALID");
  return { projects: current.projects, files: before.inventory.files };
}

function assertNoPriorSyntheticResources(values) {
  const projectPattern = /^qa-durable-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(small|large)(?:-[0-9]+)?$/i;
  const filePattern = /^QA Durable [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} (small|large)$/i;
  check(!values.projects.some((project) => projectPattern.test(project.slug || "") || String(project.name || "").startsWith("QA Durable") || String(project.slug || "").startsWith("qa-durable-")) &&
    !values.files.some((file) => filePattern.test(file.name || "") && (file.active !== false || file.isProject !== false || file.linkedProject)),
    "Recursos de acceptance anterior ainda existem; reconciliar o run antes de abrir outra janela.", "QA_PRIOR_CLEANUP_UNVERIFIED");
}
export async function prepare(ctx) {
  assertContext(ctx);
  validateBeforeEvidence(ctx.manualInventory, { suite: ctx.manualInventory?.suite, expectedCommit: ctx.expectedCommit,
    organizationId: ctx.organizationId, baseUrl: ctx.baseUrl, runId: ctx.runId });
  assertNoPriorSyntheticResources(await inventory(ctx));
}

function headers(project, creationKey = null) {
  return {
    "X-Maono-Client-Contract": "2",
    "X-Maono-Client-Build": "registered-durable-project-save-v1",
    ...(project ? { "X-Maono-Project-Id": String(project.id) } : {}),
    ...(creationKey ? { "X-Maono-Creation-Key": creationKey, "X-Maono-Expected-Revision": "0" } : {}),
  };
}
function root(project) { return `/api/projects/${encodeURIComponent(project.slug)}`; }
function operationPath(project, operationId) { return `${root(project)}/save-operations/${encodeURIComponent(operationId)}`; }
export function makeManifest(body, operationId, expectedConfigRevision, operation) {
  const bytes = Buffer.from(body, "utf8");
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) {
    blocks.push(createHash("sha256").update(bytes.subarray(offset, offset + 4 * 1024 * 1024)).digest());
  }
  return {
    operationId, operation, expectedConfigRevision, serializationVersion: 1,
    payloadBytes: bytes.length, checksumAlgorithm: "dropbox-content-hash",
    contentHash: createHash("sha256").update(Buffer.concat(blocks)).digest("hex"),
    schemaName: "legacy-kepler", schemaVersion: 1, configVersion: "v1", datasetCount: 0,
  };
}
function smallFixture(runId, marker) {
  return JSON.stringify({ version: "v1", config: { visState: { layers: [], filters: [] }, mapState: {}, mapStyle: {} }, datasets: [], acceptanceFixture: { runId, marker } });
}
function matchesProject(project, resource, ctx) {
  return project.name === resource.name || (resource.id && Number(project.id) === resource.id) ||
    new RegExp(`^qa-durable-${ctx.runId.toLowerCase()}-${resource.kind}(?:-[0-9]+)?$`).test(project.slug || "");
}
function identity(project, resource, ctx) {
  id(project?.id);
  check(project.name === resource.name && Number(project.organizationId) === QA.id &&
    String(project.createdBy?.id) === String(ctx.profiles.creator.user.id), "Cleanup recusado: identidade do projeto não pertence a este run.", "QA_CLEANUP_SCOPE_MISMATCH");
  check(new RegExp(`^qa-durable-${ctx.runId.toLowerCase()}-${resource.kind}(?:-[0-9]+)?$`).test(project.slug), "Slug sintético divergente.", "QA_CLEANUP_SCOPE_MISMATCH");
  if (resource.id) check(Number(project.id) === resource.id, "Projeto sintético mudou de identidade.", "QA_CLEANUP_SCOPE_MISMATCH");
}

function registerCleanup(ctx, resources, beforeCleanup = async () => {}) {
  // Record intentions before POST; even a lost acknowledgement has a scoped
  // run/name journal. No administrative session or mutation exists in CI.
  ctx.registerCleanup(async () => {
    await beforeCleanup();
    await ctx.publishManualJournal(resources);
    ctx.record("DS-CLEANUP", "PENDING_MANUAL", { knownProjects: resources.filter(row => row.id).length,
      retention: "immutable objects, receipts and operation tombstones" });
    check(!resources.some(row => row.reservationUncertain), "Reserva sem ACK exige investigação humana; inventário vazio não prova conclusão.", "QA_RESERVATION_OUTCOME_UNCERTAIN");
    fail("MANUAL_CLEANUP_REQUIRED", "Limpeza administrativa permanece pendente de aprovação dos IDs exatos e exports verificados.");
  });
}

async function register(ctx, project, input, creationKey) {
  return status(await ctx.api("creator", `${root(project)}/save-operations`, { method: "POST", headers: headers(project, creationKey), json: input }), 201, "registrar manifesto");
}
async function readOperation(ctx, project, input, creationKey) {
  const body = status(await ctx.api("creator", operationPath(project, input.operationId), { headers: headers(project, creationKey) }), 200, "consultar operação");
  check(body.operation?.operationId === input.operationId && Number(body.operation?.projectId) === project.id && Number(body.operation?.organizationId) === QA.id, "Status com identidade divergente.");
  return body;
}
async function poll(ctx, project, input, creationKey, expectedState = "PUBLISHED") {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await readOperation(ctx, project, input, creationKey);
    if (result.operation.terminal) {
      check(result.operation.state === expectedState, `Operação terminou em ${result.operation.state}: ${result.operation.errorCode || "sem código"}.`);
      return result;
    }
    // GET never drives processing. With the inline flag disabled, only the
    // independently deployed recovery Worker can publish this accepted payload.
    await ctx.pause(POLL_INTERVAL_MS);
  }
  fail("DURABLE_RECOVERY_TIMEOUT", "Operação aceita não terminou na janela de observação; conferir Worker/outbox. Cleanup e restauração continuam obrigatórios.");
}
async function upload(ctx, project, input, body, creationKey) {
  const response = await ctx.api("creator", `${operationPath(project, input.operationId)}/payload`, {
    method: "PUT", headers: { ...headers(project, creationKey), "Content-Type": "application/json; charset=utf-8" }, body, timeoutMs: 240_000,
  });
  const accepted = status(response, [200, 202], "recebimento durável independente");
  check(accepted.operation?.payloadStored === true && ["PAYLOAD_STORED", "PROCESSING", "RETRY_WAIT", "PUBLISHED", "CONFLICT", "FAILED_FINAL"].includes(accepted.operation.state),
    "Resposta deve comprovar payload durável; um Worker pode avançar antes do ACK.");
  if (accepted.operation.state === "PUBLISHED") receipt(accepted, input, project, input.expectedConfigRevision + 1);
  else check(!accepted.operation.receipt, "Operação não publicada não pode fabricar recibo.");
  // Deliberately discard the acknowledgement. This models a lost response; it
  // does not claim physical network fault injection in Production.
  return { httpStatus: response.status, state: accepted.operation.state };
}
function receipt(result, input, project, revision) {
  const value = result.operation.receipt;
  check(value?.operationId === input.operationId && Number(value.projectId) === project.id && Number(value.organizationId) === QA.id &&
    value.publishedRevision === revision && value.baseRevision === input.expectedConfigRevision && value.checksumAlgorithm === input.checksumAlgorithm &&
    value.checksum === input.contentHash && value.sizeBytes === input.payloadBytes && typeof value.committedAt === "string", "Recibo não corresponde aos bytes/identidade registrados.");
  return value;
}
async function reserve(ctx, resource, body, datasetCount = 0, resources = [resource]) {
  const input = makeManifest(body, `qa-durable:${ctx.runId}:${resource.kind}:create`, 0, "create");
  input.datasetCount = datasetCount;
  const creationKey = `qa-durable:${ctx.runId}:${resource.kind}`;
  const request = { durableSave: true, name: resource.name, description: "Synthetic durable acceptance; immutable objects and receipts retained by policy.", organizationId: QA.id, idempotencyKey: creationKey,
    configMetadata: { sizeBytes: input.payloadBytes, datasetCount, schemaName: "legacy-kepler", schemaVersion: 1, configVersion: "v1" } };
  resource.reservationStarted = true;
  resource.reservationUncertain = true;
  await ctx.publishManualJournal(resources);
  const created = status(await ctx.api("creator", "/api/projects", { method: "POST", headers: headers(), json: request }), 202, "reservar criação");
  const project = { ...created.project, id: id(created.project?.id) };
  resource.id = project.id;
  resource.slug = project.slug;
  resource.organizationFileId = project.organizationFileId ?? null;
  await ctx.publishManualJournal(resources);
  identity(project, resource, ctx);
  resource.reservationUncertain = false;
  await ctx.publishManualJournal(resources);
  check(created.status === "pending" && created.creation?.transport === "durable-operation" && created.creation.expectedRevision === 0, "Reserva não segue protocolo durável.");
  await register(ctx, project, input, creationKey);
  const acceptance = await upload(ctx, project, input, body, creationKey);
  const published = await poll(ctx, project, input, creationKey);
  const saved = receipt(published, input, project, 1);
  check(published.currentRevision === 1, "Criação publicou revisão inesperada.");
  return { project, input, creationKey, request, saved, acceptance };
}

export async function run(ctx) {
  assertContext(ctx);
  const resources = ["small", "large"].map((kind) => ({ kind, name: `QA Durable ${ctx.runId.toLowerCase()} ${kind}` }));
  const before = await inventory(ctx);
  check(!before.projects.some((p) => resources.some((r) => matchesProject(p, r, ctx))) && !before.files.some((f) => resources.some((r) => r.name === f.name)), "runId já possui recursos; não reutilizar janela.", "QA_RUN_ID_COLLISION");
  assertNoPriorSyntheticResources(before);
  registerCleanup(ctx, resources);
  await ctx.publishManualJournal(resources);
  const smallBody = smallFixture(ctx.runId, "initial");
  const small = await reserve(ctx, resources[0], smallBody, 0, resources);
  ctx.record("DS-SMALL", "PASS", { sizeBytes: small.input.payloadBytes, revision: 1 });
  ctx.record("DS-LOST-ACK", "PASS", { modeled: true, ...small.acceptance, evidence: "Durable acknowledgement ignored; GET-only recovery returned receipt with inline disabled" });

  const duplicate = await register(ctx, small.project, small.input, small.creationKey);
  same(duplicate.operation?.receipt, small.saved, "Registro duplicado alterou recibo.");
  const payloadReplay = status(await ctx.api("creator", `${operationPath(small.project, small.input.operationId)}/payload`, {
    method: "PUT", headers: { ...headers(small.project, small.creationKey), "Content-Type": "application/json" }, body: smallBody,
  }), 200, "replay do payload publicado");
  same(payloadReplay.operation?.receipt, small.saved, "Replay publicou outra revisão.");
  resources[0].reservationUncertain = true;
  await ctx.publishManualJournal(resources);
  const creationReplay = status(await ctx.api("creator", "/api/projects", { method: "POST", headers: headers(), json: small.request }), 200, "replay da reserva");
  check(creationReplay.idempotent === true && Number(creationReplay.project?.id) === small.project.id && creationReplay.configRevision === 1, "Replay da reserva duplicou projeto.");
  resources[0].reservationUncertain = false;
  await ctx.publishManualJournal(resources);
  const changed = await ctx.api("creator", `${root(small.project)}/save-operations`, { method: "POST", headers: headers(small.project, small.creationKey), json: { ...small.input, contentHash: "f".repeat(64) } });
  assertHttpResponse(changed, changed.status === 409 && changed.body?.error?.code === "OPERATION_PAYLOAD_MISMATCH", "ID reutilizado com outros bytes não foi recusado.");
  ctx.record("DS-IDEMPOTENT", "PASS", { registration: true, payload: true, reservation: true, mismatchedManifestRejected: true });

  const nextBody = smallFixture(ctx.runId, "later-revision");
  const next = makeManifest(nextBody, `qa-durable:${ctx.runId}:small:update`, 1, "update");
  await register(ctx, small.project, next);
  await upload(ctx, small.project, next, nextBody);
  const current = await poll(ctx, small.project, next);
  receipt(current, next, small.project, 2);
  const historical = await readOperation(ctx, small.project, small.input, small.creationKey);
  same(historical.operation.receipt, small.saved, "Recibo histórico mudou após revisão posterior.");
  check(historical.currentRevision === 2 && historical.operation.currentRevision === 2, "Cabeça atual não está separada do recibo histórico.");
  const historicalAgain = await readOperation(ctx, small.project, small.input, small.creationKey);
  same(historicalAgain.operation.receipt, small.saved, "Leitura repetida alterou o recibo histórico.");
  ctx.record("DS-HISTORICAL", "PASS", { receiptRevision: 1, currentRevision: 2, repeatedRead: true });

  const staleBody = smallFixture(ctx.runId, "stale-conflict");
  const stale = makeManifest(staleBody, `qa-durable:${ctx.runId}:small:stale`, 1, "update");
  await register(ctx, small.project, stale);
  await upload(ctx, small.project, stale, staleBody);
  const conflict = await poll(ctx, small.project, stale, null, "CONFLICT");
  check(conflict.operation.errorCode === "PROJECT_CONFIG_REVISION_CONFLICT" && !conflict.operation.receipt && conflict.currentRevision === 2, "CAS obsoleto alterou a cabeça ou fabricou recibo.");
  same((await readOperation(ctx, small.project, next)).operation.receipt, current.operation.receipt, "Conflito sobrescreveu a revisão publicada.");
  ctx.record("DS-STALE-CAS", "PASS", { currentRevision: 2, noReceipt: true });

  for (const contract of [null, "1"]) {
    for (const [path, method] of [[`${root(small.project)}/config`, "PUT"], [`${root(small.project)}/save`, "POST"], [`${root(small.project)}/save-operations`, "POST"], ["/api/projects", "POST"]]) {
      const rejected = await ctx.api("creator", path, { method, body: "{synthetic-old-client-invalid-json", headers: { "Content-Type": "application/json", ...(contract ? { "X-Maono-Client-Contract": contract } : {}) } });
      assertHttpResponse(rejected, rejected.status === 412 && rejected.body?.error?.code === "SAVE_CLIENT_CONTRACT_UNSUPPORTED", "Cliente antigo não foi recusado antes do payload.");
    }
  }
  ctx.record("DS-OLD-CLIENT", "PASS", { headerless: true, contract1: true, malformedBodyRejectedBeforeParse: true });

  const largeBody = buildLargeCreateFixture({ targetMiB: 94 }).body;
  check(Buffer.byteLength(largeBody) === LARGE_BYTES, "Fixture grande fora do limite registrado.");
  const large = await reserve(ctx, resources[1], largeBody, 0, resources);
  // Versioned read descriptor is read-only and same-origin. Never send cookies
  // to its external signed URL or expose that URL in the acceptance report.
  const descriptor = status(await ctx.api("creator", `${root(large.project)}/config-stream?delivery=direct`, { headers: { ...headers(large.project), "X-Maono-Expected-Config-Revision": "1" } }), 200, "descriptor da revisão grande");
  check(descriptor.transport === "direct" && descriptor.revision === 1 && descriptor.sizeBytes === LARGE_BYTES, "Leitura grande não aponta para a revisão publicada.");
  ctx.record("DS-LARGE", "PASS", { sizeBytes: LARGE_BYTES, revision: 1, readTransport: "direct-descriptor", payloadIntegrityEvidence: "server-verified receipt" });
  return { runId: ctx.runId, organizationId: QA.id, projects: resources.map(({ id: projectId, kind }) => ({ projectId, kind })), retention: manifest.cleanup.retention };
}

// Shared reviewed reservation/cleanup boundary for the registered PNG suite.
// A caller cannot select an existing project, organization, name or cleanup ID.
export async function createSyntheticProjectForPreview(ctx, body, { beforeCleanup } = {}) {
  assertContext(ctx);
  const parsed = JSON.parse(body);
  check(Array.isArray(parsed.datasets) && parsed.datasets.length === 1 && Buffer.byteLength(body) < 64 * 1024,
    "A fixture PNG deve ser pequena e ter exatamente um dataset sintético.", "QA_PREVIEW_FIXTURE_INVALID");
  const resources = [{ kind: "small", name: `QA Durable ${ctx.runId.toLowerCase()} small` }];
  assertNoPriorSyntheticResources(await inventory(ctx));
  registerCleanup(ctx, resources, beforeCleanup);
  await ctx.publishManualJournal(resources);
  return reserve(ctx, resources[0], body, 1, resources);
}
