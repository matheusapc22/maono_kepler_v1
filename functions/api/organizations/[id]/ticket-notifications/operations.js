import { authorizeNotificationRequest } from '../../../../_lib/ticket-notification-http.js';
import { notificationOperations,retryTicketNotification } from '../../../../_lib/ticket-notifications.js';
import { jsonResponse,methodNotAllowed,readJsonBody } from '../../../../_lib/organizations.js';
import { ticketCenterErrorResponse } from '../../../../_lib/ticket-center.js';
export async function onRequest({env,request,params}) {
  if(!['GET','POST'].includes(request.method)) return methodNotAllowed(request.method,['GET','POST']);
  try {
    const {organizationId,user}=await authorizeNotificationRequest(env,request,params);
    const result=request.method==='GET' ? await notificationOperations(env,organizationId,user)
      : await retryTicketNotification(env,organizationId,user,(await readJsonBody(request)).outboxId);
    return jsonResponse({ok:true,...result},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return ticketCenterErrorResponse(error,request); }
}
