import { DatabaseSync } from "node:sqlite";

export const STORAGE_COLUMNS = ["id", "name", "slug", "active", "dropbox_root_path", "storage_status", "storage_error", "storage_checked_at", "updated_at"];

// Executes production SQL against SQLite rather than implementing its semantics
// in a mock. The D1 adapter preserves async boundaries for race tests.
export function createStorageSqliteEnv(initialRows = [], { columns = STORAGE_COLUMNS } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE organizations (${columns.map((name) => `${name} ${name === "id" ? "INTEGER PRIMARY KEY" : name === "active" ? "INTEGER" : "TEXT"}`).join(",")});
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, action TEXT, details TEXT, created_at TEXT);`);
  const insert = sqlite.prepare(`INSERT INTO organizations (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  for (const row of initialRows) insert.run(...columns.map((key) => row[key] ?? null));
  const statements = [];
  return {
    DB: { prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          statements.push({ kind: "first", sql, args: values });
          const row = sqlite.prepare(sql).get(...values);
          return row ? { ...row } : null;
        },
        async all() {
          statements.push({ kind: "all", sql, args: values });
          return { success: true, results: sqlite.prepare(sql).all(...values).map((row) => ({ ...row })) };
        },
        async run() {
          statements.push({ kind: "run", sql, args: values });
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    } },
    __rows: { get(id) { const row = sqlite.prepare("SELECT * FROM organizations WHERE id = ?").get(id); return row ? { ...row } : null; } },
    __statements: statements,
    __sqlite: sqlite,
  };
}
