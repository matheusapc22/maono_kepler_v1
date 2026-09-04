import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useSession } from "../../../auth/session";
import { useKeplerEngineAdapter } from "../engine-adapter";
import {
  type PointDatasetTarget,
  usePointDatasetCommand,
} from "../engine-adapter/usePointDatasetCommand";
import { useMapPanel } from "../map-panel/MapPanelContext";
import { MAONO_CREATE_POINT_FROM_MARKER_EVENT } from "../components/map-overlay/MarkerContextMenu";
import {
  markerOriginToScreen,
  screenToMarkerOrigin,
  type MapCanvasRect,
  type MarkerOrigin,
} from "../components/map-overlay/marker-projection";
import { submitProjectChangeRequest } from "./change-request-api";
import {
  ViewerWorkingCopyStore,
  type ViewerChangeOperation,
  type ViewerWorkingCopy,
} from "./viewer-working-copy";
import "./point-from-pin.css";

const NEW_TARGET_KEY = "__maono_new_point_layer__";
const MAP_SURFACE_SELECTORS = [
  "#default-deckgl-overlay-wrapper",
  "#default-deckgl-overlay",
  ".maplibregl-canvas",
  ".mapboxgl-canvas",
  ".maono-kepler-viewport canvas",
  ".maono-kepler-viewport",
] as const;

type PointOperationPayload = {
  tempId: string;
  latitude: number;
  longitude: number;
  targetLayerId: string | null;
  targetDataId: string | null;
  targetLabel: string;
  fieldMap: PointDatasetTarget["fieldMap"];
  properties: {
    name: string;
    type?: string;
    description?: string;
  };
  origin: "pin";
};

type PointTargetOption = PointDatasetTarget & { key: string };

function normalizedFieldName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function optionalField(
  fields: Array<{ name: string }>,
  candidates: string[],
) {
  const wanted = new Set(candidates.map(normalizedFieldName));
  return (
    fields.find((field) => wanted.has(normalizedFieldName(field.name)))?.name ??
    null
  );
}

function mapSurfaceRect(): MapCanvasRect | null {
  for (const selector of MAP_SURFACE_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  return null;
}

function pointPayload(operation: ViewerChangeOperation) {
  if (operation.type !== "point.create") return null;
  const payload = operation.payload as PointOperationPayload | null;
  if (
    !payload ||
    !Number.isFinite(Number(payload.latitude)) ||
    !Number.isFinite(Number(payload.longitude))
  ) {
    return null;
  }
  return payload;
}

function operationLabel(operation: ViewerChangeOperation) {
  const payload = pointPayload(operation);
  if (!payload) return "Alteração local";
  return payload.properties.name || "Novo ponto";
}

export default function PointFromPinWorkflow() {
  const { user } = useSession();
  const { context } = useMapPanel();
  const { state: engineState } = useKeplerEngineAdapter();
  const createDatasetPoint = usePointDatasetCommand();
  const viewerEnabled = Boolean(
    context?.mode === "viewer" &&
      context.capabilities.requestProjectChange === true,
  );
  const baseRevision = Number(
    context?.version ?? context?.project?.configRevision ?? 0,
  );
  const [canvasRect, setCanvasRect] = useState<MapCanvasRect | null>(null);
  const [dialogOrigin, setDialogOrigin] = useState<MarkerOrigin | null>(null);
  const [targetKey, setTargetKey] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [workingCopy, setWorkingCopy] = useState<ViewerWorkingCopy | null>(null);
  const [stale, setStale] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const targets = useMemo<PointTargetOption[]>(() => {
    const datasets = new Map(engineState.datasets.map((dataset) => [dataset.id, dataset]));
    const compatible = engineState.layers.flatMap((layer) => {
      const dataId = layer.dataIds[0] ?? null;
      const dataset = dataId ? datasets.get(dataId) : null;
      const managedType = layer.structure.managedType || layer.type;
      if (
        !dataId ||
        !dataset ||
        layer.dataIds.length !== 1 ||
        !["point", "cluster", "heatmap"].includes(managedType) ||
        !layer.columns.latitude ||
        !layer.columns.longitude ||
        dataset.status === "error"
      ) {
        return [];
      }

      return [
        {
          key: layer.id,
          dataId,
          layerId: layer.id,
          label: layer.label,
          fieldMap: {
            latitude: layer.columns.latitude,
            longitude: layer.columns.longitude,
            name: optionalField(dataset.fields, ["name", "nome", "title", "titulo", "título"]),
            type: optionalField(dataset.fields, ["type", "tipo", "category", "categoria"]),
            description: optionalField(dataset.fields, ["description", "descricao", "descrição"]),
            id: optionalField(dataset.fields, ["maono_point_id"]),
          },
        },
      ];
    });

    if (context?.capabilities.createLayer === true) {
      compatible.push({
        key: NEW_TARGET_KEY,
        dataId: null,
        layerId: null,
        label: "Pontos adicionados",
        createNew: true,
        fieldMap: {
          latitude: "latitude",
          longitude: "longitude",
          name: "name",
          type: "type",
          description: "description",
          id: "maono_point_id",
        },
      });
    }

    return compatible;
  }, [context?.capabilities.createLayer, engineState.datasets, engineState.layers]);

  const store = useMemo(() => {
    if (
      !viewerEnabled ||
      !context?.organization?.id ||
      !context?.project?.id ||
      !context.project.slug ||
      !user?.id
    ) {
      return null;
    }
    return new ViewerWorkingCopyStore({
      organizationId: context.organization.id,
      projectId: context.project.id,
      projectSlug: context.project.slug,
      userId: user.id,
    });
  }, [
    context?.organization?.id,
    context?.project?.id,
    context?.project?.slug,
    user?.id,
    viewerEnabled,
  ]);

  const refreshCanvasRect = useCallback(() => {
    if (typeof document === "undefined") return;
    setCanvasRect(mapSurfaceRect());
  }, []);

  useEffect(() => {
    refreshCanvasRect();
    window.addEventListener("resize", refreshCanvasRect);
    window.addEventListener("scroll", refreshCanvasRect, true);
    window.addEventListener("maono:map-runtime", refreshCanvasRect);
    return () => {
      window.removeEventListener("resize", refreshCanvasRect);
      window.removeEventListener("scroll", refreshCanvasRect, true);
      window.removeEventListener("maono:map-runtime", refreshCanvasRect);
    };
  }, [refreshCanvasRect]);

  useEffect(() => {
    let cancelled = false;
    setWorkingCopy(null);
    setStale(false);
    if (!store) return undefined;

    store
      .load()
      .then((value) => {
        if (cancelled) return;
        setWorkingCopy(value);
        setStale(Boolean(value && value.baseRevision !== baseRevision));
      })
      .catch(() => {
        if (!cancelled) setSubmitError("Não foi possível restaurar as alterações locais.");
      });

    return () => {
      cancelled = true;
    };
  }, [baseRevision, store]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    function openPointDialog() {
      if (
        !context ||
        !engineState.ready ||
        context.capabilities.placeAnalysisMarker !== true
      ) {
        return;
      }
      const marker = document.querySelector<HTMLElement>(".maono-map-marker");
      const rect = mapSurfaceRect();
      const left = Number.parseFloat(marker?.style.left || "");
      const top = Number.parseFloat(marker?.style.top || "");
      const origin =
        Number.isFinite(left) && Number.isFinite(top)
          ? screenToMarkerOrigin(left, top, rect, engineState.viewport)
          : null;
      if (!origin) {
        setToast("Não foi possível determinar a posição atual do marcador.");
        return;
      }

      setCanvasRect(rect);
      setDialogOrigin(origin);
      setTargetKey(targets[0]?.key || "");
      setName("");
      setType("");
      setDescription("");
      setDialogError(null);
    }

    window.addEventListener(
      MAONO_CREATE_POINT_FROM_MARKER_EVENT,
      openPointDialog,
    );
    return () => {
      window.removeEventListener(
        MAONO_CREATE_POINT_FROM_MARKER_EVENT,
        openPointDialog,
      );
    };
  }, [context, engineState.ready, engineState.viewport, targets]);

  function closeDialog() {
    setDialogOrigin(null);
    setDialogError(null);
  }

  async function createPoint() {
    if (!dialogOrigin || !name.trim()) {
      setDialogError("Informe um nome para o ponto.");
      return;
    }
    const target = targets.find((item) => item.key === targetKey);
    if (!target) {
      setDialogError(
        viewerEnabled
          ? "Não há camada de pontos existente disponível para receber a proposta."
          : "Selecione uma camada para receber o ponto.",
      );
      return;
    }

    const tempId = `tmp_${crypto.randomUUID()}`;
    const properties = {
      name: name.trim(),
      type: type.trim(),
      description: description.trim(),
    };

    if (viewerEnabled) {
      if (!store) {
        setDialogError("O workspace local do Viewer não está disponível.");
        return;
      }
      if (stale) {
        setDialogError("O projeto mudou desde o início destas alterações locais.");
        return;
      }
      try {
        const operation: ViewerChangeOperation = {
          id: `op_${crypto.randomUUID()}`,
          type: "point.create",
          version: 1,
          payload: {
            tempId,
            latitude: dialogOrigin.latitude,
            longitude: dialogOrigin.longitude,
            targetLayerId: target.layerId,
            targetDataId: target.dataId,
            targetLabel: target.label,
            fieldMap: target.fieldMap,
            properties,
            origin: "pin",
          } satisfies PointOperationPayload,
          createdAt: new Date().toISOString(),
        };
        const next = await store.appendOperation(baseRevision, operation);
        setWorkingCopy(next);
        setToast("Ponto adicionado às alterações locais do Viewer.");
        closeDialog();
      } catch (error) {
        if ((error as any)?.code === "WORKING_COPY_BASE_REVISION_STALE") {
          setStale(true);
          setDialogError("O projeto mudou desde o início destas alterações locais.");
        } else {
          setDialogError("Não foi possível guardar o ponto no workspace local.");
        }
      }
      return;
    }

    const result = createDatasetPoint({
      target,
      latitude: dialogOrigin.latitude,
      longitude: dialogOrigin.longitude,
      tempId,
      properties,
    });
    if (!result.ok) {
      setDialogError(result.reason);
      return;
    }
    setToast(
      context?.mode === "create"
        ? "Ponto adicionado ao projeto em criação."
        : "Ponto adicionado ao mapa. Salve o projeto para persistir.",
    );
    closeDialog();
  }

  function openDrawer() {
    const ids = workingCopy?.operations.map((operation) => operation.id) || [];
    setSelectedIds(ids);
    setReason("");
    setSubmitError(null);
    setDrawerOpen(true);
  }

  function toggleSelected(operationId: string) {
    setSelectedIds((current) =>
      current.includes(operationId)
        ? current.filter((id) => id !== operationId)
        : [...current, operationId],
    );
  }

  async function submitSelected() {
    if (
      !store ||
      !workingCopy ||
      !context?.project?.slug ||
      submitting ||
      stale ||
      engineState.hasUnsavedChanges
    ) {
      return;
    }
    const selected = workingCopy.operations.filter((operation) =>
      selectedIds.includes(operation.id),
    );
    if (!selected.length) {
      setSubmitError("Selecione pelo menos uma alteração.");
      return;
    }
    if (!reason.trim()) {
      setSubmitError("Informe o motivo da solicitação.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await store.assertCurrentRevision(baseRevision);
      const result = await submitProjectChangeRequest(context.project.slug, {
        baseRevision,
        reason: reason.trim(),
        operations: selected,
        idempotencyKey: workingCopy.submissionKey,
      });
      const next = await store.completeSubmission(selected.map((item) => item.id));
      setWorkingCopy(next);
      setSelectedIds([]);
      setReason("");
      setDrawerOpen(false);
      setToast(
        result.changeRequest.ticketId
          ? "Solicitação enviada e chamado criado para revisão."
          : "Solicitação enviada para revisão.",
      );
    } catch (error) {
      const code = String((error as any)?.code || "");
      if (
        code === "WORKING_COPY_BASE_REVISION_STALE" ||
        code === "CHANGE_REQUEST_BASE_REVISION_STALE"
      ) {
        setStale(true);
        setSubmitError(
          "O projeto mudou desde o início destas alterações. As alterações locais foram preservadas.",
        );
      } else {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Não foi possível enviar a solicitação.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!context || typeof document === "undefined") return null;

  const selectedTarget = targets.find((item) => item.key === targetKey) || null;
  const operations = workingCopy?.operations || [];
  const proposed = operations
    .map((operation) => ({ operation, payload: pointPayload(operation) }))
    .filter((item): item is { operation: ViewerChangeOperation; payload: PointOperationPayload } =>
      Boolean(item.payload),
    );
  const untrackedViewerChanges = viewerEnabled && engineState.hasUnsavedChanges;

  return createPortal(
    <>
      {viewerEnabled && canvasRect && engineState.viewport
        ? proposed.map(({ operation, payload }) => {
            const position = markerOriginToScreen(
              {
                latitude: payload.latitude,
                longitude: payload.longitude,
              },
              canvasRect,
              engineState.viewport,
            );
            return position ? (
              <span
                key={operation.id}
                className="maono-proposed-point"
                style={{ left: position.left, top: position.top }}
                title={`Ponto proposto: ${payload.properties.name}`}
                aria-hidden="true"
              />
            ) : null;
          })
        : null}

      {dialogOrigin ? (
        <div className="maono-point-dialog__backdrop" role="presentation">
          <section
            className="maono-point-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="maono-point-dialog-title"
          >
            <header>
              <div>
                <small>Point-from-Pin</small>
                <h2 id="maono-point-dialog-title">Criar ponto</h2>
              </div>
              <button type="button" onClick={closeDialog} aria-label="Fechar">
                ×
              </button>
            </header>
            <div className="maono-point-dialog__body">
              <label>
                <span>Nome *</span>
                <input
                  value={name}
                  maxLength={160}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                <span>Tipo</span>
                <input
                  value={type}
                  maxLength={120}
                  onChange={(event) => setType(event.target.value)}
                />
              </label>
              <label>
                <span>Camada *</span>
                <select
                  value={targetKey}
                  onChange={(event) => setTargetKey(event.target.value)}
                >
                  {!targets.length ? (
                    <option value="">Nenhuma camada de pontos disponível</option>
                  ) : null}
                  {targets.map((target) => (
                    <option key={target.key} value={target.key}>
                      {target.createNew ? "+ Nova camada de pontos" : target.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Descrição</span>
                <textarea
                  value={description}
                  maxLength={1000}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="maono-point-dialog__coordinates">
                <span>Lat: {dialogOrigin.latitude.toFixed(6)}</span>
                <span>Lng: {dialogOrigin.longitude.toFixed(6)}</span>
                {selectedTarget ? <span>Camada: {selectedTarget.label}</span> : null}
              </div>
              {viewerEnabled && !targets.length ? (
                <p className="maono-point-dialog__error" role="alert">
                  Um Editor precisa adicionar uma fonte de pontos antes que o Viewer possa propor pontos nesta versão.
                </p>
              ) : null}
              {dialogError ? (
                <p className="maono-point-dialog__error" role="alert">
                  {dialogError}
                </p>
              ) : null}
            </div>
            <footer>
              <button type="button" onClick={closeDialog}>Cancelar</button>
              <button
                type="button"
                className="is-primary"
                onClick={() => void createPoint()}
                disabled={!name.trim() || !selectedTarget || stale}
              >
                Criar ponto
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {viewerEnabled && operations.length ? (
        <div className="maono-change-request__bar" role="status">
          <div className="maono-change-request__bar-copy">
            <strong>Alterações locais — não salvas</strong>
            <span>
              {operations.length} {operations.length === 1 ? "alteração" : "alterações"}
              {stale ? " · revisão desatualizada" : ""}
            </span>
          </div>
          <button type="button" onClick={openDrawer}>
            Solicitar salvamento
          </button>
        </div>
      ) : null}

      {viewerEnabled && drawerOpen && workingCopy ? (
        <div
          className="maono-change-request__backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !submitting) {
              setDrawerOpen(false);
            }
          }}
        >
          <section
            className="maono-change-request__drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="maono-change-request-title"
          >
            <header>
              <div>
                <small>Viewer</small>
                <h2 id="maono-change-request-title">Solicitar salvamento</h2>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDrawerOpen(false)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>
            <div className="maono-change-request__body">
              <div className="maono-change-request__summary">
                <strong>Resumo</strong>
                <span>{selectedIds.length} de {workingCopy.operations.length} selecionadas</span>
              </div>

              {stale ? (
                <p className="maono-change-request__warning" role="alert">
                  O projeto mudou desde o início destas alterações. A Working Copy foi preservada, mas precisa ser revista antes do envio.
                </p>
              ) : null}
              {untrackedViewerChanges ? (
                <p className="maono-change-request__warning" role="alert">
                  Existem outras alterações locais do mapa que ainda não possuem contrato de Change Request. O envio fica bloqueado para evitar perda silenciosa.
                </p>
              ) : null}

              <div className="maono-change-request__operations">
                {workingCopy.operations.map((operation) => {
                  const payload = pointPayload(operation);
                  return (
                    <label key={operation.id} className="maono-change-request__operation">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(operation.id)}
                        disabled={submitting}
                        onChange={() => toggleSelected(operation.id)}
                      />
                      <span>
                        <strong>Criar ponto — {operationLabel(operation)}</strong>
                        <span>{payload?.targetLabel || "Camada de destino"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <label className="maono-change-request__reason">
                <span>Motivo *</span>
                <textarea
                  value={reason}
                  maxLength={2000}
                  disabled={submitting}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explique por que estas alterações devem ser aplicadas."
                />
              </label>

              {submitError ? (
                <p className="maono-change-request__error" role="alert">
                  {submitError}
                </p>
              ) : null}
            </div>
            <footer>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDrawerOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={
                  submitting ||
                  stale ||
                  untrackedViewerChanges ||
                  !selectedIds.length ||
                  !reason.trim()
                }
                onClick={() => void submitSelected()}
              >
                {submitting ? "Enviando…" : "Enviar solicitação"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className="maono-point-workflow__toast" role="status">
          {toast}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
