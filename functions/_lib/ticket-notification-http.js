import { requireOrganizationPermission } from './permissions.js';
import { getOrganizationOrThrow, getRouteParam, parsePositiveInteger } from './organizations.js';
import { notificationError } from './ticket-notifications.js';
export async function authorizeNotificationRequest(env, request, params) {
  const organizationId=parsePositiveInteger(getRouteParam(params,'id'),'organizationId');
  if (request.method!=='GET') {
    const origin=request.headers.get('Origin');
    if (origin && origin!==new URL(request.url).origin) throw notificationError('TICKET_NOTIFICATION_ORIGIN_DENIED',403);
    if (!String(request.headers.get('Content-Type')).toLowerCase().startsWith('application/json')) throw notificationError('TICKET_NOTIFICATION_JSON_REQUIRED',415);
  }
  const {user}=await requireOrganizationPermission(env,request,'ticket.view',
    {organizationId,scopeType:'organization',resourceType:'ticket'},{audit:false,resourceType:'ticket'});
  await getOrganizationOrThrow(env,organizationId);
  return {organizationId,user};
}
