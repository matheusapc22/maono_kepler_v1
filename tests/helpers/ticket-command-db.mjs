import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { runTicketLegacyBackfillPage } from "../../functions/_lib/ticket-legacy-backfill.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
export const COMMAND_ACTORS = Object.freeze({
  owner: { id: 1, role: "owner", activeOrganizationId: 1 },
  peer: { id: 2, role: "owner", activeOrganizationId: 1 },
  viewer: { id: 3, role: "viewer", activeOrganizationId: 1 },
  otherOwner: { id: 4, role: "owner", activeOrganizationId: 2 },
});

/** Real SQLite/D1 adapter: executes production SQL without query-pattern mocks. */
export async function createTicketCommandDb(t, {
  commandsSchema = true, triageSchema = true, commandsEnabled = true,
  triageEnabled = true, marker = true,
} = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  t.after(() => sqlite.close());
  const schema = source("../../schema.sql");
  const ticketStart = schema.indexOf("-- Central de Chamados (migration 0010_ticket_center.sql)");
  if (ticketStart < 0) throw new Error("Fresh schema no longer identifies its Ticket section; review the upgrade fixture.");
  // Use the app's non-Ticket base tables, then the literal versioned Ticket SQL.
  // A fresh-install snapshot already containing 0026 cannot test its own upgrade.
  sqlite.exec(schema.slice(0, ticketStart));
  sqlite.exec(`
    CREATE TABLE role_permissions (
      id INTEGER PRIMARY KEY, role TEXT, permission TEXT,
      scope_type TEXT, active INTEGER DEFAULT 1,
      UNIQUE(role, permission, scope_type)
    );
    CREATE TABLE user_permissions (
      id INTEGER PRIMARY KEY, user_id INTEGER, permission TEXT,
      organization_id INTEGER, project_id INTEGER,
      expires_at TEXT, active INTEGER DEFAULT 1
    );
    INSERT INTO users (id, email, name, role, password_hash) VALUES
      (1, 'owner@cc03.test', 'Gestor A', 'owner', 'fixture'),
      (2, 'peer@cc03.test', 'Gestor B', 'owner', 'fixture'),
      (3, 'viewer@cc03.test', 'Viewer', 'viewer', 'fixture'),
      (4, 'other@cc03.test', 'Gestor de outra organização', 'owner', 'fixture');
    INSERT INTO organizations (id, name, slug, dropbox_root_path) VALUES
      (1, 'Organização A', 'org-a', '/projects/org-a'),
      (2, 'Organização B', 'org-b', '/projects/org-b');
    INSERT INTO organization_users (organization_id, user_id, access_level)
      VALUES (1, 1, 'owner'), (1, 2, 'owner'), (1, 3, 'viewer'),
        (2, 1, 'owner'), (2, 4, 'owner');
  `);
  sqlite.exec(source("../../migrations/0010_ticket_center.sql"));
  if (triageSchema) sqlite.exec(source("../../migrations/0025_ticket_triage_classification.sql"));
  sqlite.exec(source("../../migrations/0020_project_change_requests.sql"));
  if (commandsSchema) sqlite.exec(source("../../migrations/0026_ticket_command_lifecycle.sql"));

  const statements = [];
  const batches = [];
  let beforeBatch = null;
  let failureIndex = null;
  function execute(sql, args, kind) {
    statements.push({ sql, args: [...args], kind });
    const statement = sqlite.prepare(sql);
    if (kind === "first") {
      const row = statement.get(...args);
      return row ? { ...row } : null;
    }
    if (kind === "all") return { success: true, results: statement.all(...args).map((row) => ({ ...row })) };
    const results = statement.columns().length ? statement.all(...args).map((row) => ({ ...row })) : [];
    if (!statement.columns().length) statement.run(...args);
    const meta = sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
    return { success: true, results, meta: { ...meta } };
  }
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return execute(sql, args, "first"); },
        async all() { return execute(sql, args, "all"); },
        async run() { return execute(sql, args, "run"); },
        __execute() { return execute(sql, args, "run"); },
        __description() { return { sql, args: [...args] }; },
      };
    },
    async batch(batch) {
      const hook = beforeBatch;
      beforeBatch = null;
      if (hook) await hook(sqlite);
      const failAt = failureIndex;
      failureIndex = null;
      batches.push(batch.map((statement) => statement.__description()));
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        // No async boundary inside a SQLite transaction: independent D1 batches
        // are serialized, while service reads may still race before the batch.
        for (let index = 0; index < batch.length; index += 1) {
          if (index === failAt) throw new Error(`FIXTURE_STATEMENT_FAILURE_${index}`);
          results.push(batch[index].__execute());
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    DB, MAONO_TICKET_TRIAGE_ENABLED: String(triageEnabled),
    MAONO_TICKET_COMMANDS_ENABLED: String(commandsEnabled),
  };
  const fixture = {
    env, sqlite, statements, batches,
    beforeNextBatch(callback) { beforeBatch = callback; },
    failNextBatchAt(index) { failureIndex = index; },
    row(id) { const row = sqlite.prepare("SELECT * FROM organization_tickets WHERE id = ?").get(id); return row ? { ...row } : null; },
    rows(table) { return sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map((row) => ({ ...row })); },
    snapshot() {
      return Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({ name }) => [name, fixture.rows(name)]));
    },
    sessionCookie(userId = 1, organizationId = 1) {
      const token = `cc03-local-${randomUUID()}`;
      sqlite.prepare("INSERT INTO sessions (user_id, token_hash, active_organization_id, expires_at) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')")
        .run(userId, createHash("sha256").update(token).digest("hex"), organizationId);
      return `maono_session=${token}`;
    },
    async ready(organizationId = 1) {
      return runTicketLegacyBackfillPage(env, { organizationId, operatorUserId: organizationId === 1 ? 1 : 4, pageSize: 50 });
    },
    createLegacySource() {
      sqlite.exec(`CREATE TABLE tickets (
        id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL,
        subject TEXT, description TEXT, status TEXT, priority TEXT, category TEXT,
        created_by INTEGER, assigned_to INTEGER, due_at TEXT, closed_at TEXT,
        created_at TEXT, updated_at TEXT, active INTEGER DEFAULT 1
      )`);
    },
  };
  if (commandsSchema && marker) {
    await fixture.ready(1);
    await fixture.ready(2);
  }
  return fixture;
}
