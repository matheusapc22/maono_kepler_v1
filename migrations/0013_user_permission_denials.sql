-- Negações explícitas de permissões nativas por usuário e organização.
-- A negação é avaliada antes de roles, grants individuais e capacidades nativas.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_permission_denials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  permission TEXT NOT NULL CHECK (length(permission) BETWEEN 1 AND 120),
  denied_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, organization_id, permission),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (denied_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_permission_denials_user_org
  ON user_permission_denials(user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_user_permission_denials_org_permission
  ON user_permission_denials(organization_id, permission);

-- Desvincular o usuário da organização elimina negações daquele escopo para
-- que um vínculo futuro comece com a política nativa vigente.
CREATE TRIGGER IF NOT EXISTS trg_user_permission_denials_membership_removed
AFTER DELETE ON organization_users
FOR EACH ROW
BEGIN
  DELETE FROM user_permission_denials
  WHERE user_id = OLD.user_id
    AND organization_id = OLD.organization_id;
END;
