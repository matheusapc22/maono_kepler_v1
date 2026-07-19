-- Governança de acessos adicionais delegados por organização
-- Aplicar isoladamente no D1 antes de ativar a interface.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_access_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  delegate_user_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (delegation_id, permission),
  FOREIGN KEY (delegation_id) REFERENCES organization_access_delegations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delegation_target_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('viewer', 'editor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (delegation_id, access_level),
  FOREIGN KEY (delegation_id) REFERENCES organization_access_delegations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_delegations_org
  ON organization_access_delegations(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_delegations_delegate
  ON organization_access_delegations(delegate_user_id);
CREATE INDEX IF NOT EXISTS idx_access_delegations_enabled
  ON organization_access_delegations(organization_id, enabled, expires_at);
CREATE INDEX IF NOT EXISTS idx_delegation_permissions_delegation
  ON delegation_permissions(delegation_id);
CREATE INDEX IF NOT EXISTS idx_delegation_target_levels_delegation
  ON delegation_target_levels(delegation_id);

-- Uma política não pode ficar dormente e voltar a valer depois de um downgrade.
CREATE TRIGGER IF NOT EXISTS trg_access_delegation_membership_downgrade
AFTER UPDATE OF access_level ON organization_users
WHEN LOWER(COALESCE(NEW.access_level, '')) <> 'owner'
  AND LOWER(COALESCE((SELECT role FROM users WHERE id = NEW.user_id), '')) <> 'admin'
BEGIN
  UPDATE organization_access_delegations
     SET enabled = 0,
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = NEW.organization_id
     AND delegate_user_id = NEW.user_id
     AND enabled = 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_access_delegation_membership_removed
AFTER DELETE ON organization_users
BEGIN
  UPDATE organization_access_delegations
     SET enabled = 0,
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = OLD.organization_id
     AND delegate_user_id = OLD.user_id
     AND enabled = 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_access_delegation_user_ineligible
AFTER UPDATE OF role, active ON users
WHEN NEW.active = 0
   OR (
     LOWER(COALESCE(NEW.role, '')) <> 'admin'
     AND NOT EXISTS (
       SELECT 1
         FROM organization_users ou
        WHERE ou.user_id = NEW.id
          AND LOWER(COALESCE(ou.access_level, '')) = 'owner'
     )
   )
BEGIN
  UPDATE organization_access_delegations
     SET enabled = 0,
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP
   WHERE delegate_user_id = NEW.id
     AND enabled = 1;
END;
