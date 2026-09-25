// Isolated UI fixture for local browser checks. Never imported by the application.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import NewTicketPopover from '../../src/pages/Projects/components/NewTicketPopover';
import TicketDetailDrawer from '../../src/pages/Projects/components/TicketDetailDrawer';
import { DEFAULT_TICKET_ATTACHMENT_LIMITS, type Ticket, type TicketDetailResponse, type UpdateTicketPayload } from '../../src/pages/Projects/components/ticket-types';
import '../../src/pages/Projects/projects.css';

const params = new URLSearchParams(location.search);
const enabled = params.get('enabled') === '1';
const manage = params.get('manage') !== '0';
const people = [{ id: 7, name: 'Atendente QA' }];
const initial: Ticket = {
  id: 901, organizationId: 1, code: 'TKT-QA-901', subject: 'Chamado fictício de teste',
  description: 'Registro local para verificar os componentes da triagem.', status: 'open',
  priority: 'normal', category: 'map', dueAt: '2026-10-05T18:34:56.000Z', attachmentsCount: 0, demandNature: null,
  needsTriage: true, triageSource: 'legacy', expectedResult: null,
};
function Harness() {
  const [open, setOpen] = useState(true);
  const [ticket, setTicket] = useState(initial);
  const [lastPayload, setLastPayload] = useState<object | null>(null);
  const detail: TicketDetailResponse = { ok: true, ticket, attachments: [], events: [], assignees: people,
    attachmentLimits: DEFAULT_TICKET_ATTACHMENT_LIMITS, triageEnabled: enabled };
  async function update(payload: UpdateTicketPayload) {
    setLastPayload(payload);
    setTicket(current => ({ ...current, ...payload, assignedTo: current.assignedTo,
      needsTriage: payload.demandNature ? false : current.needsTriage }));
  }
  return <BrowserRouter><main style={{ padding: 20, color: '#eee', background: '#08090b', minHeight: '100vh', fontFamily: 'Arial' }}>
    <h1>Fixture local CC-02</h1><p>Dados fictícios. Sem conexão com produção.</p>
    <button onClick={() => setOpen(true)}>Abrir formulário</button>
    <pre id="qa-result">{lastPayload ? JSON.stringify(lastPayload) : ''}</pre>
    {params.get('view') === 'detail'
      ? <TicketDetailDrawer open={open} organizationId={1} detail={detail} loading={false} error={null} saving={false}
          canManage={manage} canUpload={false} attachmentLimits={DEFAULT_TICKET_ATTACHMENT_LIMITS} currentUserId={7}
          onClose={() => setOpen(false)} onRetry={() => {}} onReload={() => {}} onUpdate={update} />
      : <NewTicketPopover open={open} organizationId={1} assignees={people} canManage={manage}
          attachmentLimits={DEFAULT_TICKET_ATTACHMENT_LIMITS} triageEnabled={enabled}
          onClose={() => setOpen(false)} onCreated={created => { setLastPayload(created); setOpen(false); }} />}
  </main></BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
