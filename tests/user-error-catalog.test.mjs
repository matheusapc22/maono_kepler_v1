import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApiError } from "../src/lib/error-contract.ts";
import { normalizeUserError, formatSupportReference } from "../src/lib/user-error-catalog.ts";

const catalogSource = await readFile(
  new URL("../src/lib/user-error-catalog.ts", import.meta.url),
  "utf8",
);
const exportsSource = await readFile(
  new URL("../src/pages/Projects/components/ExportsSection.tsx", import.meta.url),
  "utf8",
);
const documentsSource = await readFile(
  new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
  "utf8",
);
const loginSource = await readFile(
  new URL("../src/pages/Login.tsx", import.meta.url),
  "utf8",
);
const ticketNoticeSource = await readFile(
  new URL("../src/pages/Projects/components/TicketErrorNotice.tsx", import.meta.url),
  "utf8",
);
const ticketsApiSource = await readFile(
  new URL("../src/pages/Projects/components/tickets-api.ts", import.meta.url),
  "utf8",
);
const adminFilesSource = await readFile(
  new URL("../src/pages/AdminFiles.tsx", import.meta.url),
  "utf8",
);
const adminUsersSource = await readFile(
  new URL("../src/pages/Admin/components/AdminUserManagerLegacy.tsx", import.meta.url),
  "utf8",
);
const saveButtonSource = await readFile(
  new URL("../src/pages/Kepler/components/maono-save-button.tsx", import.meta.url),
  "utf8",
);

test("catálogo cobre códigos e categorias prioritários sem provider na copy", () => {
  for (const code of [
    "AUTH_INVALID_CREDENTIALS",
    "AUTH_SESSION_EXPIRED",
    "PERMISSION_PROJECT_SAVE_DENIED",
    "PROJECT_CONFIG_REVISION_CONFLICT",
    "PERFORMANCE_OPERATION_TIMEOUT",
    "INFRASTRUCTURE_NETWORK_FAILURE",
  ]) {
    assert.match(catalogSource, new RegExp(code));
  }

  for (const category of [
    "AUTH",
    "PERMISSION",
    "PROJECT",
    "MAP_CONFIG",
    "STORAGE",
    "PERFORMANCE",
    "SPATIAL",
    "ENGINE",
    "INFRASTRUCTURE",
  ]) {
    assert.match(catalogSource, new RegExp(`${category}:`));
  }

  assert.doesNotMatch(
    catalogSource,
    /message:\s*["'`][^"'`]*(Dropbox|Cloudflare|Worker|D1|backend|runtime|schema)/i,
  );
});

test("support reference é curta e separada do identificador operacional", () => {
  assert.match(catalogSource, /MNO-/);
  assert.match(catalogSource, /formatSupportReference/);
  assert.match(catalogSource, /stableReference/);
});

test("Exportações usa o normalizador central em vez de requestError.message", () => {
  assert.match(exportsSource, /normalizeUserError/);
  assert.match(exportsSource, /setError\(normalizeUserError\(requestError\)\.message\)/);
  assert.doesNotMatch(exportsSource, /requestError\.message/);
});

test("Documentos normaliza erros sem expor diagnósticos técnicos", () => {
  assert.match(documentsSource, /normalizeUserError\(error\)/);
  assert.match(
    documentsSource,
    /const supportReference = presentation\.supportReference/,
  );
  assert.doesNotMatch(documentsSource, /formatSupportReference\(presentation\.supportReference\)/);

  assert.doesNotMatch(documentsSource, /payload\?\.code/);
  assert.doesNotMatch(documentsSource, /payload\?\.stage/);
  assert.doesNotMatch(documentsSource, /payload\?\.requestId/);
  assert.doesNotMatch(documentsSource, /`código \$\{/);
  assert.doesNotMatch(documentsSource, /`etapa \$\{/);
  assert.doesNotMatch(documentsSource, /`requisição \$\{/);
  assert.doesNotMatch(documentsSource, /Dropbox/i);
  assert.doesNotMatch(documentsSource, /Cloudflare D1/i);
});

test("readiness transitória e terminal recebem ações diferentes sem mensagens remotas", () => {
  for (const retryable of [true, false]) {
    const presentation = normalizeUserError(new ApiError({
      status: 503,
      code: "ORGANIZATION_STORAGE_NOT_READY",
      category: "STORAGE",
      retryable,
      correlationId: "internal-storage-incident-123",
      details: { provider: "Dropbox", root: "/private/secret" },
    }, null, "Dropbox token=secret; D1 schema invalid"));
    assert.equal(presentation.retryable, retryable);
    assert.equal(presentation.action, retryable ? "retry" : "contact_support");
    assert.doesNotMatch(presentation.message, /Dropbox|D1|secret|private|schema|token/);
    assert.equal(presentation.supportReference, formatSupportReference("internal-storage-incident-123"));
  }
});

test("estados bloqueados não oferecem repetição mesmo com classificação incoerente", () => {
  for (const code of [
    "ORGANIZATION_STORAGE_DISABLED",
    "ORGANIZATION_STORAGE_PATH_DECISION_REQUIRED",
    "ORGANIZATION_STORAGE_RETRY_EXHAUSTED",
    "ORGANIZATION_STORAGE_RETRY_BLOCKED",
  ]) {
    const presentation = normalizeUserError({ status: 503, code, category: "STORAGE", retryable: true });
    assert.equal(presentation.retryable, false, code);
    assert.equal(presentation.action, "contact_support", code);
  }
  const preparing = normalizeUserError({ status: 503, code: "ORGANIZATION_STORAGE_IN_PROGRESS", category: "STORAGE", retryable: true });
  assert.equal(preparing.severity, "info");
  assert.match(preparing.message, /sendo preparado/);
});

test("categoria STORAGE desconhecida respeita retryable e nunca sugere reparo manual", () => {
  const presentation = normalizeUserError({ status: 503, code: "NEW_INTERNAL_CODE", category: "STORAGE", retryable: false });
  assert.equal(presentation.retryable, false);
  assert.equal(presentation.action, "contact_support");
  assert.doesNotMatch(presentation.message, /reparar|sincronizar|Dropbox|NEW_INTERNAL_CODE/);
});


test("PRH-03 normaliza Login e superfícies Admin/Ops", () => {
  assert.match(loginSource, /normalizeUserError\([^)]*\)\.message/);
  assert.doesNotMatch(loginSource, /\b(?:err|error|loginFailure)\.message\b/);

  for (const source of [adminFilesSource, adminUsersSource]) {
    assert.match(source, /normalizeUserError/);
    assert.doesNotMatch(source, /\b(?:err|error)\.message\b/);
    assert.doesNotMatch(source, /response\.text\s*\(/);
  }
});

test("Central de Chamados não expõe mensagem nem identificador operacional bruto", () => {
  assert.match(ticketNoticeSource, /supportReference/);
  assert.match(ticketNoticeSource, /normalizeUserError/);
  assert.doesNotMatch(ticketNoticeSource, /apiError\.message/);
  assert.doesNotMatch(ticketNoticeSource, /requestId/);

  assert.match(ticketsApiSource, /buildHttpApiError/);
  assert.match(ticketsApiSource, /requestJson/);
  assert.doesNotMatch(ticketsApiSource, /payload\.error\.message/);
  assert.doesNotMatch(ticketsApiSource, /\brequestId\b/);
  assert.doesNotMatch(ticketsApiSource, /\bstage\b/);
});

test("salvamento de mapa usa contrato central sem propagar corpo ou mensagem técnica", () => {
  assert.match(saveButtonSource, /buildApiError/);
  assert.match(saveButtonSource, /normalizeUserError/);
  assert.doesNotMatch(saveButtonSource, /response\.text\s*\(/);
  assert.doesNotMatch(saveButtonSource, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(saveButtonSource, /getBackendErrorMessage/);
  assert.doesNotMatch(saveButtonSource, /getErrorReference/);
});

test("durable save UI uses stable local codes and never displays local or remote Error.message", async () => {
  const ts = await import("typescript");
  const { buildApiError } = await import("../src/lib/api-transport.ts");
  const { DurableSaveError } = await import("../src/pages/Kepler/durable-save-controller.ts");
  const { LocalSaveStorageError } = await import("../src/pages/Kepler/durable-save-store.ts");
  const helper = saveButtonSource.match(/function getSaveFailureMessage\(error: unknown\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const { outputText } = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });
  const present = new Function("normalizeUserError", "buildApiError", "DurableSaveError", `${outputText}; return getSaveFailureMessage;`)(normalizeUserError, buildApiError, DurableSaveError);
  const secret = "Dropbox token=PRIVATE_SECRET; internal path /private/project; raw provider response";
  for (const code of ["LOCAL_SAVE_STORAGE_UNAVAILABLE", "LOCAL_SAVE_QUOTA_EXCEEDED", "LOCAL_SAVE_CORRUPTED", "LOCAL_SAVE_CREATION_PAYLOAD_UNAVAILABLE"]) {
    const error = new LocalSaveStorageError(code); error.message = secret;
    const copy = present(error);
    assert.match(copy, /Não foi possível concluir o salvamento/); assert.doesNotMatch(copy, /PRIVATE_SECRET|Dropbox|internal|provider/);
  }
  for (const code of ["SAVE_RECEIPT_UNVERIFIED", "SAVE_CREATION_ACTIVE_UNCONFIRMED", "SAVE_OPERATION_CONFLICT", "SAVE_OPERATION_FAILED_FINAL", "LOCAL_SAVE_PAYLOAD_EXPIRED", "LOCAL_SAVE_PAYLOAD_INTEGRITY_FAILED", "SAVE_OPERATION_STATE_UNRECOGNIZED"]) {
    const error = new DurableSaveError(secret, new Response(null, { status: 200 }), { error: { message: secret } }, {}, code);
    const copy = present(error);
    assert.match(copy, /Não foi possível/); assert.doesNotMatch(copy, /PRIVATE_SECRET|Dropbox|internal|provider/);
  }
  const remote = new DurableSaveError(secret, new Response(null, { status: 403 }), { error: { code: "PERMISSION_PROJECT_SAVE_DENIED", category: "PERMISSION", message: secret } }, {});
  assert.match(present(remote), /Não foi possível/); assert.doesNotMatch(present(remote), /PRIVATE_SECRET|Dropbox/);
  assert.doesNotMatch(present(new Error(secret)), /PRIVATE_SECRET|Dropbox/);
});
