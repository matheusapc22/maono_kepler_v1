-- SAVE-02: contrato explícito de schema para detectar drift API <-> D1.
-- A aplicação usa esta tabela, em vez de depender de detalhes internos do Wrangler.

CREATE TABLE IF NOT EXISTS app_schema_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_schema_metadata (id, schema_version, updated_at)
VALUES (1, 19, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  schema_version = excluded.schema_version,
  updated_at = CURRENT_TIMESTAMP;
