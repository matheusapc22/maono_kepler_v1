import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORGANIZATION_FILE_DEFAULT_LIMIT,
  ORGANIZATION_FILE_MAX_LIMIT,
  buildOrganizationFileListSql,
  decodeOrganizationFileCursor,
  encodeOrganizationFileCursor,
  listOrganizationFilesPage,
  parseOrganizationFileListQuery,
} from "../functions/_lib/organization-file-query.js";
import { publicOrganizationFile } from "../functions/_lib/organization-files.js";
import { onRequestGet as listFilesRoute } from "../functions/api/organizations/[id]/files.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

function request(query = "") {
  return new Request(`https://maono.test/api/organizations/1/files${query}`);
}

function folderNavigationFixture(t) {
  const fixture = persistenceFixture(t);
  fixture.db.exec(`
    INSERT INTO organization_file_folders (id, organization_id, parent_id, name, created_by)
    VALUES (11, 1, NULL, 'Contratos', 1), (12, 1, 11, 'Anexos', 1),
           (13, 1, NULL, 'Relatórios', 1), (21, 2, NULL, 'Outra organização', 2);
  `);
  const insert = fixture.db.prepare(`
    INSERT INTO organization_files (
      id, organization_id, folder_id, name, original_name, file_name,
      dropbox_path, file_type, mime_type, status, active, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `);
  for (const [id, organizationId, folderId, name, fileType, mimeType, active, deletedAt] of [
    [101, 1, null, '101-raiz.pdf', 'pdf', 'application/pdf', 1, null],
    [102, 1, 11, '102-contrato.pdf', 'pdf', 'application/pdf', 1, null],
    [103, 1, 12, '103-anexo.pdf', 'pdf', 'application/pdf', 1, null],
    [104, 1, 13, '104-relatorio.pdf', 'pdf', 'application/pdf', 1, null],
    [105, 1, null, '105-mapa.geojson', 'geojson', 'application/json', 1, null],
    [106, 1, 11, '106-legado.json', 'other', 'application/json', 1, null],
    [107, 1, 12, '107-sem-extensao', 'other', 'application/geo+json', 1, null],
    [108, 1, 13, '108-sem-extensao', 'json', 'application/octet-stream', 1, null],
    [109, 2, null, '109-outra-raiz.pdf', 'pdf', 'application/pdf', 1, null],
    [110, 2, 21, '110-outra-pasta.pdf', 'pdf', 'application/pdf', 1, null],
    [111, 1, null, '111-inativo.pdf', 'pdf', 'application/pdf', 0, null],
    [112, 1, 11, '112-excluido.pdf', 'pdf', 'application/pdf', 1, '2026-09-01'],
  ]) {
    insert.run(id, organizationId, folderId, name, name, name,
      `/offline/${organizationId}/documents/${name}`, fileType, mimeType, active, deletedAt);
  }
  return fixture;
}

function sessionCookie(db, userId = 1, organizationId = 1) {
  const token = `document-filter-test-${userId}-${organizationId}`;
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, active_organization_id, expires_at)
    VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')
  `).run(createHash("sha256").update(token).digest("hex"), userId, organizationId);
  return `maono_session=${token}`;
}

test("contrato padrão usa paginação limitada e ordenação estável", () => {
  const parsed = parseOrganizationFileListQuery(request());
  assert.equal(parsed.limit, ORGANIZATION_FILE_DEFAULT_LIMIT);
  assert.equal(parsed.state, "active");
  assert.equal(parsed.sort, "updated_desc");
  assert.equal(parsed.cursor, null);
  assert.equal(ORGANIZATION_FILE_MAX_LIMIT, 100);

  const built = buildOrganizationFileListSql(7, parsed, { canViewGeoJson: true });
  assert.match(built.sql, /ORDER BY .* DESC, f\.id DESC/s);
  assert.equal(built.bindings.at(-1), ORGANIZATION_FILE_DEFAULT_LIMIT + 1);
});

test("parseia busca, tipo, projeto, pasta, período e normaliza datas inclusivas", () => {
  const parsed = parseOrganizationFileListQuery(
    request("?search=relatorio&type=PDF&projectId=12&folderId=7&updatedFrom=2026-09-01&updatedTo=2026-09-24&sort=name_asc&limit=25"),
  );

  assert.equal(parsed.search, "relatorio");
  assert.equal(parsed.type, "pdf");
  assert.equal(parsed.projectId, 12);
  assert.equal(parsed.folderId, 7);
  assert.equal(parsed.updatedFrom, "2026-09-01T00:00:00.000Z");
  assert.equal(parsed.updatedTo, "2026-09-24T23:59:59.999Z");
  assert.equal(parsed.sort, "name_asc");
  assert.equal(parsed.limit, 25);
});

test("rejeita limites, ordenações, períodos e cursor incompatíveis", () => {
  assert.throws(() => parseOrganizationFileListQuery(request("?limit=101")), /limit deve estar entre/);
  assert.throws(() => parseOrganizationFileListQuery(request("?sort=dropbox_path")), /Ordenação inválida/);
  assert.throws(
    () => parseOrganizationFileListQuery(request("?updatedFrom=2026-10-01&updatedTo=2026-09-01")),
    /início do período/,
  );

  const cursor = encodeOrganizationFileCursor({
    v: 1,
    sort: "name_asc",
    value: "arquivo.pdf",
    id: 10,
  });
  assert.throws(
    () => parseOrganizationFileListQuery(request(`?sort=updated_desc&cursor=${cursor}`)),
    /Cursor incompatível/,
  );
});

test("cursor preserva unicode e chave de desempate", () => {
  const cursor = encodeOrganizationFileCursor({
    v: 1,
    sort: "name_asc",
    value: "ação territorial.pdf",
    id: 42,
  });
  assert.deepEqual(decodeOrganizationFileCursor(cursor), {
    v: 1,
    sort: "name_asc",
    value: "ação territorial.pdf",
    id: 42,
  });
});

test("cursor rejeita valor incompatível com o tipo da ordenação e payload excessivo", () => {
  const invalidNumericCursor = encodeOrganizationFileCursor({
    v: 1,
    sort: "size_desc",
    value: "100",
    id: 7,
  });
  assert.throws(
    () => decodeOrganizationFileCursor(invalidNumericCursor),
    /Cursor inválido/,
  );
  assert.throws(
    () => decodeOrganizationFileCursor("x".repeat(1025)),
    /Cursor inválido/,
  );
});

test("filtro por pasta suporta raiz e id sem sair do SQL autorizado", () => {
  const root = parseOrganizationFileListQuery(request("?folderId=root"));
  const rootSql = buildOrganizationFileListSql(3, root, { canViewGeoJson: false });
  assert.equal(root.folderId, "root");
  assert.match(rootSql.sql, /f\.folder_id IS NULL/);
  assert.match(rootSql.sql, /NOT \([\s\S]*geojson/s);

  const folder = parseOrganizationFileListQuery(request("?folderId=42"));
  const folderSql = buildOrganizationFileListSql(3, folder, { canViewGeoJson: true });
  assert.equal(folder.folderId, 42);
  assert.match(folderSql.sql, /f\.folder_id = \?/);
  assert.ok(folderSql.bindings.includes(42));

  assert.throws(
    () => parseOrganizationFileListQuery(request("?folderId=fora")),
    /folderId inválido/,
  );
});

test("SQLite distingue raiz, filhos diretos e todos com a pasta de origem preservada", async (t) => {
  const { env, calls } = folderNavigationFixture(t);
  const list = (filter) => listOrganizationFilesPage(
    env, 1, parseOrganizationFileListQuery(request(`?sort=name_asc${filter}`)),
  );

  for (const [filter, expected] of [
    ["&folderId=root", [[101, null]]],
    ["&folderId=11", [[102, 11]]],
    ["&folderId=12", [[103, 12]]],
    ["&folderId=13", [[104, 13]]],
    ["", [[101, null], [102, 11], [103, 12], [104, 13]]],
    ["&folderId=", [[101, null], [102, 11], [103, 12], [104, 13]]],
    ["&folderId=21", []],
  ]) {
    const page = await list(filter);
    const files = page.rows.map(publicOrganizationFile);
    assert.deepEqual(files.map((file) => [file.id, file.folderId]), expected, filter);
    assert.ok(files.every((file) => file.organizationId === 1));
    assert.equal(page.pagination.total, expected.length, filter);
    assert.equal(page.facets.rootCount, 1);
    assert.deepEqual(page.facets.types, ["pdf"]);
    assert.deepEqual(page.facets.folderCounts, [
      { folderId: 11, count: 1 }, { folderId: 12, count: 1 }, { folderId: 13, count: 1 },
    ]);
  }
  assert.deepEqual(calls, []);
});

test("todos mantém autorização GeoJSON, tenant e contagem antes da paginação SQLite", async (t) => {
  const { env, calls } = folderNavigationFixture(t);
  const query = parseOrganizationFileListQuery(request("?sort=name_asc&limit=2"));
  const first = await listOrganizationFilesPage(env, 1, query);
  assert.deepEqual(first.rows.map((file) => file.id), [101, 102]);
  assert.equal(first.pagination.total, 4);
  assert.equal(first.pagination.hasMore, true);

  const second = await listOrganizationFilesPage(env, 1, {
    ...query, cursor: decodeOrganizationFileCursor(first.pagination.nextCursor),
  });
  assert.deepEqual(second.rows.map((file) => file.id), [103, 104]);
  assert.equal(second.pagination.total, 4);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(second.pagination.nextCursor, null);

  const granted = await listOrganizationFilesPage(env, 1, { ...query, limit: 50 }, {
    canViewGeoJson: true,
  });
  assert.deepEqual(granted.rows.map((file) => file.id), [101, 102, 103, 104, 105, 106, 107, 108]);
  assert.equal(granted.pagination.total, 8);
  assert.ok(granted.rows.every((file) => file.organization_id === 1));
  assert.equal(granted.facets.rootCount, 2);
  assert.deepEqual(calls, []);
});

test("GET raiz/todos publica folderId e conserva sessão, document.view e isolamento", async (t) => {
  const { env, db, calls } = folderNavigationFixture(t);
  const ownerCookie = sessionCookie(db);
  const otherCookie = sessionCookie(db, 2, 2);
  const get = (cookie, filter = "") => listFilesRoute({
    env,
    params: { id: "1" },
    request: new Request(`https://maono.test/api/organizations/1/files?sort=name_asc${filter}`, {
      headers: { Cookie: cookie },
    }),
  });

  for (const [filter, expected] of [
    ["&folderId=root", [[101, null]]],
    ["", [[101, null], [102, 11], [103, 12], [104, 13]]],
  ]) {
    const response = await get(ownerCookie, filter);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.files.map((file) => [file.id, file.folderId]), expected);
    assert.equal(body.pagination.total, expected.length);
  }

  assert.equal((await get("")).status, 401);
  assert.equal((await get(otherCookie)).status, 403);
  db.exec(`
    INSERT INTO user_permission_denials (user_id, organization_id, permission, denied_by)
    VALUES (1, 1, 'document.view', 2)
  `);
  assert.equal((await get(ownerCookie)).status, 403);
  assert.equal((await get(ownerCookie, "&folderId=root")).status, 403);
  assert.deepEqual(calls, []);
});

test("state=trash seleciona somente lixeira e mantém bloqueio GeoJSON", () => {
  const parsed = parseOrganizationFileListQuery(request("?state=trash"));
  assert.equal(parsed.state, "trash");

  const built = buildOrganizationFileListSql(3, parsed, { canViewGeoJson: false });
  assert.match(built.sql, /f\.deleted_at IS NOT NULL/);
  assert.match(built.sql, /f\.purge_after IS NOT NULL/);
  assert.match(built.sql, /f\.purged_at IS NULL/);
  assert.match(built.sql, /TRASHED/);
  assert.match(built.sql, /deleted_user/);
  assert.match(built.sql, /trashed_folder/);
  assert.match(built.sql, /NOT \([\s\S]*geojson/s);

  assert.throws(
    () => parseOrganizationFileListQuery(request("?state=purged")),
    /Estado documental inválido/,
  );
});

test("SQL sem concessão GeoJSON exclui JSON/GeoJSON antes da paginação e contagem", () => {
  const parsed = parseOrganizationFileListQuery(request("?search=mapa&type=pdf&projectId=4"));
  const built = buildOrganizationFileListSql(3, parsed, { canViewGeoJson: false });

  assert.match(built.sql, /NOT \([\s\S]*file_type[\s\S]*geojson[\s\S]*\.json[\s\S]*geo\+json[\s\S]*\)/);
  assert.match(built.sql, /f\.organization_id = \?/);
  assert.match(built.sql, /f\.deleted_at IS NULL/);
  assert.match(built.sql, /f\.project_id = \?/);
  assert.match(built.sql, /LIKE \? ESCAPE/);
});

test("rota usa query server-side e decide visibilidade GeoJSON uma vez por request", async () => {
  const source = await readFile(
    new URL("../functions/api/organizations/[id]/files.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /parseOrganizationFileListQuery\(request\)/);
  assert.match(source, /decideProjectGeoJsonAccess\([\s\S]*organizationId,[\s\S]*null/s);
  assert.match(source, /listOrganizationFilesPage\(/);
  assert.doesNotMatch(source, /listRowsByOrganization\(/);
  assert.doesNotMatch(source, /filterVisibleOrganizationFiles\(/);
});

test("UI implementa árvore, breadcrumb, CRUD, move e filtro por pasta", async () => {
  const source = await readFile(
    new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /documents-filter-toolbar/);
  assert.match(source, /documents-folder-tree/);
  assert.match(source, /documents-folder-breadcrumb/);
  assert.match(source, /Nova pasta/);
  assert.match(source, /createOrganizationDocumentFolder/);
  assert.match(source, /updateOrganizationDocumentFolder/);
  assert.match(source, /deleteOrganizationDocumentFolder/);
  assert.match(source, /moveOrganizationFileToFolder/);
  assert.match(source, /folderId/);
  assert.match(source, /Limpar filtros/);
  assert.match(source, /Itens por página/);
  assert.match(source, /directFolders/);
  assert.match(source, /folder\.parentId == null/);
  assert.match(source, /String\(folder\.parentId \?\? ""\) === currentFolderId/);
  assert.match(source, /updatedFrom/);
  assert.match(source, /projectId/);
  assert.match(source, /Lixeira/);
  assert.match(source, /Restaurar/);
  assert.match(source, /restoreOrganizationFile/);
  assert.match(source, /documentState/);
});
