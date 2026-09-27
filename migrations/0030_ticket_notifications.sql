-- CC-07 additive expansion. Production apply only through the protected operator.
-- Prerequisites: 0026, 0027, 0028. Existing outbox rows are NOT backfilled.
ALTER TABLE ticket_command_outbox ADD COLUMN notification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_next_at TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_lease_until TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_token TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_error TEXT;
ALTER TABLE ticket_command_outbox ADD COLUMN notification_completed_at TEXT;
CREATE INDEX idx_ticket_notification_due ON ticket_command_outbox(status, notification_next_at, created_at);
CREATE TABLE ticket_notification_candidates (
  outbox_id TEXT NOT NULL REFERENCES ticket_command_outbox(id) ON DELETE RESTRICT,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','suppressed')),
  PRIMARY KEY(outbox_id, recipient_id)
);
CREATE TABLE ticket_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id TEXT NOT NULL REFERENCES ticket_command_outbox(id) ON DELETE RESTRICT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL REFERENCES ticket_events(id) ON DELETE RESTRICT,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK(channel = 'in_app'),
  audience TEXT NOT NULL CHECK(audience IN ('ticket','internal')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(event_id, recipient_id, channel),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_ticket_notifications_inbox ON ticket_notifications(organization_id,recipient_id,id DESC);
-- Snapshot candidates, NOT authorization grants. Author excluded; maximum two.
-- Backfill/corrections/attachment events deliberately excluded.
CREATE TRIGGER ticket_notification_snapshot AFTER INSERT ON ticket_command_outbox
WHEN NEW.event_type IN ('ticket.created','ticket.updated','ticket.status.changed','ticket.closed','ticket.reopened',
  'ticket.wait.started','ticket.wait.ended','ticket.message.created','ticket.note.created',
  'ticket.message.edited','ticket.note.edited')
BEGIN
  INSERT OR IGNORE INTO ticket_notification_candidates(outbox_id, recipient_id)
  SELECT NEW.id, u.id FROM organization_tickets t
  JOIN users u ON u.id IN (t.created_by,t.assigned_to) AND u.active = 1
  JOIN organization_users ou ON ou.user_id=u.id AND ou.organization_id=t.organization_id
  JOIN ticket_events e ON e.id=NEW.event_id AND e.ticket_id=t.id AND e.organization_id=t.organization_id
  WHERE t.id=NEW.ticket_id AND t.organization_id=NEW.organization_id AND t.active=1
    AND u.id IS NOT e.actor_user_id;
END;
