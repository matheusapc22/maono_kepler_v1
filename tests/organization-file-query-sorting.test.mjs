import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeOrganizationFileCursor,
  encodeOrganizationFileCursor,
  listOrganizationFilesPage,
  parseOrganizationFileListQuery,
} from "../functions/_lib/organization-file-query.js";
import { publicOrganizationFile } from "../functions/_lib/organization-files.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

const SORTS = [
  "name_asc", "name_desc", "type_asc", "type_desc",
  "size_asc", "size_desc", "updated_asc", "updated_desc",
];
const TYPE_LABELS = {
  geojson: "GeoJSON", json: "JSON", csv: "CSV", spreadsheet: "Planilha",
  pdf: "PDF", image: "Imagem", zip: "ZIP", document: "Documento",
  text: "Texto", other: "Outro",
};

function query(params) {
  return parseOrganizationFileListQuery(new Request(
    `https://maono.test/api/organizations/1/files?${new URLSearchParams(params)}`,
  ));
}

function insertFile(db, overrides) {
  const row = {
    id: 1, organization_id: 1, project_id: null, folder_id: null,
    name: "document.bin", original_name: "document.bin", file_name: "stored.bin",
    file_type: "pdf", mime_type: "application/pdf", size_bytes: 10,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-15T12:00:00.000Z",
    status: "ACTIVE", active: 1, deleted_at: null, purge_after: null,
    trashed_from_folder_id: null,
    ...overrides,
  };
  row.dropbox_path = `/offline/${row.organization_id}/documents/${row.id}.bin`;
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO organization_files (${columns.join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row));
  return row;
}

function sortValue(row, sort) {
  if (sort.startsWith("name_")) {
    return publicOrganizationFile(row).name.toLowerCase();
  }
  if (sort.startsWith("size_")) return Number(row.size_bytes ?? 0);
  if (sort.startsWith("type_")) {
    // Follow the production serializer, then the displayed DocumentsSection badge.
    const file = publicOrganizationFile(row);
    const type = (file.fileType || "").toLowerCase();
    return (file.fileType ? TYPE_LABELS[type] || type || "Outro" : file.mimeType || "—").toLowerCase();
  }
  const timestamp = [row.updated_at, row.created_at].find((value) =>
    value && Number.isFinite(Date.parse(value)));
  return timestamp ? new Date(timestamp).toISOString().slice(0, -1).replace("T", " ") : "";
}

function sortedRows(rows, sort) {
  const direction = sort.endsWith("_desc") ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aValue = sortValue(a, sort);
    const bValue = sortValue(b, sort);
    return direction * ((aValue < bValue ? -1 : aValue > bValue ? 1 : 0) || a.id - b.id);
  });
}

async function assertCompletePagination(env, params, rows, { canViewGeoJson = false } = {}) {
  const expected = sortedRows(rows, params.sort);
  const limit = Number(params.limit || 50);
  const seen = [];
  const cursors = new Set();
  let cursor;
  let pages = 0;
  let tieAcrossPages = false;
  let previousLast;
  do {
    const page = await listOrganizationFilesPage(env, 1, query({
      ...params, ...(cursor ? { cursor } : {}),
    }), { canViewGeoJson });
    pages += 1;
    assert.ok(pages <= Math.ceil(expected.length / limit) + 1, "pagination must terminate");
    assert.equal(page.pagination.total, expected.length, "count is global, not remaining rows");
    assert.equal(page.pagination.sort, params.sort);
    assert.equal(page.pagination.limit, limit);
    assert.ok(page.rows.length <= limit);
    assert.ok(page.rows.every((row) => row.organization_id === 1));
    if (previousLast && page.rows[0]?.__sort_value === previousLast.__sort_value) {
      tieAcrossPages = true;
    }
    for (const row of page.rows) {
      assert.equal(row.__sort_value, sortValue(row, params.sort), "SQL uses the expected sort key");
    }
    seen.push(...page.rows.map((row) => row.id));
    assert.equal(page.pagination.hasMore, seen.length < expected.length);
    cursor = page.pagination.nextCursor;
    previousLast = page.rows.at(-1);
    if (page.pagination.hasMore) {
      assert.equal(typeof cursor, "string");
      assert.ok(!cursors.has(cursor), "each page must advance its cursor");
      cursors.add(cursor);
      const last = expected[seen.length - 1];
      assert.deepEqual(decodeOrganizationFileCursor(cursor), {
        v: 1, sort: params.sort, value: sortValue(last, params.sort), id: last.id,
      });
    } else {
      assert.equal(cursor, null);
    }
  } while (cursor);

  assert.deepEqual(seen, expected.map((row) => row.id), "global order has no missing or duplicate rows");
  assert.equal(new Set(seen).size, expected.length);
  if (expected.length > limit) {
    assert.ok(pages > 1);
    assert.ok(tieAcrossPages, "fixture exercises the ID tiebreaker across a page boundary");
  }
  return seen;
}

function multiPageFixture(t) {
  const fixture = persistenceFixture(t);
  fixture.db.exec(`
    INSERT INTO organization_file_folders (id, organization_id, name, created_by)
    VALUES (11, 1, 'Documentos', 1);
  `);
  const types = [
    ["geojson", "application/geo+json"], ["json", "application/json"],
    ["csv", "text/csv"], ["spreadsheet", "application/vnd.ms-excel"],
    ["pdf", "application/pdf"], ["image", "image/png"], ["zip", "application/zip"],
    ["document", "application/msword"], ["text", "text/plain"], ["other", null],
    ["Custom", "application/octet-stream"], ["", "Application/Octet-Stream"],
    ["", null], ["CSV", "text/csv"],
  ];
  const rows = Array.from({ length: types.length * 16 }, (_, index) => {
    const [file_type, mime_type] = types[Math.floor(index / 16)];
    const name = ["Alpha.bin", "beta.bin", "GAMMA.bin"][index % 3];
    const updated = ["2026-09-10T12:00:00.000Z", "2026-09-20T12:00:00.000Z",
      "2026-09-30T12:00:00.000Z", "not-a-date"][Math.floor(index / 4) % 4];
    return insertFile(fixture.db, {
      id: index + 1, folder_id: index % 2 ? 11 : null, file_type, mime_type,
      name, original_name: index % 5 ? name : null,
      // SQLite's INTEGER affinity must keep numeric, rather than formatted or lexical, ordering.
      size_bytes: [null, "2", 10, "100", 1024, 1000000][Math.floor(index / 2) % 6],
      updated_at: updated,
    });
  });
  // Permission checks must also recognize legacy JSON extensions and MIME-only GeoJSON.
  rows.push(insertFile(fixture.db, {
    id: 301, file_type: "other", name: "legacy.json", original_name: "legacy.json",
  }));
  rows.push(insertFile(fixture.db, {
    id: 302, file_type: "other", mime_type: "application/geo+json", folder_id: 11,
  }));
  insertFile(fixture.db, { id: 401, organization_id: 2 });
  insertFile(fixture.db, { id: 402, active: 0 });
  insertFile(fixture.db, { id: 403, deleted_at: "2026-09-12", status: "TRASHED" });
  return { ...fixture, rows };
}

test("SQLite percorre mais de 50 documentos em todas as 8 ordenações, raiz/todos e permissões", async (t) => {
  const { env, rows, calls } = multiPageFixture(t);
  for (const sort of SORTS) {
    for (const canViewGeoJson of [false, true]) {
      for (const folderId of [undefined, "root"]) {
        await t.test(`${sort}, ${folderId || "todos"}, GeoJSON=${canViewGeoJson}`, async () => {
          const eligible = rows.filter((row) =>
            (!folderId || row.folder_id == null) &&
            (canViewGeoJson || (!["geojson", "json"].includes(row.file_type) && row.id < 301)));
          assert.ok(eligible.length > 50);
          await assertCompletePagination(env, { sort, ...(folderId ? { folderId } : {}) }, eligible, {
            canViewGeoJson,
          });
        });
      }
    }
  }
  assert.deepEqual(calls, [], "listing never reaches the storage provider");
});

test("SQLite aplica busca, tipo, projeto, período e pasta antes de ordenar/paginar", async (t) => {
  const { env, db, calls } = persistenceFixture(t);
  db.exec(`
    INSERT INTO projects (id, organization_id, name, slug, dropbox_root_path)
    VALUES (11, 1, 'Projeto filtro', 'filter-project', '/offline/project'),
           (12, 1, 'Outro projeto', 'other-project', '/offline/other');
    INSERT INTO organization_file_folders (id, organization_id, name, created_by)
    VALUES (11, 1, 'Documentos', 1);
  `);
  const rows = Array.from({ length: 132 }, (_, index) => insertFile(db, {
    id: index + 1, folder_id: index % 2 ? 11 : null, project_id: 11,
    original_name: ["needle_100% Alpha.pdf", "needle_100% beta.pdf"][Math.floor(index / 2) % 2],
    size_bytes: index % 4 < 2 ? 2 : 1000,
    updated_at: index % 4 < 2 ? "2026-09-10T00:00:00.000Z" : "2026-09-20T23:59:59.000Z",
  }));
  const matching = { ...rows[0] };
  for (const [index, overrides] of [
    { original_name: "needleX100Z Alpha.pdf" },
    { file_type: "image" },
    { project_id: 12 },
    { updated_at: "2026-09-09T23:59:59.000Z" },
    { updated_at: "2026-09-21T00:00:00.000Z" },
    { organization_id: 2, project_id: null },
    { active: 0 },
    { deleted_at: "2026-09-15" },
    { mime_type: "application/geo+json" },
  ].entries()) insertFile(db, { ...matching, ...overrides, id: 201 + index });

  for (const sort of SORTS) {
    for (const folderId of [undefined, "root", "11"]) {
      await t.test(`${sort}, ${folderId || "todos"}`, async () => {
        const eligible = rows.filter((row) => !folderId || (folderId === "root"
          ? row.folder_id == null : row.folder_id === Number(folderId)));
        assert.ok(eligible.length > 50);
        await assertCompletePagination(env, {
          sort, search: "needle_100%", type: "PDF", projectId: "11",
          updatedFrom: "2026-09-10", updatedTo: "2026-09-20",
          ...(folderId ? { folderId } : {}),
        }, eligible);
      });
    }
  }
  assert.deepEqual(calls, []);
});

test("atualização preserva milissegundos e ordem cronológica com IDs inversos entre páginas SQLite", async (t) => {
  const { env, db } = persistenceFixture(t);
  const rows = Array.from({ length: 180 }, (_, index) => {
    // Each 60-row group shares a timestamp, but larger IDs deliberately have older timestamps.
    const milliseconds = 900 - Math.floor(index / 60) * 400;
    const timestamp = new Date(Date.UTC(2026, 8, 20, 12, 0, 0, milliseconds)).toISOString();
    return insertFile(db, {
      id: index + 1, updated_at: index % 5 ? timestamp : "", created_at: timestamp,
    });
  });
  const epoch = (row) => {
    const file = publicOrganizationFile(row);
    return Date.parse(file.updatedAt || file.createdAt);
  };
  for (const sort of ["updated_asc", "updated_desc"]) {
    const seen = await assertCompletePagination(env, { sort }, rows);
    const direction = sort === "updated_asc" ? 1 : -1;
    const expected = [...rows].sort((a, b) => direction * (epoch(a) - epoch(b) || a.id - b.id));
    assert.deepEqual(seen, expected.map((row) => row.id), "order must follow actual displayed timestamp epochs");
  }
});

test("nomes vazios usam o nome público e desempate estável entre páginas SQLite", async (t) => {
  const { env, db } = persistenceFixture(t);
  const cases = [
    { original_name: "", name: "Zulu.pdf", file_name: "stored.pdf", expected: "Zulu.pdf" },
    { original_name: null, name: "Zulu.pdf", file_name: "stored.pdf", expected: "Zulu.pdf" },
    { original_name: "", name: "", file_name: "Zulu.pdf", expected: "Zulu.pdf" },
    { original_name: "Alpha.pdf", name: "Zulu.pdf", file_name: "stored.pdf", expected: "Alpha.pdf" },
    { original_name: "", name: "", file_name: "", expected: "Documento" },
    { original_name: "", name: "beta.pdf", file_name: "stored.pdf", expected: "beta.pdf" },
  ];
  const rows = Array.from({ length: 120 }, (_, index) => {
    const { expected, ...names } = cases[Math.floor(index / 20)];
    const row = insertFile(db, { id: index + 1, ...names });
    assert.equal(publicOrganizationFile(row).name, expected);
    return row;
  });
  for (const sort of ["name_asc", "name_desc"]) {
    await assertCompletePagination(env, { sort }, rows);
  }
});

test("tipo usa rótulos visíveis serializados, caixa ignorada e ausência de tipo em SQLite", async (t) => {
  const { env, db } = persistenceFixture(t);
  // Preserve the real columns while permitting legacy NULL values forbidden by the current schema.
  db.exec("CREATE TEMP TABLE organization_files AS SELECT * FROM main.organization_files WHERE 0");
  const rows = [
    ["spreadsheet", "application/vnd.ms-excel", "planilha"],
    ["text", "text/plain", "texto"],
    ["pdf", "application/pdf", "pdf"],
    ["image", "image/png", "imagem"],
    ["document", "application/msword", "documento"],
    ["other", null, "outro"],
    ["geojson", null, "geojson"], ["json", null, "json"],
    ["csv", null, "csv"], ["CSV", null, "csv"], ["zip", null, "zip"],
    ["Custom", "ignored/mime", "custom"],
    ["", "Application/PDF", "outro"],
    [null, "Text/Plain", "outro"],
    [null, null, "outro"], ["", "", "outro"],
  ].map(([file_type, mime_type, expected], index) => ({
    ...insertFile(db, { id: index + 1, file_type, mime_type }), expected,
  }));
  for (const sort of ["type_asc", "type_desc"]) {
    const page = await listOrganizationFilesPage(env, 1, query({ sort }), { canViewGeoJson: true });
    assert.deepEqual(page.rows.map((row) => row.id), sortedRows(rows, sort).map((row) => row.id));
    for (const row of page.rows) assert.equal(row.__sort_value, rows[row.id - 1].expected);
  }
});

test("tipo ausente vira Outro no contrato público e mantém cursor entre páginas", async (t) => {
  const { env, db } = persistenceFixture(t);
  db.exec("CREATE TEMP TABLE organization_files AS SELECT * FROM main.organization_files WHERE 0");
  const rows = Array.from({ length: 60 }, (_, index) => insertFile(db, {
    id: index + 1,
    file_type: [null, "", "other"][index % 3],
    mime_type: ["application/pdf", "image/png", null][Math.floor(index / 3) % 3],
  }));
  for (const row of rows) {
    const file = publicOrganizationFile(row);
    assert.equal(file.fileType, "other");
    assert.equal(TYPE_LABELS[file.fileType], "Outro");
  }
  rows.push(insertFile(db, { id: 61, file_type: "image" }));
  rows.push(insertFile(db, { id: 62, file_type: "pdf" }));
  for (const sort of ["type_asc", "type_desc"]) {
    await assertCompletePagination(env, { sort }, rows);
  }
});

test("cursor de cada ordenação rejeita todas as outras ordenações e tipos inválidos", () => {
  for (const sort of SORTS) {
    const value = sort.startsWith("size_") ? 1024 : "planilha";
    const cursor = encodeOrganizationFileCursor({ v: 1, sort, value, id: 42 });
    assert.deepEqual(query({ sort, cursor }).cursor, { v: 1, sort, value, id: 42 });
    for (const otherSort of SORTS.filter((other) => other !== sort)) {
      assert.throws(() => query({ sort: otherSort, cursor }), {
        status: 400, code: "ORGANIZATION_FILE_CURSOR_SORT_MISMATCH",
      });
    }
    const invalid = encodeOrganizationFileCursor({
      v: 1, sort, value: typeof value === "number" ? "1024" : 1024, id: 42,
    });
    assert.throws(() => query({ sort, cursor: invalid }), {
      status: 400, code: "ORGANIZATION_FILE_CURSOR_INVALID",
    });
  }
});

test("limite máximo continua 100 e paginação por tipo também respeita limite 1", async (t) => {
  const { env, rows } = multiPageFixture(t);
  for (const limit of ["1", "100"]) {
    await assertCompletePagination(env, { sort: "type_asc", limit }, rows, { canViewGeoJson: true });
  }
  for (const limit of ["0", "101"]) {
    assert.throws(() => query({ sort: "type_desc", limit }), {
      status: 400, code: "ORGANIZATION_FILE_QUERY_INVALID",
    });
  }
});
