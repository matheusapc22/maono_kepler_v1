import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const apiTransportSource = await readFile(
  new URL("../src/lib/api-transport.ts", import.meta.url),
  "utf8",
);
const fileTransferSource = await readFile(
  new URL("../src/lib/file-transfer.ts", import.meta.url),
  "utf8",
);
const contractSource = await readFile(new URL("../src/lib/error-contract.ts", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../src/lib/user-error-catalog.ts", import.meta.url), "utf8");
const saveButtonSource = await readFile(
  new URL("../src/pages/Kepler/components/maono-save-button.tsx", import.meta.url),
  "utf8",
);

test("ApiError do frontend preserva taxonomia técnica sem depender de raw body", () => {
  assert.match(apiSource, /getApiErrorContract/);
  assert.match(apiSource, /normalizeUserError/);
  assert.match(apiSource, /X-Correlation-Id/);
  assert.match(contractSource, /export type ErrorCategory =/);
  assert.match(contractSource, /class ApiError extends Error/);
  assert.match(contractSource, /retryable: boolean/);
  assert.match(contractSource, /correlationId\?: string/);
  assert.doesNotMatch(apiSource, /response\.text\s*\(/);
  assert.doesNotMatch(apiSource, /res\.text\s*\(/);
});

test("transporte compartilhado converte falha de rede em erro tipado seguro", () => {
  assert.match(apiSource, /INFRASTRUCTURE_NETWORK_FAILURE/);
  assert.match(apiSource, /fetchWithNetworkGuard/);
  assert.match(apiSource, /buildClientApiError/);
  assert.doesNotMatch(apiSource, /Failed to fetch|NetworkError|load failed/i);
});

test("metadados operacionais ficam centralizados no contrato de erro", () => {
  assert.match(contractSource, /getResponseErrorReference/);
  assert.match(contractSource, /getXhrErrorReference/);
  assert.match(contractSource, /withErrorReference/);
  assert.match(apiTransportSource, /getResponseErrorReference/);
  assert.match(apiTransportSource, /withErrorReference/);
  assert.match(fileTransferSource, /getXhrErrorReference/);
  assert.doesNotMatch(
    apiTransportSource,
    /\b(?:requestId|correlationId|stage)\b/,
  );
  assert.doesNotMatch(fileTransferSource, /\b(?:correlationId|stage)\b/);
});

test("catálogo de apresentação não usa mensagem remota como fallback", () => {
  assert.match(catalogSource, /normalizeUserError/);
  assert.match(catalogSource, /CODE_PRESENTATIONS/);
  assert.match(catalogSource, /CATEGORY_PRESENTATIONS/);
  assert.match(catalogSource, /FALLBACK_PRESENTATION/);
  assert.match(catalogSource, /formatSupportReference/);
  assert.doesNotMatch(catalogSource, /return\s+error\.message/);
  assert.doesNotMatch(catalogSource, /return\s+requestError\.message/);
});

test("SAVE deixa de ter obrigação de expor correlationId na copy", () => {
  assert.match(saveButtonSource, /correlationId/);
  assert.match(saveButtonSource, /emitSaveTelemetry/);
  assert.doesNotMatch(
    apiSource,
    /Erro HTTP \$\{status\}/,
  );
});
