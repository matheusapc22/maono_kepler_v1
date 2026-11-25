import AdminAuditLegacy from './AdminAuditLegacy';
import AdminAuditOperations from './AdminAuditOperations';

export default function AdminAudit({ sessionAvailable }: { sessionAvailable: boolean }) {
  return import.meta.env.VITE_ADMIN_AUDIT_OPERATIONS_V1 === 'true'
    ? <AdminAuditOperations sessionAvailable={sessionAvailable} />
    : <AdminAuditLegacy sessionAvailable={sessionAvailable} />;
}
