import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { parseJsonResponse } from '../../../lib/api-transport';
import { auditEventLabels, parseAuditPage, type AuditPage } from './admin-audit-model';
import '../admin-audit.css';

type ReadState = { key: string; pending: boolean; page: AuditPage | null; error: string; retryable: boolean };

export default function AdminAudit({ sessionAvailable }: { sessionAvailable: boolean }) {
  const [params, setParams] = useSearchParams();
  const before = params.get('audit_before');
  const key = before ?? 'latest';
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ReadState>({ key: '', pending: true, page: null, error: '', retryable: false });
  useEffect(() => {
    const controller = new AbortController();
    const publish = (next: ReadState) => { if (!controller.signal.aborted) setState(next); };
    if (!sessionAvailable) { publish({ key, pending: false, page: null, error: 'Sessão indisponível.', retryable: false }); return () => controller.abort(); }
    if (before !== null && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)))) {
      publish({ key, pending: false, page: null, error: 'Página inválida. Volte aos registros mais recentes.', retryable: false });
      return () => controller.abort();
    }
    publish({ key, pending: true, page: null, error: '', retryable: false });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const page = parseAuditPage(await parseJsonResponse<unknown>(response));
        publish({ key, pending: false, page, error: '', retryable: false });
      } catch (error) {
        const status = Number((error as { status?: unknown })?.status);
        const denied = [401, 403, 404].includes(status);
        publish({ key, pending: false, page: null, error: denied ? 'Consulta indisponível para este acesso.' : 'Não foi possível consultar a auditoria.', retryable: !denied });
      }
    })();
    return () => controller.abort();
  }, [before, key, retry, sessionAvailable]);
  const current = sessionAvailable && state.key === key ? state : null;
  const page = current?.page;
  const pending = sessionAvailable && (!current || current.pending);
  function navigate(beforeId: number | null) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set('section', 'audit'); if (beforeId === null) next.delete('audit_before'); else next.set('audit_before', String(beforeId)); return next; });
  }
  return <section className="mm-card mm-section-card admin-audit" aria-labelledby="admin-audit-title">
    <h2 id="admin-audit-title">Registros de auditoria</h2>
    <p>Leitura global restrita ao Super Admin. Até 25 registros por página, do maior para o menor ID.</p>
    <p>Exibe apenas ID, horário registrado e categoria de ação. Não identifica organização, pessoa ou projeto; detalhes privados e resultado da operação não são exibidos. A presença de um registro não comprova sucesso nem cobertura completa das operações.</p>
    {pending && <p role="status">Consultando registros de auditoria.</p>}
    {!sessionAvailable && <p role="alert">Sessão indisponível. Os registros foram removidos desta tela.</p>}
    {current?.error && <div role="alert"><p>{current.error}</p>{current.retryable && <button className="mm-btn" type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}</div>}
    {page?.entries.length === 0 && <p role="status">Nenhum registro encontrado nesta página.</p>}
    <div className="admin-audit-data" aria-busy={pending}>
    {page && page.entries.length > 0 && <div className="mm-table-wrap"><table>
      <caption>Eventos registrados, sem detalhes privados</caption>
      <thead><tr><th scope="col">ID</th><th scope="col">Horário (UTC)</th><th scope="col">Categoria da ação</th></tr></thead>
      <tbody>{page.entries.map(entry => <tr key={entry.id}><td>{entry.id}</td><td>{entry.createdAt ? <time dateTime={entry.createdAt}>{entry.createdAt.replace('T', ' ').replace('.000Z', ' UTC')}</time> : 'Horário indisponível'}</td><td>{auditEventLabels[entry.event]}</td></tr>)}</tbody>
    </table></div>}
    </div>
    <nav aria-label="Páginas de auditoria">
      {before !== null && <button type="button" className="mm-btn" disabled={pending || !sessionAvailable} onClick={() => navigate(null)}>Registros mais recentes</button>}
      {page?.nextBefore !== null && page?.nextBefore !== undefined && <button type="button" className="mm-btn" onClick={() => navigate(page.nextBefore)}>Registros anteriores</button>}
    </nav>
  </section>;
}
