import { useEffect, useRef, useState } from "react";
import { requestJson } from "../../../lib/api-transport";
import { toTicketApiError } from "./tickets-api";
import TicketErrorNotice from "./TicketErrorNotice";
import "./ticket-feedback.css";
type Definition = {
  resultQuestion: string;
  effortQuestion: string;
  consentText: string;
  windowHours: number;
  outcomes: string[];
  effortLabels: string[];
  effortDirection: string;
};
type Invite = {
  id: string;
  ticketId: number;
  cycle: number;
  version: number;
  until: string;
  definition: Definition;
  receipt: string | null;
  state: string;
};
type List = { enabled: boolean; items: Invite[]; nextCursor: string | null };
function Answer({
  item,
  busy,
  onSubmit,
  onOpen,
}: {
  item: Invite;
  busy: boolean;
  onSubmit: (id: string, body: Record<string, unknown>) => void;
  onOpen: (id: number) => void;
}) {
  const [outcome, setOutcome] = useState(""),
    [effort, setEffort] = useState(""),
    [comment, setComment] = useState(""),
    [consent, setConsent] = useState(false);
  return (
    <article className="ticket-feedback-card">
      <h4>
        Chamado {item.ticketId} · ciclo {item.cycle}
      </h4>
      <p>
        Instrumento {item.version} · até{" "}
        {new Date(item.until).toLocaleString("pt-BR")}
      </p>
      <button onClick={() => onOpen(item.ticketId)}>
        Abrir chamado para conversar ou solicitar reabertura
      </button>
      <p>
        A resposta é voluntária e não altera o estado do chamado. A reabertura
        usa a ação própria do chamado.
      </p>
      {item.state === "open" ? (
        <fieldset disabled={busy}>
          <legend>Sua avaliação</legend>
          <label>
            {item.definition.resultQuestion}
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="">Selecione</option>
              {item.definition.outcomes.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            {item.definition.effortQuestion}
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>
              <option value="">Selecione</option>
              {item.definition.effortLabels.map((o, i) => (
                <option key={i} value={i}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label>
            Comentário opcional — somente você, sem envio à conversa
            <textarea
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <p>{item.definition.consentText}</p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Concordo com o uso descrito. Resultado e esforço integram métricas
            restritas à gestão com acesso ao chamado.
          </label>
          <button
            disabled={!consent || !outcome || effort === ""}
            onClick={() =>
              onSubmit(item.id, {
                outcome,
                effort: Number(effort),
                comment,
                consent: true,
              })
            }
          >
            Enviar avaliação
          </button>
          <button onClick={() => onSubmit(item.id, { declined: true })}>
            Prefiro não responder
          </button>
        </fieldset>
      ) : (
        <p role="status">
          {item.state === "responded"
            ? "Avaliação registrada"
            : item.state === "declined"
              ? "Recusa registrada"
              : item.state === "withdrawn"
                ? "Consentimento retirado"
                : "Prazo encerrado"}
          {item.receipt ? ` · recibo ${item.receipt}` : ""}
        </p>
      )}
      {item.state === "responded" ? (
        <>
          <p>
            A retirada interrompe o uso da avaliação nas métricas atuais. O
            registro permanece no histórico até a retenção definida pela
            operação; não libera uma segunda resposta.
          </p>
          <button
            disabled={busy}
            onClick={() => onSubmit(item.id, { action: "withdraw" })}
          >
            Retirar consentimento
          </button>
        </>
      ) : null}
    </article>
  );
}
export default function TicketFeedbackPanel({
  organizationId,
  canManage,
  onOpen,
}: {
  organizationId: string | number;
  canManage: boolean;
  onOpen: (id: number) => void;
}) {
  const [data, setData] = useState<List | null>(null),
    [error, setError] = useState<ReturnType<typeof toTicketApiError> | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [version, setVersion] = useState(0),
    [resultQuestion, setResultQuestion] = useState(""),
    [effortQuestion, setEffortQuestion] = useState(""),
    [outcomes, setOutcomes] = useState(""),
    [labels, setLabels] = useState(""),
    [hours, setHours] = useState(""),
    [direction, setDirection] = useState(""),
    [consentText, setConsentText] = useState(""),
    [approved, setApproved] = useState(false),
    [cursor, setCursor] = useState<number | null>(0);
  const generation = useRef(0),
    mounted = useRef(true),
    busyRef = useRef(false),
    pending = useRef<{ path: string; body: Record<string, unknown> } | null>(
      null,
    ),
    [uncertain, setUncertain] = useState(false);
  const endpoint = `/api/organizations/${organizationId}/ticket-feedback`;
  async function load(after = "") {
    const g = ++generation.current;
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const value = await requestJson<List>(
        `${endpoint}?${new URLSearchParams({ after })}`,
      );
      let v = 0;
      if (value.enabled && canManage) {
        const d = await requestJson<{ version: number }>(
          endpoint + "/instrument",
        );
        v = d.version;
      }
      if (mounted.current && g === generation.current) {
        setData(value);
        setVersion(v);
      }
    } catch (e) {
      if (mounted.current && g === generation.current)
        setError(toTicketApiError(e));
    } finally {
      if (mounted.current && g === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [organizationId, canManage]);
  async function mutate(path: string, body: Record<string, unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const g = ++generation.current;
    setBusy(true);
    setError(null);
    setStatus("");
    pending.current = { path, body };
    setUncertain(true);
    try {
      const r = await requestJson<{
        issued?: number;
        excluded?: number;
        nextCursor?: number | null;
        receipt?: string;
      }>(endpoint + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!mounted.current || g !== generation.current) return;
      pending.current = null;
      setUncertain(false);
      if (path === "/reconcile") {
        setCursor(r.nextCursor ?? null);
        setStatus(
          `${r.issued} convites emitidos; ${r.excluded} ciclos sem elegibilidade ou acesso nesta página.`,
        );
      } else {
        setStatus(
          r.receipt
            ? `Resposta registrada · recibo ${r.receipt}`
            : "Instrumento publicado.",
        );
        setApproved(false);
      }
      await load();
    } catch (e) {
      if (mounted.current && g === generation.current) {
        const failure = toTicketApiError(e);
        setError(failure);
        if (
          failure.status >= 400 &&
          failure.status < 500 &&
          ![408, 429].includes(failure.status)
        ) {
          pending.current = null;
          setUncertain(false);
          setData(null);
        }
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (data?.enabled === false) return null;
  return (
    <details className="ticket-feedback-panel">
      <summary>Resultado, esforço e feedback</summary>
      <section aria-label="Pesquisas de atendimento" aria-busy={busy}>
        <p>
          Pesquisas opcionais por ciclo encerrado. Não responder não conta como
          resultado positivo.
        </p>
        {error ? (
          <TicketErrorNotice
            error={error}
            onRetry={() =>
              void (pending.current
                ? mutate(pending.current.path, pending.current.body)
                : load())
            }
          />
        ) : null}
        {status ? <p role="status">{status}</p> : null}
        <button disabled={busy || uncertain} onClick={() => void load()}>
          Atualizar pesquisas
        </button>
        {data?.items.length === 0 ? <p>Nenhuma pesquisa disponível.</p> : null}
        {data?.items.map((i) => (
          <Answer
            key={i.id + ":" + i.state}
            item={i}
            busy={busy || uncertain}
            onSubmit={(id, b) => void mutate("/" + id, b)}
            onOpen={onOpen}
          />
        ))}
        {data?.nextCursor ? (
          <button
            disabled={busy || uncertain}
            onClick={() => void load(data.nextCursor!)}
          >
            Próxima página
          </button>
        ) : null}
        {canManage && data?.enabled ? (
          <details>
            <summary>Gestão dos convites e instrumento</summary>
            <p>
              Versão atual: {version}. Somente encerramentos posteriores à
              publicação são elegíveis. Novas versões não alteram convites
              existentes.
            </p>
            <button
              disabled={busy || uncertain || version === 0}
              onClick={() => void mutate("/reconcile", { after: cursor ?? 0 })}
            >
              {cursor ? "Continuar emissão" : "Emitir convites elegíveis"}
            </button>
            <fieldset disabled={busy || uncertain}>
              <legend>Publicar instrumento aprovado</legend>
              <label>
                Pergunta de resultado
                <input
                  maxLength={300}
                  value={resultQuestion}
                  onChange={(e) => setResultQuestion(e.target.value)}
                />
              </label>
              <label>
                Resultados — um por linha
                <textarea
                  value={outcomes}
                  onChange={(e) => setOutcomes(e.target.value)}
                />
              </label>
              <label>
                Pergunta de esforço
                <input
                  maxLength={300}
                  value={effortQuestion}
                  onChange={(e) => setEffortQuestion(e.target.value)}
                />
              </label>
              <label>
                Escala de esforço — um rótulo por linha
                <textarea
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                />
              </label>
              <label>
                Direção da escala
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="">Selecione</option>
                  <option value="ascending">
                    Do menor para o maior esforço
                  </option>
                  <option value="descending">
                    Do maior para o menor esforço
                  </option>
                </select>
              </label>
              <label>
                Prazo aprovado em horas
                <input
                  type="number"
                  min={1}
                  max={8760}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <label>
                Texto de consentimento
                <textarea
                  maxLength={2000}
                  value={consentText}
                  onChange={(e) => setConsentText(e.target.value)}
                />
              </label>
              <p>
                Elegíveis: solicitantes. Comentário individual restrito ao
                respondente; métricas restritas à gestão com acesso ao chamado.
                Uma resposta por convite; o respondente pode retirar o
                consentimento para processamento nas métricas. A retenção do
                histórico precisa ser definida pela operação.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                Instrumento, prazo, consentimento e audiências aprovados pela
                operação
              </label>
              <button
                disabled={
                  !approved ||
                  !resultQuestion ||
                  !effortQuestion ||
                  !hours ||
                  !direction ||
                  !consentText ||
                  outcomes.split("\n").filter(Boolean).length < 2 ||
                  labels.split("\n").filter(Boolean).length < 2
                }
                onClick={() =>
                  void mutate("/instrument", {
                    expectedVersion: version,
                    requestKey: crypto.randomUUID(),
                    definition: {
                      resultQuestion,
                      effortQuestion,
                      outcomes: outcomes
                        .split("\n")
                        .map((x) => x.trim())
                        .filter(Boolean),
                      effortLabels: labels
                        .split("\n")
                        .map((x) => x.trim())
                        .filter(Boolean),
                      effortDirection: direction,
                      windowHours: Number(hours),
                      consentText,
                      individualAudience: "requester",
                      aggregateAudience: "ticket.manage",
                      eligibleActor: "requester",
                      approved: true,
                    },
                  })
                }
              >
                Publicar nova versão
              </button>
            </fieldset>
          </details>
        ) : null}
      </section>
    </details>
  );
}
