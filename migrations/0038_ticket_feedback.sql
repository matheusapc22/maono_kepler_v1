-- CC15: additive, no historical invitation backfill. Protected operator only.
CREATE UNIQUE INDEX idx_ticket_feedback_cycle_scope ON ticket_cycles(organization_id,ticket_id,cycle_number);
CREATE TABLE ticket_feedback_instruments (
 organization_id INTEGER NOT NULL REFERENCES organizations(id), version INTEGER NOT NULL CHECK(version>0),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), created_at TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 PRIMARY KEY(organization_id,version), UNIQUE(organization_id,request_key)
);
CREATE TABLE ticket_feedback_invites (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, cycle_number INTEGER NOT NULL,
 recipient_id INTEGER NOT NULL REFERENCES users(id), instrument_version INTEGER NOT NULL,
 issued_at TEXT NOT NULL, eligible_until TEXT NOT NULL, closed_at TEXT NOT NULL,
 UNIQUE(organization_id,ticket_id,cycle_number,recipient_id),
 FOREIGN KEY(organization_id,ticket_id,cycle_number) REFERENCES ticket_cycles(organization_id,ticket_id,cycle_number),
 FOREIGN KEY(organization_id,instrument_version) REFERENCES ticket_feedback_instruments(organization_id,version),
 CHECK(eligible_until>issued_at)
);
CREATE INDEX idx_ticket_feedback_recipient ON ticket_feedback_invites(organization_id,recipient_id,id);
CREATE INDEX idx_ticket_feedback_cohort ON ticket_feedback_invites(organization_id,ticket_id,closed_at);
CREATE TABLE ticket_feedback_responses (
 invite_id TEXT PRIMARY KEY REFERENCES ticket_feedback_invites(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 outcome TEXT, effort INTEGER, comment TEXT NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
 consent INTEGER NOT NULL CHECK(consent IN (0,1)), declined INTEGER NOT NULL CHECK(declined IN (0,1)),
 created_at TEXT NOT NULL, request_hash TEXT NOT NULL, receipt TEXT NOT NULL UNIQUE,
 CHECK((declined=1 AND outcome IS NULL AND effort IS NULL AND comment='' AND consent=0)
   OR (declined=0 AND outcome IS NOT NULL AND effort IS NOT NULL AND consent=1))
);
CREATE TABLE ticket_feedback_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, invite_id TEXT NOT NULL REFERENCES ticket_feedback_invites(id),
 event_type TEXT NOT NULL CHECK(event_type IN ('issued','responded','declined','withdrawn')),
 actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 UNIQUE(invite_id,event_type)
);
CREATE TABLE ticket_feedback_guard(value INTEGER NOT NULL CHECK(value=1));
CREATE TRIGGER ticket_feedback_guard_clean AFTER INSERT ON ticket_feedback_guard BEGIN DELETE FROM ticket_feedback_guard; END;
CREATE TRIGGER ticket_feedback_response_scope BEFORE INSERT ON ticket_feedback_responses
WHEN NOT EXISTS(SELECT 1 FROM ticket_feedback_invites i WHERE i.id=NEW.invite_id AND i.recipient_id=NEW.actor_id
 AND NEW.created_at>=i.issued_at AND NEW.created_at<i.eligible_until)
BEGIN SELECT RAISE(ABORT,'FEEDBACK_RESPONSE_SCOPE'); END;
CREATE TRIGGER ticket_feedback_instruments_update BEFORE UPDATE ON ticket_feedback_instruments BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_instruments_delete BEFORE DELETE ON ticket_feedback_instruments BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_instruments_epoch AFTER INSERT ON ticket_feedback_instruments BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_feedback_invites_update BEFORE UPDATE ON ticket_feedback_invites BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_invites_delete BEFORE DELETE ON ticket_feedback_invites BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_invites_epoch AFTER INSERT ON ticket_feedback_invites BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_feedback_responses_update BEFORE UPDATE ON ticket_feedback_responses BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_responses_delete BEFORE DELETE ON ticket_feedback_responses BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_responses_epoch AFTER INSERT ON ticket_feedback_responses BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TRIGGER ticket_feedback_events_update BEFORE UPDATE ON ticket_feedback_events BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_events_delete BEFORE DELETE ON ticket_feedback_events BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_events_epoch AFTER INSERT ON ticket_feedback_events BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
CREATE TABLE ticket_feedback_withdrawals (
 invite_id TEXT PRIMARY KEY REFERENCES ticket_feedback_responses(invite_id),
 actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, receipt TEXT NOT NULL UNIQUE
);
CREATE TRIGGER ticket_feedback_withdrawals_scope BEFORE INSERT ON ticket_feedback_withdrawals
WHEN NOT EXISTS(SELECT 1 FROM ticket_feedback_responses r WHERE r.invite_id=NEW.invite_id AND r.actor_id=NEW.actor_id AND r.declined=0)
BEGIN SELECT RAISE(ABORT,'FEEDBACK_WITHDRAWAL_SCOPE'); END;
CREATE TRIGGER ticket_feedback_withdrawals_update BEFORE UPDATE ON ticket_feedback_withdrawals BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_withdrawals_delete BEFORE DELETE ON ticket_feedback_withdrawals BEGIN SELECT RAISE(ABORT,'FEEDBACK_IMMUTABLE'); END;
CREATE TRIGGER ticket_feedback_withdrawals_epoch AFTER INSERT ON ticket_feedback_withdrawals BEGIN UPDATE ticket_export_generation SET version=version+1 WHERE id=1; END;
