-- Endurecimento da governança de acessos delegados por organização.
-- Aplicar depois de 0012_access_delegation_policy.sql.

ALTER TABLE organization_access_delegations
  ADD COLUMN justification TEXT NOT NULL DEFAULT '';

ALTER TABLE organization_access_delegations
  ADD COLUMN revision_token TEXT;
