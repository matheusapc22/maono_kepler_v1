import assert from 'node:assert/strict';
import test from 'node:test';
import { readTicketNavigation, ticketNavigationUrl, ticketQueueAge } from '../src/pages/Projects/components/ticket-navigation.ts';
test('URL roundtrip preserves shared filters, view, deep link, unrelated params and fragment',()=>{
 const initial=readTicketNavigation('https://local.test/?cc_org=1','1');
 const filters={...initial.filters,q:'água & mapa',status:'in_review',assigneeId:'unassigned',from:'2026-09-01',to:'2026-09-30',sort:'due_asc',overdueOnly:true};
 const href=ticketNavigationUrl('https://local.test/projects?tab=tickets#central','1',filters,'calendar',123);
 assert.deepEqual(readTicketNavigation(href,'1'),{filters,view:'calendar',ticketId:'123'});
 assert.equal(new URL(href).searchParams.get('tab'),'tickets');assert.equal(new URL(href).hash,'#central');
 assert.equal(readTicketNavigation(href,'2').ticketId,null);assert.equal(readTicketNavigation(href,'2').filters.q,'');
});
test('URL validates identity, dates and enum inputs',()=>{
 const result=readTicketNavigation('https://local.test/?cc_org=1&cc_from=2026-02-31&cc_status=sql&cc_ticket=-1&cc_assigneeId=evil&cc_view=other','1');
 assert.equal(result.ticketId,null);assert.equal(result.filters.from,'');assert.equal(result.filters.status,'');assert.equal(result.filters.assigneeId,'');assert.equal(result.view,'list');
});
test('queue age distinguishes unobserved history from observed zero age',()=>{
 assert.equal(ticketQueueAge(null),'Início não observado');assert.equal(ticketQueueAge('bad'),'Início não observado');
 assert.equal(ticketQueueAge('2026-09-01T00:00:00Z',Date.parse('2026-09-03T12:00:00Z')),'2 d na fila');
});
