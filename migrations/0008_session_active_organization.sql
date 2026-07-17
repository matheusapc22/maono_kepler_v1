-- Persiste o contexto de organização por sessão, sem alterar a organização
-- padrão do usuário nem confiar em estado mantido apenas no cliente.

ALTER TABLE sessions
  ADD COLUMN active_organization_id INTEGER
  REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_active_organization_id
  ON sessions(active_organization_id);
