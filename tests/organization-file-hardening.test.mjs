import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findOrganizationFileForPurge,
  purgeOrganizationFile,
} from "../functions/_lib/organization-file-purge.js";
import {
  restoreOrganizationFile,
  trashOrganizationFile,
} from "../functions/_lib/organization-file-trash.js";
import {
  organizationFileRolloutConfig,
  requirePermanentDocumentPurgeEnabled,
} from "../functions/_lib/organization-file-rollout.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

function insertFile(db, {
  id,
  organizationId,
  path,
  status = "ACTIVE",
  active = 1,
  deletedAt = null,
  purgeAfter = null,
} = {}) {
  db.prepare(`
    INSERT INTO organization_files (
      id, organization_id, name, original_name, file_name,
      dropbox_path, file_type, status, active, uploaded_by,
      created_at, updated_at, deleted_at, purge_after
    ) VALUES (?, ?, 'hardening.pdf', 'hardening.pdf', 'hardening.pdf',
              ?, 'pdf', ?, ?, 1,
              '2026-09-24T10:00:00.000Z', '2026-09-24T10:00:00.000Z', ?, ?)
  `).run(id, organizationId, path, status, active, deletedAt, purgeAfter);
}

test("cross-org não encontra arquivo em trash/restore/purge e não toca provider", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  insertFile(db, {
    id: 902,
    organizationId: 2,
    path: "/offline/b/documents/other.pdf",
  });

  await assert.rejects(
    trashOrganizationFile(env, {
      organizationId: 1,
      fileId: 902,
      userId: 1,
      now: new Date("2026-09-24T12:00:00.000Z"),
    }),
    { code: "ORGANIZATION_FILE_NOT_FOUND" },
  );
  assert.equal(await findOrganizationFileForPurge(env, 1, 902), null);
  await assert.rejects(
    restoreOrganizationFile(env, {
      organizationId: 1,
      fileId: 902,
      now: new Date("2026-09-25T12:00:00.000Z"),
    }),
    { code: "ORGANIZATION_FILE_TRASH_NOT_FOUND" },
  );
  await assert.rejects(
    purgeOrganizationFile(env, {
      organizationId: 1,
      fileId: 902,
      now: new Date("2026-09-25T12:00:00.000Z"),
    }),
    { code: "ORGANIZATION_FILE_TRASH_NOT_FOUND" },
  );
  assert.deepEqual(calls, []);
});

test("storage não READY bloqueia purge físico sem provider nem falso tombstone", async (t) => {
  const { env, db, store, objects, calls } = persistenceFixture(t);
  const path = "/offline/a/documents/not-ready.pdf";
  await store(path, new TextEncoder().encode("conteudo"));
  insertFile(db, {
    id: 903,
    organizationId: 1,
    path,
    status: "TRASHED",
    active: 0,
    deletedAt: "2026-09-10T00:00:00.000Z",
    purgeAfter: "2026-09-20T00:00:00.000Z",
  });
  db.prepare(
    "UPDATE organizations SET storage_status = 'ERROR', storage_error = 'TEST' WHERE id = 1",
  ).run();

  await assert.rejects(
    purgeOrganizationFile(env, {
      organizationId: 1,
      fileId: 903,
      now: new Date("2026-09-25T00:00:00.000Z"),
      requireExpired: true,
    }),
    { code: "ORGANIZATION_STORAGE_NOT_READY" },
  );

  assert.equal(objects.has(path), true);
  assert.equal(
    db.prepare("SELECT status FROM organization_files WHERE id = 903").get().status,
    "TRASHED",
  );
  assert.equal(calls.filter((call) => call.op === "delete_v2").length, 0);
});

test("feature flag de purge manual é fail-closed", () => {
  assert.equal(organizationFileRolloutConfig({}).permanentPurgeEnabled, false);
  assert.equal(
    organizationFileRolloutConfig({
      MAONO_DOCUMENT_PURGE_MANUAL_ENABLED: "true",
    }).permanentPurgeEnabled,
    true,
  );
  assert.throws(
    () => requirePermanentDocumentPurgeEnabled({}),
    { code: "DOCUMENT_PURGE_FEATURE_DISABLED" },
  );
});

test("GeoJSON é reaplicado em listagem, move, trash, restore e purge", async () => {
  const filesRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files.js", import.meta.url),
    "utf8",
  );
  const fileRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId].js", import.meta.url),
    "utf8",
  );
  const restoreRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/restore.js", import.meta.url),
    "utf8",
  );
  const purgeRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/purge.js", import.meta.url),
    "utf8",
  );
  const query = await readFile(
    new URL("../functions/_lib/organization-file-query.js", import.meta.url),
    "utf8",
  );

  assert.match(filesRoute, /decideProjectGeoJsonAccess/);
  assert.match(query, /canViewGeoJson/);
  assert.match(query, /geojson/);
  assert.match(fileRoute, /requireProjectGeoJsonAccess/);
  assert.match(fileRoute, /document\.folder\.move/);
  assert.match(fileRoute, /document\.trash/);
  assert.match(restoreRoute, /requireProjectGeoJsonAccess/);
  assert.match(purgeRoute, /requireProjectGeoJsonAccess/);
});

test("listagem é D1-only; upload, download e purge exigem storage READY", async () => {
  const listRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files.js", import.meta.url),
    "utf8",
  );
  const downloadRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/download.js", import.meta.url),
    "utf8",
  );
  const purgeService = await readFile(
    new URL("../functions/_lib/organization-file-purge.js", import.meta.url),
    "utf8",
  );

  const getBody = listRoute.slice(
    listRoute.indexOf("export async function onRequestGet"),
    listRoute.indexOf("export async function onRequestPost"),
  );
  const postBody = listRoute.slice(
    listRoute.indexOf("export async function onRequestPost"),
  );

  assert.doesNotMatch(getBody, /requireOrganizationStorageReady/);
  assert.match(getBody, /readOrganizationStorageReadiness/);
  assert.match(postBody, /requireOrganizationStorageReady/);
  assert.match(downloadRoute, /requireOrganizationStorageReady/);
  assert.match(purgeService, /requireOrganizationStorageReady/);
});

test("UI consome capability server-side e esconde purge permanente com flag off", async () => {
  const listRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files.js", import.meta.url),
    "utf8",
  );
  const purgeRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/purge.js", import.meta.url),
    "utf8",
  );
  const ui = await readFile(
    new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
    "utf8",
  );

  assert.match(listRoute, /publicOrganizationFileCapabilities/);
  assert.match(purgeRoute, /requirePermanentDocumentPurgeEnabled/);
  assert.match(ui, /response\.capabilities\?\.permanentPurgeEnabled/);
  assert.match(ui, /permanentPurgeEnabled && canManage && canDelete/);
});
