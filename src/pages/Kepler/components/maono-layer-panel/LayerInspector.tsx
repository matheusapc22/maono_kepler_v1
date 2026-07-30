import { useEffect, useState } from "react";

import type {
  MaonoDatasetSnapshot,
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge";
import LayerStyleEditor, {
  type LayerStyleChange,
} from "./LayerStyleEditor";

type Props = {
  layer: MaonoLayerSnapshot | null;
  datasets: MaonoDatasetSnapshot[];
  canRename: boolean;
  canEditStyle: boolean;
  canDuplicate: boolean;
  canRemove: boolean;
  onLabelChange: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onStyleChange: (
    layer: MaonoLayerSnapshot,
    change: LayerStyleChange,
  ) => void;
  onDuplicate: (layerId: string) => void;
  onRemove: (layerId: string) => void;
};

export default function LayerInspector({
  layer,
  datasets,
  canRename,
  canEditStyle,
  canDuplicate,
  canRemove,
  onLabelChange,
  onStyleChange,
  onDuplicate,
  onRemove,
}: Props) {
  const [label, setLabel] = useState(layer?.label || "");

  useEffect(() => {
    setLabel(layer?.label || "");
  }, [layer?.id, layer?.label]);

  if (!layer) {
    return (
      <div className="maono-layer-inspector is-empty">
        Selecione uma camada para consultar seus detalhes.
      </div>
    );
  }

  const dataset =
    datasets.find((candidate) => layer.dataIds.includes(candidate.id)) ?? null;

  return (
    <section className="maono-layer-inspector">
      <div className="maono-layer-inspector__heading">
        <span>Camada selecionada</span>
        <strong>{layer.label}</strong>
      </div>

      <dl className="maono-layer-inspector__facts">
        <div>
          <dt>Tipo</dt>
          <dd>{layer.type}</dd>
        </div>
        <div>
          <dt>Dataset</dt>
          <dd>
            {Array.isArray(layer.dataId)
              ? layer.dataId.join(", ")
              : layer.dataId || "Não informado"}
          </dd>
        </div>
        <div>
          <dt>Visibilidade</dt>
          <dd>{layer.isVisible ? "Visível" : "Oculta"}</dd>
        </div>
      </dl>

      {canRename || canEditStyle ? (
        <div className="maono-layer-inspector__editor">
          {canRename ? (
            <label className="maono-layer-inspector__name">
              Nome
              <input
                value={label}
                maxLength={160}
                onChange={(event) => setLabel(event.target.value)}
                onBlur={() => {
                  const normalized = label.trim();
                  if (!normalized) {
                    setLabel(layer.label);
                  } else if (
                    normalized !== layer.label &&
                    !onLabelChange(layer, normalized)
                  ) {
                    setLabel(layer.label);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setLabel(layer.label);
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          ) : null}

          {canEditStyle ? (
            <LayerStyleEditor
              layer={layer}
              dataset={dataset}
              onChange={(change) => onStyleChange(layer, change)}
            />
          ) : null}
        </div>
      ) : (
        <p className="maono-layer-inspector__notice">
          Modo de visualização: estilos e filtros permanecem somente leitura.
        </p>
      )}

      {canDuplicate || canRemove ? (
        <div className="maono-layer-inspector__actions">
          {canDuplicate ? (
            <button type="button" onClick={() => onDuplicate(layer.id)}>
              Duplicar
            </button>
          ) : null}
          {canRemove ? (
            <button
              className="is-danger"
              type="button"
              onClick={() => onRemove(layer.id)}
            >
              Remover
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
