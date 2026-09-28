-- CC10 additive immutable contracts; no SLA targets, calendars or assignments seeded.
CREATE TABLE ticket_sla_policies (
 organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version >= 1),
 request_id TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000), published_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,version), UNIQUE(organization_id,request_id)
);
CREATE TABLE ticket_sla_assignments (
 organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, cycle_number INTEGER NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence >= 1), policy_version INTEGER NOT NULL,
 request_id TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL, effective_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 PRIMARY KEY(organization_id,ticket_id,cycle_number,sequence), UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,policy_version) REFERENCES ticket_sla_policies(organization_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(ticket_id,organization_id) REFERENCES organization_tickets(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(ticket_id,cycle_number) REFERENCES ticket_cycles(ticket_id,cycle_number) ON DELETE RESTRICT
);
CREATE TRIGGER ticket_sla_policy_sequence BEFORE INSERT ON ticket_sla_policies
WHEN NEW.version <> COALESCE((SELECT MAX(version) FROM ticket_sla_policies WHERE organization_id=NEW.organization_id),0)+1
BEGIN SELECT RAISE(ABORT,'TICKET_SLA_VERSION_CONFLICT'); END;
CREATE TRIGGER ticket_sla_assignment_sequence BEFORE INSERT ON ticket_sla_assignments
WHEN NEW.sequence <> COALESCE((SELECT MAX(sequence) FROM ticket_sla_assignments WHERE organization_id=NEW.organization_id AND ticket_id=NEW.ticket_id AND cycle_number=NEW.cycle_number),0)+1
OR NOT EXISTS(SELECT 1 FROM ticket_cycles c JOIN organization_tickets t ON t.id=c.ticket_id AND t.organization_id=c.organization_id
 WHERE c.organization_id=NEW.organization_id AND c.ticket_id=NEW.ticket_id AND c.cycle_number=NEW.cycle_number AND c.closed_at IS NULL
 AND t.current_cycle_number=c.cycle_number AND t.active=1 AND t.status<>'closed' AND NEW.effective_at>=c.opened_at)
OR EXISTS(SELECT 1 FROM ticket_sla_assignments a WHERE a.organization_id=NEW.organization_id AND a.ticket_id=NEW.ticket_id AND a.cycle_number=NEW.cycle_number AND a.effective_at>=NEW.effective_at)
BEGIN SELECT RAISE(ABORT,'TICKET_SLA_VERSION_CONFLICT'); END;
CREATE TRIGGER ticket_sla_policy_no_update BEFORE UPDATE ON ticket_sla_policies BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TRIGGER ticket_sla_policy_no_delete BEFORE DELETE ON ticket_sla_policies BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TRIGGER ticket_sla_assignment_no_update BEFORE UPDATE ON ticket_sla_assignments BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TRIGGER ticket_sla_assignment_no_delete BEFORE DELETE ON ticket_sla_assignments BEGIN SELECT RAISE(ABORT,'TICKET_SLA_IMMUTABLE'); END;
CREATE TABLE ticket_sla_schema(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO ticket_sla_schema VALUES(1);
