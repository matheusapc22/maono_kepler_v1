import test from "node:test";
import assert from "node:assert/strict";
import {
  AcceptanceError, appRequest, assertHttpResponse, fail, safeError,
} from "../scripts/acceptance/production-acceptance-lib.mjs";

const message = "Recebimento durável recusado.";
const code = "ACCEPTANCE_ASSERTION_FAILED";
const correlationId = "qa-http:body-12345678";
const headerCorrelationId = "qa-http:header-12345678";
const privateMarkers = [
  "private backend message", "private provider details", "private body text",
  "private arbitrary header", "maono_session=private-cookie", "private-password",
  "https://private.example.test/signed?token=private-token",
];

function failed(response, failureCode = code) {
  let thrown;
  assert.throws(() => assertHttpResponse(response, false, message, failureCode), error => {
    thrown = error;
    return error instanceof AcceptanceError && error.code === failureCode && error.message === message;
  });
  return { error: thrown, report: safeError(thrown) };
}

function assertPrivate(values) {
  const serialized = JSON.stringify(values);
  for (const marker of privateMarkers) assert.ok(!serialized.includes(marker), `private marker escaped: ${marker}`);
}

test("HTTP failures retain only status, bounded backend identifiers and distinct correlation IDs", () => {
  const response = {
    status: 503,
    responseFormat: "json",
    body: { ok: false, error: { code: "STORAGE_UNAVAILABLE", correlationId,
      message: privateMarkers[0], details: { provider: privateMarkers[1], url: privateMarkers[6] } },
      text: privateMarkers[2], password: privateMarkers[5], url: privateMarkers[6] },
    headers: new Headers({ "X-Correlation-Id": headerCorrelationId, "X-Private": privateMarkers[3],
      "Set-Cookie": privateMarkers[4], Location: privateMarkers[6] }),
    url: privateMarkers[6],
  };
  const result = failed(response);
  assert.deepEqual(result.report, { code, message, httpStatus: 503, backendCode: "STORAGE_UNAVAILABLE",
    correlationId, headerCorrelationId, responseFormat: "json" });
  assert.equal(result.error.body, undefined);
  assert.equal(result.error.headers, undefined);
  assert.equal(result.error.response, undefined);
  assert.equal(result.error.cause, undefined);
  assertPrivate(result);
});

test("matching correlation IDs are not duplicated and unrelated request ID headers are ignored", () => {
  const body = { error: { correlationId } };
  assert.deepEqual(failed({ status: 503, body, headers: new Headers({ "x-correlation-id": correlationId }) }).report,
    { code, message, httpStatus: 503, correlationId });
  assert.deepEqual(failed({ status: 503, body: { error: { correlationId: "invalid/id" } },
    headers: new Headers({ "X-Correlation-Id": headerCorrelationId }) }).report,
  { code, message, httpStatus: 503, headerCorrelationId });
  assert.deepEqual(failed({ status: 503, headers: new Headers({ "X-Request-Id": headerCorrelationId,
    "CF-Ray": headerCorrelationId, "X-Correlation-Id-Extra": headerCorrelationId }) }).report,
  { code, message, httpStatus: 503 });
});

test("HTTP evidence rejects invalid types, bounds, URLs and untrusted extra properties", () => {
  const fields = {
    httpStatus: [undefined, null, "503", 99, 600, 503.5, NaN, Infinity, {}, []],
    backendCode: [undefined, null, 503, {}, [], "", "lowercase", "HAS SPACE", "CODE\n", "CODE\r\n", "A".repeat(121), privateMarkers[6]],
    correlationId: [undefined, null, 12345678, {}, [], "", "short", "_invalid", "has space", "invalid/id", "id-12345\n", "id-12345\r\n", "A".repeat(101), privateMarkers[6]],
    headerCorrelationId: [undefined, null, 12345678, {}, [], "", "short", "_invalid", "has space", "invalid/id", "id-12345\n", "id-12345\r\n", "A".repeat(101), privateMarkers[6]],
    responseFormat: [undefined, null, {}, [], "JSON", "html", "invalid", privateMarkers[2]],
    cfRay: [undefined, null, 1234567890123456, {}, [], "", "1234567890abcde", "1234567890abcdef0", "1234567890ABCDEF-GRU", "1234567890abcdef-gru", "1234567890abcdef-GRU\n", "1234567890abcdef-GRU\r\n", privateMarkers[6]],
    cloudflareErrorCode: [undefined, null, 1102, {}, [], "1102", "9999", "11022", privateMarkers[2]],
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const value of values) {
      const error = new AcceptanceError(code, message, { [field]: value, body: privateMarkers[2],
        headers: { "Set-Cookie": privateMarkers[4] }, password: privateMarkers[5], url: privateMarkers[6] });
      assert.deepEqual(safeError(error), { code, message }, `${field}: ${String(value)}`);
      assertPrivate(error);
    }
  }
  for (const httpStatus of [100, 599]) {
    const evidence = { httpStatus, backendCode: "A".repeat(120), correlationId: "A".repeat(100),
      headerCorrelationId: "id:12345", responseFormat: "invalid-json" };
    assert.deepEqual(safeError(new AcceptanceError(code, message, evidence)), { code, message, ...evidence });
  }
  assert.deepEqual(failed(null).report, { code, message });
  assert.deepEqual(failed({ status: "503", body: { error: { code: 503, correlationId: [] } },
    headers: { get: () => ({ private: privateMarkers[3] }) } }).report, { code, message });
});

test("safeError sanitizes evidence again and fail supports the optional evidence argument", () => {
  const error = new AcceptanceError(code, message, { httpStatus: 503 });
  error.httpEvidence = { httpStatus: "503", backendCode: "safe-looking-but-invalid", correlationId: privateMarkers[6],
    headerCorrelationId, responseFormat: "json", body: privateMarkers[2], password: privateMarkers[5] };
  assert.deepEqual(safeError(error), { code, message, headerCorrelationId, responseFormat: "json" });
  assert.throws(() => fail("CUSTOM_ASSERTION", message, { httpStatus: 503, backendCode: "STORAGE_UNAVAILABLE" }), failure => {
    assert.deepEqual(safeError(failure), { code: "CUSTOM_ASSERTION", message, httpStatus: 503, backendCode: "STORAGE_UNAVAILABLE" });
    return true;
  });
  assert.deepEqual(safeError(new Error(privateMarkers[0])), {
    code: "ACCEPTANCE_UNEXPECTED", message: "Falha inesperada no operador; revise o relatório antes de repetir.",
  });
  assertPrivate(safeError(error));
});

test("successful assertions do not consume response evidence and preserve the custom failure code", () => {
  const response = { get body() { assert.fail("success must not inspect diagnostics"); } };
  assert.equal(assertHttpResponse(response, true, message), undefined);
  assert.equal(failed({ status: 503 }, "CLEANUP_HTTP_FAILED").report.code, "CLEANUP_HTTP_FAILED");
});

test("appRequest classifies JSON, null JSON, invalid JSON and non-JSON without retaining private content in errors", async () => {
  const cases = [
    [Response.json({ ok: false, error: { code: "STORAGE_UNAVAILABLE", correlationId,
      message: privateMarkers[0], details: privateMarkers[1] } }, { status: 503 }), "json", "object"],
    [Response.json(null, { status: 503 }), "json", "null"],
    [new Response(`{ invalid: ${privateMarkers[2]}`, { status: 503, headers: { "Content-Type": "application/json" } }), "invalid-json", "null"],
    [new Response(`<html>${privateMarkers[2]} ${privateMarkers[6]}</html>`, { status: 503,
      headers: { "Content-Type": "text/html", "X-Correlation-Id": headerCorrelationId } }), "non-json", "string"],
  ];
  for (const [mock, format, bodyType] of cases) {
    let requests = 0;
    const response = await appRequest("https://qa.example.test", "/api/synthetic", { fetchImpl: async () => { requests++; return mock; } });
    assert.equal(requests, 1, "failed HTTP responses must not trigger an automatic retry");
    assert.equal(response.status, 503);
    assert.equal(response.responseFormat, format);
    assert.equal(response.body === null ? "null" : typeof response.body, bodyType);
    const { report } = failed(response);
    assert.equal(report.httpStatus, 503);
    assert.equal(report.responseFormat, format);
    if (format === "non-json") assert.equal(report.headerCorrelationId, headerCorrelationId);
    assertPrivate(report);
  }
});

test("expected 409, 412 and 422 responses remain available to registered negative assertions", async () => {
  for (const [status, backendCode] of [[409, "OPERATION_PAYLOAD_MISMATCH"], [412, "SAVE_CLIENT_CONTRACT_UNSUPPORTED"], [422, "PAYLOAD_INVALID"]]) {
    let calls = 0;
    const body = { ok: false, error: { code: backendCode, correlationId } };
    const response = await appRequest("https://qa.example.test", "/api/synthetic", {
      fetchImpl: async () => { calls++; return Response.json(body, { status }); },
    });
    assert.equal(calls, 1);
    assert.equal(response.ok, false);
    assert.equal(response.responseFormat, "json");
    assert.deepEqual(response.body, body);
    assert.doesNotThrow(() => assertHttpResponse(response, response.status === status && response.body.error.code === backendCode,
      "Expected negative protocol response."));
  }
});

test("bounded Cloudflare HTML and text markers preserve only the allowlisted error code and Ray ID", async () => {
  const cfRay = "1234567890abcdef-GRU";
  const markers = [
    ["<span class=\"cf-error-code\">1101</span>", "1101"],
    ["<span class='cf-error-code'> 1102 </span>", "1102"],
    ["<title>Error 1102: Worker exceeded resource limits</title>", "1102"],
    ["<h1>Error 1027</h1>", "1027"],
    ["error code: 1102", "1102"],
    ["Error: 1101\n", "1101"],
  ];
  for (const [marker, cloudflareErrorCode] of markers) {
    let calls = 0;
    const response = await appRequest("https://qa.example.test", "/api/synthetic", { fetchImpl: async () => {
      calls++;
      return new Response(`${marker}\n${privateMarkers.join("\n")}`, { status: 503, headers: {
        "Content-Type": "text/html", "CF-Ray": cfRay, "X-Private": privateMarkers[3], "Set-Cookie": privateMarkers[4],
      } });
    } });
    const result = failed(response);
    assert.equal(calls, 1);
    assert.deepEqual(result.report, { code, message, httpStatus: 503, responseFormat: "non-json", cfRay, cloudflareErrorCode });
    assertPrivate(result);
  }
});

test("Cloudflare code extraction requires an error response, non-JSON content, a valid Ray and a bounded known marker", () => {
  const cfRay = "1234567890abcdef-GRU";
  const response = { status: 503, responseFormat: "non-json", headers: new Headers({ "CF-Ray": cfRay }),
    body: '<span class="cf-error-code">1102</span>' };
  const variations = [
    { status: 200 },
    { status: "503" },
    { status: 600 },
    { responseFormat: "json" },
    { responseFormat: "invalid-json" },
    { body: { error: { message: "error code: 1102" } } },
    { body: '<span class="cf-error-code">9999</span>' },
    { body: "error code: 11022" },
    { body: "Something unrelated mentions error code: 1102 in prose." },
    { body: `${"x".repeat(16 * 1024)}\nerror code: 1102` },
    { body: `${"x".repeat(16 * 1024 - 5)}<span class="cf-error-code">1102</span>` },
    { headers: new Headers() },
    { headers: new Headers({ "CF-Ray": "invalid-ray" }) },
    { headers: new Headers({ "CF-Ray": "1234567890abcdef-GRU,private-data" }) },
  ];
  for (const variation of variations) {
    const { report } = failed({ ...response, ...variation });
    assert.equal(report.cloudflareErrorCode, undefined, JSON.stringify(variation));
    assert.equal(Object.hasOwn(report, "body"), false);
  }
  assert.equal(failed({ ...response, headers: new Headers({ "CF-Ray": "1234567890abcdef" }) }).report.cfRay, "1234567890abcdef");
});

test("safeError revalidates Cloudflare codes and their supporting evidence after mutation", () => {
  const evidence = { httpStatus: 503, responseFormat: "non-json", cfRay: "1234567890abcdef-GRU", cloudflareErrorCode: "1102" };
  const error = new AcceptanceError(code, message, evidence);
  assert.deepEqual(safeError(error), { code, message, ...evidence });
  for (const mutation of [{ httpStatus: 200 }, { httpStatus: "503" }, { responseFormat: "json" }, { cfRay: "invalid-ray" },
    { cloudflareErrorCode: 1102 }, { cloudflareErrorCode: "9999" }, { cloudflareErrorCode: "11022" }]) {
    error.httpEvidence = { ...evidence, ...mutation, body: privateMarkers[2], headers: { "Set-Cookie": privateMarkers[4] } };
    const report = safeError(error);
    assert.equal(report.cloudflareErrorCode, undefined);
    assertPrivate(report);
  }
});
