-- Apply only after 0021 during the controlled rollout. No runtime DDL.
CREATE TABLE project_change_request_apply_artifacts (
  change_request_id TEXT PRIMARY KEY REFERENCES project_change_requests(id) ON DELETE CASCADE,
  checksum TEXT NOT NULL CHECK(length(checksum)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  base_revision INTEGER NOT NULL CHECK(base_revision >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_change_request_apply_artifact_immutable
BEFORE UPDATE ON project_change_request_apply_artifacts
BEGIN SELECT RAISE(ABORT,'CHANGE_REQUEST_APPLY_ARTIFACT_IMMUTABLE'); END;
