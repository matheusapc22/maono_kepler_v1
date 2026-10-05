import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { registerProjectSaveOperation, acquireProjectSaveUpload, markProjectSavePayloadStored, processProjectSaveOperation } from '../../functions/_lib/project-save-operations.js';
const migration = readFileSync(new URL('../../migrations/0039_project_save_operations.sql', import.meta.url), 'utf8');
export function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  const baseSchema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').split('-- Durable project saving (migration 0039_project_save_operations.sql).')[0];
  sqlite.exec(baseSchema);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS role_permissions(id INTEGER PRIMARY KEY, role TEXT, permission TEXT, scope_type TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS user_permissions(id INTEGER PRIMARY KEY, user_id INTEGER, permission TEXT, organization_id INTEGER, project_id INTEGER, expires_at TEXT, active INTEGER DEFAULT 1);`);
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'project_save_operations'").get()) sqlite.exec(migration);
  sqlite.exec(`INSERT INTO users(id,email,name,role,password_hash) VALUES (1,'owner@save.invalid','Owner','owner','no-secret'),
    (2,'editor@save.invalid','Editor','editor','no-secret'),(3,'viewer@save.invalid','Viewer','viewer','no-secret');
    INSERT INTO organizations(id,name,slug,dropbox_root_path,storage_status) VALUES (1,'A','a','/a','READY'),(2,'B','b','/b','READY');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,1,'owner'),(1,2,'editor'),(1,3,'viewer'),(2,1,'owner');
    INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,lifecycle_state,lifecycle_version,active,created_by)
      VALUES (1,'Map','map',1,'/a/map','ACTIVE',1,1,1),(2,'Other','other',2,'/b/other','ACTIVE',1,1,1);
    INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,1,'owner'),(2,1,'editor'),(3,1,'viewer'),(1,2,'owner');`);
  let beforeBatch = null, failAt = null;
  const batches = [];
  const DB = {
    prepare(sql) {
      let values = [];
      const execute = kind => {
        const stmt = sqlite.prepare(sql);
        if (kind === 'first') return stmt.get(...values) ?? null;
        if (kind === 'all') return { results: stmt.all(...values) };
        const results = stmt.columns().length ? stmt.all(...values) : [];
        if (!stmt.columns().length) stmt.run(...values);
        return { success: true, results, meta: { ...sqlite.prepare('SELECT changes() AS changes').get() } };
      };
      return { bind(...args) { values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; }, async first() { return execute('first'); },
        async all() { return execute('all'); }, async run() { return execute('run'); }, execute, sql };
    },
    async batch(statements) {
      const hook = beforeBatch; beforeBatch = null;
      if (hook) await hook(sqlite, statements);
      const failure = failAt; failAt = null;
      batches.push(statements.map(statement => statement.sql));
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map((statement, index) => {
          if (index === failure) throw new Error('INJECTED_BATCH_FAILURE');
          return statement.execute('run');
        });
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  t.after(() => sqlite.close());
  return { sqlite, batches, env: { DB, PROJECT_DURABLE_SAVE_V1: 'true' }, actor: { id: 1 },
    row(sql, ...values) { return sqlite.prepare(sql).get(...values); },
    project(id = 1) { return sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(id); },
    beforeBatch(callback) { beforeBatch = callback; }, failAt(index) { failAt = index; } };
}
export const manifest = (value = 'a') => ({ checksumAlgorithm: 'dropbox-content-hash', checksum: value.repeat(64), sizeBytes: 100,
  serializationVersion: 1, configVersion: 'v1', datasetCount: 1 });
export const register = (f, operationId = 'operation-save-0001', extras = {}) => registerProjectSaveOperation(f.env,
  { organizationId: 1, actor: f.actor, project: f.project(), operationId, kind: 'update', expectedConfigRevision: 0, manifest: manifest(), ...extras });
export function artifact(operation) {
  return { contentVerified: true, checksumAlgorithm: operation.checksum_algorithm, checksum: operation.checksum,
    sizeBytes: operation.size_bytes, storageProvider: 'dropbox', storageProviderVersion: 'version-1', storageProviderHash: operation.checksum,
    storageRef: `project-config://organizations/${operation.organization_id}/projects/${operation.project_id}/operations/${operation.id}/uploads/${operation.upload_epoch}` };
}
export const verify = async (_env, { operation }) => ({ ...artifact(operation), storageRef: operation.storage_ref });
export async function stored(f, id, extras) {
  const op = await register(f, id, extras);
  const upload = await acquireProjectSaveUpload(f.env, { operation: op });
  return markProjectSavePayloadStored(f.env, { operation: upload, artifact: artifact(upload) });
}
export const process = (f, operation, extras = {}) => processProjectSaveOperation(f.env, { operation, verifyPayload: verify, ...extras });
export const count = (f, table) => f.row(`SELECT COUNT(*) AS n FROM ${table}`).n;


export function localStorage(f) {
  f.env.APP_ENV = 'local';
  f.env.STORAGE_DRIVER = 'local-d1';
  f.sqlite.exec(`CREATE TABLE IF NOT EXISTS local_storage_objects(path TEXT PRIMARY KEY,content BLOB NOT NULL,
    content_type TEXT,size_bytes INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  return f;
}
export async function storeConfig(f, config, operationId, extras = {}) {
  const { dropboxContentHashHex } = await import('../../functions/_lib/dropbox-content-hash.js');
  const { uploadProjectSaveOperationPayload } = await import('../../functions/_lib/project-save-operation-payload.js');
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  const operation = await register(f, operationId, { expectedConfigRevision: f.project().config_revision,
    manifest: { checksumAlgorithm: 'dropbox-content-hash', checksum: await dropboxContentHashHex(bytes), sizeBytes: bytes.byteLength,
      serializationVersion: 1, configVersion: config.version, datasetCount: config.datasets.length }, ...extras });
  const upload = await acquireProjectSaveUpload(f.env, { operation });
  const artifact = await uploadProjectSaveOperationPayload(f.env, { project: f.project(), operation: upload, body: bytes });
  return markProjectSavePayloadStored(f.env, { operation: upload, artifact });
}
