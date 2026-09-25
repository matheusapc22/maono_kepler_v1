-- CC-03. Expansão manual, sujeita a autorização e confirmação por D1/ambiente.
-- Pré-requisito: 0010 + 0025. Não habilitar MAONO_TICKET_COMMANDS_ENABLED antes
-- do backfill explícito/reconciliado de cada organização. Não modifica CR Apply.
ALTER TABLE organization_tickets ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE organization_tickets ADD COLUMN last_command_id TEXT;
ALTER TABLE organization_tickets ADD COLUMN current_cycle_number INTEGER NOT NULL DEFAULT 0 CHECK (current_cycle_number >= 0);
ALTER TABLE organization_tickets ADD COLUMN current_cycle_json TEXT CHECK (current_cycle_json IS NULL OR (json_valid(current_cycle_json) AND json_type(current_cycle_json) = 'object'));
ALTER TABLE organization_tickets ADD COLUMN active_wait_json TEXT CHECK (active_wait_json IS NULL OR (json_valid(active_wait_json) AND json_type(active_wait_json) = 'object'));
ALTER TABLE organization_tickets ADD COLUMN closure_json TEXT CHECK (closure_json IS NULL OR (json_valid(closure_json) AND json_type(closure_json) = 'object'));
ALTER TABLE organization_tickets ADD COLUMN next_action TEXT NOT NULL DEFAULT '' CHECK (length(next_action) <= 1000);
ALTER TABLE organization_tickets ADD COLUMN tombstoned_at TEXT;
ALTER TABLE ticket_events ADD COLUMN command_id TEXT;
ALTER TABLE ticket_events ADD COLUMN entity_version INTEGER CHECK (entity_version IS NULL OR entity_version >= 1);
ALTER TABLE ticket_events ADD COLUMN corrects_event_id INTEGER REFERENCES ticket_events(id) ON DELETE RESTRICT;

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
