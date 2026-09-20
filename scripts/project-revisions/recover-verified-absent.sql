-- MANUAL REPAIR TEMPLATE, NEVER a migration/startup task/operator.
-- Runbook: docs/runbooks/project-revision-recycle-recovery.md
-- Only after authorized, verified provider absence AND proven quiescence.
-- Bind a freshly inspected tuple; zero returned rows means STOP, not retry.
-- ?1 organization, ?2 project, ?3 candidate revision, ?4 canonical HEAD,
-- ?5 checksum, ?6 attempts, ?7 RECYCLE token, ?8 storage ref,
-- ?9 project Dropbox root, ?10 config filename, ?11 incident/recovery ID,
-- ?12 observed lifecycle (NULL is permitted for legacy).
UPDATE project_config_revisions
   SET error_stage = 'RECOVERY',
       error_code = 'PROJECT_CONFIG_RECYCLE_RECOVERED_ABSENT',
       transition_id = ?11,
       attempts = attempts + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE project_id = ?2
   AND revision = ?3
   AND revision = ?4 + 1
   AND status = 'FAILED'
   AND error_stage = 'RECYCLE'
   AND published_at IS NULL
   AND checksum = ?5
   AND attempts = ?6
   AND transition_id = ?7
   AND storage_provider = 'dropbox'
   AND storage_ref = ?8
   AND length(trim(?11)) BETWEEN 1 AND 160
   AND ?11 <> ?7
   AND EXISTS (
     SELECT 1 FROM projects p
      WHERE p.id = project_config_revisions.project_id
        AND p.organization_id = ?1
        AND p.config_revision = ?4
        AND p.dropbox_root_path = ?9
        AND p.default_config_file = ?10
        AND p.lifecycle_state IS ?12
   )
   AND NOT EXISTS (
     SELECT 1 FROM projects p
      WHERE p.config_storage_ref = project_config_revisions.storage_ref
         OR (p.id = project_config_revisions.project_id
             AND p.config_revision >= project_config_revisions.revision)
   )
RETURNING project_id, revision, status, checksum, attempts, error_stage, transition_id;
