import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

import type { MaonoLayerSnapshot } from "../../integration/keplerBridge";
import LayerListItem from "./LayerListItem";
import { layerDropPosition, type LayerDropPosition } from "./layer-drop-order";
import LayerPanelIcon from "./LayerPanelIcon";
import { resolveLayerSidebarAccent, type LayerSidebarAccents } from "./layer-sidebar-accents";

type Props = {
  layers: MaonoLayerSnapshot[];
  sidebarAccents: LayerSidebarAccents;
  selectedLayerId: string | null;
  search: string;
  canInspect: boolean;
  canToggle: boolean;
  canRename: boolean;
  canDuplicate: boolean;
  canRemove: boolean;
  canReorder: boolean;
  onOpen: (layer: MaonoLayerSnapshot) => void;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
  onRename: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onDuplicate: (layer: MaonoLayerSnapshot) => void;
  onRemove: (layer: MaonoLayerSnapshot) => void;
  onMove: (layerId: string, direction: -1 | 1) => void;
  onMoveTo: (layerId: string, position: "start" | "end") => void;
  onReorder: (draggedLayerId: string, targetLayerId: string, position: LayerDropPosition) => void;
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export default function LayerList({
  layers,
  sidebarAccents,
  selectedLayerId,
  search,
  canInspect,
  canToggle,
  canRename,
  canDuplicate,
  canRemove,
  canReorder,
  onOpen,
  onToggle,
  onRename,
  onDuplicate,
  onRemove,
  onMove,
  onMoveTo,
  onReorder,
}: Props) {
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const draggedLayerIdRef = useRef<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ layerId: string; position: LayerDropPosition } | null>(null);
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

  function resetDrag() {
    draggedLayerIdRef.current = null;
    setDraggedLayerId(null);
    setDragTarget(null);
  }

  useEffect(() => {
    if (!reorderEnabled) resetDrag();
  }, [reorderEnabled]);

  function handleDragStart(layerId: string, event: DragEvent<HTMLLIElement>) {
    if (!reorderEnabled) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", layerId);
    draggedLayerIdRef.current = layerId;
    setDraggedLayerId(layerId);
    setDragTarget(null);
  }

  function handleDragOver(targetLayerId: string, event: DragEvent<HTMLLIElement>) {
    const sourceLayerId = draggedLayerIdRef.current;
    if (!reorderEnabled || !sourceLayerId) return;

    event.preventDefault();
    if (sourceLayerId === targetLayerId) {
      event.dataTransfer.dropEffect = "none";
      setDragTarget(null);
      return;
    }

    event.dataTransfer.dropEffect = "move";
    const position = layerDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    setDragTarget((current) => current?.layerId === targetLayerId && current.position === position
      ? current
      : { layerId: targetLayerId, position });
  }

  function handleDrop(targetLayerId: string, event: DragEvent<HTMLLIElement>) {
    // Accept only a drag started by this list; external text/files are not layers.
    const sourceLayerId = draggedLayerIdRef.current;
    if (reorderEnabled && sourceLayerId) {
      event.preventDefault();
      if (sourceLayerId !== targetLayerId) {
        // Read the final pointer position too, including drops without another dragover.
        const position = layerDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
        onReorder(sourceLayerId, targetLayerId, position);
      }
    }
    resetDrag();
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
      {normalizedSearch ? (
        <div className="maono-layer-list__summary">
          <span>{visibleLayers.length} de {layers.length}</span>
          {canReorder ? <small>Limpe a busca para reordenar.</small> : null}
        </div>
      ) : null}

      <ol className="maono-layer-list" aria-label="Camadas do mapa">
        {visibleLayers.map((layer) => {
          const originalIndex = layers.findIndex(
            (candidate) => candidate.id === layer.id,
          );

          return (
            <LayerListItem
              key={layer.id}
              layer={layer}
              sidebarAccent={resolveLayerSidebarAccent(layer.id, sidebarAccents)}
              index={originalIndex}
              total={layers.length}
              selected={layer.id === selectedLayerId}
              canInspect={canInspect}
              canToggle={canToggle}
              canRename={canRename}
              canDuplicate={canDuplicate}
              canRemove={canRemove}
              canReorder={reorderEnabled}
              dragging={layer.id === draggedLayerId}
              dropPosition={dragTarget?.layerId === layer.id ? dragTarget.position : null}
              onOpen={onOpen}
              onToggle={onToggle}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              onMove={onMove}
              onMoveTo={onMoveTo}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={(layerId) => {
                setDragTarget((current) => current?.layerId === layerId ? null : current);
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
