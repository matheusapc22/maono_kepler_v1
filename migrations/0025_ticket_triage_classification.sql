-- CC-02: expansão compatível da triagem, sem inferir natureza de category/texto.
-- Aplicação manual após autorização, em cada D1 alvo, antes de habilitar
-- MAONO_TICKET_TRIAGE_ENABLED=true. Não aplicar por inferência de CI/merge.
-- Os defaults deixam registros existentes e writers antigos (inclusive CR)
-- explicitamente sem classificação: demand_nature NULL + triage_source legacy.

ALTER TABLE organization_tickets ADD COLUMN demand_nature TEXT
  CHECK (demand_nature IS NULL OR demand_nature IN
    ('question_request', 'incident', 'defect', 'improvement_change', 'recurring_problem'));
ALTER TABLE organization_tickets ADD COLUMN expected_result TEXT NOT NULL DEFAULT ''
  CHECK (length(expected_result) <= 2000);
ALTER TABLE organization_tickets ADD COLUMN context TEXT NOT NULL DEFAULT ''
  CHECK (length(context) <= 2000);
ALTER TABLE organization_tickets ADD COLUMN impact TEXT
  CHECK (impact IS NULL OR impact IN ('individual', 'team', 'organization'));
ALTER TABLE organization_tickets ADD COLUMN urgency TEXT
  CHECK (urgency IS NULL OR urgency IN ('flexible', 'soon', 'blocked'));
ALTER TABLE organization_tickets ADD COLUMN priority_reason TEXT NOT NULL DEFAULT ''
  CHECK (length(priority_reason) <= 1000);
ALTER TABLE organization_tickets ADD COLUMN triage_answers TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(triage_answers) AND json_type(triage_answers) = 'object'
    AND length(triage_answers) <= 14000);
ALTER TABLE organization_tickets ADD COLUMN triage_form_version INTEGER
  CHECK (triage_form_version IS NULL OR triage_form_version = 1);
ALTER TABLE organization_tickets ADD COLUMN triage_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK ((triage_source = 'legacy' AND demand_nature IS NULL) OR
    (triage_source = 'human' AND demand_nature IS NOT NULL
      AND length(trim(expected_result)) > 0 AND impact IS NOT NULL
      AND urgency IS NOT NULL AND triage_form_version = 1));
ALTER TABLE organization_tickets ADD COLUMN triaged_at TEXT;
ALTER TABLE organization_tickets ADD COLUMN triaged_by INTEGER
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organization_tickets_triage
  ON organization_tickets(organization_id, demand_nature, created_at DESC, id DESC);
-- No UPDATE/backfill derives a nature, actor, date, or answer from legacy data.
