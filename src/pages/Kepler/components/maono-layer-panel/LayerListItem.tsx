import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import type { MaonoLayerSnapshot } from "../../integration/keplerBridge";
import LayerPanelIcon from "./LayerPanelIcon";

type Props = {
  layer: MaonoLayerSnapshot;
  index: number;
  total: number;
  selected: boolean;
  canInspect: boolean;
  canToggle: boolean;
  canRename: boolean;
  canDuplicate: boolean;
  canRemove: boolean;
  canReorder: boolean;
  dragging: boolean;
  dragTarget: boolean;
  onSelect: (layer: MaonoLayerSnapshot) => void;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
  onRename: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onDuplicate: (layer: MaonoLayerSnapshot) => void;
  onRemove: (layer: MaonoLayerSnapshot) => void;
  onMove: (layerId: string, direction: -1 | 1) => void;
  onDragStart: (layerId: string, event: DragEvent<HTMLLIElement>) => void;
  onDragEnter: (layerId: string) => void;
  onDrop: (layerId: string, event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
};

function stopPropagation(event: MouseEvent | KeyboardEvent) {
  event.stopPropagation();
}

export default function LayerListItem({
  layer,
  index,
  total,
  selected,
  canInspect,
  canToggle,
  canRename,
  canDuplicate,
  canRemove,
  canReorder,
  dragging,
  dragTarget,
  onSelect,
  onToggle,
  onRename,
  onDuplicate,
  onRemove,
  onMove,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(layer.label);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreNextBlurRef = useRef(false);
  const committingRef = useRef(false);

  function guardImmediateBlur() {
    ignoreNextBlurRef.current = true;
    window.setTimeout(() => {
      ignoreNextBlurRef.current = false;
    }, 0);
  }

  useEffect(() => {
    if (!editing) {
      setDraftLabel(layer.label);
      setRenameError(null);
    }
  }, [editing, layer.label]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function cancelRename() {
    setDraftLabel(layer.label);
    setRenameError(null);
    setEditing(false);
  }

  function commitRename() {
    if (committingRef.current) return;

    const nextLabel = draftLabel.trim();
    if (!nextLabel) {
      setRenameError("Informe um nome para a camada.");
      inputRef.current?.focus();
      return;
    }

    if (nextLabel === layer.label) {
      setRenameError(null);
      setEditing(false);
      return;
    }

    committingRef.current = true;
    const committed = onRename(layer, nextLabel);
    window.setTimeout(() => {
      committingRef.current = false;
    }, 0);

    if (committed) {
      setRenameError(null);
      setEditing(false);
    } else {
      setRenameError("O nome anterior foi preservado.");
      inputRef.current?.focus();
    }
  }

  return (
    <li
      className={[
        "maono-layer-list__item",
        selected ? "is-selected" : "",
        layer.isVisible ? "is-visible" : "is-hidden",
        dragging ? "is-dragging" : "",
        dragTarget ? "is-drag-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={canReorder && !editing}
      onDragStart={(event) => onDragStart(layer.id, event)}
      onDragEnter={() => onDragEnter(layer.id)}
      onDragOver={(event) => {
        if (canReorder) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => onDrop(layer.id, event)}
      onDragEnd={onDragEnd}
    >
      <span
        className="maono-layer-list__accent"
        style={{ background: `rgb(${layer.color.join(",")})` }}
        aria-hidden="true"
      />

      <span
        className="maono-layer-list__grip"
        title={
          canReorder ? "Arraste para reordenar" : "Reordenação indisponível"
        }
        aria-hidden="true"
      >
        <LayerPanelIcon name="grip" />
      </span>

      <div className="maono-layer-list__main">
        {editing ? (
          <div className="maono-layer-list__rename-wrap">
            <input
              ref={inputRef}
              className="maono-layer-list__rename"
              value={draftLabel}
              maxLength={160}
              onChange={(event) => {
                setDraftLabel(event.target.value);
                setRenameError(null);
              }}
              onBlur={() => {
                if (ignoreNextBlurRef.current) {
                  ignoreNextBlurRef.current = false;
                  return;
                }
                commitRename();
              }}
              onClick={stopPropagation}
              onKeyDown={(event) => {
                stopPropagation(event);
                if (event.key === "Enter") {
                  event.preventDefault();
                  guardImmediateBlur();
                  commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  guardImmediateBlur();
                  cancelRename();
                }
              }}
              aria-label={`Novo nome de ${layer.label}`}
              aria-invalid={renameError ? "true" : undefined}
              aria-describedby={renameError ? `rename-error-${layer.id}` : undefined}
            />
            {renameError ? (
              <small id={`rename-error-${layer.id}`} role="alert">
                {renameError}
              </small>
            ) : null}
          </div>
        ) : (
          <button
            className="maono-layer-list__select"
            type="button"
            onClick={() => onSelect(layer)}
            aria-current={selected ? "true" : undefined}
            aria-pressed={selected}
            disabled={!canInspect}
            title={canInspect ? "Inspecionar camada" : "Inspeção indisponível"}
          >
            <span>
              <strong>{layer.label}</strong>
              <small>{layer.type}</small>
            </span>
          </button>
        )}

        <div className="maono-layer-list__actions">
          {canRename ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setEditing(true);
              }}
              aria-label={`Renomear ${layer.label}`}
              title="Renomear"
            >
              <LayerPanelIcon name="edit" />
            </button>
          ) : null}

          {canDuplicate ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDuplicate(layer);
              }}
              aria-label={`Duplicar ${layer.label}`}
              title="Duplicar"
            >
              <LayerPanelIcon name="copy" />
            </button>
          ) : null}

          {canRemove ? (
            <button
              type="button"
              className="is-danger"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(layer);
              }}
              aria-label={`Remover ${layer.label}`}
              title="Remover"
            >
              <LayerPanelIcon name="trash" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="maono-layer-list__controls">
        {canToggle ? (
          <button
            type="button"
            onClick={() => onToggle(layer, !layer.isVisible)}
            aria-label={
              layer.isVisible
                ? `Ocultar ${layer.label}`
                : `Mostrar ${layer.label}`
            }
            aria-pressed={layer.isVisible}
            title={layer.isVisible ? "Ocultar camada" : "Mostrar camada"}
          >
            <LayerPanelIcon name={layer.isVisible ? "eye" : "eye-off"} />
          </button>
        ) : (
          <span
            className="maono-layer-list__visibility-state"
            title={layer.isVisible ? "Camada visível" : "Camada oculta"}
          >
            <LayerPanelIcon name={layer.isVisible ? "eye" : "eye-off"} />
          </span>
        )}

        {canReorder ? (
          <span className="maono-layer-list__reorder">
            <button
              type="button"
              onClick={() => onMove(layer.id, -1)}
              disabled={index === 0}
              aria-label={`Mover ${layer.label} para cima`}
              title="Mover para cima"
            >
              <LayerPanelIcon name="chevron-up" />
            </button>
            <button
              type="button"
              onClick={() => onMove(layer.id, 1)}
              disabled={index === total - 1}
              aria-label={`Mover ${layer.label} para baixo`}
              title="Mover para baixo"
            >
              <LayerPanelIcon name="chevron-down" />
            </button>
          </span>
        ) : null}
      </div>
    </li>
  );
}
