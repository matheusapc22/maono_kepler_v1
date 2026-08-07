import { useEffect, useState } from "react";

import type { KeplerCommandResult, MapLayerColumns } from "../../engine-adapter";
import { useDatasetCsvExport } from "../../engine-adapter/dataset-csv-export.ts";
import { useKeplerController } from "../../hooks/useKeplerController";
import { useKeplerState } from "../../hooks/useKeplerState";
import type {
  MaonoDatasetSnapshot,
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import {
  MAONO_MAP_PANEL_TAB_REQUEST_EVENT,
  mapPanelTabFromEvent,
  notifyMaonoMapPanelTabChanged,
  type MaonoMapPanelTab,
} from "../maono-map-shell/map-shell-events";
import AddLayerMenu from "./AddLayerMenu";
import FilterPanel from "./FilterPanel";
import LayerDetailView from "./LayerDetailView";
import LayerList from "./LayerList";
import LayerPanelIcon from "./LayerPanelIcon";
import PanelSaveAction from "./PanelSaveAction";
import type { LayerStyleChange } from "./LayerStyleEditor";
import "./maono-layer-panel.css";

type PanelNotice = {
  kind: "error" | "success";
  message: string;
};

type PanelView =
  | { kind: "list" }
  | { kind: "layer"; layerId: string };

function modeLabel(mode: "viewer" | "editor" | "create" | undefined) {
  return mode === "viewer"
    ? "Somente leitura"
    : mode === "create"
      ? "Novo mapa"
      : "Edição";
}

export default function MaonoLayerPanel() {
  const { context } = useMapPanel();
  const {
    basemap,
    datasets,
    error,
    filters,
    isLoading,
    layers,
    selectedLayerId,
  } = useKeplerState();
  const controller = useKeplerController();
  const exportDatasetCsv = useDatasetCsvExport();
  const [tab, setTab] = useState<MaonoMapPanelTab>("layers");
  const [view, setView] = useState<PanelView>({ kind: "list" });
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const capabilities = context?.capabilities;
  const canViewLayers = capabilities?.viewLayers === true;
  const canViewFilters = capabilities?.viewFilters === true;
  const canInspect = capabilities?.inspectLayer === true;
  const canRename = capabilities?.editLayers === true;
  const canEditStructure = capabilities?.editLayers === true;
  const canEditStyle = capabilities?.editLayerStyle === true;
  const activeLayer =
    view.kind === "layer"
      ? layers.find((layer) => layer.id === view.layerId) ?? null
      : null;
  const showSearch = layers.length >= 8 || Boolean(search);

  useEffect(() => {
    if (tab === "layers" && !canViewLayers && canViewFilters) {
      setTab("filters");
      setView({ kind: "list" });
      notifyMaonoMapPanelTabChanged("filters");
    } else if (tab === "filters" && !canViewFilters && canViewLayers) {
      setTab("layers");
      setView({ kind: "list" });
      notifyMaonoMapPanelTabChanged("layers");
    }
  }, [canViewFilters, canViewLayers, tab]);

  useEffect(() => {
    function handleRequestedTab(event: Event) {
      const requestedTab = mapPanelTabFromEvent(event);
      const allowed =
        requestedTab === "layers"
          ? canViewLayers
          : requestedTab === "filters"
            ? canViewFilters
            : false;

      if (requestedTab && allowed) {
        setTab(requestedTab);
        setView({ kind: "list" });
        notifyMaonoMapPanelTabChanged(requestedTab);
      }
    }

    window.addEventListener(
      MAONO_MAP_PANEL_TAB_REQUEST_EVENT,
      handleRequestedTab,
    );
    return () => {
      window.removeEventListener(
        MAONO_MAP_PANEL_TAB_REQUEST_EVENT,
        handleRequestedTab,
      );
    };
  }, [canViewFilters, canViewLayers]);

  useEffect(() => {
    if (!canViewLayers || !canInspect || !layers.length) return;
    const selectedStillExists =
      selectedLayerId !== null &&
      layers.some((layer) => layer.id === selectedLayerId);
    if (!selectedStillExists) {
      applyCommand(controller.inspectLayer(layers[0].id));
    }
  }, [canInspect, canViewLayers, controller, layers, selectedLayerId]);

  useEffect(() => {
    if (view.kind === "layer" && !activeLayer) {
      setView({ kind: "list" });
    }
  }, [activeLayer, view.kind]);

  useEffect(() => {
    if (notice?.kind !== "success") return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 2_500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function selectTab(nextTab: MaonoMapPanelTab) {
    const allowed = nextTab === "layers" ? canViewLayers : canViewFilters;
    if (!allowed) return;

    setTab(nextTab);
    setView({ kind: "list" });
    setNotice(null);
    notifyMaonoMapPanelTabChanged(nextTab);
  }

  function applyCommand<T>(
    result: KeplerCommandResult<T>,
    successMessage?: string,
    onSuccess?: (value: T | undefined) => void,
  ) {
    if (!result.ok) {
      setNotice({ kind: "error", message: result.reason });
      return false;
    }

    onSuccess?.(result.value);
    setNotice(
      result.changed && successMessage
        ? { kind: "success", message: successMessage }
        : null,
    );
    return true;
  }

  function openLayer(layer: MaonoLayerSnapshot) {
    if (applyCommand(controller.inspectLayer(layer.id))) {
      setView({ kind: "layer", layerId: layer.id });
    }
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    const index = layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) return;

    const order = layers.map((layer) => layer.id);
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    applyCommand(controller.reorderLayers(order), "Ordem das camadas atualizada.");
  }

  function moveLayerTo(layerId: string, position: "start" | "end") {
    const order = layers.map((layer) => layer.id);
    const index = order.indexOf(layerId);
    if (index < 0) return;
    order.splice(index, 1);
    if (position === "start") order.unshift(layerId);
    else order.push(layerId);
    applyCommand(controller.reorderLayers(order), "Ordem das camadas atualizada.");
  }

  function reorderLayer(draggedLayerId: string, targetLayerId: string) {
    const order = layers.map((layer) => layer.id);
    const draggedIndex = order.indexOf(draggedLayerId);
    const targetIndex = order.indexOf(targetLayerId);
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return;

    const [movedLayerId] = order.splice(draggedIndex, 1);
    order.splice(targetIndex, 0, movedLayerId);
    applyCommand(controller.reorderLayers(order), "Ordem das camadas atualizada.");
  }

  function renameLayer(layer: MaonoLayerSnapshot, label: string) {
    return applyCommand(
      controller.updateLayerLabel(layer, label),
      "Camada renomeada.",
    );
  }

  function duplicateLayer(layer: MaonoLayerSnapshot) {
    applyCommand(
      controller.duplicateLayer(layer.id),
      "Camada duplicada.",
      (value) => {
        if (value?.layerId) {
          setView({ kind: "layer", layerId: value.layerId });
        }
      },
    );
  }

  function removeLayer(layer: MaonoLayerSnapshot) {
    if (
      !window.confirm(
        `Remover a camada “${layer.label}”? Esta alteração será efetivada ao salvar o mapa.`,
      )
    ) {
      return;
    }

    if (applyCommand(controller.removeLayer(layer.id), "Camada removida.")) {
      if (view.kind === "layer" && view.layerId === layer.id) {
        setView({ kind: "list" });
      }
    }
  }

  function createLayer(dataset: MaonoDatasetSnapshot) {
    return applyCommand(
      controller.createLayerFromDataset({
        datasetId: dataset.id,
        label: dataset.label,
      }),
      "Camada adicionada.",
      (value) => {
        if (value?.layerId) {
          applyCommand(controller.inspectLayer(value.layerId));
          setView({ kind: "layer", layerId: value.layerId });
        }
      },
    );
  }

  function openDataImport() {
    return applyCommand(controller.openAddDataModal());
  }

  function associateLayerDataset(layer: MaonoLayerSnapshot, datasetId: string) {
    return applyCommand(
      controller.associateLayerDataset(layer.id, datasetId),
      "Dataset da camada atualizado.",
    );
  }

  function updateLayerColumns(
    layer: MaonoLayerSnapshot,
    columns: Partial<MapLayerColumns>,
  ) {
    return applyCommand(
      controller.setLayerColumns(layer.id, columns),
      "Campos geográficos atualizados.",
    );
  }

  function updateLayerStyle(layer: MaonoLayerSnapshot, change: LayerStyleChange) {
    switch (change.kind) {
      case "type":
        applyCommand(controller.setLayerType(layer.id, change.value));
        return;
      case "opacity":
        applyCommand(controller.setLayerOpacity(layer.id, change.value));
        return;
      case "fillEnabled":
        applyCommand(controller.setFillEnabled(layer.id, change.value));
        return;
      case "fillColor":
        applyCommand(controller.setFixedColor(layer.id, change.value));
        return;
      case "fillField":
        applyCommand(controller.setColorField(layer.id, change.value));
        return;
      case "fillScale":
        applyCommand(controller.setColorScale(layer.id, change.value));
        return;
      case "fillPalette":
        applyCommand(controller.setColorPalette(layer.id, change.value));
        return;
      case "strokeEnabled":
        applyCommand(controller.setStrokeEnabled(layer.id, change.value));
        return;
      case "strokeColor":
        applyCommand(controller.setStrokeColor(layer.id, change.value));
        return;
      case "strokeField":
        applyCommand(controller.setStrokeColorField(layer.id, change.value));
        return;
      case "strokeScale":
        applyCommand(controller.setStrokeColorScale(layer.id, change.value));
        return;
      case "strokePalette":
        applyCommand(controller.setStrokeColorPalette(layer.id, change.value));
        return;
      case "strokeOpacity":
        applyCommand(controller.setStrokeOpacity(layer.id, change.value));
        return;
      case "strokeWidth":
        applyCommand(controller.setStrokeWidth(layer.id, change.value));
        return;
      case "pointRadius":
        applyCommand(controller.setPointRadius(layer.id, change.value));
        return;
      case "clusterRadius":
        applyCommand(controller.setClusterOptions(layer.id, { radius: change.value }));
        return;
      case "heatmapRadius":
        applyCommand(controller.setHeatmapOptions(layer.id, { radius: change.value }));
        return;
      case "radiusField":
        applyCommand(controller.setRadiusField(layer.id, change.value));
        return;
      case "radiusRange":
        applyCommand(controller.setLayerRadiusRange(layer.id, change.value));
        return;
      case "layerBlending":
        applyCommand(controller.setLayerBlending(change.value));
        return;
      case "overlayBlending":
        applyCommand(controller.setOverlayBlending(change.value));
        return;
      default: {
        const exhaustiveChange: never = change;
        return exhaustiveChange;
      }
    }
  }

  function exportCsv(datasetId: string, label: string) {
    const result = exportDatasetCsv(datasetId, label);
    setNotice(
      result.ok
        ? {
            kind: "success",
            message: `${result.rowCount.toLocaleString("pt-BR")} registros exportados.`,
          }
        : { kind: "error", message: result.reason },
    );
  }

  function addFilter(dataId: string, fieldName: string) {
    const result = controller.addFilter(dataId);
    if (!applyCommand(result, "Filtro adicionado.")) return null;
    if (!result.ok || result.value?.index === undefined) return null;

    const index = result.value.index;
    if (result.value.fieldName !== fieldName) {
      applyCommand(
        controller.bindFilterField(index, dataId, fieldName),
        "Propriedade do filtro atualizada.",
      );
    }
    return index;
  }

  const tabCount = Number(canViewLayers) + Number(canViewFilters);
  const title = tab === "layers" ? "Camadas" : "Filtros";
  const count = tab === "layers" ? layers.length : filters.length;

  return (
    <aside
      id="maono-map-engine-panel"
      className="maono-layer-panel"
      data-panel-mode={context?.mode || "viewer"}
      data-active-tab={tab}
      data-view={view.kind}
      data-read-only={context?.mode === "viewer" ? "true" : "false"}
      aria-label="Controlador de camadas Maõno"
    >
      <header className="maono-layer-panel__header">
        <div>
          <strong>{title}</strong>
          <span>{count} {count === 1 ? "item" : "itens"}</span>
        </div>
        <span className="maono-layer-panel__mode">
          {context?.mode === "viewer" ? <LayerPanelIcon name="lock" /> : null}
          {modeLabel(context?.mode)}
        </span>
      </header>

      {tabCount ? (
        <nav
          className="maono-layer-panel__tabs"
          data-tab-count={tabCount}
          aria-label="Painéis do mapa"
          role="tablist"
        >
          {canViewLayers ? (
            <button
              type="button"
              id="maono-layers-tab"
              className={tab === "layers" ? "is-active" : ""}
              onClick={() => selectTab("layers")}
              aria-controls="maono-layers-panel"
              aria-selected={tab === "layers"}
              role="tab"
            >
              <LayerPanelIcon name="layers" />
              Camadas <span>{layers.length}</span>
            </button>
          ) : null}
          {canViewFilters ? (
            <button
              type="button"
              id="maono-filters-tab"
              className={tab === "filters" ? "is-active" : ""}
              onClick={() => selectTab("filters")}
              aria-controls="maono-filters-panel"
              aria-selected={tab === "filters"}
              role="tab"
            >
              <LayerPanelIcon name="filter" />
              Filtros <span>{filters.length}</span>
            </button>
          ) : null}
        </nav>
      ) : null}

      {notice ? (
        <div
          className={`maono-layer-panel__notice is-${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <LayerPanelIcon name={notice.kind === "error" ? "warning" : "check"} />
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">
            <LayerPanelIcon name="x" />
          </button>
        </div>
      ) : null}

      {!tabCount ? (
        <div className="maono-layer-panel__state is-error" role="alert">
          <LayerPanelIcon name="warning" />
          <strong>Painel indisponível</strong>
          <span>O servidor não concedeu acesso às camadas ou aos filtros deste mapa.</span>
        </div>
      ) : isLoading ? (
        <div className="maono-layer-panel__state is-loading" role="status">
          <span className="maono-layer-panel__spinner" aria-hidden="true" />
          <strong>Carregando configuração</strong>
          <span>Aguarde enquanto o Kepler prepara as camadas.</span>
        </div>
      ) : error ? (
        <div className="maono-layer-panel__state is-error" role="alert">
          <LayerPanelIcon name="warning" />
          <strong>Não foi possível carregar o painel</strong>
          <span>{error}</span>
        </div>
      ) : tab === "layers" && canViewLayers ? (
        <div
          id="maono-layers-panel"
          className="maono-layer-panel__body"
          role="tabpanel"
          aria-labelledby="maono-layers-tab"
        >
          {view.kind === "layer" && activeLayer ? (
            <LayerDetailView
              layer={activeLayer}
              datasets={datasets}
              canToggle={Boolean(capabilities?.toggleLayerVisibility)}
              canRename={canRename}
              canDuplicate={Boolean(capabilities?.duplicateLayer)}
              canRemove={Boolean(capabilities?.removeLayer)}
              canExport={activeLayer.dataIds.length === 1}
              canEditStructure={canEditStructure}
              canEditStyle={canEditStyle}
              layerBlending={basemap.blending.layers}
              overlayBlending={basemap.blending.overlays}
              onBack={() => setView({ kind: "list" })}
              onToggle={(layer, visible) =>
                applyCommand(controller.toggleLayerVisibility(layer, visible))
              }
              onRename={renameLayer}
              onDuplicate={duplicateLayer}
              onRemove={removeLayer}
              onExport={(layer) => {
                const datasetId = layer.dataIds[0];
                if (datasetId) exportCsv(datasetId, layer.label);
              }}
              onDatasetChange={associateLayerDataset}
              onColumnsChange={updateLayerColumns}
              onStyleChange={updateLayerStyle}
            />
          ) : (
            <>
              <div className="maono-layer-panel__toolbar">
                {showSearch ? (
                  <label className="maono-layer-panel__search">
                    <LayerPanelIcon name="search" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar camada"
                      aria-label="Buscar camada"
                    />
                    {search ? (
                      <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca">
                        <LayerPanelIcon name="x" />
                      </button>
                    ) : null}
                  </label>
                ) : <span />}
                {capabilities?.createLayer ? (
                  <AddLayerMenu
                    datasets={datasets}
                    onCreate={createLayer}
                    onImport={openDataImport}
                  />
                ) : null}
              </div>

              <LayerList
                layers={layers}
                selectedLayerId={selectedLayerId}
                search={search}
                canInspect={canInspect}
                canToggle={Boolean(capabilities?.toggleLayerVisibility)}
                canRename={canRename}
                canDuplicate={Boolean(capabilities?.duplicateLayer)}
                canRemove={Boolean(capabilities?.removeLayer)}
                canReorder={Boolean(capabilities?.reorderLayers)}
                onOpen={openLayer}
                onToggle={(layer, visible) =>
                  applyCommand(controller.toggleLayerVisibility(layer, visible))
                }
                onRename={renameLayer}
                onDuplicate={duplicateLayer}
                onRemove={removeLayer}
                onMove={moveLayer}
                onMoveTo={moveLayerTo}
                onReorder={reorderLayer}
              />
            </>
          )}
        </div>
      ) : canViewFilters ? (
        <div
          id="maono-filters-panel"
          className="maono-layer-panel__body"
          role="tabpanel"
          aria-labelledby="maono-filters-tab"
        >
          <FilterPanel
            filters={filters}
            datasets={datasets}
            editable={Boolean(capabilities?.editFilters)}
            onAdd={addFilter}
            onBindField={(index, dataId, fieldName) =>
              applyCommand(
                controller.bindFilterField(index, dataId, fieldName),
                "Propriedade do filtro atualizada.",
              )
            }
            onRemove={(index) =>
              applyCommand(controller.removeFilter(index), "Filtro removido.")
            }
            onChangeValue={(index, value) =>
              applyCommand(controller.setFilterValue(index, value))
            }
            onToggleEnabled={(index, enabled) =>
              applyCommand(controller.setFilterEnabled(index, enabled))
            }
            onFocusResults={() => applyCommand(controller.fitFilteredData())}
            onExportCsv={exportCsv}
          />
        </div>
      ) : null}

      <PanelSaveAction />
    </aside>
  );
}
