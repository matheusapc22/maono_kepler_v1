import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "../../../lib/api-transport";
import { toTicketApiError } from "./tickets-api";
import TicketErrorNotice from "./TicketErrorNotice";
import type { TicketPerson } from "./ticket-types";
import "./ticket-knowledge.css";

type Revision = {
  id: string;
  number: number;
  title: string;
  body: string;
  audience: string;
  hash: string;
  authorId: number;
};
type Item = {
  id: string;
  revisionId: string;
  number: number;
  title: string;
  state: string;
  audience: string;
};
type List = { enabled: boolean; items: Item[]; nextCursor: string | null };
type Detail = {
  id: string;
  revision: Revision;
  published: Revision | null;
  state: string;
  version: string | null;
  canEdit: boolean;
  canReview: boolean;
  canRevise: boolean;
  reviewerId?: number;
  source?: { type: string; id: string | number };
  history?: Revision[];
  nextHistory?: number | null;
  nextEvents?: number | null;
  events?: {
    action: string;
    reason: string;
    actorId: number;
    createdAt: string;
  }[];
};
const labels: Record<string, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  withdrawn: "Retirado",
  create: "Criação",
  revise: "Nova versão",
  submit: "Submissão",
  approve: "Aprovação",
  reject: "Devolução",
  publish: "Publicação",
  withdraw: "Retirada",
  reviewer: "Troca de revisor",
  private: "Autor e revisor",
  organization: "Organização",
};
function useKnowledgeRequest() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<ReturnType<typeof toTicketApiError> | null>(
      null,
    );
  const generation = useRef(0),
    mounted = useRef(true),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, []);
  const run = useCallback(
    async <T,>(
      work: (signal: AbortSignal) => Promise<T>,
      apply: (value: T) => void,
      fail?: (error: ReturnType<typeof toTicketApiError>) => void,
    ) => {
      const g = ++generation.current;
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      setBusy(true);
      setError(null);
      try {
        const result = await work(c.signal);
        if (mounted.current && g === generation.current) apply(result);
      } catch (e) {
        if (mounted.current && g === generation.current && !c.signal.aborted) {
          const parsed = toTicketApiError(e);
          setError(parsed);
          fail?.(parsed);
        }
      } finally {
        if (mounted.current && g === generation.current) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, run };
}
type Props = {
  organizationId: string | number;
  canManage: boolean;
  reviewers?: TicketPerson[];
};
function KnowledgeEditor({ organizationId, canManage, reviewers = [] }: Props) {
  const endpoint = `/api/organizations/${organizationId}/ticket-knowledge`,
    { busy, error, run } = useKnowledgeRequest();
  const [list, setList] = useState<List | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [query, setQuery] = useState("");
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [audience, setAudience] = useState("private"),
    [reviewer, setReviewer] = useState(""),
    [reason, setReason] = useState("");
  const [sourceType, setSourceType] = useState("ticket"),
    [sourceId, setSourceId] = useState(""),
    [comparison, setComparison] = useState<Revision | null>(null);
  const [pending, setPending] = useState<{
    url: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const load = useCallback(
    (after = "") =>
      run(
        (s) =>
          requestJson<List>(
            `${endpoint}?q=${encodeURIComponent(query)}&after=${encodeURIComponent(after)}`,
            { signal: s },
          ),
        setList,
        () => {
          setList(null);
          setDetail(null);
          setTitle("");
          setBody("");
          setComparison(null);
        },
      ),
    [endpoint, query, run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  function show(d: Detail) {
    setDetail(d);
    setTitle(d.revision.title);
    setBody(d.revision.body);
    setAudience(d.revision.audience);
    setReviewer(String(d.reviewerId || ""));
    setComparison(d.published);
    setReason("");
  }
  function open(id: string, before?: number, eventsBefore?: number) {
    void run(
      (s) =>
        requestJson<Detail>(
          `${endpoint}/${encodeURIComponent(id)}?before=${before || 2147483647}&eventsBefore=${eventsBefore || Number.MAX_SAFE_INTEGER}`,
          { signal: s },
        ),
      show,
      (e) => {
        setDetail(null);
        setList(null);
        setTitle("");
        setBody("");
        setComparison(null);
        if (e.status === 403 || e.status === 404) setPending(null);
      },
    );
  }
  const dirty =
    !!detail &&
    (title !== detail.revision.title ||
      body !== detail.revision.body ||
      audience !== detail.revision.audience);
  function mutate(action: string) {
    const extra =
      action === "create"
        ? {
            title,
            body,
            reviewerId: Number(reviewer),
            ...(sourceId
              ? {
                  source: {
                    type: sourceType,
                    id: sourceType === "ticket" ? Number(sourceId) : sourceId,
                  },
                }
              : {}),
          }
        : action === "revise"
          ? { title, body, audience }
          : action === "reviewer"
            ? { reviewerId: Number(reviewer), reason }
            : { reason };
    const op = pending || {
      url: endpoint + (detail ? "/" + encodeURIComponent(detail.id) : ""),
      payload: {
        action,
        idempotencyKey: crypto.randomUUID(),
        ...(detail ? { version: detail.version } : {}),
        ...extra,
      },
    };
    setPending(op);
    void run(
      async (signal) => {
        const result = await requestJson<{ id: string }>(op.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op.payload),
          signal,
        });
        return requestJson<Detail>(
          endpoint + "/" + encodeURIComponent(result.id),
          { signal },
        );
      },
      (d) => {
        setPending(null);
        show(d);
      },
      (e) => {
        setDetail(null);
        setList(null);
        setTitle("");
        setBody("");
        setComparison(null);
        if (e.status === 403 || e.status === 404) setPending(null);
      },
    );
  }
  if (list?.enabled === false) return null;
  return (
    <section
      className="ticket-knowledge"
      aria-label="Conhecimento e respostas reutilizáveis"
    >
      <details>
        <summary>Conhecimento e respostas reutilizáveis</summary>
        <p>
          Artigos revisados da organização. Conteúdo de chamados e incidentes
          permanece privado até ser selecionado e revisado.
        </p>
        {error && <TicketErrorNotice error={error} />}
        {pending ? (
          <div role="status">
            <p>
              Tentativa preservada. Confira o resultado antes de iniciar outra
              operação.
            </p>
            <button
              disabled={busy}
              onClick={() => mutate(String(pending.payload.action))}
            >
              Repetir tentativa
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setPending(null);
                setDetail(null);
                void load();
              }}
            >
              Consultar estado atual
            </button>
          </div>
        ) : null}
        <fieldset disabled={busy || !!pending}>
          <label>
            Buscar artigos
            <input
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul>
            {list?.items.map((a) => (
              <li key={a.id}>
                <button onClick={() => open(a.id)}>
                  {a.title} · v{a.number} · {labels[a.state]}
                </button>
              </li>
            ))}
          </ul>
          {list?.nextCursor && (
            <button onClick={() => void load(list.nextCursor!)}>
              Próxima página
            </button>
          )}
          {canManage && (
            <button
              onClick={() => {
                setDetail(null);
                setTitle("");
                setBody("");
                setReviewer("");
                setAudience("private");
                setSourceId("");
                setComparison(null);
              }}
            >
              Novo artigo
            </button>
          )}
        </fieldset>
        {(detail || canManage) && (
          <fieldset disabled={busy || !!pending}>
            <legend>
              {detail
                ? `${labels[detail.state]} · versão ${detail.revision.number}`
                : "Novo rascunho restrito"}
            </legend>
            {detail && !detail.canEdit ? (
              <>
                <h4>{detail.revision.title}</h4>
                <p className="ticket-knowledge-body">{detail.revision.body}</p>
              </>
            ) : (
              <>
                <label>
                  Título
                  <input
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    readOnly={!!detail && !detail.canRevise}
                  />
                </label>
                <label>
                  Diagnóstico e solução
                  <textarea
                    rows={8}
                    maxLength={12000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    readOnly={!!detail && !detail.canRevise}
                  />
                </label>
                <label>
                  Audiência da versão
                  <select
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    disabled={!detail || !detail.canRevise}
                  >
                    <option value="private">Autor e revisor</option>
                    <option value="organization">Organização</option>
                  </select>
                </label>
                <label>
                  Revisor independente
                  <select
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                  >
                    <option value="">Selecione uma pessoa elegível</option>
                    {reviewer &&
                      !reviewers.some((p) => String(p.id) === reviewer) && (
                        <option value={reviewer}>Revisor atual</option>
                      )}
                    {reviewers.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name || p.email || `Usuário ${p.id}`}
                      </option>
                    ))}
                  </select>
                </label>
                {!detail && (
                  <>
                    <label>
                      Tipo de origem opcional
                      <select
                        value={sourceType}
                        onChange={(e) => setSourceType(e.target.value)}
                      >
                        <option value="ticket">Chamado</option>
                        <option value="case">Incidente ou problema</option>
                      </select>
                    </label>
                    <label>
                      ID da origem
                      <input
                        value={sourceId}
                        onChange={(e) => setSourceId(e.target.value)}
                      />
                    </label>
                    <p>
                      A origem será vinculada sem copiar seu texto ou ampliar o
                      acesso.
                    </p>
                    <button
                      disabled={!title.trim() || !body.trim() || !reviewer}
                      onClick={() => mutate("create")}
                    >
                      Salvar rascunho
                    </button>
                  </>
                )}
                {detail && (
                  <>
                    {detail.source && (
                      <p>
                        Origem autorizada:{" "}
                        {detail.source.type === "ticket"
                          ? "chamado"
                          : "incidente/problema"}{" "}
                        {detail.source.id}
                      </p>
                    )}
                    {detail.canRevise && (
                      <button
                        disabled={!title.trim() || !body.trim()}
                        onClick={() => mutate("revise")}
                      >
                        Salvar nova versão
                      </button>
                    )}
                    <label>
                      Justificativa da decisão
                      <textarea
                        maxLength={1000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    {dirty && (
                      <p role="status">
                        Salve a nova versão antes de decidir sobre a revisão ou
                        publicação.
                      </p>
                    )}
                    <div className="ticket-knowledge-actions">
                      {detail.canRevise && detail.state === "draft" && (
                        <button
                          disabled={!reason.trim() || dirty}
                          onClick={() => mutate("submit")}
                        >
                          Solicitar revisão
                        </button>
                      )}
                      {detail.canReview && detail.state === "review" && (
                        <>
                          <button
                            disabled={!reason.trim() || dirty}
                            onClick={() => mutate("approve")}
                          >
                            Aprovar conteúdo e audiência
                          </button>
                          <button
                            disabled={!reason.trim() || dirty}
                            onClick={() => mutate("reject")}
                          >
                            Devolver ao autor
                          </button>
                        </>
                      )}
                      {detail.state === "approved" && (
                        <button
                          disabled={!reason.trim() || dirty}
                          onClick={() => mutate("publish")}
                        >
                          Publicar versão aprovada
                        </button>
                      )}
                      {detail.published && (
                        <button
                          disabled={!reason.trim() || dirty}
                          onClick={() => mutate("withdraw")}
                        >
                          Retirar das sugestões
                        </button>
                      )}
                      <button
                        disabled={!reason.trim() || !reviewer || dirty}
                        onClick={() => mutate("reviewer")}
                      >
                        Trocar revisor e reiniciar revisão
                      </button>
                    </div>
                    <p>
                      Revise dados pessoais e informações privadas antes de
                      aprovar. Editar uma versão invalida sua aprovação.
                    </p>
                  </>
                )}
              </>
            )}
            {!!detail?.history?.length && (
              <details>
                <summary>Comparar versões e decisões</summary>
                <select
                  aria-label="Versão para comparar"
                  value={comparison?.id || ""}
                  onChange={(e) =>
                    setComparison(
                      detail.history?.find((r) => r.id === e.target.value) ||
                        null,
                    )
                  }
                >
                  <option value="">Selecione</option>
                  {detail.history.map((r) => (
                    <option key={r.id} value={r.id}>
                      v{r.number} — {r.title}
                    </option>
                  ))}
                </select>
                {comparison && (
                  <div className="ticket-knowledge-comparison">
                    <div>
                      <h4>
                        v{comparison.number}: {comparison.title}
                      </h4>
                      <p>{labels[comparison.audience]}</p>
                      <p className="ticket-knowledge-body">{comparison.body}</p>
                    </div>
                    <div>
                      <h4>
                        v{detail.revision.number}: {detail.revision.title}
                      </h4>
                      <p>{labels[detail.revision.audience]}</p>
                      <p className="ticket-knowledge-body">
                        {detail.revision.body}
                      </p>
                    </div>
                  </div>
                )}
                {detail.nextHistory && (
                  <button onClick={() => open(detail.id, detail.nextHistory!)}>
                    Versões anteriores
                  </button>
                )}
                <ul>
                  {detail.events?.map((e, i) => (
                    <li key={i}>
                      {labels[e.action]} — {e.reason} — {e.createdAt}
                    </li>
                  ))}
                </ul>
                {detail.nextEvents && (
                  <button
                    onClick={() =>
                      open(detail.id, undefined, detail.nextEvents!)
                    }
                  >
                    Decisões anteriores
                  </button>
                )}
              </details>
            )}
          </fieldset>
        )}
      </details>
    </section>
  );
}
export default function TicketKnowledgePanel(p: Props) {
  return <KnowledgeEditor key={String(p.organizationId)} {...p} />;
}

type Selection = {
  selectionId: string;
  revision: Revision;
  body: string;
  kind: string;
};
type ReuseProps = {
  organizationId: string | number;
  ticketId: number;
  canUseInternal: boolean;
  onSent: () => void;
};
export function TicketKnowledgeReuse({
  organizationId,
  ticketId,
  canUseInternal,
  onSent,
}: ReuseProps) {
  const endpoint = `/api/organizations/${organizationId}/ticket-knowledge`,
    { busy, error, run } = useKnowledgeRequest();
  const [list, setList] = useState<List | null>(null),
    [query, setQuery] = useState(""),
    [selection, setSelection] = useState<Selection | null>(null),
    [articleId, setArticleId] = useState(""),
    [body, setBody] = useState(""),
    [kind, setKind] = useState("response"),
    [reviewed, setReviewed] = useState(false);
  const pending = useRef<{
    articleId: string;
    selectionId: string;
    body: string;
    reviewed: true;
  } | null>(null);
  const load = useCallback(
    (after = "") =>
      run(
        (s) =>
          requestJson<List>(
            `${endpoint}?suggestions=true&q=${encodeURIComponent(query)}&after=${encodeURIComponent(after)}`,
            { signal: s },
          ),
        setList,
        () => {
          setList(null);
          setSelection(null);
          setBody("");
        },
      ),
    [endpoint, query, run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  function choose(item: Item) {
    const payload = {
      revisionId: item.revisionId,
      ticketId,
      kind,
      idempotencyKey: crypto.randomUUID(),
    };
    void run(
      (s) =>
        requestJson<Selection>(
          endpoint + "/" + encodeURIComponent(item.id) + "/select",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: s,
          },
        ),
      (value) => {
        setArticleId(item.id);
        setSelection(value);
        setBody(value.body);
        setReviewed(false);
        pending.current = null;
      },
      () => {
        setSelection(null);
        setBody("");
      },
    );
  }
  function send() {
    if (!selection) return;
    const payload = pending.current || {
      articleId,
      selectionId: selection.selectionId,
      body,
      reviewed: true as const,
    };
    pending.current = payload;
    void run(
      (s) =>
        requestJson(
          endpoint + "/" + encodeURIComponent(payload.articleId) + "/send",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selectionId: payload.selectionId,
              body: payload.body,
              reviewed: payload.reviewed,
            }),
            signal: s,
          },
        ),
      () => {
        pending.current = null;
        setSelection(null);
        setBody("");
        setReviewed(false);
        onSent();
      },
      (e) => {
        if (e.status === 403 || e.status === 404) {
          pending.current = null;
          setSelection(null);
          setList(null);
          setBody("");
          setReviewed(false);
        }
      },
    );
  }
  if (list?.enabled === false) return null;
  return (
    <details className="ticket-knowledge">
      <summary>Usar resposta revisada</summary>
      {error && <TicketErrorNotice error={error} />}
      <fieldset disabled={busy || !!pending.current}>
        <label>
          Buscar solução
          <input
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Enviar como
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setSelection(null);
              setBody("");
              setReviewed(false);
            }}
          >
            <option value="response">Resposta</option>
            {canUseInternal && <option value="internal">Nota interna</option>}
          </select>
        </label>
        <ul>
          {list?.items.map((a) => (
            <li key={a.id}>
              <button onClick={() => choose(a)}>
                {a.title} · v{a.number} — inserir no rascunho
              </button>
            </li>
          ))}
        </ul>
        {list?.nextCursor && (
          <button onClick={() => void load(list.nextCursor!)}>
            Próxima página de sugestões
          </button>
        )}
        {selection && (
          <>
            <p>
              Rascunho baseado em {selection.revision.title}, versão{" "}
              {selection.revision.number}. Revise antes de enviar.
            </p>
            <label>
              Resposta revisável
              <textarea
                rows={6}
                value={body}
                maxLength={12000}
                onChange={(e) => {
                  setBody(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              Revisei o texto e os destinatários desta{" "}
              {kind === "internal" ? "nota interna" : "resposta"}.
            </label>
            <button disabled={!reviewed || !body.trim()} onClick={send}>
              Enviar texto revisado
            </button>
            <button
              onClick={() => {
                setSelection(null);
                setBody("");
                setReviewed(false);
              }}
            >
              Descartar seleção
            </button>
          </>
        )}
      </fieldset>
      {pending.current && (
        <>
          <p role="status">
            Confira a conversa se o resultado for incerto. Repetir esta
            tentativa não duplica o envio.
          </p>
          <button disabled={busy} onClick={send}>
            Repetir envio preservado
          </button>
          <button
            disabled={busy}
            onClick={() => {
              pending.current = null;
              setSelection(null);
              setBody("");
              setReviewed(false);
              void load();
              onSent();
            }}
          >
            Consultar conversa e descartar seleção
          </button>
        </>
      )}
    </details>
  );
}
