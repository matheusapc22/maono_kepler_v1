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
import PanelActionMenu, {
  type PanelActionMenuItem,
} from "./PanelActionMenu";

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
  onOpen: (layer: MaonoLayerSnapshot) => void;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
  onRename: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onDuplicate: (layer: MaonoLayerSnapshot) => void;
  onRemove: (layer: MaonoLayerSnapshot) => void;
  onMove: (layerId: string, direction: -1 | 1) => void;
  onMoveTo: (layerId: string, position: "start" | "end") => void;
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
  onOpen,
  onToggle,
  onRename,
  onDuplicate,
  onRemove,
  onMove,
  onMoveTo,
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

  function guardImmediateBlur() {
    ignoreNextBlurRef.current = true;
    window.setTimeout(() => {
      ignoreNextBlurRef.current = false;
    }, 0);
  }

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

  const menuItems: PanelActionMenuItem[] = [];

  if (canRename) {
    menuItems.push({
      label: "Renomear",
      icon: "edit",
      onSelect: () => setEditing(true),
    });
  }
  if (canDuplicate) {
    menuItems.push({
      label: "Duplicar",
      icon: "copy",
      onSelect: () => onDuplicate(layer),
    });
  }
  if (canReorder) {
    menuItems.push(
      {
        label: `Mover ${layer.label} para cima`,
        icon: "chevron-up",
        disabled: index === 0,
        separatorBefore: menuItems.length > 0,
        onSelect: () => onMove(layer.id, -1),
      },
      {
        label: `Mover ${layer.label} para baixo`,
        icon: "chevron-down",
        disabled: index === total - 1,
        onSelect: () => onMove(layer.id, 1),
      },
      {
        label: "Mover para o início",
        icon: "arrow-left",
        disabled: index === 0,
        onSelect: () => onMoveTo(layer.id, "start"),
      },
      {
        label: "Mover para o fim",
        icon: "arrow-left",
        disabled: index === total - 1,
        onSelect: () => onMoveTo(layer.id, "end"),
      },
    );
  }
  if (canRemove) {
    menuItems.push({
      label: "Remover",
      icon: "trash",
      danger: true,
      separatorBefore: menuItems.length > 0,
      onSelect: () => onRemove(layer),
    });
  }

  return (
    <li
      className={[
        "maono-layer-row",
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
      {canReorder ? (
        <span
          className="maono-layer-row__grip"
          title="Arraste para reordenar"
          aria-hidden="true"
        >
          <LayerPanelIcon name="grip" />
        </span>
      ) : null}

      <span
        className="maono-layer-row__swatch"
        style={{ background: `rgb(${layer.color.join(",")})` }}
        aria-hidden="true"
      />

      <div className="maono-layer-row__main">
        {editing ? (
          <div className="maono-layer-row__rename-wrap">
            <input
              ref={inputRef}
              className="maono-layer-list__rename maono-layer-row__rename"
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
            type="button"
            className="maono-layer-row__open"
            onClick={() => onOpen(layer)}
            disabled={!canInspect}
            aria-current={selected ? "true" : undefined}
            title={
              canInspect
                ? `Configurar ${layer.label}`
                : "Inspeção indisponível"
            }
          >
            <strong>{layer.label}</strong>
            <small>{layer.type}</small>
          </button>
        )}
      </div>

      <div className="maono-layer-row__controls">
        {canToggle ? (
          <button
            type="button"
            className="maono-layer-row__visibility"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(layer, !layer.isVisible);
            }}
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
            className="maono-layer-row__visibility-state"
            title={layer.isVisible ? "Camada visível" : "Camada oculta"}
          >
            <LayerPanelIcon name={layer.isVisible ? "eye" : "eye-off"} />
          </span>
        )}

        {menuItems.length ? (
          <PanelActionMenu
            label={`Ações de ${layer.label}`}
            items={menuItems}
          />
        ) : null}
      </div>
    </li>
  );
}
