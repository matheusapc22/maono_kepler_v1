import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useKeplerController } from "../../hooks/useKeplerController";
import { useKeplerState } from "../../hooks/useKeplerState";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import FilterPanel from "./FilterPanel";
import LayerInspector from "./LayerInspector";
import LayerList from "./LayerList";
import "./maono-layer-panel.css";

export default function MaonoLayerPanel() {
  const { context } = useMapPanel();
  const { layers, filters, datasets } = useKeplerState();
  const controller = useKeplerController();
  const [tab, setTab] = useState<"layers" | "filters">("layers");
  const [search, setSearch] = useState("");
  const [selectedLayerId, setSelectedLayerId] =
    useState<string | null>(null);
  const capabilities = context?.capabilities;
  const selectedLayer = useMemo(
    () =>
      layers.find((layer) => layer.id === selectedLayerId) ??
      layers[0] ??
      null,
    [layers, selectedLayerId],
  );

  useEffect(() => {
    if (!selectedLayerId && layers[0]) {
      setSelectedLayerId(layers[0].id);
    } else if (
      selectedLayerId &&
      !layers.some((layer) => layer.id === selectedLayerId)
    ) {
      setSelectedLayerId(layers[0]?.id ?? null);
    }
  }, [layers, selectedLayerId]);

  function moveLayer(layerId: string, direction: -1 | 1) {
    const index = layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = index + direction;

    if (
      index < 0 ||
      nextIndex < 0 ||
      nextIndex >= layers.length
    ) {
      return;
    }

    const order = layers.map((layer) => layer.id);
    [order[index], order[nextIndex]] = [
      order[nextIndex],
      order[index],
    ];
    controller.reorderLayers(order);
  }

  return (
    <aside
      className="maono-layer-panel"
      data-panel-mode={context?.mode || "viewer"}
      aria-label="Controlador de camadas Maõno"
    >
      <header className="maono-layer-panel__header">
        <div>
          <span>Maõno Maps</span>
          <strong>
            {context?.mode === "editor"
              ? "Editor de camadas"
              : "Visualizador de camadas"}
          </strong>
        </div>
        <span className="maono-layer-panel__mode">
          {context?.mode === "editor" ? "Editando" : "Visualizando"}
        </span>
      </header>

      <nav className="maono-layer-panel__tabs" aria-label="Painéis do mapa">
        <button
          type="button"
          className={tab === "layers" ? "is-active" : ""}
          onClick={() => setTab("layers")}
        >
          Camadas <span>{layers.length}</span>
        </button>
        <button
          type="button"
          className={tab === "filters" ? "is-active" : ""}
          onClick={() => setTab("filters")}
        >
          Filtros <span>{filters.length}</span>
        </button>
      </nav>

      {tab === "layers" ? (
        <>
          <div className="maono-layer-panel__toolbar">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar camada"
              aria-label="Buscar camada"
            />
            {capabilities?.createLayer ? (
              <button
                type="button"
                onClick={() => controller.createLayer()}
              >
                Nova
              </button>
            ) : null}
          </div>

          <LayerList
            layers={layers}
            selectedLayerId={selectedLayer?.id ?? null}
            search={search}
            canToggle={Boolean(capabilities?.toggleLayerVisibility)}
            canReorder={Boolean(capabilities?.reorderLayers)}
            onSelect={(layer) => {
              const result = controller.inspectLayer();
              if (result.ok) setSelectedLayerId(layer.id);
            }}
            onToggle={(layer, visible) =>
              controller.toggleLayerVisibility(layer, visible)
            }
            onMove={moveLayer}
          />

          <LayerInspector
            layer={selectedLayer}
            editable={Boolean(capabilities?.editLayerStyle)}
            canDuplicate={Boolean(capabilities?.duplicateLayer)}
            canRemove={Boolean(capabilities?.removeLayer)}
            onLabelChange={(layer, label) =>
              controller.updateLayerLabel(layer, label)
            }
            onOpacityChange={(layer, opacity) =>
              controller.updateLayerOpacity(layer, opacity)
            }
            onColorChange={(layer, color) =>
              controller.updateLayerColor(layer, color)
            }
            onDuplicate={(layerId) =>
              controller.duplicateLayer(layerId)
            }
            onRemove={(layerId) =>
              controller.removeLayer(layerId)
            }
          />
        </>
      ) : (
        <FilterPanel
          filters={filters}
          datasets={datasets}
          editable={Boolean(capabilities?.editFilters)}
          onAdd={(dataId) => controller.addFilter(dataId)}
          onRemove={(index) => controller.removeFilter(index)}
          onChangeValue={(index, value) =>
            controller.setFilterValue(index, value)
          }
        />
      )}
    </aside>
  );
}
