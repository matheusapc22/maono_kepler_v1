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
