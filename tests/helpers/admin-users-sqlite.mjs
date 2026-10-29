import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sha256Hex } from '../../functions/_lib/auth.js';

// Real SQL and route code; only D1's asynchronous interface is adapted locally.
export async function adminUsersFixture(t, { schemaSql } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql ?? readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS user_permissions (id INTEGER PRIMARY KEY, user_id INTEGER, organization_id INTEGER, permission TEXT, active INTEGER DEFAULT 1, expires_at TEXT);
    INSERT INTO organizations (id,name,slug,dropbox_root_path) VALUES (1,'Synthetic A','synthetic-a','/synthetic-a'),(2,'Synthetic B','synthetic-b','/synthetic-b');
    INSERT INTO users (id,email,role,password_hash) VALUES (1,'actor@example.test','super_admin','synthetic'),(2,'a@example.test','viewer','synthetic'),(3,'b@example.test','viewer','synthetic');
    INSERT INTO organization_users (id,organization_id,user_id,access_level) VALUES (2,1,2,'owner'),(3,1,3,'owner');
    INSERT INTO user_permissions (user_id,organization_id,permission) VALUES (2,1,'document.view'),(3,1,'document.view');`);
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,1,?)').run(await sha256Hex('synthetic-admin'), new Date(Date.now()+3600000).toISOString());
  t.after(() => db.close());
  let writeGate = async () => {};
  const env = { DB: {
    prepare(sql) {
      let args = [];
      const execute = () => {
        const results = db.prepare(sql).all(...args).map(row => ({ ...row }));
        return { success: true, results, meta: { ...db.prepare('SELECT changes() AS changes').get() } };
      };
      return { sql, bind(...values) { args = values; return this; }, async first() { if (/^(UPDATE|DELETE FROM|INSERT INTO) organization_users/.test(sql.trim())) await writeGate(); return execute().results[0] ?? null; }, async all() { return execute(); }, async run() { if (/^(UPDATE|DELETE FROM|INSERT INTO) organization_users/.test(sql.trim())) await writeGate(); return execute(); }, execute };
    },
    async batch(statements) {
      if (statements.some(statement => /(?:UPDATE|DELETE FROM) "?(?:organization_users|users)\b/.test(statement.sql))) await writeGate();
      db.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } };
  const request = (method, body) => new Request('https://synthetic.invalid/api/admin/users', {
    method, headers: { Cookie: 'maono_session=synthetic-admin', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const owners = () => db.prepare("SELECT COUNT(*) n FROM organization_users WHERE organization_id=1 AND access_level='owner'").get().n;
  const holdConcurrentWrites = () => {
    let arrivals = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    writeGate = async () => { if (++arrivals === 2) release(); await barrier; };
  };
  return { db, env, request, owners, holdConcurrentWrites };
}
