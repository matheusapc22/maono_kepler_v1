import assert from "node:assert/strict";
import test from "node:test";
import { submitUserMutation, UserMutationError, userMutationErrorMessage } from "../src/pages/Admin/components/user-mutation.ts";

test("presentation uses approved copy independently of diagnostic Error.message", () => {
  const failure = new UserMutationError("Mensagem pública controlada.");
  failure.message = "private diagnostic";
  assert.equal(userMutationErrorMessage(failure), "Mensagem pública controlada.");
  assert.equal(userMutationErrorMessage(new Error("private diagnostic")).includes("private diagnostic"), false);
});

for (const status of [400, 401, 403, 409, 429, 500, 503]) test(`HTTP ${status} is actionable and never retried`, async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ ok: false, code: status === 400 ? "USER_PASSWORD_INVALID" : "UNKNOWN", error: "private diagnostic" }), { status });
  });
  await assert.rejects(submitUserMutation("https://synthetic.invalid", { method: "PATCH" }), error => {
    assert.equal(error.message.includes("private diagnostic"), false);
    if (status === 400) assert.match(error.message, /8 caracteres/);
    if (status === 429) assert.match(error.message, /Limite de solicitações/);
    if (status >= 500) assert.match(error.message, /confirmar se a alteração/);
    return true;
  });
  assert.equal(calls, 1);
});

test("network loss reports uncertain outcome and never retries", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("network failed"); });
  await assert.rejects(submitUserMutation("https://synthetic.invalid", {}), /confirmar se a alteração/);
  assert.equal(calls, 1);
});

test("a stalled mutation releases the form at the deadline without retrying", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => new Promise((_resolve, reject) => {
    calls++;
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  await assert.rejects(submitUserMutation("https://synthetic.invalid", {}, 5), /confirmar se a alteração/);
  assert.equal(calls, 1);
});

for (const body of ["<html>error</html>", "null", "{}", '{"ok":false}', '{"ok":true}']) test("malformed success is never accepted as confirmation", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(body));
  await assert.rejects(submitUserMutation("https://synthetic.invalid", {}), /confirmação inválida/);
});

test("valid backend confirmation preserves password and revocation facts", async t => {
  const payload = { ok: true, user: { id: 2 }, passwordChanged: true, sessionsInvalidated: true };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  assert.deepEqual(await submitUserMutation("https://synthetic.invalid", {}), payload);
});
