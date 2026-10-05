-- Post-migration operational checks; SELECT only, no map payload or secrets.
SELECT state,COUNT(*) AS operations,MIN(created_at) AS oldest_created_at
FROM project_save_operations GROUP BY state;
SELECT effect,state,COUNT(*) AS tasks,MIN(available_at) AS oldest_due_at
FROM project_save_outbox GROUP BY effect,state;
SELECT operation_id,organization_id,project_id,state,stage,error_code,attempts,
       next_attempt_at,lease_until,updated_at
FROM project_save_operations
WHERE state NOT IN ('PUBLISHED','CONFLICT','FAILED_FINAL')
  AND payload_stored_at IS NOT NULL
  AND updated_at < datetime('now','-15 minutes')
ORDER BY updated_at LIMIT 100;
