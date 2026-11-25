import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { parseJsonResponse } from '../../../lib/api-transport';
import { MaonoSelect } from '../../../components/selection/MaonoSelect';
import AdminAuditDetail from './AdminAuditDetail';
import {
  auditActionLabel, auditActorLabel, auditCategoryLabels, auditDateLabel, auditFilterErrorLabel, auditFiltersFromParams,
  auditQuery, auditResultLabels, emptyAuditFilters, parseAuditPage,
  type AuditFilters, type AuditOrganization, type AuditPage,
} from './admin-audit-operations-model';
import '../admin-audit.css';

const auditHeaders = { Accept: 'application/json', 'X-Maono-Audit': 'operations-v1', 'X-Maono-UI-Route': '/admin' };
type ReadState = { key: string; pending: boolean; page: AuditPage | null; error: string; retryable: boolean };
type Facets = { key: string; pending: boolean; items: AuditOrganization[]; more: boolean; error: string };

function OrganizationFilter({ value, onChange, available, onDenied }: { value: string; onChange: (value: string) => void; available: boolean; onDenied: () => void }) {
  const id = useId();
  const [search, setSearch] = useState(''), [open, setOpen] = useState(false);
  const [state, setState] = useState<Facets>({ key: '', pending: false, items: [], more: false, error: '' });
  const field = useRef<HTMLInputElement>(null);
  const suppressFocusOpen = useRef(false);
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  useEffect(() => {
    const controller = new AbortController();
    if (!available || !open) return () => controller.abort();
    const key = search.trim();
    setState({ key, pending: true, items: [], more: false, error: '' });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/admin/audit/organizations?search=${encodeURIComponent(key)}`, { credentials: 'include', cache: 'no-store', headers: auditHeaders, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
          const data = await parseJsonResponse<{ ok: boolean; organizations: AuditOrganization[]; hasMore: boolean; capabilities: { operations: boolean } }>(response);
          if (data?.ok !== true || data.capabilities?.operations !== true || !Array.isArray(data.organizations) || data.organizations.length > 25 || typeof data.hasMore !== 'boolean' || data.organizations.some(item => !item || !Number.isSafeInteger(item.id) || Number(item.id) < 1 || (item.name !== null && typeof item.name !== 'string') || (item.slug !== null && typeof item.slug !== 'string'))) throw new Error('Consulta indisponível.');
          if (!controller.signal.aborted) setState({ key, pending: false, items: data.organizations.map(item => ({ id: item.id, name: item.name, slug: item.slug })), more: data.hasMore, error: '' });
        } catch (cause) {
          if (!controller.signal.aborted && [401, 403, 404].includes(Number((cause as { status?: unknown })?.status))) deniedCallback.current();
          if (!controller.signal.aborted) setState({ key, pending: false, items: [], more: false, error: 'Não foi possível buscar organizações. Tente novamente pela busca.' });
        }
      })();
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, open, available]);
  const current = available && open && state.key === search.trim() ? state : null;
  return <div className="audit-organization-filter">
    <label htmlFor={id}>Organização</label>
    <div className="audit-organization-search">
      <input ref={field} id={id} value={available ? search : ''} placeholder={available && value ? `Organização selecionada: ${value}` : 'Buscar nome, identificador ou número'} autoComplete="off" maxLength={120}
        disabled={!available} aria-controls={`${id}-options`} aria-expanded={open} onFocus={() => { if (!suppressFocusOpen.current) setOpen(true); suppressFocusOpen.current = false; }}
        onChange={event => { setSearch(event.target.value); setOpen(true); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } }} />
      {(value || search) && <button type="button" className="mm-btn" aria-label="Limpar organização" disabled={!available} onClick={() => { onChange(''); setSearch(''); setOpen(false); }}>×</button>}
    </div>
    {available && open && <div className="audit-organization-options" id={`${id}-options`} aria-label="Organizações registradas">
      {current?.pending && <p role="status">Buscando organizações…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {current && !current.pending && !current.error && !current.items.length && <p>Nenhuma organização encontrada.</p>}
      {current?.items.map(item => <button type="button" key={item.id} onClick={() => { onChange(String(item.id)); setSearch(item.name || item.slug || `Organização ${item.id}`); setOpen(false); suppressFocusOpen.current = true; field.current?.focus({ preventScroll: true }); }}>
        <strong>{item.name || 'Nome não registrado'}</strong><small>{item.slug || `Organização ${item.id}`}</small>
      </button>)}
      {current?.more && <p>Refine a busca para encontrar outras organizações.</p>}
      <button type="button" className="audit-close-search" onClick={() => setOpen(false)}>Fechar busca</button>
    </div>}
  </div>;
}

export default function AdminAuditOperations({ sessionAvailable }: { sessionAvailable: boolean }) {
  const [params, setParams] = useSearchParams();
  const from = params.get('audit_from') ?? '', to = params.get('audit_to') ?? '', result = params.get('audit_result') ?? '', organizationId = params.get('audit_org') ?? '';
  const filters = useMemo(() => ({ from, to, result, organizationId }), [from, to, result, organizationId]);
  const before = params.get('audit_before'), selectedId = params.get('audit_event'), operationId = params.get('audit_operation');
  const [draft, setDraft] = useState<AuditFilters>(() => auditFiltersFromParams(params));
  const [formError, setFormError] = useState(''), [retry, setRetry] = useState(0), [denied, setDenied] = useState(false);
  const [state, setState] = useState<ReadState>({ key: '', pending: true, page: null, error: '', retryable: false });
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [bridge, setBridge] = useState({ key: '', pending: false, error: '', missing: false });
  const queryState = useMemo(() => {
    try { return { query: auditQuery(filters, before), error: '' }; }
    catch (error) { return { query: '', error: auditFilterErrorLabel(error) }; }
  }, [filters, before]);
  const key = JSON.stringify([filters, before]), available = sessionAvailable && !denied;
  useEffect(() => { setDraft(filters); setFormError(''); }, [filters]);
  useEffect(() => {
    const controller = new AbortController();
    const publish = (next: ReadState) => { if (!controller.signal.aborted) setState(next); };
    if (!available || queryState.error) {
      publish({ key, pending: false, page: null, error: queryState.error || (denied ? 'Consulta indisponível para este acesso.' : 'Sessão indisponível.'), retryable: false });
      return () => controller.abort();
    }
    publish({ key, pending: true, page: null, error: '', retryable: false });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/audit${queryState.query ? `?${queryState.query}` : ''}`, { credentials: 'include', cache: 'no-store', headers: auditHeaders, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const page = parseAuditPage(await parseJsonResponse<unknown>(response));
        publish({ key, pending: false, page, error: '', retryable: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        const accessDenied = [401, 403, 404].includes(Number((error as { status?: unknown })?.status));
        if (accessDenied) setDenied(true);
        publish({ key, pending: false, page: null, error: accessDenied ? 'Consulta indisponível para este acesso.' : 'Não foi possível consultar a auditoria. Os registros não foram apresentados como vazios.', retryable: !accessDenied });
      }
    })();
    return () => controller.abort();
  }, [available, denied, key, queryState, retry]);
  const current = sessionAvailable && state.key === key ? state : null;
  const page = available ? current?.page : null;
  const pending = available && (!current || current.pending);
  const closeDetail = useCallback(() => {
    setParams(previous => { const next = new URLSearchParams(previous); next.delete('audit_event'); return next; }, { replace: true });
  }, [setParams]);
  const deny = useCallback(() => { setDenied(true); setState({ key, pending: false, page: null, error: 'Consulta indisponível para este acesso.', retryable: false }); closeDetail(); }, [key, closeDetail]);
  useEffect(() => {
    const controller = new AbortController();
    if (!operationId || selectedId || !available || !page) return () => controller.abort();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) { setBridge({ key: operationId, pending: false, error: 'A referência da operação é inválida.', missing: false }); return () => controller.abort(); }
    setBridge({ key: operationId, pending: true, error: '', missing: false });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/audit/operations/${encodeURIComponent(operationId)}`, { credentials: 'include', cache: 'no-store', headers: auditHeaders, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const data = await parseJsonResponse<{ ok: boolean; eventId: string; capabilities: { operations: boolean } }>(response);
        if (data?.ok !== true || data.capabilities?.operations !== true || !/^frame:[1-9]\d*$/.test(data.eventId)) throw new Error('Referência indisponível.');
        if (!controller.signal.aborted) {
          setBridge({ key: operationId, pending: false, error: '', missing: false });
          setParams(previous => { const next = new URLSearchParams(previous); next.delete('audit_operation'); next.set('audit_event', data.eventId); return next; }, { replace: true });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        const status = Number((cause as { status?: unknown })?.status);
        if ([401, 403].includes(status)) { deny(); return; }
        setBridge({ key: operationId, pending: false, error: status === 404 ? 'Esta operação ainda não possui um registro detalhado nesta auditoria. Consulte o resultado pelo fluxo da organização.' : 'Não foi possível localizar o relatório desta operação.', missing: status === 404 });
      }
    })();
    return () => controller.abort();
  }, [operationId, selectedId, available, page, setParams, deny]);
  function applyFilters(nextFilters: AuditFilters) {
    try { auditQuery(nextFilters, null); } catch (error) { setFormError(auditFilterErrorLabel(error)); return; }
    setFormError('');
    setParams(previous => {
      const next = new URLSearchParams(previous); next.set('section', 'audit'); next.delete('audit_before'); next.delete('audit_event'); next.delete('audit_operation');
      for (const [name, value] of Object.entries({ audit_from: nextFilters.from, audit_to: nextFilters.to, audit_result: nextFilters.result, audit_org: nextFilters.organizationId })) {
        if (value) next.set(name, value); else next.delete(name);
      }
      return next;
    });
  }
  function submit(event: FormEvent) { event.preventDefault(); applyFilters(draft); }
  function navigate(cursor: string | null) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set('section', 'audit'); next.delete('audit_event'); if (cursor === null) next.delete('audit_before'); else next.set('audit_before', cursor); return next; });
  }
  const selectedValid = selectedId !== null && /^(frame|legacy):[1-9]\d*$/.test(selectedId);
  return <section className="mm-card mm-section-card admin-audit admin-audit-operations" aria-labelledby="admin-audit-title">
    <header className="audit-heading"><div><h2 id="admin-audit-title">Auditoria</h2><p>Ações registradas e seus resultados. Horários no fuso de Brasília.</p></div>
      <button type="button" className="mm-btn" disabled={pending || !available} onClick={() => setRetry(value => value + 1)}>Atualizar registros</button>
    </header>
    <form className="audit-filters" aria-label="Filtros da auditoria" onSubmit={submit}>
      <label>De<input type="date" value={draft.from} disabled={!available} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label>
      <label>Até<input type="date" value={draft.to} disabled={!available} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label>
      <label>Resultado<MaonoSelect value={draft.result} disabled={!available} onChange={event => setDraft(value => ({ ...value, result: event.target.value }))}>
        <option value="">Todos os resultados</option>{Object.entries(auditResultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </MaonoSelect></label>
      <OrganizationFilter key={organizationId} value={draft.organizationId} available={available} onDenied={deny} onChange={value => setDraft(previous => ({ ...previous, organizationId: value }))} />
      <div className="audit-filter-actions"><button type="submit" className="mm-btn audit-primary" disabled={!available || pending}>Aplicar filtros</button><button type="button" className="mm-btn" disabled={!available} onClick={() => { setDraft(emptyAuditFilters); applyFilters(emptyAuditFilters); }}>Limpar filtros</button></div>
      {formError && <p role="alert" className="audit-filter-error">{formError}</p>}
    </form>
    {pending && <p role="status">Consultando registros de auditoria.</p>}
    {!sessionAvailable && <p role="alert">Sessão indisponível. Os registros foram removidos desta tela.</p>}
    {sessionAvailable && current?.error && <div role="alert"><p>{current.error}</p>{current.retryable && <button type="button" className="mm-btn" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}</div>}
    {page?.entries.length === 0 && <p role="status">Nenhum registro encontrado com estes filtros.</p>}
    {available && operationId && bridge.key === operationId && bridge.pending && <p role="status">Localizando relatório da operação…</p>}
    {available && operationId && bridge.key === operationId && bridge.error && <div role="alert"><p>{bridge.error}</p>{bridge.missing && <Link className="mm-btn" to={`/admin?${new URLSearchParams(params.get('audit_deletion')==='1'&&organizationId?{section:'organizations',org_mode:'delete',org_id:organizationId,org_deletion:operationId}:{ section: 'organizations', org_mode: 'operation', org_operation: operationId })}`}>Voltar à consulta da operação</Link>}</div>}
    <div className="admin-audit-data" aria-busy={pending}>
      {page && page.entries.length > 0 && <div className="mm-table-wrap audit-table-wrap" role="region" aria-label="Tabela de auditoria, com rolagem horizontal" tabIndex={0}><table>
        <caption>Até 25 registros por página. Dados ausentes no histórico não são reconstruídos.</caption>
        <thead><tr>{['Data e hora', 'Usuário', 'Organização', 'Rota', 'Categoria da ação', 'Ação', 'Recurso', 'Resultado', 'Detalhes'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{page.entries.map(entry => <tr key={entry.id}>
          <td>{entry.createdAt ? <time dateTime={entry.createdAt}>{auditDateLabel(entry.createdAt)}</time> : 'Não registrado'}</td>
          <td>{auditActorLabel(entry.actor)}</td>
          <td>{entry.organization?.id ? <button type="button" className="audit-text-button" aria-label={`Filtrar por ${entry.organization.name || 'organização registrada'}`} onClick={() => applyFilters({ ...filters, organizationId: String(entry.organization!.id) })}>{entry.organization.name || 'Não registrado'}</button> : 'Não registrado'}</td>
          <td>{entry.route || entry.origin || 'Não registrado'}</td><td>{auditCategoryLabels[entry.category]}</td><td>{auditActionLabel(entry.action)}</td>
          <td>{entry.resource.label || 'Não registrado'}</td><td><span className={`audit-result audit-result-${entry.result}`}>{auditResultLabels[entry.result]}</span></td>
          <td><button type="button" className="mm-btn audit-details-trigger" aria-haspopup="dialog" aria-expanded={selectedId === entry.id} aria-controls={selectedId === entry.id ? 'admin-audit-detail' : undefined}
            aria-label={`Detalhes de ${auditActionLabel(entry.action)} em ${entry.organization?.name || entry.resource.label || 'registro'}`}
            onClick={event => { anchor.current = event.currentTarget; setParams(previous => { const next = new URLSearchParams(previous); next.set('audit_event', entry.id); return next; }, { replace: true }); }}>⋮</button></td>
        </tr>)}</tbody>
      </table></div>}
    </div>
    <nav aria-label="Páginas de auditoria">
      {before !== null && <button type="button" className="mm-btn" disabled={pending || !available} onClick={() => navigate(null)}>Registros mais recentes</button>}
      {page?.nextBefore && <button type="button" className="mm-btn" disabled={pending || !available} onClick={() => navigate(page.nextBefore)}>Registros anteriores</button>}
    </nav>
    {available && page && selectedId && !selectedValid && <p role="alert">Registro inválido. <button type="button" className="mm-btn" onClick={closeDetail}>Fechar detalhes</button></p>}
    {available && page && selectedValid && <AdminAuditDetail key={selectedId} eventId={selectedId} anchor={anchor.current} onClose={closeDetail} onDenied={deny} />}
  </section>;
}
