import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "../../../lib/api-transport";
import { toTicketApiError } from "./tickets-api";
import TicketErrorNotice from "./TicketErrorNotice";
import "./ticket-cases.css";
type Case = {
  id: string;
  kind: "incident" | "problem";
  title: string;
  state: string;
  visibility: string;
  version: string;
  coordinatorId: number;
  data: Record<string, string | null>;
};
type Target = { type: string; id: string | number };
type Detail = {
  record: Case;
  links: { id: string; target: Target; relation: string }[];
  history: { action: string; at: string; data: Record<string, unknown> }[];
  canManage: boolean;
};
type List = { enabled: boolean; items: Case[]; nextCursor: string | null };
type Props = { organizationId: string | number; canManage: boolean };
const labels: Record<string, string> = {
  open: "Aberto",
  mitigating: "Em mitigação",
  restored: "Restaurado",
  closed: "Encerrado",
  investigating: "Em investigação",
  action_defined: "Ação definida",
  resolved: "Resolvido",
  create: "Criação",
  update: "Revisão",
  transition: "Mudança de estado",
  audience: "Audiência",
  link: "Vínculo",
  unlink: "Remoção de vínculo",
  review_duplicate: "Revisão de duplicidade",
};
const paths: Record<string, string[]> = {
  "incident:open": ["mitigating", "restored"],
  "incident:mitigating": ["restored"],
  "incident:restored": ["closed", "open"],
  "incident:closed": ["open"],
  "problem:open": ["investigating"],
  "problem:investigating": ["action_defined", "resolved"],
  "problem:action_defined": ["resolved", "investigating"],
  "problem:resolved": ["investigating"],
};
const fieldLabels: Record<string, string> = {
  title: "Título",
  state: "Estado",
  visibility: "Visibilidade",
  impact: "Impacto",
  observedAt: "Início observado",
  mitigation: "Mitigação",
  restoration: "Restauração",
  nextUpdateAt: "Próxima atualização",
  causeStatus: "Situação da causa",
  cause: "Causa",
  causeEvidence: "Evidência",
  conclusion: "Conclusão",
  postMortem: "Post-mortem",
  actions: "Ações",
  reason: "Motivo",
  relation: "Relação",
};
const relationLabels: Record<string, string> = {
  related: "Relacionado",
  duplicate_candidate: "Possível duplicidade",
  duplicate_confirmed: "Duplicidade confirmada",
  duplicate_rejected: "Duplicidade rejeitada",
  implements: "Implementa",
  unknown: "Desconhecida",
  hypothesis: "Hipótese",
  confirmed: "Confirmada",
  private: "Privado",
  organization: "Organização",
  ticket: "Chamado",
  case: "Incidente/problema",
  change: "Mudança",
};
function HistoryData({ data }: { data: Record<string, unknown> }) {
  const content = {
    ...data,
    ...(data.data && typeof data.data === "object" ? data.data : {}),
  };
  return (
    <dl>
      {Object.entries(content)
        .filter(([k, v]) => k in fieldLabels && typeof v === "string" && v)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{fieldLabels[k]}</dt>
            <dd>
              {labels[String(v)] || relationLabels[String(v)] || String(v)}
            </dd>
          </div>
        ))}
      {data.target &&
      typeof data.target === "object" &&
      "type" in data.target &&
      "id" in data.target ? (
        <div>
          <dt>Alvo autorizado</dt>
          <dd>
            {relationLabels[String(data.target.type)]}: {String(data.target.id)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
function Content({ organizationId, canManage }: Props) {
  const endpoint = `/api/organizations/${organizationId}/ticket-cases`;
  const [list, setList] = useState<List | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState<ReturnType<typeof toTicketApiError> | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [title, setTitle] = useState(""),
    [newKind, setNewKind] = useState("incident"),
    [fields, setFields] = useState<Record<string, string | null>>({}),
    [nextState, setNextState] = useState(""),
    [reason, setReason] = useState("");
  const [targetType, setTargetType] = useState("ticket"),
    [targetId, setTargetId] = useState(""),
    [relation, setRelation] = useState("related"),
    [visibility, setVisibility] = useState("private"),
    [members, setMembers] = useState(""),
    [coordinator, setCoordinator] = useState("");
  const [message, setMessage] = useState(""),
    [messageTicket, setMessageTicket] = useState(""),
    [messageKind, setMessageKind] = useState("response");
  const [pending, setPending] = useState<{
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  } | null>(null);
  const mounted = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const run = useCallback(
    async <T,>(
      path: string,
      options: RequestInit = {},
      apply: (data: T) => void,
    ) => {
      const g = ++generation.current;
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      setBusy(true);
      setError(null);
      try {
        const data = await requestJson<T>(path, {
          ...options,
          signal: c.signal,
        });
        if (mounted.current && g === generation.current) apply(data);
      } catch (e) {
        if (mounted.current && g === generation.current && !c.signal.aborted) {
          setError(toTicketApiError(e));
          setDetail(null);
          setList(null);
        }
      } finally {
        if (mounted.current && g === generation.current) setBusy(false);
      }
    },
    [],
  );
  const load = useCallback(
    (after = "") =>
      run<List>(
        `${endpoint}?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(query)}&after=${encodeURIComponent(after)}`,
        {},
        setList,
      ),
    [endpoint, kind, query, run],
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
  const open = (caseId: string) =>
    run<Detail>(endpoint + "/" + encodeURIComponent(caseId), {}, (d) => {
      setDetail(d);
      setFields(d.record.data);
      setVisibility(d.record.visibility);
      setCoordinator(String(d.record.coordinatorId));
      setMembers("");
      setReason("");
      setNextState("");
    });
  async function mutate(
    action: string,
    extra: Record<string, unknown> = {},
    fresh = false,
  ) {
    const body = {
      action,
      idempotencyKey: crypto.randomUUID(),
      ...(!fresh && detail ? { version: detail.record.version } : {}),
      ...extra,
    };
    const url = fresh ? endpoint : endpoint + "/" + detail?.record.id;
    await send({ url, body, headers: { "Content-Type": "application/json" } });
  }
  async function send(p: {
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }) {
    setPending(p);
    await run<{ id?: string }>(
      p.url,
      { method: "POST", headers: p.headers, body: JSON.stringify(p.body) },
      (r) => {
        setPending(null);
        setTitle("");
        setMessage("");
        if (r.id) void open(r.id);
        else if (detail) void open(detail.record.id);
      },
    );
  }
  if (list?.enabled === false) return null;
  const writable = canManage && detail?.canManage;
  return (
    <details className="ticket-cases">
      <summary>Incidentes e problemas</summary>
      <p>
        Coordene a restauração e investigue causas. Cada chamado mantém sua
        própria validação.
      </p>
      {error && <TicketErrorNotice error={error} />}
      {pending && error && (
        <div role="group" aria-label="Recuperar tentativa">
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(pending)}
          >
            Repetir tentativa
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              void load();
            }}
          >
            Atualizar consulta
          </button>
        </div>
      )}
      <div className="ticket-cases-filters">
        <label>
          Buscar registro
          <input
            disabled={busy || !!pending}
            value={query}
            maxLength={100}
            onChange={(e) => {
              setDetail(null);
              setQuery(e.target.value);
            }}
          />
        </label>
        <label>
          Tipo
          <select
            disabled={busy || !!pending}
            value={kind}
            onChange={(e) => {
              setDetail(null);
              setKind(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="incident">Incidentes</option>
            <option value="problem">Problemas</option>
          </select>
        </label>
        <button disabled={busy} type="button" onClick={() => void load()}>
          Atualizar
        </button>
      </div>
      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate("create", { title, kind: newKind }, true);
          }}
        >
          <h4>Novo registro privado</h4>
          <label>
            Título
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Natureza
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
            >
              <option value="incident">Incidente</option>
              <option value="problem">Problema recorrente</option>
            </select>
          </label>
          <button disabled={busy || !!pending} type="submit">
            Criar registro
          </button>
        </form>
      )}
      {busy && <p role="status">Atualizando registros…</p>}
      <ul>
        {list?.items.map((r) => (
          <li key={r.id}>
            <button
              disabled={busy}
              type="button"
              onClick={() => void open(r.id)}
            >
              {r.title}
            </button>{" "}
            <span>
              {r.kind === "incident" ? "Incidente" : "Problema"} ·{" "}
              {labels[r.state] || r.state}
            </span>
          </li>
        ))}
      </ul>
      {list?.nextCursor && (
        <button
          disabled={busy}
          type="button"
          onClick={() => void load(list.nextCursor!)}
        >
          Próxima página
        </button>
      )}
      {detail && (
        <section aria-label="Detalhes do registro">
          <h3>{detail.record.title}</h3>
          <p>
            {labels[detail.record.state]} ·{" "}
            {detail.record.visibility === "private" ? "Privado" : "Organização"}
          </p>
          <p>ID: {detail.record.id}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(nextState ? "transition" : "update", {
                data: { ...fields, reason },
                coordinatorId: Number(coordinator),
                ...(nextState ? { state: nextState } : {}),
              });
            }}
          >
            <fieldset disabled={!writable || busy || !!pending}>
              <legend>Impacto, investigação e revisão</legend>
              {Object.entries({
                impact: "Impacto",
                observedAt: "Início observado (ISO UTC)",
                mitigation: "Mitigação",
                restoration: "Restauração verificada",
                nextUpdateAt: "Próxima atualização (ISO UTC)",
                cause: "Causa ou hipótese",
                causeEvidence: "Evidência da causa",
                conclusion: "Conclusão",
                postMortem: "Post-mortem",
                actions: "Ações e responsáveis",
              }).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <textarea
                    maxLength={key === "postMortem" ? 6000 : 2000}
                    value={fields[key] || ""}
                    onChange={(e) =>
                      setFields({ ...fields, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Situação da causa
                <select
                  value={fields.causeStatus || "unknown"}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      causeStatus: e.target.value,
                      ...(e.target.value === "unknown"
                        ? { cause: "", causeEvidence: "" }
                        : {}),
                    })
                  }
                >
                  <option value="unknown">Desconhecida</option>
                  <option value="hypothesis">Hipótese</option>
                  <option value="confirmed">Confirmada com evidência</option>
                </select>
              </label>
              <label>
                Coordenador (ID de usuário)
                <input
                  required
                  type="number"
                  min="1"
                  value={coordinator}
                  onChange={(e) => setCoordinator(e.target.value)}
                />
              </label>
              <label>
                Próximo estado
                <select
                  value={nextState}
                  onChange={(e) => setNextState(e.target.value)}
                >
                  <option value="">Manter estado</option>
                  {(
                    paths[detail.record.kind + ":" + detail.record.state] || []
                  ).map((s) => (
                    <option key={s} value={s}>
                      {labels[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Motivo da revisão/transição
                <textarea
                  required={!!nextState}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button type="submit">Salvar revisão</button>
            </fieldset>
          </form>
          {writable && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("audience", {
                    visibility,
                    members: members.trim()
                      ? members.split(",").map((x) => Number(x.trim()))
                      : [],
                  });
                }}
              >
                <h4>Audiência do registro</h4>
                <p>
                  Alterar a audiência compartilha o conteúdo e o histórico deste
                  registro. Não concede acesso aos vínculos.
                </p>
                <label>
                  Visibilidade
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                  >
                    <option value="private">Privado</option>
                    <option value="organization">Organização</option>
                  </select>
                </label>
                <label>
                  Substituir membros adicionais (IDs separados por vírgula)
                  <input
                    value={members}
                    onChange={(e) => setMembers(e.target.value)}
                  />
                </label>
                <button disabled={busy || !!pending}>
                  Confirmar audiência
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("link", {
                    target: {
                      type: targetType,
                      id: targetType === "ticket" ? Number(targetId) : targetId,
                    },
                    relation,
                  });
                }}
              >
                <h4>Adicionar relação</h4>
                <label>
                  Alvo
                  <select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value)}
                  >
                    <option value="ticket">Chamado</option>
                    <option value="case">Incidente/problema</option>
                    <option value="change">Registro de mudança (CR)</option>
                  </select>
                </label>
                <label>
                  ID do alvo
                  <input
                    required
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  />
                </label>
                <label>
                  Relação
                  <select
                    value={relation}
                    onChange={(e) => setRelation(e.target.value)}
                  >
                    <option value="related">Relacionado</option>
                    <option value="duplicate_candidate">
                      Possível duplicidade
                    </option>
                    <option value="implements">Implementa</option>
                  </select>
                </label>
                <button disabled={busy || !!pending}>Vincular</button>
              </form>
            </>
          )}
          <h4>Relações autorizadas</h4>
          <ul>
            {detail.links.map((l) => (
              <li key={l.id}>
                {relationLabels[l.target.type]}: {l.target.id} ·{" "}
                {relationLabels[l.relation]}{" "}
                {writable && (
                  <>
                    <button
                      disabled={busy || !!pending}
                      type="button"
                      onClick={() =>
                        void mutate("unlink", { target: l.target })
                      }
                    >
                      Desvincular
                    </button>
                    {l.relation === "duplicate_candidate" && (
                      <>
                        <button
                          disabled={busy || !reason || !!pending}
                          onClick={() =>
                            void mutate("review_duplicate", {
                              target: l.target,
                              relation: "duplicate_confirmed",
                              data: { reason },
                            })
                          }
                        >
                          Confirmar duplicidade
                        </button>
                        <button
                          disabled={busy || !reason || !!pending}
                          onClick={() =>
                            void mutate("review_duplicate", {
                              target: l.target,
                              relation: "duplicate_rejected",
                              data: { reason },
                            })
                          }
                        >
                          Rejeitar duplicidade
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {writable && detail.links.some((l) => l.target.type === "ticket") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send({
                  url: endpoint + "/" + detail.record.id + "/communicate",
                  body: {
                    ticketId: Number(messageTicket),
                    version: detail.record.version,
                    kind: messageKind,
                    body: message,
                  },
                  headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": crypto.randomUUID(),
                  },
                });
              }}
            >
              <h4>Comunicar ao chamado</h4>
              <p>
                Revise o texto para a audiência escolhida. Nenhum conteúdo do
                registro é copiado automaticamente.
              </p>
              <label>
                Chamado
                <select
                  required
                  value={messageTicket}
                  onChange={(e) => setMessageTicket(e.target.value)}
                >
                  <option value="">Selecionar</option>
                  {detail.links
                    .filter((l) => l.target.type === "ticket")
                    .map((l) => (
                      <option key={l.id} value={l.target.id}>
                        {l.target.id}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Audiência da mensagem
                <select
                  value={messageKind}
                  onChange={(e) => setMessageKind(e.target.value)}
                >
                  <option value="response">Resposta ao chamado</option>
                  <option value="internal">Nota interna</option>
                </select>
              </label>
              <label>
                Mensagem revisada
                <textarea
                  required
                  maxLength={6000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <button disabled={busy || !!pending}>Enviar mensagem</button>
            </form>
          )}
          <details>
            <summary>Histórico de revisões</summary>
            <ol>
              {detail.history.map((e, i) => (
                <li key={i}>
                  <strong>{labels[e.action] || e.action}</strong> ·{" "}
                  {new Date(e.at).toLocaleString()}
                  <HistoryData data={e.data} />
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
    </details>
  );
}
export default function TicketCasesPanel(props: Props) {
  return <Content key={String(props.organizationId)} {...props} />;
}
