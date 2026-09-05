import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router";

import KeplerApp from "../index";
import { getMaonoMapRuntime } from "../map-url-loader/map-visual-readiness";
import {
  applyProjectChangeReview,
  changeProjectChangeReviewState,
  getProjectChangeReview,
  type ProjectChangeReview,
  type ReviewOperationProjection,
} from "./review-api";
import "./review-workspace.css";

type ProjectedPoint = {
  id: string;
  left: number;
  top: number;
};

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação de Review.";
}

function mapSurfaceRect() {
  const node = document.querySelector<HTMLElement>(".maono-kepler-viewport");
  const rect = node?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function operationSummary(operation: ReviewOperationProjection | null) {
  if (!operation) return null;
  return {
    title: operation.type === "point.create" ? "Criar ponto" : operation.type,
    target: operation.target.label || operation.target.layerId || "Camada de destino",
    latitude: operation.focus.latitude,
    longitude: operation.focus.longitude,
    properties: Object.entries(operation.properties || {}),
  };
}

function ReviewMarkerLayer({
  operations,
  selectedId,
  visible,
}: {
  operations: ReviewOperationProjection[];
  selectedId: string | null;
  visible: boolean;
}) {
  const [points, setPoints] = useState<ProjectedPoint[]>([]);
  const attachedRuntime = useRef<any>(null);
  const detachRuntime = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    if (!visible) {
      setPoints([]);
      return;
    }
    const map = getMaonoMapRuntime() as any;
    const rect = mapSurfaceRect();
    if (!map?.project || !rect) return;
    const next = operations.flatMap((operation) => {
      if (operation.overlay?.kind !== "point") return [];
      try {
        const projected = map.project([
          operation.overlay.longitude,
          operation.overlay.latitude,
        ]);
        const x = Number(projected?.x);
        const y = Number(projected?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
        return [
          {
            id: operation.id,
            left: rect.left + x,
            top: rect.top + y,
          },
        ];
      } catch {
        return [];
      }
    });
    setPoints(next);
  }, [operations, visible]);

  useEffect(() => {
    function attach() {
      const map = getMaonoMapRuntime() as any;
      if (attachedRuntime.current === map) {
        refresh();
        return;
      }
      detachRuntime.current?.();
      detachRuntime.current = null;
      attachedRuntime.current = map;
      if (!map?.on || !map?.off) {
        refresh();
        return;
      }
      const handler = () => refresh();
      for (const event of ["move", "zoom", "resize", "render"]) {
        map.on(event, handler);
      }
      detachRuntime.current = () => {
        for (const event of ["move", "zoom", "resize", "render"]) {
          map.off(event, handler);
        }
      };
      refresh();
    }

    attach();
    window.addEventListener("maono:map-runtime", attach);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("maono:map-runtime", attach);
      window.removeEventListener("resize", refresh);
      detachRuntime.current?.();
      detachRuntime.current = null;
      attachedRuntime.current = null;
    };
  }, [refresh]);

  if (!visible) return null;
  return (
    <div className="maono-review-markers" aria-hidden="true">
      {points.map((point) => (
        <span
          key={point.id}
          className={`maono-review-marker${point.id === selectedId ? " is-selected" : ""}`}
          style={{ left: point.left, top: point.top }}
        />
      ))}
    </div>
  );
}

function ReviewWorkspaceOverlay({
  projectSlug,
  changeRequestId,
}: {
  projectSlug: string;
  changeRequestId: string;
}) {
  const [review, setReview] = useState<ProjectChangeReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<"before" | "after">("after");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let loaded = await getProjectChangeReview(projectSlug, changeRequestId);
      if (loaded.changeRequest.status === "submitted" && !startedRef.current) {
        startedRef.current = true;
        loaded = await changeProjectChangeReviewState(projectSlug, changeRequestId, {
          action: "start",
        });
      }
      setReview(loaded);
    } catch (loadError) {
      setError(safeMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [changeRequestId, projectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const operations = review?.proposal?.operations || [];
  useEffect(() => {
    if (!operations.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, operations.length - 1));
  }, [operations.length]);

  const selected = operations[selectedIndex] || null;
  const summary = useMemo(() => operationSummary(selected), [selected]);

  const focusOperation = useCallback((operation: ReviewOperationProjection | null) => {
    if (!operation) return;
    const map = getMaonoMapRuntime() as any;
    if (!map?.flyTo) return;
    const currentZoom = Number(map.getZoom?.() ?? 0);
    map.flyTo({
      center: [operation.focus.longitude, operation.focus.latitude],
      zoom: Math.max(currentZoom, 12),
      duration: 600,
    });
  }, []);

  function selectIndex(next: number) {
    if (!operations.length) return;
    const normalized = Math.max(0, Math.min(next, operations.length - 1));
    setSelectedIndex(normalized);
    focusOperation(operations[normalized]);
  }

  async function approve() {
    if (!review?.permissions.canApprove || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await changeProjectChangeReviewState(projectSlug, changeRequestId, {
        action: "approve",
      });
      setReview(updated);
      setToast("Solicitação aprovada. Nenhuma revisão foi publicada ainda.");
    } catch (actionError) {
      setError(safeMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectComment.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await changeProjectChangeReviewState(projectSlug, changeRequestId, {
        action: "reject",
        comment: rejectComment.trim(),
      });
      setReview(updated);
      setRejectOpen(false);
      setRejectComment("");
      setToast("Solicitação rejeitada.");
    } catch (actionError) {
      setError(safeMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!review?.permissions.canApply || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyProjectChangeReview(projectSlug, changeRequestId);
      setReview(result.review);
      setToast(
        `Alterações aplicadas na REV ${result.appliedRevision} do mesmo projeto.`,
      );
    } catch (actionError) {
      setError(safeMessage(actionError));
      try {
        setReview(await getProjectChangeReview(projectSlug, changeRequestId, { force: true }));
      } catch {
        // Mantém o erro principal; refresh é best-effort.
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ReviewMarkerLayer
        operations={operations}
        selectedId={selected?.id || null}
        visible={compareMode === "after"}
      />

      <aside className="maono-review-panel" aria-label="Review da solicitação">
        <header className="maono-review-panel__header">
          <div>
            <small>Review workspace</small>
            <h1>{review?.project.name || "Revisão de alteração"}</h1>
          </div>
          <Link to={`/projects/${encodeURIComponent(projectSlug)}/edit`}>
            Voltar ao projeto
          </Link>
        </header>

        {loading ? (
          <div className="maono-review-panel__state" role="status">
            <strong>Carregando revisão-base</strong>
            <span>Validando operações e proposta…</span>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="maono-review-panel__error" role="alert">
            {error}
          </div>
        ) : null}

        {review ? (
          <div className="maono-review-panel__body">
            <div className="maono-review-revisions">
              <span>Base <strong>REV {review.base.revision}</strong></span>
              <span>Atual <strong>REV {review.project.currentRevision}</strong></span>
              <span className={`maono-review-status is-${review.changeRequest.status}`}>
                {review.changeRequest.status.replaceAll("_", " ")}
              </span>
            </div>

            {review.conflict ? (
              <div className="maono-review-conflict" role="alert">
                <strong>Conflito de revisão</strong>
                <span>{review.conflict.message}</span>
                <small>A aplicação automática foi bloqueada para não sobrescrever alterações mais recentes.</small>
              </div>
            ) : null}

            <div className="maono-review-compare" role="group" aria-label="Comparação">
              <button
                type="button"
                className={compareMode === "before" ? "is-active" : ""}
                onClick={() => setCompareMode("before")}
              >
                Antes
              </button>
              <button
                type="button"
                className={compareMode === "after" ? "is-active" : ""}
                onClick={() => setCompareMode("after")}
              >
                Depois
              </button>
            </div>

            <section className="maono-review-operation">
              <div className="maono-review-operation__nav">
                <button
                  type="button"
                  aria-label="Operação anterior"
                  disabled={selectedIndex <= 0}
                  onClick={() => selectIndex(selectedIndex - 1)}
                >
                  ‹
                </button>
                <strong>
                  {operations.length
                    ? `Operação ${selectedIndex + 1} de ${operations.length}`
                    : "Sem operação disponível"}
                </strong>
                <button
                  type="button"
                  aria-label="Próxima operação"
                  disabled={selectedIndex >= operations.length - 1}
                  onClick={() => selectIndex(selectedIndex + 1)}
                >
                  ›
                </button>
              </div>

              {summary ? (
                <div className="maono-review-operation__details">
                  <h2>{summary.title}</h2>
                  <span>Camada: {summary.target}</span>
                  <span>Lat: {summary.latitude.toFixed(6)}</span>
                  <span>Lng: {summary.longitude.toFixed(6)}</span>
                  <div className="maono-review-properties">
                    {summary.properties.length ? (
                      summary.properties.map(([key, value]) => (
                        <div key={key}>
                          <small>{key}</small>
                          <span>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</span>
                        </div>
                      ))
                    ) : (
                      <span>Sem atributos adicionais.</span>
                    )}
                  </div>
                  <button type="button" onClick={() => focusOperation(selected)}>
                    Focar no mapa
                  </button>
                </div>
              ) : null}
            </section>

            <div className="maono-review-reason">
              <small>Motivo enviado</small>
              <p>{review.changeRequest.reason}</p>
            </div>

            <footer className="maono-review-actions">
              <button
                type="button"
                disabled={!review.permissions.canReject || busy}
                onClick={() => setRejectOpen(true)}
              >
                Rejeitar
              </button>
              <button
                type="button"
                disabled={!review.permissions.canApprove || busy}
                onClick={() => void approve()}
              >
                Aprovar
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!review.permissions.canApply || busy}
                onClick={() => void apply()}
              >
                {busy ? "Processando…" : "Aprovar e aplicar"}
              </button>
            </footer>
          </div>
        ) : null}
      </aside>

      {toast ? <div className="maono-review-toast" role="status">{toast}</div> : null}

      {rejectOpen ? (
        <div className="maono-review-dialog-backdrop" role="presentation">
          <section className="maono-review-dialog" role="dialog" aria-modal="true">
            <h2>Rejeitar solicitação</h2>
            <p>Informe o motivo. O conteúdo enviado pelo Viewer permanecerá imutável.</p>
            <textarea
              autoFocus
              maxLength={2000}
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="Motivo da rejeição"
            />
            <div>
              <button type="button" disabled={busy} onClick={() => setRejectOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy || !rejectComment.trim()}
                onClick={() => void reject()}
              >
                Confirmar rejeição
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export default function ChangeRequestReviewPage() {
  const { projectSlug = "", changeRequestId = "" } = useParams<{
    projectSlug: string;
    changeRequestId: string;
  }>();

  useEffect(() => {
    document.body.classList.add("maono-review-workspace-active");
    return () => document.body.classList.remove("maono-review-workspace-active");
  }, []);

  if (!projectSlug || !changeRequestId) {
    return <main className="maono-review-route-error">Review inválido.</main>;
  }

  return (
    <main className="maono-review-page">
      <KeplerApp />
      <ReviewWorkspaceOverlay
        projectSlug={projectSlug}
        changeRequestId={changeRequestId}
      />
    </main>
  );
}
