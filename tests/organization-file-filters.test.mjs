import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORGANIZATION_FILE_DEFAULT_LIMIT,
  ORGANIZATION_FILE_MAX_LIMIT,
  buildOrganizationFileListSql,
  decodeOrganizationFileCursor,
  encodeOrganizationFileCursor,
  parseOrganizationFileListQuery,
} from "../functions/_lib/organization-file-query.js";

function request(query = "") {
  return new Request(`https://maono.test/api/organizations/1/files${query}`);
}

test("contrato padrão usa paginação limitada e ordenação estável", () => {
  const parsed = parseOrganizationFileListQuery(request());
  assert.equal(parsed.limit, ORGANIZATION_FILE_DEFAULT_LIMIT);
  assert.equal(parsed.sort, "updated_desc");
  assert.equal(parsed.cursor, null);
  assert.equal(ORGANIZATION_FILE_MAX_LIMIT, 100);

  const built = buildOrganizationFileListSql(7, parsed, { canViewGeoJson: true });
  assert.match(built.sql, /ORDER BY .* DESC, f\.id DESC/s);
  assert.equal(built.bindings.at(-1), ORGANIZATION_FILE_DEFAULT_LIMIT + 1);
});

test("parseia busca, tipo, projeto, período e normaliza datas inclusivas", () => {
  const parsed = parseOrganizationFileListQuery(
    request("?search=relatorio&type=PDF&projectId=12&updatedFrom=2026-09-01&updatedTo=2026-09-24&sort=name_asc&limit=25"),
  );

  assert.equal(parsed.search, "relatorio");
  assert.equal(parsed.type, "pdf");
  assert.equal(parsed.projectId, 12);
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

test("UI reserva folderId/trash e implementa filtros, chips e paginação incremental", async () => {
  const source = await readFile(
    new URL("../src/pages/Projects/components/DocumentsSection.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /documents-filter-toolbar/);
  assert.match(source, /Limpar filtros/);
  assert.match(source, /Carregar mais/);
  assert.match(source, /updatedFrom/);
  assert.match(source, /projectId/);
  assert.doesNotMatch(source, /folderId:/);
  assert.doesNotMatch(source, /state:\s*["']trash[#']/);
});
