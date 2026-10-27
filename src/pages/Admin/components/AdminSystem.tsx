import { useEffect, useState } from 'react';
import { parseJsonResponse } from '../../../lib/api-transport';
import { basicHealthSummary, healthChecks, parseBasicHealth, type BasicHealth } from './admin-system-model';
import '../admin-system.css';

type DiagnosticState = { pending: boolean; checks: BasicHealth | null; observedAt: string | null; error: string; retryable: boolean };
const initialState: DiagnosticState = { pending: true, checks: null, observedAt: null, error: '', retryable: false };

export default function AdminSystem({ sessionAvailable }: { sessionAvailable: boolean }) {
  const [state, setState] = useState<DiagnosticState>(initialState);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!sessionAvailable) { setState({ ...initialState, pending: false }); return () => controller.abort(); }
    setState(initialState);
    void (async () => {
      try {
        const response = await fetch('/api/health', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
        const checks = parseBasicHealth(await parseJsonResponse<unknown>(response));
        if (!controller.signal.aborted) setState({ pending: false, checks, observedAt: new Date().toISOString(), error: '', retryable: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        const status = Number((error as { status?: unknown })?.status);
        setState({ pending: false, checks: null, observedAt: null, error: [401, 403, 404].includes(status) ? 'Diagnóstico indisponível para este acesso.' : 'Não foi possível consultar o diagnóstico básico.', retryable: ![401, 403, 404].includes(status) });
      }
    })();
    return () => controller.abort();
  }, [retry, sessionAvailable]);
  const checks = sessionAvailable ? state.checks : null;
  return <section className="mm-card mm-section-card admin-system" aria-labelledby="admin-system-title">
    <h2 id="admin-system-title">Diagnóstico básico</h2>
    <p>Consulta contextual de /api/health. Os resultados descrevem somente as verificações abaixo, no instante da consulta.</p>
    {!sessionAvailable ? <p role="alert">Sessão indisponível. O diagnóstico foi removido desta tela.</p> : <>
      {state.pending && <p role="status">Consultando diagnóstico básico.</p>}
      {state.error && <div role="alert"><p>{state.error}</p>{state.retryable && <button className="mm-btn" type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}</div>}
      {checks && <p role="status">{basicHealthSummary(checks)}</p>}
      <div className="admin-system-data" aria-busy={sessionAvailable && state.pending}>
      {checks && <>
        <p>Recebido nesta sessão em <time dateTime={state.observedAt!}>{new Date(state.observedAt!).toLocaleString('pt-BR', { timeZone: 'UTC' })} UTC</time>.</p>
        <dl>{healthChecks.map(check => <div key={check.key}><dt>{check.label}</dt><dd>{checks[check.key] === null ? 'Indisponível' : checks[check.key] ? check.confirmed : check.unconfirmed}</dd></div>)}</dl>
      </>}
      </div>
    </>}
    <h3>O que esta consulta verifica</h3>
    <p>Presença do vínculo D1 e das três configurações do Dropbox. No banco, executa somente SELECT 1. Valores de chaves, segredos e tokens não são exibidos.</p>
    <h3>O que não foi verificado</h3>
    <p>Acesso, autenticação, leitura ou escrita reais no Dropbox; pastas e arquivos; migrations e integridade do banco; prontidão por organização; filas e demais rotas da plataforma.</p>
    <p>Este resultado não certifica a saúde integral da plataforma. Não há monitoramento automático. Sair e voltar à subaba inicia uma nova consulta.</p>
  </section>;
}
