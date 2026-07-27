import type {
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge";

type Props = {
  layers: MaonoLayerSnapshot[];
  selectedLayerId: string | null;
  search: string;
  canToggle: boolean;
  canReorder: boolean;
  onSelect: (layer: MaonoLayerSnapshot) => void;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
  onMove: (layerId: string, direction: -1 | 1) => void;
};

export default function LayerList({
  layers,
  selectedLayerId,
  search,
  canToggle,
  canReorder,
  onSelect,
  onToggle,
  onMove,
}: Props) {
  const normalizedSearch = search.trim().toLowerCase();
  const visibleLayers = normalizedSearch
    ? layers.filter((layer) =>
        layer.label.toLowerCase().includes(normalizedSearch),
      )
    : layers;

  if (!visibleLayers.length) {
    return (
      <p className="maono-layer-panel__empty">
        {layers.length
          ? "Nenhuma camada corresponde à busca."
          : "Este mapa ainda não possui camadas."}
      </p>
    );
  }

  return (
    <ol className="maono-layer-list" aria-label="Camadas do mapa">
      {visibleLayers.map((layer) => {
        const originalIndex = layers.findIndex(
          (candidate) => candidate.id === layer.id,
        );

        return (
          <li
            className={
              layer.id === selectedLayerId
                ? "maono-layer-list__item is-selected"
                : "maono-layer-list__item"
            }
            key={layer.id}
          >
            <button
              className="maono-layer-list__select"
              type="button"
              onClick={() => onSelect(layer)}
              aria-current={
                layer.id === selectedLayerId ? "true" : undefined
              }
            >
              <span
                className="maono-layer-list__color"
                style={{
                  background: `rgb(${layer.color.join(",")})`,
                }}
                aria-hidden="true"
              />
              <span>
                <strong>{layer.label}</strong>
                <small>{layer.type}</small>
              </span>
            </button>

            {canToggle ? (
              <button
                className="maono-layer-list__icon-button"
                type="button"
                onClick={() => onToggle(layer, !layer.isVisible)}
                aria-label={
                  layer.isVisible
                    ? `Ocultar ${layer.label}`
                    : `Mostrar ${layer.label}`
                }
                aria-pressed={layer.isVisible}
              >
                {layer.isVisible ? "◉" : "○"}
              </button>
            ) : null}

            {canReorder ? (
              <span className="maono-layer-list__reorder">
                <button
                  type="button"
                  onClick={() => onMove(layer.id, -1)}
                  disabled={originalIndex === 0}
                  aria-label={`Mover ${layer.label} para cima`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(layer.id, 1)}
                  disabled={originalIndex === layers.length - 1}
                  aria-label={`Mover ${layer.label} para baixo`}
                >
                  ↓
                </button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
