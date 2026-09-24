-- Migração 0024: pastas lógicas e base do ciclo de lixeira de documentos
-- ATENÇÃO: criar/revisar nesta PR não equivale a aplicar no D1.
-- Preview e Produção exigem confirmação explícita e separada.
-- Pastas são metadados D1; mover arquivo NÃO move/renomeia binário no Dropbox.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organization_file_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  parent_id INTEGER,
  name TEXT NOT NULL
    CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE (id, organization_id),
  FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id, organization_id)
    REFERENCES organization_file_folders(id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_organization_file_folders_org_parent
  ON organization_file_folders(organization_id, parent_id, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_file_folders_sibling_name
  ON organization_file_folders(
    organization_id,
    COALESCE(parent_id, 0),
    LOWER(TRIM(name))
  )
  WHERE deleted_at IS NULL;

ALTER TABLE organization_files
  ADD COLUMN folder_id INTEGER
  REFERENCES organization_file_folders(id) ON DELETE SET NULL;

-- Campos reservados para 08-S4/08-S5. A S2 não altera o contrato DELETE atual.
ALTER TABLE organization_files
  ADD COLUMN deleted_by INTEGER
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE organization_files
  ADD COLUMN purge_after TEXT;

ALTER TABLE organization_files
  ADD COLUMN trashed_from_folder_id INTEGER
  REFERENCES organization_file_folders(id) ON DELETE SET NULL;

ALTER TABLE organization_files
  ADD COLUMN purged_at TEXT;

CREATE INDEX IF NOT EXISTS idx_organization_files_folder
  ON organization_files(organization_id, folder_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_organization_files_purge_queue
  ON organization_files(purge_after, purged_at)
  WHERE purge_after IS NOT NULL AND purged_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_document_folder_parent_scope_insert
BEFORE INSERT ON organization_file_folders
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT (CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders parent
      WHERE parent.id = NEW.parent_id
        AND parent.organization_id = NEW.organization_id
        AND parent.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH')
  END);
END;

CREATE TRIGGER IF NOT EXISTS trg_document_folder_parent_scope_update
BEFORE UPDATE OF parent_id, organization_id ON organization_file_folders
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT (CASE
    WHEN NEW.parent_id = NEW.id
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_SELF_PARENT')
  END;

  SELECT (CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders parent
      WHERE parent.id = NEW.parent_id
        AND parent.organization_id = NEW.organization_id
        AND parent.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH')
  END;

  SELECT (CASE
    WHEN EXISTS (
      WITH RECURSIVE descendants(id) AS (
        SELECT id
        FROM organization_file_folders
        WHERE parent_id = NEW.id
          AND organization_id = NEW.organization_id
          AND deleted_at IS NULL
        UNION ALL
        SELECT child.id
        FROM organization_file_folders child
        INNER JOIN descendants d ON child.parent_id = d.id
        WHERE child.organization_id = NEW.organization_id
          AND child.deleted_at IS NULL
      )
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_CYCLE')
  END);
END;

CREATE TRIGGER IF NOT EXISTS trg_document_folder_delete_empty
BEFORE UPDATE OF deleted_at ON organization_file_folders
FOR EACH ROW
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT (CASE
    WHEN EXISTS (
      SELECT 1
      FROM organization_file_folders child
      WHERE child.organization_id = OLD.organization_id
        AND child.parent_id = OLD.id
        AND child.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_NOT_EMPTY')
  END;

  SELECT (CASE
    WHEN EXISTS (
      SELECT 1
      FROM organization_files file
      WHERE file.organization_id = OLD.organization_id
        AND file.folder_id = OLD.id
        AND file.deleted_at IS NULL
        AND (file.active = 1 OR file.active IS NULL)
    )
    THEN RAISE(ABORT, 'DOCUMENT_FOLDER_NOT_EMPTY')
  END);
END;

CREATE TRIGGER IF NOT EXISTS trg_organization_file_folder_scope_insert
BEFORE INSERT ON organization_files
FOR EACH ROW
WHEN NEW.folder_id IS NOT NULL
BEGIN
  SELECT (CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders folder
      WHERE folder.id = NEW.folder_id
        AND folder.organization_id = NEW.organization_id
        AND folder.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'ORGANIZATION_FILE_FOLDER_SCOPE_MISMATCH')
  END);
END;

CREATE TRIGGER IF NOT EXISTS trg_organization_file_folder_scope_update
BEFORE UPDATE OF folder_id, organization_id ON organization_files
FOR EACH ROW
WHEN NEW.folder_id IS NOT NULL
BEGIN
  SELECT (CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_file_folders folder
      WHERE folder.id = NEW.folder_id
        AND folder.organization_id = NEW.organization_id
        AND folder.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'ORGANIZATION_FILE_FOLDER_SCOPE_MISMATCH')
  END);
END;
