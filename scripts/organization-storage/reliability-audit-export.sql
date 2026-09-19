-- Read-only observations. Preserve the raw Wrangler JSON, including audit IDs.
SELECT id, action, details, created_at
FROM audit_logs
WHERE action = 'organization.storage.observation'
ORDER BY id;
