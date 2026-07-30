import { mkdirSync, writeFileSync } from "node:fs";
import { hashPassword } from "../functions/_lib/auth.js";

const password =
  process.env.MAONO_LOCAL_PASSWORD || "MaonoLocal#2026";

const users = [
  [9101, "local.superadmin@maono.test", "Super Admin Local", "super_admin", "owner"],
  [9102, "local.owner@maono.test", "Owner Local", "owner", "owner"],
  [9103, "local.admin@maono.test", "Admin Local", "admin", "admin"],
  [9104, "local.editor@maono.test", "Editor Local", "editor", "editor"],
  [9105, "local.viewer@maono.test", "Viewer Local", "viewer", "viewer"],
];

const escapeSql = (value) =>
  String(value).replaceAll("'", "''");

const userRows = [];
const membershipRows = [];

for (const [id, email, name, role, accessLevel] of users) {
  const salt = String(id).padStart(32, "0");
  const passwordHash = await hashPassword(password, salt);

  userRows.push(
    `(${id}, '${escapeSql(email)}', '${escapeSql(name)}', ` +
    `'${role}', '${passwordHash}', 1)`,
  );

  membershipRows.push(
    `(9001, ${id}, '${accessLevel}')`,
  );
}

const seed = `
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO organizations (
  id,
  name,
  slug,
  dropbox_root_path,
  description,
  active,
  storage_status,
  storage_checked_at
)
VALUES (
  9001,
  'Organização Local Maõno',
  'maono-local',
  '/MAONO_LOCAL/ORGANIZACAO_DEMO',
  'Organização fictícia para desenvolvimento local.',
  1,
  'READY',
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
  dropbox_root_path = excluded.dropbox_root_path,
  description = excluded.description,
  active = excluded.active,
  storage_status = excluded.storage_status,
  storage_error = NULL,
  storage_checked_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO users (
  id,
  email,
  name,
  role,
  password_hash,
  active
)
VALUES
  ${userRows.join(",\n  ")}
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  name = excluded.name,
  role = excluded.role,
  password_hash = excluded.password_hash,
  active = excluded.active,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM sessions
WHERE user_id IN (9101, 9102, 9103, 9104, 9105);

INSERT INTO organization_users (
  organization_id,
  user_id,
  access_level
)
VALUES
  ${membershipRows.join(",\n  ")}
ON CONFLICT(organization_id, user_id) DO UPDATE SET
  access_level = excluded.access_level;

COMMIT;
`;

mkdirSync("dev-seeds", { recursive: true });

writeFileSync(
  "dev-seeds/001_base_local.sql",
  seed,
  "utf8",
);

console.log("Seed criado: dev-seeds/001_base_local.sql");
console.log(`Senha comum: ${password}`);

for (const [, email, , role] of users) {
  console.log(`${role.padEnd(11)} ${email}`);
}