import { requireOrganizationPermission } from '../../../../_lib/permissions.js';
import { getRouteParam, parsePositiveInteger, methodNotAllowed, jsonResponse } from '../../../../_lib/organizations.js';
import { ticketCenterErrorResponse } from '../../../../_lib/ticket-center.js';
import { metricsError } from '../../../../_lib/ticket-metrics-domain.js';
import { readMetrics, replayMetrics, publishMetricDefinition } from '../../../../_lib/ticket-metrics.js';
export async function onRequest({ env, request, params }) {
    if (!['GET', 'POST'].includes(request.method))
        return methodNotAllowed(request.method, ['GET', 'POST']);
    try {
        const org = parsePositiveInteger(getRouteParam(params, 'id'), 'organizationId');
        const { user } = await requireOrganizationPermission(env, request, request.method === 'POST' ? 'ticket.manage' : 'ticket.view', { organizationId: org, scopeType: 'organization', resourceType: 'ticket' }, { audit: false });
        let result;
        if (request.method === 'GET')
            result = await readMetrics(env, org, user, Object.fromEntries(new URL(request.url).searchParams));
        else {
            if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin)
                throw metricsError('Origem não permitida.', 403, 'TICKET_METRICS_ACCESS_DENIED');
            if (!String(request.headers.get('Content-Type')).startsWith('application/json'))
                throw metricsError('Envie JSON.', 415);
            if (Number(request.headers.get('Content-Length') || 0) > 4000)
                throw metricsError('Solicitação muito extensa.', 413);
            const text = await request.text();
            if (text.length > 4000)
                throw metricsError('Solicitação muito extensa.', 413);
            let body;
            try {
                body = JSON.parse(text);
            }
            catch {
                throw metricsError('JSON inválido.');
            }
            if (body?.action === 'define')
                result = await publishMetricDefinition(env, org, user, body);
            else if (body?.action === 'replay')
                result = await replayMetrics(env, org, user, body);
            else
                throw metricsError('Ação inválida.');
        }
        return jsonResponse({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    catch (error) {
        return ticketCenterErrorResponse(error, request);
    }
}
