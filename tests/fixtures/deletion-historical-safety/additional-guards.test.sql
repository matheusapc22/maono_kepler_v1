-- TEST ONLY: candidate historical guard extension. Not a migration or operational profile.
CREATE TRIGGER org_delete_guard_organization_exports_insert BEFORE INSERT ON "organization_exports"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_exports_update BEFORE UPDATE ON "organization_exports"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_feature_flags_insert BEFORE INSERT ON "organization_feature_flags"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_feature_flags_update BEFORE UPDATE ON "organization_feature_flags"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_limits_insert BEFORE INSERT ON "organization_limits"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_limits_update BEFORE UPDATE ON "organization_limits"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_roadmaps_insert BEFORE INSERT ON "organization_roadmaps"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_organization_roadmaps_update BEFORE UPDATE ON "organization_roadmaps"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_comments_insert BEFORE INSERT ON "roadmap_comments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_comments_update BEFORE UPDATE ON "roadmap_comments"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_dependencies_insert BEFORE INSERT ON "roadmap_dependencies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_dependencies_update BEFORE UPDATE ON "roadmap_dependencies"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_events_insert BEFORE INSERT ON "roadmap_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_events_update BEFORE UPDATE ON "roadmap_events"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_phases_insert BEFORE INSERT ON "roadmap_phases"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_phases_update BEFORE UPDATE ON "roadmap_phases"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_tasks_insert BEFORE INSERT ON "roadmap_tasks"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_roadmap_tasks_update BEFORE UPDATE ON "roadmap_tasks"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_tickets_insert BEFORE INSERT ON "tickets"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
CREATE TRIGGER org_delete_guard_tickets_update BEFORE UPDATE ON "tickets"
WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE organization_id=OLD.organization_id OR organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DELETION_LOCKED'); END;
