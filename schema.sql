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


