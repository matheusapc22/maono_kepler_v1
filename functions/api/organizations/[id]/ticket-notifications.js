import { authorizeNotificationRequest } from '../../../_lib/ticket-notification-http.js';
import { listTicketNotifications,markTicketNotification } from '../../../_lib/ticket-notifications.js';
import { jsonResponse,methodNotAllowed,readJsonBody } from '../../../_lib/organizations.js';
import { ticketCenterErrorResponse } from '../../../_lib/ticket-center.js';
export async function onRequest({env,request,params}) {
  if (!['GET','PATCH'].includes(request.method)) return methodNotAllowed(request.method,['GET','PATCH']);
  try {
    const {organizationId,user}=await authorizeNotificationRequest(env,request,params);
    const url=new URL(request.url);
    let result;
    if(request.method==='GET') result=await listTicketNotifications(env,organizationId,user,
      {before:url.searchParams.get('before'),limit:url.searchParams.get('limit')});
    else { const body=await readJsonBody(request); result=await markTicketNotification(env,organizationId,user,body.id,body.read); }
    return jsonResponse({ok:true,...result},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return ticketCenterErrorResponse(error,request); }
}
