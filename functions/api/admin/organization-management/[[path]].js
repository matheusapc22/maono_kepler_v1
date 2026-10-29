import { requirePermission } from '../../../_lib/permissions.js';
import { createOrganizationLifecycle, updateOrganizationLifecycle } from '../../../_lib/organization-lifecycle.js';
import { resolveOrganizationPolicy, isProjectQuotaReservationEnabled } from '../../../_lib/organization-limit-service.js';
import { handleOrganizationManagement } from '../../../_lib/organization-management-http.js';

export function onRequest(context) {
  return handleOrganizationManagement(context, {
    createLifecycle: createOrganizationLifecycle,
    updateLifecycle: updateOrganizationLifecycle,
    resolvePolicy: resolveOrganizationPolicy,
    quotaEnabled: isProjectQuotaReservationEnabled,
    authorize: (env,request,organizationId) => requirePermission(env,request,'admin.panel.access',
      organizationId == null ? {scopeType:'global'} : {scopeType:'organization',organizationId},
      {audit:false,auditOnSuccess:false,resourceType:'organization',resourceId:organizationId ?? 'management'}),
  });
}
