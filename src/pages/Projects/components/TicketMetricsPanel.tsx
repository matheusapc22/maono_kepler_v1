import { useManualRefreshFocus } from "./useManualRefreshFocus";
import { useTicketOptionalPresentation } from "./useTicketOptionalPresentation";
import { StaticLoadingText } from "../../../components/loading/Skeleton";
import TicketOptionalPanelState from "./TicketOptionalPanelState";
import { isRegionAccessDenied } from "../../../components/loading/region-loading-policy";
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../../lib/api-transport';
import { toTicketApiError } from './tickets-api';
import TicketErrorNotice from './TicketErrorNotice';
import './ticket-metrics.css';
type Distribution = {
    population: number;
    observed: number;
    unknown: number;
    censored: number;
    coverage: number | null;
    p50: number | null;
    p90: number | null;
    p95: number | null;
};
type Metrics = {
    feedback?: {enabled:boolean;groups?:{version:number;eligible:number;mature:number;responses:number;nonresponse:number;immature:number;immatureResponses:number;declined:number;withdrawn:number;deliverySuppressed:number;deliveryFailed:number;rate:number|null;outcomes:Record<string,number>;effort:Record<string,number>;definition:{effortLabels:string[];effortDirection:string}}[]};
    enabled: boolean;
    definitionVersion: number;
    authorizedTickets: number;
    window: {
        from: string;
        to: string;
        asOf: string;
    };
    firstResponse: Distribution;
    resolution: Distribution & {
        uniqueTickets: number;
        openingCohort: {
            population: number;
            censored: number;
        };
    };
    age: Distribution;
    cycleAge: Distribution;
    wait: Distribution;
    waiting: number;
    reopening: {
        hours: number | null;
        numerator: number;
        denominator: number;
        immature: number;
        unknown: number;
        rate: number | null;
    };
    flow: {
        wip: number;
        unknown: number;
        throughput: number;
        uniqueTickets: number;
        cycleTime: Distribution;
    };
    quality: {
        legacy: number;
        corrections: number;
        unknownNature: number;
    };
    watermark: number;
    eventCount: number;
    aggregation: {
        matched: number;
        pending: number;
        builtAt: string | null;
        lagMs: number | null;
    };
};
const duration = (ms: number | null) => ms == null ? 'Indisponível' : `${(ms / 3600000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
function MetricsContent({ organizationId, canManage, structurePending = false, stagePending = false }: {
    organizationId: number | string;
    canManage: boolean;
    structurePending?: boolean;
    stagePending?: boolean;
}) {
    // Keep confirmed availability while same-context payloads refresh or recover.
    const [available, setAvailable] = useState(false);
    const [data, setData] = useState<Metrics | null>(null), [error, setError] = useState<ReturnType<typeof toTicketApiError> | null>(null), [busy, setBusy] = useState(false);
    const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)), [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [horizon, setHorizon] = useState(''), [reason, setReason] = useState(''), [approved, setApproved] = useState(false), [pending, setPending] = useState<Record<string, unknown> | null>(null);
    const generation = useRef(0), mounted = useRef(true), endpoint = `/api/organizations/${organizationId}/tickets/metrics`;
    async function load(window?: Metrics['window']) { const g = ++generation.current; setBusy(true); setData(null); setError(null); try {
        const w = window || { from: new Date(from + 'T00:00:00Z').toISOString(), to: new Date(to + 'T00:00:00Z').toISOString(), asOf: new Date().toISOString() };
        const result = await requestJson<Metrics>(`${endpoint}?${new URLSearchParams(w)}`);
        if (mounted.current && g === generation.current) {
            setData(result);
            setAvailable(result.enabled === true);
        }
    }
    catch (e) {
        if (mounted.current && g === generation.current) {
            const failure = toTicketApiError(e);
            setError(failure);
            if (isRegionAccessDenied(failure)) { setAvailable(false); setPending(null); }
        }
    }
    finally {
        if (mounted.current && g === generation.current)
            setBusy(false);
    } }
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current++; }; }, [organizationId]);
    async function mutate(body: Record<string, unknown>) { const g = ++generation.current; setBusy(true); setError(null); setPending(body); const window = data?.window; setData(null); try {
        await requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!mounted.current || g !== generation.current)
            return;
        setPending(null);
        setApproved(false);
        await load(window);
    }
    catch (e) {
        if (mounted.current && g === generation.current) {
            const failure = toTicketApiError(e);
            setError(failure);
            if (isRegionAccessDenied(failure)) setAvailable(false);
            if (failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status))
                setPending(null);
        }
    }
    finally {
        if (mounted.current && g === generation.current)
            setBusy(false);
    } }
    const rememberRefreshFocus = useManualRefreshFocus(busy);
    const presentation = useTicketOptionalPresentation({ structurePending, stagePending, error });
    if (!available) return <TicketOptionalPanelState
        title="Métricas do atendimento"
        error={data?.enabled === false ? null : error}
        onRetry={() => void (pending && !isRegionAccessDenied(error) ? mutate(pending) : load())}
        onRefresh={pending && !isRegionAccessDenied(error) ? () => void load() : undefined}
    />;
    return <details className="ticket-metrics-panel"><summary><StaticLoadingText pending={presentation.structurePending}>Métricas do atendimento</StaticLoadingText></summary><section aria-label="Métricas do atendimento" aria-busy={busy} data-ticket-optional-body="" hidden={presentation.stagePending}>
 <p>Somente chamados autorizados. Datas em UTC, início incluído e fim excluído. Indicadores independentes dos filtros da lista.</p>
 <div className="ticket-metrics-controls"><label>Início (UTC)<input type="date" value={from} onChange={e => setFrom(e.target.value)} disabled={busy || !!pending}/></label><label>Fim exclusivo (UTC)<input type="date" value={to} onChange={e => setTo(e.target.value)} disabled={busy || !!pending}/></label><button disabled={busy || !!pending || !from || !to || from >= to} onClick={event => { rememberRefreshFocus(event.currentTarget); void load(); }}>Consultar métricas</button></div>
 {busy ? <p role="status">Calculando indicadores…</p> : null}
 {error ? <TicketErrorNotice error={error} onRetry={() => void (pending ? mutate(pending) : load())}/> : null}
 {pending && !busy ? <button onClick={() => void mutate(pending)}>Verificar tentativa anterior</button> : null}
 {data?.enabled ? <><p>Referência: {data.window.asOf} · {data.authorizedTickets} chamados acessíveis · Dicionário 1 / configuração {data.definitionVersion}</p>
 <div className="ticket-metrics-table"><table><caption>Durações brutas observadas, em horas; não medem esforço humano</caption><thead><tr><th scope="col">Indicador e população</th><th scope="col">População</th><th scope="col">Observados</th><th scope="col">Sem dado</th><th scope="col">Censurados</th><th scope="col">Cobertura</th><th scope="col">p50</th><th scope="col">p90</th><th scope="col">p95</th></tr></thead><tbody>
 {([['Primeira resposta · abertos no período', data.firstResponse], ['Resolução · ciclos encerrados no período', data.resolution], ['Idade · backlog na referência', data.age], ['Idade do ciclo ativo', data.cycleAge], ['Espera · interseção com o período', data.wait], ['Cycle time · ciclos encerrados', data.flow.cycleTime]] as [
            string,
            Distribution
        ][]).map(([label, d]) => <tr key={label}><th scope="row">{label}</th><td>{d.population}</td><td>{d.observed}</td><td>{d.unknown}</td><td>{d.censored}</td><td>{d.coverage == null ? 'Indisponível' : `${(d.coverage * 100).toFixed(1)}%`}</td><td>{duration(d.p50)}</td><td>{duration(d.p90)}</td><td>{duration(d.p95)}</td></tr>)}
 </tbody></table></div>
 <p>Da coorte de abertura: {data.resolution.openingCohort.censored} ainda abertos de {data.resolution.openingCohort.population}. Espera atual: {data.waiting}. WIP com início de trabalho observado: {data.flow.wip}; sem histórico suficiente: {data.flow.unknown}. Entregas: {data.flow.throughput} ciclos / {data.flow.uniqueTickets} chamados distintos.</p>
 <p>Reabertura: {data.reopening.rate == null ? 'Taxa indisponível' : `${(data.reopening.rate * 100).toFixed(1)}%`} · {data.reopening.numerator}/{data.reopening.denominator} ciclos maduros · {data.reopening.immature} imaturos · {data.reopening.unknown} sem configuração ou histórico · janela {data.reopening.hours == null ? 'não aprovada' : `${data.reopening.hours} h`}.</p>
 <p>Qualidade: {data.quality.legacy} legados; {data.quality.corrections} históricos com correção pendente de revisão; {data.quality.unknownNature} sem natureza. Resposta sem atendente elegível confirmado não vira zero. Horas úteis dependem da cobertura da política SLA e estão disponíveis no detalhe do chamado.</p>
 {data.feedback?.enabled?<section aria-label="Resultado e esforço"><h4>Resultado e esforço por instrumento</h4><p>Coorte de ciclos encerrados no período. Taxa = respostas válidas / convites com prazo encerrado. Ausência e recusa não são positivas. Esforço é uma escala ordinal, não horas de SLA. Entrega mostra o estado atual.</p>{data.feedback.groups?.length===0?<p>Sem convites na coorte.</p>:null}{data.feedback.groups?.map(g=><article key={g.version}><h5>Instrumento {g.version}</h5><p>{g.responses} respostas / {g.mature} convites maduros · {g.rate===null?'Sem dado':`${(g.rate*100).toFixed(1)}%`} · {g.nonresponse} sem resposta válida · {g.immatureResponses} respostas em {g.immature} convites imaturos · {g.declined} recusas · {g.withdrawn} retiradas · {g.deliverySuppressed} entregas suprimidas · {g.deliveryFailed} falhas de entrega incluídas no denominador.</p><p>Resultado: {Object.entries(g.outcomes).map(([k,v])=>`${k}: ${v}`).join('; ')||'Sem dado'}</p><p>Esforço ({g.definition.effortDirection==='ascending'?'crescente':'decrescente'}): {Object.entries(g.effort).map(([k,v])=>`${g.definition.effortLabels[Number(k)]}: ${v}`).join('; ')||'Sem dado'}</p></article>)}</section>:null}
 <p>Watermark autorizado: {data.watermark} · {data.eventCount} eventos públicos. Agregados reconciliados: {data.aggregation.matched}; a reconstruir: {data.aggregation.pending}. Última reconstrução: {data.aggregation.builtAt || 'Ainda não executada'}; atraso: {duration(data.aggregation.lagMs)}.</p>
 {canManage ? <><button disabled={busy} onClick={() => void mutate({ action: 'replay', ...data.window, definitionVersion: data.definitionVersion })}>Reconstruir agregados autorizados</button><details><summary>Configurar janela de reabertura</summary><p>A nova versão não altera versões anteriores. Informe a janela aprovada pela operação.</p><label>Janela aprovada (horas)<input type="number" min="1" max="8760" value={horizon} onChange={e => setHorizon(e.target.value)}/></label><label>Justificativa<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><label><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)}/>Parâmetro aprovado pela operação</label><button disabled={busy || !approved || !Number.isInteger(Number(horizon)) || Number(horizon) < 1 || Number(horizon) > 8760 || reason.trim().length < 10} onClick={() => void mutate({ action: 'define', expectedVersion: data.definitionVersion, reopenHours: Number(horizon), reason, approved: true, requestId: crypto.randomUUID() })}>Publicar configuração</button></details></> : null}
 </> : null}
 </section></details>;
}
export default function TicketMetricsPanel(props: {
    organizationId: number | string;
    canManage: boolean;
    structurePending?: boolean;
    stagePending?: boolean;
}) { return <MetricsContent key={props.organizationId} {...props}/>; }
