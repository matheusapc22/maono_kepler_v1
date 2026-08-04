import { useEffect, useState } from "react";

import type { KeplerCommandResult, MapLayerColumns } from "../../engine-adapter";
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
import LayerInspector from "./LayerInspector";
import LayerList from "./LayerList";
import LayerPanelIcon from "./LayerPanelIcon";
import PanelSaveAction from "./PanelSaveAction";
import type { LayerStyleChange } from "./LayerStyleEditor";
import "./maono-layer-panel.css";
import "./layer-accordion.css";

type PanelNotice = {
  kind: "error" | "success";
  message: string;
};

function modeCopy(mode: "viewer" | "editor" | "create" | undefined) {
  if (mode === "editor") {
    return {
      title: "Editor de camadas",
      badge: "Editando",
    };
  }
  if (mode === "create") {
    return {
      title: "Configuração do novo mapa",
      badge: "Criando",
    };
  }

  return {
    title: "Visualizador de camadas",
    badge: "Visualizando",
  };
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
  const [tab, setTab] = useState<MaonoMapPanelTab>("layers");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const capabilities = context?.capabilities;
  const canViewLayers = capabilities?.viewLayers === true;
  const canViewFilters = capabilities?.viewFilters === true;
  const canInspect = capabilities?.inspectLayer === true;
  const canRename = capabilities?.editLayers === true;
  const canEditStructure = capabilities?.editLayers === true;
  const copy = modeCopy(context?.mode);

  useEffect(() => {
    if (tab === "layers" && !canViewLayers && canViewFilters) {
      setTab("filters");
      notifyMaonoMapPanelTabChanged("filters");
    } else if (tab === "filters" && !canViewFilters && canViewLayers) {
      setTab("layers");
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
    if (notice?.kind !== "success") return undefined;

    const timeout = window.setTimeout(() => setNotice(null), 2_500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function selectTab(nextTab: MaonoMapPanelTab) {
    const allowed = nextTab === "layers" ? canViewLayers : canViewFilters;

    if (!allowed) return;

    setTab(nextTab);
    setNotice(null);
    notifyMaonoMapPanelTabChanged(nextTab);
  }

  function applyCommand<T>(
    result: KeplerCommandResult<T>,
    successMessage?: string,
    onSuccess?: (value: T | undefined) => void,
  ) {
    if (!result.ok) {
      setNotice({
        kind: "error",
        message: result.reason,
      });
      return false;
    }

    onSuccess?.(result.value);
    setNotice(
      result.changed && successMessage
        ? {
            kind: "success",
            message: successMessage,
          }
        : null,
    );
    return true;
  }

  function selectLayer(layer: MaonoLayerSnapshot) {
    applyCommand(controller.inspectLayer(layer.id));
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    const index = layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) {
      return;
    }

    const order = layers.map((layer) => layer.id);
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    applyCommand(
      controller.reorderLayers(order),
      "Ordem das camadas atualizada.",
    );
  }

  function reorderLayer(draggedLayerId: string, targetLayerId: string) {
    const order = layers.map((layer) => layer.id);
    const draggedIndex = order.indexOf(draggedLayerId);
    const targetIndex = order.indexOf(targetLayerId);

    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
      return;
    }

    const [movedLayerId] = order.splice(draggedIndex, 1);
    order.splice(targetIndex, 0, movedLayerId);
    applyCommand(
      controller.reorderLayers(order),
      "Ordem das camadas atualizada.",
    );
  }

  function renameLayer(layer: MaonoLayerSnapshot, label: string) {
    return applyCommand(
      controller.updateLayerLabel(layer, label),
      "Camada renomeada.",
    );
  }

  function duplicateLayer(layer: MaonoLayerSnapshot) {
    applyCommand(controller.duplicateLayer(layer.id), "Camada duplicada.");
  }

  function removeLayer(layer: MaonoLayerSnapshot) {
    if (
      !window.confirm(
        `Remover a camada “${layer.label}”? Esta alteração será efetivada ao salvar o mapa.`,
      )
    ) {
      return;
    }

    applyCommand(controller.removeLayer(layer.id), "Camada removida.");
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
        }
      },
    );
  }

  function openDataImport() {
    return applyCommand(controller.openAddDataModal());
  }

  function associateLayerDataset(
    layer: MaonoLayerSnapshot,
    datasetId: string,
  ) {
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

  function updateLayerStyle(
    layer: MaonoLayerSnapshot,
    change: LayerStyleChange,
  ) {
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
        applyCommand(
          controller.setStrokeColorField(layer.id, change.value),
        );
        return;
      case "strokeScale":
        applyCommand(
          controller.setStrokeColorScale(layer.id, change.value),
        );
        return;
      case "strokePalette":
        applyCommand(
          controller.setStrokeColorPalette(layer.id, change.value),
        );
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
        applyCommand(
          controller.setClusterOptions(layer.id, {
            radius: change.value,
          }),
        );
        return;
      case "heatmapRadius":
        applyCommand(
          controller.setHeatmapOptions(layer.id, {
            radius: change.value,
          }),
        );
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

  function renderLayerDetails(layer: MaonoLayerSnapshot) {
    return (
      <LayerInspector
        layer={layer}
        datasets={datasets}
        canRename={canRename}
        canEditStructure={canEditStructure}
        canEditStyle={Boolean(capabilities?.editLayerStyle)}
        layerBlending={basemap.blending.layers}
        overlayBlending={basemap.blending.overlays}
        onLabelChange={renameLayer}
        onDatasetChange={associateLayerDataset}
        onColumnsChange={updateLayerColumns}
        onStyleChange={updateLayerStyle}
      />
    );
  }

  const tabCount = Number(canViewLayers) + Number(canViewFilters);

  return (
    <aside
      id="maono-map-engine-panel"
      className="maono-layer-panel"
      data-panel-mode={context?.mode || "viewer"}
      data-active-tab={tab}
      data-read-only={context?.mode === "viewer" ? "true" : "false"}
      aria-label="Controlador de camadas Maõno"
    >
      <header className="maono-layer-panel__header">
        <div>
          <span>Maõno Maps</span>
          <strong>{copy.title}</strong>
        </div>
        <span className="maono-layer-panel__mode">{copy.badge}</span>
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
          {notice.kind === "error" ? <LayerPanelIcon name="warning" /> : null}
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Fechar aviso"
          >
            <LayerPanelIcon name="x" />
          </button>
        </div>
      ) : null}

      {!tabCount ? (
        <div className="maono-layer-panel__state is-error" role="alert">
          <LayerPanelIcon name="warning" />
          <strong>Painel indisponível</strong>
          <span>
            O servidor não concedeu acesso às camadas ou aos filtros deste mapa.
          </span>
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
          <div className="maono-layer-panel__toolbar">
            <label className="maono-layer-panel__search">
              <LayerPanelIcon name="search" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou tipo"
                aria-label="Buscar camada"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Limpar busca"
                >
                  <LayerPanelIcon name="x" />
                </button>
              ) : null}
            </label>

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
            onSelect={selectLayer}
            onToggle={(layer, visible) =>
              applyCommand(controller.toggleLayerVisibility(layer, visible))
            }
            onRename={renameLayer}
            onDuplicate={duplicateLayer}
            onRemove={removeLayer}
            onMove={moveLayer}
            onReorder={reorderLayer}
            renderLayerDetails={renderLayerDetails}
          />
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
            onAdd={(dataId) =>
              applyCommand(controller.addFilter(dataId), "Filtro adicionado.")
            }
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
          />
        </div>
      ) : null}

      <PanelSaveAction />
    </aside>
  );
}
