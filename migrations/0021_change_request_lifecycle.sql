-- Apply once, after 0020, before enabling the new Review writers.
-- D1 migrations provide the transaction. No automatic DDL in request handlers.
ALTER TABLE project_change_requests ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0);
ALTER TABLE project_change_requests ADD COLUMN decision TEXT CHECK (decision IN ('approved', 'rejected'));
ALTER TABLE project_change_requests ADD COLUMN feedback TEXT CHECK (feedback IS NULL OR length(feedback) <= 2000);
ALTER TABLE project_change_requests ADD COLUMN decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_change_requests ADD COLUMN decided_at TEXT;
ALTER TABLE project_change_requests ADD COLUMN transition_actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_change_requests ADD COLUMN applied_revision INTEGER;

-- Recover only recorded legacy evidence. Missing feedback/actor/time stays NULL.
UPDATE project_change_requests SET
  decision = CASE WHEN status = 'rejected' THEN 'rejected'
                  WHEN status IN ('approved','applying','applied') THEN 'approved'
                  WHEN EXISTS (SELECT 1 FROM ticket_events e WHERE e.ticket_id = project_change_requests.ticket_id
                    AND e.organization_id = project_change_requests.organization_id
                    AND e.event_type = 'project.change_request.approved') THEN 'approved' ELSE NULL END,
  feedback = CASE WHEN status = 'rejected' THEN (SELECT substr(json_extract(e.metadata, '$.comment'), 1, 2000) FROM ticket_events e
    WHERE e.ticket_id = project_change_requests.ticket_id AND e.organization_id = project_change_requests.organization_id
      AND e.event_type = 'project.change_request.rejected' AND json_valid(e.metadata)
    ORDER BY e.id DESC LIMIT 1) ELSE NULL END,
  decided_by_user_id = (SELECT e.actor_user_id FROM ticket_events e
    WHERE e.ticket_id = project_change_requests.ticket_id AND e.organization_id = project_change_requests.organization_id
      AND e.event_type IN ('project.change_request.approved','project.change_request.rejected')
    ORDER BY e.id DESC LIMIT 1),
  decided_at = (SELECT e.created_at FROM ticket_events e
    WHERE e.ticket_id = project_change_requests.ticket_id AND e.organization_id = project_change_requests.organization_id
      AND e.event_type IN ('project.change_request.approved','project.change_request.rejected')
    ORDER BY e.id DESC LIMIT 1),
  applied_revision = CASE WHEN status = 'applied' THEN base_revision + 1 ELSE NULL END;

CREATE TABLE project_change_request_events (
  change_request_id TEXT NOT NULL REFERENCES project_change_requests(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (change_request_id, version)
);
INSERT INTO project_change_request_events (change_request_id,version,to_status)
  SELECT id,lifecycle_version,status FROM project_change_requests;

UPDATE organization_tickets SET
  status = (SELECT CASE r.status WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review'
    WHEN 'approved' THEN 'in_review' WHEN 'applying' THEN 'in_progress' ELSE 'closed' END
    FROM project_change_requests r WHERE r.ticket_id = organization_tickets.id AND r.organization_id = organization_tickets.organization_id),
  closed_at = CASE WHEN EXISTS (SELECT 1 FROM project_change_requests r WHERE r.ticket_id = organization_tickets.id
    AND r.status IN ('applied','rejected','conflict','superseded')) THEN COALESCE(closed_at, CURRENT_TIMESTAMP) ELSE NULL END
WHERE EXISTS (SELECT 1 FROM project_change_requests r WHERE r.ticket_id = organization_tickets.id
  AND r.organization_id = organization_tickets.organization_id);

CREATE TRIGGER trg_change_request_lifecycle_guard
BEFORE UPDATE OF status, lifecycle_version, decision, feedback, decided_by_user_id, decided_at, applied_revision ON project_change_requests
BEGIN
  -- Preserve attribution; FK ON DELETE SET NULL remains allowed after user deletion.
  SELECT CASE WHEN NEW.decided_by_user_id IS NOT OLD.decided_by_user_id
    AND (OLD.decision IS NOT NULL OR NEW.status = OLD.status)
    AND (NEW.decided_by_user_id IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE id = OLD.decided_by_user_id))
    THEN RAISE(ABORT, 'CHANGE_REQUEST_DECISION_IMMUTABLE') END;
  SELECT CASE WHEN NEW.status <> OLD.status AND NOT (
    (OLD.status = 'submitted' AND NEW.status IN ('under_review','rejected','superseded')) OR
    (OLD.status = 'under_review' AND NEW.status IN ('approved','rejected','conflict')) OR
    (OLD.status = 'approved' AND NEW.status IN ('applying','conflict')) OR
    (OLD.status = 'applying' AND NEW.status IN ('applied','conflict'))
  ) THEN RAISE(ABORT, 'CHANGE_REQUEST_INVALID_TRANSITION') END;
  SELECT CASE WHEN NEW.status <> OLD.status AND NEW.lifecycle_version <> OLD.lifecycle_version + 1
    THEN RAISE(ABORT, 'CHANGE_REQUEST_LIFECYCLE_VERSION_REQUIRED') END;
  SELECT CASE WHEN NEW.status = OLD.status AND (
    NEW.lifecycle_version <> OLD.lifecycle_version OR NEW.decision IS NOT OLD.decision OR
    NEW.feedback IS NOT OLD.feedback OR NEW.decided_at IS NOT OLD.decided_at OR NEW.applied_revision IS NOT OLD.applied_revision)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_LIFECYCLE_IMMUTABLE') END;
  SELECT CASE WHEN OLD.decision IS NOT NULL AND (NEW.decision IS NOT OLD.decision OR
    NEW.feedback IS NOT OLD.feedback OR NEW.decided_at IS NOT OLD.decided_at)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_DECISION_IMMUTABLE') END;
  SELECT CASE WHEN NEW.status IN ('approved','applying','applied') AND NEW.decision IS NOT 'approved'
    THEN RAISE(ABORT, 'CHANGE_REQUEST_APPROVAL_REQUIRED') END;
  SELECT CASE WHEN NEW.status = 'rejected' AND OLD.status <> 'rejected' AND
    (NEW.decision IS NOT 'rejected' OR length(trim(COALESCE(NEW.feedback,''))) = 0)
    THEN RAISE(ABORT, 'CHANGE_REQUEST_REJECTION_REASON_REQUIRED') END;
  SELECT CASE WHEN NEW.status = 'applied' AND NEW.applied_revision IS NOT NEW.base_revision + 1
    THEN RAISE(ABORT, 'CHANGE_REQUEST_APPLIED_REVISION_REQUIRED') END;
END;

CREATE TRIGGER trg_change_request_lifecycle_sync
AFTER UPDATE OF status ON project_change_requests WHEN NEW.status <> OLD.status
BEGIN
  INSERT INTO project_change_request_events(change_request_id,version,from_status,to_status,actor_user_id)
    VALUES (NEW.id,NEW.lifecycle_version,OLD.status,NEW.status,NEW.transition_actor_user_id);
  UPDATE organization_tickets SET status = CASE NEW.status
    WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review' WHEN 'approved' THEN 'in_review'
    WHEN 'applying' THEN 'in_progress' ELSE 'closed' END,
    closed_at = CASE WHEN NEW.status IN ('applied','rejected','conflict','superseded') THEN CURRENT_TIMESTAMP ELSE NULL END,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.ticket_id AND organization_id = NEW.organization_id;
  INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata)
    SELECT NEW.organization_id,NEW.ticket_id,'project.change_request.lifecycle_changed',NEW.transition_actor_user_id,
      json_object('changeRequestId',NEW.id,'version',NEW.lifecycle_version,'from',OLD.status,'to',NEW.status)
    WHERE NEW.ticket_id IS NOT NULL;
END;

CREATE TRIGGER trg_change_request_lifecycle_created
AFTER INSERT ON project_change_requests
BEGIN
  INSERT INTO project_change_request_events(change_request_id,version,to_status,actor_user_id)
    VALUES (NEW.id,NEW.lifecycle_version,NEW.status,NEW.requested_by_user_id);
END;

CREATE TRIGGER trg_ticket_change_request_status_guard
BEFORE UPDATE OF status,closed_at ON organization_tickets
WHEN EXISTS (SELECT 1 FROM project_change_requests r WHERE r.ticket_id = NEW.id AND r.organization_id = NEW.organization_id
  AND (NEW.status <> CASE r.status WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review'
    WHEN 'approved' THEN 'in_review' WHEN 'applying' THEN 'in_progress' ELSE 'closed' END
    OR (NEW.status = 'closed' AND NEW.closed_at IS NULL) OR (NEW.status <> 'closed' AND NEW.closed_at IS NOT NULL)))
BEGIN SELECT RAISE(ABORT, 'TICKET_CHANGE_REQUEST_LIFECYCLE_MANAGED'); END;
