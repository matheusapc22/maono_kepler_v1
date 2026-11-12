-- 0044: empty-organization permanent deletion. No provider action or production rollout.
-- Audit survives physical organization deletion; historical creation identities are retained.
CREATE TABLE organization_deletions (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL UNIQUE, actor_id INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL, requested_version INTEGER NOT NULL, name TEXT NOT NULL,
 slug TEXT NOT NULL, path TEXT NOT NULL, creation_key TEXT, folder_id TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','storage_deleted','completed')),
 not_before TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 minutes')),
 lease_token TEXT, lease_until TEXT, error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT, UNIQUE(actor_id,idempotency_key)
);
CREATE TABLE organization_deletion_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, deletion_id TEXT NOT NULL REFERENCES organization_deletions(id) ON DELETE RESTRICT,
 event_type TEXT NOT NULL, actor_id INTEGER, details_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE organization_deleted_management_events (
 original_id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, actor_id INTEGER,
 request_id TEXT, action TEXT NOT NULL, reason TEXT, version INTEGER NOT NULL,
 before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
);
CREATE TRIGGER org_delete_no_recreate BEFORE INSERT ON organizations
WHEN EXISTS(SELECT 1 FROM organization_deletions d WHERE d.organization_id=NEW.id OR d.slug=NEW.slug OR (d.creation_key IS NOT NULL AND d.creation_key=NEW.management_create_key) OR lower(rtrim(NEW.dropbox_root_path,'/'))=lower(d.path) OR instr(lower(rtrim(NEW.dropbox_root_path,'/')),lower(d.path)||'/')=1 OR instr(lower(d.path),lower(rtrim(NEW.dropbox_root_path,'/'))||'/')=1)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_no_update BEFORE UPDATE ON organizations
WHEN EXISTS(SELECT 1 FROM organization_deletions d WHERE d.organization_id=OLD.id OR d.slug=NEW.slug OR lower(rtrim(NEW.dropbox_root_path,'/'))=lower(d.path) OR instr(lower(rtrim(NEW.dropbox_root_path,'/')),lower(d.path)||'/')=1 OR instr(lower(d.path),lower(rtrim(NEW.dropbox_root_path,'/'))||'/')=1)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_finalize_only BEFORE DELETE ON organizations
WHEN NOT EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.id AND state='storage_deleted')
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_PERMANENT_DELETE_REQUIRED'); END;
CREATE TRIGGER org_delete_guard_organization_users_insert BEFORE INSERT ON "organization_users"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_users_update BEFORE UPDATE ON "organization_users"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_access_delegations_insert BEFORE INSERT ON "organization_access_delegations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_access_delegations_update BEFORE UPDATE ON "organization_access_delegations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_user_permission_denials_insert BEFORE INSERT ON "user_permission_denials"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_user_permission_denials_update BEFORE UPDATE ON "user_permission_denials"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_file_folders_insert BEFORE INSERT ON "organization_file_folders"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_file_folders_update BEFORE UPDATE ON "organization_file_folders"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_files_insert BEFORE INSERT ON "organization_files"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_files_update BEFORE UPDATE ON "organization_files"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_projects_insert BEFORE INSERT ON "projects"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_projects_update BEFORE UPDATE ON "projects"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_resource_reservations_insert BEFORE INSERT ON "organization_resource_reservations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_resource_reservations_update BEFORE UPDATE ON "organization_resource_reservations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_map_analysis_rate_limits_insert BEFORE INSERT ON "map_analysis_rate_limits"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_map_analysis_rate_limits_update BEFORE UPDATE ON "map_analysis_rate_limits"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_tickets_insert BEFORE INSERT ON "organization_tickets"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_tickets_update BEFORE UPDATE ON "organization_tickets"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_attachments_insert BEFORE INSERT ON "ticket_attachments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_attachments_update BEFORE UPDATE ON "ticket_attachments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_events_insert BEFORE INSERT ON "ticket_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_events_update BEFORE UPDATE ON "ticket_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_command_backfills_insert BEFORE INSERT ON "ticket_command_backfills"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_command_backfills_update BEFORE UPDATE ON "ticket_command_backfills"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_commands_insert BEFORE INSERT ON "ticket_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_commands_update BEFORE UPDATE ON "ticket_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_cycles_insert BEFORE INSERT ON "ticket_cycles"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_cycles_update BEFORE UPDATE ON "ticket_cycles"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_wait_intervals_insert BEFORE INSERT ON "ticket_wait_intervals"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_wait_intervals_update BEFORE UPDATE ON "ticket_wait_intervals"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_command_outbox_insert BEFORE INSERT ON "ticket_command_outbox"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_command_outbox_update BEFORE UPDATE ON "ticket_command_outbox"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_groups_insert BEFORE INSERT ON "ticket_access_groups"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_groups_update BEFORE UPDATE ON "ticket_access_groups"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_group_members_insert BEFORE INSERT ON "ticket_access_group_members"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_group_members_update BEFORE UPDATE ON "ticket_access_group_members"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_policies_insert BEFORE INSERT ON "ticket_access_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_policies_update BEFORE UPDATE ON "ticket_access_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_policy_entries_insert BEFORE INSERT ON "ticket_access_policy_entries"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_access_policy_entries_update BEFORE UPDATE ON "ticket_access_policy_entries"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_ticket_access_policies_insert BEFORE INSERT ON "ticket_ticket_access_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_ticket_access_policies_update BEFORE UPDATE ON "ticket_ticket_access_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_acl_entries_insert BEFORE INSERT ON "ticket_acl_entries"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_acl_entries_update BEFORE UPDATE ON "ticket_acl_entries"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_labels_insert BEFORE INSERT ON "ticket_labels"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_labels_update BEFORE UPDATE ON "ticket_labels"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_label_links_insert BEFORE INSERT ON "ticket_label_links"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_label_links_update BEFORE UPDATE ON "ticket_label_links"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_messages_insert BEFORE INSERT ON "ticket_messages"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_messages_update BEFORE UPDATE ON "ticket_messages"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_message_revisions_insert BEFORE INSERT ON "ticket_message_revisions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_message_revisions_update BEFORE UPDATE ON "ticket_message_revisions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_drafts_insert BEFORE INSERT ON "ticket_drafts"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_drafts_update BEFORE UPDATE ON "ticket_drafts"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_attachment_upload_sessions_insert BEFORE INSERT ON "ticket_attachment_upload_sessions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_attachment_upload_sessions_update BEFORE UPDATE ON "ticket_attachment_upload_sessions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_notifications_insert BEFORE INSERT ON "ticket_notifications"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_notifications_update BEFORE UPDATE ON "ticket_notifications"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_project_change_requests_insert BEFORE INSERT ON "project_change_requests"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_project_change_requests_update BEFORE UPDATE ON "project_change_requests"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_change_records_insert BEFORE INSERT ON "change_records"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_change_records_update BEFORE UPDATE ON "change_records"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_change_links_insert BEFORE INSERT ON "ticket_change_links"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_change_links_update BEFORE UPDATE ON "ticket_change_links"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_change_commands_insert BEFORE INSERT ON "change_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_change_commands_update BEFORE UPDATE ON "change_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_query_snapshots_insert BEFORE INSERT ON "ticket_query_snapshots"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_query_snapshots_update BEFORE UPDATE ON "ticket_query_snapshots"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_queue_policies_insert BEFORE INSERT ON "ticket_queue_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_queue_policies_update BEFORE UPDATE ON "ticket_queue_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_sla_policies_insert BEFORE INSERT ON "ticket_sla_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_sla_policies_update BEFORE UPDATE ON "ticket_sla_policies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_sla_assignments_insert BEFORE INSERT ON "ticket_sla_assignments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_sla_assignments_update BEFORE UPDATE ON "ticket_sla_assignments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_metric_definitions_insert BEFORE INSERT ON "ticket_metric_definitions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_metric_definitions_update BEFORE UPDATE ON "ticket_metric_definitions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_metric_rollups_insert BEFORE INSERT ON "ticket_metric_rollups"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_metric_rollups_update BEFORE UPDATE ON "ticket_metric_rollups"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_metric_checkpoints_insert BEFORE INSERT ON "ticket_metric_checkpoints"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_metric_checkpoints_update BEFORE UPDATE ON "ticket_metric_checkpoints"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_jobs_insert BEFORE INSERT ON "ticket_export_jobs"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_jobs_update BEFORE UPDATE ON "ticket_export_jobs"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_items_insert BEFORE INSERT ON "ticket_export_items"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_items_update BEFORE UPDATE ON "ticket_export_items"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_parts_insert BEFORE INSERT ON "ticket_export_parts"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_parts_update BEFORE UPDATE ON "ticket_export_parts"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_audit_insert BEFORE INSERT ON "ticket_export_audit"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_audit_update BEFORE UPDATE ON "ticket_export_audit"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_gc_insert BEFORE INSERT ON "ticket_export_gc"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_export_gc_update BEFORE UPDATE ON "ticket_export_gc"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_cases_insert BEFORE INSERT ON "ticket_cases"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_cases_update BEFORE UPDATE ON "ticket_cases"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_members_insert BEFORE INSERT ON "ticket_case_members"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_members_update BEFORE UPDATE ON "ticket_case_members"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_links_insert BEFORE INSERT ON "ticket_case_links"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_links_update BEFORE UPDATE ON "ticket_case_links"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_commands_insert BEFORE INSERT ON "ticket_case_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_commands_update BEFORE UPDATE ON "ticket_case_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_events_insert BEFORE INSERT ON "ticket_case_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_case_events_update BEFORE UPDATE ON "ticket_case_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_articles_insert BEFORE INSERT ON "ticket_knowledge_articles"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_articles_update BEFORE UPDATE ON "ticket_knowledge_articles"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_revisions_insert BEFORE INSERT ON "ticket_knowledge_revisions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_revisions_update BEFORE UPDATE ON "ticket_knowledge_revisions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_sources_insert BEFORE INSERT ON "ticket_knowledge_sources"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_sources_update BEFORE UPDATE ON "ticket_knowledge_sources"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_commands_insert BEFORE INSERT ON "ticket_knowledge_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_commands_update BEFORE UPDATE ON "ticket_knowledge_commands"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_events_insert BEFORE INSERT ON "ticket_knowledge_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_events_update BEFORE UPDATE ON "ticket_knowledge_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_uses_insert BEFORE INSERT ON "ticket_knowledge_uses"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_knowledge_uses_update BEFORE UPDATE ON "ticket_knowledge_uses"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_feedback_instruments_insert BEFORE INSERT ON "ticket_feedback_instruments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_feedback_instruments_update BEFORE UPDATE ON "ticket_feedback_instruments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_feedback_invites_insert BEFORE INSERT ON "ticket_feedback_invites"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_ticket_feedback_invites_update BEFORE UPDATE ON "ticket_feedback_invites"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_user_permissions_insert BEFORE INSERT ON "user_permissions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_user_permissions_update BEFORE UPDATE ON "user_permissions"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_project_save_operations_insert BEFORE INSERT ON "project_save_operations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_project_save_operations_update BEFORE UPDATE ON "project_save_operations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_project_preview_operations_insert BEFORE INSERT ON "project_preview_operations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_project_preview_operations_update BEFORE UPDATE ON "project_preview_operations"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_limit_requests_insert BEFORE INSERT ON "organization_limit_requests"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_limit_requests_update BEFORE UPDATE ON "organization_limit_requests"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
