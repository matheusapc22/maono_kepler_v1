-- Sprint 6 — Permissões project-scoped para salvar mapas
-- Seguro para banco local e oficial.
--
-- Uso local:
--   npx wrangler d1 execute maono_maps --local --file=migrations/0007_project_save_role_permissions.sql
--
-- Uso remoto/oficial:
--   npx wrangler d1 execute maono_maps --remote --file=migrations/0007_project_save_role_permissions.sql
--
-- Não cria usuários, não cria vínculos e não altera projetos.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO role_permissions (role, permission, scope_type, active)
VALUES
  ('owner', 'project.view', 'project', 1),
  ('owner', 'project.favorite', 'project', 1),
  ('owner', 'project.edit', 'project', 1),
  ('owner', 'project.save', 'project', 1),
  ('owner', 'project.thumbnail.update', 'project', 1),

  ('editor', 'project.view', 'project', 1),
  ('editor', 'project.favorite', 'project', 1),
  ('editor', 'project.edit', 'project', 1),
  ('editor', 'project.save', 'project', 1),
  ('editor', 'project.thumbnail.update', 'project', 1),

  ('viewer', 'project.view', 'project', 1),
  ('viewer', 'project.favorite', 'project', 1);