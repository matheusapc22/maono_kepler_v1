-- Schema inicial da plataforma Maono Maps
-- Cloudflare D1 / SQLite

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  active_organization_id INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (active_organization_id) REFERENCES organizations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  dropbox_root_path TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  storage_status TEXT NOT NULL DEFAULT 'PENDING',
  storage_error TEXT,
  storage_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organization_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER,
  project_id INTEGER,
  name TEXT NOT NULL,
  original_name TEXT,
  file_name TEXT NOT NULL,
  dropbox_path TEXT NOT NULL UNIQUE,
  dropbox_file_id TEXT,
  dropbox_rev TEXT,
  file_type TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  error_message TEXT,
  idempotency_key TEXT,
  uploaded_by INTEGER,
  is_project INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  dropbox_root_path TEXT NOT NULL,
  default_config_file TEXT NOT NULL DEFAULT 'config.kepler.json',
  organization_id INTEGER,
  organization_file_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (organization_file_id) REFERENCES organization_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, project_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  project_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_organization_id ON sessions(active_organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(active);
CREATE INDEX IF NOT EXISTS idx_organizations_storage_status ON organizations(storage_status);
CREATE INDEX IF NOT EXISTS idx_organization_users_org_id ON organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_users_user_id ON organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_files_org_id ON organization_files(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_files_project_id ON organization_files(project_id);
CREATE INDEX IF NOT EXISTS idx_organization_files_dropbox_path ON organization_files(dropbox_path);
CREATE INDEX IF NOT EXISTS idx_organization_files_file_type ON organization_files(file_type);
CREATE INDEX IF NOT EXISTS idx_organization_files_status ON organization_files(status);
CREATE INDEX IF NOT EXISTS idx_organization_files_uploaded_by ON organization_files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_organization_files_deleted_at ON organization_files(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_files_idempotency
  ON organization_files(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_organization_file_id ON projects(organization_file_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_user_id ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project_id ON user_projects(project_id);

-- Central de Chamados (migration 0010_ticket_center.sql)
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON audit_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
