-- AU-01. Additive journal; PREPARE only. Production requires the protected operator.
-- Depends on 0042, 0043 and ONE authorized variant of 0044, never both variants.
-- Business effects remain owned by their existing domain services.
-- No FK points at deletable organization/user rows: identities are historical snapshots.
CREATE TABLE audit_operation_frames (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 source TEXT NOT NULL,
 source_event_id TEXT NOT NULL,
 operation_id TEXT,
 item_index INTEGER,
 attempt_id TEXT,
 parent_attempt_id TEXT,
 event_type TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('requested','authorized','denied','running','succeeded','failed','blocked','partial','unknown','no_change')),
 actor_id INTEGER,
 actor_name TEXT,
 original_actor_id INTEGER,
 original_actor_name TEXT,
 executor_kind TEXT NOT NULL DEFAULT 'unknown' CHECK(executor_kind IN ('user','worker','system','unknown')),
 organization_id INTEGER,
 organization_name TEXT,
 organization_slug TEXT,
 context_organization_id INTEGER,
 category TEXT NOT NULL,
 action TEXT NOT NULL,
 resource_type TEXT NOT NULL,
 resource_id TEXT,
 resource_label TEXT,
 ui_route TEXT,
 technical_origin TEXT,
 code TEXT,
 version INTEGER,
 before_json TEXT,
 after_json TEXT,
 details_json TEXT,
 occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(source,source_event_id),
 CHECK(item_index IS NULL OR item_index >= 0),
 CHECK(before_json IS NULL OR json_valid(before_json)),
 CHECK(after_json IS NULL OR json_valid(after_json)),
 CHECK(details_json IS NULL OR json_valid(details_json))
);
CREATE INDEX idx_audit_frames_order ON audit_operation_frames(occurred_at DESC,id DESC);
CREATE INDEX idx_audit_frames_operation ON audit_operation_frames(operation_id,item_index,id);
CREATE INDEX idx_audit_frames_organization ON audit_operation_frames(organization_id,occurred_at DESC,id DESC);
CREATE INDEX idx_audit_frames_outcome ON audit_operation_frames(outcome,occurred_at DESC,id DESC);
CREATE TRIGGER audit_frames_no_update BEFORE UPDATE ON audit_operation_frames
BEGIN SELECT RAISE(ABORT,'AUDIT_FRAMES_APPEND_ONLY'); END;
CREATE TRIGGER audit_frames_no_delete BEFORE DELETE ON audit_operation_frames
BEGIN SELECT RAISE(ABORT,'AUDIT_FRAMES_APPEND_ONLY'); END;

-- This projection executes inside the transaction that changed the organization.
-- A failed journal INSERT aborts the business effect, including a zero-row CAS assertion.
-- Existing legacy events are not backfilled: absence of context remains explicit.
CREATE TRIGGER audit_frame_org_management_event AFTER INSERT ON organization_management_events
BEGIN
 INSERT INTO audit_operation_frames(
  source,source_event_id,operation_id,item_index,attempt_id,event_type,outcome,
  actor_id,actor_name,original_actor_id,original_actor_name,executor_kind,
  organization_id,organization_name,organization_slug,context_organization_id,
  category,action,resource_type,resource_id,resource_label,ui_route,technical_origin,
  version,before_json,after_json,details_json,occurred_at)
 SELECT 'organization_management_events',CAST(NEW.id AS TEXT),
  COALESCE(CASE WHEN NEW.action='organization.deletion_requested' THEN NEW.request_id END,
   (SELECT o.id FROM organization_management_operations o WHERE NEW.request_id=o.id||':'||CAST(i.item_index AS TEXT) OR NEW.request_id=o.id||':'||CAST(i.item_index AS TEXT)||':lifecycle' OR NEW.request_id=o.id||':'||CAST(i.item_index AS TEXT)||':configured' OR NEW.request_id=o.id||':'||CAST(i.item_index AS TEXT)||':storage'),
   (SELECT d.id FROM organization_deletions d WHERE d.id=NEW.request_id)),
  i.item_index,i.lease_token,'effect_confirmed','succeeded',
  NEW.actor_id,(SELECT name FROM users WHERE id=NEW.actor_id),
  NEW.actor_id,(SELECT original_actor_name FROM audit_operation_frames f WHERE f.operation_id=i.operation_id ORDER BY id LIMIT 1),
  CASE WHEN NEW.actor_id IS NULL THEN 'unknown' ELSE 'user' END,
  NEW.organization_id,org.name,org.slug,
  (SELECT context_organization_id FROM audit_operation_frames f WHERE f.operation_id=i.operation_id ORDER BY id LIMIT 1),
  'organizations',NEW.action,'organization',CAST(NEW.organization_id AS TEXT),org.name,
  (SELECT ui_route FROM audit_operation_frames f WHERE f.operation_id=i.operation_id ORDER BY id LIMIT 1),
  'd1:organization_management_events',NEW.version,NEW.before_json,NEW.after_json,
  json_object('effectOnly',json('true'),'requestId',NEW.request_id),NEW.created_at
 FROM organizations org
 LEFT JOIN organization_management_operation_items i ON
   NEW.request_id=i.operation_id||':'||CAST(i.item_index AS TEXT) OR
   NEW.request_id=i.operation_id||':'||CAST(i.item_index AS TEXT)||':lifecycle' OR
   NEW.request_id=i.operation_id||':'||CAST(i.item_index AS TEXT)||':configured' OR
   NEW.request_id=i.operation_id||':'||CAST(i.item_index AS TEXT)||':storage'
 WHERE org.id=NEW.organization_id;
END;

-- Older API/administrative writers do not provide authenticated command context.
-- Capture their actual D1 effects with unknown attribution, never the last actor.
CREATE TRIGGER audit_frame_org_legacy_created AFTER INSERT ON organizations
WHEN NEW.management_create_key IS NULL
BEGIN
 INSERT INTO audit_operation_frames(source,source_event_id,event_type,outcome,executor_kind,
  organization_id,organization_name,organization_slug,category,action,resource_type,resource_id,resource_label,technical_origin,after_json,details_json)
 VALUES('organization_legacy_create',CAST(NEW.id AS TEXT),'effect_confirmed','succeeded','unknown',
  NEW.id,NEW.name,NEW.slug,'organizations','organization.created','organization',CAST(NEW.id AS TEXT),NEW.name,
  'd1:organizations',json_object('name',NEW.name,'active',NEW.active),json_object('effectOnly',json('true')));
END;
CREATE TRIGGER audit_frame_org_storage_observed AFTER UPDATE OF storage_status ON organizations
WHEN NEW.storage_status IS NOT OLD.storage_status
BEGIN
 INSERT INTO audit_operation_frames(source,source_event_id,operation_id,event_type,outcome,executor_kind,
  organization_id,organization_name,organization_slug,category,action,resource_type,resource_id,resource_label,technical_origin,before_json,after_json,details_json)
 VALUES('organization_storage_observation',lower(hex(randomblob(16))),NULL,
  'storage_observed','partial','unknown',NEW.id,NEW.name,NEW.slug,'organizations','organization.storage_observed',
  'organization',CAST(NEW.id AS TEXT),NEW.name,'d1:organizations',
  json_object('storageStatus',OLD.storage_status),json_object('storageStatus',NEW.storage_status),json_object('effectOnly',json('true')));
END;

-- Deletion already commits requested/checkpoint/completed events with its D1 effects.
-- The retained deletion row supplies the identity after the organization is gone.
CREATE TRIGGER audit_frame_org_deletion_event AFTER INSERT ON organization_deletion_audit
BEGIN
 INSERT INTO audit_operation_frames(
  source,source_event_id,operation_id,attempt_id,event_type,outcome,
  actor_id,actor_name,original_actor_id,original_actor_name,executor_kind,
  organization_id,organization_name,organization_slug,category,action,
  resource_type,resource_id,resource_label,ui_route,technical_origin,code,version,details_json,occurred_at)
 SELECT 'organization_deletion_audit',CAST(NEW.id AS TEXT),d.id,
  COALESCE(d.lease_token,(SELECT attempt_id FROM audit_operation_frames WHERE operation_id=d.id AND event_type='attempt_started' ORDER BY id DESC LIMIT 1)),
  NEW.event_type,
  CASE NEW.event_type WHEN 'requested' THEN 'requested' WHEN 'automatic_requested' THEN 'requested'
   WHEN 'storage_deleted' THEN 'partial' WHEN 'completed' THEN 'succeeded' ELSE 'unknown' END,
  NEW.actor_id,(SELECT name FROM users WHERE id=NEW.actor_id),d.actor_id,
  (SELECT original_actor_name FROM audit_operation_frames WHERE operation_id=d.id ORDER BY id LIMIT 1),
  COALESCE((SELECT executor_kind FROM audit_operation_frames WHERE operation_id=d.id AND event_type='attempt_started' ORDER BY id DESC LIMIT 1),'unknown'),
  d.organization_id,d.name,d.slug,'organizations','organization.permanent_delete',
  'organization',CAST(d.organization_id AS TEXT),d.name,
  (SELECT ui_route FROM audit_operation_frames WHERE operation_id=d.id ORDER BY id LIMIT 1),
  'd1:organization_deletion_audit',
  CASE WHEN json_valid(NEW.details_json) THEN json_extract(NEW.details_json,'$.code') ELSE NULL END,
  d.requested_version,
  json_object('checkpoint',NEW.event_type),NEW.created_at
 FROM organization_deletions d WHERE d.id=NEW.deletion_id;
END;

-- Reconciliation is an additional observation, never an UPDATE of a failed attempt.
CREATE TABLE organization_operation_reconciliations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operation_id TEXT NOT NULL,
 item_index INTEGER NOT NULL,
 observed_attempts INTEGER NOT NULL,
 organization_id INTEGER NOT NULL,
 observed_version INTEGER NOT NULL,
 actor_id INTEGER NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('confirmed_no_effect','confirmed_effect')),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(operation_id,item_index,observed_attempts)
);
CREATE TRIGGER organization_reconciliations_no_update BEFORE UPDATE ON organization_operation_reconciliations
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_RECONCILIATIONS_APPEND_ONLY'); END;
CREATE TRIGGER organization_reconciliations_no_delete BEFORE DELETE ON organization_operation_reconciliations
BEGIN SELECT RAISE(ABORT,'ORGANIZATION_RECONCILIATIONS_APPEND_ONLY'); END;
