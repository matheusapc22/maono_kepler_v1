import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0014_project_metadata_ownership.sql",
  import.meta.url,
);
const schemaUrl = new URL("../schema.sql", import.meta.url);

const [migration, schema] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(schemaUrl, "utf8"),
]);

function normalizeSql(value) {
  return value
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function projectTableDefinition(source) {
  const match = source.match(
    /CREATE TABLE IF NOT EXISTS projects\s*\(([\s\S]*?)\n\);/i,
  );

  assert.ok(match, "A definição canônica da tabela projects deve existir.");
  return match[1];
}

function columnLine(source, columnName) {
  const match = source.match(
    new RegExp(`^\\s*${columnName}\\s+([^,\\n]+)`, "im"),
  );

  assert.ok(match, `A coluna ${columnName} deve existir.`);
  return `${columnName} ${match[1]}`.replace(/\s+/g, " ").trim();
}

test("migration adiciona autoria, snapshots e versão de metadados", () => {
  assert.match(migration, /PRAGMA\s+foreign_keys\s*=\s*ON\s*;/i);

  assert.match(
    migration,
    /ADD COLUMN\s+created_by\s+INTEGER\s+REFERENCES\s+users\(id\)\s+ON DELETE SET NULL/i,
  );
  assert.match(
    migration,
    /ADD COLUMN\s+created_by_name_snapshot\s+TEXT/i,
  );
  assert.match(
    migration,
    /ADD COLUMN\s+updated_by\s+INTEGER\s+REFERENCES\s+users\(id\)\s+ON DELETE SET NULL/i,
  );
  assert.match(
    migration,
    /ADD COLUMN\s+updated_by_name_snapshot\s+TEXT/i,
  );
  assert.match(
    migration,
    /ADD COLUMN\s+metadata_version\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i,
  );
});

test("created_by e updated_by permanecem opcionais", () => {
  assert.doesNotMatch(
    migration,
    /ADD COLUMN\s+created_by\s+INTEGER\s+NOT NULL/i,
  );
  assert.doesNotMatch(
    migration,
    /ADD COLUMN\s+updated_by\s+INTEGER\s+NOT NULL/i,
  );

  const projects = projectTableDefinition(schema);
  assert.doesNotMatch(
    columnLine(projects, "created_by"),
    /\bNOT NULL\b/i,
  );
  assert.doesNotMatch(
    columnLine(projects, "updated_by"),
    /\bNOT NULL\b/i,
  );
});

test("migration e schema criam os índices de autoria", () => {
  for (const indexName of [
    "idx_projects_created_by",
    "idx_projects_updated_by",
  ]) {
    const pattern = new RegExp(
      `CREATE INDEX IF NOT EXISTS\\s+${indexName}\\s+ON projects`,
      "i",
    );

    assert.match(migration, pattern);
    assert.match(schema, pattern);
  }
});

test("schema canônico contém as mesmas colunas, defaults e foreign keys", () => {
  const projects = projectTableDefinition(schema);
  const normalizedProjects = normalizeSql(projects);

  assert.match(
    normalizedProjects,
    /\bcreated_by integer\b/,
  );
  assert.match(
    normalizedProjects,
    /\bcreated_by_name_snapshot text\b/,
  );
  assert.match(
    normalizedProjects,
    /\bupdated_by integer\b/,
  );
  assert.match(
    normalizedProjects,
    /\bupdated_by_name_snapshot text\b/,
  );
  assert.match(
    normalizedProjects,
    /\bmetadata_version integer not null default 1\b/,
  );

  assert.match(
    normalizedProjects,
    /foreign key \(created_by\) references users\(id\) on delete set null/,
  );
  assert.match(
    normalizedProjects,
    /foreign key \(updated_by\) references users\(id\) on delete set null/,
  );
});

test("metadata_version começa em 1 no schema e na migration", () => {
  assert.match(
    migration,
    /metadata_version\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i,
  );

  const projects = projectTableDefinition(schema);
  assert.match(
    columnLine(projects, "metadata_version"),
    /^metadata_version INTEGER NOT NULL DEFAULT 1$/i,
  );
});

test("backfill utiliza somente evidências de audit_logs", () => {
  assert.match(migration, /UPDATE\s+projects\s+SET\s+created_by\s*=/i);
  assert.match(migration, /FROM\s+audit_logs/i);
  assert.match(migration, /audit_logs\.project_id\s*=\s*projects\.id/i);
  assert.match(migration, /audit_logs\.user_id\s+IS NOT NULL/i);
  assert.match(migration, /admin\.projects\.create/i);
  assert.match(migration, /projects\.config\.save/i);

  assert.doesNotMatch(migration, /\borganization_users\b/i);
  assert.doesNotMatch(migration, /access_level\s*=\s*['"]owner['"]/i);
  assert.doesNotMatch(migration, /\bsessions?\b/i);
  assert.doesNotMatch(migration, /\bactive_organization_id\b/i);
});

test("projetos sem auditoria permanecem sem autoria inferida", () => {
  assert.match(
    migration,
    /WHERE\s+projects\.created_by\s+IS NULL\s+AND EXISTS/i,
  );
  assert.match(
    migration,
    /WHERE\s+projects\.updated_by\s+IS NULL\s+AND EXISTS/i,
  );
  assert.doesNotMatch(
    migration,
    /COALESCE\s*\([^)]*(owner|organization_users|session)/i,
  );
});

test("schema preserva os campos operacionais existentes do projeto", () => {
  const projects = projectTableDefinition(schema);

  for (const existingColumn of [
    "dropbox_root_path",
    "default_config_file",
    "organization_id",
    "organization_file_id",
    "active",
    "created_at",
    "updated_at",
  ]) {
    assert.match(
      projects,
      new RegExp(`\\b${existingColumn}\\b`, "i"),
      `A coluna existente ${existingColumn} não pode ser removida.`,
    );
  }
});

test("nomes das cinco colunas permanecem alinhados", () => {
  const projects = projectTableDefinition(schema);

  for (const columnName of [
    "created_by",
    "created_by_name_snapshot",
    "updated_by",
    "updated_by_name_snapshot",
    "metadata_version",
  ]) {
    assert.match(
      migration,
      new RegExp(`ADD COLUMN\\s+${columnName}\\b`, "i"),
    );
    assert.match(
      projects,
      new RegExp(`^\\s*${columnName}\\b`, "im"),
    );
  }
});
