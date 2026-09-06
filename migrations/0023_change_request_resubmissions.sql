-- Migração 0023: lineage imutável para correção/ressubmissão de Change Requests.
-- Aplicar somente depois de 0021 + 0022, na mesma janela controlada do rollout.

PRAGMA foreign_keys = ON;

ALTER TABLE project_change_requests
  ADD COLUMN resubmitted_from_request_id TEXT
  REFERENCES project_change_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_change_request_resubmission_source
  ON project_change_requests(resubmitted_from_request_id)
  WHERE resubmitted_from_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_change_requests_resubmission_parent
  ON project_change_requests(resubmitted_from_request_id, created_at DESC);

-- O vínculo de lineage nasce junto com a nova solicitação e nunca pode ser reescrito.
CREATE TRIGGER IF NOT EXISTS trg_project_change_request_resubmission_immutable
BEFORE UPDATE OF resubmitted_from_request_id ON project_change_requests
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_CHANGE_REQUEST_RESUBMISSION_IMMUTABLE');
END;

-- Uma resubmissão só pode apontar para uma solicitação terminal do mesmo
-- projeto, organização e solicitante. A decisão/feedback do pai permanece intacta.
CREATE TRIGGER IF NOT EXISTS trg_project_change_request_resubmission_guard
BEFORE INSERT ON project_change_requests
WHEN NEW.resubmitted_from_request_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.resubmitted_from_request_id = NEW.id
      THEN RAISE(ABORT, 'PROJECT_CHANGE_REQUEST_RESUBMISSION_SELF_REFERENCE')
    WHEN NOT EXISTS (
      SELECT 1
      FROM project_change_requests parent
      WHERE parent.id = NEW.resubmitted_from_request_id
        AND parent.organization_id = NEW.organization_id
        AND parent.project_id = NEW.project_id
        AND parent.requested_by_user_id = NEW.requested_by_user_id
        AND parent.status IN ('rejected', 'conflict')
    )
      THEN RAISE(ABORT, 'PROJECT_CHANGE_REQUEST_RESUBMISSION_SOURCE_INVALID')
  END;
END;
