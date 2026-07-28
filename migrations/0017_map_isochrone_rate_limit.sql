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
