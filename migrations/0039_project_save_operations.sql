-- Durable project saves, additive capability; schema_versions remains at 19.
-- PRECONDITIONS: 0018, 0019, 0020, 0031. Optional permission tables are expanded below.
-- No production apply is authorized by this file. Use the protected migration operator.
PRAGMA foreign_keys = ON;

-- Historical installs may omit optional ACL grant tables. Empty tables preserve
-- native policy defaults and let every future grant/revocation be fenced.
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, permission TEXT NOT NULL,
  scope_type TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(role, permission, scope_type)
);
CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL, organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE project_save_operation_schema (
  version INTEGER PRIMARY KEY CHECK (version = 1),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO project_save_operation_schema(version) VALUES (1);

-- Revalidation reads this BEFORE reading ACLs. A transaction may commit only if
-- this generation is unchanged. This closes revocation races without copying
-- the application's policy into a second, divergent SQL implementation.
CREATE TABLE project_save_authorization_generation (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO project_save_authorization_generation(id) VALUES (1);

-- Scope/target IDs are durable logical identity, deliberately not cascading
-- entity FKs: normal admin deletion must leave an old ID reserved. Admission and
-- publication verify live entities; deletion triggers stop unfinished work.
CREATE TABLE project_save_operations (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 12 AND 128),
  project_id INTEGER,
  target_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('update','legacy-promotion','create','change-request')),
  expected_config_revision INTEGER NOT NULL CHECK (expected_config_revision >= 0),
  manifest_fingerprint TEXT NOT NULL CHECK (length(manifest_fingerprint) = 64),
  checksum_algorithm TEXT NOT NULL CHECK (checksum_algorithm IN ('sha256','dropbox-content-hash')),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
  serialization_version INTEGER NOT NULL CHECK (serialization_version = 1),
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  content_type TEXT NOT NULL,
  config_version TEXT,
  dataset_count INTEGER CHECK (dataset_count IS NULL OR dataset_count >= 0),
  domain_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(domain_json)),
  reservation_id INTEGER,
  quota_reservation_id INTEGER,
  state TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD' CHECK (state IN (
    'AWAITING_UPLOAD','RECEIVING','PAYLOAD_STORED','PROCESSING','RETRY_WAIT','PUBLISHED','CONFLICT','FAILED_FINAL'
  )),
  stage TEXT NOT NULL DEFAULT 'REGISTERED',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  upload_epoch INTEGER NOT NULL DEFAULT 0 CHECK (upload_epoch >= 0),
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_owner TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  upload_attempts INTEGER NOT NULL DEFAULT 0 CHECK (upload_attempts >= 0),
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  storage_provider TEXT,
  storage_ref TEXT UNIQUE,
  storage_provider_version TEXT,
  storage_provider_hash TEXT,
  payload_stored_at TEXT,
  receipt_json TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
  committed_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, actor_user_id, operation_id),
  CHECK (project_id IS NOT NULL OR kind = 'create'),
  CHECK (state <> 'PUBLISHED' OR (receipt_json IS NOT NULL AND committed_at IS NOT NULL AND storage_ref IS NOT NULL)),
  CHECK (state NOT IN ('PAYLOAD_STORED','PROCESSING') OR (storage_ref IS NOT NULL AND payload_stored_at IS NOT NULL))
);
CREATE INDEX idx_project_save_pending ON project_save_operations(state, next_attempt_at, lease_until, id);
CREATE INDEX idx_project_save_project ON project_save_operations(project_id, actor_user_id, created_at);

CREATE TABLE project_save_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL REFERENCES project_save_operations(id) ON DELETE RESTRICT,
  effect TEXT NOT NULL CHECK (effect IN ('PROCESS','AUDIT')),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','DONE','FAILED_FINAL')),
  available_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (operation_id, effect)
);
CREATE INDEX idx_project_save_outbox_ready ON project_save_outbox(state, effect, available_at, id);
ALTER TABLE project_config_revisions ADD COLUMN save_operation_id TEXT REFERENCES project_save_operations(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX idx_project_config_revision_save_operation ON project_config_revisions(save_operation_id) WHERE save_operation_id IS NOT NULL;

-- Batch guards turn a zero-row CAS into an SQL error, rolling back the entire
-- D1 transaction. They never survive a successful statement.
CREATE TABLE project_save_transaction_guard (value INTEGER NOT NULL CHECK (value = 1));
CREATE TRIGGER project_save_transaction_guard_clean AFTER INSERT ON project_save_transaction_guard
BEGIN DELETE FROM project_save_transaction_guard; END;

CREATE TRIGGER project_save_operation_identity_immutable BEFORE UPDATE ON project_save_operations
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.target_key IS NOT OLD.target_key OR NEW.kind IS NOT OLD.kind
 OR NEW.expected_config_revision IS NOT OLD.expected_config_revision
 OR NEW.manifest_fingerprint IS NOT OLD.manifest_fingerprint
 OR NEW.checksum_algorithm IS NOT OLD.checksum_algorithm OR NEW.checksum IS NOT OLD.checksum
 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.serialization_version IS NOT OLD.serialization_version
 OR NEW.schema_name IS NOT OLD.schema_name OR NEW.schema_version IS NOT OLD.schema_version
 OR NEW.content_type IS NOT OLD.content_type OR NEW.config_version IS NOT OLD.config_version
 OR NEW.dataset_count IS NOT OLD.dataset_count OR NEW.domain_json IS NOT OLD.domain_json
 OR (OLD.project_id IS NOT NULL AND NEW.project_id IS NOT OLD.project_id)
 OR (OLD.reservation_id IS NOT NULL AND NEW.reservation_id IS NOT OLD.reservation_id)
 OR (OLD.quota_reservation_id IS NOT NULL AND NEW.quota_reservation_id IS NOT OLD.quota_reservation_id)
BEGIN SELECT RAISE(ABORT, 'PROJECT_SAVE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER project_save_operation_terminal_immutable BEFORE UPDATE ON project_save_operations
WHEN OLD.state IN ('PUBLISHED','CONFLICT','FAILED_FINAL')
BEGIN SELECT RAISE(ABORT, 'PROJECT_SAVE_TERMINAL_IMMUTABLE'); END;
-- Keep scoped IDs permanently reserved until an explicitly reviewed retention
-- migration replaces receipts with durable tombstones. No automatic GC.
CREATE TRIGGER project_save_operation_no_delete BEFORE DELETE ON project_save_operations
BEGIN SELECT RAISE(ABORT, 'PROJECT_SAVE_RECEIPT_RETAINED'); END;

CREATE TRIGGER project_save_auth_users_insert AFTER INSERT ON users
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_users_update AFTER UPDATE ON users
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_users_delete AFTER DELETE ON users
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_organizations_insert AFTER INSERT ON organizations
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_organizations_update AFTER UPDATE ON organizations
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_organizations_delete AFTER DELETE ON organizations
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_organization_users_insert AFTER INSERT ON organization_users
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_organization_users_update AFTER UPDATE ON organization_users
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_organization_users_delete AFTER DELETE ON organization_users
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_projects_insert AFTER INSERT ON user_projects
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_projects_update AFTER UPDATE ON user_projects
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_projects_delete AFTER DELETE ON user_projects
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_permissions_insert AFTER INSERT ON user_permissions
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_permissions_update AFTER UPDATE ON user_permissions
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_permissions_delete AFTER DELETE ON user_permissions
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_permission_denials_insert AFTER INSERT ON user_permission_denials
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_permission_denials_update AFTER UPDATE ON user_permission_denials
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_user_permission_denials_delete AFTER DELETE ON user_permission_denials
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_role_permissions_insert AFTER INSERT ON role_permissions
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_role_permissions_update AFTER UPDATE ON role_permissions
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

CREATE TRIGGER project_save_auth_role_permissions_delete AFTER DELETE ON role_permissions
BEGIN UPDATE project_save_authorization_generation SET version = version + 1 WHERE id = 1; END;

-- Deletions preserve receipts/tombstones and cannot leave pending work publishing.
CREATE TRIGGER project_save_deleted_projects BEFORE DELETE ON projects
BEGIN
 UPDATE project_save_operations SET state = 'FAILED_FINAL', stage = 'TERMINAL',
   error_code = 'PROJECT_SAVE_PROJECT_DELETED', lease_owner = NULL, lease_until = NULL,
   version = version + 1, updated_at = CURRENT_TIMESTAMP
   WHERE project_id = OLD.id AND state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL');
 UPDATE project_save_outbox SET state = 'DONE', updated_at = CURRENT_TIMESTAMP
   WHERE effect = 'PROCESS' AND operation_id IN
     (SELECT id FROM project_save_operations WHERE project_id = OLD.id);
END;
CREATE TRIGGER project_save_deleted_users BEFORE DELETE ON users
BEGIN
 UPDATE project_save_operations SET state = 'FAILED_FINAL', stage = 'TERMINAL',
   error_code = 'PROJECT_SAVE_ACTOR_DELETED', lease_owner = NULL, lease_until = NULL,
   version = version + 1, updated_at = CURRENT_TIMESTAMP
   WHERE actor_user_id = OLD.id AND state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL');
 UPDATE project_save_outbox SET state = 'DONE', updated_at = CURRENT_TIMESTAMP
   WHERE effect = 'PROCESS' AND operation_id IN
     (SELECT id FROM project_save_operations WHERE actor_user_id = OLD.id);
END;
CREATE TRIGGER project_save_deleted_organizations BEFORE DELETE ON organizations
BEGIN
 UPDATE project_save_operations SET state = 'FAILED_FINAL', stage = 'TERMINAL',
   error_code = 'PROJECT_SAVE_ORGANIZATION_DELETED', lease_owner = NULL, lease_until = NULL,
   version = version + 1, updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = OLD.id AND state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL');
 UPDATE project_save_outbox SET state = 'DONE', updated_at = CURRENT_TIMESTAMP
   WHERE effect = 'PROCESS' AND operation_id IN
     (SELECT id FROM project_save_operations WHERE organization_id = OLD.id);
END;

-- Old in-flight callbacks may still address a numeric revision. Once linked to
-- a durable operation its published artifact cannot be rewritten by that path.
CREATE TRIGGER project_save_revision_immutable BEFORE UPDATE ON project_config_revisions
WHEN OLD.save_operation_id IS NOT NULL AND (
 NEW.project_id IS NOT OLD.project_id OR NEW.revision IS NOT OLD.revision
 OR NEW.status IS NOT OLD.status OR NEW.checksum_algorithm IS NOT OLD.checksum_algorithm
 OR NEW.checksum IS NOT OLD.checksum OR NEW.storage_provider IS NOT OLD.storage_provider
 OR NEW.storage_ref IS NOT OLD.storage_ref OR NEW.storage_provider_version IS NOT OLD.storage_provider_version
 OR NEW.storage_provider_hash IS NOT OLD.storage_provider_hash OR NEW.schema_name IS NOT OLD.schema_name
 OR NEW.schema_version IS NOT OLD.schema_version OR NEW.size_bytes IS NOT OLD.size_bytes
 OR NEW.content_type IS NOT OLD.content_type OR NEW.transition_id IS NOT OLD.transition_id
 OR NEW.attempts IS NOT OLD.attempts OR NEW.published_at IS NOT OLD.published_at
 OR NEW.save_operation_id IS NOT OLD.save_operation_id)
BEGIN SELECT RAISE(ABORT, 'PROJECT_SAVE_REVISION_IMMUTABLE'); END;
CREATE TRIGGER project_save_revision_no_direct_delete BEFORE DELETE ON project_config_revisions
WHEN OLD.save_operation_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'PROJECT_SAVE_REVISION_IMMUTABLE'); END;

-- Every terminal apply failure, including entity-deletion triggers, closes the
-- exact applying domain state. Deleting the executing actor records a system
-- transition (NULL actor), so the new journal row does not prevent that deletion.
CREATE TRIGGER project_save_failed_change_domain AFTER UPDATE OF state ON project_save_operations
WHEN NEW.kind = 'change-request' AND NEW.state IN ('CONFLICT','FAILED_FINAL')
 AND OLD.state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL')
BEGIN
 UPDATE project_change_requests SET status = 'conflict', lifecycle_version = lifecycle_version + 1,
   transition_actor_user_id = CASE WHEN NEW.error_code = 'PROJECT_SAVE_ACTOR_DELETED' THEN NULL ELSE NEW.actor_user_id END,
   updated_at = CURRENT_TIMESTAMP
 WHERE id = json_extract(NEW.domain_json, '$.changeRequestId')
   AND organization_id = NEW.organization_id AND project_id = NEW.project_id
   AND base_revision = NEW.expected_config_revision AND status = 'applying'
   AND lifecycle_version = json_extract(NEW.domain_json, '$.changeRequestVersion');
END;
