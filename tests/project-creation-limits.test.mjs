import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  assertCanOpenNewMapEditor,
  commitProjectQuota,
  getOrganizationLimitsSnapshot,
  markProjectQuotaProcessing,
  releaseProjectQuota,
  reserveProjectQuota,
} from "../functions/_lib/organization-limit-service.js";

const migrationUrl = new URL(
  "../migrations/0016_map_panel_navigation_and_quota.sql",
  import.meta.url,
);
const schemaUrl = new URL("../schema.sql", import.meta.url);
const createUrl = new URL(
  "../functions/api/projects/index.js",
  import.meta.url,
);
const [migration, schema, creation] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(schemaUrl, "utf8"),
  readFile(createUrl, "utf8"),
]);

function databaseFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      dropbox_root_path TEXT NOT NULL,
      storage_status TEXT NOT NULL DEFAULT 'READY',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE organization_files (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER,
      size_bytes INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    );
    INSERT INTO users (id, name) VALUES (10, 'Editor');
    INSERT INTO organizations (
      id, name, slug, dropbox_root_path, storage_status, active
    ) VALUES (7, 'Acme', 'acme', '/acme', 'READY', 1);
  `);
  database.exec(migration);
  return database;
}

function d1Environment(database, overrides = {}) {
  return {
    PROJECT_QUOTA_RESERVATION_V1: "true",
    PROJECT_LIMIT_FREE: "2",
    DB: {
      prepare(sql) {
        const statement = database.prepare(sql);
        let parameters = [];

        return {
          bind(...values) {
            parameters = values;
            return this;
          },
          first() {
            return statement.get(...parameters) ?? null;
          },
          run() {
            return statement.run(...parameters);
          },
          all() {
            return { results: statement.all(...parameters) };
          },
        };
      },
    },
    ...overrides,
  };
}

test("migration 0016 cria reserva idempotente e índices operacionais", () => {
  const database = databaseFixture();
  const columns = database
    .prepare(
      "PRAGMA table_info(organization_resource_reservations)",
    )
    .all()
    .map((column) => column.name);

  for (const column of [
    "organization_id",
    "resource_type",
    "idempotency_key",
    "project_id",
    "actor_user_id",
    "status",
    "expires_at",
    "error_code",
  ]) {
    assert.ok(columns.includes(column), column);
  }

  const indexes = database
    .prepare(
      "PRAGMA index_list(organization_resource_reservations)",
    )
    .all()
    .map((index) => index.name);
  assert.ok(indexes.includes("idx_resource_reservations_org_status"));
  assert.ok(indexes.includes("idx_resource_reservations_project"));
  assert.ok(indexes.includes("idx_resource_reservations_expiration"));
});

test("preflight informa limites sem consumir reserva", async () => {
  const database = databaseFixture();
  const env = d1Environment(database);
  const result = await assertCanOpenNewMapEditor(env, 7);

  assert.equal(result.allowed, true);
  assert.deepEqual(result.snapshot.projects, {
    used: 0,
    reserved: 0,
    limit: 2,
    remaining: 2,
  });
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS total FROM organization_resource_reservations",
      )
      .get().total,
    0,
  );
});

test("reservas concorrentes não ultrapassam a capacidade", async () => {
  const database = databaseFixture();
  const env = d1Environment(database);

  const first = await reserveProjectQuota(env, {
    organizationId: 7,
    idempotencyKey: "project-create:first",
    actorUserId: 10,
  });
  const second = await reserveProjectQuota(env, {
    organizationId: 7,
    idempotencyKey: "project-create:second",
    actorUserId: 10,
  });

  assert.equal(first.status, "RESERVED");
  assert.equal(second.status, "RESERVED");

  await assert.rejects(
    reserveProjectQuota(env, {
      organizationId: 7,
      idempotencyKey: "project-create:third",
      actorUserId: 10,
    }),
    (error) =>
      error?.code === "ORGANIZATION_PROJECT_LIMIT_REACHED" &&
      error?.status === 409,
  );

  const snapshot = await getOrganizationLimitsSnapshot(env, 7);
  assert.equal(snapshot.projects.reserved, 2);
  assert.equal(snapshot.projects.remaining, 0);
});

test("mesma chave é idempotente e não ocupa duas vagas", async () => {
  const database = databaseFixture();
  const env = d1Environment(database);
  const input = {
    organizationId: 7,
    idempotencyKey: "project-create:same-key",
    actorUserId: 10,
  };
  const first = await reserveProjectQuota(env, input);
  const repeated = await reserveProjectQuota(env, input);

  assert.equal(repeated.id, first.id);
  assert.equal(repeated.idempotent, true);
  assert.equal(
    (await getOrganizationLimitsSnapshot(env, 7)).projects.reserved,
    1,
  );
});

test("PROCESSING renova o TTL da criação em andamento", async () => {
  const database = databaseFixture();
  const env = d1Environment(database);
  const reservation = await reserveProjectQuota(env, {
    organizationId: 7,
    idempotencyKey: "project-create:processing",
    actorUserId: 10,
    now: new Date("2000-01-01T12:00:00.000Z"),
  });
  const processing = await markProjectQuotaProcessing(
    env,
    reservation.id,
  );

  assert.equal(processing.status, "PROCESSING");
  assert.ok(
    new Date(processing.expiresAt).getTime() >
      new Date(reservation.expiresAt).getTime(),
  );
});

test("release devolve a vaga e commit vincula o projeto", async () => {
  const database = databaseFixture();
  const env = d1Environment(database);
  const reservation = await reserveProjectQuota(env, {
    organizationId: 7,
    idempotencyKey: "project-create:release",
    actorUserId: 10,
  });
  const released = await releaseProjectQuota(env, {
    reservationId: reservation.id,
    errorCode: "UPLOAD_FAILED",
  });

  assert.equal(released.status, "RELEASED");
  assert.equal(
    (await getOrganizationLimitsSnapshot(env, 7)).projects.remaining,
    2,
  );

  const reactivated = await reserveProjectQuota(env, {
    organizationId: 7,
    idempotencyKey: "project-create:release",
    actorUserId: 10,
  });
  database
    .prepare(
      "INSERT INTO projects (id, organization_id, active) VALUES (99, 7, 1)",
    )
    .run();
  const committed = await commitProjectQuota(env, {
    reservationId: reactivated.id,
    projectId: 99,
  });

  assert.equal(committed.status, "COMMITTED");
  assert.equal(committed.projectId, 99);
  const snapshot = await getOrganizationLimitsSnapshot(env, 7);
  assert.equal(snapshot.projects.used, 1);
  assert.equal(snapshot.projects.reserved, 0);
});

test("storage não pronto bloqueia o novo editor", async () => {
  const database = databaseFixture();
  database
    .prepare(
      "UPDATE organizations SET storage_status = 'PENDING' WHERE id = 7",
    )
    .run();
  const result = await assertCanOpenNewMapEditor(
    d1Environment(database),
    7,
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ORGANIZATION_STORAGE_NOT_CONFIGURED");
});

test("schema canônico e criação usam a mesma máquina de estados", () => {
  for (const source of [migration, schema]) {
    assert.match(
      source,
      /organization_resource_reservations/,
    );
    assert.match(
      source,
      /'RESERVED'[\s\S]*'PROCESSING'[\s\S]*'COMMITTED'/,
    );
  }

  assert.match(creation, /reserveProjectQuota/);
  assert.match(creation, /markProjectQuotaProcessing/);
  assert.match(creation, /commitProjectQuota/);
  assert.match(creation, /releaseProjectQuota/);
  assert.match(creation, /PROJECT_CREATION_IN_PROGRESS/);
});
