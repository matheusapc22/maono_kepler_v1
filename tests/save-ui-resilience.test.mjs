import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SAVE_STALL_NOTICE_MS,
  executePreparedProjectUpdate,
  isSaveRequestAbort,
  prepareProjectUpdateSnapshot,
  runWithSaveStallNotice,
} from "../src/pages/Kepler/save-operation-resilience.ts";
import { beginClientSaveAttempt } from "../src/pages/Kepler/save-observability.ts";

function hangingFetch(_input, init = {}) {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener(
      "abort",
      () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true },
    );
  });
}

function response(body = { ok: true, configRevision: 8 }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("stall é aviso e nunca aborta a request automaticamente", async () => {
  const controller = new AbortController();
  let stalled = 0;
  let settled = false;

  const pending = runWithSaveStallNotice({
    stallAfterMs: 5,
    onStall: () => {
      stalled += 1;
    },
    operation: () =>
      hangingFetch("/api/test", { signal: controller.signal }),
  }).finally(() => {
    settled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stalled, 1);
  assert.equal(controller.signal.aborted, false);
  assert.equal(settled, false);

  controller.abort();
  await assert.rejects(pending, (error) => isSaveRequestAbort(error));
});

test("snapshot de recovery preserva exatamente body e expectedRevision", async () => {
  const attempt = beginClientSaveAttempt("update");
  const snapshot = prepareProjectUpdateSnapshot({
    attempt,
    projectSlug: "demo",
    config: {
      version: "v1",
      config: { visState: { layers: [] } },
      datasets: [],
    },
    expectedConfigRevision: 7,
    legacy: null,
  });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response();
  };

  await executePreparedProjectUpdate({ snapshot, fetchImpl });
  await executePreparedProjectUpdate({ snapshot, fetchImpl });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].init.body, snapshot.serialized.body);
  assert.equal(
    calls[0].init.headers["X-Maono-Expected-Revision"],
    calls[1].init.headers["X-Maono-Expected-Revision"],
  );
  assert.equal(snapshot.expectedConfigRevision, 7);
});

test("UPDATE pendente só termina quando o usuário aborta explicitamente", async () => {
  const attempt = beginClientSaveAttempt("update");
  const snapshot = prepareProjectUpdateSnapshot({
    attempt,
    projectSlug: "demo",
    config: { version: "v1", config: {}, datasets: [] },
    expectedConfigRevision: 2,
    legacy: null,
  });
  const controller = new AbortController();
  let stalled = false;

  const pending = executePreparedProjectUpdate({
    snapshot,
    signal: controller.signal,
    fetchImpl: hangingFetch,
    stallAfterMs: 5,
    onStall: () => {
      stalled = true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stalled, true);
  assert.equal(controller.signal.aborted, false);

  controller.abort();
  await assert.rejects(pending, (error) => isSaveRequestAbort(error));
});

test("CREATE recebe AbortSignal sem trocar idempotencyKey", async () => {
  const createFlow = await readFile(
    new URL("../src/pages/Kepler/project-create-flow.ts", import.meta.url),
    "utf8",
  );
  assert.match(createFlow, /signal\?: AbortSignal/);
  assert.match(createFlow, /body: prepared\.requestBody,[\s\S]*signal/);
  assert.match(createFlow, /"X-Maono-Creation-Key": idempotencyKey,[\s\S]*signal/);
});

test("budget padrão de stall é apenas informativo", () => {
  assert.equal(SAVE_STALL_NOTICE_MS, 12_000);
});
