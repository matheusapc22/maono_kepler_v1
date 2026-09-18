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

const STORAGE_COLUMNS = [
  "id",
  "name",
  "slug",
  "active",
  "dropbox_root_path",
  "storage_status",
  "storage_error",
  "storage_checked_at",
  "updated_at",
];

function activeValue(value) {
  return !(value === 0 || value === "0" || value === false);
}

function clone(row) {
  return row ? { ...row } : null;
}

function candidate(row, afterId, staleBefore) {
  if (!activeValue(row.active) || Number(row.id) <= Number(afterId)) return false;

  const path = String(row.dropbox_root_path || "").trim();
  const status = String(row.storage_status || "").trim().toUpperCase();
  const checkedAt = String(row.storage_checked_at || "");
  const checkedAtMs = Date.parse(checkedAt);
  const staleBeforeMs = Date.parse(staleBefore);
  const storageError = String(row.storage_error || "").trim();

  return (
    !path ||
    path === "/projects" ||
    !path.startsWith("/projects/") ||
    !status ||
    !["READY", "PENDING", "ERROR", "DISABLED"].includes(status) ||
    status === "ERROR" ||
    status === "DISABLED" ||
    (status === "PENDING" &&
      (!checkedAt ||
        !Number.isFinite(checkedAtMs) ||
        checkedAtMs < staleBeforeMs)) ||
    (status === "READY" && Boolean(storageError))
  );
}

function createFakeEnv(initialRows, { columns = STORAGE_COLUMNS } = {}) {
  const rows = new Map(initialRows.map((row) => [Number(row.id), clone(row)]));
  const statements = [];

  function statement(sql) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    let args = [];

    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        statements.push({ kind: "first", sql: normalized, args: [...args] });

        if (normalized.includes("FROM sqlite_master")) {
          return { name: "organizations" };
        }

        if (
          normalized.startsWith("SELECT * FROM organizations") &&
          normalized.includes("WHERE id = ?")
        ) {
          return clone(rows.get(Number(args[0])));
        }

        if (
          normalized.startsWith("UPDATE organizations") &&
          normalized.includes("storage_status = 'DISABLED'")
        ) {
          const [rootPath, checkedAt, updatedAt, organizationId] = args;
          const row = rows.get(Number(organizationId));
          if (!row || activeValue(row.active)) return null;
          Object.assign(row, {
            dropbox_root_path: rootPath,
            storage_status: "DISABLED",
            storage_error: null,
            storage_checked_at: checkedAt,
            updated_at: updatedAt,
          });
          return clone(row);
        }

        if (
          normalized.startsWith("UPDATE organizations") &&
          normalized.includes("SET dropbox_root_path = ?") &&
          normalized.includes("storage_status = 'PENDING'")
        ) {
          const [rootPath, claimAt, updatedAt, organizationId, staleBefore] = args;
          const row = rows.get(Number(organizationId));
          if (!row || !activeValue(row.active)) return null;

          const status = String(row.storage_status || "").trim().toUpperCase();
          const checkedAt = String(row.storage_checked_at || "");
          const checkedAtMs = Date.parse(checkedAt);
          const staleBeforeMs = Date.parse(staleBefore);
          const canClaim =
            !status ||
            status !== "PENDING" ||
            !checkedAt ||
            !Number.isFinite(checkedAtMs) ||
            checkedAtMs < staleBeforeMs;

          if (!canClaim) return null;

          Object.assign(row, {
            dropbox_root_path: rootPath,
            storage_status: "PENDING",
            storage_error: null,
            storage_checked_at: claimAt,
            updated_at: updatedAt,
          });
          return clone(row);
        }

        if (
          normalized.startsWith("UPDATE organizations") &&
          normalized.includes("storage_status = ?")
        ) {
          const [
            status,
            errorCode,
            completedAt,
            updatedAt,
            organizationId,
            claimAt,
          ] = args;
          const row = rows.get(Number(organizationId));
          if (
            !row ||
            !activeValue(row.active) ||
            String(row.storage_status || "").toUpperCase() !== "PENDING" ||
            row.storage_checked_at !== claimAt
          ) {
            return null;
          }

          Object.assign(row, {
            storage_status: status,
            storage_error: errorCode,
            storage_checked_at: completedAt,
            updated_at: updatedAt,
          });
          return clone(row);
        }

        throw new Error(`Unhandled first() SQL: ${normalized}`);
      },
      async all() {
        statements.push({ kind: "all", sql: normalized, args: [...args] });

        if (normalized.startsWith('PRAGMA table_info("organizations")')) {
          return {
            results: columns.map((name, index) => ({
              cid: index,
              name,
            })),
          };
        }

        if (
          normalized.startsWith("SELECT * FROM organizations") &&
          normalized.includes("id > ?") &&
          normalized.includes("ORDER BY id ASC")
        ) {
          const [afterId, staleBefore, limit] = args;
          const result = [...rows.values()]
            .filter((row) => candidate(row, afterId, staleBefore))
            .sort((a, b) => Number(a.id) - Number(b.id))
            .slice(0, Number(limit))
            .map(clone);
          return { results: result };
        }

        throw new Error(`Unhandled all() SQL: ${normalized}`);
      },
      async run() {
        statements.push({ kind: "run", sql: normalized, args: [...args] });
        throw new Error(`Unhandled run() SQL: ${normalized}`);
      },
    };
  }

  return {
    DB: {
      prepare: statement,
    },
    __rows: rows,
    __statements: statements,
  };
}

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
  assert.equal(env.__rows.get(1).storage_error, "DROPBOX_UNAVAILABLE");
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
