-- Migração 0008: endurecimento da gestão de arquivos por organização
-- Mantém o binário no Dropbox e os metadados/estado no Cloudflare D1.

PRAGMA foreign_keys = ON;

ALTER TABLE organization_files ADD COLUMN project_id INTEGER;
ALTER TABLE organization_files ADD COLUMN original_name TEXT;
ALTER TABLE organization_files ADD COLUMN mime_type TEXT;
ALTER TABLE organization_files ADD COLUMN sha256 TEXT;
ALTER TABLE organization_files ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE organization_files ADD COLUMN error_message TEXT;
ALTER TABLE organization_files ADD COLUMN uploaded_by INTEGER;
ALTER TABLE organization_files ADD COLUMN deleted_at TEXT;
ALTER TABLE organization_files ADD COLUMN idempotency_key TEXT;
ALTER TABLE organization_files ADD COLUMN dropbox_file_id TEXT;
ALTER TABLE organization_files ADD COLUMN dropbox_rev TEXT;

UPDATE organization_files
SET original_name = COALESCE(original_name, name, file_name),
    status = CASE
      WHEN active = 1 THEN 'ACTIVE'
      ELSE 'INACTIVE'
    END
WHERE original_name IS NULL
   OR status IS NULL
   OR status = '';

CREATE INDEX IF NOT EXISTS idx_organization_files_project_id
  ON organization_files(project_id);

CREATE INDEX IF NOT EXISTS idx_organization_files_status
  ON organization_files(status);

CREATE INDEX IF NOT EXISTS idx_organization_files_uploaded_by
  ON organization_files(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_organization_files_deleted_at
  ON organization_files(deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_files_idempotency
  ON organization_files(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
