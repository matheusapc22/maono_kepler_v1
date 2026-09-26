-- CC-04: acesso seletivo e chamados privados.
-- PRE-REQUISITOS: 0010_ticket_center.sql + 0025_ticket_triage_classification.sql
-- + 0026_ticket_command_lifecycle.sql.
-- Aplicação exclusivamente manual e evidenciada por ambiente antes de habilitar
-- MAONO_TICKET_SELECTIVE_ACCESS_ENABLED=true. CI, Preview, merge ou deploy NÃO
-- autorizam esta migration. STATUS: MIGRATION PENDENTE DE CONFIRMAÇÃO.

PRAGMA foreign_keys = ON;

ALTER TABLE organization_tickets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'organization'
  CHECK (visibility IN ('organization', 'private'));

CREATE TABLE IF NOT EXISTS ticket_access_groups (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_access_groups_name
  ON ticket_access_groups(organization_id, LOWER(TRIM(name))) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_ticket_access_groups_org_active
  ON ticket_access_groups(organization_id, active, name);

CREATE TABLE IF NOT EXISTS ticket_access_group_members (
  group_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(group_id, user_id),
  FOREIGN KEY(group_id, organization_id) REFERENCES ticket_access_groups(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_access_group_members_user
  ON ticket_access_group_members(organization_id, user_id, group_id);

CREATE TABLE IF NOT EXISTS ticket_access_policies (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_access_policies_name
  ON ticket_access_policies(organization_id, LOWER(TRIM(name))) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_ticket_access_policies_org_active
  ON ticket_access_policies(organization_id, active, name);

CREATE TABLE IF NOT EXISTS ticket_access_policy_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK(principal_type IN ('user','group')),
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('ticket.view','ticket.comment','ticket.manage')),
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(policy_id, principal_type, principal_id, action),
  FOREIGN KEY(policy_id, organization_id) REFERENCES ticket_access_policies(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_access_policy_entries_resolve
  ON ticket_access_policy_entries(organization_id, principal_type, principal_id, action, effect, policy_id);

CREATE TABLE IF NOT EXISTS ticket_ticket_access_policies (
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  policy_id TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(ticket_id, policy_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(policy_id, organization_id) REFERENCES ticket_access_policies(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_ticket_access_policies_policy
  ON ticket_ticket_access_policies(organization_id, policy_id, ticket_id);

CREATE TABLE IF NOT EXISTS ticket_acl_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  principal_type TEXT NOT NULL CHECK(principal_type IN ('user','group')),
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('ticket.view','ticket.comment','ticket.manage')),
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(ticket_id, principal_type, principal_id, action),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_acl_resolve
  ON ticket_acl_entries(organization_id, ticket_id, principal_type, principal_id, action, effect);

CREATE TABLE IF NOT EXISTS ticket_labels (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_labels_name
  ON ticket_labels(organization_id, LOWER(TRIM(name))) WHERE active = 1;

CREATE TABLE IF NOT EXISTS ticket_label_links (
  organization_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  label_id TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(ticket_id, label_id),
  FOREIGN KEY(ticket_id, organization_id) REFERENCES organization_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY(label_id, organization_id) REFERENCES ticket_labels(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ticket_label_links_label
  ON ticket_label_links(organization_id, label_id, ticket_id);

-- Scope de membros: o usuário precisa ser membro da mesma organização no ato da concessão.
CREATE TRIGGER IF NOT EXISTS ticket_access_group_member_scope_insert
BEFORE INSERT ON ticket_access_group_members
WHEN NOT EXISTS (
  SELECT 1 FROM organization_users ou
  INNER JOIN users u ON u.id = ou.user_id
  WHERE ou.organization_id = NEW.organization_id AND ou.user_id = NEW.user_id AND u.active = 1
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACCESS_GROUP_MEMBER_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_access_group_member_scope_update
BEFORE UPDATE OF organization_id, user_id, group_id ON ticket_access_group_members
WHEN NOT EXISTS (
  SELECT 1 FROM organization_users ou
  INNER JOIN users u ON u.id = ou.user_id
  WHERE ou.organization_id = NEW.organization_id AND ou.user_id = NEW.user_id AND u.active = 1
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACCESS_GROUP_MEMBER_SCOPE_INVALID'); END;

-- Relações polimórficas user/group são validadas por trigger.
CREATE TRIGGER IF NOT EXISTS ticket_acl_principal_scope_insert
BEFORE INSERT ON ticket_acl_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACL_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_acl_principal_scope_update
BEFORE UPDATE OF organization_id, principal_type, principal_id ON ticket_acl_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_ACL_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_policy_entry_principal_scope_insert
BEFORE INSERT ON ticket_access_policy_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_POLICY_PRINCIPAL_SCOPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS ticket_policy_entry_principal_scope_update
BEFORE UPDATE OF organization_id, principal_type, principal_id ON ticket_access_policy_entries
WHEN (
  NEW.principal_type = 'user' AND NOT EXISTS (
    SELECT 1 FROM organization_users ou INNER JOIN users u ON u.id = ou.user_id
    WHERE ou.organization_id = NEW.organization_id AND CAST(ou.user_id AS TEXT) = NEW.principal_id AND u.active = 1
  )
) OR (
  NEW.principal_type = 'group' AND NOT EXISTS (
    SELECT 1 FROM ticket_access_groups g WHERE g.id = NEW.principal_id AND g.organization_id = NEW.organization_id AND g.active = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'TICKET_POLICY_PRINCIPAL_SCOPE_INVALID'); END;

-- Visibilidade faz parte do estado versionado do Ticket. Escritas CC-04 já incrementam
-- version explicitamente; este trigger protege writers legados que mudem somente a visibilidade.
CREATE TRIGGER IF NOT EXISTS ticket_visibility_version_legacy_update
AFTER UPDATE OF visibility ON organization_tickets
WHEN NEW.visibility IS NOT OLD.visibility AND NEW.version = OLD.version
BEGIN
  UPDATE organization_tickets SET version = OLD.version + 1 WHERE id = NEW.id;
END;

-- O permission catalog passa a conhecer a capacidade administrativa da CC-04.
INSERT OR IGNORE INTO role_permissions(role, permission, scope_type, active)
VALUES ('owner', 'ticket.access.manage', 'organization', 1);
