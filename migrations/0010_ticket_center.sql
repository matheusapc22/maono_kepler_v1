-- Migração 0010: Central de Chamados canônica, histórico e anexos privados
-- Aplicar isoladamente no D1 de produção antes de disponibilizar a nova interface.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  legacy_ticket_id INTEGER,
  code TEXT UNIQUE,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'open', 'in_progress', 'in_review', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  category TEXT NOT NULL DEFAULT 'support'
    CHECK (category IN ('map', 'database', 'permission', 'export', 'support', 'other')),
  assigned_to INTEGER,
  due_at TEXT,
  closed_at TEXT,
  created_by INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, legacy_ticket_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED', 'DELETED')),
  uploaded_by INTEGER NOT NULL,
  dropbox_file_id TEXT,
  dropbox_rev TEXT,
  error_message TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES organization_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES organization_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_tickets_org_status
  ON organization_tickets(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_org_due
  ON organization_tickets(organization_id, due_at);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_updated
  ON organization_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_organization_tickets_assignee
  ON organization_tickets(organization_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_scope
  ON ticket_attachments(organization_id, ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_uploaded_by
  ON ticket_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_ticket_events_scope
  ON ticket_events(organization_id, ticket_id, created_at DESC);

-- Mantém backend e interface alinhados: owner administra; editor visualiza e cria.
-- Viewer continua sem acesso a chamados por padrão e pode receber permissão explícita.
INSERT OR IGNORE INTO role_permissions (role, permission, scope_type, active)
VALUES
  ('owner', 'ticket.view', 'organization', 1),
  ('owner', 'ticket.create', 'organization', 1),
  ('owner', 'ticket.manage', 'organization', 1),
  ('editor', 'ticket.view', 'organization', 1),
  ('editor', 'ticket.create', 'organization', 1);
