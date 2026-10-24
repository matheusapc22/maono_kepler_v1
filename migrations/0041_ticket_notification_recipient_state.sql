-- CC07 recipient-local, recoverable notice state. No outbox/event deletion.
-- Additive; requires 0030. Production apply only through the protected operator.
-- Apply once through d1_migrations: raw ALTER TABLE is not repeatable SQLite SQL.
-- The protected audit/apply ledger gate rejects an already applied migration.
ALTER TABLE ticket_notifications ADD COLUMN dismissed_at TEXT;
ALTER TABLE ticket_notifications ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE ticket_notifications ADD COLUMN action_token TEXT;
