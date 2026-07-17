-- Migração 0009: invariante de armazenamento das organizações
-- Toda organização ativa deve possuir uma raiz canônica em /projects/{slug}.
-- A existência física da pasta é reconciliada pelo backend após esta migration.

PRAGMA foreign_keys = ON;

ALTER TABLE organizations ADD COLUMN storage_status TEXT;
ALTER TABLE organizations ADD COLUMN storage_error TEXT;
ALTER TABLE organizations ADD COLUMN storage_checked_at TEXT;

UPDATE organizations
SET dropbox_root_path = '/projects/' ||
  CASE
    WHEN TRIM(COALESCE(slug, '')) <> '' THEN TRIM(slug)
    ELSE 'organization-' || id
  END,
  storage_status = 'PENDING',
  storage_error = NULL,
  storage_checked_at = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE active = 1
  AND (
    dropbox_root_path IS NULL
    OR TRIM(dropbox_root_path) = ''
    OR dropbox_root_path = '/projects'
    OR dropbox_root_path NOT LIKE '/projects/%'
  );

UPDATE organizations
SET storage_status = CASE
      WHEN active = 1 THEN COALESCE(NULLIF(storage_status, ''), 'PENDING')
      ELSE 'DISABLED'
    END,
    storage_error = CASE WHEN active = 1 THEN storage_error ELSE NULL END,
    updated_at = CURRENT_TIMESTAMP
WHERE storage_status IS NULL OR TRIM(storage_status) = '';

CREATE INDEX IF NOT EXISTS idx_organizations_storage_status
  ON organizations(storage_status);
