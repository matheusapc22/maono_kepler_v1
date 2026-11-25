import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { parseJsonResponse } from '../../../lib/api-transport';
import { UniversalLoader } from '../../../components/loading/UniversalLoader';
import { normalizeUserError } from '../../../lib/user-error-catalog';
import { auditActionLabel, auditActorLabel, auditCategoryLabels, auditDateLabel, auditResultLabels, mergeAuditHistory, parseAuditDetail, parseAuditRecoveryResult, type AuditDetail, type AuditRecoveryAction } from './admin-audit-operations-model';

const headers = { Accept: 'application/json', 'X-Maono-Audit': 'operations-v1', 'X-Maono-UI-Route': '/admin' };
const actionLabels = { query: 'Consultar resultado', follow: 'Acompanhar', resolve: 'Resolver impedimentos', retry: 'Tentar novamente', resume: 'Retomar etapa pendente', review: 'Revisar organização' };
const executorLabels = { user: 'Pessoa autorizada', worker: 'Rotina automática', system: 'Sistema', unrecorded: 'Não registrado' };
function valueLabel(value: string | number | boolean | null) { return value === null ? 'Não registrado' : value === true ? 'Sim' : value === false ? 'Não' : String(value); }

export default function AdminAuditDetail({ eventId, anchor, onClose, onDenied }: {
  eventId: string; anchor: HTMLButtonElement | null; onClose: () => void; onDenied: () => void;
}) {
  const navigate = useNavigate(), dialog = useRef<HTMLDialogElement>(null), callbacks = useRef({ onClose, onDenied });
  callbacks.current = { onClose, onDenied };
  const [detail, setDetail] = useState<AuditDetail | null>(null), [pending, setPending] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [historyPending, setHistoryPending] = useState(false);
  const [commandPending, setCommandPending] = useState(false), [commandError, setCommandError] = useState(''), [success, setSuccess] = useState('');
  const [uncertain, setUncertain] = useState(false), [confirmation, setConfirmation] = useState('');
  const historyController = useRef<AbortController | null>(null);
  const commandController = useRef<AbortController | null>(null), commandInFlight = useRef(false), requestKeys = useRef(new Map<string, string>());
  useEffect(() => () => { historyController.current?.abort(); commandController.current?.abort(); }, []);
  useEffect(() => { if (!success) return; const timer = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(timer); }, [success]);
  useEffect(() => { if (!commandError) return; const timer = setTimeout(() => setCommandError(''), 10000); return () => clearTimeout(timer); }, [commandError]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const position = () => {
      const box = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      const margin = 12, width = Math.min(560, window.innerWidth - margin * 2);
      element.style.width = `${width}px`;
      element.style.maxHeight = `${window.innerHeight - margin * 2}px`;
      const height = Math.min(element.getBoundingClientRect().height, window.innerHeight - margin * 2);
      const left = box ? Math.max(margin, Math.min(box.right - width, window.innerWidth - width - margin)) : (window.innerWidth - width) / 2;
      const preferredTop = box ? box.bottom + 8 : (window.innerHeight - height) / 2;
      const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
      element.style.left = `${left}px`; element.style.top = `${top}px`;
    };
    element.showModal(); position();
    const observer = new ResizeObserver(position); observer.observe(element);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
      if (element.open) element.close();
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true); setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/admin/audit/${encodeURIComponent(eventId)}`, { credentials: 'include', cache: 'no-store', headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const value = parseAuditDetail(await parseJsonResponse<unknown>(response), eventId);
        if (!controller.signal.aborted) setDetail(value);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(Number((cause as { status?: unknown })?.status))) {
          setDetail(null); callbacks.current.onDenied(); return;
        }
        setError('Não foi possível consultar os detalhes. Tente consultar novamente.');
      } finally { if (!controller.signal.aborted) setPending(false); }
    })();
    return () => controller.abort();
  }, [eventId, retry]);
  async function loadHistory() {
    if (!detail?.nextHistoryBefore || historyPending || pending) return;
    const controller = new AbortController(); historyController.current?.abort(); historyController.current = controller;
    setHistoryPending(true); setError('');
    try {
      const response = await fetch(`/api/admin/audit/${encodeURIComponent(eventId)}?historyBefore=${detail.nextHistoryBefore}`, { credentials: 'include', cache: 'no-store', headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const older = parseAuditDetail(await parseJsonResponse<unknown>(response), eventId);
      if (!controller.signal.aborted) setDetail(current => current ? mergeAuditHistory(current, older) : older);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(Number((cause as { status?: unknown })?.status))) { setDetail(null); callbacks.current.onDenied(); return; }
      setError('Não foi possível carregar as etapas anteriores. Consulte novamente.');
    } finally { if (!controller.signal.aborted) setHistoryPending(false); }
  }
  async function act(action: AuditRecoveryAction) {
    if (!action.enabled || pending || commandInFlight.current) return;
    if ((action.kind === 'resolve' || action.kind === 'review') && action.organizationId) {
      const params = new URLSearchParams({ section: 'organizations', org_id: String(action.organizationId) });
      if (action.kind === 'resolve') params.set('org_resolver', '1');
      navigate(`/admin?${params}`);
      return;
    }
    if (action.kind === 'review' || (uncertain && ['retry', 'resume'].includes(action.kind))) return;
    if (action.confirmationRequired && confirmation !== 'EXCLUIR PERMANENTEMENTE') return;
    commandInFlight.current = true;
    const controller = new AbortController(); commandController.current?.abort(); commandController.current = controller;
    const signature = JSON.stringify([eventId, action.kind, action.operationId, action.itemIndex, action.expectedVersion]);
    let requestKey = requestKeys.current.get(signature);
    if (!requestKey) { requestKey = crypto.randomUUID(); requestKeys.current.set(signature, requestKey); }
    setCommandPending(true); setCommandError(''); setSuccess('');
    try {
      const response = await fetch(`/api/admin/audit/${encodeURIComponent(eventId)}/retry`, { method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        headers: { ...headers, 'Content-Type': 'application/json', 'X-Maono-Management': '1' },
        body: JSON.stringify({ action: action.kind, ...(action.expectedVersion === null ? {} : { expectedVersion: action.expectedVersion }), ...(action.confirmationRequired ? { confirmation } : {}), requestKey }) });
      const data = parseAuditRecoveryResult(await parseJsonResponse<unknown>(response), action);
      if (controller.signal.aborted) return;
      const refreshed = await fetch(`/api/admin/audit/${encodeURIComponent(eventId)}`, { credentials: 'include', cache: 'no-store', headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const current = parseAuditDetail(await parseJsonResponse<unknown>(refreshed), eventId);
      if (controller.signal.aborted) return;
      setDetail(current); setUncertain(false);
      // A lost response retains its key. Only a completed command + fresh domain
      // inspection, or an explicit successful query, permits a new intention.
      if (action.kind === 'query') requestKeys.current.clear();
      else if (action.kind === 'retry' || action.kind === 'resume') requestKeys.current.delete(signature);
      if (action.kind === 'query' || action.kind === 'follow') setSuccess('Consulta atualizada.');
      else if (data.operation?.items.some(item => ['failed', 'partial'].includes(item.state)) || (data.deletion?.errorCode && data.deletion.errorCode !== 'ORGANIZATION_DELETE_DRAINING')) setCommandError('A tentativa não foi concluída. Consulte o resultado e as opções disponíveis.');
      else if (data.deletion?.state === 'completed' || (data.operation?.done && data.operation.items.length > 0 && data.operation.items.every(item => item.state === 'succeeded'))) setSuccess('Operação concluída.');
      else setSuccess('Solicitação registrada. Acompanhe o resultado.');
    } catch (cause) {
      if (controller.signal.aborted) return;
      const status = Number((cause as { status?: unknown })?.status);
      if ([401, 403, 404].includes(status)) { setDetail(null); callbacks.current.onDenied(); return; }
      setUncertain(true);
      setCommandError(status >= 400 && status < 500 ? normalizeUserError(cause).message : 'Não foi possível confirmar a ação. Consulte o resultado antes de tentar novamente.');
    } finally {
      commandInFlight.current = false;
      if (!controller.signal.aborted) setCommandPending(false);
    }
  }
  return createPortal(<dialog ref={dialog} id="admin-audit-detail" className="admin-audit-detail" aria-labelledby="admin-audit-detail-title" aria-modal="true"
    onCancel={event => { event.preventDefault(); if (!commandPending) onClose(); }}>
    <header><div><small>Auditoria</small><h3 id="admin-audit-detail-title">Detalhes da operação</h3></div><button type="button" className="mm-btn" aria-label="Fechar detalhes" disabled={commandPending} onClick={onClose}>×</button></header>
    <div className="audit-detail-content" aria-busy={pending || commandPending}>
      {pending && <p role="status">Consultando detalhes…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" className="mm-btn" onClick={() => setRetry(value => value + 1)}>Consultar novamente</button></div>}
      {detail && <>
        <h4>{auditActionLabel(detail.entry.action)}</h4><p>{detail.entry.summary}</p>
        <span className={`audit-result audit-result-${detail.entry.result}`}>{auditResultLabels[detail.entry.result]}</span>
        <dl className="audit-detail-facts">
          <dt>Data e hora</dt><dd>{auditDateLabel(detail.entry.createdAt)}</dd><dt>Usuário</dt><dd>{auditActorLabel(detail.entry.actor)}</dd>
          <dt>Organização</dt><dd>{detail.entry.organization?.name || 'Não registrado'}</dd><dt>Recurso</dt><dd>{detail.entry.resource.label || 'Não registrado'}</dd>
          <dt>Rota</dt><dd>{detail.entry.route || 'Não registrado'}</dd><dt>Origem</dt><dd>{detail.entry.origin || 'Não registrado'}</dd>
          <dt>Categoria</dt><dd>{auditCategoryLabels[detail.entry.category]}</dd>
        </dl>
        {detail.entry.legacy && <p className="audit-legacy-note">Este registro não comprova o resultado da operação. Os campos sem informação permanecem como não registrados.</p>}
        <section aria-labelledby="audit-changes-title"><h4 id="audit-changes-title">Alterações registradas</h4>
          {detail.changes.length ? <dl className="audit-change-list">{detail.changes.map((change, index) => <div key={`${change.field}:${index}`}><dt>{change.field}</dt><dd><span>Antes: {valueLabel(change.before)}</span><span>Depois: {valueLabel(change.after)}</span></dd></div>)}</dl> : <p>Não há alterações registradas para este evento.</p>}
        </section>
        <section aria-labelledby="audit-attempts-title"><h4 id="audit-attempts-title">Tentativas e etapas</h4>
          {detail.attempts.length ? <ol className="audit-attempt-list">{detail.attempts.map((attempt, index) => <li key={attempt.id}>
            <h5>Tentativa {index + 1} · {auditResultLabels[attempt.result]}</h5><p>{auditDateLabel(attempt.startedAt)}{attempt.endedAt ? ` — ${auditDateLabel(attempt.endedAt)}` : ''}</p>
            <dl><dt>Autor original</dt><dd>{auditActorLabel(attempt.originalActor)}</dd><dt>Solicitante da tentativa</dt><dd>{auditActorLabel(attempt.requestedBy)}</dd><dt>Executor</dt><dd>{executorLabels[attempt.executor]}</dd></dl>
            {attempt.stages.length > 0 && <ul>{attempt.stages.map(stage => <li key={stage.id}><strong>{auditResultLabels[stage.result]}</strong> · {auditDateLabel(stage.createdAt)}{stage.summary && <p>{stage.summary}</p>}</li>)}</ul>}
          </li>)}</ol> : <p>Não há tentativas detalhadas registradas para este evento.</p>}
          {detail.nextHistoryBefore && <button type="button" className="mm-btn" disabled={pending || historyPending} onClick={() => void loadHistory()}>{historyPending ? 'Consultando etapas anteriores…' : 'Carregar etapas anteriores'}</button>}
        </section>
        <details className="audit-technical"><summary>Informações técnicas</summary><dl>
          <dt>Evento</dt><dd>{detail.technical.eventId || detail.entry.id}</dd><dt>Operação</dt><dd>{detail.technical.operationId || 'Não registrado'}</dd>
          <dt>Fonte</dt><dd>{detail.technical.source || 'Não registrado'}</dd><dt>Ação</dt><dd>{detail.entry.action}</dd><dt>Código</dt><dd>{detail.technical.code || 'Não registrado'}</dd>
        </dl></details>
        <footer className="audit-recovery-actions">
          <button type="button" className="mm-btn" disabled={pending || commandPending} onClick={() => setRetry(value => value + 1)}>{uncertain ? 'Atualizar ações disponíveis' : 'Atualizar detalhes'}</button>
          {detail.actions.some(action => action.enabled && action.confirmationRequired) && <label className="audit-confirmation">Digite EXCLUIR PERMANENTEMENTE para retomar a exclusão<input value={confirmation} autoComplete="off" spellCheck={false} disabled={commandPending} onChange={event => setConfirmation(event.target.value)} /></label>}
          {detail.actions.map((action, index) => <div key={`${action.kind}:${index}`}>
            <button type="button" className="mm-btn" disabled={pending || commandPending || !action.enabled || (action.confirmationRequired && confirmation !== 'EXCLUIR PERMANENTEMENTE') || (uncertain && ['retry', 'resume'].includes(action.kind))} onClick={() => void act(action)}>{actionLabels[action.kind]}</button>
            {action.reason && <p>{action.reason}</p>}
          </div>)}
        </footer>
      </>}
    </div>
    {commandPending && <div className="audit-detail-busy"><UniversalLoader size="page" accessibleLabel="Processando ação" /></div>}
    {commandError && <div className="audit-command-error" role="alert"><span>{commandError}</span><button type="button" aria-label="Fechar aviso de erro" onClick={() => setCommandError('')}>×</button></div>}
    {success && <div className="audit-command-success" role="status" aria-live="polite">{success}</div>}
  </dialog>, document.body);
}
