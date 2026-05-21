-- Seed EXEMPLO para desenvolvimento.
-- 1) Gere um hash real com:
--    node scripts/hash-password.mjs sua-senha
-- 2) Substitua TROQUE_PELO_HASH_DA_SENHA antes de rodar.

INSERT INTO users (email, name, role, password_hash, active)
VALUES (
  'matheusapc22@gmail.com',
  'Matheus Andrade',
  'admin',
  'TROQUE_PELO_HASH_DA_SENHA',
  1
)
ON CONFLICT(email) DO UPDATE SET
  name = excluded.name,
  role = excluded.role,
  password_hash = excluded.password_hash,
  active = excluded.active,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO projects (
  name,
  slug,
  description,
  dropbox_root_path,
  default_config_file,
  active
)
VALUES (
  'Projeto Demonstração Maono',
  'demo-maono',
  'Projeto inicial para validar login, permissões e leitura no Dropbox.',
  '/Apps/MaonoKepler/projects/demo-maono',
  'config.kepler.json',
  1
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  dropbox_root_path = excluded.dropbox_root_path,
  default_config_file = excluded.default_config_file,
  active = excluded.active,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO user_projects (user_id, project_id, access_level)
SELECT users.id, projects.id, 'owner'
FROM users, projects
WHERE users.email = 'matheusapc22@gmail.com'
  AND projects.slug = 'demo-maono'
ON CONFLICT(user_id, project_id) DO UPDATE SET
  access_level = excluded.access_level;
