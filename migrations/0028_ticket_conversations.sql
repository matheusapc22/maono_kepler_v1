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
