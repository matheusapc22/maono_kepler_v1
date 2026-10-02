import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";

import {
  normalizeOrganizationFileName,
  renameOrganizationFile,
  splitOrganizationFileName,
} from "../functions/_lib/organization-file-rename.js";
import { createDocumentFolder } from "../functions/_lib/organization-file-folders.js";
import {
  buildOrganizationFileListSql,
  parseOrganizationFileListQuery,
} from "../functions/_lib/organization-file-query.js";
import { onRequest as fileRoute } from "../functions/api/organizations/[id]/files/[fileId].js";
import { onRequestGet as downloadRoute } from "../functions/api/organizations/[id]/files/[fileId]/download.js";
import { onRequestPost as restoreRoute } from "../functions/api/organizations/[id]/files/[fileId]/restore.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

function insertFile(db, { id = 10, organizationId = 1, name = "relatorio.pdf", type = "pdf" } = {}) {
  db.prepare(`
    INSERT INTO organization_files (
      id, organization_id, name, original_name, file_name, dropbox_path,
      file_type, mime_type, size_bytes, status, active, dropbox_file_id,
      dropbox_rev, sha256, uploaded_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', 123, 'ACTIVE', 1,
              'id:original', 'rev:original', 'hash:original', 1, '2026-01-01T00:00:00.000Z')
  `).run(id, organizationId, name, name, `stored-${id}.${name.split(".").at(-1)}`,
    `/projects/offline-a/documents/stored-${id}.${name.split(".").at(-1)}`, type);
}

function sessionCookie(db, userId = 1, organizationId = 1) {
  const token = `document-rename-test-${userId}-${organizationId}`;
  db.prepare(`
    INSERT OR IGNORE INTO sessions (token_hash, user_id, active_organization_id, expires_at)
    VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')
  `).run(createHash("sha256").update(token).digest("hex"), userId, organizationId);
  return `maono_session=${token}`;
}

function patch(env, cookie, payload, { organizationId = 1, fileId = 10 } = {}) {
  return fileRoute({
    env,
    params: { id: String(organizationId), fileId: String(fileId) },
    request: new Request(`https://local.test/api/organizations/${organizationId}/files/${fileId}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "rename-test" },
      body: JSON.stringify(payload),
    }),
  });
}

test("rename normaliza nome, conserva extensão e rejeita nomes inseguros/incompatíveis", () => {
  const file = { original_name: "relatorio.pdf", file_name: "stored.pdf" };
  assert.equal(normalizeOrganizationFileName("  Relatório   final.pdf  ", file), "Relatório final.pdf");
  assert.equal(normalizeOrganizationFileName("Relatório.PDF", { original_name: "original.PDF" }), "Relatório.PDF");
  assert.equal(normalizeOrganizationFileName("x".repeat(156) + ".pdf", file).length, 160);
  for (const [name, code] of [
    ["", "DOCUMENT_FILE_NAME_REQUIRED"],
    ["   ", "DOCUMENT_FILE_NAME_REQUIRED"],
    [null, "DOCUMENT_FILE_NAME_INVALID"],
    [7, "DOCUMENT_FILE_NAME_INVALID"],
    [{ name: "outro.pdf" }, "DOCUMENT_FILE_NAME_INVALID"],
    ["../outro.pdf", "DOCUMENT_FILE_NAME_INVALID"],
    ["pasta\\outro.pdf", "DOCUMENT_FILE_NAME_INVALID"],
    ["nome\r\nHeader.pdf", "DOCUMENT_FILE_NAME_INVALID"],
    ["nome\u0000.pdf", "DOCUMENT_FILE_NAME_INVALID"],
    [".pdf", "DOCUMENT_FILE_NAME_INVALID"],
    ["outro.exe", "DOCUMENT_FILE_EXTENSION_IMMUTABLE"],
    ["Relatório final", "DOCUMENT_FILE_EXTENSION_IMMUTABLE"],
    ["Relatório.PDF", "DOCUMENT_FILE_EXTENSION_IMMUTABLE"],
    ["x".repeat(157) + ".pdf", "DOCUMENT_FILE_NAME_TOO_LONG"],
  ]) {
    assert.throws(() => normalizeOrganizationFileName(name, file), { status: 400, code });
  }
  assert.throws(
    () => normalizeOrganizationFileName("oculto.pdf", { original_name: "mapa.geojson" }),
    { code: "DOCUMENT_FILE_EXTENSION_IMMUTABLE" },
  );
});

test("extensão original é exata, com múltiplos pontos e sem inferir extensão do binário", () => {
  for (const [name, baseName, extension] of [
    ["relatorio.v2.PDF", "relatorio.v2", ".PDF"],
    ["arquivo.tar.gz", "arquivo.tar", ".gz"],
    ["README", "README", ""],
    [".env", ".env", ""],
    ["nome.", "nome.", ""],
    ["dados.part-1", "dados", ".part-1"],
  ]) {
    assert.deepEqual(splitOrganizationFileName(name), { baseName, extension });
  }
  assert.equal(normalizeOrganizationFileName("novo.v3.PDF", { original_name: "antigo.v2.PDF" }), "novo.v3.PDF");
  assert.equal(normalizeOrganizationFileName("LEIAME", { original_name: "README", file_name: "stored.pdf" }), "LEIAME");
  for (const candidate of ["LEIAME.txt", "LEIAME.pdf"]) {
    assert.throws(() => normalizeOrganizationFileName(candidate, { original_name: "README", file_name: "stored.pdf" }),
      { code: "DOCUMENT_FILE_EXTENSION_IMMUTABLE" });
  }
  assert.throws(() => normalizeOrganizationFileName("novo.v2.pdf", { original_name: "antigo.v1.PDF" }),
    { code: "DOCUMENT_FILE_EXTENSION_IMMUTABLE" });
});

test("rename altera só metadados de exibição e atualiza busca sem chamada ao provider", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  insertFile(db);
  const before = db.prepare("SELECT * FROM organization_files WHERE id = 10").get();
  const renamed = await renameOrganizationFile(env, 1, 10, "Relatório final.pdf");
  assert.equal(renamed.name, "Relatório final.pdf");
  assert.equal(renamed.original_name, renamed.name);
  assert.notEqual(renamed.updated_at, before.updated_at);
  for (const key of Object.keys(before).filter((key) => !["name", "original_name", "updated_at"].includes(key))) {
    assert.deepEqual(renamed[key], before[key], key);
  }
  const query = parseOrganizationFileListQuery(new Request("https://local.test?search=final&sort=name_asc"));
  const { sql, bindings } = buildOrganizationFileListSql(1, query, { canViewGeoJson: false });
  assert.deepEqual(db.prepare(sql).all(...bindings).map((file) => file.id), [10]);
  assert.deepEqual(calls, []);
});

test("rename isola organização e rejeita arquivos indisponíveis sem escrita", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  insertFile(db);
  const snapshot = () => db.prepare("SELECT * FROM organization_files WHERE id = 10").get();
  const original = snapshot();
  await assert.rejects(renameOrganizationFile(env, 2, 10, "outro.pdf"), { code: "ORGANIZATION_FILE_NOT_FOUND" });
  assert.deepEqual(snapshot(), original);
  for (const clause of [
    "active = 0",
    "deleted_at = '2026-01-02'",
    "purged_at = '2026-01-02'",
    "status = 'TRASHED'",
    "status = 'PENDING'",
    "status = 'FAILED'",
  ]) {
    db.exec("UPDATE organization_files SET active = 1, deleted_at = NULL, purged_at = NULL, status = 'ACTIVE' WHERE id = 10");
    db.exec(`UPDATE organization_files SET ${clause} WHERE id = 10`);
    const before = snapshot();
    await assert.rejects(renameOrganizationFile(env, 1, 10, "outro.pdf"), { code: "ORGANIZATION_FILE_NOT_FOUND" });
    assert.deepEqual(snapshot(), before);
  }
  assert.deepEqual(calls, []);
});

test("rename não grava se o arquivo entra na lixeira entre leitura e atualização", async (t) => {
  const { env, db, calls } = persistenceFixture(t, {
    beforeSql({ sql, db }) {
      if (/UPDATE organization_files\s+SET name/.test(sql)) {
        db.exec("UPDATE organization_files SET active = 0, status = 'TRASHED', deleted_at = '2026-01-02' WHERE id = 10");
      }
    },
  });
  insertFile(db);
  await assert.rejects(renameOrganizationFile(env, 1, 10, "outro.pdf"), { code: "ORGANIZATION_FILE_NOT_FOUND" });
  assert.equal(db.prepare("SELECT name FROM organization_files WHERE id = 10").get().name, "relatorio.pdf");
  assert.deepEqual(calls, []);
});

test("PATCH rename exige sessão, document.manage e organização correta", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  insertFile(db);
  assert.equal((await patch(env, "", { name: "outro.pdf" })).status, 401);
  const ownerCookie = sessionCookie(db);
  const otherCookie = sessionCookie(db, 2, 2);
  assert.equal((await patch(env, otherCookie, { name: "outro.pdf" })).status, 403);
  assert.equal((await patch(env, otherCookie, { name: "outro.pdf" }, { organizationId: 2 })).status, 404);
  for (const role of ["viewer", "editor"]) {
    db.prepare("UPDATE users SET role = ? WHERE id = 1").run(role);
    assert.equal((await patch(env, ownerCookie, { name: "outro.pdf" })).status, 403);
  }
  db.exec("UPDATE users SET role = 'owner' WHERE id = 1");
  db.exec("INSERT INTO user_permission_denials (user_id, organization_id, permission, denied_by) VALUES (1, 1, 'document.manage', 2)");
  assert.equal((await patch(env, ownerCookie, { name: "outro.pdf" })).status, 403);
  assert.equal(db.prepare("SELECT name FROM organization_files WHERE id = 10").get().name, "relatorio.pdf");
  assert.deepEqual(calls, []);
});

test("PATCH rename reaplica autorização GeoJSON antes de alterar o nome", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  // Legacy records may carry only the extension that classifies GeoJSON.
  insertFile(db, { name: "mapa.geojson", type: "other" });
  const response = await patch(env, sessionCookie(db), { name: "novo.geojson" });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "ORGANIZATION_FILE_NOT_FOUND");
  assert.equal(db.prepare("SELECT name FROM organization_files WHERE id = 10").get().name, "mapa.geojson");
  const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'organization.projects.geojson.access_denied'").get();
  assert.equal(JSON.parse(audit.details).metadata.surface, "document.rename");
  assert.deepEqual(calls, []);
});

test("PATCH rename registra auditoria e download mantém bytes, path e novo nome", async (t) => {
  const { env, db, calls, store } = persistenceFixture(t);
  insertFile(db);
  db.exec("UPDATE organizations SET dropbox_root_path = '/projects/offline-a' WHERE id = 1");
  const cookie = sessionCookie(db);
  await store("/projects/offline-a/documents/stored-10.pdf", new TextEncoder().encode("original bytes"));
  const response = await patch(env, cookie, { name: "Relatório final.pdf" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.file.name, "Relatório final.pdf");
  assert.equal(result.file.fileName, "stored-10.pdf");
  assert.equal(result.file.folderId, null);
  assert.equal(response.headers.get("X-Request-Id"), "rename-test");
  assert.deepEqual(calls, []);
  const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'document.rename'").get();
  const details = JSON.parse(audit.details);
  assert.equal(details.organizationId, 1);
  assert.equal(details.resourceId, 10);
  assert.equal(details.metadata.fileName, "Relatório final.pdf");

  const download = await downloadRoute({
    env, params: { id: "1", fileId: "10" },
    request: new Request("https://local.test/api/organizations/1/files/10/download", { headers: { Cookie: cookie } }),
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "original bytes");
  assert.equal(download.headers.get("Content-Disposition"), "attachment; filename*=UTF-8''Relat%C3%B3rio%20final.pdf");
  assert.equal(download.headers.get("Content-Type"), "application/pdf");
  assert.deepEqual(calls.map(({ op, args }) => ({ op, args })), [
    { op: "download", args: { path: "/projects/offline-a/documents/stored-10.pdf" } },
  ]);
});

test("PATCH rejeita payload ambíguo/inválido e conserva move folderId existente", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  insertFile(db);
  const cookie = sessionCookie(db);
  for (const payload of [null, [], "nome", { name: null }, { name: "novo.pdf", folderId: null }, {}]) {
    assert.equal((await patch(env, cookie, payload)).status, 400);
    assert.equal(db.prepare("SELECT name FROM organization_files WHERE id = 10").get().name, "relatorio.pdf");
  }
  const folder = await createDocumentFolder(env, { organizationId: 1, name: "Destino", userId: 1 });
  const moved = await patch(env, cookie, { folderId: folder.id });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).file.folderId, folder.id);
  const root = await patch(env, cookie, { folderId: null });
  assert.equal(root.status, 200);
  assert.equal((await root.json()).file.folderId, null);
  assert.deepEqual(calls, []);
});

test("DELETE permanece lixeira reversível após rename", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  insertFile(db);
  const cookie = sessionCookie(db);
  assert.equal((await patch(env, cookie, { name: "Renomeado.pdf" })).status, 200);
  const trashed = await fileRoute({
    env, params: { id: "1", fileId: "10" },
    request: new Request("https://local.test/api/organizations/1/files/10", { method: "DELETE", headers: { Cookie: cookie } }),
  });
  assert.equal(trashed.status, 200);
  const result = await trashed.json();
  assert.equal(result.trashed, true);
  assert.equal(result.file.name, "Renomeado.pdf");
  assert.equal(result.file.status, "TRASHED");
  assert.equal(result.file.purgedAt, null);
  assert.equal((await patch(env, cookie, { name: "Não renomear.pdf" })).status, 404);
  const restored = await restoreRoute({
    env, params: { id: "1", fileId: "10" },
    request: new Request("https://local.test/api/organizations/1/files/10/restore", { method: "POST", headers: { Cookie: cookie } }),
  });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).file.name, "Renomeado.pdf");
  assert.equal(db.prepare("SELECT status FROM organization_files WHERE id = 10").get().status, "ACTIVE");
  assert.deepEqual(calls, []);
});

test("cliente envia PATCH name e mostra validações legíveis sem expor mensagem remota", async (t) => {
  const bundle = await build({
    entryPoints: [new URL("../src/lib/api.ts", import.meta.url).pathname],
    bundle: true, format: "esm", platform: "browser", write: false,
  });
  const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/organizations/org%2F1/files/file%2F10");
    assert.equal(init.method, "PATCH");
    assert.equal(init.credentials, "include");
    assert.deepEqual(JSON.parse(init.body), { name: "Novo nome.pdf" });
    return Response.json({ ok: true, file: { id: 10, name: "Novo nome.pdf" } });
  });
  assert.equal((await api.renameOrganizationFile("org/1", "file/10", "Novo nome.pdf")).file.name, "Novo nome.pdf");
  for (const [code, message] of [
    ["DOCUMENT_FILE_NAME_REQUIRED", /Digite um nome/],
    ["DOCUMENT_FILE_NAME_INVALID", /sem barras/],
    ["DOCUMENT_FILE_NAME_TOO_LONG", /160 caracteres/],
    ["DOCUMENT_FILE_EXTENSION_IMMUTABLE", /extensão original/],
    ["DOCUMENT_FILE_PATCH_AMBIGUOUS", /operações separadas/],
    ["DOCUMENT_FILE_PATCH_INVALID", /nome ou a pasta/],
  ]) {
    fetch.mock.mockImplementation(async () => Response.json({ ok: false, code, error: "PRIVATE_PROVIDER_DETAILS" }, { status: 400 }));
    await assert.rejects(api.renameOrganizationFile(1, 10, "Inválido"), (error) => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_DETAILS/);
      return true;
    });
  }
});
