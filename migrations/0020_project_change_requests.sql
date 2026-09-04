-- Migração 0020: domínio de Change Request para working copies do Viewer.
-- Aplicar isoladamente no D1 antes de habilitar submit/list/get no ambiente alvo.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_change_requests (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  requested_by_user_id INTEGER NOT NULL,
  ticket_id INTEGER UNIQUE,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN (
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'conflict',
      'applying',
      'applied',
      'superseded'
    )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  idempotency_key TEXT NOT NULL,
  submission_hash TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, requested_by_user_id, idempotency_key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (ticket_id) REFERENCES organization_tickets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_change_operations (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  operation_type TEXT NOT NULL,
  operation_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (change_request_id, sequence),
  FOREIGN KEY (change_request_id) REFERENCES project_change_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_change_requests_project_status
  ON project_change_requests(project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_change_requests_requester
  ON project_change_requests(requested_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_change_operations_request
  ON project_change_operations(change_request_id, sequence);

-- Conteúdo submetido é imutável. Status/ticket/updated_at poderão evoluir nas PRs de Review.
CREATE TRIGGER IF NOT EXISTS trg_project_change_requests_immutable_content
BEFORE UPDATE OF
  organization_id,
  project_id,
  requested_by_user_id,
  base_revision,
  reason,
  idempotency_key,
  submission_hash,
  submitted_at,
  created_at
ON project_change_requests
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_CHANGE_REQUEST_IMMUTABLE');
END;

-- Operações não são editáveis. DELETE permanece permitido apenas para cascatas de lifecycle
-- (por exemplo, exclusão do projeto/request), pois não existe endpoint público de delete.
CREATE TRIGGER IF NOT EXISTS trg_project_change_operations_no_update
BEFORE UPDATE ON project_change_operations
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_CHANGE_OPERATION_IMMUTABLE');
END;
