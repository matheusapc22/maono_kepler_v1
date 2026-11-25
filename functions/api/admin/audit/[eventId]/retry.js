import { createAuditRetryHandler } from '../../../../_lib/admin-operation-audit-http.js';
export const onRequest = createAuditRetryHandler();
