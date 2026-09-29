-- CC-13: additive domain. Production requires the protected audit/authorization lifecycle.
CREATE TABLE ticket_cases (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 kind TEXT NOT NULL CHECK(kind IN ('incident','problem')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 state TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','organization')),
 created_by INTEGER NOT NULL REFERENCES users(id), coordinator_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(organization_id,id),
 CHECK((kind='incident' AND state IN ('open','mitigating','restored','closed')) OR
       (kind='problem' AND state IN ('open','investigating','action_defined','resolved')))
);
CREATE INDEX ticket_cases_org_order ON ticket_cases(organization_id,kind,id);
CREATE TABLE ticket_case_members (
 organization_id INTEGER NOT NULL, case_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 PRIMARY KEY(organization_id,case_id,user_id),
 FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE TABLE ticket_case_links (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, case_id TEXT NOT NULL,
 ticket_id INTEGER REFERENCES organization_tickets(id), target_case_id TEXT,
 change_id TEXT REFERENCES change_records(id),
 relation TEXT NOT NULL CHECK(relation IN ('related','duplicate_candidate','duplicate_confirmed','duplicate_rejected','implements')),
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 CHECK((ticket_id IS NOT NULL)+(target_case_id IS NOT NULL)+(change_id IS NOT NULL)=1),
 CHECK(target_case_id IS NULL OR target_case_id<>case_id),
 FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id),
 FOREIGN KEY(organization_id,target_case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE UNIQUE INDEX ticket_case_ticket_link ON ticket_case_links(case_id,ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX ticket_case_case_link ON ticket_case_links(case_id,target_case_id) WHERE target_case_id IS NOT NULL;
CREATE UNIQUE INDEX ticket_case_change_link ON ticket_case_links(case_id,change_id) WHERE change_id IS NOT NULL;
CREATE INDEX ticket_case_links_ticket ON ticket_case_links(organization_id,ticket_id,case_id);
CREATE TRIGGER ticket_case_link_tenant_insert BEFORE INSERT ON ticket_case_links
WHEN (NEW.ticket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_tickets WHERE id=NEW.ticket_id AND organization_id=NEW.organization_id))
 OR (NEW.change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM change_records WHERE id=NEW.change_id AND organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'CC13_TENANT'); END;
CREATE TRIGGER ticket_case_link_tenant_update BEFORE UPDATE ON ticket_case_links
WHEN (NEW.ticket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_tickets WHERE id=NEW.ticket_id AND organization_id=NEW.organization_id))
 OR (NEW.change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM change_records WHERE id=NEW.change_id AND organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'CC13_TENANT'); END;
CREATE TABLE ticket_case_commands (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL
);
CREATE TABLE ticket_case_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id INTEGER NOT NULL, case_id TEXT NOT NULL,
 command_id TEXT NOT NULL REFERENCES ticket_case_commands(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL, action TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL,
 UNIQUE(case_id,version), FOREIGN KEY(organization_id,case_id) REFERENCES ticket_cases(organization_id,id)
);
CREATE TRIGGER ticket_case_events_immutable BEFORE UPDATE ON ticket_case_events BEGIN SELECT RAISE(ABORT,'CC13_IMMUTABLE'); END;
CREATE TRIGGER ticket_case_events_no_delete BEFORE DELETE ON ticket_case_events BEGIN SELECT RAISE(ABORT,'CC13_IMMUTABLE'); END;
CREATE INDEX ticket_case_events_order ON ticket_case_events(organization_id,case_id,id);
CREATE TABLE ticket_case_guard(value INTEGER NOT NULL CHECK(value=1));
-- Fence case facts/audiences, relation changes and historical revisions in CC12 snapshots.
CREATE TRIGGER ticket_export_epoch_ticket_cases_insert AFTER INSERT ON ticket_cases BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cases_update AFTER UPDATE ON ticket_cases BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_cases_delete AFTER DELETE ON ticket_cases BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_members_insert AFTER INSERT ON ticket_case_members BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_members_update AFTER UPDATE ON ticket_case_members BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_members_delete AFTER DELETE ON ticket_case_members BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_links_insert AFTER INSERT ON ticket_case_links BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_links_update AFTER UPDATE ON ticket_case_links BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_links_delete AFTER DELETE ON ticket_case_links BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_events_insert AFTER INSERT ON ticket_case_events BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_export_epoch_ticket_case_events_delete AFTER DELETE ON ticket_case_events BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
