import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORGANIZATION_FILE_TRASH_RETENTION_DAYS,
  findTrashedOrganizationFile,
  purgeAfterFromDeletedAt,
  restoreOrganizationFile,
  trashOrganizationFile,
} from "../functions/_lib/organization-file-trash.js";
import {
  createDocumentFolder,
  deleteDocumentFolder,
} from "../functions/_lib/organization-file-folders.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

function insertFile(db, values = {}) {
  db.prepare(`
    INSERT INTO organization_files (
      id, organization_id, folder_id, name, original_name, file_name,
      dropbox_path, file_type, status, active, uploaded_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, 1, ?, ?)
  `).run(
    values.id ?? 101,
    values.organizationId ?? 1,
    values.folderId ?? null,
    values.name ?? "relatorio.pdf",
    values.name ?? "relatorio.pdf",
    values.fileName ?? "stored.pdf",
    values.dropboxPath ?? "/offline/a/documents/stored.pdf",
    values.fileType ?? "pdf",
    values.createdAt ?? "2026-09-24T10:00:00.000Z",
    values.updatedAt ?? "2026-09-24T10:00:00.000Z",
  );
}

test("soft-trash retém binário, grava 10 dias e preserva pasta anterior", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  const folder = await createDocumentFolder(env, { organizationId: 1, name: "Contratos", userId: 1 });
  insertFile(db, { folderId: folder.id });

  const deletedAt = new Date("2026-09-24T12:00:00.000Z");
  const trashed = await trashOrganizationFile(env, {
    organizationId: 1, fileId: 101, userId: 1, now: deletedAt,
  });

  assert.equal(trashed.status, "TRASHED");
  assert.equal(trashed.active, 0);
  assert.equal(trashed.folder_id, null);
  assert.equal(trashed.trashed_from_folder_id, folder.id);
  assert.equal(trashed.deleted_by, 1);
  assert.equal(trashed.deleted_at, deletedAt.toISOString());
  assert.equal(trashed.purge_after, "2026-10-04T12:00:00.000Z");
  assert.equal(ORGANIZATION_FILE_TRASH_RETENTION_DAYS, 10);
  assert.deepEqual(calls, []);
});

test("restore volta à pasta anterior válida e limpa metadados de lixeira", async (t) => {
  const { env, db } = persistenceFixture(t);
  const folder = await createDocumentFolder(env, { organizationId: 1, name: "Financeiro", userId: 1 });
  insertFile(db, { folderId: folder.id });
  await trashOrganizationFile(env, {
    organizationId: 1, fileId: 101, userId: 1, now: new Date("2026-09-24T12:00:00.000Z"),
  });

  const restored = await restoreOrganizationFile(env, {
    organizationId: 1, fileId: 101, now: new Date("2026-09-25T12:00:00.000Z"),
  });

  assert.equal(restored.file.status, "ACTIVE");
  assert.equal(restored.file.active, 1);
  assert.equal(restored.file.folder_id, folder.id);
  assert.equal(restored.file.deleted_at, null);
  assert.equal(restored.file.deleted_by, null);
  assert.equal(restored.file.purge_after, null);
  assert.equal(restored.file.trashed_from_folder_id, null);
  assert.equal(restored.restoredToRoot, false);
  assert.equal(restored.originalFolderMissing, false);
});

test("restore usa Raiz quando a pasta anterior não existe mais", async (t) => {
  const { env, db } = persistenceFixture(t);
  const folder = await createDocumentFolder(env, { organizationId: 1, name: "Temporária", userId: 1 });
  insertFile(db, { folderId: folder.id });
  await trashOrganizationFile(env, {
    organizationId: 1, fileId: 101, userId: 1, now: new Date("2026-09-24T12:00:00.000Z"),
  });
  await deleteDocumentFolder(env, 1, folder.id);

  const restored = await restoreOrganizationFile(env, {
    organizationId: 1, fileId: 101, now: new Date("2026-09-25T12:00:00.000Z"),
  });

  assert.equal(restored.file.folder_id, null);
  assert.equal(restored.restoredToRoot, true);
  assert.equal(restored.originalFolderMissing, true);
});

test("restore expirado é bloqueado e item permanece na Lixeira", async (t) => {
  const { env, db } = persistenceFixture(t);
  insertFile(db);
  await trashOrganizationFile(env, {
    organizationId: 1, fileId: 101, userId: 1, now: new Date("2026-09-24T12:00:00.000Z"),
  });

  await assert.rejects(
    restoreOrganizationFile(env, {
      organizationId: 1, fileId: 101, now: new Date("2026-10-04T12:00:00.000Z"),
    }),
    { code: "DOCUMENT_RESTORE_EXPIRED" },
  );
  assert.equal((await findTrashedOrganizationFile(env, 1, 101))?.status, "TRASHED");
});

test("purge_after é exatamente deleted_at + 10 dias", () => {
  assert.equal(
    purgeAfterFromDeletedAt("2026-09-24T00:00:00.000Z"),
    "2026-10-04T00:00:00.000Z",
  );
});

test("DELETE não chama Dropbox e restore repete autorização GeoJSON", async () => {
  const deleteRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId].js", import.meta.url), "utf8",
  );
  const restoreRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/restore.js", import.meta.url), "utf8",
  );
  const listRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files.js", import.meta.url), "utf8",
  );
  const downloadRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId]/download.js", import.meta.url), "utf8",
  );

  assert.match(deleteRoute, /trashOrganizationFile/);
  assert.match(deleteRoute, /document\.trash/);
  assert.doesNotMatch(deleteRoute, /deleteOrganizationBinary/);
  assert.doesNotMatch(deleteRoute, /requireOrganizationStorageReady/);
  assert.match(restoreRoute, /"document\.delete"/);
  assert.match(restoreRoute, /requireProjectGeoJsonAccess/);
  assert.match(restoreRoute, /restoreOrganizationFile/);
  assert.match(listRoute, /listQuery\.state === "trash"/);
  assert.match(listRoute, /"document\.delete"/);
  assert.match(downloadRoute, /file\.deleted_at/);
  assert.match(downloadRoute, /file\.active === 0/);
  assert.match(downloadRoute, /TRASHED/);
});

test("UI da Lixeira preserva restore e permite que a S5 acrescente purge permanente", async () => {
  const source = await readFile(
    new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url), "utf8",
  );
  assert.match(source, /Lixeira/);
  assert.match(source, /Restaurar/);
  assert.match(source, /restoreOrganizationFile/);
  assert.match(source, /10 dias/);
  assert.match(source, /Excluir permanentemente/);
  assert.match(source, /purgeOrganizationFilePermanently/);
});
