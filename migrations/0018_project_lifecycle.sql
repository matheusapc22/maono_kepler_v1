-- S03 - Project Lifecycle + revision lineage
-- EXPAND migration: legacy projects remain compatible until reconciliation.

PRAGMA foreign_keys = ON;

ALTER TABLE projects ADD COLUMN lifecycle_state TEXT
  CHECK (
    lifecycle_state IS NULL OR
    lifecycle_state IN (
      'DRAFT',
      'PREPARING_STORAGE',
      'CONFIG_READY',
      'ACTIVE',
      'FAILED'
    )
  );
ALTER TABLE projects ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0
  CHECK (lifecycle_version >= 0);
ALTER TABLE projects ADD COLUMN lifecycle_updated_at TEXT;
ALTER TABLE projects ADD COLUMN lifecycle_failure_stage TEXT;
ALTER TABLE projects ADD COLUMN lifecycle_failure_code TEXT;
ALTER TABLE projects ADD COLUMN lifecycle_failure_at TEXT;
ALTER TABLE projects ADD COLUMN lifecycle_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (lifecycle_attempts >= 0);
ALTER TABLE projects ADD COLUMN lifecycle_retryable INTEGER
  CHECK (lifecycle_retryable IS NULL OR lifecycle_retryable IN (0, 1));
ALTER TABLE projects ADD COLUMN lifecycle_transition_id TEXT;

ALTER TABLE projects ADD COLUMN config_checksum TEXT;
ALTER TABLE projects ADD COLUMN config_checksum_algorithm TEXT;
ALTER TABLE projects ADD COLUMN config_storage_provider TEXT;
ALTER TABLE projects ADD COLUMN config_storage_ref TEXT;
ALTER TABLE projects ADD COLUMN config_storage_provider_version TEXT;
ALTER TABLE projects ADD COLUMN config_schema TEXT;
ALTER TABLE projects ADD COLUMN config_schema_version INTEGER
  CHECK (config_schema_version IS NULL OR config_schema_version > 0);
ALTER TABLE projects ADD COLUMN config_size_bytes INTEGER
  CHECK (config_size_bytes IS NULL OR config_size_bytes >= 0);
ALTER TABLE projects ADD COLUMN config_content_type TEXT;

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

CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_state_org
  ON projects (lifecycle_state, organization_id, id);
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_updated
  ON projects (lifecycle_state, lifecycle_updated_at);
CREATE INDEX IF NOT EXISTS idx_project_config_revisions_project_status
  ON project_config_revisions (project_id, status, revision DESC);
CREATE INDEX IF NOT EXISTS idx_project_config_revisions_checksum
  ON project_config_revisions (project_id, checksum_algorithm, checksum);
