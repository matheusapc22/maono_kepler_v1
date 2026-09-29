-- CC-12 additive export jobs. No production defaults, no backfill, no remote application.
-- PREPARE -> local -> protected audit -> explicit hash authorization -> isolated apply.
CREATE TABLE ticket_export_generation (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0);
INSERT INTO ticket_export_generation(id,version) VALUES(1,0);
CREATE TABLE ticket_export_jobs (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 state TEXT NOT NULL CHECK(state IN ('queued','capturing','running','ready','failed','cancelled','expired','revoked')),
 generation INTEGER NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, expected_rows INTEGER NOT NULL DEFAULT 0,
 captured_rows INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, part_count INTEGER NOT NULL DEFAULT 0,
 token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT,
 error_code TEXT, manifest_json TEXT CHECK(manifest_json IS NULL OR json_valid(manifest_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(organization_id,actor_id,request_id), UNIQUE(id,organization_id),
 CHECK(captured_rows>=0 AND expected_rows>=0 AND captured_rows<=expected_rows), CHECK(bytes>=0)
);
CREATE INDEX idx_ticket_export_queue ON ticket_export_jobs(state,next_at,lease_until,created_at);
CREATE INDEX idx_ticket_export_owner ON ticket_export_jobs(organization_id,actor_id,created_at DESC,id);
CREATE TABLE ticket_export_items (
 job_id TEXT NOT NULL, organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL,
 fact_json TEXT NOT NULL CHECK(json_valid(fact_json)), source_hash TEXT NOT NULL,
 domain TEXT NOT NULL, nature TEXT NOT NULL, policy_versions TEXT NOT NULL CHECK(json_valid(policy_versions)),
 PRIMARY KEY(job_id,ticket_id),
 FOREIGN KEY(job_id,organization_id) REFERENCES ticket_export_jobs(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE ticket_export_parts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, organization_id INTEGER NOT NULL, ordinal INTEGER NOT NULL,
 csv TEXT NOT NULL CHECK(length(CAST(csv AS BLOB))<=1048576), bytes INTEGER NOT NULL CHECK(bytes>=0 AND bytes<=1048576),
 sha256 TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
 UNIQUE(job_id,ordinal), FOREIGN KEY(job_id,organization_id) REFERENCES ticket_export_jobs(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE ticket_export_audit (
 id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, organization_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
 action TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_export_audit_job ON ticket_export_audit(job_id,created_at);
CREATE TRIGGER ticket_export_items_immutable BEFORE UPDATE ON ticket_export_items
BEGIN SELECT RAISE(ABORT,'TICKET_EXPORT_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER ticket_export_parts_immutable BEFORE UPDATE OF csv,bytes,sha256,job_id,organization_id,ordinal ON ticket_export_parts
BEGIN SELECT RAISE(ABORT,'TICKET_EXPORT_PART_IMMUTABLE'); END;
CREATE TRIGGER ticket_export_epoch_organization_tickets_insert AFTER INSERT ON organization_tickets
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_tickets_update AFTER UPDATE ON organization_tickets
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_tickets_delete AFTER DELETE ON organization_tickets
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cycles_insert AFTER INSERT ON ticket_cycles
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cycles_update AFTER UPDATE ON ticket_cycles
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cycles_delete AFTER DELETE ON ticket_cycles
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_events_insert AFTER INSERT ON ticket_events
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_events_update AFTER UPDATE ON ticket_events
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_events_delete AFTER DELETE ON ticket_events
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_wait_intervals_insert AFTER INSERT ON ticket_wait_intervals
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_wait_intervals_update AFTER UPDATE ON ticket_wait_intervals
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_wait_intervals_delete AFTER DELETE ON ticket_wait_intervals
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_messages_insert AFTER INSERT ON ticket_messages
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_messages_update AFTER UPDATE ON ticket_messages
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_messages_delete AFTER DELETE ON ticket_messages
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_message_revisions_insert AFTER INSERT ON ticket_message_revisions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_message_revisions_update AFTER UPDATE ON ticket_message_revisions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_message_revisions_delete AFTER DELETE ON ticket_message_revisions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_commands_insert AFTER INSERT ON ticket_commands
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_commands_update AFTER UPDATE ON ticket_commands
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_commands_delete AFTER DELETE ON ticket_commands
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_assignments_insert AFTER INSERT ON ticket_sla_assignments
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_assignments_update AFTER UPDATE ON ticket_sla_assignments
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_assignments_delete AFTER DELETE ON ticket_sla_assignments
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_policies_insert AFTER INSERT ON ticket_sla_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_policies_update AFTER UPDATE ON ticket_sla_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_sla_policies_delete AFTER DELETE ON ticket_sla_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_metric_definitions_insert AFTER INSERT ON ticket_metric_definitions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_metric_definitions_update AFTER UPDATE ON ticket_metric_definitions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_metric_definitions_delete AFTER DELETE ON ticket_metric_definitions
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_acl_entries_insert AFTER INSERT ON ticket_acl_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_acl_entries_update AFTER UPDATE ON ticket_acl_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_acl_entries_delete AFTER DELETE ON ticket_acl_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_ticket_access_policies_insert AFTER INSERT ON ticket_ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_ticket_access_policies_update AFTER UPDATE ON ticket_ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_ticket_access_policies_delete AFTER DELETE ON ticket_ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policies_insert AFTER INSERT ON ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policies_update AFTER UPDATE ON ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policies_delete AFTER DELETE ON ticket_access_policies
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policy_entries_insert AFTER INSERT ON ticket_access_policy_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policy_entries_update AFTER UPDATE ON ticket_access_policy_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_policy_entries_delete AFTER DELETE ON ticket_access_policy_entries
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_groups_insert AFTER INSERT ON ticket_access_groups
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_groups_update AFTER UPDATE ON ticket_access_groups
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_groups_delete AFTER DELETE ON ticket_access_groups
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_group_members_insert AFTER INSERT ON ticket_access_group_members
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_group_members_update AFTER UPDATE ON ticket_access_group_members
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_access_group_members_delete AFTER DELETE ON ticket_access_group_members
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_users_insert AFTER INSERT ON organization_users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_users_update AFTER UPDATE ON organization_users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organization_users_delete AFTER DELETE ON organization_users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organizations_insert AFTER INSERT ON organizations
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organizations_update AFTER UPDATE ON organizations
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_organizations_delete AFTER DELETE ON organizations
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_users_insert AFTER INSERT ON users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_users_update AFTER UPDATE ON users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_users_delete AFTER DELETE ON users
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;

-- Metadata-only orphan cleanup tombstones. No report content retained here.
CREATE TABLE ticket_export_gc (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, organization_id INTEGER NOT NULL,
 next_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_export_gc_due ON ticket_export_gc(organization_id,next_at,id);

-- Explicit permission denials invalidate an in-flight capture.
CREATE TRIGGER ticket_export_epoch_user_permission_denials_insert AFTER INSERT ON user_permission_denials
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_user_permission_denials_update AFTER UPDATE ON user_permission_denials
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_user_permission_denials_delete AFTER DELETE ON user_permission_denials
BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
