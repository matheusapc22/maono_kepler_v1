import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../../lib/api-transport';
import TicketErrorNotice from './TicketErrorNotice';
import { toTicketApiError } from './tickets-api';
import './ticket-sla.css';
type Clock = {
    status: string;
    elapsedMs: number | null;
    pausedMs: number | null;
    consumed: number | null;
};
type Cycle = {
    cycle: number;
    status: string;
    closedAt?: string;
    uncoveredPrefix?: boolean;
    coverageFrom?: string;
    clocks?: {
        response: Clock;
        resolution: Clock;
    };
    segments: {
        version: number;
        name: string;
        timeZone: string;
        from: string;
        to: string;
        responseMinutes: number | null;
        resolutionMinutes: number | null;
    }[];
};
type Projection = {
    enabled: boolean;
    status?: string;
    asOf?: string;
    firstResponse?: {
        at: string;
    } | null;
    currentCycle: number;
    assignmentVersion: number;
    cycles: Cycle[];
};
type Policy = {
    version: number;
    name: string;
    responseMinutes: number | null;
    resolutionMinutes: number | null;
    calendar: {
        timeZone: string;
        from: string;
        through: string;
    };
};
const labels: Record<string, string> = { awaiting_response: 'Sem primeira resposta', running: 'Em andamento', completed: 'Concluído', breached: 'Prazo excedido', no_sla: 'Sem SLA', unknown: 'Cálculo indisponível' };
const duration = (ms: number | null) => ms === null ? 'Indisponível' : `${Math.round(ms / 60000)} min úteis`;
const date = (s: string) => new Date(s).toLocaleString('pt-BR');
export function TicketSlaPanel({ organizationId, ticketId, canManage, revision }: {
    organizationId: number | string;
    ticketId: number | string;
    canManage: boolean;
    revision?: number;
}) {
    const [data, setData] = useState<Projection | null>(null), [policies, setPolicies] = useState<Policy[]>([]), [people, setPeople] = useState<{
        id: number;
        name?: string;
        email: string;
    }[]>([]), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [selected, setSelected] = useState(''), [reason, setReason] = useState('');
    const [name, setName] = useState(''), [response, setResponse] = useState(''), [resolution, setResolution] = useState(''), [zone, setZone] = useState(''), [from, setFrom] = useState(''), [through, setThrough] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [days, setDays] = useState<number[]>([]), [holidays, setHolidays] = useState(''), [pauses, setPauses] = useState(''), [responders, setResponders] = useState<number[]>([]), [approved, setApproved] = useState(false), [policyReason, setPolicyReason] = useState('');
    const generation = useRef(0), mounted = useRef(true), pending = useRef<{
        body: string;
        requestId: string;
    } | null>(null);
    const base = `/api/organizations/${organizationId}/tickets`, url = `${base}/${ticketId}/sla`;
    const load = useCallback(async () => {
        const own = ++generation.current;
        try {
            const next = await requestJson<Projection>(url);
            if (own !== generation.current)
                return;
            setData(next);
            setError(null);
            if (next.enabled && canManage) {
                const [p, u] = await Promise.allSettled([requestJson<{
                        policies: Policy[];
                    }>(`${base}/sla-policies`), requestJson<{
                        users: {
                            id: number;
                            name?: string;
                            email: string;
                        }[];
                    }>(`/api/organizations/${organizationId}/users`)]);
                if (own !== generation.current)
                    return;
                if (p.status === 'fulfilled')
                    setPolicies(p.value.policies);
                else {
                    setPolicies([]);
                    setError(p.reason);
                }
                setPeople(u.status === 'fulfilled' ? u.value.users : []);
            }
        }
        catch (e) {
            if (own === generation.current) {
                setData(null);
                setPolicies([]);
                setPeople([]);
                setError(e);
            }
        }
    }, [url, base, canManage, organizationId]);
    useEffect(() => { mounted.current = true; void load(); const focus = () => void load(); window.addEventListener('focus', focus); return () => { mounted.current = false; generation.current++; window.removeEventListener('focus', focus); }; }, [load, revision]);
    async function command(target: string, input: Record<string, unknown>) { setBusy(true); setError(null); const body = JSON.stringify({ target, ...input }); if (pending.current?.body !== body)
        pending.current = { body, requestId: crypto.randomUUID() }; try {
        await requestJson(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, requestId: pending.current.requestId }) });
        pending.current = null;
        if (mounted.current)
            await load();
    }
    catch (e) {
        if (mounted.current) {
            setError(e);
            setData(null);
            const status = toTicketApiError(e).status;
            if (status && status < 500)
                pending.current = null;
        }
    }
    finally {
        if (mounted.current)
            setBusy(false);
    } }
    function retry() { if (!pending.current)
        return; const { target, ...input } = JSON.parse(pending.current.body); void command(target, input); }
    function publish() { const minutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; }; const exceptions = Object.fromEntries(holidays.split(/\s+/).filter(Boolean).map(d => [d, []])); void command(`${base}/sla-policies`, { expectedVersion: policies[0]?.version || 0, approved, reason: policyReason, policy: { name, responseMinutes: response ? Number(response) : null, resolutionMinutes: resolution ? Number(resolution) : null, responders, pauseReasons: pauses.split('\n').map(s => s.trim()).filter(Boolean), calendar: { timeZone: zone, from, through, weekly: Array.from({ length: 7 }, (_, i) => days.includes(i) ? [[minutes(start), minutes(end)]] : []), exceptions } } }); }
    if (!data?.enabled)
        return error ? <div><TicketErrorNotice error={toTicketApiError(error)}/><button type="button" disabled={busy} onClick={() => void load()}>Atualizar SLA</button>{pending.current ? <button type="button" disabled={busy} onClick={retry}>Verificar tentativa anterior</button> : null}</div> : null;
    const current = data.cycles.find(c => c.cycle === data.currentCycle);
    return <section className="ticket-sla ticket-history" aria-label="Prazos de atendimento"><h4>Prazos de atendimento</h4><p>Metas em minutos úteis, conforme a política atribuída ao chamado. Publicar uma versão não altera chamados existentes.</p>
 {error ? <TicketErrorNotice error={toTicketApiError(error)}/> : null}<button type="button" disabled={busy} onClick={() => void load()}>Atualizar SLA</button>
 {pending.current ? <p role="status">Há uma tentativa sem confirmação. <button type="button" disabled={busy} onClick={retry}>Verificar tentativa anterior</button></p> : null}
 {data.asOf ? <p>Calculado em {date(data.asOf)}. Atualize para consultar o tempo atual.</p> : null}
 {data.status === 'unknown' ? <p role="status">Histórico corrigido: o SLA aguarda revisão.</p> : null}
 {data.firstResponse ? <p>Primeira resposta humana elegível: {date(data.firstResponse.at)}</p> : null}
 {data.cycles.map(c => <article key={c.cycle}><h5>Ciclo {c.cycle}</h5>{c.status === 'no_sla' ? <p>Sem SLA: nenhuma política atribuída a este ciclo.</p> : null}
 {c.uncoveredPrefix ? <p>Histórico anterior a {date(c.coverageFrom!)} sem cobertura contratual. Os valores abaixo cobrem somente os períodos atribuídos.</p> : null}
 {c.clocks ? (['response', 'resolution'] as const).map(k => <p key={k}><strong>{k === 'response' ? 'Primeira resposta (acumulada)' : 'Resolução do ciclo'}: {labels[c.clocks![k].status]}</strong> · {duration(c.clocks![k].elapsedMs)} · Pausas: {duration(c.clocks![k].pausedMs)}{c.clocks![k].consumed !== null ? ` · ${Math.round(c.clocks![k].consumed! * 100)}% da meta` : ''}</p>) : null}
 <details><summary>Políticas e períodos</summary>{c.segments.map((s, i) => <p key={i}>{s.name} · versão {s.version} · {s.timeZone}<br />{date(s.from)} até {date(s.to)} · Resposta: {s.responseMinutes ?? 'sem meta'} min · Resolução: {s.resolutionMinutes ?? 'sem meta'} min</p>)}</details></article>)}
 {canManage && !pending.current && data.status !== 'unknown' ? <details><summary>Gerenciar política de SLA</summary><p>A atribuição vale a partir de agora. Ao trocar a política, o consumo já acumulado é preservado; o novo prazo vale para o próximo período. Reaberturas precisam de atribuição própria.</p>
 <label>Política<MaonoSelect value={selected} onChange={e => setSelected(e.target.value)}><option value="">Selecione</option>{policies.map(p => <option key={p.version} value={p.version}>{p.name} · v{p.version} · {p.calendar.timeZone}</option>)}</MaonoSelect></label>
 <label>Justificativa da atribuição<textarea minLength={10} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label>
 <button type="button" disabled={busy || !selected || reason.trim().length < 10 || !current || !!current.closedAt} onClick={() => void command(url, { expectedVersion: data.assignmentVersion, cycle: data.currentCycle, policyVersion: Number(selected), reason })}>Atribuir política ao ciclo atual</button>
 <details><summary>Publicar nova política</summary><p>Preencha somente condições aprovadas pela operação. Não há metas ou calendário predefinidos. Esta tela cadastra um expediente por dia; feriados ficam sem expediente.</p>
 <form onSubmit={e => { e.preventDefault(); publish(); }}><fieldset disabled={busy}><label>Nome<input required minLength={3} maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label><label>Primeira resposta (minutos úteis; vazio = sem meta)<input type="number" min={1} max={525600} value={response} onChange={e => setResponse(e.target.value)}/></label><label>Resolução (minutos úteis; vazio = sem meta)<input type="number" min={1} max={525600} value={resolution} onChange={e => setResolution(e.target.value)}/></label><label>Fuso horário IANA<input required placeholder="Ex.: America/Sao_Paulo" value={zone} onChange={e => setZone(e.target.value)}/></label><label>Início da cobertura<input required type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label>Último dia da cobertura (até 366 dias)<input required type="date" value={through} onChange={e => setThrough(e.target.value)}/></label>
 <fieldset><legend>Dias de atendimento</legend>{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, i) => <label className="ticket-sla-check" key={d}><input type="checkbox" checked={days.includes(i)} onChange={e => setDays(e.target.checked ? [...days, i] : days.filter(x => x !== i))}/>{d}</label>)}</fieldset><label>Início do expediente<input required type="time" value={start} onChange={e => setStart(e.target.value)}/></label><label>Fim do expediente (no mesmo dia)<input required type="time" value={end} onChange={e => setEnd(e.target.value)}/></label><label>Feriados (uma data AAAA-MM-DD por linha)<textarea value={holidays} onChange={e => setHolidays(e.target.value)}/></label><label>Motivos que pausam o SLA (um por linha; correspondência exata)<textarea value={pauses} onChange={e => setPauses(e.target.value)}/></label>
 <fieldset><legend>Atendentes humanos elegíveis</legend>{people.length ? people.map(p => <label className="ticket-sla-check" key={p.id}><input type="checkbox" checked={responders.includes(p.id)} onChange={e => setResponders(e.target.checked ? [...responders, p.id] : responders.filter(x => x !== p.id))}/>{p.name || p.email}</label>) : <p>É necessário acesso à lista de usuários para escolher os atendentes.</p>}</fieldset><label>Justificativa da publicação<textarea required minLength={10} maxLength={1000} value={policyReason} onChange={e => setPolicyReason(e.target.value)}/></label><label className="ticket-sla-check"><input required type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)}/>Confirmo que metas, calendário, pausas e atendentes foram aprovados pela operação.</label><button type="submit" disabled={!approved || !responders.length || !days.length}>Publicar versão {1 + (policies[0]?.version || 0)}</button></fieldset></form></details></details> : null}</section>;
}
