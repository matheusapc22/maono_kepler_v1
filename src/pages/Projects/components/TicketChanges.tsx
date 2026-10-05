import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import { requestJson } from "../../../lib/api-transport";
import TicketErrorNotice from "./TicketErrorNotice";
import { toTicketApiError } from "./tickets-api";
import { useEffect, useState, useCallback, useRef } from "react";
type Item = {
  informationRequested?: { feedback: string } | null;
  resubmit?: { slug: string; id: string } | null;
  id: string;
  title: string;
  proposal: string;
  domain: string;
  status: string;
  version: number;
  linkVersion: number;
  active: boolean;
  canReview: boolean;
  reviewUrl: string | null;
  appliedRevision: number | null;
  divergence: string | null;
  reconcileAttempts?: number;
  reconcileError?: string | null;
  canRetryReconcile?: boolean;
  feedback: string;
  history: {
    version: number;
    status: string;
    feedback: string;
    created_at: string;
  }[];
  crHistory: { version: number; to_status: string; created_at: string }[];
};
export function TicketChanges({
  organizationId,
  ticketId,
  canManage,
}: {
  organizationId: number | string;
  ticketId: number | string;
  canManage: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [recordId, setRecordId] = useState(""),
    [domain, setDomain] = useState("platform"),
    [title, setTitle] = useState(""),
    [proposal, setProposal] = useState(""),
    [feedback, setFeedback] = useState(""),
    [evidence, setEvidence] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  const pending = useRef<{ body: string; key: string } | null>(null);
  const generation = useRef(0),
    base = `/api/organizations/${organizationId}/tickets/${ticketId}/changes`;
  const load = useCallback(
    async (after = "") => {
      const own = ++generation.current;
      try {
        const data = await requestJson<{
          enabled: boolean;
          items: Item[];
          nextCursor: string | null;
        }>(base + (after ? `?after=${encodeURIComponent(after)}` : ""));
        if (own !== generation.current) return;
        setEnabled(data.enabled);
        setItems(data.items);
        setCursor(data.nextCursor || null);
        setError(null);
      } catch (e) {
        if (own === generation.current) {
          setItems([]);
          setError(e);
        }
      }
    },
    [base],
  );
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    setItems([]);
    setEnabled(false);
    void load();
    const focus = () => {
      void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      invalidate();
      window.removeEventListener("focus", focus);
    };
  }, [load, invalidate]);
  async function command(input: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const body = JSON.stringify(input);
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    try {
      await requestJson(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.current.key,
        },
        body,
      });
      pending.current = null;
      await load();
    } catch (e) {
      setItems([]);
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function resubmit(item: Item) {
    if (!item.resubmit) return;
    setBusy(true);
    setError(null);
    try {
      const url = `/api/projects/${encodeURIComponent(item.resubmit.slug)}/change-requests`;
      const data = await requestJson<{
        changeRequest: { baseRevision: number; operations: unknown[] };
      }>(`${url}/${encodeURIComponent(item.resubmit.id)}`);
      const body = JSON.stringify({
        baseRevision: data.changeRequest.baseRevision,
        operations: data.changeRequest.operations,
        reason: feedback,
        supersedes: item.resubmit.id,
      });
      if (pending.current?.body !== body)
        pending.current = { body, key: crypto.randomUUID() };
      await requestJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.current.key,
        },
        body,
      });
      pending.current = null;
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return error ? <TicketErrorNotice error={toTicketApiError(error)} /> : null;
  return (
    <section className="ticket-history" aria-label="Mudanças vinculadas">
      <h4>Mudanças vinculadas</h4>
      <p>
        A conclusão técnica não encerra o atendimento. Revisão e aplicação
        exigem permissões próprias.
      </p>
      {error ? <TicketErrorNotice error={toTicketApiError(error)} /> : null}
      <button type="button" disabled={busy} onClick={() => void load()}>
        Atualizar mudanças
      </button>
      {items.map((item) => (
        <article key={item.id}>
          <h5>
            {item.title} · {item.status}
            {!item.active ? " · desvinculada" : ""}
          </h5>
          <p>{item.proposal}</p>
          {item.appliedRevision !== null ? (
            <p>Revisão aplicada: {item.appliedRevision}</p>
          ) : null}
          {item.feedback ? <p>{item.feedback}</p> : null}
          {item.divergence ? (
            <p role="alert">Divergência: {item.divergence}</p>
          ) : null}
          {item.reconcileError ? (
            <div role="status">
              <p>Reconciliação pendente após {item.reconcileAttempts || 0} tentativa(s).</p>
              {canManage && item.canRetryReconcile && item.active ? (
                <button type="button" disabled={busy} onClick={() => void command({ action: "retry_reconcile", recordId: item.id })}>
                  Reagendar reconciliação
                </button>
              ) : null}
            </div>
          ) : null}
          {item.informationRequested ? (
            <p>Informações solicitadas: {item.informationRequested.feedback}</p>
          ) : null}
          {item.resubmit ? (
            <div>
              <label>
                Justificativa complementada
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <p>
                Reenvia as operações originais. Para alterar as operações,
                prepare uma nova proposta no mapa.
              </p>
              <button
                type="button"
                disabled={busy || !feedback.trim()}
                onClick={() => void resubmit(item)}
              >
                Reenviar proposta
              </button>
            </div>
          ) : null}
          {item.reviewUrl ? <a href={item.reviewUrl}>Abrir revisão</a> : null}
          <details>
            <summary>Histórico</summary>
            {item.crHistory?.map((h) => (
              <p key={`cr${h.version}`}>
                CR v{h.version} · {h.to_status} · {h.created_at}
              </p>
            ))}
            {item.history.map((h) => (
              <p key={h.version}>
                Proposta v{h.version} · {h.status} · {h.feedback}
              </p>
            ))}
          </details>
          {canManage ? (
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void command({
                    action: item.active ? "unlink" : "link",
                    recordId: item.id,
                    linkVersion: item.linkVersion,
                  })
                }
              >
                {item.active ? "Desvincular" : "Restaurar vínculo"}
              </button>
              {item.active ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command({ action: "reconcile", recordId: item.id })
                  }
                >
                  Reconciliar progresso
                </button>
              ) : null}
              {item.domain !== "map_project" && item.canReview ? (
                <div>
                  <label>
                    Justificativa / feedback
                    <input
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                  </label>
                  <label>
                    Evidência de execução (HTTPS)
                    <input
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                    />
                  </label>
                  {(
                    [
                      "request_information",
                      "resubmit",
                      "plan",
                      "approve",
                      "reject",
                      "deliver",
                    ] as const
                  ).map((action, i) => (
                    <button
                      type="button"
                      key={action}
                      disabled={busy || !feedback.trim()}
                      onClick={() =>
                        void command({
                          action,
                          recordId: item.id,
                          version: item.version,
                          feedback,
                          proposal,
                          evidenceUrl: evidence,
                        })
                      }
                    >
                      {
                        [
                          "Pedir informações",
                          "Reenviar proposta",
                          "Planejar",
                          "Aprovar",
                          "Rejeitar",
                          "Registrar entrega",
                        ][i]
                      }
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
      {cursor ? (
        <button type="button" onClick={() => void load(cursor)}>
          Carregar mais
        </button>
      ) : null}
      {canManage ? (
        <details>
          <summary>Vincular ou registrar mudança</summary>
          <label>
            ID da mudança
            <input
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !recordId.trim()}
            onClick={() =>
              void command({ action: "link", recordId, linkVersion: 0 })
            }
          >
            Vincular existente
          </button>
          <p>
            Registros de plataforma e banco exigem super admin. A entrega
            registra evidência; não executa código ou SQL.
          </p>
          <label>
            Domínio
            <MaonoSelect value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="platform">Plataforma</option>
              <option value="database">Banco</option>
            </MaonoSelect>
          </label>
          <label>
            Título
            <input
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Proposta / reenvio
            <textarea
              maxLength={10000}
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !title.trim() || !proposal.trim()}
            onClick={() =>
              void command({ action: "create", domain, title, proposal })
            }
          >
            Registrar proposta
          </button>
        </details>
      ) : null}
    </section>
  );
}
