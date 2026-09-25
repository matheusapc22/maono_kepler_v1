import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  listExpiredOrganizationFilesForPurge,
  purgeOrganizationFile,
} from "../functions/_lib/organization-file-purge.js";
import { trashOrganizationFile } from "../functions/_lib/organization-file-trash.js";
import { createDocumentFolder } from "../functions/_lib/organization-file-folders.js";
import {
  organizationFilePurgeConfig,
  runScheduledDocumentPurge,
} from "../workers/organization-file-purge.js";
import { persistenceFixture, interruption } from "./helpers/project-persistence-fixture.mjs";

function insertFile(db, {
  id = 501,
  organizationId = 1,
  folderId = null,
  path = "/offline/a/documents/purge.pdf",
  status = "ACTIVE",
  active = 1,
  deletedAt = null,
  purgeAfter = null,
  purgedAt = null,
  updatedAt = "2026-09-24T10:00:00.000Z",
} = {}) {
  db.prepare(`
    INSERT INTO organization_files (
      id, organization_id, folder_id, name, original_name, file_name,
      dropbox_path, file_type, status, active, uploaded_by,
      created_at, updated_at, deleted_at, purge_after, purged_at
    ) VALUES (?, ?, ?, 'purge.pdf', 'purge.pdf', 'purge.pdf',
              ?, 'pdf', ?, ?, 1,
              '2026-09-24T10:00:00.000Z', ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    folderId,
    path,
    status,
    active,
    updatedAt,
    deletedAt,
    purgeAfter,
    purgedAt,
  );
}

test("purge confirma Dropbox antes do tombstone e preserva registro D1", async (t) => {
  let sawPendingAtProvider = false;
  const { env, db, store, objects } = persistenceFixture(t, {
    beforeProvider({ op, db: providerDb }) {
      if (op === "delete_v2") {
        const row = providerDb
          .prepare("SELECT status, purged_at FROM organization_files WHERE id = 501")
          .get();
        sawPendingAtProvider = row.status === "PURGE_PENDING" && row.purged_at == null;
      }
    },
  });

  const path = "/offline/a/documents/purge.pdf";
  await store(path, new TextEncoder().encode("conteudo"));
  insertFile(db, { path });
  await trashOrganizationFile(env, {
    organizationId: 1,
    fileId: 501,
    userId: 1,
    now: new Date("2026-09-24T12:00:00.000Z"),
  });

  const result = await purgeOrganizationFile(env, {
    organizationId: 1,
    fileId: 501,
    now: new Date("2026-09-25T12:00:00.000Z"),
  });

  assert.equal(sawPendingAtProvider, true);
  assert.equal(objects.has(path), false);
  assert.equal(result.file.status, "PURGED");
  assert.equal(result.file.active, 0);
  assert.equal(result.file.purged_at, "2026-09-25T12:00:00.000Z");
  assert.ok(result.file.deleted_at);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM organization_files WHERE id = 501").get().c,
    1,
  );
});

test("falha remota devolve item para TRASHED e mantém purge retryable", async (t) => {
  const { env, db } = persistenceFixture(t, {
    beforeProvider({ op }) {
      if (op === "delete_v2") {
        return new Response(
          JSON.stringify({ error_summary: "internal_error/" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
    },
  });

  insertFile(db);
  await trashOrganizationFile(env, {
    organizationId: 1,
    fileId: 501,
    userId: 1,
    now: new Date("2026-09-24T12:00:00.000Z"),
  });

  await assert.rejects(
    purgeOrganizationFile(env, {
      organizationId: 1,
      fileId: 501,
      now: new Date("2026-09-25T12:00:00.000Z"),
    }),
  );

  const row = db.prepare("SELECT * FROM organization_files WHERE id = 501").get();
  assert.equal(row.status, "TRASHED");
  assert.equal(row.purged_at, null);
  assert.ok(row.error_message);
});

test("crash após delete remoto mantém PURGE_PENDING e retry idempotente finaliza tombstone", async (t) => {
  let failFinalize = true;
  const path = "/offline/a/documents/purge.pdf";
  const { env, db, store, objects } = persistenceFixture(t, {
    beforeSql({ sql }) {
      if (
        failFinalize &&
        /SET status = 'PURGED'/i.test(sql)
      ) {
        failFinalize = false;
        throw interruption("FINALIZE_INTERRUPTED");
      }
    },
  });

  await store(path, new TextEncoder().encode("conteudo"));
  insertFile(db, { path });
  await trashOrganizationFile(env, {
    organizationId: 1,
    fileId: 501,
    userId: 1,
    now: new Date("2026-09-24T12:00:00.000Z"),
  });

  await assert.rejects(
    purgeOrganizationFile(env, {
      organizationId: 1,
      fileId: 501,
      now: new Date("2026-10-05T12:00:00.000Z"),
      requireExpired: true,
    }),
  );

  assert.equal(objects.has(path), false);
  assert.equal(
    db.prepare("SELECT status FROM organization_files WHERE id = 501").get().status,
    "PURGE_PENDING",
  );

  const retried = await purgeOrganizationFile(env, {
    organizationId: 1,
    fileId: 501,
    now: new Date("2026-10-05T12:20:00.000Z"),
    requireExpired: true,
  });

  assert.equal(retried.file.status, "PURGED");
  assert.ok(retried.file.purged_at);
});

test("fila automática seleciona vencidos e claims pendentes apenas após TTL", async (t) => {
  const { env, db } = persistenceFixture(t);
  insertFile(db, {
    id: 501,
    status: "TRASHED",
    active: 0,
    deletedAt: "2026-09-20T00:00:00.000Z",
    purgeAfter: "2026-09-24T00:00:00.000Z",
  });
  insertFile(db, {
    id: 502,
    path: "/offline/a/documents/future.pdf",
    status: "TRASHED",
    active: 0,
    deletedAt: "2026-09-24T00:00:00.000Z",
    purgeAfter: "2026-10-04T00:00:00.000Z",
  });
  insertFile(db, {
    id: 503,
    path: "/offline/a/documents/stale.pdf",
    status: "PURGE_PENDING",
    active: 0,
    deletedAt: "2026-09-20T00:00:00.000Z",
    purgeAfter: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  });

  const queue = await listExpiredOrganizationFilesForPurge(env, {
    now: new Date("2026-09-25T00:00:00.000Z"),
    claimTtlMs: 15 * 60 * 1000,
  });

  assert.deepEqual(queue.rows.map((row) => row.id), [501, 503]);
});

test("Worker nasce disabled + kill switch + dry-run e dry-run não toca provider nem documentos", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  const config = organizationFilePurgeConfig(env);
  assert.equal(config.enabled, false);
  assert.equal(config.killSwitch, true);
  assert.equal(config.dryRun, true);
  assert.equal(config.batchSize, 25);

  insertFile(db, {
    status: "TRASHED",
    active: 0,
    deletedAt: "2026-09-10T00:00:00.000Z",
    purgeAfter: "2026-09-20T00:00:00.000Z",
  });

  const audits = [];
  Object.assign(env, {
    MAONO_DOCUMENT_PURGE_ENABLED: "true",
    MAONO_DOCUMENT_PURGE_KILL_SWITCH: "false",
    MAONO_DOCUMENT_PURGE_DRY_RUN: "true",
  });

  const result = await runScheduledDocumentPurge(
    env,
    {
      nowFn: () => new Date("2026-09-25T00:00:00.000Z").getTime(),
      audit: async (_env, event) => audits.push(event),
      correlationId: "purge-dry-run-test",
    },
  );

  assert.equal(result.executed, true);
  assert.equal(result.result.checked, 1);
  assert.equal(result.result.skipped, 1);
  assert.equal(calls.filter((call) => call.op === "delete_v2").length, 0);
  assert.equal(
    db.prepare("SELECT status FROM organization_files WHERE id = 501").get().status,
    "TRASHED",
  );
  assert.ok(audits.some((event) => event.result === "dry_run"));
});

test("Worker apply remove somente vencidos e finaliza tombstone", async (t) => {
  const expiredPath = "/offline/a/documents/expired.pdf";
  const futurePath = "/offline/a/documents/future.pdf";
  const { env, db, store, objects } = persistenceFixture(t);

  await store(expiredPath, new TextEncoder().encode("expired"));
  await store(futurePath, new TextEncoder().encode("future"));

  insertFile(db, {
    id: 501,
    path: expiredPath,
    status: "TRASHED",
    active: 0,
    deletedAt: "2026-09-10T00:00:00.000Z",
    purgeAfter: "2026-09-20T00:00:00.000Z",
  });
  insertFile(db, {
    id: 502,
    path: futurePath,
    status: "TRASHED",
    active: 0,
    deletedAt: "2026-09-24T00:00:00.000Z",
    purgeAfter: "2026-10-04T00:00:00.000Z",
  });

  const audits = [];
  Object.assign(env, {
    MAONO_DOCUMENT_PURGE_ENABLED: "true",
    MAONO_DOCUMENT_PURGE_KILL_SWITCH: "false",
    MAONO_DOCUMENT_PURGE_DRY_RUN: "false",
    MAONO_DOCUMENT_PURGE_BATCH_SIZE: "25",
  });

  const result = await runScheduledDocumentPurge(
    env,
    {
      nowFn: () => new Date("2026-09-25T00:00:00.000Z").getTime(),
      audit: async (_env, event) => audits.push(event),
      correlationId: "purge-apply-test",
    },
  );

  assert.equal(result.executed, true);
  assert.equal(result.result.checked, 1);
  assert.equal(result.result.purged, 1);
  assert.equal(result.result.failed, 0);
  assert.equal(objects.has(expiredPath), false);
  assert.equal(objects.has(futurePath), true);

  const expired = db.prepare("SELECT status, purged_at FROM organization_files WHERE id = 501").get();
  const future = db.prepare("SELECT status, purged_at FROM organization_files WHERE id = 502").get();
  assert.equal(expired.status, "PURGED");
  assert.ok(expired.purged_at);
  assert.equal(future.status, "TRASHED");
  assert.equal(future.purged_at, null);
  assert.ok(
    audits.some(
      (event) =>
        event.action === "document.purge.automatic" &&
        event.result === "success",
    ),
  );
});

test("contrato manual exige duas permissões, confirmação forte e GeoJSON; UI não antecipa purge fora da Lixeira", async () => {
  const route = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/purge.js", import.meta.url),
    "utf8",
  );
  const ui = await readFile(
    new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
    "utf8",
  );
  const worker = await readFile(
    new URL("../workers/organization-file-purge.js", import.meta.url),
    "utf8",
  );
  const config = await readFile(
    new URL("../wrangler.document-purge.toml.example", import.meta.url),
    "utf8",
  );

  assert.match(route, /"document\.manage"/);
  assert.match(route, /"document\.delete"/);
  assert.match(route, /EXCLUIR PERMANENTEMENTE/);
  assert.match(route, /requireProjectGeoJsonAccess/);
  assert.match(route, /document\.purge\.manual/);

  assert.match(ui, /Excluir permanentemente/);
  assert.match(ui, /handlePermanentPurge/);
  assert.match(ui, /canManage && canDelete/);
  assert.match(ui, /documentState === "trash"/);

  assert.match(worker, /document\.purge\.automatic/);
  assert.match(worker, /MAONO_DOCUMENT_PURGE_DRY_RUN/);
  assert.match(config, /MAONO_DOCUMENT_PURGE_ENABLED = "false"/);
  assert.match(config, /MAONO_DOCUMENT_PURGE_KILL_SWITCH = "true"/);
  assert.match(config, /MAONO_DOCUMENT_PURGE_DRY_RUN = "true"/);
  assert.match(config, /MAONO_DOCUMENT_PURGE_BATCH_SIZE = "25"/);
  assert.match(config, /crons = \["0 \* \* \* \*"\]/);
});
