import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrganizationLifecycle,
  updateOrganizationLifecycle,
} from "../functions/_lib/organization-lifecycle.js";

function clone(row) {
  return row ? { ...row } : null;
}

function createFakeEnv(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [Number(row.id), clone(row)]));
  let nextId =
    Math.max(0, ...[...rows.keys()].map((value) => Number(value))) + 1;
  const calls = [];

  function findBy(field, value) {
    return (
      [...rows.values()].find(
        (row) => String(row[field]) === String(value),
      ) || null
    );
  }

  return {
    DB: {
      prepare(sql) {
        const normalized = String(sql).replace(/\s+/g, " ").trim();
        let args = [];

        return {
          bind(...values) {
            args = values;
            return this;
          },
          async first() {
            calls.push({ sql: normalized, args: [...args] });

            if (
              normalized.startsWith("SELECT * FROM organizations") &&
              normalized.includes("WHERE id = ?")
            ) {
              return clone(rows.get(Number(args[0])));
            }

            if (
              normalized.startsWith("SELECT * FROM organizations") &&
              normalized.includes("WHERE slug = ?")
            ) {
              return clone(findBy("slug", args[0]));
            }

            if (
              normalized.startsWith("SELECT * FROM organizations") &&
              normalized.includes("WHERE dropbox_root_path = ?")
            ) {
              return clone(findBy("dropbox_root_path", args[0]));
            }

            if (normalized.startsWith("INSERT INTO organizations")) {
              const [
                name,
                slug,
                description,
                dropboxRootPath,
                active,
                storageStatus,
                storageCheckedAt,
              ] = args;

              if (
                findBy("slug", slug) ||
                findBy("dropbox_root_path", dropboxRootPath)
              ) {
                const error = new Error(
                  "UNIQUE constraint failed: organizations.slug",
                );
                throw error;
              }

              const now = "2026-09-18T16:00:00.000Z";
              const row = {
                id: nextId++,
                name,
                slug,
                description,
                dropbox_root_path: dropboxRootPath,
                active,
                storage_status: storageStatus,
                storage_error: null,
                storage_checked_at: storageCheckedAt,
                created_at: now,
                updated_at: now,
              };
              rows.set(Number(row.id), row);
              return clone(row);
            }

            if (
              normalized.startsWith("UPDATE organizations") &&
              normalized.includes("storage_status = 'DISABLED'")
            ) {
              const [
                name,
                slug,
                description,
                dropboxRootPath,
                checkedAt,
                updatedAt,
                organizationId,
              ] = args;
              const row = rows.get(Number(organizationId));
              Object.assign(row, {
                name,
                slug,
                description,
                dropbox_root_path: dropboxRootPath,
                active: 0,
                storage_status: "DISABLED",
                storage_error: null,
                storage_checked_at: checkedAt,
                updated_at: updatedAt,
              });
              return clone(row);
            }

            if (
              normalized.startsWith("UPDATE organizations") &&
              normalized.includes("storage_status = 'PENDING'")
            ) {
              const [
                name,
                slug,
                description,
                dropboxRootPath,
                updatedAt,
                organizationId,
              ] = args;
              const row = rows.get(Number(organizationId));
              Object.assign(row, {
                name,
                slug,
                description,
                dropbox_root_path: dropboxRootPath,
                active: 1,
                storage_status: "PENDING",
                storage_error: null,
                storage_checked_at: null,
                updated_at: updatedAt,
              });
              return clone(row);
            }

            if (
              normalized.startsWith("UPDATE organizations") &&
              normalized.includes("SET name = ?") &&
              normalized.includes("active = 1")
            ) {
              const [
                name,
                slug,
                description,
                dropboxRootPath,
                updatedAt,
                organizationId,
              ] = args;
              const row = rows.get(Number(organizationId));
              Object.assign(row, {
                name,
                slug,
                description,
                dropbox_root_path: dropboxRootPath,
                active: 1,
                updated_at: updatedAt,
              });
              return clone(row);
            }

            throw new Error(`Unhandled lifecycle SQL: ${normalized}`);
          },
        };
      },
    },
    __rows: rows,
    __calls: calls,
  };
}

function organization(overrides = {}) {
  return {
    id: 1,
    name: "Cliente A",
    slug: "cliente-a",
    description: null,
    dropbox_root_path: "/projects/cliente-a",
    active: 1,
    storage_status: "READY",
    storage_error: null,
    storage_checked_at: "2026-09-18T15:00:00.000Z",
    created_at: "2026-09-18T14:00:00.000Z",
    updated_at: "2026-09-18T15:00:00.000Z",
    ...overrides,
  };
}

function readyStorageStub(counter = { calls: 0 }) {
  return async (env, row, options) => {
    counter.calls += 1;
    assert.ok(env.__rows.has(Number(row.id)));
    assert.ok(options.correlationId);

    const persisted = env.__rows.get(Number(row.id));
    Object.assign(persisted, {
      storage_status: "READY",
      storage_error: null,
      storage_checked_at: "2026-09-18T16:00:01.000Z",
    });

    return {
      organization: clone(persisted),
      ready: true,
      busy: false,
      correlationId: options.correlationId,
    };
  };
}

test("create ativo persiste PENDING no D1 antes de provisionar storage", async () => {
  const env = createFakeEnv();
  let observedStatus = null;

  const result = await createOrganizationLifecycle(
    env,
    {
      name: "Cliente Novo",
      slug: "cliente-novo",
      dropboxRootPath: "/projects/cliente-novo",
      active: true,
    },
    {
      correlationId: "corr-prh05-create",
      nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
      ensureStorage: async (runtimeEnv, row) => {
        observedStatus =
          runtimeEnv.__rows.get(Number(row.id)).storage_status;
        return readyStorageStub()(runtimeEnv, row, {
          correlationId: "corr-prh05-create",
        });
      },
    },
  );

  assert.equal(observedStatus, "PENDING");
  assert.equal(result.created, true);
  assert.equal(result.resumed, false);
  assert.equal(result.storageReady, true);
  assert.equal(env.__rows.size, 1);
  assert.equal(env.__rows.get(1).storage_status, "READY");
});

test("falha deixa linha recuperável e retry natural não duplica organização", async () => {
  const env = createFakeEnv();
  const input = {
    name: "Cliente Retry",
    slug: "cliente-retry",
    dropboxRootPath: "/projects/cliente-retry",
    active: true,
  };

  await assert.rejects(
    () =>
      createOrganizationLifecycle(env, input, {
        correlationId: "corr-prh05-fail",
        nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
        ensureStorage: async (runtimeEnv, row) => {
          const persisted = runtimeEnv.__rows.get(Number(row.id));
          persisted.storage_status = "ERROR";
          persisted.storage_error = "DROPBOX_UNAVAILABLE";
          const error = new Error("provider failure");
          error.code = "ORGANIZATION_STORAGE_PROVISION_FAILED";
          error.publicMessage = "Não foi possível preparar o armazenamento.";
          throw error;
        },
      }),
  );

  assert.equal(env.__rows.size, 1);
  assert.equal(env.__rows.get(1).storage_status, "ERROR");

  const counter = { calls: 0 };
  const retry = await createOrganizationLifecycle(env, input, {
    correlationId: "corr-prh05-retry",
    nowFn: () => Date.parse("2026-09-18T16:01:00.000Z"),
    ensureStorage: readyStorageStub(counter),
  });

  assert.equal(env.__rows.size, 1);
  assert.equal(counter.calls, 1);
  assert.equal(retry.created, false);
  assert.equal(retry.resumed, true);
  assert.equal(retry.storageReady, true);
});

test("create não transforma organização READY existente em retry", async () => {
  const env = createFakeEnv([organization()]);
  let providerCalls = 0;

  await assert.rejects(
    () =>
      createOrganizationLifecycle(
        env,
        {
          name: "Cliente A",
          slug: "cliente-a",
          dropboxRootPath: "/projects/cliente-a",
          active: true,
        },
        {
          correlationId: "corr-prh05-exists",
          ensureStorage: async () => {
            providerCalls += 1;
          },
        },
      ),
    (error) => {
      assert.equal(error.code, "ORGANIZATION_EXISTS");
      assert.equal(error.status, 409);
      return true;
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(env.__rows.size, 1);
});

test("create inativo nasce DISABLED sem chamada ao provider", async () => {
  const env = createFakeEnv();
  let providerCalls = 0;

  const result = await createOrganizationLifecycle(
    env,
    {
      name: "Cliente Inativo",
      slug: "cliente-inativo",
      dropboxRootPath: "/projects/cliente-inativo",
      active: false,
    },
    {
      correlationId: "corr-prh05-disabled",
      nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
      ensureStorage: async () => {
        providerCalls += 1;
      },
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(result.organization.storage_status, "DISABLED");
  assert.equal(result.organization.active, 0);
});

test("update metadata-only em READY não toca no storage", async () => {
  const env = createFakeEnv([organization()]);
  let providerCalls = 0;

  const result = await updateOrganizationLifecycle(
    env,
    1,
    {
      description: "Descrição atualizada",
    },
    {
      correlationId: "corr-prh05-metadata",
      nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
      ensureStorage: async () => {
        providerCalls += 1;
      },
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(result.storageReady, true);
  assert.equal(result.organization.description, "Descrição atualizada");
  assert.equal(
    result.organization.storage_checked_at,
    "2026-09-18T15:00:00.000Z",
  );
});

test("reativação passa por PENDING antes de READY", async () => {
  const env = createFakeEnv([
    organization({
      active: 0,
      storage_status: "DISABLED",
      storage_checked_at: "2026-09-18T15:00:00.000Z",
    }),
  ]);
  let observedStatus = null;

  const result = await updateOrganizationLifecycle(
    env,
    1,
    { active: true },
    {
      correlationId: "corr-prh05-reactivate",
      nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
      ensureStorage: async (runtimeEnv, row) => {
        observedStatus =
          runtimeEnv.__rows.get(Number(row.id)).storage_status;
        return readyStorageStub()(runtimeEnv, row, {
          correlationId: "corr-prh05-reactivate",
        });
      },
    },
  );

  assert.equal(observedStatus, "PENDING");
  assert.equal(result.storageReady, true);
  assert.equal(result.organization.active, 1);
});

test("mudança de path em PENDING recente é bloqueada sem invalidar claim", async () => {
  const env = createFakeEnv([
    organization({
      storage_status: "PENDING",
      storage_checked_at: "2026-09-18T15:59:30.000Z",
    }),
  ]);

  await assert.rejects(
    () =>
      updateOrganizationLifecycle(
        env,
        1,
        { dropboxRootPath: "/projects/cliente-a-v2" },
        {
          correlationId: "corr-prh05-busy",
          nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
          ensureStorage: readyStorageStub(),
        },
      ),
    (error) => {
      assert.equal(error.code, "ORGANIZATION_STORAGE_IN_PROGRESS");
      assert.equal(error.retryable, true);
      return true;
    },
  );

  assert.equal(
    env.__rows.get(1).dropbox_root_path,
    "/projects/cliente-a",
  );
  assert.equal(env.__rows.get(1).storage_status, "PENDING");
});

test("desativação converge para DISABLED sem provider", async () => {
  const env = createFakeEnv([organization()]);
  let providerCalls = 0;

  const result = await updateOrganizationLifecycle(
    env,
    1,
    { active: false },
    {
      correlationId: "corr-prh05-deactivate",
      nowFn: () => Date.parse("2026-09-18T16:00:00.000Z"),
      ensureStorage: async () => {
        providerCalls += 1;
      },
    },
  );

  assert.equal(providerCalls, 0);
  assert.equal(result.organization.active, 0);
  assert.equal(result.organization.storage_status, "DISABLED");
});
