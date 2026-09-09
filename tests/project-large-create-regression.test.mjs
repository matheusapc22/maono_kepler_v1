import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
  serializeSaveRequest,
} from "../src/pages/Kepler/save-observability.ts";
import { prepareProjectCreateTransport } from "../src/pages/Kepler/project-create-transport.ts";
import { executeProjectCreateFlow } from "../src/pages/Kepler/project-create-flow.ts";

const largeCreationSource = await readFile(
  new URL("../functions/_lib/project-large-creation.js", import.meta.url),
  "utf8",
);
const projectsSource = await readFile(
  new URL("../functions/_lib/projects.js", import.meta.url),
  "utf8",
);

function activeResponse(slug) {
  return new Response(
    JSON.stringify({
      ok: true,
      status: "active",
      project: {
        id: 12,
        slug,
        active: true,
        lifecycle: { state: "ACTIVE" },
        configRevision: 1,
      },
      lifecycle: { state: "ACTIVE" },
      configRevision: 1,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

test("CREATE pequeno permanece inline e usa apenas POST", async () => {
  const config = {
    version: "v1",
    config: { visState: { layers: [] } },
    datasets: [],
  };
  const idempotencyKey = "small-create-regression-0001";
  const attempt = beginClientSaveAttempt("create");
  const prepared = prepareProjectCreateTransport(attempt, {
    name: "Small create regression",
    description: "small",
    organizationId: 9,
    idempotencyKey,
    config,
    legacy: null,
  });

  assert.equal(prepared.large, false);
  const envelope = JSON.parse(prepared.requestBody);
  assert.deepEqual(envelope.config, config);
  assert.equal(envelope.largeConfig, undefined);

  const calls = [];
  const result = await executeProjectCreateFlow({
    attempt: beginClientSaveAttempt("create"),
    name: "Small create regression",
    description: "small",
    organizationId: 9,
    idempotencyKey,
    config,
    legacy: null,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(url, "/api/projects");
      return activeResponse("small-create-regression");
    },
  });

  assert.equal(result.transport, "inline");
  assert.equal(result.revision, 1);
  assert.equal(calls.length, 1);
});

test("SAVE pequeno existente mantém envelope JSON e optimistic concurrency", () => {
  const attempt = beginClientSaveAttempt("update");
  const config = {
    version: "v1",
    config: { visState: { layers: [] } },
    datasets: [],
  };
  const serialized = serializeSaveRequest(attempt, {
    config,
    expectedConfigRevision: 7,
  });
  const headers = buildSaveRequestHeaders(attempt);

  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-Maono-Large-Config"], undefined);
  assert.deepEqual(JSON.parse(serialized.body), {
    config,
    expectedConfigRevision: 7,
  });
});

test("SAVE grande existente continua N -> N+1 e usa headers streaming", () => {
  const attempt = beginClientSaveAttempt("update");
  const config = {
    version: "v1",
    config: { visState: { layers: [] } },
    datasets: [],
    largeFixture: "x".repeat(8 * 1024 * 1024 + 1024),
  };
  const serialized = serializeSaveRequest(attempt, {
    config,
    expectedConfigRevision: 12,
  });
  const headers = buildSaveRequestHeaders(attempt);

  assert.ok(serialized.payloadBytes > 8 * 1024 * 1024);
  assert.equal(headers["X-Maono-Large-Config"], "1");
  assert.equal(headers["X-Maono-Expected-Revision"], "12");
  assert.equal(headers["X-Maono-Config-Size"], String(serialized.payloadBytes));
  assert.equal(JSON.parse(serialized.body).expectedConfigRevision, undefined);
});

test("lifecycle Large CREATE preserva reserva -> storage -> CONFIG_READY -> ACTIVE -> quota commit", () => {
  const reserve = largeCreationSource.indexOf("reserveProjectQuota(env");
  const processing = largeCreationSource.indexOf("markProjectQuotaProcessing(env", reserve);
  const pending = largeCreationSource.indexOf("createPendingProject(env", processing);
  const preparing = largeCreationSource.indexOf("ensurePreparingStorage(", pending);
  const finalizeStart = largeCreationSource.indexOf("export async function finalizeLargeProjectCreation");
  const published = largeCreationSource.indexOf("ensurePublishedInitialRevision", finalizeStart);
  const configReady = largeCreationSource.indexOf("toState: PROJECT_LIFECYCLE_STATES.CONFIG_READY", published);
  const owner = largeCreationSource.indexOf("linkOwner(env", configReady);
  const file = largeCreationSource.indexOf("activateOrganizationFile(env", owner);
  const active = largeCreationSource.indexOf("toState: PROJECT_LIFECYCLE_STATES.ACTIVE", file);
  const quotaCommit = largeCreationSource.indexOf("commitProjectQuota(env", active);

  assert.ok(reserve >= 0);
  assert.ok(processing > reserve);
  assert.ok(pending > processing);
  assert.ok(preparing > pending);
  assert.ok(finalizeStart > preparing);
  assert.ok(published > finalizeStart);
  assert.ok(configReady > published);
  assert.ok(owner > configReady);
  assert.ok(file > owner);
  assert.ok(active > file);
  assert.ok(quotaCommit > active);
});

test("projeto lifecycle-managed não é publicável antes de ACTIVE", () => {
  assert.match(projectsSource, /projects\.lifecycle_state = 'ACTIVE'/);
  assert.match(
    projectsSource,
    /projects\.lifecycle_state IS NULL AND projects\.active = 1/,
  );
  assert.doesNotMatch(
    projectsSource,
    /projects\.lifecycle_state = 'PREPARING_STORAGE'[\s\S]*OR/,
  );
  assert.doesNotMatch(
    projectsSource,
    /projects\.lifecycle_state = 'CONFIG_READY'[\s\S]*OR/,
  );
});

test("arquivo da organização só vira ACTIVE durante finalização, depois da revisão publicada", () => {
  const finalizeStart = largeCreationSource.indexOf("export async function finalizeLargeProjectCreation");
  const finalize = largeCreationSource.slice(finalizeStart);
  const published = finalize.indexOf("ensurePublishedInitialRevision");
  const file = finalize.indexOf("activateOrganizationFile");
  const fileSql = finalize.indexOf("status = 'ACTIVE'", file);

  assert.ok(published >= 0);
  assert.ok(file > published);
  assert.ok(fileSql > file);
});
