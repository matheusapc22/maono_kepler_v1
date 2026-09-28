-- CC-09: additive schema; no production limits or historical ages are invented.
CREATE TABLE ticket_query_snapshots (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 query_key TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_snapshot_expiry ON ticket_query_snapshots(expires_at);
CREATE INDEX idx_ticket_snapshot_owner ON ticket_query_snapshots(organization_id,user_id,expires_at);
CREATE TABLE ticket_query_snapshot_items (
 snapshot_id TEXT NOT NULL REFERENCES ticket_query_snapshots(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, ticket_id INTEGER NOT NULL,
 queue TEXT NOT NULL, queue_ordinal INTEGER NOT NULL,
 PRIMARY KEY(snapshot_id, ordinal), UNIQUE(snapshot_id, ticket_id)
);
CREATE INDEX idx_ticket_snapshot_queue ON ticket_query_snapshot_items(snapshot_id,queue,queue_ordinal);
CREATE TABLE ticket_queue_policies (
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 queue TEXT NOT NULL CHECK(queue IN ('in_progress','in_review')),
 wip_limit INTEGER CHECK(wip_limit IS NULL OR wip_limit BETWEEN 1 AND 10000),
 version INTEGER NOT NULL DEFAULT 1, updated_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL, change_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,queue)
);
ALTER TABLE organization_tickets ADD COLUMN queue_entered_at TEXT;
CREATE INDEX idx_ticket_flow_queue ON organization_tickets(organization_id,active,status,id);
CREATE TRIGGER ticket_flow_queue_entry AFTER UPDATE OF status ON organization_tickets
WHEN NEW.status <> OLD.status
BEGIN
 UPDATE organization_tickets SET queue_entered_at = NEW.updated_at WHERE id = NEW.id AND organization_id = NEW.organization_id;
END;
CREATE TRIGGER ticket_flow_initial_entry AFTER INSERT ON organization_tickets
BEGIN
 UPDATE organization_tickets SET queue_entered_at = NEW.created_at WHERE id = NEW.id AND organization_id = NEW.organization_id;
END;
