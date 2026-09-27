-- CC-08. PRECONDITIONS: exact 0020 base schema + 0026/0027/0028/0030.
-- Verify 0020 in the production ledger and audit the actual schema before apply.
-- Parenthesized CASE expressions avoid ambiguity with trigger END in D1 remote parsing.
-- NOT compatible with historical 0021/0022/0023; do not auto-drop their guards.
-- No Ticket state is changed. No historical notifications are created.
ALTER TABLE project_change_requests ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0);
ALTER TABLE project_change_requests ADD COLUMN decision TEXT CHECK (decision IN ('approved', 'rejected'));
ALTER TABLE project_change_requests ADD COLUMN feedback TEXT CHECK (feedback IS NULL OR length(feedback) <= 2000);
ALTER TABLE project_change_requests ADD COLUMN decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_change_requests ADD COLUMN decided_at TEXT;
ALTER TABLE project_change_requests ADD COLUMN transition_actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_change_requests ADD COLUMN applied_revision INTEGER;

CREATE TABLE cc08_schema (version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO cc08_schema VALUES(1);
CREATE TABLE project_change_request_events (
 change_request_id TEXT NOT NULL REFERENCES project_change_requests(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
 actor_user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(change_request_id,version)
);
-- Baseline is evidence of current state only. Do not infer a historical applied revision.
INSERT INTO project_change_request_events(change_request_id,version,to_status)
 SELECT id,lifecycle_version,status FROM project_change_requests;
UPDATE project_change_requests SET decision=CASE WHEN status IN ('approved','applying','applied') THEN 'approved'
 WHEN status='rejected' THEN 'rejected' ELSE NULL END;
CREATE TRIGGER cc08_cr_lifecycle_guard
BEFORE UPDATE OF status, lifecycle_version, decision, feedback, decided_by_user_id, decided_at, applied_revision ON project_change_requests
BEGIN
  -- Preserve attribution; FK ON DELETE SET NULL remains allowed after user deletion.
  SELECT (CASE WHEN NEW.decided_by_user_id IS NOT OLD.decided_by_user_id
    AND (OLD.decision IS NOT NULL OR NEW.status = OLD.status)
    AND (NEW.decided_by_user_id IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE id = OLD.decided_by_user_id))
    THEN RAISE(ABORT, 'CHANGE_REQUEST_DECISION_IMMUTABLE') END);
  SELECT (CASE WHEN NEW.status <> OLD.status AND NOT (
    (OLD.status = 'submitted' AND NEW.status IN ('under_review','rejected','superseded')) OR
    (OLD.status = 'under_review' AND NEW.status IN ('approved','rejected','conflict','superseded')) OR
    (OLD.status = 'approved' AND NEW.status IN ('applying','conflict')) OR
    (OLD.status = 'applying' AND NEW.status IN ('applied','conflict'))
  ) THEN RAISE(ABORT, 'CHANGE_REQUEST_INVALID_TRANSITION') END);
  SELECT (CASE WHEN NEW.status <> OLD.status AND NEW.lifecycle_version <> OLD.lifecycle_version + 1
    THEN RAISE(ABORT, 'CHANGE_REQUEST_LIFECYCLE_VERSION_REQUIRED') END);
  SELECT (CASE WHEN NEW.status = OLD.status AND (
    NEW.lifecycle_version <> OLD.lifecycle_version OR NEW.decision IS NOT OLD.decision OR
    NEW.feedback IS NOT OLD.feedback OR NEW.decided_at IS NOT OLD.decided_at OR NEW.applied_revision IS NOT OLD.applied_revision)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_LIFECYCLE_IMMUTABLE') END);
  SELECT (CASE WHEN OLD.decision IS NOT NULL AND (NEW.decision IS NOT OLD.decision OR
    NEW.feedback IS NOT OLD.feedback OR NEW.decided_at IS NOT OLD.decided_at)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_DECISION_IMMUTABLE') END);
  SELECT (CASE WHEN NEW.status IN ('approved','applying','applied') AND NEW.decision IS NOT 'approved'
    THEN RAISE(ABORT, 'CHANGE_REQUEST_APPROVAL_REQUIRED') END);
  SELECT (CASE WHEN NEW.status = 'rejected' AND OLD.status <> 'rejected' AND
    (NEW.decision IS NOT 'rejected' OR length(trim(COALESCE(NEW.feedback,''))) = 0)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_REJECTION_REASON_REQUIRED') END);
  SELECT (CASE WHEN NEW.status = 'applied' AND NEW.applied_revision IS NOT NEW.base_revision + 1
    THEN RAISE(ABORT, 'CHANGE_REQUEST_APPLIED_REVISION_REQUIRED') END);
END;


CREATE TRIGGER cc08_cr_journal AFTER UPDATE OF status ON project_change_requests
WHEN NEW.status IS NOT OLD.status
BEGIN
 INSERT INTO project_change_request_events(change_request_id,version,from_status,to_status,actor_user_id)
 VALUES(NEW.id,NEW.lifecycle_version,OLD.status,NEW.status,NEW.transition_actor_user_id);
END;
CREATE TRIGGER cc08_cr_created AFTER INSERT ON project_change_requests
BEGIN
 INSERT INTO project_change_request_events(change_request_id,version,to_status,actor_user_id)
 VALUES(NEW.id,NEW.lifecycle_version,NEW.status,NEW.requested_by_user_id);
END;
CREATE TRIGGER cc08_cr_events_no_update BEFORE UPDATE ON project_change_request_events
BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_cr_events_no_delete BEFORE DELETE ON project_change_request_events
BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TABLE project_change_request_apply_artifacts (
 change_request_id TEXT PRIMARY KEY REFERENCES project_change_requests(id) ON DELETE RESTRICT,
 checksum TEXT NOT NULL CHECK(length(checksum)=64), size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 104857600),
 base_revision INTEGER NOT NULL, approved_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER cc08_artifact_immutable BEFORE UPDATE ON project_change_request_apply_artifacts
BEGIN SELECT RAISE(ABORT,'CHANGE_APPLY_ARTIFACT_IMMUTABLE'); END;
CREATE TABLE change_records (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 domain TEXT NOT NULL CHECK(domain IN ('map_project','platform','database')),
 change_request_id TEXT UNIQUE REFERENCES project_change_requests(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 proposal TEXT NOT NULL CHECK(length(trim(proposal)) BETWEEN 1 AND 10000),
 status TEXT NOT NULL CHECK(status IN ('submitted','information_requested','planned','approved','rejected','delivered')),
 version INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES users(id),
 actor_id INTEGER NOT NULL REFERENCES users(id), feedback TEXT NOT NULL DEFAULT '',
 evidence_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((domain='map_project' AND change_request_id IS NOT NULL) OR (domain<>'map_project' AND change_request_id IS NULL)),
 UNIQUE(id,organization_id)
);
CREATE TABLE change_record_events (
 record_id TEXT NOT NULL REFERENCES change_records(id), version INTEGER NOT NULL,
 status TEXT NOT NULL, proposal TEXT NOT NULL, feedback TEXT NOT NULL, evidence_url TEXT,
 actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(record_id,version)
);
CREATE TRIGGER cc08_record_created AFTER INSERT ON change_records BEGIN
 INSERT INTO change_record_events(record_id,version,status,proposal,feedback,evidence_url,actor_id)
 VALUES(NEW.id,NEW.version,NEW.status,NEW.proposal,NEW.feedback,NEW.evidence_url,NEW.actor_id);
END;
CREATE TRIGGER cc08_record_guard BEFORE UPDATE ON change_records BEGIN
 SELECT (CASE WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.domain IS NOT OLD.domain
 OR NEW.change_request_id IS NOT OLD.change_request_id OR NEW.created_by IS NOT OLD.created_by OR NEW.version<>OLD.version+1
 THEN RAISE(ABORT,'CHANGE_RECORD_VERSION_OR_IDENTITY') END);
END;
CREATE TRIGGER cc08_record_updated AFTER UPDATE ON change_records BEGIN
 INSERT INTO change_record_events(record_id,version,status,proposal,feedback,evidence_url,actor_id)
 VALUES(NEW.id,NEW.version,NEW.status,NEW.proposal,NEW.feedback,NEW.evidence_url,NEW.actor_id);
END;
CREATE TRIGGER cc08_record_events_no_update BEFORE UPDATE ON change_record_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_record_events_no_delete BEFORE DELETE ON change_record_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TABLE ticket_change_links (
 ticket_id INTEGER NOT NULL, organization_id INTEGER NOT NULL, record_id TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), version INTEGER NOT NULL DEFAULT 1,
 actor_id INTEGER NOT NULL REFERENCES users(id), source_version INTEGER NOT NULL DEFAULT -1,
 source_status TEXT, divergence TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(ticket_id,record_id),
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id),
 FOREIGN KEY(record_id,organization_id) REFERENCES change_records(id,organization_id)
);
CREATE TABLE ticket_change_link_events (
 ticket_id INTEGER NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, active INTEGER NOT NULL,
 actor_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(ticket_id,record_id,version), FOREIGN KEY(ticket_id,record_id) REFERENCES ticket_change_links(ticket_id,record_id)
);
CREATE TRIGGER cc08_link_created AFTER INSERT ON ticket_change_links BEGIN
 INSERT INTO ticket_change_link_events(ticket_id,record_id,version,active,actor_id) VALUES(NEW.ticket_id,NEW.record_id,NEW.version,NEW.active,NEW.actor_id);
END;
CREATE TRIGGER cc08_link_updated AFTER UPDATE OF active ON ticket_change_links WHEN OLD.active<>NEW.active BEGIN
 SELECT (CASE WHEN NEW.version<>OLD.version+1 THEN RAISE(ABORT,'CHANGE_LINK_VERSION_REQUIRED') END);
 INSERT INTO ticket_change_link_events(ticket_id,record_id,version,active,actor_id) VALUES(NEW.ticket_id,NEW.record_id,NEW.version,NEW.active,NEW.actor_id);
END;
CREATE TRIGGER cc08_link_events_no_update BEFORE UPDATE ON ticket_change_link_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_link_events_no_delete BEFORE DELETE ON ticket_change_link_events BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TABLE change_commands (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX cc08_links_org ON ticket_change_links(organization_id,ticket_id,active);
CREATE INDEX cc08_records_org ON change_records(organization_id,created_at,id);
-- Capture both submitters (and future compatible writers) in the same DB transaction.
CREATE TRIGGER cc08_cr_record AFTER INSERT ON project_change_requests BEGIN
 INSERT INTO change_records(id,organization_id,domain,change_request_id,title,proposal,status,created_by,actor_id)
 VALUES('cr:'||NEW.id,NEW.organization_id,'map_project',NEW.id,'Solicitação de mapa',NEW.reason,'submitted',NEW.requested_by_user_id,NEW.requested_by_user_id);
 INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id)
 SELECT NEW.ticket_id,NEW.organization_id,'cr:'||NEW.id,NEW.requested_by_user_id WHERE NEW.ticket_id IS NOT NULL;
END;
-- Seed linkage without manufacturing delivery or history of decisions.
INSERT INTO change_records(id,organization_id,domain,change_request_id,title,proposal,status,created_by,actor_id)
 SELECT 'cr:'||id,organization_id,'map_project',id,'Solicitação de mapa',reason,'submitted',requested_by_user_id,requested_by_user_id FROM project_change_requests;
INSERT INTO ticket_change_links(ticket_id,organization_id,record_id,actor_id,source_version,source_status)
 SELECT ticket_id,organization_id,'cr:'||id,requested_by_user_id,lifecycle_version,status FROM project_change_requests WHERE ticket_id IS NOT NULL;

CREATE TABLE cc08_cas_guard(value INTEGER NOT NULL CHECK(value=1));
-- Only a generic ticket-level update: no CR content is sent to a recipient.
CREATE TRIGGER cc08_change_notification_snapshot AFTER INSERT ON ticket_command_outbox
WHEN NEW.event_type='ticket.change.updated'
BEGIN
 INSERT OR IGNORE INTO ticket_notification_candidates(outbox_id,recipient_id)
 SELECT NEW.id,u.id FROM organization_tickets t JOIN users u ON u.id IN(t.created_by,t.assigned_to) AND u.active=1
 JOIN organization_users ou ON ou.user_id=u.id AND ou.organization_id=t.organization_id
 JOIN ticket_events e ON e.id=NEW.event_id
 WHERE t.id=NEW.ticket_id AND t.organization_id=NEW.organization_id AND t.active=1 AND u.id IS NOT e.actor_user_id;
END;

CREATE TRIGGER cc08_pending_change_closure BEFORE UPDATE OF status ON organization_tickets
WHEN NEW.status='closed' AND OLD.status<>'closed' AND COALESCE(json_extract(NEW.closure_json,'$.pendingChangeAcknowledged'),0)<>1
AND EXISTS(SELECT 1 FROM ticket_change_links l JOIN change_records c ON c.id=l.record_id AND c.organization_id=l.organization_id
 LEFT JOIN project_change_requests r ON r.id=c.change_request_id
 WHERE l.ticket_id=NEW.id AND l.organization_id=NEW.organization_id AND l.active=1
 AND ((c.domain='map_project' AND r.status NOT IN('applied','rejected','superseded')) OR (c.domain<>'map_project' AND c.status NOT IN('delivered','rejected'))))
BEGIN SELECT RAISE(ABORT,'TICKET_PENDING_CHANGE_ACK_REQUIRED'); END;

CREATE TABLE project_change_request_feedback (
 change_request_id TEXT NOT NULL REFERENCES project_change_requests(id), version INTEGER NOT NULL,
 feedback TEXT NOT NULL CHECK(length(trim(feedback)) BETWEEN 1 AND 2000),actor_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(change_request_id,version)
);
CREATE TABLE project_change_request_lineage (
 previous_id TEXT PRIMARY KEY REFERENCES project_change_requests(id),next_id TEXT UNIQUE NOT NULL REFERENCES project_change_requests(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(previous_id<>next_id)
);
CREATE TRIGGER cc08_feedback_no_update BEFORE UPDATE ON project_change_request_feedback BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_feedback_no_delete BEFORE DELETE ON project_change_request_feedback BEGIN SELECT RAISE(ABORT,'CHANGE_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER cc08_information_approval_guard BEFORE UPDATE OF status ON project_change_requests
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM project_change_request_feedback WHERE change_request_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'CHANGE_INFORMATION_PENDING'); END;

ALTER TABLE ticket_change_links ADD COLUMN reconcile_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticket_change_links ADD COLUMN reconcile_next_at TEXT;
ALTER TABLE ticket_change_links ADD COLUMN reconcile_error TEXT;
CREATE INDEX cc08_reconcile_due ON ticket_change_links(active,reconcile_next_at,updated_at);
