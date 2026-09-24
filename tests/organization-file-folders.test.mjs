import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { can } from "../functions/_lib/permissions.js";
import {
  DOCUMENT_FOLDER_MAX_DEPTH,
  createDocumentFolder,
  deleteDocumentFolder,
  moveOrganizationFileToFolder,
  updateDocumentFolder,
} from "../functions/_lib/organization-file-folders.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

const migrationUrl = new URL(
  "../migrations/0024_document_folders_trash.sql",
  import.meta.url,
);

test("migration 0024 aplica sobre o baseline documental e cria schema/guards", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE organization_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      dropbox_path TEXT NOT NULL UNIQUE,
      file_type TEXT NOT NULL DEFAULT 'other',
      size_bytes INTEGER,
      is_project INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      project_id INTEGER,
      original_name TEXT,
      mime_type TEXT,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      error_message TEXT,
      uploaded_by INTEGER,
      deleted_at TEXT,
      idempotency_key TEXT,
      dropbox_file_id TEXT,
      dropbox_rev TEXT
    );
    INSERT INTO users (id) VALUES (1), (2);
    INSERT INTO organizations (id) VALUES (1), (2);
  `);

  db.exec(readFileSync(migrationUrl, "utf8"));

  const columns = db
    .prepare("PRAGMA table_info(organization_files)")
    .all()
    .map((row) => row.name);

  for (const column of [
    "folder_id",
    "deleted_by",
    "purge_after",
    "trashed_from_folder_id",
    "purged_at",
  ]) {
    assert.ok(columns.includes(column), column);
  }

  const folderTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='organization_file_folders'",
    )
    .get();
  assert.equal(folderTable?.name, "organization_file_folders");

  const triggers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%folder%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  assert.ok(triggers.includes("trg_document_folder_delete_empty"));
  assert.ok(triggers.includes("trg_organization_file_folder_scope_update"));

  db.prepare(
    "INSERT INTO organization_file_folders (id, organization_id, name, created_by) VALUES (1, 1, 'Raiz A', 1)",
  ).run();

  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO organization_file_folders (organization_id, parent_id, name, created_by) VALUES (2, 1, 'Inválida', 2)",
        )
        .run(),
    /DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH|FOREIGN KEY/,
  );

  db.close();
});

test("pastas respeitam profundidade, conflito de nome e ciclos", async (t) => {
  const { env } = persistenceFixture(t);

  const root = await createDocumentFolder(env, {
    organizationId: 1,
    name: "Operação",
    userId: 1,
  });
  const sibling = await createDocumentFolder(env, {
    organizationId: 1,
    name: "Financeiro",
    userId: 1,
  });

  await assert.rejects(
    createDocumentFolder(env, {
      organizationId: 1,
      name: " financeiro ",
      userId: 1,
    }),
    { code: "DOCUMENT_FOLDER_NAME_CONFLICT" },
  );

  let parent = root;
  const chain = [root];
  for (let depth = 2; depth <= DOCUMENT_FOLDER_MAX_DEPTH; depth += 1) {
    parent = await createDocumentFolder(env, {
      organizationId: 1,
      parentId: parent.id,
      name: "Nível " + depth,
      userId: 1,
    });
    chain.push(parent);
  }

  await assert.rejects(
    createDocumentFolder(env, {
      organizationId: 1,
      parentId: parent.id,
      name: "Nível 6",
      userId: 1,
    }),
    { code: "DOCUMENT_FOLDER_DEPTH_EXCEEDED" },
  );

  await assert.rejects(
    updateDocumentFolder(env, 1, root.id, { parentId: chain[2].id }),
    { code: "DOCUMENT_FOLDER_CYCLE" },
  );

  await assert.rejects(
    updateDocumentFolder(env, 1, sibling.id, { parentId: sibling.id }),
    { code: "DOCUMENT_FOLDER_SELF_PARENT" },
  );
});

test("parent e arquivo não podem atravessar organizações", async (t) => {
  const { env, db } = persistenceFixture(t);

  const otherFolder = await createDocumentFolder(env, {
    organizationId: 2,
    name: "Outra organização",
    userId: 2,
  });

  await assert.rejects(
    createDocumentFolder(env, {
      organizationId: 1,
      parentId: otherFolder.id,
      name: "Não pode",
      userId: 1,
    }),
    { code: "DOCUMENT_FOLDER_PARENT_NOT_FOUND" },
  );

  db.exec(`
    INSERT INTO organization_files (
      id, organization_id, name, file_name, dropbox_path, file_type,
      status, active, dropbox_file_id, dropbox_rev
    )
    VALUES (
      10, 1, 'relatorio.pdf', 'stored.pdf', '/offline/a/documents/stored.pdf',
      'pdf', 'ACTIVE', 1, 'id:file-10', 'rev-10'
    );
  `);

  await assert.rejects(
    moveOrganizationFileToFolder(env, 1, 10, otherFolder.id),
    { code: "DOCUMENT_FOLDER_NOT_FOUND" },
  );
});

test("mover arquivo altera somente folder_id/updated_at e nunca chama Dropbox", async (t) => {
  const { env, db, calls } = persistenceFixture(t);

  const folder = await createDocumentFolder(env, {
    organizationId: 1,
    name: "Relatórios",
    userId: 1,
  });

  db.exec(`
    INSERT INTO organization_files (
      id, organization_id, name, file_name, dropbox_path, file_type,
      status, active, dropbox_file_id, dropbox_rev, sha256
    )
    VALUES (
      20, 1, 'relatorio.pdf', 'stored.pdf', '/offline/a/documents/stored.pdf',
      'pdf', 'ACTIVE', 1, 'id:file-20', 'rev-20', 'hash-20'
    );
  `);

  const before = db
    .prepare("SELECT * FROM organization_files WHERE id = 20")
    .get();

  const moved = await moveOrganizationFileToFolder(env, 1, 20, folder.id);

  assert.equal(moved.folder_id, folder.id);
  assert.equal(moved.dropbox_path, before.dropbox_path);
  assert.equal(moved.dropbox_file_id, before.dropbox_file_id);
  assert.equal(moved.dropbox_rev, before.dropbox_rev);
  assert.equal(moved.sha256, before.sha256);
  assert.deepEqual(calls, []);

  const root = await moveOrganizationFileToFolder(env, 1, 20, null);
  assert.equal(root.folder_id, null);
  assert.deepEqual(calls, []);
});

test("pasta só pode ser excluída quando vazia", async (t) => {
  const { env, db } = persistenceFixture(t);

  const parent = await createDocumentFolder(env, {
    organizationId: 1,
    name: "Pai",
    userId: 1,
  });
  const child = await createDocumentFolder(env, {
    organizationId: 1,
    parentId: parent.id,
    name: "Filha",
    userId: 1,
  });

  await assert.rejects(
    deleteDocumentFolder(env, 1, parent.id),
    { code: "DOCUMENT_FOLDER_NOT_EMPTY" },
  );

  await deleteDocumentFolder(env, 1, child.id);

  db.exec(`
    INSERT INTO organization_files (
      id, organization_id, folder_id, name, file_name, dropbox_path,
      file_type, status, active
    )
    VALUES (
      30, 1, ${parent.id}, 'arquivo.txt', 'arquivo.txt',
      '/offline/a/documents/arquivo.txt', 'txt', 'ACTIVE', 1
    );
  `);

  await assert.rejects(
    deleteDocumentFolder(env, 1, parent.id),
    { code: "DOCUMENT_FOLDER_NOT_EMPTY" },
  );

  await moveOrganizationFileToFolder(env, 1, 30, null);
  assert.deepEqual(await deleteDocumentFolder(env, 1, parent.id), {
    deleted: true,
  });
});

test("document.manage é nativo de owner/admin e explícito para editor", async (t) => {
  const { env, db } = persistenceFixture(t);
  const context = {
    organizationId: 1,
    scopeType: "organization",
  };

  db.prepare("UPDATE users SET role = 'owner' WHERE id = 1").run();
  assert.equal(
    (await can(env, { id: 1, role: "owner", activeOrganizationId: 1 }, "document.manage", context)).allowed,
    true,
  );

  db.prepare("UPDATE users SET role = 'admin' WHERE id = 1").run();
  assert.equal(
    (await can(env, { id: 1, role: "admin", activeOrganizationId: 1 }, "document.manage", context)).allowed,
    true,
  );

  db.prepare("UPDATE users SET role = 'editor' WHERE id = 1").run();
  const editor = { id: 1, role: "editor", activeOrganizationId: 1 };
  assert.equal((await can(env, editor, "document.manage", context)).allowed, false);

  db.exec(`
    CREATE TABLE user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      organization_id INTEGER,
      project_id INTEGER,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO user_permissions (
      user_id, permission, organization_id, active
    ) VALUES (1, 'document.manage', 1, 1);
  `);

  assert.equal((await can(env, editor, "document.manage", context)).allowed, true);

  db.prepare(`
    INSERT INTO user_permission_denials (
      user_id, organization_id, permission, denied_by
    ) VALUES (1, 1, 'document.manage', 2)
  `).run();

  assert.equal((await can(env, editor, "document.manage", context)).allowed, false);
});

test("rotas de pasta e move repetem autorização; move preserva GeoJSON e não toca Dropbox", async () => {
  const collection = await readFile(
    new URL("../functions/api/organizations/[id]/document-folders.js", import.meta.url),
    "utf8",
  );
  const item = await readFile(
    new URL("../functions/api/organizations/[id]/document-folders/[folderId].js", import.meta.url),
    "utf8",
  );
  const fileRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId].js", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../functions/_lib/organization-file-folders.js", import.meta.url),
    "utf8",
  );
  const commercial = await readFile(
    new URL("../src/pages/Projects/components/user-access-commercial.ts", import.meta.url),
    "utf8",
  );
  const governance = await readFile(
    new URL("../functions/_lib/access-governance.js", import.meta.url),
    "utf8",
  );
  const policy = await readFile(
    new URL("../src/access-control/policy.ts", import.meta.url),
    "utf8",
  );

  assert.match(collection, /"document\.view"/);
  assert.match(collection, /"document\.manage"/);
  assert.match(item, /"document\.manage"/);
  assert.match(fileRoute, /"document\.manage"/);
  assert.match(fileRoute, /requireProjectGeoJsonAccess/);
  assert.match(fileRoute, /document\.folder\.move/);
  assert.doesNotMatch(service, /Dropbox|dropbox_path|deleteOrganizationBinary|uploadOrganizationBinary/);
  assert.match(commercial, /Gerenciar organização de documentos/);
  assert.match(commercial, /code: "document\.manage"/);
  assert.match(commercial, /ownerGrantable: true/);
  assert.match(governance, /code: "document\.manage"/);
  assert.match(governance, /ownerDelegable: true/);
  assert.match(policy, /"document\.manage"/);
});

test("S2 reserva trash no schema sem alterar ainda o DELETE destrutivo", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const deleteRoute = await readFile(
    new URL("../functions/api/organizations/[id]/files/[fileId].js", import.meta.url),
    "utf8",
  );

  assert.match(migration, /deleted_by/);
  assert.match(migration, /purge_after/);
  assert.match(migration, /trashed_from_folder_id/);
  assert.match(migration, /purged_at/);
  assert.match(deleteRoute, /deleteOrganizationBinary\(env, dropboxPath\)/);
  assert.match(deleteRoute, /status: "DELETED"/);
});
