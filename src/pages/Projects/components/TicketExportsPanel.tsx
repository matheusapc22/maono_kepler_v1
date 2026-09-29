import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "../../../lib/api-transport";
import { toTicketApiError } from "./tickets-api";
import TicketErrorNotice from "./TicketErrorNotice";
import "./ticket-exports.css";

type Job = {
  id: string;
  state: string;
  createdAt: string;
  expiresAt: string;
  capturedRows: number;
  expectedRows: number;
  errorCode: string | null;
  report: string;
  bytes: number | null;
};
type List = { enabled: boolean; jobs: Job[]; nextCursor: string | null };
type Props = {
  organizationId: string | number;
  canCreate: boolean;
  canDownload: boolean;
};
const states: Record<string, string> = {
  queued: "Na fila",
  capturing: "Capturando dados",
  running: "Gerando arquivo",
  ready: "Disponível",
  failed: "Falhou",
  cancelled: "Cancelada",
  expired: "Expirada",
  revoked: "Acesso revogado",
};
const active = (job: Job) =>
  ["queued", "capturing", "running"].includes(job.state);

function Content({ organizationId, canCreate, canDownload }: Props) {
  const [data, setData] = useState<List | null>(null),
    [error, setError] = useState<ReturnType<typeof toTicketApiError> | null>(
      null,
    );
  const [busy, setBusy] = useState(false),
    [from, setFrom] = useState(() =>
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState("all"),
    [domain, setDomain] = useState(""),
    [nature, setNature] = useState("");
  const [pending, setPending] = useState<{
    url: string;
    body: Record<string, unknown>;
  } | null>(null);
  const mounted = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const endpoint = `/api/organizations/${organizationId}/tickets/exports`;
  const load = useCallback(
    async (before?: string) => {
      const g = ++generation.current;
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      try {
        const result = await requestJson<List>(
          endpoint + (before ? "?before=" + encodeURIComponent(before) : ""),
          { signal: c.signal },
        );
        if (mounted.current && g === generation.current) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (mounted.current && g === generation.current && !c.signal.aborted) {
          setData(null);
          setError(toTicketApiError(e));
        }
      }
    },
    [endpoint],
  );
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (!data?.jobs.some(active) || busy) return;
    const timer = window.setTimeout(() => void load(), 5000);
    return () => window.clearTimeout(timer);
  }, [data, busy, load]);
  async function mutate(url: string, body: Record<string, unknown>) {
    generation.current++;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError(null);
    setPending({ url, body });
    try {
      await requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: c.signal,
      });
      if (mounted.current) {
        setPending(null);
        await load();
      }
    } catch (e) {
      if (mounted.current && !c.signal.aborted) {
        setData(null);
        setError(toTicketApiError(e));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function manifest(job: Job) {
    setBusy(true);
    setError(null);
    const c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    try {
      const response = await requestJson<{ manifest: unknown }>(
        `${endpoint}/${job.id}`,
        { signal: c.signal },
      );
      if (!mounted.current || c.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(response.manifest, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `manifesto-${job.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (mounted.current && !c.signal.aborted) {
        setData(null);
        setError(toTicketApiError(e));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (data?.enabled === false) return null;
  return (
    <details className="ticket-exports">
      <summary>Relatórios e exportações</summary>
      <p>
        Relatórios completos dos chamados que você pode acessar. Datas em UTC; o
        fim do período é exclusivo. Incidentes e causas usam os vínculos autorizados atuais e exigem a funcionalidade ativa.
      </p>
      <p>
        CSV seguro: textos recebem o prefixo <code>text:</code>. O manifesto
        explica filtros, versões, totais e dados ausentes.
      </p>
      {error && <TicketErrorNotice error={error} />}
      {canCreate && canDownload && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(endpoint, {
              idempotencyKey: crypto.randomUUID(),
              from: from + "T00:00:00.000Z",
              to: to + "T00:00:00.000Z",
              asOf: new Date().toISOString(),
              report,
              domain: domain || null,
              nature: nature || null,
            });
          }}
        >
          <label>
            Início (UTC)
            <input
              type="date"
              value={from}
              required
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Fim exclusivo (UTC)
            <input
              type="date"
              value={to}
              required
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Relatório
            <select value={report} onChange={(e) => setReport(e.target.value)}>
              <option value="all">Visão completa</option>
              <option value="incidents">Chamados com incidentes</option>
              <option value="causes">Incidentes e causas por chamado</option>
              <option value="backlog">Backlog no instante de referência</option>
              <option value="cycles">Ciclos encerrados no período</option>
              <option value="sla">SLA e cobertura</option>
            </select>
          </label>
          <label>
            Domínio
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">Todos</option>
              {[
                ["map", "Mapa"],
                ["database", "Banco de dados"],
                ["permission", "Permissão"],
                ["export", "Exportação"],
                ["support", "Suporte"],
                ["other", "Outro"],
              ].map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Natureza
            <select value={nature} onChange={(e) => setNature(e.target.value)}>
              <option value="">Todas</option>
              {[
                ["question_request", "Dúvida/solicitação"],
                ["incident", "Incidente"],
                ["defect", "Defeito"],
                ["improvement_change", "Melhoria/mudança"],
                ["recurring_problem", "Problema recorrente"],
                ["unknown", "Não classificada"],
              ].map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !!pending}>
            Solicitar exportação
          </button>
        </form>
      )}
      {pending && (
        <button
          disabled={busy}
          onClick={() => void mutate(pending.url, pending.body)}
        >
          Verificar tentativa anterior
        </button>
      )}
      <button disabled={busy} onClick={() => void load()}>
        Atualizar exportações
      </button>
      <div aria-live="polite">
        {busy
          ? "Processando solicitação…"
          : data && !data.jobs.length
            ? "Nenhuma exportação disponível."
            : null}
      </div>
      <ul>
        {data?.jobs.map((job) => (
          <li key={job.id}>
            <strong>{states[job.state] || job.state}</strong> ·{" "}
            {new Date(job.createdAt).toLocaleString("pt-BR")}
            <span>
              {job.capturedRows} de {job.expectedRows} chamados capturados ·
              Expira em {new Date(job.expiresAt).toLocaleString("pt-BR")}
            </span>
            {job.state === "failed" && (
              <span>Não foi possível concluir. Solicite uma nova captura.</span>
            )}
            <div className="ticket-exports-actions">
              {job.state === "ready" && canDownload && (
                <a href={`${endpoint}/${job.id}/download`}>Baixar CSV</a>
              )}
              {job.state === "ready" && (
                <button disabled={busy} onClick={() => void manifest(job)}>
                  Baixar manifesto
                </button>
              )}
              {canCreate &&
                ["queued", "capturing", "running", "ready"].includes(
                  job.state,
                ) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(`${endpoint}/${job.id}/cancel`, {})
                    }
                  >
                    Cancelar exportação
                  </button>
                )}
              {canCreate && job.state === "failed" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(`${endpoint}/${job.id}/retry`, {
                      idempotencyKey: crypto.randomUUID(),
                    })
                  }
                >
                  Gerar novamente
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data?.nextCursor && (
        <button disabled={busy} onClick={() => void load(data.nextCursor!)}>
          Exportações anteriores
        </button>
      )}
    </details>
  );
}
export default function TicketExportsPanel(props: Props) {
  return <Content key={String(props.organizationId)} {...props} />;
}
