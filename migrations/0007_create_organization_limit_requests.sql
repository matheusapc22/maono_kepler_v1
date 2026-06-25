CREATE TABLE IF NOT EXISTS organization_limit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  request_type TEXT NOT NULL,
  requested_plan TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_organization_limit_requests_org
  ON organization_limit_requests (organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_limit_requests_status
  ON organization_limit_requests (status);

CREATE INDEX IF NOT EXISTS idx_organization_limit_requests_created_by
  ON organization_limit_requests (created_by);

CREATE INDEX IF NOT EXISTS idx_organization_limit_requests_created_at
  ON organization_limit_requests (created_at);