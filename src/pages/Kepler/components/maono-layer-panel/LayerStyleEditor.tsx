import { useEffect, useMemo, useState } from "react";

import {
  LAYER_BLENDING_MODES,
  OVERLAY_BLENDING_MODES,
  fieldKind,
  scalesForField,
} from "../../engine-adapter/layer-style-management.ts";
import type {
  MapColorScale,
  MapLayerBlendingMode,
  MapOverlayBlendingMode,
  MapPaletteSelection,
  MapPointLayerType,
  MapRgbColor,
} from "../../engine-adapter/types.ts";
import type {
  MaonoDatasetSnapshot,
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge.ts";
import {
  DEFAULT_MAONO_PALETTE,
  MAONO_LAYER_PALETTES,
  hexToRgb,
  paletteById,
  paletteKindLabel,
  palettesForScale,
} from "./palettes.ts";

const COLOR_SCALE_LABELS: Record<MapColorScale, string> = {
  quantile: "Quantile (distribuição)",
  quantize: "Quantize (intervalos iguais)",
  linear: "Linear (contínua)",
  sqrt: "Raiz quadrada",
  log: "Logarítmica",
  ordinal: "Ordinal (categorias)",
};

const POINT_LAYER_TYPES: Array<{
  value: MapPointLayerType;
  label: string;
}> = [
  { value: "point", label: "Pontos" },
  { value: "cluster", label: "Agrupamentos (cluster)" },
  { value: "heatmap", label: "Mapa de calor (heatmap)" },
];

const LAYER_BLENDING_LABELS: Record<MapLayerBlendingMode, string> = {
  normal: "Normal",
  additive: "Aditivo",
  subtractive: "Subtrativo",
};

const OVERLAY_BLENDING_LABELS: Record<MapOverlayBlendingMode, string> = {
  normal: "Normal",
  screen: "Screen",
  darken: "Darken",
};

export type LayerStyleChange =
  | { kind: "type"; value: MapPointLayerType }
  | { kind: "opacity"; value: number }
  | { kind: "fillEnabled"; value: boolean }
  | { kind: "fillColor"; value: MapRgbColor }
  | { kind: "fillField"; value: string | null }
  | { kind: "fillScale"; value: MapColorScale }
  | { kind: "fillPalette"; value: MapPaletteSelection }
  | { kind: "strokeEnabled"; value: boolean }
  | { kind: "strokeColor"; value: MapRgbColor }
  | { kind: "strokeField"; value: string | null }
  | { kind: "strokeScale"; value: MapColorScale }
  | { kind: "strokePalette"; value: MapPaletteSelection }
  | { kind: "strokeOpacity"; value: number }
  | { kind: "strokeWidth"; value: number }
  | { kind: "pointRadius"; value: number }
  | { kind: "radiusField"; value: string | null }
  | { kind: "radiusRange"; value: [number, number] }
  | { kind: "clusterRadius"; value: number }
  | { kind: "heatmapRadius"; value: number }
  | { kind: "layerBlending"; value: MapLayerBlendingMode }
  | { kind: "overlayBlending"; value: MapOverlayBlendingMode };

type Props = {
  layer: MaonoLayerSnapshot;
  dataset: MaonoDatasetSnapshot | null;
  layerBlending: string | null;
  overlayBlending: string | null;
  onChange: (change: LayerStyleChange) => void;
};

type ColorChannelProps = {
  title: string;
  color: MapRgbColor;
  field: string | null;
  scale: MapColorScale | null;
  paletteId: string | null;
  palette: string[];
  fields: MaonoDatasetSnapshot["fields"];
  fixedColorEnabled?: boolean;
  paletteAlwaysVisible?: boolean;
  emptyFieldLabel?: string;
  onColorChange: (value: MapRgbColor) => void;
  onFieldChange: (value: string | null) => void;
  onScaleChange: (value: MapColorScale) => void;
  onPaletteChange: (value: MapPaletteSelection) => void;
};

function componentToHex(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function toHex(color: MapRgbColor) {
  return `#${color.map(componentToHex).join("")}`;
}

function isPointLayerType(value: string): value is MapPointLayerType {
  return value === "point" || value === "cluster" || value === "heatmap";
}

function isColorScale(value: string): value is MapColorScale {
  return Object.prototype.hasOwnProperty.call(COLOR_SCALE_LABELS, value);
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="maono-style-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  step,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const displayed =
    suffix === "%"
      ? Math.round(draft * 100)
      : step < 1
        ? Number(draft.toFixed(1))
        : Math.round(draft);

  const commit = () => {
    if (!Object.is(draft, value)) onCommit(draft);
  };

  return (
    <label className="maono-style-range">
      <span>
        {label}
        <output>
          {displayed}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

function PalettePicker({
  paletteId,
  colors,
  scale,
  onChange,
}: {
  paletteId: string | null;
  colors: string[];
  scale: MapColorScale | null;
  onChange: (palette: MapPaletteSelection) => void;
}) {
  const candidates = palettesForScale(scale);
  const selected = paletteById(paletteId);

  return (
    <div className="maono-style-palettes" aria-label="Paleta de cores">
      {candidates.map((palette) => {
        const active = selected
          ? selected.id === palette.id
          : colors.length === palette.colors.length &&
            colors.every(
              (color, index) =>
                color.toLocaleUpperCase() ===
                palette.colors[index]?.toLocaleUpperCase(),
            );

        return (
          <button
            type="button"
            key={palette.id}
            className={active ? "is-selected" : ""}
            aria-pressed={active}
            aria-label={`${palette.label}, ${paletteKindLabel(palette.kind)}`}
            onClick={() => onChange({
              id: palette.id,
              label: palette.label,
              kind: palette.kind,
              colors: [...palette.colors],
            })}
          >
            <span
              aria-hidden="true"
              style={{
                background: `linear-gradient(90deg, ${palette.colors.join(",")})`,
              }}
            />
            <small>{palette.label}</small>
            <em>{paletteKindLabel(palette.kind)}</em>
          </button>
        );
      })}
    </div>
  );
}

function ColorChannel({
  title,
  color,
  field,
  scale,
  paletteId,
  palette,
  fields,
  fixedColorEnabled = true,
  paletteAlwaysVisible = false,
  emptyFieldLabel = "Fixo (sem coluna)",
  onColorChange,
  onFieldChange,
  onScaleChange,
  onPaletteChange,
}: ColorChannelProps) {
  const selectedField = fields.find((candidate) => candidate.name === field) ?? null;
  const scales = scalesForField(selectedField);
  const effectiveScale = scale && scales.includes(scale) ? scale : scales[0] ?? "quantile";
  const activePalette =
    palette.length >= 2 ? palette : (DEFAULT_MAONO_PALETTE?.colors ?? []);
  const showPalette = paletteAlwaysVisible || Boolean(field);

  return (
    <div className="maono-style-channel">
      <strong>{title}</strong>

      {fixedColorEnabled && !field ? (
        <div className="maono-style-fixed-color">
          <label>
            <span>Cor fixa</span>
            <input
              type="color"
              value={toHex(color)}
              onChange={(event) => onColorChange(hexToRgb(event.target.value))}
            />
          </label>
          <div aria-label="Cores rápidas">
            {MAONO_LAYER_PALETTES.slice(0, 4).map((candidate) => {
              const quickColor =
                candidate.colors[Math.floor((candidate.colors.length - 1) / 2)] ??
                "#C5A059";
              return (
                <button
                  type="button"
                  key={candidate.id}
                  style={{ background: quickColor }}
                  onClick={() => onColorChange(hexToRgb(quickColor))}
                  aria-label={`Aplicar cor ${candidate.label}`}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {fields.length ? (
        <label className="maono-style-field">
          <span>Colorir por coluna</span>
          <select
            value={field ?? ""}
            onChange={(event) => onFieldChange(event.target.value || null)}
          >
            <option value="">{emptyFieldLabel}</option>
            {fields.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="maono-style-help">
          O dataset não possui campos disponíveis para coloração.
        </p>
      )}

      {field ? (
        <label className="maono-style-field">
          <span>Escala da cor</span>
          <select
            value={effectiveScale}
            onChange={(event) => {
              if (isColorScale(event.target.value)) {
                onScaleChange(event.target.value);
              }
            }}
          >
            {scales.map((candidate) => (
              <option key={candidate} value={candidate}>
                {COLOR_SCALE_LABELS[candidate]}
              </option>
            ))}
          </select>
          {selectedField ? (
            <small>
              Campo {fieldKind(selectedField) === "numeric" ? "numérico" : "categórico"}
            </small>
          ) : null}
        </label>
      ) : null}

      {showPalette ? (
        <>
          <span className="maono-style-label">Paleta de cores</span>
          <PalettePicker
            paletteId={paletteId}
            colors={activePalette}
            scale={field ? effectiveScale : null}
            onChange={onPaletteChange}
          />
        </>
      ) : null}
    </div>
  );
}

function isLayerBlendingMode(value: string): value is MapLayerBlendingMode {
  return LAYER_BLENDING_MODES.some((mode) => mode === value);
}

function isOverlayBlendingMode(value: string): value is MapOverlayBlendingMode {
  return OVERLAY_BLENDING_MODES.some((mode) => mode === value);
}

export default function LayerStyleEditor({
  layer,
  dataset,
  layerBlending,
  overlayBlending,
  onChange,
}: Props) {
  const { style } = layer;
  const pointFamily = isPointLayerType(layer.type);
  const datasetFields = dataset?.fields;
  const fields = useMemo(() => datasetFields ?? [], [datasetFields]);
  const numericFields = useMemo(
    () => fields.filter((candidate) => fieldKind(candidate) === "numeric"),
    [fields],
  );
  const compatibility = style.compatibility;
  const layerBlendingCandidate = layerBlending ?? "";
  const normalizedLayerBlending = isLayerBlendingMode(layerBlendingCandidate)
    ? layerBlendingCandidate
    : "normal";
  const overlayBlendingCandidate = overlayBlending ?? "";
  const normalizedOverlayBlending = isOverlayBlendingMode(overlayBlendingCandidate)
    ? overlayBlendingCandidate
    : "normal";

  if (!compatibility.supported) {
    return (
      <p className="maono-layer-inspector__notice">
        O estilo deste tipo continua disponível no configurador nativo do Kepler.
      </p>
    );
  }

  return (
    <div className="maono-layer-style-editor">
      <section className="maono-style-section">
        <header>
          <strong>Visualização</strong>
          <small>Formato, opacidade e dimensão</small>
        </header>

        {pointFamily ? (
          <label className="maono-style-field">
            <span>Formato de visualização</span>
            <select
              value={layer.type}
              onChange={(event) => {
                if (isPointLayerType(event.target.value)) {
                  onChange({ kind: "type", value: event.target.value });
                }
              }}
            >
              {POINT_LAYER_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {compatibility.opacity ? (
          <RangeControl
            label="Opacidade"
            value={style.opacity}
            minimum={0}
            maximum={1}
            step={0.05}
            suffix="%"
            onCommit={(value) => onChange({ kind: "opacity", value })}
          />
        ) : null}

        {compatibility.radius ? (
          <>
            <label className="maono-style-field">
              <span>Raio orientado por campo</span>
              <select
                value={style.radiusField ?? ""}
                onChange={(event) =>
                  onChange({kind: "radiusField", value: event.target.value || null})
                }
              >
                <option value="">Raio fixo</option>
                {numericFields.map((field) => (
                  <option key={field.name} value={field.name}>{field.name}</option>
                ))}
              </select>
            </label>
            {style.radiusField && compatibility.radiusRange ? (
              <div className="maono-style-range-pair">
                <RangeControl
                  label="Raio mínimo"
                  value={style.radiusRange?.[0] ?? 0}
                  minimum={0}
                  maximum={500}
                  step={1}
                  suffix=" px"
                  onCommit={(minimum) =>
                    onChange({
                      kind: "radiusRange",
                      value: [minimum, Math.max(minimum, style.radiusRange?.[1] ?? 50)],
                    })
                  }
                />
                <RangeControl
                  label="Raio máximo"
                  value={style.radiusRange?.[1] ?? 50}
                  minimum={0}
                  maximum={500}
                  step={1}
                  suffix=" px"
                  onCommit={(maximum) =>
                    onChange({
                      kind: "radiusRange",
                      value: [Math.min(maximum, style.radiusRange?.[0] ?? 0), maximum],
                    })
                  }
                />
              </div>
            ) : (
              <RangeControl
                label={layer.type === "geojson" ? "Raio de pontos GeoJSON" : "Raio do ponto"}
                value={style.pointRadius ?? 10}
                minimum={0}
                maximum={100}
                step={0.5}
                suffix=" px"
                onCommit={(value) => onChange({ kind: "pointRadius", value })}
              />
            )}
          </>
        ) : null}

        {compatibility.clusterRadius ? (
          <>
            <RangeControl
              label="Raio de agregação"
              value={style.clusterRadius ?? 40}
              minimum={1}
              maximum={500}
              step={1}
              suffix=" px"
              onCommit={(value) => onChange({ kind: "clusterRadius", value })}
            />
            {compatibility.radiusRange ? (
              <div className="maono-style-range-pair">
                <RangeControl
                  label="Símbolo mínimo"
                  value={style.radiusRange?.[0] ?? 1}
                  minimum={1}
                  maximum={150}
                  step={1}
                  suffix=" px"
                  onCommit={(minimum) =>
                    onChange({
                      kind: "radiusRange",
                      value: [minimum, Math.max(minimum, style.radiusRange?.[1] ?? 40)],
                    })
                  }
                />
                <RangeControl
                  label="Símbolo máximo"
                  value={style.radiusRange?.[1] ?? 40}
                  minimum={1}
                  maximum={150}
                  step={1}
                  suffix=" px"
                  onCommit={(maximum) =>
                    onChange({
                      kind: "radiusRange",
                      value: [Math.min(maximum, style.radiusRange?.[0] ?? 1), maximum],
                    })
                  }
                />
              </div>
            ) : null}
          </>
        ) : null}

        {compatibility.heatmapRadius ? (
          <RangeControl
            label="Raio do mapa de calor"
            value={style.heatmapRadius ?? 20}
            minimum={0}
            maximum={100}
            step={1}
            suffix=" px"
            onCommit={(value) => onChange({ kind: "heatmapRadius", value })}
          />
        ) : null}
      </section>

      {compatibility.fill ? (
        <section className="maono-style-section">
          <header>
            <div>
              <strong>Preenchimento</strong>
              <small>Cor fixa ou orientada por atributo</small>
            </div>
            <Toggle
              checked={style.fillEnabled}
              label="Ativar preenchimento"
              onChange={(value) => onChange({ kind: "fillEnabled", value })}
            />
          </header>

          {style.fillEnabled ? (
            <ColorChannel
              title="Cor do preenchimento"
              color={style.color}
              field={style.colorField}
              scale={style.colorScale}
              paletteId={style.colorPaletteId}
              palette={style.colorPalette}
              fields={fields}
              onColorChange={(value) => onChange({ kind: "fillColor", value })}
              onFieldChange={(value) => onChange({ kind: "fillField", value })}
              onScaleChange={(value) => onChange({ kind: "fillScale", value })}
              onPaletteChange={(value) => onChange({ kind: "fillPalette", value })}
            />
          ) : null}
        </section>
      ) : null}

      {layer.type === "cluster" ? (
        <section className="maono-style-section">
          <header>
            <strong>Cores do agrupamento</strong>
            <small>Contagem de pontos ou atributo agregado</small>
          </header>
          <ColorChannel
            title="Cor dos clusters"
            color={style.color}
            field={style.colorField}
            scale={style.colorScale}
            paletteId={style.colorPaletteId}
            palette={style.colorPalette}
            fields={fields}
            fixedColorEnabled={false}
            paletteAlwaysVisible
            emptyFieldLabel="Contagem de pontos"
            onColorChange={() => undefined}
            onFieldChange={(value) => onChange({kind: "fillField", value})}
            onScaleChange={(value) => onChange({kind: "fillScale", value})}
            onPaletteChange={(value) => onChange({kind: "fillPalette", value})}
          />
        </section>
      ) : layer.type === "heatmap" ? (
        <section className="maono-style-section">
          <header>
            <strong>Gradiente do mapa de calor</strong>
            <small>Paleta aplicada à densidade</small>
          </header>
          <PalettePicker
            paletteId={style.colorPaletteId}
            colors={style.colorPalette.length >= 2 ? style.colorPalette : (DEFAULT_MAONO_PALETTE?.colors ?? [])}
            scale="quantile"
            onChange={(value) => onChange({ kind: "fillPalette", value })}
          />
        </section>
      ) : null}

      {compatibility.stroke ? (
        <section className="maono-style-section">
          <header>
            <div>
              <strong>Contorno</strong>
              <small>Cor e espessura das bordas</small>
            </div>
            <Toggle
              checked={style.strokeEnabled}
              label="Ativar contorno"
              onChange={(value) => onChange({ kind: "strokeEnabled", value })}
            />
          </header>

          {style.strokeEnabled ? (
            <>
              <ColorChannel
                title="Cor do contorno"
                color={style.strokeColor}
                field={style.strokeColorField}
                scale={style.strokeColorScale}
                paletteId={style.strokeColorPaletteId}
                palette={style.strokeColorPalette}
                fields={fields}
                onColorChange={(value) => onChange({ kind: "strokeColor", value })}
                onFieldChange={(value) => onChange({ kind: "strokeField", value })}
                onScaleChange={(value) => onChange({ kind: "strokeScale", value })}
                onPaletteChange={(value) => onChange({ kind: "strokePalette", value })}
              />

              <RangeControl
                label="Espessura"
                value={style.strokeWidth}
                minimum={0}
                maximum={100}
                step={0.1}
                suffix=" px"
                onCommit={(value) => onChange({ kind: "strokeWidth", value })}
              />

              {layer.type === "geojson" ? (
                <RangeControl
                  label="Opacidade do contorno"
                  value={style.strokeOpacity}
                  minimum={0}
                  maximum={1}
                  step={0.05}
                  suffix="%"
                  onCommit={(value) => onChange({ kind: "strokeOpacity", value })}
                />
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <section className="maono-style-section">
        <header>
          <strong>Composição do mapa</strong>
          <small>Blending global confirmado pelo Kepler 3.2.0</small>
        </header>
        <label className="maono-style-field">
          <span>Camadas de dados</span>
          <select
            value={normalizedLayerBlending}
            onChange={(event) => {
              if (isLayerBlendingMode(event.target.value)) {
                onChange({kind: "layerBlending", value: event.target.value});
              }
            }}
          >
            {LAYER_BLENDING_MODES.map((mode) => (
              <option key={mode} value={mode}>{LAYER_BLENDING_LABELS[mode]}</option>
            ))}
          </select>
        </label>
        <label className="maono-style-field">
          <span>Overlays sobre o basemap</span>
          <select
            value={normalizedOverlayBlending}
            onChange={(event) => {
              if (isOverlayBlendingMode(event.target.value)) {
                onChange({kind: "overlayBlending", value: event.target.value});
              }
            }}
          >
            {OVERLAY_BLENDING_MODES.map((mode) => (
              <option key={mode} value={mode}>{OVERLAY_BLENDING_LABELS[mode]}</option>
            ))}
          </select>
        </label>
        <p className="maono-style-help">
          Estes modos são globais. Eles não alteram a composição interna do mapa-base.
        </p>
      </section>
    </div>
  );
}
