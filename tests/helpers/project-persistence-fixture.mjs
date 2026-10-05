import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getDropboxClient } from "../../functions/_lib/dropbox-client.js";
import { dropboxContentHashHex } from "../../functions/_lib/dropbox-content-hash.js";
export function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return {
    promise,
    resolve
  };
}
export function interruption(code = "OFFLINE_INTERRUPTION") {
  return Object.assign(new Error("Controlled offline interruption"), {
    code,
    retryable: false
  });
}
export function waitForPause(entered, running) {
  return Promise.race([entered.promise, running.then(result => {
    throw result.error || new Error("Operation ended before the expected pause");
  })]);
}

// Production SQL, repositories, lifecycle and DropboxClient are not mocked.
// Only the external HTTP provider is simulated. No runtime fetch is reachable.
export function persistenceFixture(t, hooks = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../schema.sql", import.meta.url), "utf8"));
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='project_save_operation_schema'").get()) {
    db.exec(readFileSync(new URL("../../migrations/0039_project_save_operations.sql", import.meta.url), "utf8"));
  }
  db.exec(`CREATE TABLE IF NOT EXISTS app_schema_metadata (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL);
    INSERT OR REPLACE INTO app_schema_metadata(id,schema_version) VALUES(1,19);`);
  db.exec(`
    INSERT INTO users (id,email,name,role,password_hash) VALUES
      (1,'owner@offline.invalid','Offline owner','client','not-a-login'),
      (2,'other@offline.invalid','Other owner','client','not-a-login');
    INSERT INTO organizations (id,name,slug,dropbox_root_path,storage_status) VALUES
      (1,'Offline A','offline-a','/offline/a','READY'),
      (2,'Offline B','offline-b','/offline/b','READY');
    INSERT INTO organization_users (organization_id,user_id,access_level) VALUES
      (1,1,'owner'),(2,2,'owner');
  `);
  for (const [userId, organizationId] of [[1,1],[2,2]]) {
    db.prepare("INSERT INTO sessions(token_hash,user_id,active_organization_id,expires_at) VALUES(?,?,?,?)")
      .run(createHash("sha256").update(`offline-session-${userId}`).digest("hex"), userId, organizationId, "2099-01-01T00:00:00.000Z");
  }
  t.after(() => db.close());
  let queue = Promise.resolve();
  const serialize = task => { const pending = queue.then(task); queue = pending.catch(() => {}); return pending; };
  const sqlCalls = [];
  let primaryReads = 0;
  const env = {
    APP_ENV: "local",
    STORAGE_DRIVER: "dropbox",
    DROPBOX_APP_KEY: "offline-fixture", DROPBOX_APP_SECRET: "offline-fixture", DROPBOX_REFRESH_TOKEN: "offline-fixture",
    PROJECT_DURABLE_SAVE_V1: "true",
    PROJECT_QUOTA_RESERVATION_V1: "true",
    DB: {
      withSession(mode) { assert.equal(mode, "first-primary"); primaryReads += 1; return this; },
      batch(statements) {
        return serialize(async () => {
          await hooks.beforeBatch?.({db, statements});
          db.exec("BEGIN IMMEDIATE");
          let committed = false;
          try {
            const result = [];
            for (const statement of statements) result.push(await statement.execute("batch"));
            db.exec("COMMIT");
            committed = true;
            await hooks.afterBatch?.({db, statements, result});
            return result;
          } catch (error) {
            if (!committed) db.exec("ROLLBACK");
            throw error;
          }
        });
      },
      prepare(sql) {
        let args = [];
        async function execute(kind) {
          sqlCalls.push({sql, args: [...args], kind});
          await hooks.beforeSql?.({
            sql,
            args,
            kind,
            db
          });
          const stmt = db.prepare(sql);
          const value = kind === "first" ? stmt.get(...args) ?? null : kind === "all" ? {
            results: stmt.all(...args)
          } : (() => {
            const r = stmt.run(...args);
            return {
              success: true,
              meta: {
                changes: Number(r.changes),
                last_row_id: Number(r.lastInsertRowid)
              }
            };
          })();
          await hooks.afterSql?.({
            sql,
            args,
            kind,
            db,
            value
          });
          return value;
        }
        return {
          bind(...values) {
            args = values.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v);
            return this;
          },
          sql,
          execute,
          first: () => serialize(() => execute("first")),
          all: () => serialize(() => execute("all")),
          run: () => serialize(() => execute("run"))
        };
      }
    }
  };
  const objects = new Map(),
    sessions = new Map(),
    calls = [];
  let serial = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
  const missing = () => json({
    error_summary: "path/not_found/",
    error: {
      ".tag": "path",
      path: {
        ".tag": "not_found"
      }
    }
  }, 409);
  const conflict = () => json({
    error_summary: "path/conflict/file/"
  }, 409);
  async function store(path, bytes) {
    const metadata = {
      ".tag": "file",
      path_display: path,
      path_lower: path.toLowerCase(),
      name: path.split("/").at(-1),
      id: `id:offline-${++serial}`,
      rev: `rev-${serial}`,
      size: bytes.byteLength,
      content_hash: await dropboxContentHashHex(bytes)
    };
    objects.set(path, {
      bytes: bytes.slice(),
      metadata
    });
    return metadata;
  }
  const client = getDropboxClient(env);
  client.accessToken = "offline-provider-fixture-only";
  client.accessTokenExpiresAt = Number.MAX_SAFE_INTEGER;
  client.sleepFn = async () => {};
  client.metricFn = () => {};
  client.fetchFn = async (url, init) => {
    const parsed = new URL(url);
    assert.ok(["api.dropboxapi.com", "content.dropboxapi.com"].includes(parsed.host));
    if (parsed.pathname === "/oauth2/token") return json({access_token:"offline-provider-fixture-only",expires_in:86400});
    const op = parsed.pathname.replace("/2/files/", "");
    const argHeader = new Headers(init.headers).get("Dropbox-API-Arg");
    const args = JSON.parse(argHeader || init.body || "{}");
    const bytes = argHeader ? new Uint8Array(await new Response(init.body).arrayBuffer()) : new Uint8Array();
    const call = {
      op,
      args,
      bytes,
      objects,
      sessions,
      db
    };
    calls.push({
      op,
      args,
      size: bytes.byteLength
    });
    const injected = await hooks.beforeProvider?.(call);
    if (injected instanceof Response) return injected;
    let response;
    if (op === "create_folder_v2") response = json({
      metadata: {
        ".tag": "folder",
        path_display: args.path
      }
    });else if (op === "get_metadata") response = objects.has(args.path) ? json(objects.get(args.path).metadata) : missing();else if (op === "download") response = objects.has(args.path) ? new Response(objects.get(args.path).bytes.slice(), {
      headers: {
        "Content-Type": "application/json",
        "Dropbox-API-Result": JSON.stringify(objects.get(args.path).metadata)
      }
    }) : missing();else if (op === "get_temporary_link") response = objects.has(args.path) ? json({link:"https://offline.invalid/temporary-config",metadata:objects.get(args.path).metadata}) : missing();else if (op === "delete_v2") {
      const object = objects.get(args.path);
      objects.delete(args.path);
      response = object ? json({
        metadata: object.metadata
      }) : missing();
    } else if (op === "upload") {
      response = objects.has(args.path) && args.mode === "add" ? conflict() : json(await store(args.path, bytes));
    } else if (op === "upload_session/start") {
      const id = `session-${++serial}`;
      sessions.set(id, {
        parts: [bytes],
        offset: bytes.length
      });
      response = json({
        session_id: id
      });
    } else if (["upload_session/append_v2", "upload_session/finish"].includes(op)) {
      const session = sessions.get(args.cursor.session_id);
      assert.ok(session, "known offline upload session");
      if (session.offset !== args.cursor.offset) {
        response = json({
          error: {
            ".tag": "incorrect_offset",
            correct_offset: session.offset
          }
        }, 409);
      } else if (op === "upload_session/append_v2") {
        session.parts.push(bytes.slice());
        session.offset += bytes.length;
        response = json(null);
      } else if (objects.has(args.commit.path) && args.commit.mode === "add") response = conflict();else {
        assert.equal(args.commit.strict_conflict, true);
        const content = new Uint8Array(session.offset + bytes.length);
        let offset = 0;
        for (const part of [...session.parts, bytes]) {
          content.set(part, offset);
          offset += part.length;
        }
        response = json(await store(args.commit.path, content));
        session.offset += bytes.length;
      }
    } else throw interruption(`UNEXPECTED_PROVIDER_OPERATION_${op}`);
    return (await hooks.afterProvider?.({
      ...call,
      response
    })) || response;
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = client.fetchFn;
  t.after(() => { globalThis.fetch = previousFetch; });
  const user = {
    id: 1,
    name: "Offline owner",
    role: "client",
    activeOrganizationId: 1
  };
  return {
    env,
    db,
    user,
    sqlCalls,
    get primaryReads() { return primaryReads; },
    headers: (userId = 1) => ({ Cookie: `maono_session=offline-session-${userId}`, "X-Maono-Client-Contract": "2" }),
    objects,
    sessions,
    calls,
    store,
    project: (id = 1) => db.prepare("SELECT * FROM projects WHERE id = ?").get(id),
    ledger: (projectId = 1, revision = 1) => db.prepare("SELECT * FROM project_config_revisions WHERE project_id = ? AND revision = ?").get(projectId, revision)
  };
}
