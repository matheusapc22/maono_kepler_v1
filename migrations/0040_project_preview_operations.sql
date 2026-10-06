-- Independent preview journal. Requires 0039; no production apply is authorized.
-- Admission and processing are separately disabled by default in application code.
ALTER TABLE projects ADD COLUMN preview_artifact_id TEXT;
ALTER TABLE projects ADD COLUMN preview_operation_id TEXT;
ALTER TABLE projects ADD COLUMN preview_operation_epoch INTEGER NOT NULL DEFAULT 0;
CREATE TABLE project_preview_operation_schema (version INTEGER PRIMARY KEY CHECK(version = 1));
INSERT INTO project_preview_operation_schema VALUES(1);
CREATE TABLE project_preview_operations (
 id TEXT PRIMARY KEY,
 organization_id INTEGER NOT NULL,
 project_id INTEGER NOT NULL,
 actor_user_id INTEGER NOT NULL,
 operation_id TEXT NOT NULL,
 save_operation_id TEXT NOT NULL REFERENCES project_save_operations(id) ON DELETE RESTRICT,
 save_operation_key TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 config_checksum TEXT NOT NULL CHECK(length(config_checksum) = 64),
 editor_session_id TEXT NOT NULL,
 edit_generation INTEGER NOT NULL CHECK(edit_generation >= 0),
 renderer_version TEXT NOT NULL,
 image_checksum TEXT NOT NULL CHECK(length(image_checksum) = 64),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
 capture_method TEXT NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 storage_root TEXT NOT NULL,
 config_file TEXT NOT NULL,
 organization_file_id INTEGER,
 expected_artifact_id TEXT,
 project_epoch INTEGER NOT NULL CHECK(project_epoch > 0),
 storage_ref TEXT NOT NULL UNIQUE,
 storage_provider TEXT,
 storage_provider_version TEXT,
 state TEXT NOT NULL DEFAULT 'WAITING_CAPTURE' CHECK(state IN ('WAITING_CAPTURE','RECEIVING','PAYLOAD_STORED','PROCESSING','RETRY_WAIT','READY','FAILED_FINAL','SUPERSEDED')),
 lease_epoch INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT,
 lease_until INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0,
 upload_attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 payload_stored_at TEXT,
 receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
 error_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,actor_user_id,operation_id),
 CHECK(state <> 'READY' OR (receipt_json IS NOT NULL AND payload_stored_at IS NOT NULL)),
 CHECK(state NOT IN ('PAYLOAD_STORED','PROCESSING','RETRY_WAIT') OR payload_stored_at IS NOT NULL)
);
CREATE INDEX idx_project_preview_recovery ON project_preview_operations(state,next_attempt_at,lease_until);
CREATE INDEX idx_project_preview_project ON project_preview_operations(organization_id,project_id,project_epoch);
CREATE TABLE project_preview_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operation_id TEXT NOT NULL UNIQUE REFERENCES project_preview_operations(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DONE')),
 available_at INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE project_preview_transaction_guard(value INTEGER NOT NULL CHECK(value=1));
CREATE TRIGGER project_preview_guard_clean AFTER INSERT ON project_preview_transaction_guard
BEGIN DELETE FROM project_preview_transaction_guard; END;
CREATE TRIGGER project_preview_identity_immutable BEFORE UPDATE ON project_preview_operations
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.save_operation_id IS NOT OLD.save_operation_id OR NEW.save_operation_key IS NOT OLD.save_operation_key
 OR NEW.revision IS NOT OLD.revision OR NEW.config_checksum IS NOT OLD.config_checksum
 OR NEW.editor_session_id IS NOT OLD.editor_session_id OR NEW.edit_generation IS NOT OLD.edit_generation
 OR NEW.renderer_version IS NOT OLD.renderer_version OR NEW.image_checksum IS NOT OLD.image_checksum
 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.capture_method IS NOT OLD.capture_method
 OR NEW.manifest_json IS NOT OLD.manifest_json OR NEW.storage_root IS NOT OLD.storage_root
 OR NEW.config_file IS NOT OLD.config_file OR NEW.organization_file_id IS NOT OLD.organization_file_id
 OR NEW.expected_artifact_id IS NOT OLD.expected_artifact_id OR NEW.project_epoch IS NOT OLD.project_epoch
 OR NEW.storage_ref IS NOT OLD.storage_ref
BEGIN SELECT RAISE(ABORT,'PROJECT_PREVIEW_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER project_preview_terminal_immutable BEFORE UPDATE ON project_preview_operations
WHEN OLD.state IN ('READY','FAILED_FINAL','SUPERSEDED')
BEGIN SELECT RAISE(ABORT,'PROJECT_PREVIEW_TERMINAL_IMMUTABLE'); END;
CREATE TRIGGER project_preview_no_delete BEFORE DELETE ON project_preview_operations
BEGIN SELECT RAISE(ABORT,'PROJECT_PREVIEW_RECEIPT_RETAINED'); END;
-- Retain receipt and artifact identities on entity deletion. No pixel GC occurs.
CREATE TRIGGER project_preview_deleted_project BEFORE DELETE ON projects
BEGIN
 UPDATE project_preview_operations SET state='FAILED_FINAL',error_code='PROJECT_PREVIEW_PROJECT_DELETED',lease_owner=NULL,lease_until=NULL
 WHERE project_id=OLD.id AND state NOT IN ('READY','FAILED_FINAL','SUPERSEDED');
 UPDATE project_preview_outbox SET state='DONE' WHERE operation_id IN (SELECT id FROM project_preview_operations WHERE project_id=OLD.id);
END;
CREATE TRIGGER project_preview_deleted_actor BEFORE DELETE ON users
BEGIN
 UPDATE project_preview_operations SET state='FAILED_FINAL',error_code='PROJECT_PREVIEW_PERMISSION_REVOKED',lease_owner=NULL,lease_until=NULL
 WHERE actor_user_id=OLD.id AND state NOT IN ('READY','FAILED_FINAL','SUPERSEDED');
 UPDATE project_preview_outbox SET state='DONE' WHERE operation_id IN (SELECT id FROM project_preview_operations WHERE actor_user_id=OLD.id);
END;
CREATE TRIGGER project_preview_deleted_organization BEFORE DELETE ON organizations
BEGIN
 UPDATE project_preview_operations SET state='FAILED_FINAL',error_code='PROJECT_PREVIEW_PERMISSION_REVOKED',lease_owner=NULL,lease_until=NULL
 WHERE organization_id=OLD.id AND state NOT IN ('READY','FAILED_FINAL','SUPERSEDED');
 UPDATE project_preview_outbox SET state='DONE' WHERE operation_id IN (SELECT id FROM project_preview_operations WHERE organization_id=OLD.id);
END;
