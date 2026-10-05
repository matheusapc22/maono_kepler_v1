-- Read-only pre-activation evidence. Run only through the approved audit route.
-- A returned row blocks new durable-save admissions until its ownership and
-- storage/publication evidence have been reconciled. Time alone is not proof.
SELECT p.id AS project_id, p.organization_id, p.config_revision AS current_revision,
       r.revision AS candidate_revision, r.status, r.published_at, r.created_at, r.updated_at
FROM projects p
JOIN project_config_revisions r ON r.project_id=p.id
WHERE r.revision > p.config_revision
  AND (r.status IN ('RESERVED','WRITING','READY') OR r.published_at IS NOT NULL)
ORDER BY p.organization_id,p.id,r.revision;

-- A historical pointer without publication lineage also needs explicit review.
SELECT p.id AS project_id,p.organization_id,p.config_revision,
       r.status,r.published_at,
       CASE WHEN p.config_storage_ref=r.storage_ref THEN 1 ELSE 0 END AS reference_matches,
       CASE WHEN p.config_checksum=r.checksum THEN 1 ELSE 0 END AS checksum_matches
FROM projects p LEFT JOIN project_config_revisions r
  ON r.project_id=p.id AND r.revision=p.config_revision
WHERE p.lifecycle_state='ACTIVE' AND (r.id IS NULL OR r.status<>'READY'
  OR r.published_at IS NULL OR p.config_storage_ref IS NOT r.storage_ref
  OR p.config_checksum IS NOT r.checksum);
