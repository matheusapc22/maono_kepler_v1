import assert from "node:assert/strict";
import test from "node:test";

import {
  ORGANIZATION_STORAGE_CLAIM_TTL_MS,
  ORGANIZATION_STORAGE_STATUS,
  __organizationStorageTesting,
  canonicalOrganizationRoot,
  ensureOrganizationStorage,
  organizationDocumentsRoot,
  repairActiveOrganizationStorages,
} from "../functions/_lib/organization-storage.js";

import { STORAGE_COLUMNS, createStorageSqliteEnv as createFakeEnv } from "./helpers/storage-sqlite.mjs";
import { readOrganizationStorageIncident } from "../functions/_lib/organization-storage-retry.js";
function clone(row) { return row ? { ...row } : null; }

function organization(overrides = {}) {
  return {
    id: 1,
    name: "Organização Teste",
    slug: "organizacao-teste",
    active: 1,
    dropbox_root_path: "/projects/organizacao-teste",
    storage_status: "ERROR",
    storage_error: "DROPBOX_UNAVAILABLE",
    storage_checked_at: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

test("raiz canônica permanece dentro de /projects e documents deriva dela", () => {
  const invalid = organization({
    id: 7,
    slug: "Cliente Árvore",
    dropbox_root_path: "/legacy/cliente",
  });

  assert.equal(canonicalOrganizationRoot(invalid), "/projects/cliente-arvore");
  assert.equal(
    organizationDocumentsRoot(invalid),
    "/projects/cliente-arvore/documents",
  );

  const configured = organization({
    dropbox_root_path: "/projects/custom-root",
  });
  assert.equal(canonicalOrganizationRoot(configured), "/projects/custom-root");
});

test("claim recente impede provisionamento concorrente duplicado", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([organization()]);
  let releaseFirst;
  let providerCalls = 0;

  const firstProvider = async () => {
    providerCalls += 1;
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
  };

  const first = ensureOrganizationStorage(env, clone(env.__rows.get(1)), {
    nowFn: () => now,
    ensureFolder: firstProvider,
    correlationId: "corr-prh04-concurrency-1",
  });

  await new Promise((resolve) => setImmediate(resolve));

  const second = await ensureOrganizationStorage(
    env,
    clone(env.__rows.get(1)),
    {
      nowFn: () => now + 1_000,
      ensureFolder: async () => {
        providerCalls += 1;
      },
      correlationId: "corr-prh04-concurrency-2",
    },
  );

  assert.equal(second.claimed, false);
  assert.equal(second.busy, true);
  assert.equal(second.status, ORGANIZATION_STORAGE_STATUS.PENDING);
  assert.equal(providerCalls, 1);

  releaseFirst();
  const completed = await first;
  assert.equal(completed.ready, true);
  assert.equal(env.__rows.get(1).storage_status, "READY");
});

test("READY saudável não reprovisiona storage por padrão", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      storage_status: "READY",
      storage_error: null,
      storage_checked_at: new Date(now - 5_000).toISOString(),
    }),
  ]);
  let providerCalls = 0;

  const result = await ensureOrganizationStorage(
    env,
    clone(env.__rows.get(1)),
    {
      nowFn: () => now,
      ensureFolder: async () => {
        providerCalls += 1;
      },
      correlationId: "corr-prh05-ready-noop",
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(result.ready, true);
  assert.equal(result.claimed, false);
  assert.equal(env.__rows.get(1).storage_status, "READY");
});

test("READY pode ser revalidado explicitamente quando necessário", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      storage_status: "READY",
      storage_error: null,
      storage_checked_at: new Date(now - 5_000).toISOString(),
    }),
  ]);
  let providerCalls = 0;

  const result = await ensureOrganizationStorage(
    env,
    clone(env.__rows.get(1)),
    {
      nowFn: () => now,
      ensureFolder: async () => {
        providerCalls += 1;
      },
      revalidateReady: true,
      correlationId: "corr-prh05-ready-revalidate",
    },
  );

  assert.equal(providerCalls, 1);
  assert.equal(result.ready, true);
  assert.equal(result.claimed, true);
});

test("PENDING expirado pode ser retomado e convergir para READY", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      storage_status: "PENDING",
      storage_error: null,
      storage_checked_at: new Date(
        now - ORGANIZATION_STORAGE_CLAIM_TTL_MS - 1_000,
      ).toISOString(),
    }),
  ]);
  let calls = 0;

  const result = await ensureOrganizationStorage(
    env,
    clone(env.__rows.get(1)),
    {
      nowFn: () => now,
      ensureFolder: async () => {
        calls += 1;
      },
      correlationId: "corr-prh04-stale",
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.claimed, true);
  assert.equal(result.ready, true);
  assert.equal(env.__rows.get(1).storage_status, "READY");
});

test("conclusão antiga não sobrescreve claim mais novo", async () => {
  let now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([organization()]);
  let releaseFirst;

  const first = ensureOrganizationStorage(env, clone(env.__rows.get(1)), {
    nowFn: () => now,
    ensureFolder: async () => {
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    },
    correlationId: "corr-prh04-old",
  });

  await new Promise((resolve) => setImmediate(resolve));

  now += ORGANIZATION_STORAGE_CLAIM_TTL_MS + 5_000;
  const second = await ensureOrganizationStorage(
    env,
    clone(env.__rows.get(1)),
    {
      nowFn: () => now,
      ensureFolder: async () => {},
      correlationId: "corr-prh04-new",
    },
  );

  assert.equal(second.ready, true);
  assert.equal(env.__rows.get(1).storage_status, "READY");

  releaseFirst();
  const oldCompletion = await first;
  assert.equal(oldCompletion.superseded, true);
  assert.equal(oldCompletion.ready, true);
  assert.equal(env.__rows.get(1).storage_status, "READY");
  assert.equal(
    env.__rows.get(1).storage_checked_at,
    new Date(now).toISOString(),
  );
});

test("falha persiste código canônico, não mensagem técnica do provider", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([organization()]);
  const providerError = new Error("token secreto e detalhe técnico");
  providerError.code = "DROPBOX_UNAVAILABLE";
  providerError.retryable = true;

  await assert.rejects(
    () =>
      ensureOrganizationStorage(env, clone(env.__rows.get(1)), {
        nowFn: () => now,
        ensureFolder: async () => {
          throw providerError;
        },
        correlationId: "corr-prh04-failure",
      }),
    (error) => {
      assert.equal(error.code, "ORGANIZATION_STORAGE_PROVISION_FAILED");
      assert.equal(error.category, "STORAGE");
      assert.equal(error.retryable, true);
      assert.equal(error.correlationId, "corr-prh04-failure");
      assert.equal(error.details.providerCode, "DROPBOX_UNAVAILABLE");
      return true;
    },
  );

  assert.equal(env.__rows.get(1).storage_status, "ERROR");
  assert.equal(readOrganizationStorageIncident(env.__rows.get(1).storage_error).providerCode, "DROPBOX_UNAVAILABLE");
  assert.doesNotMatch(
    String(env.__rows.get(1).storage_error),
    /token secreto|detalhe técnico/i,
  );
});

test("repair pagina apenas candidatos inconsistentes e não causa starvation", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({ id: 1, slug: "a", dropbox_root_path: "/projects/a" }),
    organization({ id: 2, slug: "b", dropbox_root_path: "/projects/b" }),
    organization({ id: 3, slug: "c", dropbox_root_path: "/projects/c" }),
    organization({
      id: 4,
      slug: "healthy",
      dropbox_root_path: "/projects/healthy",
      storage_status: "READY",
      storage_error: null,
      storage_checked_at: new Date(now).toISOString(),
    }),
    organization({
      id: 5,
      slug: "busy",
      dropbox_root_path: "/projects/busy",
      storage_status: "PENDING",
      storage_error: null,
      storage_checked_at: new Date(now - 1_000).toISOString(),
    }),
  ]);
  const provisioned = [];

  const first = await repairActiveOrganizationStorages(env, {
    limit: 2,
    afterId: 0,
    nowFn: () => now,
    correlationId: "corr-prh04-page",
    ensureFolder: async (_env, path) => provisioned.push(path),
  });

  assert.equal(first.checked, 2);
  assert.equal(first.ready, 2);
  assert.equal(first.failed, 0);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, 2);
  assert.deepEqual(
    first.organizations.map((item) => item.organizationId),
    [1, 2],
  );

  const second = await repairActiveOrganizationStorages(env, {
    limit: 2,
    afterId: first.nextCursor,
    nowFn: () => now,
    correlationId: "corr-prh04-page",
    ensureFolder: async (_env, path) => provisioned.push(path),
  });

  assert.equal(second.checked, 1);
  assert.equal(second.ready, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    second.organizations.map((item) => item.organizationId),
    [3],
  );
  assert.equal(env.__rows.get(4).storage_status, "READY");
  assert.equal(env.__rows.get(5).storage_status, "PENDING");
  assert.deepEqual(provisioned, [
    "/projects/a/documents",
    "/projects/b/documents",
    "/projects/c/documents",
  ]);
});

test("repair inclui PENDING expirado, mas ignora PENDING recente", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      id: 1,
      slug: "stale",
      dropbox_root_path: "/projects/stale",
      storage_status: "PENDING",
      storage_error: null,
      storage_checked_at: new Date(
        now - ORGANIZATION_STORAGE_CLAIM_TTL_MS - 1,
      ).toISOString(),
    }),
    organization({
      id: 2,
      slug: "fresh",
      dropbox_root_path: "/projects/fresh",
      storage_status: "PENDING",
      storage_error: null,
      storage_checked_at: new Date(now - 1_000).toISOString(),
    }),
  ]);

  const result = await repairActiveOrganizationStorages(env, {
    limit: 10,
    nowFn: () => now,
    correlationId: "corr-prh04-pending",
    ensureFolder: async () => {},
  });

  assert.equal(result.checked, 1);
  assert.deepEqual(
    result.organizations.map((item) => item.organizationId),
    [1],
  );
  assert.equal(env.__rows.get(1).storage_status, "READY");
  assert.equal(env.__rows.get(2).storage_status, "PENDING");
});

test("PENDING com timestamp legado inválido é recuperável", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      storage_status: "PENDING",
      storage_error: null,
      storage_checked_at: "timestamp-legado-invalido",
    }),
  ]);

  const result = await repairActiveOrganizationStorages(env, {
    limit: 10,
    nowFn: () => now,
    correlationId: "corr-prh04-invalid-date",
    ensureFolder: async () => {},
  });

  assert.equal(result.checked, 1);
  assert.equal(result.ready, 1);
  assert.equal(env.__rows.get(1).storage_status, "READY");
});

test("recovery automático respeita backoff de ERROR recente", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      id: 1,
      slug: "recent",
      dropbox_root_path: "/projects/recent",
      storage_status: "ERROR",
      storage_checked_at: new Date(now - 60_000).toISOString(),
    }),
    organization({
      id: 2,
      slug: "old",
      dropbox_root_path: "/projects/old",
      storage_status: "ERROR",
      storage_checked_at: new Date(now - 30 * 60_000).toISOString(),
    }),
  ]);
  const provisioned = [];

  const result = await repairActiveOrganizationStorages(env, {
    limit: 10,
    nowFn: () => now,
    correlationId: "corr-prh06-backoff",
    errorBackoffMs: 15 * 60_000,
    fairOrder: true,
    ensureFolder: async (_env, path) => provisioned.push(path),
  });

  assert.equal(result.checked, 1);
  assert.equal(result.ready, 1);
  assert.deepEqual(
    result.organizations.map((item) => item.organizationId),
    [2],
  );
  assert.equal(env.__rows.get(1).storage_status, "ERROR");
  assert.equal(env.__rows.get(2).storage_status, "READY");
  assert.deepEqual(provisioned, ["/projects/old/documents"]);
});

test("fair order prioriza checked_at mais antigo e não depende de cursor", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      id: 1,
      slug: "newer",
      dropbox_root_path: "/projects/newer",
      storage_status: "ERROR",
      storage_checked_at: new Date(now - 20 * 60_000).toISOString(),
    }),
    organization({
      id: 9,
      slug: "older",
      dropbox_root_path: "/projects/older",
      storage_status: "ERROR",
      storage_checked_at: new Date(now - 60 * 60_000).toISOString(),
    }),
  ]);

  const result = await repairActiveOrganizationStorages(env, {
    limit: 1,
    afterId: 999,
    nowFn: () => now,
    correlationId: "corr-prh06-fair",
    fairOrder: true,
    ensureFolder: async () => {},
  });

  assert.equal(result.checked, 1);
  assert.equal(result.organizations[0].organizationId, 9);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, null);
});

test("dry-run reporta candidatos sem claim, mutação ou provider call", async () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const env = createFakeEnv([
    organization({
      id: 3,
      slug: "dry",
      dropbox_root_path: "/projects/dry",
      storage_status: "ERROR",
      storage_checked_at: new Date(now - 60 * 60_000).toISOString(),
    }),
  ]);
  let providerCalls = 0;

  const result = await repairActiveOrganizationStorages(env, {
    limit: 10,
    nowFn: () => now,
    correlationId: "corr-prh06-dry",
    fairOrder: true,
    dryRun: true,
    errorBackoffMs: 15 * 60_000,
    ensureFolder: async () => {
      providerCalls += 1;
    },
  });

  assert.equal(providerCalls, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.ready, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.organizations[0].reason, "ERROR_RETRY");
  assert.equal(env.__rows.get(3).storage_status, "ERROR");
});

test("schema 0009 é exigido integralmente", async () => {
  const env = createFakeEnv([organization()], {
    columns: STORAGE_COLUMNS.filter((column) => column !== "storage_checked_at"),
  });

  await assert.rejects(
    () =>
      ensureOrganizationStorage(env, organization(), {
        ensureFolder: async () => {},
        correlationId: "corr-prh04-schema",
      }),
    (error) => {
      assert.equal(error.code, "ORGANIZATION_STORAGE_SCHEMA_OUTDATED");
      assert.equal(error.correlationId, "corr-prh04-schema");
      assert.deepEqual(error.details.missingColumns, ["storage_checked_at"]);
      return true;
    },
  );
});

test("retryability respeita flag explícita e status do provider", () => {
  const { storageCauseRetryable } = __organizationStorageTesting;

  assert.equal(storageCauseRetryable({ retryable: false, status: 503 }), false);
  assert.equal(storageCauseRetryable({ retryable: true, status: 400 }), true);
  assert.equal(storageCauseRetryable({ status: 429 }), true);
  assert.equal(storageCauseRetryable({ status: 503 }), true);
  assert.equal(storageCauseRetryable({ status: 400 }), false);
});

test("helpers normalizam limites e reconhecem lease recente", () => {
  assert.equal(__organizationStorageTesting.normalizeLimit(9_999), 500);
  assert.equal(__organizationStorageTesting.normalizeLimit("invalid"), 100);
  assert.equal(__organizationStorageTesting.normalizeAfterId(-1), 0);
  assert.equal(__organizationStorageTesting.normalizeAfterId(15), 15);

  const now = Date.parse("2026-09-18T12:00:00.000Z");
  assert.equal(
    __organizationStorageTesting.isPendingClaimFresh(
      organization({
        storage_status: "PENDING",
        storage_checked_at: new Date(now - 5_000).toISOString(),
      }),
      now,
    ),
    true,
  );
});
