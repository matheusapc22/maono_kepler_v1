-- Autoria, snapshots de nomes e controle de concorrência dos metadados.
--
-- A migration é deliberadamente aditiva. Os ALTER TABLE não usam proteção
-- contra repetição porque o SQLite/D1 não oferece ADD COLUMN IF NOT EXISTS de
-- forma portável. Uma aplicação parcial deve falhar visivelmente, sem mascarar
-- divergências no schema.
--
-- Projetos legados só recebem autoria quando existe evidência em audit_logs.
-- Na ausência de evento compatível, created_by/updated_by e seus snapshots
-- permanecem NULL. Nenhum owner atual ou usuário de sessão é inferido.

PRAGMA foreign_keys = ON;

ALTER TABLE projects
ADD COLUMN created_by INTEGER
REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects
ADD COLUMN created_by_name_snapshot TEXT;

ALTER TABLE projects
ADD COLUMN updated_by INTEGER
REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects
ADD COLUMN updated_by_name_snapshot TEXT;

ALTER TABLE projects
ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_projects_created_by
  ON projects(created_by);

CREATE INDEX IF NOT EXISTS idx_projects_updated_by
  ON projects(updated_by);

-- Criador legado: primeiro evento de criação com usuário e projeto conhecidos.
UPDATE projects
SET created_by = (
  SELECT audit_logs.user_id
  FROM audit_logs
  WHERE audit_logs.project_id = projects.id
    AND audit_logs.user_id IS NOT NULL
    AND audit_logs.action IN (
      'admin.projects.create',
      'projects.create',
      'project.create'
    )
  ORDER BY datetime(audit_logs.created_at) ASC, audit_logs.id ASC
  LIMIT 1
)
WHERE projects.created_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM audit_logs
    WHERE audit_logs.project_id = projects.id
      AND audit_logs.user_id IS NOT NULL
      AND audit_logs.action IN (
        'admin.projects.create',
        'projects.create',
        'project.create'
      )
  );

-- O snapshot de projetos legados usa o nome disponível para o usuário
-- identificado pela auditoria no momento desta migration.
UPDATE projects
SET created_by_name_snapshot = (
  SELECT users.name
  FROM users
  WHERE users.id = projects.created_by
)
WHERE projects.created_by IS NOT NULL
  AND projects.created_by_name_snapshot IS NULL;

-- Último editor legado: evento mais recente que comprovadamente alterou o
-- cadastro, os metadados ou o arquivo principal do projeto. O evento de criação
-- funciona como fallback quando não existe alteração posterior.
UPDATE projects
SET updated_by = (
  SELECT audit_logs.user_id
  FROM audit_logs
  WHERE audit_logs.project_id = projects.id
    AND audit_logs.user_id IS NOT NULL
    AND audit_logs.action IN (
      'admin.projects.create',
      'projects.create',
      'project.create',
      'admin.projects.update',
      'projects.metadata.update',
      'projects.config.save',
      'project.update',
      'project.save'
    )
  ORDER BY datetime(audit_logs.created_at) DESC, audit_logs.id DESC
  LIMIT 1
)
WHERE projects.updated_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM audit_logs
    WHERE audit_logs.project_id = projects.id
      AND audit_logs.user_id IS NOT NULL
      AND audit_logs.action IN (
        'admin.projects.create',
        'projects.create',
        'project.create',
        'admin.projects.update',
        'projects.metadata.update',
        'projects.config.save',
        'project.update',
        'project.save'
      )
  );

UPDATE projects
SET updated_by_name_snapshot = (
  SELECT users.name
  FROM users
  WHERE users.id = projects.updated_by
)
WHERE projects.updated_by IS NOT NULL
  AND projects.updated_by_name_snapshot IS NULL;
