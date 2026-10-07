import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { onRequest as foldersRoute } from "../functions/api/organizations/[id]/document-folders.js";
import { onRequest as folderRoute } from "../functions/api/organizations/[id]/document-folders/[folderId].js";
import { onRequest as fileRoute } from "../functions/api/organizations/[id]/files/[fileId].js";
import { onRequestGet as downloadRoute } from "../functions/api/organizations/[id]/files/[fileId]/download.js";
import { createDocumentFolder, moveOrganizationFileToFolder } from "../functions/_lib/organization-file-folders.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

// Every API handler, permission query, hierarchy check, trigger and mutation runs
// unchanged against the real schema in local SQLite. Only external storage HTTP
// is simulated by the existing offline fixture; no production service is used.
function fixture(t, hooks) {
  const value = persistenceFixture(t, hooks);
  const { db, env } = value;
  const token = "document-action-local-owner";
  db.prepare(`INSERT INTO sessions (token_hash, user_id, active_organization_id, expires_at)
    VALUES (?, 1, 1, '2099-01-01T00:00:00.000Z')`)
    .run(createHash("sha256").update(token).digest("hex"));
  const cookie = `maono_session=${token}`;
  const invoke = async (route, method, payload, ids = {}, auth = cookie) => {
    const params = { id: "1", ...ids };
    const response = await route({ env, params, request: new Request("https://local.test/api/documents", {
      method, headers: { Cookie: auth, "Content-Type": "application/json", "X-Request-Id": "document-action-local" },
      ...(method === "GET" ? {} : { body: JSON.stringify(payload) }),
    }) });
    return { status: response.status, body: await response.json() };
  };
  const create = (name, parentId = null, ids) => invoke(foldersRoute, "POST", { name, parentId }, ids);
  const moveFolder = (id, parentId) => invoke(folderRoute, "PATCH", { parentId }, { folderId: String(id) });
  const patchFile = (payload, ids = {}) => invoke(fileRoute, "PATCH", payload, { fileId: "10", ...ids });
  const insertFile = (name = "original.v1.PDF") => {
    db.prepare(`INSERT INTO organization_files (id, organization_id, name, original_name,
      file_name, dropbox_path, file_type, mime_type, status, active, size_bytes,
      sha256, dropbox_file_id, dropbox_rev, updated_at)
      VALUES (10, 1, ?, ?, 'stored-10.pdf', '/projects/offline-a/documents/stored-10.pdf',
      'pdf', 'application/pdf', 'ACTIVE', 1, 17, 'binary-hash', 'id:binary', 'rev:binary', '2026-01-01')`)
      .run(name, name);
  };
  const folderRows = () => db.prepare("SELECT * FROM organization_file_folders ORDER BY id").all();
  const fileRow = () => db.prepare("SELECT * FROM organization_files WHERE id = 10").get();
  return { ...value, cookie, invoke, create, moveFolder, patchFile, insertFile, folderRows, fileRow };
}

async function expectError(promise, status, code) {
  const result = await promise;
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.code, code);
}

function assertUnchangedExcept(actual, before, fields) {
  for (const key of Object.keys(before).filter(key => !fields.includes(key))) {
    assert.deepEqual(actual[key], before[key], key);
  }
}

test("rotas reais integram criação, rename, move multinível/raiz e download com os mesmos bytes", async t => {
  const f = fixture(t);
  f.insertFile();
  f.db.exec("UPDATE organizations SET dropbox_root_path = '/projects/offline-a' WHERE id = 1");
  const bytes = new Uint8Array([0, 255, 1, 2, 3, 128, 65, 66, 10, 0, 17, 32, 90, 99, 127, 4, 5]);
  const path = f.fileRow().dropbox_path;
  await f.store(path, bytes);
  const beforeFile = f.fileRow();
  const source = await f.create(" Origem   organizada ");
  const target = await f.create("Destino");
  assert.equal(source.status, 201);
  assert.equal(source.body.folder.name, "Origem organizada");
  const child = await f.create("Filha", source.body.folder.id);
  const grandchild = await f.create("Neta", child.body.folder.id);
  assert.equal((await f.patchFile({ folderId: grandchild.body.folder.id })).status, 200);
  assert.equal((await f.patchFile({ name: "renomeado.v2.PDF" })).status, 200);
  const beforeTree = f.folderRows();
  assert.equal((await f.moveFolder(source.body.folder.id, target.body.folder.id)).status, 200);
  const afterTree = f.folderRows();
  for (const row of beforeTree) {
    assertUnchangedExcept(afterTree.find(item => item.id === row.id), row,
      row.id === source.body.folder.id ? ["parent_id", "updated_at"] : []);
  }
  assert.equal(f.fileRow().folder_id, grandchild.body.folder.id);
  assert.equal((await f.patchFile({ folderId: target.body.folder.id })).status, 200);
  assert.equal((await f.patchFile({ folderId: null })).status, 200);
  assert.equal((await f.moveFolder(source.body.folder.id, null)).status, 200);
  assertUnchangedExcept(f.fileRow(), beforeFile, ["name", "original_name", "updated_at"]);
  assert.deepEqual(f.calls, []);
  const listed = await f.invoke(foldersRoute, "GET");
  assert.equal(listed.body.folders.find(item => item.id === source.body.folder.id).parentId, null);
  const downloaded = await downloadRoute({ env: f.env, params: { id: "1", fileId: "10" },
    request: new Request("https://local.test/api/documents/download", { headers: { Cookie: f.cookie } }) });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  assert.match(downloaded.headers.get("Content-Disposition"), /renomeado\.v2\.PDF/);
  assert.deepEqual(f.calls.map(call => call.op), ["download"]);
  assert.deepEqual(f.objects.get(path).bytes, bytes);
  assert.equal(f.db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("POST pasta valida formato, nome, duplicidade normalizada e parentId contra SQLite", async t => {
  const f = fixture(t);
  const root = await f.create("Pasta    nova");
  assert.equal(root.status, 201);
  const before = f.folderRows();
  for (const payload of [null, [], true, "Pasta"]) {
    await expectError(f.invoke(foldersRoute, "POST", payload), 400, "DOCUMENT_FOLDER_PATCH_INVALID");
  }
  for (const [name, code] of [
    ["", "DOCUMENT_FOLDER_NAME_REQUIRED"], ["  ", "DOCUMENT_FOLDER_NAME_REQUIRED"],
    ["x".repeat(121), "DOCUMENT_FOLDER_NAME_TOO_LONG"], ["../pasta", "DOCUMENT_FOLDER_NAME_INVALID"],
    ["a\\b", "DOCUMENT_FOLDER_NAME_INVALID"], ["a\nb", "DOCUMENT_FOLDER_NAME_INVALID"],
    ["a\u007fb", "DOCUMENT_FOLDER_NAME_INVALID"], [7, "DOCUMENT_FOLDER_NAME_INVALID"],
    [{ name: "pasta" }, "DOCUMENT_FOLDER_NAME_INVALID"], [[], "DOCUMENT_FOLDER_NAME_INVALID"],
  ]) await expectError(f.create(name), 400, code);
  await expectError(f.create("  PASTA   NOVA "), 409, "DOCUMENT_FOLDER_NAME_CONFLICT");
  for (const parentId of [true, false, [], [root.body.folder.id], {}, "", "1e0", "0x1", 0, -1, 1.5, 9007199254740992]) {
    await expectError(f.create("Inválida", parentId), 400, "DOCUMENT_FOLDER_PARENT_INVALID");
  }
  await expectError(f.create("Inválida", 9999), 404, "DOCUMENT_FOLDER_PARENT_NOT_FOUND");
  assert.deepEqual(f.folderRows(), before);
  assert.equal((await f.create("Pasta nova", String(root.body.folder.id))).status, 201);
  assert.deepEqual(f.calls, []);
});

test("PATCH pasta rejeita mesmo pai, ciclo, descendente, destino inexistente/excluído e outra organização", async t => {
  const f = fixture(t);
  const source = (await f.create("Origem")).body.folder;
  const child = (await f.create("Filha", source.id)).body.folder;
  const grandchild = (await f.create("Neta", child.id)).body.folder;
  const deleted = (await f.create("Excluída")).body.folder;
  f.db.prepare("UPDATE organization_file_folders SET deleted_at = '2026-01-01' WHERE id = ?").run(deleted.id);
  const foreign = await createDocumentFolder(f.env, { organizationId: 2, name: "Outra organização", userId: 2 });
  const before = f.folderRows();
  for (const [parent, status, code] of [
    [null, 409, "DOCUMENT_FOLDER_SAME_PARENT"], [source.id, 400, "DOCUMENT_FOLDER_SELF_PARENT"],
    [child.id, 400, "DOCUMENT_FOLDER_CYCLE"], [grandchild.id, 400, "DOCUMENT_FOLDER_CYCLE"],
    [9999, 404, "DOCUMENT_FOLDER_PARENT_NOT_FOUND"], [deleted.id, 404, "DOCUMENT_FOLDER_PARENT_NOT_FOUND"],
    [foreign.id, 404, "DOCUMENT_FOLDER_PARENT_NOT_FOUND"],
  ]) await expectError(f.moveFolder(source.id, parent), status, code);
  await expectError(f.moveFolder(child.id, source.id), 409, "DOCUMENT_FOLDER_SAME_PARENT");
  for (const payload of [null, [], "pasta"]) {
    await expectError(f.invoke(folderRoute, "PATCH", payload, { folderId: String(source.id) }), 400, "DOCUMENT_FOLDER_PATCH_INVALID");
  }
  for (const parent of [true, false, [], [child.id], {}, "", 0, -1, 1.1]) {
    await expectError(f.moveFolder(source.id, parent), 400, "DOCUMENT_FOLDER_PARENT_INVALID");
  }
  await expectError(f.invoke(folderRoute, "PATCH", { parentId: null }, { folderId: String(foreign.id) }), 404, "DOCUMENT_FOLDER_NOT_FOUND");
  assert.deepEqual(f.folderRows(), before);
  assert.deepEqual(f.calls, []);
});

test("PATCH pasta respeita profundidade total da subárvore e conflitos no novo destino", async t => {
  const f = fixture(t);
  const source = (await f.create("Origem")).body.folder;
  await f.create("Filha", source.id);
  let target = (await f.create("Destino")).body.folder;
  const destinationRoot = target;
  for (let depth = 2; depth <= 4; depth++) target = (await f.create(`Destino ${depth}`, target.id)).body.folder;
  const before = f.folderRows();
  await expectError(f.moveFolder(source.id, target.id), 400, "DOCUMENT_FOLDER_DEPTH_EXCEEDED");
  assert.deepEqual(f.folderRows(), before);
  await f.create("Origem", destinationRoot.id);
  await expectError(f.moveFolder(source.id, destinationRoot.id), 409, "DOCUMENT_FOLDER_NAME_CONFLICT");
  assert.equal(f.folderRows().find(row => row.id === source.id).parent_id, null);
});

test("PATCH arquivo rejeita IDs coercíveis, noops, destino inválido e mistura entre organizações", async t => {
  const f = fixture(t);
  f.insertFile();
  const folder = (await f.create("Destino")).body.folder;
  const foreign = await createDocumentFolder(f.env, { organizationId: 2, name: "Outra organização", userId: 2 });
  const before = f.fileRow();
  for (const folderId of [true, false, [], [folder.id], {}, "", "1e0", "0x1", 0, -1, 1.5, 9007199254740992]) {
    await expectError(f.patchFile({ folderId }), 400, "DOCUMENT_FOLDER_INVALID");
  }
  await expectError(f.patchFile({ folderId: null }), 409, "DOCUMENT_FOLDER_SAME_PARENT");
  for (const folderId of [9999, foreign.id]) {
    await expectError(f.patchFile({ folderId }), 404, "DOCUMENT_FOLDER_NOT_FOUND");
  }
  assert.deepEqual(f.fileRow(), before);
  assert.equal((await f.patchFile({ folderId: String(folder.id) })).status, 200);
  const inFolder = f.fileRow();
  await expectError(f.patchFile({ folderId: folder.id }), 409, "DOCUMENT_FOLDER_SAME_PARENT");
  assert.deepEqual(f.fileRow(), inFolder);
  await assert.rejects(moveOrganizationFileToFolder(f.env, 2, 10, foreign.id), { code: "ORGANIZATION_FILE_NOT_FOUND" });
  assert.deepEqual(f.calls, []);
});

test("rename real conserva extensão exata e nenhum tipo de extensão para arquivos sem extensão", async t => {
  const f = fixture(t);
  f.insertFile();
  const before = f.fileRow();
  for (const name of ["novo.pdf", "novo.pDf", "novo.txt", "novo.PDF.exe", "sem extensão"]) {
    await expectError(f.patchFile({ name }), 400, "DOCUMENT_FILE_EXTENSION_IMMUTABLE");
    assert.deepEqual(f.fileRow(), before);
  }
  assert.equal((await f.patchFile({ name: "novo.multiplos.pontos.PDF" })).status, 200);
  assertUnchangedExcept(f.fileRow(), before, ["name", "original_name", "updated_at"]);
  f.db.exec("UPDATE organization_files SET name = 'README', original_name = 'README' WHERE id = 10");
  assert.equal((await f.patchFile({ name: "LEIAME" })).status, 200);
  const noExtension = f.fileRow();
  assert.equal(noExtension.original_name, "LEIAME");
  assert.equal(noExtension.file_name, "stored-10.pdf");
  await expectError(f.patchFile({ name: "LEIAME.pdf" }), 400, "DOCUMENT_FILE_EXTENSION_IMMUTABLE");
  assert.deepEqual(f.fileRow(), noExtension);
  assert.deepEqual(f.calls, []);
});

test("POST/PATCH reais exigem sessão e document.manage, inclusive negação explícita", async t => {
  const f = fixture(t);
  f.insertFile();
  const source = (await f.create("Origem")).body.folder;
  const target = (await f.create("Destino")).body.folder;
  const requests = [
    [foldersRoute, "POST", { name: "Não criar" }, {}],
    [folderRoute, "PATCH", { parentId: target.id }, { folderId: String(source.id) }],
    [fileRoute, "PATCH", { folderId: target.id }, { fileId: "10" }],
  ];
  const beforeFile = f.fileRow();
  const beforeTree = f.folderRows();
  for (const args of requests) {
    await expectError(f.invoke(...args, ""), 401, "UNAUTHORIZED");
    await expectError(f.invoke(args[0], args[1], args[2], { ...args[3], id: "2" }), 403, "FORBIDDEN");
  }
  for (const role of ["viewer", "editor"]) {
    f.db.prepare("UPDATE users SET role = ? WHERE id = 1").run(role);
    for (const args of requests) await expectError(f.invoke(...args), 403, "FORBIDDEN");
  }
  f.db.exec("UPDATE users SET role = 'owner' WHERE id = 1");
  f.db.exec("INSERT INTO user_permission_denials (user_id, organization_id, permission, denied_by) VALUES (1, 1, 'document.manage', 2)");
  for (const args of requests) await expectError(f.invoke(...args), 403, "FORBIDDEN");
  assert.deepEqual(f.fileRow(), beforeFile);
  assert.deepEqual(f.folderRows(), beforeTree);
  assert.deepEqual(f.calls, []);
});

test("POST/PATCH reais aceitam editor somente com concessão explícita", async t => {
  const f = fixture(t);
  f.insertFile();
  f.db.exec(`UPDATE users SET role = 'editor' WHERE id = 1;
    CREATE TABLE IF NOT EXISTS user_permissions (id INTEGER PRIMARY KEY, user_id INTEGER, permission TEXT,
      organization_id INTEGER, project_id INTEGER, expires_at TEXT, active INTEGER);
    INSERT INTO user_permissions VALUES (1, 1, 'document.manage', 1, NULL, NULL, 1);`);
  const source = await f.create("Origem");
  const target = await f.create("Destino");
  assert.equal(source.status, 201);
  assert.equal(target.status, 201);
  assert.equal((await f.moveFolder(source.body.folder.id, target.body.folder.id)).status, 200);
  assert.equal((await f.patchFile({ folderId: source.body.folder.id })).status, 200);
  assert.equal((await f.patchFile({ name: "Editor.PDF" })).status, 200);
});

test("move real bloqueia documentos não ativos e o guard GeoJSON continua aplicado", async t => {
  const f = fixture(t);
  f.insertFile();
  const target = (await f.create("Destino")).body.folder;
  for (const state of ["status = 'PENDING'", "status = 'FAILED'", "status = 'TRASHED'", "active = 0", "purged_at = '2026-01-02'", "deleted_at = '2026-01-02'"]) {
    f.db.exec("UPDATE organization_files SET status = 'ACTIVE', active = 1, purged_at = NULL, deleted_at = NULL WHERE id = 10");
    f.db.exec(`UPDATE organization_files SET ${state} WHERE id = 10`);
    const before = f.fileRow();
    await expectError(f.patchFile({ folderId: target.id }), 404, "ORGANIZATION_FILE_NOT_FOUND");
    assert.deepEqual(f.fileRow(), before);
  }
  f.db.exec("UPDATE organization_files SET status = 'ACTIVE', active = 1, purged_at = NULL, deleted_at = NULL, original_name = 'mapa.geojson', name = 'mapa.geojson', file_type = 'other' WHERE id = 10");
  const before = f.fileRow();
  await expectError(f.patchFile({ folderId: target.id }), 404, "ORGANIZATION_FILE_NOT_FOUND");
  assert.deepEqual(f.fileRow(), before);
  assert.deepEqual(f.calls, []);
});

for (const race of ["trash", "move"]) test(`move de arquivo não sobrescreve ${race} concorrente entre lookup e escrita`, async t => {
  let enabled = false;
  let concurrentFolder;
  const f = fixture(t, { beforeSql({ sql, db }) {
    if (enabled && /UPDATE organization_files\s+SET folder_id/.test(sql)) {
      enabled = false;
      if (race === "trash") db.exec("UPDATE organization_files SET active = 0, status = 'TRASHED', deleted_at = '2026-01-02', folder_id = NULL WHERE id = 10");
      else db.prepare("UPDATE organization_files SET folder_id = ? WHERE id = 10").run(concurrentFolder);
    }
  } });
  f.insertFile();
  const target = (await f.create("Destino")).body.folder;
  concurrentFolder = (await f.create("Concorrente")).body.folder.id;
  enabled = true;
  await expectError(f.patchFile({ folderId: target.id }), 409, "DOCUMENT_FILE_MOVE_CONFLICT");
  assert.equal(f.fileRow().folder_id, race === "trash" ? null : concurrentFolder);
  assert.equal(f.fileRow().updated_at, "2026-01-01");
  assert.deepEqual(f.calls, []);
});

test("escrita de pasta revalida profundidade atomicamente se destino mudar durante move/create", async t => {
  let enabled = false;
  let destinationId;
  let deepId;
  const f = fixture(t, { beforeSql({ sql, db }) {
    if (enabled && /(?:UPDATE|INSERT INTO) organization_file_folders/.test(sql)) {
      enabled = false;
      db.prepare("UPDATE organization_file_folders SET parent_id = ? WHERE id = ?").run(deepId, destinationId);
    }
  } });
  const source = (await f.create("Origem")).body.folder;
  destinationId = (await f.create("Destino")).body.folder.id;
  let deep = (await f.create("Profunda 1")).body.folder;
  for (let depth = 2; depth <= 4; depth++) deep = (await f.create(`Profunda ${depth}`, deep.id)).body.folder;
  deepId = deep.id;
  enabled = true;
  await expectError(f.moveFolder(source.id, destinationId), 409, "DOCUMENT_FOLDER_MOVE_CONFLICT");
  assert.equal(f.folderRows().find(row => row.id === source.id).parent_id, null);
  f.db.prepare("UPDATE organization_file_folders SET parent_id = NULL WHERE id = ?").run(destinationId);
  enabled = true;
  await expectError(f.create("Não criar nível 6", destinationId), 400, "DOCUMENT_FOLDER_DEPTH_EXCEEDED");
  assert.equal(f.folderRows().some(row => row.name === "Não criar nível 6"), false);
});

test("move de pasta não perde rename concorrente e trigger bloqueia ciclo criado após validação", async t => {
  let enabled = false;
  let race = "rename";
  let sourceId;
  let targetId;
  const f = fixture(t, { beforeSql({ sql, db }) {
    if (enabled && /UPDATE organization_file_folders\s+SET name/.test(sql)) {
      enabled = false;
      if (race === "rename") db.prepare("UPDATE organization_file_folders SET name = 'Nome concorrente' WHERE id = ?").run(sourceId);
      else db.prepare("UPDATE organization_file_folders SET parent_id = ? WHERE id = ?").run(sourceId, targetId);
    }
  } });
  sourceId = (await f.create("Origem")).body.folder.id;
  targetId = (await f.create("Destino")).body.folder.id;
  enabled = true;
  await expectError(f.moveFolder(sourceId, targetId), 409, "DOCUMENT_FOLDER_MOVE_CONFLICT");
  assert.equal(f.folderRows().find(row => row.id === sourceId).name, "Nome concorrente");
  assert.equal(f.folderRows().find(row => row.id === sourceId).parent_id, null);
  race = "cycle";
  enabled = true;
  await expectError(f.moveFolder(sourceId, targetId), 400, "DOCUMENT_FOLDER_CYCLE");
  assert.equal(f.folderRows().find(row => row.id === sourceId).parent_id, null);
  assert.equal(f.folderRows().find(row => row.id === targetId).parent_id, sourceId);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("move de pasta revalida também crescimento concorrente da subárvore", async t => {
  let enabled = false;
  let childId;
  const f = fixture(t, { beforeSql({ sql, db }) {
    if (enabled && /UPDATE organization_file_folders\s+SET name/.test(sql)) {
      enabled = false;
      db.prepare("INSERT INTO organization_file_folders (organization_id, parent_id, name) VALUES (1, ?, 'Neta concorrente')").run(childId);
    }
  } });
  const source = (await f.create("Origem")).body.folder;
  childId = (await f.create("Filha", source.id)).body.folder.id;
  let target = (await f.create("Destino 1")).body.folder;
  for (let depth = 2; depth <= 3; depth++) target = (await f.create(`Destino ${depth}`, target.id)).body.folder;
  enabled = true;
  await expectError(f.moveFolder(source.id, target.id), 409, "DOCUMENT_FOLDER_MOVE_CONFLICT");
  assert.equal(f.folderRows().find(row => row.id === source.id).parent_id, null);
  assert.equal(f.folderRows().find(row => row.name === "Neta concorrente").parent_id, childId);
});

test("trigger rejeita destino excluído entre validação e move de arquivo", async t => {
  let enabled = false;
  let targetId;
  const f = fixture(t, { beforeSql({ sql, db }) {
    if (enabled && /UPDATE organization_files\s+SET folder_id/.test(sql)) {
      enabled = false;
      db.prepare("UPDATE organization_file_folders SET deleted_at = '2026-01-02' WHERE id = ?").run(targetId);
    }
  } });
  f.insertFile();
  targetId = (await f.create("Destino")).body.folder.id;
  const before = f.fileRow();
  enabled = true;
  await expectError(f.patchFile({ folderId: targetId }), 404, "DOCUMENT_FOLDER_NOT_FOUND");
  assert.deepEqual(f.fileRow(), before);
  assert.deepEqual(f.calls, []);
});

test("índice único rejeita criação duplicada concorrente após consulta de disponibilidade", async t => {
  let enabled = false;
  const f = fixture(t, { beforeSql({ sql, db }) {
    if (enabled && /INSERT INTO organization_file_folders/.test(sql)) {
      enabled = false;
      db.exec("INSERT INTO organization_file_folders (organization_id, name) VALUES (1, 'Duplicada')");
    }
  } });
  enabled = true;
  await expectError(f.create("Duplicada"), 409, "DOCUMENT_FOLDER_NAME_CONFLICT");
  assert.equal(f.folderRows().length, 1);
});

for (const concurrentName of ["Renomeado por outro.PDF", "extensão corrigida.txt"])
  test(`rename não sobrescreve alteração concorrente: ${concurrentName}`, async t => {
    let enabled = false;
    const f = fixture(t, { beforeSql({ sql, db }) {
      if (enabled && /UPDATE organization_files\s+SET name/.test(sql)) {
        enabled = false;
        db.prepare("UPDATE organization_files SET name = ?, original_name = ? WHERE id = 10").run(concurrentName, concurrentName);
      }
    } });
    f.insertFile();
    const before = f.fileRow();
    enabled = true;
    await expectError(f.patchFile({ name: "Não sobrescrever.PDF" }), 409, "DOCUMENT_FILE_RENAME_CONFLICT");
    const actual = f.fileRow();
    assert.equal(actual.original_name, concurrentName);
    assert.equal(actual.name, concurrentName);
    assertUnchangedExcept(actual, before, ["name", "original_name"]);
    assert.deepEqual(f.calls, []);
  });
