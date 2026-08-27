import process from "node:process";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : fallback;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const userEmail = argument("user-email");
const organizationName = argument("org-name", "Maõno Preview QA");
const organizationSlug = argument("org-slug", "maono-preview-qa");
const dropboxRoot = argument(
  "dropbox-root",
  "/Apps/MaonoKepler/preview/qa",
);

if (!userEmail || !/^\S+@\S+\.\S+$/.test(userEmail)) {
  console.error(
    "Uso: node scripts/preview/build-production-qa-seed.mjs --user-email=qa@example.com",
  );
  process.exit(1);
}

const sql = `-- GERADO PARA HOMOLOGAÇÃO PREVIEW SOBRE O D1 DE PRODUÇÃO.
-- Não cria migration e não altera organizações fora do slug QA.
-- Revise o SQL antes de executar manualmente no D1 remoto.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO organizations (
  name,
  slug,
  dropbox_root_path,
  description,
  active,
  storage_status,
  storage_error,
  storage_checked_at,
  created_at,
  updated_at
)
VALUES (
  ${sqlString(organizationName)},
  ${sqlString(organizationSlug)},
  ${sqlString(dropboxRoot)},
  'Organização isolada para homologação de deployments Preview usando o D1 de produção.',
  1,
  'READY',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  dropbox_root_path = excluded.dropbox_root_path,
  description = excluded.description,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO organization_users (
  organization_id,
  user_id,
  access_level,
  created_at
)
SELECT
  organizations.id,
  users.id,
  'owner',
  CURRENT_TIMESTAMP
FROM organizations
JOIN users ON users.email = ${sqlString(userEmail)}
WHERE organizations.slug = ${sqlString(organizationSlug)}
ON CONFLICT(organization_id, user_id) DO UPDATE SET
  access_level = 'owner';

COMMIT;

-- Validação segura: deve retornar exatamente uma organização e um vínculo QA.
SELECT id, name, slug, dropbox_root_path, storage_status
FROM organizations
WHERE slug = ${sqlString(organizationSlug)};

SELECT
  organization_users.organization_id,
  users.email,
  organization_users.access_level
FROM organization_users
JOIN organizations ON organizations.id = organization_users.organization_id
JOIN users ON users.id = organization_users.user_id
WHERE organizations.slug = ${sqlString(organizationSlug)}
  AND users.email = ${sqlString(userEmail)};
`;

process.stdout.write(sql);
