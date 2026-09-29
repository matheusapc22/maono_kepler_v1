-- CC11 expand only. No feature activation, inferred history, SLA targets or horizon seeded.
CREATE TABLE ticket_metric_definitions (
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1), dictionary_version INTEGER NOT NULL CHECK(dictionary_version=1),
 reopen_hours INTEGER NOT NULL CHECK(reopen_hours BETWEEN 1 AND 8760),
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000), published_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,version), UNIQUE(organization_id,request_id)
);
CREATE TRIGGER ticket_metric_definition_sequence BEFORE INSERT ON ticket_metric_definitions
WHEN NEW.version<>COALESCE((SELECT MAX(version) FROM ticket_metric_definitions WHERE organization_id=NEW.organization_id),0)+1
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_VERSION_CONFLICT'); END;
CREATE TRIGGER ticket_metric_definition_no_update BEFORE UPDATE ON ticket_metric_definitions
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_DEFINITION_IMMUTABLE'); END;
CREATE TRIGGER ticket_metric_definition_no_delete BEFORE DELETE ON ticket_metric_definitions
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_DEFINITION_IMMUTABLE'); END;
CREATE TABLE ticket_metric_rollups (
 organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL,
 dictionary_version INTEGER NOT NULL CHECK(dictionary_version=1), definition_version INTEGER NOT NULL CHECK(definition_version>=0),
 window_json TEXT NOT NULL CHECK(json_valid(window_json)), source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 facts_json TEXT NOT NULL CHECK(json_valid(facts_json)), watermark INTEGER NOT NULL CHECK(watermark>=0),
 revision INTEGER NOT NULL CHECK(revision>=1), built_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,ticket_id),
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE ticket_metric_checkpoints (
 organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, revision INTEGER NOT NULL,
 source_hash TEXT NOT NULL, previous_hash TEXT, watermark INTEGER NOT NULL,
 dictionary_version INTEGER NOT NULL, definition_version INTEGER NOT NULL,
 window_json TEXT NOT NULL CHECK(json_valid(window_json)), quality_json TEXT NOT NULL CHECK(json_valid(quality_json)),
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, built_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,ticket_id,revision),
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id) ON DELETE RESTRICT
);
CREATE TRIGGER ticket_metric_checkpoint_no_update BEFORE UPDATE ON ticket_metric_checkpoints
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_CHECKPOINT_IMMUTABLE'); END;
CREATE TRIGGER ticket_metric_checkpoint_no_delete BEFORE DELETE ON ticket_metric_checkpoints
BEGIN SELECT RAISE(ABORT,'TICKET_METRICS_CHECKPOINT_IMMUTABLE'); END;
CREATE INDEX idx_ticket_metric_checkpoints_partition ON ticket_metric_checkpoints(organization_id,ticket_id,built_at);
