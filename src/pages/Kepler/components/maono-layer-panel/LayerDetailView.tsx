import { useEffect, useRef, useState } from "react";

import type { MapLayerColumns } from "../../engine-adapter";
import type {
  MaonoDatasetSnapshot,
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge";
import LayerInspector from "./LayerInspector";
import LayerPanelIcon from "./LayerPanelIcon";
import type { LayerStyleChange } from "./LayerStyleEditor";
import PanelActionMenu, { type PanelActionMenuItem } from "./PanelActionMenu";

type Props = {
  layer: MaonoLayerSnapshot;
  datasets: MaonoDatasetSnapshot[];
  canToggle: boolean;
  canRename: boolean;
  canDuplicate: boolean;
  canRemove: boolean;
  canExport: boolean;
  canEditStructure: boolean;
  canEditStyle: boolean;
  layerBlending: string | null;
  overlayBlending: string | null;
  onBack: () => void;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
  onRename: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onDuplicate: (layer: MaonoLayerSnapshot) => void;
  onRemove: (layer: MaonoLayerSnapshot) => void;
  onExport: (layer: MaonoLayerSnapshot) => void;
  onDatasetChange: (layer: MaonoLayerSnapshot, datasetId: string) => boolean;
  onColumnsChange: (
    layer: MaonoLayerSnapshot,
    columns: Partial<MapLayerColumns>,
  ) => boolean;
  onStyleChange: (layer: MaonoLayerSnapshot, change: LayerStyleChange) => void;
};

export default function LayerDetailView({
  layer,
  datasets,
  canToggle,
  canRename,
  canDuplicate,
  canRemove,
  canExport,
  canEditStructure,
  canEditStyle,
  layerBlending,
  overlayBlending,
  onBack,
  onToggle,
  onRename,
  onDuplicate,
  onRemove,
  onExport,
  onDatasetChange,
  onColumnsChange,
  onStyleChange,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(layer.label);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftLabel(layer.label);
    setEditing(false);
    setError(null);
  }, [layer.id, layer.label]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commitName() {
    const next = draftLabel.trim();
    if (!next) {
      setError("Informe um nome para a camada.");
      return;
    }
    if (next === layer.label) {
      setEditing(false);
      setError(null);
      return;
    }
    if (onRename(layer, next)) {
      setEditing(false);
      setError(null);
    } else {
      setDraftLabel(layer.label);
      setError("O nome anterior foi preservado.");
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
  if (canExport) {
    menuItems.push({
      label: "Exportar dados filtrados (CSV)",
      icon: "download",
      separatorBefore: menuItems.length > 0,
      onSelect: () => onExport(layer),
    });
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
    <section className="maono-detail-view" aria-label={`Configurações de ${layer.label}`}>
      <header className="maono-detail-view__header">
        <button
          type="button"
          className="maono-detail-view__back"
          onClick={onBack}
          aria-label="Voltar para a lista de camadas"
          title="Voltar para camadas"
        >
          <LayerPanelIcon name="arrow-left" />
        </button>

        <div className="maono-detail-view__identity">
          {editing ? (
            <input
              ref={inputRef}
              value={draftLabel}
              maxLength={160}
              onChange={(event) => {
                setDraftLabel(event.target.value);
                setError(null);
              }}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  setDraftLabel(layer.label);
                  setEditing(false);
                  setError(null);
                }
              }}
              aria-label="Nome da camada"
              aria-invalid={error ? "true" : undefined}
            />
          ) : (
            <strong>{layer.label}</strong>
          )}
          <small>
            {layer.type} · {datasets.find((item) => item.id === layer.dataIds[0])?.label ?? "Dataset não informado"}
          </small>
          {error ? <em role="alert">{error}</em> : null}
        </div>

        {menuItems.length ? (
          <PanelActionMenu label={`Ações de ${layer.label}`} items={menuItems} />
        ) : null}
      </header>

      <div className="maono-detail-view__scroll">
        <LayerInspector
          layer={layer}
          datasets={datasets}
          canToggle={canToggle}
          canEditStructure={canEditStructure}
          canEditStyle={canEditStyle}
          layerBlending={layerBlending}
          overlayBlending={overlayBlending}
          onToggle={onToggle}
          onDatasetChange={onDatasetChange}
          onColumnsChange={onColumnsChange}
          onStyleChange={onStyleChange}
        />
      </div>
    </section>
  );
}
