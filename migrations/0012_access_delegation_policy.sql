PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_access_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  delegate_user_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  revision_token TEXT NOT NULL,
  granted_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, delegate_user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (delegate_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS delegation_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  can_grant INTEGER NOT NULL DEFAULT 0 CHECK (can_grant IN (0, 1)),
  can_revoke INTEGER NOT NULL DEFAULT 0 CHECK (can_revoke IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (delegation_id, permission),
  FOREIGN KEY (delegation_id) REFERENCES organization_access_delegations(id) ON DELETE CASCADE,
  CHECK (can_grant = 1 OR can_revoke = 1)
);

CREATE TABLE IF NOT EXISTS delegation_target_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('viewer', 'editor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (delegation_id, access_level),
  FOREIGN KEY (delegation_id) REFERENCES organization_access_delegations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_delegations_org_enabled
  ON organization_access_delegations(organization_id, enabled);
CREATE INDEX IF NOT EXISTS idx_access_delegations_delegate_enabled
  ON organization_access_delegations(delegate_user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_delegation_permissions_delegation
  ON delegation_permissions(delegation_id);
CREATE INDEX IF NOT EXISTS idx_delegation_target_levels_delegation
  ON delegation_target_levels(delegation_id);
