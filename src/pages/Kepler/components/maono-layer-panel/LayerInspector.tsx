import {
  useEffect,
  useState,
} from "react";

import type {
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge";
import { MAONO_LAYER_PALETTES } from "./palettes";

function componentToHex(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function toHex(color: [number, number, number]) {
  return `#${color.map(componentToHex).join("")}`;
}

function fromHex(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

type Props = {
  layer: MaonoLayerSnapshot | null;
  editable: boolean;
  canDuplicate: boolean;
  canRemove: boolean;
  onLabelChange: (layer: MaonoLayerSnapshot, label: string) => void;
  onOpacityChange: (layer: MaonoLayerSnapshot, opacity: number) => void;
  onColorChange: (
    layer: MaonoLayerSnapshot,
    color: [number, number, number],
  ) => void;
  onDuplicate: (layerId: string) => void;
  onRemove: (layerId: string) => void;
};

export default function LayerInspector({
  layer,
  editable,
  canDuplicate,
  canRemove,
  onLabelChange,
  onOpacityChange,
  onColorChange,
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

      {editable ? (
        <div className="maono-layer-inspector__editor">
          <label>
            Nome
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onBlur={() => onLabelChange(layer, label)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onLabelChange(layer, label);
                }
              }}
            />
          </label>

          <label>
            Opacidade: {Math.round(layer.opacity * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={layer.opacity}
              onChange={(event) =>
                onOpacityChange(layer, Number(event.target.value))
              }
            />
          </label>

          <label className="maono-layer-inspector__color">
            Cor
            <input
              type="color"
              value={toHex(layer.color)}
              onChange={(event) =>
                onColorChange(layer, fromHex(event.target.value))
              }
            />
          </label>

          <fieldset className="maono-layer-inspector__palettes">
            <legend>Paletas rápidas</legend>
            {MAONO_LAYER_PALETTES.map((palette) => (
              <span key={palette.id}>
                <small>{palette.label}</small>
                {palette.colors.map((color) => (
                  <button
                    type="button"
                    key={color.join("-")}
                    style={{
                      background: `rgb(${color.join(",")})`,
                    }}
                    onClick={() => onColorChange(layer, color)}
                    aria-label={`Aplicar ${palette.label} ${color.join(", ")}`}
                  />
                ))}
              </span>
            ))}
          </fieldset>
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
              onClick={() => {
                if (
                  window.confirm(
                    `Remover a camada “${layer.label}”?`,
                  )
                ) {
                  onRemove(layer.id);
                }
              }}
            >
              Remover
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
