import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import { getRouteParam, parsePositiveInteger, readJsonBody, jsonResponse, methodNotAllowed } from "../../../../_lib/organizations.js";
import { ticketCenterErrorResponse } from "../../../../_lib/ticket-center.js";
import { readQueuePolicies, saveQueuePolicy } from "../../../../_lib/ticket-flow.js";
export async function onRequest({env,request,params}) {
  if (!['GET','PUT'].includes(request.method)) return methodNotAllowed(request.method,['GET','PUT']);
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params,'id'),'organizationId');
    const { user } = await requireOrganizationPermission(env,request,request.method === 'PUT' ? 'ticket.manage' : 'ticket.view',
      {organizationId,scopeType:'organization',resourceType:'ticket'}, {audit:false});
    const policies = request.method === 'GET' ? await readQueuePolicies(env,organizationId) : await saveQueuePolicy(env,organizationId,user,await readJsonBody(request));
    return jsonResponse({ok:true,policies},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return ticketCenterErrorResponse(error,request); }
}
