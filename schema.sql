-- Schema inicial da plataforma Maono Maps
-- Cloudflare D1 / SQLite

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  active_organization_id INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (active_organization_id) REFERENCES organizations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  dropbox_root_path TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  storage_status TEXT NOT NULL DEFAULT 'PENDING',
  storage_error TEXT,
  storage_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Governança de acessos adicionais delegados por organização
CREATE TABLE IF NOT EXISTS organization_access_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  delegate_user_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  granted_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, delegate_user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (delegate_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS delegation_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  can_grant INTEGER NOT NULL DEFAULT 0 CHECK (can_grant IN (0, 1)),
  can_revoke INTEGER NOT NULL DEFAULT 0 CHECK (can_revoke IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (delegation_id, permission),
  FOREIGN KEY (delegation_id) REFERENCES organization_access_delegations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delegation_target_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('viewer', 'editor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (delegation_id, access_level),
  FOREIGN KEY (delegation_id) REFERENCES organization_access_delegations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_permission_denials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  permission TEXT NOT NULL CHECK (length(permission) BETWEEN 1 AND 120),
  denied_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, organization_id, permission),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (denied_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organization_file_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  parent_id INTEGER,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE (id, organization_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id, organization_id)
    REFERENCES organization_file_folders(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS organization_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER,
  project_id INTEGER,
  name TEXT NOT NULL,
  original_name TEXT,
  file_name TEXT NOT NULL,
  dropbox_path TEXT NOT NULL UNIQUE,
  dropbox_file_id TEXT,
  dropbox_rev TEXT,
  file_type TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  error_message TEXT,
  idempotency_key TEXT,
  uploaded_by INTEGER,
  folder_id INTEGER,
  is_project INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  deleted_by INTEGER,
  purge_after TEXT,
  trashed_from_folder_id INTEGER,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (folder_id) REFERENCES organization_file_folders(id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (trashed_from_folder_id) REFERENCES organization_file_folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  dropbox_root_path TEXT NOT NULL,
  default_config_file TEXT NOT NULL DEFAULT 'config.kepler.json',
  organization_id INTEGER,
  organization_file_id INTEGER,
  created_by INTEGER,
  created_by_name_snapshot TEXT,
  updated_by INTEGER,
  updated_by_name_snapshot TEXT,
  metadata_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  config_revision INTEGER NOT NULL DEFAULT 0 CHECK (config_revision >= 0),
  config_checksum TEXT,
  config_checksum_algorithm TEXT,
  config_storage_provider TEXT,
  config_storage_ref TEXT,
  config_storage_provider_version TEXT,
  config_storage_provider_hash TEXT,
  config_schema TEXT,
  config_schema_version INTEGER
    CHECK (config_schema_version IS NULL OR config_schema_version > 0),
  config_size_bytes INTEGER
    CHECK (config_size_bytes IS NULL OR config_size_bytes >= 0),
  config_content_type TEXT,
  lifecycle_state TEXT
    CHECK (
      lifecycle_state IS NULL OR
      lifecycle_state IN (
        'DRAFT',
        'PREPARING_STORAGE',
        'CONFIG_READY',
        'ACTIVE',
        'FAILED'
      )
    ),
  lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0),
  lifecycle_updated_at TEXT,
  lifecycle_failure_stage TEXT,
  lifecycle_failure_code TEXT,
  lifecycle_failure_at TEXT,
  lifecycle_attempts INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_attempts >= 0),
  lifecycle_retryable INTEGER
    CHECK (lifecycle_retryable IS NULL OR lifecycle_retryable IN (0, 1)),
  lifecycle_transition_id TEXT,
  preview_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (preview_status IN ('UNKNOWN', 'PENDING', 'READY', 'FAILED', 'MISSING')),
  preview_revision INTEGER CHECK (preview_revision IS NULL OR preview_revision >= 0),
  preview_updated_at TEXT,
  preview_attempts INTEGER NOT NULL DEFAULT 0 CHECK (preview_attempts >= 0),
  preview_last_error TEXT,
  preview_capture_method TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (organization_file_id) REFERENCES organization_files(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_preview_status_org
ON projects (preview_status, organization_id, id);

CREATE INDEX IF NOT EXISTS idx_projects_preview_revision
ON projects (id, config_revision, preview_revision);

CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_state_org
ON projects (lifecycle_state, organization_id, id);

CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_updated
ON projects (lifecycle_state, lifecycle_updated_at);

CREATE TABLE IF NOT EXISTS project_config_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'WRITING'
    CHECK (status IN ('WRITING', 'READY', 'FAILED')),
  checksum_algorithm TEXT NOT NULL,
  checksum TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  storage_provider_version TEXT,
  storage_provider_hash TEXT,
  schema_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  content_type TEXT NOT NULL,
  created_by INTEGER,
  transition_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  published_at TEXT,
  error_code TEXT,
  error_stage TEXT,
  UNIQUE (project_id, revision),
  UNIQUE (storage_ref),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_project_config_revisions_project_status
ON project_config_revisions (project_id, status, revision DESC);

CREATE INDEX IF NOT EXISTS idx_project_config_revisions_checksum
ON project_config_revisions (project_id, checksum_algorithm, checksum);

CREATE TABLE IF NOT EXISTS user_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, project_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Reserva de capacidade para criação idempotente de projetos.
-- O painel é sempre derivado de permissões e não requer coluna persistida.
CREATE TABLE IF NOT EXISTS organization_resource_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('project')),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 12 AND 128),
  project_id INTEGER,
  actor_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (
      status IN (
        'RESERVED',
        'PROCESSING',
        'COMMITTED',
        'RELEASED',
        'FAILED',
        'EXPIRED'
      )
    ),
  expires_at TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, resource_type, idempotency_key),
  FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id)
    REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resource_reservations_org_status
ON organization_resource_reservations (
  organization_id,
  resource_type,
  status,
  expires_at
);

CREATE INDEX IF NOT EXISTS idx_resource_reservations_project
ON organization_resource_reservations (project_id);

CREATE INDEX IF NOT EXISTS idx_resource_reservations_expiration
ON organization_resource_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS map_analysis_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  analysis_type TEXT NOT NULL
    CHECK (analysis_type IN ('isochrone')),
  bucket_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1
    CHECK (request_count >= 1),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  UNIQUE (
    user_id,
    organization_id,
    analysis_type,
    bucket_started_at
  )
);

CREATE INDEX IF NOT EXISTS idx_map_analysis_rate_limits_expiration
ON map_analysis_rate_limits (expires_at);

CREATE INDEX IF NOT EXISTS idx_map_analysis_rate_limits_org_type
ON map_analysis_rate_limits (
  organization_id,
  analysis_type,
  bucket_started_at
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  project_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_organization_id ON sessions(active_organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(active);
CREATE INDEX IF NOT EXISTS idx_organizations_storage_status ON organizations(storage_status);
CREATE INDEX IF NOT EXISTS idx_organization_users_org_id ON organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_users_user_id ON organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_access_delegations_org ON organization_access_delegations(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_delegations_delegate ON organization_access_delegations(delegate_user_id);
CREATE INDEX IF NOT EXISTS idx_access_delegations_enabled ON organization_access_delegations(organization_id, enabled, expires_at);
CREATE INDEX IF NOT EXISTS idx_delegation_permissions_delegation ON delegation_permissions(delegation_id);
CREATE INDEX IF NOT EXISTS idx_delegation_target_levels_delegation ON delegation_target_levels(delegation_id);
CREATE INDEX IF NOT EXISTS idx_user_permission_denials_user_org ON user_permission_denials(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_user_permission_denials_org_permission ON user_permission_denials(organization_id, permission);
CREATE INDEX IF NOT EXISTS idx_organization_file_folders_org_parent
  ON organization_file_folders(organization_id, parent_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_file_folders_sibling_name
  ON organization_file_folders(
    organization_id,
    COALESCE(parent_id, 0),
    LOWER(TRIM(name))
  )
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organization_files_org_id ON organization_files(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_files_project_id ON organization_files(project_id);
CREATE INDEX IF NOT EXISTS idx_organization_files_dropbox_path ON organization_files(dropbox_path);
CREATE INDEX IF NOT EXISTS idx_organization_files_file_type ON organization_files(file_type);
CREATE INDEX IF NOT EXISTS idx_organization_files_status ON organization_files(status);
CREATE INDEX IF NOT EXISTS idx_organization_files_uploaded_by ON organization_files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_organization_files_deleted_at ON organization_files(deleted_at);
CREATE INDEX IF NOT EXISTS idx_organization_files_folder
  ON organization_files(organization_id, folder_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_organization_files_purge_queue
  ON organization_files(purge_after, purged_at)
  WHERE purge_after IS NOT NULL AND purged_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_files_idempotency
  ON organization_files(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_organization_file_id ON projects(organization_file_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_updated_by ON projects(updated_by);
CREATE INDEX IF NOT EXISTS idx_user_projects_user_id ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project_id ON user_projects(project_id);

-- Central de Chamados (migration 0010_ticket_center.sql)
CREATE TABLE IF NOT EXISTS organization_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  legacy_ticket_id INTEGER,
  code TEXT UNIQUE,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'open', 'in_progress', 'in_review', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  category TEXT NOT NULL DEFAULT 'support'
    CHECK (category IN ('map', 'database', 'permission', 'export', 'support', 'other')),
  visibility TEXT NOT NULL DEFAULT 'organization'
    CHECK (visibility IN ('organization', 'private')),
  demand_nature TEXT
    CHECK (demand_nature IS NULL OR demand_nature IN
      ('question_request', 'incident', 'defect', 'improvement_change', 'recurring_problem')),
  expected_result TEXT NOT NULL DEFAULT ''
    CHECK (length(expected_result) <= 2000),
  context TEXT NOT NULL DEFAULT ''
    CHECK (length(context) <= 2000),
  impact TEXT
    CHECK (impact IS NULL OR impact IN ('individual', 'team', 'organization')),
  urgency TEXT
    CHECK (urgency IS NULL OR urgency IN ('flexible', 'soon', 'blocked')),
  priority_reason TEXT NOT NULL DEFAULT ''
    CHECK (length(priority_reason) <= 1000),
  triage_answers TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(triage_answers) AND json_type(triage_answers) = 'object'
      AND length(triage_answers) <= 14000),
  triage_form_version INTEGER
    CHECK (triage_form_version IS NULL OR triage_form_version = 1),
  triage_source TEXT NOT NULL DEFAULT 'legacy'
    CHECK ((triage_source = 'legacy' AND demand_nature IS NULL) OR
      (triage_source = 'human' AND demand_nature IS NOT NULL
        AND length(trim(expected_result)) > 0 AND impact IS NOT NULL
        AND urgency IS NOT NULL AND triage_form_version = 1)),
  triaged_at TEXT,
  triaged_by INTEGER
    REFERENCES users(id) ON DELETE SET NULL,
  assigned_to INTEGER,
  due_at TEXT,
  closed_at TEXT,
  created_by INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_command_id TEXT,
  current_cycle_number INTEGER NOT NULL DEFAULT 0 CHECK (current_cycle_number >= 0),
  current_cycle_json TEXT CHECK (current_cycle_json IS NULL OR (json_valid(current_cycle_json) AND json_type(current_cycle_json) = 'object')),
  active_wait_json TEXT CHECK (active_wait_json IS NULL OR (json_valid(active_wait_json) AND json_type(active_wait_json) = 'object')),
  closure_json TEXT CHECK (closure_json IS NULL OR (json_valid(closure_json) AND json_type(closure_json) = 'object')),
  next_action TEXT NOT NULL DEFAULT '' CHECK (length(next_action) <= 1000),
  tombstoned_at TEXT,
  UNIQUE (organization_id, legacy_ticket_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED', 'DELETED')),
  uploaded_by INTEGER NOT NULL,
  dropbox_file_id TEXT,
  dropbox_rev TEXT,
  error_message TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES organization_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  command_id TEXT,
  entity_version INTEGER CHECK (entity_version IS NULL OR entity_version >= 1),
  corrects_event_id INTEGER REFERENCES ticket_events(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES organization_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_tickets_org_status
  ON organization_tickets(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_org_due
  ON organization_tickets(organization_id, due_at);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_updated
  ON organization_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_assignee
  ON organization_tickets(organization_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_triage
  ON organization_tickets(organization_id, demand_nature, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_scope
  ON ticket_attachments(organization_id, ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_uploaded_by
  ON ticket_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_ticket_events_scope
  ON ticket_events(organization_id, ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON audit_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

CREATE TRIGGER IF NOT EXISTS trg_user_permission_denials_membership_removed
AFTER DELETE ON organization_users
FOR EACH ROW
BEGIN
  DELETE FROM user_permission_denials
  WHERE user_id = OLD.user_id
    AND organization_id = OLD.organization_id;
END;


CREATE TRIGGER IF NOT EXISTS trg_document_folder_parent_scope_insert
BEFORE INSERT ON organization_file_folders
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders parent
      WHERE parent.id = NEW.parent_id
        AND parent.organization_id = NEW.organization_id
        AND parent.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_document_folder_parent_scope_update
BEFORE UPDATE OF parent_id, organization_id ON organization_file_folders
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.parent_id = NEW.id
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_SELF_PARENT')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders parent
      WHERE parent.id = NEW.parent_id
        AND parent.organization_id = NEW.organization_id
        AND parent.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH')
  END;

  SELECT CASE
    WHEN EXISTS (
      WITH RECURSIVE descendants(id) AS (
        SELECT id
        FROM organization_file_folders
        WHERE parent_id = NEW.id
          AND organization_id = NEW.organization_id
          AND deleted_at IS NULL
        UNION ALL
        SELECT child.id
        FROM organization_file_folders child
        INNER JOIN descendants d ON child.parent_id = d.id
        WHERE child.organization_id = NEW.organization_id
          AND child.deleted_at IS NULL
      )
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_CYCLE')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_document_folder_delete_empty
BEFORE UPDATE OF deleted_at ON organization_file_folders
FOR EACH ROW
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organization_file_folders child
      WHERE child.organization_id = OLD.organization_id
        AND child.parent_id = OLD.id
        AND child.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_NOT_EMPTY')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organization_files file
      WHERE file.organization_id = OLD.organization_id
        AND file.folder_id = OLD.id
        AND file.deleted_at IS NULL
        AND (file.active = 1 OR file.active IS NULL)
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_NOT_EMPTY')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_organization_file_folder_scope_insert
BEFORE INSERT ON organization_files
FOR EACH ROW
WHEN NEW.folder_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders folder
      WHERE folder.id = NEW.folder_id
        AND folder.organization_id = NEW.organization_id
        AND folder.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'ORGANIZATION_FILE_FOLDER_SCOPE_MISMATCH')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_organization_file_folder_scope_update
BEFORE UPDATE OF folder_id, organization_id ON organization_files
FOR EACH ROW
WHEN NEW.folder_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders folder
      WHERE folder.id = NEW.folder_id
        AND folder.organization_id = NEW.organization_id
        AND folder.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'ORGANIZATION_FILE_FOLDER_SCOPE_MISMATCH')
  END;
END;


-- CC-03 command lifecycle snapshot (migration 0026).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_id_org ON organization_tickets(id, organization_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_command ON ticket_events(command_id);
CREATE TABLE IF NOT EXISTS ticket_command_backfills (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','ready','failed')),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK(source_count >= 0),
  canonical_count INTEGER NOT NULL DEFAULT 0 CHECK(canonical_count >= 0),
  pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
  last_legacy_id INTEGER,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_run_id TEXT
);
CREATE TABLE IF NOT EXISTS ticket_commands (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR (length(idempotency_key) BETWEEN 1 AND 200)),
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  response_status INTEGER NOT NULL CHECK(response_status BETWEEN 200 AND 299),
  created_at TEXT NOT NULL,
  UNIQUE(organization_id, actor_user_id, operation, idempotency_key)
);
CREATE TABLE IF NOT EXISTS ticket_cycles (
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  cycle_number INTEGER NOT NULL CHECK(cycle_number >= 1),
  origin TEXT NOT NULL CHECK(origin IN ('created','observed_baseline','reopened')),
  opened_at TEXT NOT NULL,
  opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TEXT,
  closure_json TEXT CHECK(closure_json IS NULL OR json_valid(closure_json)),
  PRIMARY KEY(ticket_id, cycle_number),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS ticket_wait_intervals (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  cycle_number INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  expected_at TEXT,
  next_action TEXT NOT NULL CHECK(length(next_action) BETWEEN 1 AND 1000),
  end_reason TEXT,
  ended_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(ticket_id, cycle_number) REFERENCES ticket_cycles(ticket_id, cycle_number) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_wait_open ON ticket_wait_intervals(ticket_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS ticket_command_outbox (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES ticket_commands(id) ON DELETE RESTRICT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL REFERENCES ticket_events(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed')),
  created_at TEXT NOT NULL,
  UNIQUE(command_id, event_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_command_outbox_pending ON ticket_command_outbox(status, created_at);

-- Legacy writers (including CC-02 flag-off and direct CR ticket inserts/updates)
-- cannot mutate the core representation while leaving its validator unchanged.
CREATE TRIGGER IF NOT EXISTS ticket_core_version_legacy_update
AFTER UPDATE ON organization_tickets
WHEN NEW.version = OLD.version AND (
  NEW.organization_id IS NOT OLD.organization_id OR NEW.code IS NOT OLD.code OR
  NEW.subject IS NOT OLD.subject OR NEW.description IS NOT OLD.description OR
  NEW.status IS NOT OLD.status OR NEW.priority IS NOT OLD.priority OR NEW.category IS NOT OLD.category OR
  NEW.assigned_to IS NOT OLD.assigned_to OR NEW.due_at IS NOT OLD.due_at OR NEW.closed_at IS NOT OLD.closed_at OR
  NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.updated_at IS NOT OLD.updated_at OR
  NEW.demand_nature IS NOT OLD.demand_nature OR NEW.expected_result IS NOT OLD.expected_result OR
  NEW.context IS NOT OLD.context OR NEW.impact IS NOT OLD.impact OR NEW.urgency IS NOT OLD.urgency OR
  NEW.priority_reason IS NOT OLD.priority_reason OR NEW.triage_answers IS NOT OLD.triage_answers OR
  NEW.triage_form_version IS NOT OLD.triage_form_version OR NEW.triage_source IS NOT OLD.triage_source OR
  NEW.triaged_at IS NOT OLD.triaged_at OR NEW.triaged_by IS NOT OLD.triaged_by OR
  NEW.current_cycle_number IS NOT OLD.current_cycle_number OR NEW.current_cycle_json IS NOT OLD.current_cycle_json OR
  NEW.active_wait_json IS NOT OLD.active_wait_json OR NEW.closure_json IS NOT OLD.closure_json OR
  NEW.next_action IS NOT OLD.next_action OR NEW.active IS NOT OLD.active OR NEW.tombstoned_at IS NOT OLD.tombstoned_at
)
BEGIN
  UPDATE organization_tickets SET version = OLD.version + 1 WHERE id = NEW.id;
END;
-- A legacy state writer cannot reopen/close an adopted lifecycle silently.
-- Rollback keeps adopted tickets read-only through the service, and this guard
-- protects direct legacy status updates even when they bypass that service.
CREATE TRIGGER IF NOT EXISTS ticket_lifecycle_requires_command
BEFORE UPDATE OF status ON organization_tickets
WHEN OLD.current_cycle_number > 0 AND NEW.status IS NOT OLD.status AND NEW.version = OLD.version
BEGIN SELECT RAISE(ABORT, 'TICKET_LIFECYCLE_COMMAND_REQUIRED'); END;

CREATE TRIGGER IF NOT EXISTS ticket_version_monotonic
BEFORE UPDATE OF version ON organization_tickets
WHEN NEW.version < OLD.version
BEGIN SELECT RAISE(ABORT, 'TICKET_VERSION_CANNOT_DECREASE'); END;

-- Append-only domain history. Corrections are new, scoped events. These guards
-- also prevent implicit cascade erasure: use tombstones/retention procedures.
CREATE TRIGGER IF NOT EXISTS ticket_events_no_update BEFORE UPDATE ON ticket_events
BEGIN SELECT RAISE(ABORT, 'TICKET_EVENTS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS ticket_events_no_delete BEFORE DELETE ON ticket_events
BEGIN SELECT RAISE(ABORT, 'TICKET_EVENTS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS ticket_event_correction_scope BEFORE INSERT ON ticket_events
WHEN NEW.corrects_event_id IS NOT NULL AND (
  NEW.event_type <> 'ticket.event.corrected' OR NOT EXISTS (
    SELECT 1 FROM ticket_events e WHERE e.id = NEW.corrects_event_id
      AND e.organization_id = NEW.organization_id AND e.ticket_id = NEW.ticket_id
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_EVENT_CORRECTION_SCOPE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS ticket_audit_no_update BEFORE UPDATE ON audit_logs
WHEN OLD.action LIKE 'ticket.%'
BEGIN SELECT RAISE(ABORT, 'TICKET_AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS ticket_audit_no_delete BEFORE DELETE ON audit_logs
WHEN OLD.action LIKE 'ticket.%'
BEGIN SELECT RAISE(ABORT, 'TICKET_AUDIT_APPEND_ONLY'); END;

-- CC-04 selective Ticket access snapshot (migration 0027).
CREATE TABLE IF NOT EXISTS ticket_access_groups (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_access_groups_name
  ON ticket_access_groups(organization_id, LOWER(TRIM(name))) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_ticket_access_groups_org_active
  ON ticket_access_groups(organization_id, active, name);

CREATE TABLE IF NOT EXISTS ticket_access_group_members (
  group_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(group_id, user_id),
  FOREIGN KEY(group_id, organization_id) REFERENCES ticket_access_groups(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_access_group_members_user
  ON ticket_access_group_members(organization_id, user_id, group_id);

CREATE TABLE IF NOT EXISTS ticket_access_policies (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_access_policies_name
  ON ticket_access_policies(organization_id, LOWER(TRIM(name))) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_ticket_access_policies_org_active
  ON ticket_access_policies(organization_id, active, name);

CREATE TABLE IF NOT EXISTS ticket_access_policy_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK(principal_type IN ('user','group')),
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('ticket.view','ticket.comment','ticket.manage')),
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(policy_id, principal_type, principal_id, action),
  FOREIGN KEY(policy_id, organization_id) REFERENCES ticket_access_policies(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_access_policy_entries_resolve
  ON ticket_access_policy_entries(organization_id, principal_type, principal_id, action, effect, policy_id);

CREATE TABLE IF NOT EXISTS ticket_ticket_access_policies (
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  policy_id TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(ticket_id, policy_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(policy_id, organization_id) REFERENCES ticket_access_policies(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_ticket_access_policies_policy
  ON ticket_ticket_access_policies(organization_id, policy_id, ticket_id);

CREATE TABLE IF NOT EXISTS ticket_acl_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK(principal_type IN ('user','group')),
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('ticket.view','ticket.comment','ticket.manage')),
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(ticket_id, principal_type, principal_id, action),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_acl_resolve
  ON ticket_acl_entries(organization_id, ticket_id, principal_type, principal_id, action, effect);

CREATE TABLE IF NOT EXISTS ticket_labels (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_labels_name
  ON ticket_labels(organization_id, LOWER(TRIM(name))) WHERE active = 1;

CREATE TABLE IF NOT EXISTS ticket_label_links (
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  label_id TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(ticket_id, label_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(label_id, organization_id) REFERENCES ticket_labels(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_label_links_label
  ON ticket_label_links(organization_id, label_id, ticket_id);

CREATE TRIGGER IF NOT EXISTS ticket_access_group_member_scope_insert
BEFORE INSERT ON ticket_access_group_members
WHEN NOT EXISTS (
  SELECT 1 FROM organization_users ou
  INNER JOIN users u ON u.id = ou.user_id
  WHERE ou.organization_id = NEW.organization_id AND ou.user_id = NEW.user_id AND u.active = 1
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACCESS_GROUP_MEMBER_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_access_group_member_scope_update
BEFORE UPDATE OF organization_id, user_id, group_id ON ticket_access_group_members
WHEN NOT EXISTS (
  SELECT 1 FROM organization_users ou
  INNER JOIN users u ON u.id = ou.user_id
  WHERE ou.organization_id = NEW.organization_id AND ou.user_id = NEW.user_id AND u.active = 1
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACCESS_GROUP_MEMBER_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_acl_principal_scope_insert
BEFORE INSERT ON ticket_acl_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACL_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_acl_principal_scope_update
BEFORE UPDATE OF organization_id, principal_type, principal_id ON ticket_acl_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACL_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_policy_entry_principal_scope_insert
BEFORE INSERT ON ticket_access_policy_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_POLICY_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_policy_entry_principal_scope_update
BEFORE UPDATE OF organization_id, principal_type, principal_id ON ticket_access_policy_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_POLICY_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_visibility_version_legacy_update
AFTER UPDATE OF visibility ON organization_tickets
WHEN NEW.visibility IS NOT OLD.visibility AND NEW.version = OLD.version
BEGIN
  UPDATE organization_tickets SET version = OLD.version + 1 WHERE id = NEW.id;
END;

-- CC-05 conversations snapshot (migration 0028).
-- CC-05: conversations, internal notes and server drafts. PREPARE ONLY; no remote application authorized.
-- MIGRATION PENDENTE DE CONFIRMACAO. Canonical production: D1 maono_maps.
-- Requires the schema of 0010, 0026 and 0027, NOT their feature flags.
-- Functional readers, authorization, routes and composer are integrated in PR #202.
-- Do not enable MAONO_TICKET_CONVERSATIONS_ENABLED before migration post-validation and authenticated acceptance.

CREATE UNIQUE INDEX idx_cc05_command_scope
  ON ticket_commands(id, organization_id, actor_user_id);

CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 120),
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('response', 'internal')),
  audience TEXT NOT NULL CHECK(audience IN ('ticket', 'internal')),
  body TEXT NOT NULL CHECK(length(trim(body)) > 0 AND length(body) <= 20000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version) = 'integer' AND version >= 1),
  command_id TEXT NOT NULL UNIQUE,
  last_command_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  edit_reason TEXT,
  CHECK((kind = 'response' AND audience = 'ticket') OR (kind = 'internal' AND audience = 'internal')),
  CHECK((version = 1 AND edited_at IS NULL AND edit_reason IS NULL AND last_command_id = command_id)
    OR (version > 1 AND edited_at IS NOT NULL AND length(trim(edit_reason)) BETWEEN 1 AND 1000)),
  UNIQUE(id, organization_id, ticket_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(command_id, organization_id, author_user_id)
    REFERENCES ticket_commands(id, organization_id, actor_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(last_command_id, organization_id, author_user_id)
    REFERENCES ticket_commands(id, organization_id, actor_user_id) ON DELETE RESTRICT
);
CREATE INDEX idx_cc05_messages_page
  ON ticket_messages(organization_id, ticket_id, audience, created_at, id);

CREATE TABLE ticket_message_revisions (
  message_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(typeof(version) = 'integer' AND version >= 1),
  body TEXT NOT NULL,
  editor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT,
  command_id TEXT NOT NULL UNIQUE REFERENCES ticket_commands(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(message_id, version),
  FOREIGN KEY(message_id, organization_id, ticket_id)
    REFERENCES ticket_messages(id, organization_id, ticket_id) ON DELETE RESTRICT
);

CREATE TRIGGER cc05_message_initial_version BEFORE INSERT ON ticket_messages
WHEN NEW.version <> 1
BEGIN SELECT RAISE(ABORT, 'TICKET_MESSAGE_INITIAL_VERSION_INVALID'); END;
CREATE TRIGGER cc05_message_identity_immutable BEFORE UPDATE ON ticket_messages
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.author_user_id IS NOT OLD.author_user_id
  OR NEW.kind IS NOT OLD.kind OR NEW.audience IS NOT OLD.audience
  OR NEW.created_at IS NOT OLD.created_at OR NEW.command_id IS NOT OLD.command_id
BEGIN SELECT RAISE(ABORT, 'TICKET_MESSAGE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER cc05_message_edit_version BEFORE UPDATE ON ticket_messages
WHEN NEW.version <> OLD.version + 1 OR NEW.last_command_id IS OLD.last_command_id
  OR NEW.edited_at IS NULL OR length(trim(COALESCE(NEW.edit_reason, ''))) NOT BETWEEN 1 AND 1000
BEGIN SELECT RAISE(ABORT, 'TICKET_MESSAGE_EDIT_PRECONDITION'); END;
CREATE TRIGGER cc05_message_no_delete BEFORE DELETE ON ticket_messages
BEGIN SELECT RAISE(ABORT, 'TICKET_MESSAGE_RETENTION_REQUIRED'); END;

-- The database creates the initial revision and every edit atomically. The
-- application MUST NOT insert another initial revision in its D1 batch.
CREATE TRIGGER cc05_message_initial_revision AFTER INSERT ON ticket_messages
BEGIN
  INSERT INTO ticket_message_revisions
    (message_id, organization_id, ticket_id, version, body, editor_user_id, reason, command_id, created_at)
  VALUES (NEW.id, NEW.organization_id, NEW.ticket_id, 1, NEW.body, NEW.author_user_id, NULL, NEW.command_id, NEW.created_at);
END;
CREATE TRIGGER cc05_message_edit_revision AFTER UPDATE ON ticket_messages
BEGIN
  INSERT INTO ticket_message_revisions
    (message_id, organization_id, ticket_id, version, body, editor_user_id, reason, command_id, created_at)
  VALUES (NEW.id, NEW.organization_id, NEW.ticket_id, NEW.version, NEW.body, NEW.author_user_id,
    NEW.edit_reason, NEW.last_command_id, NEW.edited_at);
END;
CREATE TRIGGER cc05_revision_matches_message BEFORE INSERT ON ticket_message_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM ticket_messages m WHERE m.id = NEW.message_id
    AND m.organization_id = NEW.organization_id AND m.ticket_id = NEW.ticket_id
    AND m.version = NEW.version AND m.body = NEW.body AND m.author_user_id = NEW.editor_user_id
    AND m.last_command_id = NEW.command_id AND m.edit_reason IS NEW.reason
    AND COALESCE(m.edited_at, m.created_at) = NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'TICKET_REVISION_SCOPE_INVALID'); END;
CREATE TRIGGER cc05_revisions_no_update BEFORE UPDATE ON ticket_message_revisions
BEGIN SELECT RAISE(ABORT, 'TICKET_REVISIONS_APPEND_ONLY'); END;
CREATE TRIGGER cc05_revisions_no_delete BEFORE DELETE ON ticket_message_revisions
BEGIN SELECT RAISE(ABORT, 'TICKET_REVISIONS_APPEND_ONLY'); END;

CREATE TABLE ticket_drafts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 120),
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  audience TEXT NOT NULL CHECK(audience IN ('ticket', 'internal')),
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 20000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version) = 'integer' AND version >= 1),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'sent', 'discarded')),
  consumed_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((state = 'sent' AND consumed_message_id IS NOT NULL) OR (state <> 'sent' AND consumed_message_id IS NULL)),
  UNIQUE(id, organization_id, ticket_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(consumed_message_id, organization_id, ticket_id)
    REFERENCES ticket_messages(id, organization_id, ticket_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_cc05_draft_active_scope
  ON ticket_drafts(organization_id, ticket_id, user_id, audience) WHERE state = 'active';
CREATE TRIGGER cc05_draft_initial_state BEFORE INSERT ON ticket_drafts
WHEN NEW.version <> 1 OR NEW.state <> 'active'
BEGIN SELECT RAISE(ABORT, 'TICKET_DRAFT_INITIAL_STATE_INVALID'); END;
CREATE TRIGGER cc05_draft_identity_immutable BEFORE UPDATE ON ticket_drafts
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.audience IS NOT OLD.audience OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'TICKET_DRAFT_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER cc05_draft_version BEFORE UPDATE ON ticket_drafts
WHEN OLD.state <> 'active' OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'TICKET_DRAFT_VERSION_CONFLICT'); END;
CREATE TRIGGER cc05_draft_consume_scope BEFORE UPDATE ON ticket_drafts
WHEN NEW.state = 'sent' AND NOT EXISTS (
  SELECT 1 FROM ticket_messages m WHERE m.id = NEW.consumed_message_id
    AND m.organization_id = NEW.organization_id AND m.ticket_id = NEW.ticket_id
    AND m.author_user_id = NEW.user_id AND m.audience = NEW.audience AND m.body = NEW.body
)
BEGIN SELECT RAISE(ABORT, 'TICKET_DRAFT_MESSAGE_SCOPE_INVALID'); END;
CREATE TRIGGER cc05_draft_no_delete BEFORE DELETE ON ticket_drafts
BEGIN SELECT RAISE(ABORT, 'TICKET_DRAFT_RETENTION_REQUIRED'); END;

ALTER TABLE ticket_attachments ADD COLUMN audience TEXT NOT NULL DEFAULT 'ticket'
  CHECK(audience IN ('ticket', 'internal', 'draft'));
ALTER TABLE ticket_attachments ADD COLUMN message_id TEXT REFERENCES ticket_messages(id) ON DELETE RESTRICT;
ALTER TABLE ticket_attachments ADD COLUMN draft_id TEXT REFERENCES ticket_drafts(id) ON DELETE RESTRICT;
CREATE INDEX idx_cc05_attachment_message ON ticket_attachments(organization_id, ticket_id, message_id, status);
CREATE INDEX idx_cc05_attachment_draft ON ticket_attachments(organization_id, ticket_id, draft_id, status);

-- Legacy uploads remain unlinked and audience=ticket. Conversation uploads must
-- START private in a draft; no reclassification of already exposed legacy files.
CREATE TRIGGER cc05_attachment_insert_scope BEFORE INSERT ON ticket_attachments
WHEN NOT (
  (NEW.audience = 'ticket' AND NEW.message_id IS NULL AND NEW.draft_id IS NULL)
  OR (NEW.audience = 'draft' AND NEW.message_id IS NULL AND EXISTS (
    SELECT 1 FROM ticket_drafts d WHERE d.id = NEW.draft_id AND d.state = 'active'
      AND d.organization_id = NEW.organization_id AND d.ticket_id = NEW.ticket_id AND d.user_id = NEW.uploaded_by
  ))
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_INITIAL_SCOPE_INVALID'); END;
CREATE TRIGGER cc05_attachment_identity_immutable BEFORE UPDATE ON ticket_attachments
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.uploaded_by IS NOT OLD.uploaded_by
  OR NEW.storage_key IS NOT OLD.storage_key
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER cc05_attachment_update_scope BEFORE UPDATE ON ticket_attachments
WHEN NOT (
  (NEW.audience = OLD.audience AND NEW.message_id IS OLD.message_id AND NEW.draft_id IS OLD.draft_id)
  OR (OLD.audience = 'draft' AND OLD.message_id IS NULL AND NEW.draft_id IS NULL
    AND OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM ticket_drafts d INNER JOIN ticket_messages m
        ON m.organization_id = d.organization_id AND m.ticket_id = d.ticket_id
        AND m.author_user_id = d.user_id AND m.audience = d.audience
      WHERE d.id = OLD.draft_id AND d.state = 'active' AND m.id = NEW.message_id
        AND m.audience = NEW.audience AND m.body = d.body
    ))
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_AUDIENCE_IMMUTABLE'); END;

ALTER TABLE ticket_events ADD COLUMN audience TEXT NOT NULL DEFAULT 'ticket'
  CHECK(audience IN ('ticket', 'internal'));
ALTER TABLE ticket_events ADD COLUMN message_id TEXT REFERENCES ticket_messages(id) ON DELETE RESTRICT;
CREATE TRIGGER cc05_event_message_scope BEFORE INSERT ON ticket_events
WHEN (NEW.audience = 'internal' AND NEW.message_id IS NULL)
  OR (NEW.message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ticket_messages m WHERE m.id = NEW.message_id
      AND m.organization_id = NEW.organization_id AND m.ticket_id = NEW.ticket_id
      AND m.audience = NEW.audience
  ))
BEGIN SELECT RAISE(ABORT, 'TICKET_EVENT_MESSAGE_SCOPE_INVALID'); END;

-- CC-06: reliable resumable ticket attachment uploads. PREPARE ONLY; no remote application authorized.
-- MIGRATION PENDENTE DE CONFIRMACAO. Canonical production: D1 maono_maps.
-- Requires 0010 and 0028 schema. Feature flag remains OFF by default.
-- Do not enable MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED before protected migration post-validation and authenticated acceptance.

ALTER TABLE ticket_attachments ADD COLUMN upload_session_id TEXT;
ALTER TABLE ticket_attachments ADD COLUMN provider_content_hash TEXT
  CHECK(provider_content_hash IS NULL OR (length(provider_content_hash) = 64 AND provider_content_hash NOT GLOB '*[^0-9a-f]*'));

CREATE UNIQUE INDEX idx_cc06_attachment_upload_session
  ON ticket_attachments(upload_session_id)
  WHERE upload_session_id IS NOT NULL;

CREATE TABLE ticket_attachment_upload_sessions (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 8 AND 120),
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key TEXT NOT NULL UNIQUE,
  expected_size INTEGER NOT NULL CHECK(typeof(expected_size) = 'integer' AND expected_size BETWEEN 1 AND 83886080),
  expected_content_hash TEXT NOT NULL
    CHECK(length(expected_content_hash) = 64 AND expected_content_hash NOT GLOB '*[^0-9a-f]*'),
  target_audience TEXT NOT NULL CHECK(target_audience IN ('ticket', 'internal')),
  draft_id TEXT,
  provider_session_id TEXT,
  provider_object_id TEXT,
  provider_rev TEXT,
  provider_content_hash TEXT
    CHECK(provider_content_hash IS NULL OR (length(provider_content_hash) = 64 AND provider_content_hash NOT GLOB '*[^0-9a-f]*')),
  acknowledged_offset INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(acknowledged_offset) = 'integer' AND acknowledged_offset >= 0 AND acknowledged_offset <= expected_size),
  version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version) = 'integer' AND version >= 1),
  state TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK(state IN ('RESERVED','UPLOADING','FINALIZING','RECONCILE','COMPLETED','CANCELLED','EXPIRED','FAILED')),
  idle_expires_at INTEGER NOT NULL CHECK(typeof(idle_expires_at) = 'integer' AND idle_expires_at > 0),
  hard_expires_at INTEGER NOT NULL CHECK(typeof(hard_expires_at) = 'integer' AND hard_expires_at > 0),
  last_error_code TEXT,
  last_error_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((draft_id IS NULL AND target_audience = 'ticket') OR draft_id IS NOT NULL),
  CHECK(idle_expires_at <= hard_expires_at),
  CHECK((state = 'COMPLETED' AND acknowledged_offset = expected_size AND provider_content_hash = expected_content_hash AND completed_at IS NOT NULL)
    OR state <> 'COMPLETED'),
  UNIQUE(id, organization_id, ticket_id),
  UNIQUE(storage_key, organization_id, ticket_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(draft_id, organization_id, ticket_id)
    REFERENCES ticket_drafts(id, organization_id, ticket_id) ON DELETE RESTRICT
);

CREATE INDEX idx_cc06_upload_sessions_owner
  ON ticket_attachment_upload_sessions(organization_id, ticket_id, user_id, state, updated_at DESC);
CREATE INDEX idx_cc06_upload_sessions_expiry
  ON ticket_attachment_upload_sessions(state, idle_expires_at, hard_expires_at);

-- Reservation is authoritative. ACTIVE attachments and legacy PENDING attachments
-- consume capacity; CC-06 PENDING rows are represented by their live session only.
CREATE TRIGGER cc06_upload_capacity BEFORE INSERT ON ticket_attachment_upload_sessions
WHEN (
  (SELECT COUNT(*) FROM ticket_attachments a
    WHERE a.organization_id = NEW.organization_id AND a.ticket_id = NEW.ticket_id
      AND a.deleted_at IS NULL
      AND (a.status = 'ACTIVE' OR (a.status = 'PENDING' AND a.upload_session_id IS NULL)))
  +
  (SELECT COUNT(*) FROM ticket_attachment_upload_sessions s
    WHERE s.organization_id = NEW.organization_id AND s.ticket_id = NEW.ticket_id
      AND s.state IN ('RESERVED','UPLOADING','FINALIZING','RECONCILE')
      AND s.idle_expires_at > unixepoch('now') * 1000
      AND s.hard_expires_at > unixepoch('now') * 1000)
) >= 5
OR (
  (SELECT COALESCE(SUM(a.size_bytes),0) FROM ticket_attachments a
    WHERE a.organization_id = NEW.organization_id AND a.ticket_id = NEW.ticket_id
      AND a.deleted_at IS NULL
      AND (a.status = 'ACTIVE' OR (a.status = 'PENDING' AND a.upload_session_id IS NULL)))
  +
  (SELECT COALESCE(SUM(s.expected_size),0) FROM ticket_attachment_upload_sessions s
    WHERE s.organization_id = NEW.organization_id AND s.ticket_id = NEW.ticket_id
      AND s.state IN ('RESERVED','UPLOADING','FINALIZING','RECONCILE')
      AND s.idle_expires_at > unixepoch('now') * 1000
      AND s.hard_expires_at > unixepoch('now') * 1000)
  + NEW.expected_size
) > 157286400
BEGIN
  SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_CAPACITY_EXCEEDED');
END;

CREATE TRIGGER cc06_upload_initial_state BEFORE INSERT ON ticket_attachment_upload_sessions
WHEN NEW.state <> 'RESERVED' OR NEW.acknowledged_offset <> 0 OR NEW.version <> 1
  OR NEW.provider_session_id IS NOT NULL OR NEW.provider_object_id IS NOT NULL
  OR NEW.provider_rev IS NOT NULL OR NEW.provider_content_hash IS NOT NULL
  OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_INITIAL_STATE_INVALID'); END;

CREATE TRIGGER cc06_upload_draft_scope BEFORE INSERT ON ticket_attachment_upload_sessions
WHEN NEW.draft_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM ticket_drafts d
  WHERE d.id = NEW.draft_id AND d.organization_id = NEW.organization_id
    AND d.ticket_id = NEW.ticket_id AND d.user_id = NEW.user_id
    AND d.state = 'active' AND d.audience = NEW.target_audience
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_DRAFT_SCOPE_INVALID'); END;

CREATE TRIGGER cc06_upload_identity_immutable BEFORE UPDATE ON ticket_attachment_upload_sessions
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.storage_key IS NOT OLD.storage_key OR NEW.expected_size IS NOT OLD.expected_size
  OR NEW.expected_content_hash IS NOT OLD.expected_content_hash
  OR NEW.target_audience IS NOT OLD.target_audience OR NEW.draft_id IS NOT OLD.draft_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.hard_expires_at IS NOT OLD.hard_expires_at
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER cc06_upload_version BEFORE UPDATE ON ticket_attachment_upload_sessions
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_VERSION_CONFLICT'); END;

CREATE TRIGGER cc06_upload_state_transition BEFORE UPDATE ON ticket_attachment_upload_sessions
WHEN NOT (
  (OLD.state = 'RESERVED' AND NEW.state IN ('UPLOADING','FAILED','CANCELLED','EXPIRED'))
  OR (OLD.state = 'UPLOADING' AND NEW.state IN ('UPLOADING','FINALIZING','RECONCILE','FAILED','CANCELLED','EXPIRED'))
  OR (OLD.state = 'FINALIZING' AND NEW.state IN ('COMPLETED','RECONCILE','FAILED','EXPIRED'))
  OR (OLD.state = 'RECONCILE' AND NEW.state IN ('UPLOADING','FINALIZING','COMPLETED','FAILED','CANCELLED','EXPIRED'))
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_STATE_INVALID'); END;

CREATE TRIGGER cc06_upload_offset_monotonic BEFORE UPDATE ON ticket_attachment_upload_sessions
WHEN NEW.acknowledged_offset < OLD.acknowledged_offset
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_OFFSET_REGRESSION'); END;

CREATE TRIGGER cc06_upload_no_delete BEFORE DELETE ON ticket_attachment_upload_sessions
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_RETENTION_REQUIRED'); END;

CREATE TRIGGER cc06_attachment_session_scope BEFORE INSERT ON ticket_attachments
WHEN NEW.upload_session_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM ticket_attachment_upload_sessions s
  WHERE s.id = NEW.upload_session_id AND s.organization_id = NEW.organization_id
    AND s.ticket_id = NEW.ticket_id AND s.user_id = NEW.uploaded_by
    AND s.storage_key = NEW.storage_key AND s.expected_size = NEW.size_bytes
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_SCOPE_INVALID'); END;

CREATE TRIGGER cc06_attachment_session_immutable BEFORE UPDATE ON ticket_attachments
WHEN NEW.upload_session_id IS NOT OLD.upload_session_id
  OR (OLD.provider_content_hash IS NOT NULL AND NEW.provider_content_hash IS NOT OLD.provider_content_hash)
BEGIN SELECT RAISE(ABORT, 'TICKET_ATTACHMENT_UPLOAD_LINK_IMMUTABLE'); END;
-- CC-07 additive expansion. Production apply only through the protected operator.
-- Prerequisites: 0026, 0027, 0028. Existing outbox rows are NOT backfilled.
ALTER TABLE ticket_command_outbox ADD COLUMN notification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_next_at TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_lease_until TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_token TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_error TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_completed_at TEXT;
CREATE INDEX idx_ticket_notification_due ON ticket_command_outbox(status, notification_next_at, created_at);
CREATE TABLE ticket_notification_candidates (
  outbox_id TEXT NOT NULL REFERENCES ticket_command_outbox(id) ON DELETE RESTRICT,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','suppressed')),
  PRIMARY KEY(outbox_id, recipient_id)
);
CREATE TABLE ticket_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id TEXT NOT NULL REFERENCES ticket_command_outbox(id) ON DELETE RESTRICT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL REFERENCES ticket_events(id) ON DELETE RESTRICT,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK(channel = 'in_app'),
  audience TEXT NOT NULL CHECK(audience IN ('ticket','internal')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(event_id, recipient_id, channel),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_ticket_notifications_inbox ON ticket_notifications(organization_id,recipient_id,id DESC);
-- Snapshot candidates, NOT authorization grants. Author excluded; maximum two.
-- Backfill/corrections/attachment events deliberately excluded.
CREATE TRIGGER ticket_notification_snapshot AFTER INSERT ON ticket_command_outbox
WHEN NEW.event_type IN ('ticket.created','ticket.updated','ticket.status.changed','ticket.closed','ticket.reopened',
  'ticket.wait.started','ticket.wait.ended','ticket.message.created','ticket.note.created',
  'ticket.message.edited','ticket.note.edited')
BEGIN
  INSERT OR IGNORE INTO ticket_notification_candidates(outbox_id, recipient_id)
  SELECT NEW.id, u.id FROM organization_tickets t
  JOIN users u ON u.id IN (t.created_by,t.assigned_to) AND u.active = 1
  JOIN organization_users ou ON ou.user_id=u.id AND ou.organization_id=t.organization_id
  JOIN ticket_events e ON e.id=NEW.event_id AND e.ticket_id=t.id AND e.organization_id=t.organization_id
  WHERE t.id=NEW.ticket_id AND t.organization_id=NEW.organization_id AND t.active=1
    AND u.id IS NOT e.actor_user_id;
END;

-- CR base (0020_project_change_requests.sql)
-- Migração 0020: domínio de Change Request para working copies do Viewer.
-- Aplicar isoladamente no D1 antes de habilitar submit/list/get no ambiente alvo.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_change_requests (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  requested_by_user_id INTEGER NOT NULL,
  ticket_id INTEGER UNIQUE,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN (
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'conflict',
      'applying',
      'applied',
      'superseded'
    )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  idempotency_key TEXT NOT NULL,
  submission_hash TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, requested_by_user_id, idempotency_key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (ticket_id) REFERENCES organization_tickets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_change_operations (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  operation_type TEXT NOT NULL,
  operation_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (change_request_id, sequence),
  FOREIGN KEY (change_request_id) REFERENCES project_change_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_change_requests_project_status
  ON project_change_requests(project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_change_requests_requester
  ON project_change_requests(requested_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_change_operations_request
  ON project_change_operations(change_request_id, sequence);

-- Conteúdo submetido é imutável. Status/ticket/updated_at poderão evoluir nas PRs de Review.
CREATE TRIGGER IF NOT EXISTS trg_project_change_requests_immutable_content
BEFORE UPDATE OF
  organization_id,
  project_id,
  requested_by_user_id,
  base_revision,
  reason,
  idempotency_key,
  submission_hash,
  submitted_at,
  created_at
ON project_change_requests
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_CHANGE_REQUEST_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_change_operations_no_update
BEFORE UPDATE ON project_change_operations
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_CHANGE_OPERATION_IMMUTABLE');
END;

-- DELETE direto é proibido enquanto o pai existe. Cascatas continuam possíveis porque,
-- durante ON DELETE CASCADE do pai, a linha de project_change_requests já não existe.
CREATE TRIGGER IF NOT EXISTS trg_project_change_operations_no_direct_delete
BEFORE DELETE ON project_change_operations
WHEN EXISTS (
  SELECT 1 FROM project_change_requests WHERE id = OLD.change_request_id
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_CHANGE_OPERATION_IMMUTABLE');
END;

-- CC-08 (0031_ticket_change_reconciliation.sql)
-- CC-08. PRECONDITIONS: exact 0020 base schema + 0026/0027/0028/0030.
-- Verify 0020 in the production ledger and audit the actual schema before apply.
-- Parenthesized CASE expressions avoid ambiguity with trigger END in D1 remote parsing.
-- NOT compatible with historical 0021/0022/0023; do not auto-drop their guards.
-- No Ticket state is changed. No historical notifications are created.
ALTER TABLE project_change_requests ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0);
ALTER TABLE project_change_requests ADD COLUMN decision TEXT CHECK (decision IN ('approved', 'rejected'));
ALTER TABLE project_change_requests ADD COLUMN feedback TEXT CHECK (feedback IS NULL OR length(feedback) <= 2000);
ALTER TABLE project_change_requests ADD COLUMN decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_change_requests ADD COLUMN decided_at TEXT;
ALTER TABLE project_change_requests ADD COLUMN transition_actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_change_requests ADD COLUMN applied_revision INTEGER;

CREATE TABLE cc08_schema (version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO cc08_schema VALUES(1);
CREATE TABLE project_change_request_events (
 change_request_id TEXT NOT NULL REFERENCES project_change_requests(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
 actor_user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(change_request_id,version)
);
-- Baseline is evidence of current state only. Do not infer a historical applied revision.
INSERT INTO project_change_request_events(change_request_id,version,to_status)
 SELECT id,lifecycle_version,status FROM project_change_requests;
UPDATE project_change_requests SET decision=CASE WHEN status IN ('approved','applying','applied') THEN 'approved'
 WHEN status='rejected' THEN 'rejected' ELSE NULL END;
CREATE TRIGGER cc08_cr_lifecycle_guard
BEFORE UPDATE OF status, lifecycle_version, decision, feedback, decided_by_user_id, decided_at, applied_revision ON project_change_requests
BEGIN
  -- Preserve attribution; FK ON DELETE SET NULL remains allowed after user deletion.
  SELECT (CASE WHEN NEW.decided_by_user_id IS NOT OLD.decided_by_user_id
    AND (OLD.decision IS NOT NULL OR NEW.status = OLD.status)
    AND (NEW.decided_by_user_id IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE id = OLD.decided_by_user_id))
    THEN RAISE(ABORT, 'CHANGE_REQUEST_DECISION_IMMUTABLE') END);
  SELECT (CASE WHEN NEW.status <> OLD.status AND NOT (
    (OLD.status = 'submitted' AND NEW.status IN ('under_review','rejected','superseded')) OR
    (OLD.status = 'under_review' AND NEW.status IN ('approved','rejected','conflict','superseded')) OR
    (OLD.status = 'approved' AND NEW.status IN ('applying','conflict')) OR
    (OLD.status = 'applying' AND NEW.status IN ('applied','conflict'))
  ) THEN RAISE(ABORT, 'CHANGE_REQUEST_INVALID_TRANSITION') END);
  SELECT (CASE WHEN NEW.status <> OLD.status AND NEW.lifecycle_version <> OLD.lifecycle_version + 1
    THEN RAISE(ABORT, 'CHANGE_REQUEST_LIFECYCLE_VERSION_REQUIRED') END);
  SELECT (CASE WHEN NEW.status = OLD.status AND (
    NEW.lifecycle_version <> OLD.lifecycle_version OR NEW.decision IS NOT OLD.decision OR
    NEW.feedback IS NOT OLD.feedback OR NEW.decided_at IS NOT OLD.decided_at OR NEW.applied_revision IS NOT OLD.applied_revision)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_LIFECYCLE_IMMUTABLE') END);
  SELECT (CASE WHEN OLD.decision IS NOT NULL AND (NEW.decision IS NOT OLD.decision OR
    NEW.feedback IS NOT OLD.feedback OR NEW.decided_at IS NOT OLD.decided_at)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_DECISION_IMMUTABLE') END);
  SELECT (CASE WHEN NEW.status IN ('approved','applying','applied') AND NEW.decision IS NOT 'approved'
    THEN RAISE(ABORT, 'CHANGE_REQUEST_APPROVAL_REQUIRED') END);
  SELECT (CASE WHEN NEW.status = 'rejected' AND OLD.status <> 'rejected' AND
    (NEW.decision IS NOT 'rejected' OR length(trim(COALESCE(NEW.feedback,''))) = 0)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_REJECTION_REASON_REQUIRED') END);
  SELECT (CASE WHEN NEW.status = 'applied' AND NEW.applied_revision IS NOT NEW.base_revision + 1
    THEN RAISE(ABORT, 'CHANGE_REQUEST_APPLIED_REVISION_REQUIRED') END);
END;


CREATE TRIGGER cc08_cr_journal AFTER UPDATE OF status ON project_change_requests
WHEN NEW.status IS NOT OLD.status
BEGIN
 INSERT INTO project_change_request_events(change_request_id,version,from_status,to_status,actor_user_id)
 VALUES(NEW.id,NEW.lifecycle_version,OLD.status,NEW.status,NEW.transition_actor_user_id);
END;
CREATE TRIGGER cc08_cr_created AFTER INSERT ON project_change_requests
BEGIN
 INSERT INTO project_change_request_events(change_request_id,version,to_status,actor_user_id)
 VALUES(NEW.id,NEW.lifecycle_version,NEW.status,NEW.requested_by_user_id);
END;
CREATE TRIGGER cc08_cr_events_no_update BEFORE UPDATE ON project_change_request_events
BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_cr_events_no_delete BEFORE DELETE ON project_change_request_events
BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TABLE project_change_request_apply_artifacts (
 change_request_id TEXT PRIMARY KEY REFERENCES project_change_requests(id) ON DELETE RESTRICT,
 checksum TEXT NOT NULL CHECK(length(checksum)=64), size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 104857600),
 base_revision INTEGER NOT NULL, approved_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER cc08_artifact_immutable BEFORE UPDATE ON project_change_request_apply_artifacts
BEGIN SELECT RAISE(ABORT,'CHANGE_APPLY_ARTIFACT_IMMUTABLE'); END;
CREATE TABLE change_records (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 domain TEXT NOT NULL CHECK(domain IN ('map_project','platform','database')),
 change_request_id TEXT UNIQUE REFERENCES project_change_requests(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 proposal TEXT NOT NULL CHECK(length(trim(proposal)) BETWEEN 1 AND 10000),
 status TEXT NOT NULL CHECK(status IN ('submitted','information_requested','planned','approved','rejected','delivered')),
 version INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES users(id),
 actor_id INTEGER NOT NULL REFERENCES users(id), feedback TEXT NOT NULL DEFAULT '',
 evidence_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((domain='map_project' AND change_request_id IS NOT NULL) OR (domain<>'map_project' AND change_request_id IS NULL)),
 UNIQUE(id,organization_id)
);
CREATE TABLE change_record_events (
 record_id TEXT NOT NULL REFERENCES change_records(id), version INTEGER NOT NULL,
 status TEXT NOT NULL, proposal TEXT NOT NULL, feedback TEXT NOT NULL, evidence_url TEXT,
 actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(record_id,version)
);
CREATE TRIGGER cc08_record_created AFTER INSERT ON change_records BEGIN
 INSERT INTO change_record_events(record_id,version,status,proposal,feedback,evidence_url,actor_id)
 VALUES(NEW.id,NEW.version,NEW.status,NEW.proposal,NEW.feedback,NEW.evidence_url,NEW.actor_id);
END;
CREATE TRIGGER cc08_record_guard BEFORE UPDATE ON change_records BEGIN
 SELECT (CASE WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.domain IS NOT OLD.domain
 OR NEW.change_request_id IS NOT OLD.change_request_id OR NEW.created_by IS NOT OLD.created_by OR NEW.version<>OLD.version+1
 THEN RAISE(ABORT,'CHANGE_RECORD_VERSION_OR_IDENTITY') END);
END;
CREATE TRIGGER cc08_record_updated AFTER UPDATE ON change_records BEGIN
 INSERT INTO change_record_events(record_id,version,status,proposal,feedback,evidence_url,actor_id)
 VALUES(NEW.id,NEW.version,NEW.status,NEW.proposal,NEW.feedback,NEW.evidence_url,NEW.actor_id);
END;
CREATE TRIGGER cc08_record_events_no_update BEFORE UPDATE ON change_record_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_record_events_no_delete BEFORE DELETE ON change_record_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TABLE ticket_change_links (
 ticket_id INTEGER NOT NULL, organization_id INTEGER NOT NULL, record_id TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), version INTEGER NOT NULL DEFAULT 1,
 actor_id INTEGER NOT NULL REFERENCES users(id), source_version INTEGER NOT NULL DEFAULT -1,
 source_status TEXT, divergence TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(ticket_id,record_id),
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id),
 FOREIGN KEY(record_id,organization_id) REFERENCES change_records(id,organization_id)
);
CREATE TABLE ticket_change_link_events (
 ticket_id INTEGER NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, active INTEGER NOT NULL,
 actor_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(ticket_id,record_id,version), FOREIGN KEY(ticket_id,record_id) REFERENCES ticket_change_links(ticket_id,record_id)
);
CREATE TRIGGER cc08_link_created AFTER INSERT ON ticket_change_links BEGIN
 INSERT INTO ticket_change_link_events(ticket_id,record_id,version,active,actor_id) VALUES(NEW.ticket_id,NEW.record_id,NEW.version,NEW.active,NEW.actor_id);
END;
CREATE TRIGGER cc08_link_updated AFTER UPDATE OF active ON ticket_change_links WHEN OLD.active<>NEW.active BEGIN
 SELECT (CASE WHEN NEW.version<>OLD.version+1 THEN RAISE(ABORT,'CHANGE_LINK_VERSION_REQUIRED') END);
 INSERT INTO ticket_change_link_events(ticket_id,record_id,version,active,actor_id) VALUES(NEW.ticket_id,NEW.record_id,NEW.version,NEW.active,NEW.actor_id);
END;
CREATE TRIGGER cc08_link_events_no_update BEFORE UPDATE ON ticket_change_link_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_link_events_no_delete BEFORE DELETE ON ticket_change_link_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TABLE change_commands (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX cc08_links_org ON ticket_change_links(organization_id,ticket_id,active);
CREATE INDEX cc08_records_org ON change_records(organization_id,created_at,id);
-- Capture both submitters (and future compatible writers) in the same DB transaction.
CREATE TRIGGER cc08_cr_record AFTER INSERT ON project_change_requests BEGIN
 INSERT INTO change_records(id,organization_id,domain,change_request_id,title,proposal,status,created_by,actor_id)
 VALUES('cr:'||NEW.id,NEW.organization_id,'map_project',NEW.id,'Solicitação de mapa',NEW.reason,'submitted',NEW.requested_by_user_id,NEW.requested_by_user_id);
 INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id)
 SELECT NEW.ticket_id,NEW.organization_id,'cr:'||NEW.id,NEW.requested_by_user_id WHERE NEW.ticket_id IS NOT NULL;
END;
-- Seed linkage without manufacturing delivery or history of decisions.
INSERT INTO change_records(id,organization_id,domain,change_request_id,title,proposal,status,created_by,actor_id)
 SELECT 'cr:'||id,organization_id,'map_project',id,'Solicitação de mapa',reason,'submitted',requested_by_user_id,requested_by_user_id FROM project_change_requests;
INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id,source_version,source_status)
 SELECT ticket_id,organization_id,'cr:'||id,requested_by_user_id,lifecycle_version,status FROM project_change_requests WHERE ticket_id IS NOT NULL;

CREATE TABLE cc08_cas_guard(value INTEGER NOT NULL CHECK(value=1));
-- Only a generic ticket-level update: no CR content is sent to a recipient.
CREATE TRIGGER cc08_change_notification_snapshot AFTER INSERT ON ticket_command_outbox
WHEN NEW.event_type='ticket.change.updated'
BEGIN
 INSERT OR IGNORE INTO ticket_notification_candidates(outbox_id,recipient_id)
 SELECT NEW.id,u.id FROM organization_tickets t JOIN users u ON u.id IN(t.created_by,t.assigned_to) AND u.active=1
 JOIN organization_users ou ON ou.user_id=u.id AND ou.organization_id=t.organization_id
 JOIN ticket_events e ON e.id=NEW.event_id
 WHERE t.id=NEW.ticket_id AND t.organization_id=NEW.organization_id AND t.active=1 AND u.id IS NOT e.actor_user_id;
END;

CREATE TRIGGER cc08_pending_change_closure BEFORE UPDATE OF status ON organization_tickets
WHEN NEW.status='closed' AND OLD.status<>'closed' AND COALESCE(json_extract(NEW.closure_json,'$.pendingChangeAcknowledged'),0)<>1
AND EXISTS(SELECT 1 FROM ticket_change_links l JOIN change_records c ON c.id=l.record_id AND c.organization_id=l.organization_id
 LEFT JOIN project_change_requests r ON r.id=c.change_request_id
 WHERE l.ticket_id=NEW.id AND l.organization_id=NEW.organization_id AND l.active=1
 AND ((c.domain='map_project' AND r.status NOT IN('applied','rejected','superseded')) OR (c.domain<>'map_project' AND c.status NOT IN('delivered','rejected'))))
BEGIN SELECT RAISE(ABORT,'TICKET_PENDING_CHANGE_ACK_REQUIRED'); END;

CREATE TABLE project_change_request_feedback (
 change_request_id TEXT NOT NULL REFERENCES project_change_requests(id), version INTEGER NOT NULL,
 feedback TEXT NOT NULL CHECK(length(trim(feedback)) BETWEEN 1 AND 2000),actor_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(change_request_id,version)
);
CREATE TABLE project_change_request_lineage (
 previous_id TEXT PRIMARY KEY REFERENCES project_change_requests(id),next_id TEXT UNIQUE NOT NULL REFERENCES project_change_requests(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(previous_id<>next_id)
);
CREATE TRIGGER cc08_feedback_no_update BEFORE UPDATE ON project_change_request_feedback BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_feedback_no_delete BEFORE DELETE ON project_change_request_feedback BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_information_approval_guard BEFORE UPDATE OF status ON project_change_requests
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM project_change_request_feedback WHERE change_request_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'CHANGE_INFORMATION_PENDING'); END;

ALTER TABLE ticket_change_links ADD COLUMN reconcile_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticket_change_links ADD COLUMN reconcile_next_at TEXT;
ALTER TABLE ticket_change_links ADD COLUMN reconcile_error TEXT;
CREATE INDEX cc08_reconcile_due ON ticket_change_links(active,reconcile_next_at,updated_at);

-- CC-09 (0032_ticket_flow_navigation.sql)
-- CC-09: additive schema; no production limits or historical ages are invented.
CREATE TABLE ticket_query_snapshots (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 query_key TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_snapshot_expiry ON ticket_query_snapshots(expires_at);
CREATE INDEX idx_ticket_snapshot_owner ON ticket_query_snapshots(organization_id,user_id,expires_at);
CREATE TABLE ticket_query_snapshot_items (
 snapshot_id TEXT NOT NULL REFERENCES ticket_query_snapshots(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, ticket_id INTEGER NOT NULL,
 queue TEXT NOT NULL, queue_ordinal INTEGER NOT NULL,
 PRIMARY KEY(snapshot_id, ordinal), UNIQUE(snapshot_id, ticket_id)
);
CREATE INDEX idx_ticket_snapshot_queue ON ticket_query_snapshot_items(snapshot_id,queue,queue_ordinal);
CREATE TABLE ticket_queue_policies (
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 queue TEXT NOT NULL CHECK(queue IN ('in_progress','in_review')),
 wip_limit INTEGER CHECK(wip_limit IS NULL OR wip_limit BETWEEN 1 AND 10000),
 version INTEGER NOT NULL DEFAULT 1, updated_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL, change_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,queue)
);
ALTER TABLE organization_tickets ADD COLUMN queue_entered_at TEXT;
CREATE INDEX idx_ticket_flow_queue ON organization_tickets(organization_id,active,status,id);
CREATE TRIGGER ticket_flow_queue_entry AFTER UPDATE OF status ON organization_tickets
WHEN NEW.status <> OLD.status
BEGIN
 UPDATE organization_tickets SET queue_entered_at = NEW.updated_at WHERE id = NEW.id AND organization_id = NEW.organization_id;
END;
CREATE TRIGGER ticket_flow_initial_entry AFTER INSERT ON organization_tickets
BEGIN
 UPDATE organization_tickets SET queue_entered_at = NEW.created_at WHERE id = NEW.id AND organization_id = NEW.organization_id;
END;

-- CC10 additive immutable contracts; no SLA targets, calendars or assignments seeded.
CREATE TABLE ticket_sla_policies (
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version >= 1),
 request_id TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000), published_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,version), UNIQUE(organization_id,request_id)
);
CREATE TABLE ticket_sla_assignments (
 organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, cycle_number INTEGER NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence >= 1), policy_version INTEGER NOT NULL,
 request_id TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL, effective_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 PRIMARY KEY(organization_id,ticket_id,cycle_number,sequence), UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,policy_version) REFERENCES ticket_sla_policies(organization_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(ticket_id,cycle_number) REFERENCES ticket_cycles(ticket_id,cycle_number) ON DELETE RESTRICT
);
CREATE TRIGGER ticket_sla_policy_sequence BEFORE INSERT ON ticket_sla_policies
WHEN NEW.version <> COALESCE((SELECT MAX(version) FROM ticket_sla_policies WHERE organization_id=NEW.organization_id),0)+1
BEGIN SELECT RAISE(ABORT,'TICKET_SLA_VERSION_CONFLICT'); END;
CREATE TRIGGER ticket_sla_assignment_sequence BEFORE INSERT ON ticket_sla_assignments
WHEN NEW.sequence <> COALESCE((SELECT MAX(sequence) FROM ticket_sla_assignments WHERE organization_id=NEW.organization_id AND ticket_id=NEW.ticket_id AND cycle_number=NEW.cycle_number),0)+1
OR NOT EXISTS(SELECT 1 FROM ticket_cycles c JOIN organization_tickets t ON t.id=c.ticket_id AND t.organization_id=c.organization_id
 WHERE c.organization_id=NEW.organization_id AND c.ticket_id=NEW.ticket_id AND c.cycle_number=NEW.cycle_number AND c.closed_at IS NULL
 AND t.current_cycle_number=c.cycle_number AND t.active=1 AND t.status<>'closed' AND NEW.effective_at>=c.opened_at)
OR EXISTS(SELECT 1 FROM ticket_sla_assignments a WHERE a.organization_id=NEW.organization_id AND a.ticket_id=NEW.ticket_id AND a.cycle_number=NEW.cycle_number AND a.effective_at>=NEW.effective_at)
BEGIN SELECT RAISE(ABORT,'TICKET_SLA_VERSION_CONFLICT'); END;
CREATE TRIGGER ticket_sla_policy_no_update BEFORE UPDATE ON ticket_sla_policies BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TRIGGER ticket_sla_policy_no_delete BEFORE DELETE ON ticket_sla_policies BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TRIGGER ticket_sla_assignment_no_update BEFORE UPDATE ON ticket_sla_assignments BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TRIGGER ticket_sla_assignment_no_delete BEFORE DELETE ON ticket_sla_assignments BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TABLE ticket_sla_schema(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO ticket_sla_schema VALUES(1);
-- CC11 expand only. No feature activation, inferred history, SLA targets or horizon seeded.
CREATE TABLE ticket_metric_definitions (
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1), dictionary_version INTEGER NOT NULL CHECK(dictionary_version=1),
 reopen_hours INTEGER NOT NULL CHECK(reopen_hours BETWEEN 1 AND 8760),
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000), published_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,version), UNIQUE(organization_id,request_id)
);
CREATE TRIGGER ticket_metric_definition_sequence BEFORE INSERT ON ticket_metric_definitions
WHEN NEW.version<>COALESCE((SELECT MAX(version) FROM ticket_metric_definitions WHERE organization_id=NEW.organization_id),0)+1
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_VERSION_CONFLICT'); END;
CREATE TRIGGER ticket_metric_definition_no_update BEFORE UPDATE ON ticket_metric_definitions
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_DEFINITION_IMMUTABLE'); END;
CREATE TRIGGER ticket_metric_definition_no_delete BEFORE DELETE ON ticket_metric_definitions
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_DEFINITION_IMMUTABLE'); END;
CREATE TABLE ticket_metric_rollups (
 organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL,
 dictionary_version INTEGER NOT NULL CHECK(dictionary_version=1), definition_version INTEGER NOT NULL CHECK(definition_version>=0),
 window_json TEXT NOT NULL CHECK(json_valid(window_json)), source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 facts_json TEXT NOT NULL CHECK(json_valid(facts_json)), watermark INTEGER NOT NULL CHECK(watermark>=0),
 revision INTEGER NOT NULL CHECK(revision>=1), built_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,ticket_id),
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE ticket_metric_checkpoints (
 organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, revision INTEGER NOT NULL,
 source_hash TEXT NOT NULL, previous_hash TEXT, watermark INTEGER NOT NULL,
 dictionary_version INTEGER NOT NULL, definition_version INTEGER NOT NULL,
 window_json TEXT NOT NULL CHECK(json_valid(window_json)), quality_json TEXT NOT NULL CHECK(json_valid(quality_json)),
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, built_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,ticket_id,revision),
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id) ON DELETE RESTRICT
);
CREATE TRIGGER ticket_metric_checkpoint_no_update BEFORE UPDATE ON ticket_metric_checkpoints
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_CHECKPOINT_IMMUTABLE'); END;
CREATE TRIGGER ticket_metric_checkpoint_no_delete BEFORE DELETE ON ticket_metric_checkpoints
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_CHECKPOINT_IMMUTABLE'); END;
CREATE INDEX idx_ticket_metric_checkpoints_partition ON ticket_metric_checkpoints(organization_id,ticket_id,built_at);

-- CC-12 additive export jobs. No production defaults, no backfill, no remote application.
-- PREPARE -> local -> protected audit -> explicit hash authorization -> isolated apply.
CREATE TABLE ticket_export_generation (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0);
INSERT INTO ticket_export_generation(id,version) VALUES(1,0);
CREATE TABLE ticket_export_jobs (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 state TEXT NOT NULL CHECK(state IN ('queued','capturing','running','ready','failed','cancelled','expired','revoked')),
 generation INTEGER NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, expected_rows INTEGER NOT NULL DEFAULT 0,
 captured_rows INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, part_count INTEGER NOT NULL DEFAULT 0,
 token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT,
 error_code TEXT, manifest_json TEXT CHECK(manifest_json IS NULL OR json_valid(manifest_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(organization_id,actor_id,request_id), UNIQUE(id,organization_id),
 CHECK(captured_rows>=0 AND expected_rows>=0 AND captured_rows<=expected_rows), CHECK(bytes>=0)
);
CREATE INDEX idx_ticket_export_queue ON ticket_export_jobs(state,next_at,lease_until,created_at);
CREATE INDEX idx_ticket_export_owner ON ticket_export_jobs(organization_id,actor_id,created_at DESC,id);
CREATE TABLE ticket_export_items (
 job_id TEXT NOT NULL, organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL,
 fact_json TEXT NOT NULL CHECK(json_valid(fact_json)), source_hash TEXT NOT NULL,
 domain TEXT NOT NULL, nature TEXT NOT NULL, policy_versions TEXT NOT NULL CHECK(json_valid(policy_versions)),
 PRIMARY KEY(job_id,ticket_id),
 FOREIGN KEY(job_id,organization_id) REFERENCES ticket_export_jobs(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE ticket_export_parts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, organization_id INTEGER NOT NULL, ordinal INTEGER NOT NULL,
 csv TEXT NOT NULL CHECK(length(CAST(csv AS BLOB))<=1048576), bytes INTEGER NOT NULL CHECK(bytes>=0 AND bytes<=1048576),
 sha256 TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
 UNIQUE(job_id,ordinal), FOREIGN KEY(job_id,organization_id) REFERENCES ticket_export_jobs(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE ticket_export_audit (
 id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, organization_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
 action TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_export_audit_job ON ticket_export_audit(job_id,created_at);
CREATE TRIGGER ticket_export_items_immutable BEFORE UPDATE ON ticket_export_items
BEGIN SELECT RAISE(ABORT,'TICKET_EXPORT_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER ticket_export_parts_immutable BEFORE UPDATE OF csv,bytes,sha256,job_id,organization_id,ordinal ON ticket_export_parts
BEGIN SELECT RAISE(ABORT,'TICKET_EXPORT_PART_IMMUTABLE'); END;
CREATE TRIGGER ticket_export_epoch_organization_tickets_insert AFTER INSERT ON organization_tickets
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_tickets_update AFTER UPDATE ON organization_tickets
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_tickets_delete AFTER DELETE ON organization_tickets
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cycles_insert AFTER INSERT ON ticket_cycles
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cycles_update AFTER UPDATE ON ticket_cycles
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cycles_delete AFTER DELETE ON ticket_cycles
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_events_insert AFTER INSERT ON ticket_events
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_events_update AFTER UPDATE ON ticket_events
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_events_delete AFTER DELETE ON ticket_events
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_wait_intervals_insert AFTER INSERT ON ticket_wait_intervals
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_wait_intervals_update AFTER UPDATE ON ticket_wait_intervals
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_wait_intervals_delete AFTER DELETE ON ticket_wait_intervals
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_messages_insert AFTER INSERT ON ticket_messages
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_messages_update AFTER UPDATE ON ticket_messages
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_messages_delete AFTER DELETE ON ticket_messages
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_message_revisions_insert AFTER INSERT ON ticket_message_revisions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_message_revisions_update AFTER UPDATE ON ticket_message_revisions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_message_revisions_delete AFTER DELETE ON ticket_message_revisions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_commands_insert AFTER INSERT ON ticket_commands
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_commands_update AFTER UPDATE ON ticket_commands
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_commands_delete AFTER DELETE ON ticket_commands
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_assignments_insert AFTER INSERT ON ticket_sla_assignments
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_assignments_update AFTER UPDATE ON ticket_sla_assignments
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_assignments_delete AFTER DELETE ON ticket_sla_assignments
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_policies_insert AFTER INSERT ON ticket_sla_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_policies_update AFTER UPDATE ON ticket_sla_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_policies_delete AFTER DELETE ON ticket_sla_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_metric_definitions_insert AFTER INSERT ON ticket_metric_definitions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_metric_definitions_update AFTER UPDATE ON ticket_metric_definitions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_metric_definitions_delete AFTER DELETE ON ticket_metric_definitions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_acl_entries_insert AFTER INSERT ON ticket_acl_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_acl_entries_update AFTER UPDATE ON ticket_acl_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_acl_entries_delete AFTER DELETE ON ticket_acl_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_ticket_access_policies_insert AFTER INSERT ON ticket_ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_ticket_access_policies_update AFTER UPDATE ON ticket_ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_ticket_access_policies_delete AFTER DELETE ON ticket_ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policies_insert AFTER INSERT ON ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policies_update AFTER UPDATE ON ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policies_delete AFTER DELETE ON ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policy_entries_insert AFTER INSERT ON ticket_access_policy_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policy_entries_update AFTER UPDATE ON ticket_access_policy_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policy_entries_delete AFTER DELETE ON ticket_access_policy_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_groups_insert AFTER INSERT ON ticket_access_groups
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_groups_update AFTER UPDATE ON ticket_access_groups
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_groups_delete AFTER DELETE ON ticket_access_groups
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_group_members_insert AFTER INSERT ON ticket_access_group_members
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_group_members_update AFTER UPDATE ON ticket_access_group_members
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_group_members_delete AFTER DELETE ON ticket_access_group_members
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_users_insert AFTER INSERT ON organization_users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_users_update AFTER UPDATE ON organization_users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_users_delete AFTER DELETE ON organization_users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organizations_insert AFTER INSERT ON organizations
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organizations_update AFTER UPDATE ON organizations
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organizations_delete AFTER DELETE ON organizations
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_users_insert AFTER INSERT ON users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_users_update AFTER UPDATE ON users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_users_delete AFTER DELETE ON users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;

-- Metadata-only orphan cleanup tombstones. No report content retained here.
CREATE TABLE ticket_export_gc (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, organization_id INTEGER NOT NULL,
 next_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_export_gc_due ON ticket_export_gc(organization_id,next_at,id);

-- Explicit permission denials invalidate an in-flight capture.
CREATE TRIGGER ticket_export_epoch_user_permission_denials_insert AFTER INSERT ON user_permission_denials
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_user_permission_denials_update AFTER UPDATE ON user_permission_denials
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_user_permission_denials_delete AFTER DELETE ON user_permission_denials
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;

-- CC-13 (migration 0036_ticket_incidents_problems.sql)
-- CC-13: additive domain. Production requires the protected audit/authorization lifecycle.
CREATE TABLE ticket_cases (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 kind TEXT NOT NULL CHECK(kind IN ('incident','problem')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 state TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','organization')),
 created_by INTEGER NOT NULL REFERENCES users(id), coordinator_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(organization_id,id),
 CHECK((kind='incident' AND state IN ('open','mitigating','restored','closed')) OR
       (kind='problem' AND state IN ('open','investigating','action_defined','resolved')))
);
CREATE INDEX ticket_cases_org_order ON ticket_cases(organization_id,kind,id);
CREATE TABLE ticket_case_members (
 organization_id INTEGER NOT NULL, case_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 PRIMARY KEY(organization_id,case_id,user_id),
 FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE TABLE ticket_case_links (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, case_id TEXT NOT NULL,
 ticket_id INTEGER REFERENCES organization_tickets(id), target_case_id TEXT,
 change_id TEXT REFERENCES change_records(id),
 relation TEXT NOT NULL CHECK(relation IN ('related','duplicate_candidate','duplicate_confirmed','duplicate_rejected','implements')),
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 CHECK((ticket_id IS NOT NULL)+(target_case_id IS NOT NULL)+(change_id IS NOT NULL)=1),
 CHECK(target_case_id IS NULL OR target_case_id<>case_id),
 FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id),
 FOREIGN KEY(organization_id,target_case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE UNIQUE INDEX ticket_case_ticket_link ON ticket_case_links(case_id,ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX ticket_case_case_link ON ticket_case_links(case_id,target_case_id) WHERE target_case_id IS NOT NULL;
CREATE UNIQUE INDEX ticket_case_change_link ON ticket_case_links(case_id,change_id) WHERE change_id IS NOT NULL;
CREATE INDEX ticket_case_links_ticket ON ticket_case_links(organization_id,ticket_id,case_id);
CREATE TRIGGER ticket_case_link_tenant_insert BEFORE INSERT ON ticket_case_links
WHEN (NEW.ticket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_tickets WHERE id=NEW.ticket_id AND organization_id=NEW.organization_id))
 OR (NEW.change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM change_records WHERE id=NEW.change_id AND organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'CC13_TENANT'); END;
CREATE TRIGGER ticket_case_link_tenant_update BEFORE UPDATE ON ticket_case_links
WHEN (NEW.ticket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_tickets WHERE id=NEW.ticket_id AND organization_id=NEW.organization_id))
 OR (NEW.change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM change_records WHERE id=NEW.change_id AND organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'CC13_TENANT'); END;
CREATE TABLE ticket_case_commands (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL
);
CREATE TABLE ticket_case_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id INTEGER NOT NULL, case_id TEXT NOT NULL,
 command_id TEXT NOT NULL REFERENCES ticket_case_commands(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL, action TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL,
 UNIQUE(case_id,version), FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE TRIGGER ticket_case_events_immutable BEFORE UPDATE ON ticket_case_events BEGIN SELECT RAISE(ABORT,'CC13_IMMUTABLE'); END;
CREATE TRIGGER ticket_case_events_no_delete BEFORE DELETE ON ticket_case_events BEGIN SELECT RAISE(ABORT,'CC13_IMMUTABLE'); END;
CREATE INDEX ticket_case_events_order ON ticket_case_events(organization_id,case_id,id);
CREATE TABLE ticket_case_guard(value INTEGER NOT NULL CHECK(value=1));
-- Fence case facts/audiences, relation changes and historical revisions in CC12 snapshots.
CREATE TRIGGER ticket_export_epoch_ticket_cases_insert AFTER INSERT ON ticket_cases BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cases_update AFTER UPDATE ON ticket_cases BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cases_delete AFTER DELETE ON ticket_cases BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_members_insert AFTER INSERT ON ticket_case_members BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_members_update AFTER UPDATE ON ticket_case_members BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_members_delete AFTER DELETE ON ticket_case_members BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_links_insert AFTER INSERT ON ticket_case_links BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_links_update AFTER UPDATE ON ticket_case_links BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_links_delete AFTER DELETE ON ticket_case_links BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_events_insert AFTER INSERT ON ticket_case_events BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_events_delete AFTER DELETE ON ticket_case_events BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
