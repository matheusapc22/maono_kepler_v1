import { useState } from 'react';
import { saveTicketQueuePolicy, toTicketApiError, type TicketApiError } from './tickets-api';
import TicketErrorNotice from './TicketErrorNotice';
import { STATUS_LABELS, type TicketQueuePolicy } from './ticket-types';
export default function TicketFlowSettings({organizationId,policies,onSaved}: {organizationId: number | string; policies: TicketQueuePolicy[]; onSaved: () => void}) {
  const [error,setError] = useState<TicketApiError | null>(null), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  return <details className="ticket-flow-settings"><summary>Limites de trabalho em andamento (WIP)</summary>
    <p>O limite considera todos os chamados da organização na fila. Uma exceção exige justificativa registrada no histórico. Sem limite é a configuração inicial.</p>
    {policies.map(policy => <form key={`${policy.queue}:${policy.version}`} onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      const data = new FormData(event.currentTarget); setBusy(true); setError(null); setMessage('');
      try { await saveTicketQueuePolicy(organizationId,{...policy,wipLimit: data.get('limit') ? Number(data.get('limit')) : null,reason:String(data.get('reason') || '')}); setMessage('Configuração registrada.'); onSaved(); }
      catch(e) { setError(toTicketApiError(e)); } finally { setBusy(false); }
    }}>
      <h4>{STATUS_LABELS[policy.queue]}</h4>
      <label>Limite (vazio = sem limite) <input name="limit" type="number" min="1" max="10000" defaultValue={policy.wipLimit ?? ''} disabled={busy}/></label>
      <label>Justificativa <input name="reason" required minLength={10} maxLength={1000} disabled={busy}/></label>
      <button type="submit" disabled={busy}>Salvar limite</button>
    </form>)}
    {error && <TicketErrorNotice error={error} onRetry={onSaved}/>}
    {message && <p role="status">{message}</p>}
  </details>;
}
