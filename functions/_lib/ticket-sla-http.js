import { requireOrganizationPermission } from './permissions.js';
import { getRouteParam, parsePositiveInteger, methodNotAllowed, jsonResponse } from './organizations.js';
import { ticketCenterErrorResponse } from './ticket-center.js';
import { listSlaPolicies, publishSlaPolicy, assignSlaPolicy, readTicketSla } from './ticket-sla.js';
import { slaError } from './ticket-sla-clock.js';
export async function slaResponse({ env, request, params }, ticketRoute = false) {
    if (!['GET', 'POST'].includes(request.method))
        return methodNotAllowed(request.method, ['GET', 'POST']);
    try {
        const org = parsePositiveInteger(getRouteParam(params, 'id'), 'organizationId'), ticket = ticketRoute ? parsePositiveInteger(getRouteParam(params, 'ticketId'), 'ticketId') : null;
        const action = request.method === 'POST' || !ticketRoute ? 'ticket.manage' : 'ticket.view';
        const { user } = await requireOrganizationPermission(env, request, action, { organizationId: org, scopeType: 'organization', resourceType: 'ticket', ...(ticket ? { resourceId: ticket } : {}) }, { audit: false });
        let body;
        if (request.method === 'POST') {
            const origin = request.headers.get('Origin');
            if (origin && origin !== new URL(request.url).origin)
                throw slaError('Origem não permitida.', 403, 'TICKET_SLA_ORIGIN_DENIED');
            if (!String(request.headers.get('Content-Type')).startsWith('application/json'))
                throw slaError('Envie JSON.', 415, 'TICKET_SLA_JSON_REQUIRED');
            if (Number(request.headers.get('Content-Length') || 0) > 40000)
                throw slaError('Configuração muito extensa.', 413);
            const text = await request.text();
            if (text.length > 40000)
                throw slaError('Configuração muito extensa.', 413);
            try {
                body = JSON.parse(text);
            }
            catch {
                throw slaError('JSON inválido.');
            }
        }
        const result = ticketRoute ? (request.method === 'GET' ? await readTicketSla(env, org, ticket, user) : await assignSlaPolicy(env, org, ticket, user, body)) : (request.method === 'GET' ? await listSlaPolicies(env, org) : await publishSlaPolicy(env, org, user, body));
        return jsonResponse({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    catch (error) {
        return ticketCenterErrorResponse(error, request);
    }
}
