import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  layerConfigChange,
  layerVisConfigChange,
  updateMap,
  wrapTo,
} from "@kepler.gl/actions";
import { useDispatch, useSelector, useStore } from "react-redux";
import { Link, useParams } from "react-router";

import KeplerApp from "../index";
import {
  markerOriginToScreen,
  type MapCanvasRect,
} from "../components/map-overlay/marker-projection";
import {
  KEPLER_MAP_ID,
  findRawLayer,
  normalizeKeplerViewport,
  readValue,
  selectKeplerViewportState,
} from "../engine-adapter/selectors";
import type { MapViewportSummary } from "../engine-adapter/types";
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

type StyleSnapshot = Partial<{
  fixedColor: [number, number, number] | null;
  opacity: number | null;
  fillEnabled: boolean | null;
  strokeEnabled: boolean | null;
  strokeColor: [number, number, number] | null;
  strokeOpacity: number | null;
  strokeWidth: number | null;
  pointRadius: number | null;
  clusterRadius: number | null;
  heatmapRadius: number | null;
}>;

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação de Review.";
}

function mapSurfaceRect(): MapCanvasRect | null {
  const node = document.querySelector<HTMLElement>(".maono-kepler-viewport");
  const rect = node?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function styleSnapshot(
  operation: ReviewOperationProjection,
  mode: "before" | "after",
): StyleSnapshot | null {
  if (operation.type !== "layer.style.update") return null;
  const properties = record(operation.properties);
  return record(properties?.[mode]) as StyleSnapshot | null;
}

function operationSummary(operation: ReviewOperationProjection | null) {
  if (!operation) return null;
  const style = operation.type === "layer.style.update";
  return {
    type: operation.type,
    title: style ? "Alterar estilo" : "Criar ponto",
    target:
      operation.target.label || operation.target.layerId || "Camada de destino",
    focus: operation.focus,
    properties: style ? [] : Object.entries(operation.properties || {}),
    before: style ? styleSnapshot(operation, "before") : null,
    after: style ? styleSnapshot(operation, "after") : null,
  };
}

function displayStyleValue(value: unknown) {
  if (Array.isArray(value) && value.length === 3) {
    return `rgb(${value.join(", ")})`;
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (value === null || value === undefined) return "—";
  return String(value);
}

function styleRows(before: StyleSnapshot | null, after: StyleSnapshot | null) {
  const keys = Array.from(
    new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
  );
  return keys.filter(
    (key) =>
      JSON.stringify((before as Record<string, unknown> | null)?.[key]) !==
      JSON.stringify((after as Record<string, unknown> | null)?.[key]),
  );
}

function applyReviewStyleSnapshot(
  dispatch: ReturnType<typeof useDispatch>,
  rootState: unknown,
  operation: ReviewOperationProjection,
  mode: "before" | "after",
) {
  if (operation.type !== "layer.style.update" || !operation.target.layerId) {
    return;
  }
  const snapshot = styleSnapshot(operation, mode);
  if (!snapshot) return;
  const layer = findRawLayer(rootState, operation.target.layerId);
  if (!layer) return;

  if (snapshot.fixedColor) {
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        layerConfigChange(layer, { color: snapshot.fixedColor }),
      ),
    );
  }

  const visPatch: Record<string, unknown> = {};
  if (snapshot.opacity != null) visPatch.opacity = snapshot.opacity;
  if (snapshot.fillEnabled != null) visPatch.filled = snapshot.fillEnabled;
  if (snapshot.strokeEnabled != null) {
    const layerType = String(readValue(layer, "type") || "").toLowerCase();
    visPatch[layerType === "point" ? "outline" : "stroked"] =
      snapshot.strokeEnabled;
  }
  if (snapshot.strokeColor) {
    visPatch.strokeColor = snapshot.strokeColor;
  }
  if (snapshot.strokeOpacity != null) {
    visPatch.strokeOpacity = snapshot.strokeOpacity;
  }
  if (snapshot.strokeWidth != null) visPatch.thickness = snapshot.strokeWidth;
  if (snapshot.pointRadius != null) visPatch.radius = snapshot.pointRadius;
  if (snapshot.clusterRadius != null) {
    visPatch.clusterRadius = snapshot.clusterRadius;
  }
  if (snapshot.heatmapRadius != null) {
    visPatch.heatmapRadius = snapshot.heatmapRadius;
  }
  if (Object.keys(visPatch).length) {
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        layerVisConfigChange(layer, visPatch as Parameters<typeof layerVisConfigChange>[1]),
      ),
    );
  }
}

function ReviewMarkerLayer({
  operations,
  selectedId,
  visible,
  viewport,
}: {
  operations: ReviewOperationProjection[];
  selectedId: string | null;
  visible: boolean;
  viewport: MapViewportSummary | null;
}) {
  const [points, setPoints] = useState<ProjectedPoint[]>([]);

  const refresh = useCallback(() => {
    if (!visible || !viewport) {
      setPoints([]);
      return;
    }
    const rect = mapSurfaceRect();
    if (!rect) return;
    const next = operations.flatMap((operation) => {
      if (operation.overlay?.kind !== "point") return [];
      const position = markerOriginToScreen(
        {
          latitude: operation.overlay.latitude,
          longitude: operation.overlay.longitude,
        },
        rect,
        viewport,
      );
      return position
        ? [{ id: operation.id, left: position.left, top: position.top }]
        : [];
    });
    setPoints(next);
  }, [operations, viewport, visible]);

  useEffect(() => {
    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("maono:map-runtime", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("maono:map-runtime", refresh);
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
  const dispatch = useDispatch();
  const store = useStore();
  const viewport = useSelector((state: any) =>
    normalizeKeplerViewport(selectKeplerViewportState(state)),
  );
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

  useEffect(() => {
    if (!operations.length) return;
    for (const operation of operations) {
      applyReviewStyleSnapshot(dispatch, store.getState(), operation, compareMode);
    }
  }, [compareMode, dispatch, operations, store]);

  const selected = operations[selectedIndex] || null;
  const summary = useMemo(() => operationSummary(selected), [selected]);

  const focusOperation = useCallback(
    (operation: ReviewOperationProjection | null) => {
      if (!operation?.focus) return;
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          updateMap({
            longitude: operation.focus.longitude,
            latitude: operation.focus.latitude,
            zoom: Math.max(Number(viewport?.zoom ?? 0), 12),
          }),
        ),
      );
    },
    [dispatch, viewport?.zoom],
  );

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
        setReview(
          await getProjectChangeReview(projectSlug, changeRequestId, {
            force: true,
          }),
        );
      } catch {
        // Mantém o erro principal; refresh é best-effort.
      }
    } finally {
      setBusy(false);
    }
  }

  const changedStyleKeys = summary
    ? styleRows(summary.before, summary.after)
    : [];

  return (
    <>
      <ReviewMarkerLayer
        operations={operations}
        selectedId={selected?.id || null}
        visible={compareMode === "after"}
        viewport={viewport}
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
                <small>
                  A aplicação automática foi bloqueada para não sobrescrever alterações mais recentes.
                </small>
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
                  {summary.focus ? (
                    <>
                      <span>Lat: {summary.focus.latitude.toFixed(6)}</span>
                      <span>Lng: {summary.focus.longitude.toFixed(6)}</span>
                    </>
                  ) : null}

                  {summary.type === "layer.style.update" ? (
                    <div className="maono-review-properties">
                      {changedStyleKeys.length ? (
                        changedStyleKeys.map((key) => (
                          <div key={key}>
                            <small>{key}</small>
                            <span>
                              Antes: {displayStyleValue(
                                (summary.before as Record<string, unknown> | null)?.[key],
                              )}
                            </span>
                            <span>
                              Depois: {displayStyleValue(
                                (summary.after as Record<string, unknown> | null)?.[key],
                              )}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span>Sem diferença visual efetiva.</span>
                      )}
                    </div>
                  ) : (
                    <div className="maono-review-properties">
                      {summary.properties.length ? (
                        summary.properties.map(([key, value]) => (
                          <div key={key}>
                            <small>{key}</small>
                            <span>
                              {typeof value === "object"
                                ? JSON.stringify(value)
                                : String(value ?? "")}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span>Sem atributos adicionais.</span>
                      )}
                    </div>
                  )}

                  {summary.focus ? (
                    <button type="button" onClick={() => focusOperation(selected)}>
                      Focar no mapa
                    </button>
                  ) : null}
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

      {toast ? (
        <div className="maono-review-toast" role="status">{toast}</div>
      ) : null}

      {rejectOpen ? (
        <div className="maono-review-dialog-backdrop" role="presentation">
          <section className="maono-review-dialog" role="dialog" aria-modal="true">
            <h2>Rejeitar solicitação</h2>
            <p>
              Informe o motivo. O conteúdo enviado pelo Viewer permanecerá imutável.
            </p>
            <textarea
              autoFocus
              maxLength={2000}
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="Motivo da rejeição"
            />
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejectOpen(false)}
              >
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
