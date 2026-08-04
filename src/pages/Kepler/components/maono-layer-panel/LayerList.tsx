import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import type { MaonoLayerSnapshot } from "../../integration/keplerBridge";
import LayerListItem from "./LayerListItem";
import LayerPanelIcon from "./LayerPanelIcon";

type Props = {
  layers: MaonoLayerSnapshot[];
  selectedLayerId: string | null;
  search: string;
  canInspect: boolean;
  canToggle: boolean;
  canRename: boolean;
  canDuplicate: boolean;
  canRemove: boolean;
  canReorder: boolean;
  onSelect: (layer: MaonoLayerSnapshot) => void;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
  onRename: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onDuplicate: (layer: MaonoLayerSnapshot) => void;
  onRemove: (layer: MaonoLayerSnapshot) => void;
  onMove: (layerId: string, direction: -1 | 1) => void;
  onReorder: (draggedLayerId: string, targetLayerId: string) => void;
  renderLayerDetails: (layer: MaonoLayerSnapshot) => ReactNode;
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function sameLayerIds(left: Set<string>, right: Set<string>) {
  return (
    left.size === right.size &&
    Array.from(left).every((layerId) => right.has(layerId))
  );
}

export default function LayerList({
  layers,
  selectedLayerId,
  search,
  canInspect,
  canToggle,
  canRename,
  canDuplicate,
  canRemove,
  canReorder,
  onSelect,
  onToggle,
  onRename,
  onDuplicate,
  onRemove,
  onMove,
  onReorder,
  renderLayerDetails,
}: Props) {
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragTargetLayerId, setDragTargetLayerId] = useState<string | null>(
    null,
  );
  const [expandedLayerIds, setExpandedLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const previousSelectedLayerIdRef = useRef<string | null>(null);
  const normalizedSearch = normalizeSearch(search);
  const visibleLayers = useMemo(
    () =>
      normalizedSearch
        ? layers.filter((layer) =>
            normalizeSearch(`${layer.label} ${layer.type}`).includes(
              normalizedSearch,
            ),
          )
        : layers,
    [layers, normalizedSearch],
  );
  const reorderEnabled = canReorder && !normalizedSearch;

  useEffect(() => {
    const availableLayerIds = new Set(layers.map((layer) => layer.id));

    setExpandedLayerIds((current) => {
      const next = new Set(
        Array.from(current).filter((layerId) => availableLayerIds.has(layerId)),
      );

      return sameLayerIds(current, next) ? current : next;
    });
  }, [layers]);

  useEffect(() => {
    const previousSelectedLayerId = previousSelectedLayerIdRef.current;

    if (
      canInspect &&
      selectedLayerId &&
      selectedLayerId !== previousSelectedLayerId
    ) {
      setExpandedLayerIds((current) => {
        if (current.has(selectedLayerId)) return current;

        const next = new Set(current);
        next.add(selectedLayerId);
        return next;
      });
    }

    previousSelectedLayerIdRef.current = selectedLayerId;
  }, [canInspect, selectedLayerId]);

  function resetDrag() {
    setDraggedLayerId(null);
    setDragTargetLayerId(null);
  }

  function handleDragStart(layerId: string, event: DragEvent<HTMLLIElement>) {
    if (!reorderEnabled) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", layerId);
    setDraggedLayerId(layerId);
  }

  function handleDrop(targetLayerId: string, event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    const sourceLayerId =
      draggedLayerId || event.dataTransfer.getData("text/plain");

    if (reorderEnabled && sourceLayerId && sourceLayerId !== targetLayerId) {
      onReorder(sourceLayerId, targetLayerId);
    }

    resetDrag();
  }

  function toggleLayerExpanded(layer: MaonoLayerSnapshot) {
    if (!canInspect) return;

    onSelect(layer);
    setExpandedLayerIds((current) => {
      const next = new Set(current);

      if (next.has(layer.id)) {
        next.delete(layer.id);
      } else {
        next.add(layer.id);
      }

      return next;
    });
  }

  if (!visibleLayers.length) {
    return (
      <div className="maono-layer-panel__empty">
        <LayerPanelIcon
          name={layers.length ? "search" : "layers"}
          className="maono-layer-panel__empty-icon"
        />
        <strong>
          {layers.length
            ? "Nenhuma camada encontrada"
            : "Este mapa ainda não possui camadas"}
        </strong>
        <span>
          {layers.length
            ? "Tente outro nome ou tipo de camada."
            : "Adicione uma camada usando um dataset disponível."}
        </span>
      </div>
    );
  }

  return (
    <section className="maono-layer-list-region">
      <div className="maono-layer-list__summary">
        <span>
          {normalizedSearch
            ? `${visibleLayers.length} de ${layers.length}`
            : `${layers.length} ${layers.length === 1 ? "camada" : "camadas"}`}
        </span>
        {canReorder ? (
          <small>
            {reorderEnabled
              ? "Arraste ou use as setas para ordenar"
              : "Limpe a busca para reordenar"}
          </small>
        ) : null}
      </div>

      <ol className="maono-layer-list" aria-label="Camadas do mapa">
        {visibleLayers.map((layer) => {
          const originalIndex = layers.findIndex(
            (candidate) => candidate.id === layer.id,
          );
          const expanded = expandedLayerIds.has(layer.id);

          return (
            <LayerListItem
              key={layer.id}
              layer={layer}
              index={originalIndex}
              total={layers.length}
              selected={layer.id === selectedLayerId}
              expanded={expanded}
              details={renderLayerDetails(layer)}
              canInspect={canInspect}
              canToggle={canToggle}
              canRename={canRename}
              canDuplicate={canDuplicate}
              canRemove={canRemove}
              canReorder={reorderEnabled}
              dragging={layer.id === draggedLayerId}
              dragTarget={
                Boolean(draggedLayerId) &&
                layer.id === dragTargetLayerId &&
                layer.id !== draggedLayerId
              }
              onToggleExpanded={toggleLayerExpanded}
              onToggle={onToggle}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              onMove={onMove}
              onDragStart={handleDragStart}
              onDragEnter={(layerId) => {
                if (reorderEnabled && layerId !== draggedLayerId) {
                  setDragTargetLayerId(layerId);
                }
              }}
              onDrop={handleDrop}
              onDragEnd={resetDrag}
            />
          );
        })}
      </ol>
    </section>
  );
}
