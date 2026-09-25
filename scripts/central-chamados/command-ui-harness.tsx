// Local browser fixture. Real product components/API client; fictional intercepted HTTP.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import NewTicketPopover from '../../src/pages/Projects/components/NewTicketPopover';
import TicketDetailDrawer from '../../src/pages/Projects/components/TicketDetailDrawer';
import { getTicketDetails, runTicketCommand, updateTicket, toTicketApiError, type TicketApiError } from '../../src/pages/Projects/components/tickets-api';
import { DEFAULT_TICKET_ATTACHMENT_LIMITS, type TicketCommand, type TicketDetailResponse, type UpdateTicketPayload } from '../../src/pages/Projects/components/ticket-types';
import '../../src/pages/Projects/projects.css';

const params = new URLSearchParams(location.search);
const manage = params.get('manage') !== '0';
const people = [{ id: 7, name: 'Atendente QA' }];

function Harness() {
  const [open, setOpen] = useState(true);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TicketApiError | null>(null);
  const [lastResult, setLastResult] = useState<object | null>(null);
  async function reload() {
    setLoading(true); setError(null);
    try { setDetail(await getTicketDetails(1, 901)); }
    catch (failure) { setError(toTicketApiError(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (params.get('view') !== 'create') void reload(); }, []);
  async function update(payload: UpdateTicketPayload, etag?: string) {
    setSaving(true);
    try {
      const ticket = await updateTicket(1, 901, payload, undefined, { etag });
      setLastResult({ kind: 'update', payload, etag, ticket });
      await reload();
    } finally { setSaving(false); }
  }
  async function command(value: TicketCommand, etag: string) {
    setSaving(true);
    try {
      const ticket = await runTicketCommand(1, 901, value, etag);
      setLastResult({ ...value, etag, ticket });
      await reload();
    } finally { setSaving(false); }
  }
  return <BrowserRouter><main style={{ padding: 20, color: '#eee', background: '#08090b', minHeight: '100vh', fontFamily: 'Arial' }}>
    <h1>Fixture local CC-03</h1><p>Dados fictícios. Sem acesso a ambientes remotos.</p>
    <button onClick={() => setOpen(true)}>Abrir formulário</button>
    <pre id="qa-result" style={{ display: 'none' }}>{lastResult ? JSON.stringify(lastResult) : ''}</pre>
    {params.get('view') === 'create'
      ? <NewTicketPopover open={open} organizationId={1} assignees={people} canManage={manage}
          attachmentLimits={DEFAULT_TICKET_ATTACHMENT_LIMITS} triageEnabled={false} lifecycleEnabled
          onClose={() => setOpen(false)} onCreated={created => { setLastResult(created); setOpen(false); }} />
      : <TicketDetailDrawer open={open} organizationId={1} detail={detail} loading={loading} error={error} saving={saving}
          canManage={manage} canUpload={false} attachmentLimits={DEFAULT_TICKET_ATTACHMENT_LIMITS} currentUserId={7}
          onClose={() => setOpen(false)} onRetry={() => void reload()} onReload={() => void reload()} onUpdate={update} onCommand={command} />}
  </main></BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
