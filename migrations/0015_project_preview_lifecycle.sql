ALTER TABLE projects
ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 0
CHECK (config_revision >= 0);

ALTER TABLE projects
ADD COLUMN preview_status TEXT NOT NULL DEFAULT 'UNKNOWN'
CHECK (preview_status IN ('UNKNOWN', 'PENDING', 'READY', 'FAILED', 'MISSING'));

ALTER TABLE projects
ADD COLUMN preview_revision INTEGER
CHECK (preview_revision IS NULL OR preview_revision >= 0);

ALTER TABLE projects
ADD COLUMN preview_updated_at TEXT;

ALTER TABLE projects
ADD COLUMN preview_attempts INTEGER NOT NULL DEFAULT 0
CHECK (preview_attempts >= 0);

ALTER TABLE projects
ADD COLUMN preview_last_error TEXT;

ALTER TABLE projects
ADD COLUMN preview_capture_method TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_preview_status_org
ON projects (preview_status, organization_id, id);

CREATE INDEX IF NOT EXISTS idx_projects_preview_revision
ON projects (id, config_revision, preview_revision);
