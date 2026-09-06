import { useCallback, useEffect, useMemo, useState } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter";
import { useMapPanel } from "../map-panel/MapPanelContext";
import { getProjectChangeRequest } from "./change-request-api";
import {
  listViewerTrackedChangeRequests,
  resubmitViewerChangeRequest,
  type ViewerTrackedChangeRequest,
} from "./viewer-request-tracking-api";
import type {
  ViewerChangeOperation,
  ViewerWorkingCopy,
  ViewerWorkingCopyStore,
} from "./viewer-working-copy";
import "./viewer-request-tracking.css";

type Props = {
  enabled: boolean;
  store: ViewerWorkingCopyStore | null;
  workingCopy: ViewerWorkingCopy | null;
  baseRevision: number;
  onWorkingCopyChange(value: ViewerWorkingCopy | null): void;
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Enviada",
  under_review: "Em revisão",
  approved: "Aprovada",
  rejected: "Rejeitada",
  conflict: "Conflito",
  applying: "Aplicando",
  applied: "Aplicada",
  superseded: "Substituída",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function cloneOperationForCorrection(operation: ViewerChangeOperation): ViewerChangeOperation {
  return {
    id: `op_${crypto.randomUUID()}`,
    type: operation.type,
    version: operation.version,
    payload: JSON.parse(JSON.stringify(operation.payload)),
    createdAt: new Date().toISOString(),
  };
}

function isCorrectable(request: ViewerTrackedChangeRequest) {
  return (
    (request.status === "rejected" || request.status === "conflict") &&
    !request.resubmittedToRequestId
  );
}

export default function ViewerRequestTrackingRuntime({
  enabled,
  store,
  workingCopy,
  baseRevision,
  onWorkingCopyChange,
}: Props) {
  const { context } = useMapPanel();
  const { state: engineState } = useKeplerEngineAdapter();
  const projectSlug = context?.project?.slug || "";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ViewerTrackedChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ViewerTrackedChangeRequest | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composerNote, setComposerNote] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !projectSlug) return;
    setLoading(true);
    try {
      const next = await listViewerTrackedChangeRequests(projectSlug, {
        limit: 50,
        signal,
      });
      setItems(next);
      setError(null);
    } catch (refreshError) {
      if (signal?.aborted) return;
      const code = String((refreshError as { code?: string })?.code || "");
      setError(
        code === "CHANGE_REQUEST_RESUBMISSION_SCHEMA_OUTDATED"
          ? "O acompanhamento será liberado após a migration 0023 do rollout controlado."
          : refreshError instanceof Error
            ? refreshError.message
            : "Não foi possível atualizar as solicitações.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [enabled, projectSlug]);

  useEffect(() => {
    if (!enabled || !projectSlug) return undefined;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [enabled, projectSlug, refresh]);

  useEffect(() => {
    if (!source) return;
    const available = new Set((workingCopy?.operations || []).map((item) => item.id));
    setSelectedIds((current) => current.filter((id) => available.has(id)));
  }, [source, workingCopy?.updatedAt]);

  const pendingCount = useMemo(
    () => items.filter((item) =>
      ["submitted", "under_review", "approved", "applying"].includes(item.status),
    ).length,
    [items],
  );

  async function beginCorrection(requestItem: ViewerTrackedChangeRequest) {
    if (!store || preparing || !isCorrectable(requestItem)) return;
    setPreparing(true);
    setError(null);
    setSuccess(null);
    setSource(requestItem);
    setReason("");
    setSelectedIds([]);
    try {
      const current = await store.load();
      if (current && current.baseRevision !== baseRevision) {
        onWorkingCopyChange(current);
        setComposerNote(
          "Há alterações locais de uma revisão anterior. Elas foram preservadas. Resolva esse rascunho antes de iniciar a correção na revisão atual.",
        );
        return;
      }

      if (current?.operations.length) {
        onWorkingCopyChange(current);
        setComposerNote(
          "Suas alterações locais existentes foram preservadas. Selecione explicitamente quais delas pertencem a esta correção.",
        );
        return;
      }

      const ensured = await store.ensure(baseRevision);
      onWorkingCopyChange(ensured);

      if (requestItem.baseRevision !== baseRevision) {
        setComposerNote(
          "O projeto avançou de revisão. Um novo rascunho foi iniciado vazio na revisão atual; refaça as correções antes de reenviar.",
        );
        return;
      }

      const detail = await getProjectChangeRequest(projectSlug, requestItem.id);
      let next = ensured;
      const seededIds: string[] = [];
      for (const candidate of detail.operations || []) {
        const operation = cloneOperationForCorrection(candidate);
        next = await store.appendOperation(baseRevision, operation);
        seededIds.push(operation.id);
      }
      onWorkingCopyChange(next);
      setSelectedIds(seededIds);
      setComposerNote(
        seededIds.length
          ? "As alterações rejeitadas foram copiadas para um novo rascunho local. Revise-as antes do reenvio."
          : "A solicitação anterior não possui operações reaproveitáveis. Refaça as correções no mapa.",
      );
    } catch (prepareError) {
      setComposerNote(null);
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Não foi possível preparar a correção.",
      );
    } finally {
      setPreparing(false);
    }
  }

  function toggleOperation(operationId: string) {
    setSelectedIds((current) =>
      current.includes(operationId)
        ? current.filter((id) => id !== operationId)
        : [...current, operationId],
    );
  }

  async function submitCorrection() {
    if (!source || !store || !projectSlug || submitting || !workingCopy) return;
    if (workingCopy.baseRevision !== baseRevision) {
      setError("O rascunho local pertence a uma revisão anterior e foi preservado.");
      return;
    }
    if (engineState.hasUnsavedChanges) {
      setError(
        "Existe uma alteração no mapa que ainda não foi convertida para a Working Copy. Revise-a antes do reenvio.",
      );
      return;
    }
    const selected = workingCopy.operations.filter((operation) =>
      selectedIds.includes(operation.id),
    );
    if (!selected.length) {
      setError("Selecione pelo menos uma alteração corrigida.");
      return;
    }
    if (!reason.trim()) {
      setError("Informe o motivo da correção.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await store.assertCurrentRevision(baseRevision);
      const result = await resubmitViewerChangeRequest(projectSlug, source.id, {
        baseRevision,
        reason: reason.trim(),
        operations: selected,
        idempotencyKey: `${workingCopy.submissionKey}:resubmit:${source.id}`,
      });
      const next = await store.completeSubmission(selected.map((item) => item.id));
      onWorkingCopyChange(next);
      setSelectedIds([]);
      setReason("");
      setSource(null);
      setComposerNote(null);
      setSuccess(
        result.changeRequest.ticketId
          ? "Correção reenviada em uma nova solicitação e um novo chamado."
          : "Correção reenviada em uma nova solicitação.",
      );
      await refresh();
    } catch (submitError) {
      const code = String((submitError as { code?: string })?.code || "");
      if (code === "CHANGE_REQUEST_BASE_REVISION_STALE") {
        setError(
          "O projeto mudou novamente. As alterações locais foram preservadas para revisão.",
        );
      } else {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Não foi possível reenviar a correção.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!enabled || !projectSlug) return null;

  return (
    <>
      <button
        type="button"
        className="maono-viewer-requests__launcher"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void refresh();
        }}
        aria-expanded={open}
      >
        Solicitações
        {pendingCount ? <span>{pendingCount}</span> : null}
      </button>

      {open ? (
        <aside className="maono-viewer-requests" aria-label="Minhas solicitações de alteração">
          <header>
            <div>
              <small>Viewer</small>
              <strong>Minhas solicitações</strong>
            </div>
            <div className="maono-viewer-requests__header-actions">
              <button type="button" onClick={() => void refresh()} disabled={loading}>
                {loading ? "Atualizando…" : "Atualizar"}
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            </div>
          </header>

          {success ? <p className="maono-viewer-requests__success">{success}</p> : null}
          {error ? <p className="maono-viewer-requests__error" role="alert">{error}</p> : null}

          <div className="maono-viewer-requests__list">
            {!loading && !items.length && !error ? (
              <p className="maono-viewer-requests__empty">Nenhuma solicitação enviada neste projeto.</p>
            ) : null}
            {items.map((item) => (
              <article key={item.id} className={`maono-viewer-request is-${item.status}`}>
                <div className="maono-viewer-request__title">
                  <strong>{STATUS_LABELS[item.status] || item.status}</strong>
                  <span>{formatDate(item.updatedAt || item.submittedAt)}</span>
                </div>
                <p>{item.reason}</p>
                <dl>
                  <div><dt>Revisão</dt><dd>{item.baseRevision}</dd></div>
                  <div><dt>Alterações</dt><dd>{item.operationCount}</dd></div>
                  {item.ticketId ? <div><dt>Chamado</dt><dd>#{item.ticketId}</dd></div> : null}
                  {item.appliedRevision != null ? (
                    <div><dt>Aplicada na revisão</dt><dd>{item.appliedRevision}</dd></div>
                  ) : null}
                </dl>
                {item.feedback ? (
                  <div className="maono-viewer-request__feedback">
                    <strong>Feedback da revisão</strong>
                    <span>{item.feedback}</span>
                  </div>
                ) : null}
                {item.resubmittedFromRequestId ? (
                  <small>Correção de {item.resubmittedFromRequestId}</small>
                ) : null}
                {item.resubmittedToRequestId ? (
                  <small>Correção enviada: {item.resubmittedToRequestId}</small>
                ) : null}
                {isCorrectable(item) ? (
                  <button
                    type="button"
                    className="is-primary"
                    disabled={preparing || !store?.writable}
                    onClick={() => void beginCorrection(item)}
                  >
                    {preparing && source?.id === item.id ? "Preparando…" : "Corrigir e reenviar"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>

          {source ? (
            <section className="maono-viewer-requests__composer">
              <div className="maono-viewer-requests__composer-title">
                <div>
                  <small>Nova solicitação vinculada</small>
                  <strong>Corrigir {source.id}</strong>
                </div>
                <button type="button" onClick={() => setSource(null)} disabled={submitting}>×</button>
              </div>
              {composerNote ? <p className="maono-viewer-requests__note">{composerNote}</p> : null}
              <div className="maono-viewer-requests__operations">
                {(workingCopy?.operations || []).map((operation) => (
                  <label key={operation.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(operation.id)}
                      disabled={submitting || workingCopy?.baseRevision !== baseRevision}
                      onChange={() => toggleOperation(operation.id)}
                    />
                    <span>
                      <strong>{operation.type}</strong>
                      <small>{formatDate(operation.createdAt)}</small>
                    </span>
                  </label>
                ))}
                {!workingCopy?.operations.length ? (
                  <p>Faça as correções no mapa. As novas operações aparecerão aqui.</p>
                ) : null}
              </div>
              <label className="maono-viewer-requests__reason">
                <span>Motivo da correção *</span>
                <textarea
                  value={reason}
                  maxLength={2000}
                  disabled={submitting}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Descreva o que foi corrigido após o feedback."
                />
              </label>
              <button
                type="button"
                className="is-primary"
                disabled={
                  submitting ||
                  workingCopy?.baseRevision !== baseRevision ||
                  engineState.hasUnsavedChanges ||
                  !selectedIds.length ||
                  !reason.trim()
                }
                onClick={() => void submitCorrection()}
              >
                {submitting ? "Reenviando…" : "Reenviar correção"}
              </button>
            </section>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
