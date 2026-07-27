-- Modos Gerenciar/Visualizar/Editar e reserva atômica de cota de projetos.
-- A resolução dos painéis é derivada de permissões; nenhum modo é persistido.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_resource_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('project')),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 12 AND 128),
  project_id INTEGER,
  actor_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (
      status IN (
        'RESERVED',
        'PROCESSING',
        'COMMITTED',
        'RELEASED',
        'FAILED',
        'EXPIRED'
      )
    ),
  expires_at TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, resource_type, idempotency_key),
  FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id)
    REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resource_reservations_org_status
ON organization_resource_reservations (
  organization_id,
  resource_type,
  status,
  expires_at
);

CREATE INDEX IF NOT EXISTS idx_resource_reservations_project
ON organization_resource_reservations (project_id);

CREATE INDEX IF NOT EXISTS idx_resource_reservations_expiration
ON organization_resource_reservations (status, expires_at);

