CREATE TABLE IF NOT EXISTS organization_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  file_name TEXT,
  dropbox_path TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organization_exports_organization_id
  ON organization_exports (organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_exports_status
  ON organization_exports (status);