-- Additive management schema. Apply ONLY through the authorized migration operator.
-- Precondition: schema at product baseline 381c932 (including 0007 and 0016).
ALTER TABLE organizations ADD COLUMN plan TEXT CHECK (plan IS NULL OR plan IN ('free','pro','enterprise'));
ALTER TABLE organizations ADD COLUMN project_limit INTEGER CHECK (project_limit IS NULL OR project_limit > 0);
ALTER TABLE organizations ADD COLUMN management_owner_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE organizations ADD COLUMN management_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN management_create_key TEXT;
ALTER TABLE organizations ADD COLUMN management_actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN management_request_id TEXT;
ALTER TABLE organizations ADD COLUMN management_action TEXT;
ALTER TABLE organizations ADD COLUMN management_reason TEXT;
ALTER TABLE organization_limit_requests ADD COLUMN requested_limits_json TEXT;
ALTER TABLE organization_limit_requests ADD COLUMN review_operation_key TEXT;
ALTER TABLE organization_limit_requests ADD COLUMN management_version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_org_management_creation ON organizations(management_create_key) WHERE management_create_key IS NOT NULL;
CREATE INDEX idx_org_management_plan_active ON organizations(plan,active,id);

CREATE TABLE organization_management_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 request_id TEXT, action TEXT NOT NULL, reason TEXT, version INTEGER NOT NULL,
 before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_org_management_events_org ON organization_management_events(organization_id,id DESC);
CREATE INDEX idx_org_management_events_request ON organization_management_events(request_id,organization_id);

CREATE TABLE organization_management_operations (
 id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, kind TEXT NOT NULL,
 payload_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(actor_id,idempotency_key), CHECK(kind IN ('create','import','change','pause','resume','review'))
);
CREATE TABLE organization_management_operation_items (
 operation_id TEXT NOT NULL REFERENCES organization_management_operations(id) ON DELETE CASCADE,
 item_index INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 result_json TEXT, error_code TEXT, error_message TEXT, retryable INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(operation_id,item_index),
 CHECK(state IN ('pending','running','succeeded','partial','failed'))
);
CREATE INDEX idx_org_management_operation_actor ON organization_management_operations(actor_id,created_at DESC);

-- Audit/version changes are part of the same transaction as the metadata change.
CREATE TRIGGER org_management_created AFTER INSERT ON organizations
WHEN NEW.management_create_key IS NOT NULL BEGIN
 INSERT INTO organization_management_events(organization_id,actor_id,request_id,action,reason,version,after_json)
 VALUES(NEW.id,NEW.management_actor_id,NEW.management_request_id,'organization.created',NEW.management_reason,NEW.management_version,
 json_object('name',NEW.name,'description',NEW.description,'active',NEW.active,'plan',NEW.plan,'ownerId',NEW.management_owner_id));
END;
CREATE TRIGGER org_management_updated AFTER UPDATE OF management_version ON organizations
WHEN NEW.management_version > OLD.management_version
 AND NEW.management_action IS NOT 'organization.legacy_updated' BEGIN
 INSERT INTO organization_management_events(organization_id,actor_id,request_id,action,reason,version,before_json,after_json)
 VALUES(NEW.id,NEW.management_actor_id,NEW.management_request_id,COALESCE(NEW.management_action,'organization.updated'),NEW.management_reason,NEW.management_version,
 json_object('name',OLD.name,'description',OLD.description,'active',OLD.active,'plan',OLD.plan,'projectLimit',OLD.project_limit,'ownerId',OLD.management_owner_id),
 json_object('name',NEW.name,'description',NEW.description,'active',NEW.active,'plan',NEW.plan,'projectLimit',NEW.project_limit,'ownerId',NEW.management_owner_id));
END;
-- Older writers also invalidate client versions; never attribute their writes to
-- the previous actor/request. Storage observations alone do not bump versions.
CREATE TRIGGER org_management_legacy_version AFTER UPDATE OF name,description,active,slug,dropbox_root_path,plan,project_limit,management_owner_id ON organizations
WHEN NEW.management_version = OLD.management_version AND
 (NEW.name IS NOT OLD.name OR NEW.description IS NOT OLD.description OR NEW.active IS NOT OLD.active OR NEW.slug IS NOT OLD.slug OR NEW.dropbox_root_path IS NOT OLD.dropbox_root_path OR NEW.plan IS NOT OLD.plan OR NEW.project_limit IS NOT OLD.project_limit OR NEW.management_owner_id IS NOT OLD.management_owner_id)
BEGIN
 UPDATE organizations SET management_version=OLD.management_version+1,management_actor_id=NULL,
 management_request_id=NULL,management_reason=NULL,management_action='organization.legacy_updated' WHERE id=NEW.id;
 INSERT INTO organization_management_events(organization_id,action,version,before_json,after_json)
 VALUES(NEW.id,'organization.legacy_updated',OLD.management_version+1,
 json_object('name',OLD.name,'description',OLD.description,'active',OLD.active,'plan',OLD.plan,'projectLimit',OLD.project_limit,'ownerId',OLD.management_owner_id),
 json_object('name',NEW.name,'description',NEW.description,'active',NEW.active,'plan',NEW.plan,'projectLimit',NEW.project_limit,'ownerId',NEW.management_owner_id));
END;
CREATE TRIGGER org_management_owner_insert BEFORE INSERT ON organizations
WHEN NEW.management_owner_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM organization_users m JOIN users u ON u.id=m.user_id
 WHERE m.organization_id=NEW.id AND m.user_id=NEW.management_owner_id AND m.access_level='owner' AND u.active=1
) BEGIN SELECT RAISE(ABORT,'MANAGEMENT_OWNER_INELIGIBLE'); END;
CREATE TRIGGER org_management_owner_valid BEFORE UPDATE OF management_owner_id ON organizations
WHEN NEW.management_owner_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM organization_users m JOIN users u ON u.id=m.user_id
 WHERE m.organization_id=NEW.id AND m.user_id=NEW.management_owner_id AND m.access_level='owner' AND u.active=1
) BEGIN SELECT RAISE(ABORT,'MANAGEMENT_OWNER_INELIGIBLE'); END;
CREATE TRIGGER org_management_owner_delete BEFORE DELETE ON organization_users
WHEN EXISTS(SELECT 1 FROM organizations WHERE id=OLD.organization_id AND management_owner_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'MANAGEMENT_OWNER_REASSIGN_REQUIRED'); END;
CREATE TRIGGER org_management_owner_change BEFORE UPDATE OF user_id,access_level,organization_id ON organization_users
WHEN (NEW.access_level<>'owner' OR NEW.user_id<>OLD.user_id OR NEW.organization_id<>OLD.organization_id)
 AND EXISTS(SELECT 1 FROM organizations WHERE id=OLD.organization_id AND management_owner_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'MANAGEMENT_OWNER_REASSIGN_REQUIRED'); END;
CREATE TRIGGER org_management_owner_deactivate BEFORE UPDATE OF active ON users
WHEN NEW.active<>1 AND EXISTS(SELECT 1 FROM organizations WHERE management_owner_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'MANAGEMENT_OWNER_REASSIGN_REQUIRED'); END;

-- Only a guard table; the trigger consumes successful assertion rows.
CREATE TABLE organization_management_assertions(ok INTEGER NOT NULL CHECK(ok=1));
CREATE TRIGGER org_management_assertion_cleanup AFTER INSERT ON organization_management_assertions
BEGIN DELETE FROM organization_management_assertions; END;
-- Prevent an older quota reservation request (which read the previous limit)
-- from winning after a concurrent administrative downgrade.
CREATE TRIGGER org_management_quota_reserve_insert BEFORE INSERT ON organization_resource_reservations
WHEN NEW.resource_type='project' AND NEW.status IN ('RESERVED','PROCESSING')
 AND NEW.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND (SELECT project_limit FROM organizations WHERE id=NEW.organization_id) IS NOT NULL
 AND (SELECT COUNT(*) FROM projects WHERE organization_id=NEW.organization_id AND active=1)+
 (SELECT COUNT(*) FROM organization_resource_reservations WHERE organization_id=NEW.organization_id AND resource_type='project' AND status IN ('RESERVED','PROCESSING') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 >= (SELECT project_limit FROM organizations WHERE id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_PROJECT_LIMIT_REACHED'); END;
CREATE TRIGGER org_management_quota_reserve_update BEFORE UPDATE OF status,expires_at,organization_id ON organization_resource_reservations
WHEN NEW.resource_type='project' AND NEW.status IN ('RESERVED','PROCESSING')
 AND NEW.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND (SELECT project_limit FROM organizations WHERE id=NEW.organization_id) IS NOT NULL
 AND (SELECT COUNT(*) FROM projects WHERE organization_id=NEW.organization_id AND active=1)+
 (SELECT COUNT(*) FROM organization_resource_reservations WHERE id<>OLD.id AND organization_id=NEW.organization_id AND resource_type='project' AND status IN ('RESERVED','PROCESSING') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 >= (SELECT project_limit FROM organizations WHERE id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_PROJECT_LIMIT_REACHED'); END;
