import type {
  MapColorScale,
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
} from "./palettes.ts";

const COLOR_SCALES: Array<{
  value: MapColorScale;
  label: string;
}> = [
  { value: "quantile", label: "Quantile (distribuição)" },
  { value: "quantize", label: "Quantize (intervalos iguais)" },
  { value: "linear", label: "Linear (contínua)" },
  { value: "ordinal", label: "Ordinal (categorias)" },
];

const POINT_LAYER_TYPES: Array<{
  value: MapPointLayerType;
  label: string;
}> = [
  { value: "point", label: "Pontos" },
  { value: "cluster", label: "Agrupamentos (cluster)" },
  { value: "heatmap", label: "Mapa de calor (heatmap)" },
];

export type LayerStyleChange =
  | { kind: "type"; value: MapPointLayerType }
  | { kind: "opacity"; value: number }
  | { kind: "fillEnabled"; value: boolean }
  | { kind: "fillColor"; value: MapRgbColor }
  | { kind: "fillField"; value: string | null }
  | { kind: "fillScale"; value: MapColorScale }
  | { kind: "fillPalette"; value: string[] }
  | { kind: "strokeEnabled"; value: boolean }
  | { kind: "strokeColor"; value: MapRgbColor }
  | { kind: "strokeField"; value: string | null }
  | { kind: "strokeScale"; value: MapColorScale }
  | { kind: "strokePalette"; value: string[] }
  | { kind: "strokeOpacity"; value: number }
  | { kind: "strokeWidth"; value: number }
  | { kind: "pointRadius"; value: number }
  | { kind: "clusterRadius"; value: number }
  | { kind: "heatmapRadius"; value: number };

type Props = {
  layer: MaonoLayerSnapshot;
  dataset: MaonoDatasetSnapshot | null;
  onChange: (change: LayerStyleChange) => void;
};

type ColorChannelProps = {
  title: string;
  color: MapRgbColor;
  field: string | null;
  scale: MapColorScale | null;
  palette: string[];
  fields: MaonoDatasetSnapshot["fields"];
  fixedColorEnabled?: boolean;
  paletteAlwaysVisible?: boolean;
  onColorChange: (value: MapRgbColor) => void;
  onFieldChange: (value: string | null) => void;
  onScaleChange: (value: MapColorScale) => void;
  onPaletteChange: (value: string[]) => void;
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
  return (
    value === "quantile" ||
    value === "quantize" ||
    value === "linear" ||
    value === "ordinal"
  );
}

function palettesMatch(current: string[], candidate: string[]) {
  if (current.length !== candidate.length) return false;

  return current.every(
    (color, index) =>
      color.toLocaleUpperCase() === candidate[index]?.toLocaleUpperCase(),
  );
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
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const displayed =
    suffix === "%"
      ? Math.round(value * 100)
      : step < 1
        ? Number(value.toFixed(1))
        : Math.round(value);

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
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function PalettePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (colors: string[]) => void;
}) {
  return (
    <div className="maono-style-palettes" aria-label="Paleta de cores">
      {MAONO_LAYER_PALETTES.map((palette) => (
        <button
          type="button"
          key={palette.id}
          className={
            palettesMatch(value, palette.colors) ? "is-selected" : ""
          }
          aria-pressed={palettesMatch(value, palette.colors)}
          onClick={() => onChange([...palette.colors])}
        >
          <span
            aria-hidden="true"
            style={{
              background: `linear-gradient(90deg, ${palette.colors.join(",")})`,
            }}
          />
          <small>{palette.label}</small>
        </button>
      ))}
    </div>
  );
}

function ColorChannel({
  title,
  color,
  field,
  scale,
  palette,
  fields,
  fixedColorEnabled = true,
  paletteAlwaysVisible = false,
  onColorChange,
  onFieldChange,
  onScaleChange,
  onPaletteChange,
}: ColorChannelProps) {
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
            {MAONO_LAYER_PALETTES.map((candidate) => {
              const quickColor =
                candidate.colors[
                  Math.floor((candidate.colors.length - 1) / 2)
                ] ?? "#C5A059";

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
            onChange={(event) =>
              onFieldChange(event.target.value || null)
            }
          >
            <option value="">Fixo (sem coluna)</option>
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

      {field || paletteAlwaysVisible ? (
        <label className="maono-style-field">
          <span>Escala da cor</span>
          <select
            value={scale ?? "quantile"}
            onChange={(event) => {
              if (isColorScale(event.target.value)) {
                onScaleChange(event.target.value);
              }
            }}
          >
            {COLOR_SCALES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showPalette ? (
        <>
          <span className="maono-style-label">Paleta de cores</span>
          <PalettePicker value={activePalette} onChange={onPaletteChange} />
        </>
      ) : null}
    </div>
  );
}

export default function LayerStyleEditor({
  layer,
  dataset,
  onChange,
}: Props) {
  const { style } = layer;
  const pointFamily = isPointLayerType(layer.type);
  const supportsFill = layer.type !== "cluster" && layer.type !== "heatmap";
  const supportsStroke =
    layer.type === "point" ||
    layer.type === "geojson" ||
    style.strokeEnabled;
  const fields = dataset?.fields ?? [];

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

        <RangeControl
          label="Opacidade"
          value={style.opacity}
          minimum={0}
          maximum={1}
          step={0.05}
          suffix="%"
          onChange={(value) =>
            onChange({ kind: "opacity", value })
          }
        />

        {layer.type === "point" ? (
          <RangeControl
            label="Raio do ponto"
            value={style.pointRadius ?? 10}
            minimum={0}
            maximum={100}
            step={0.5}
            suffix=" px"
            onChange={(value) =>
              onChange({ kind: "pointRadius", value })
            }
          />
        ) : null}

        {layer.type === "cluster" ? (
          <RangeControl
            label="Raio do agrupamento"
            value={style.clusterRadius ?? 40}
            minimum={1}
            maximum={500}
            step={1}
            suffix=" px"
            onChange={(value) =>
              onChange({ kind: "clusterRadius", value })
            }
          />
        ) : null}

        {layer.type === "heatmap" ? (
          <RangeControl
            label="Raio do mapa de calor"
            value={style.heatmapRadius ?? 20}
            minimum={0}
            maximum={100}
            step={1}
            suffix=" px"
            onChange={(value) =>
              onChange({ kind: "heatmapRadius", value })
            }
          />
        ) : null}
      </section>

      {supportsFill ? (
        <section className="maono-style-section">
          <header>
            <div>
              <strong>Preenchimento</strong>
              <small>Cor fixa ou orientada por atributo</small>
            </div>
            <Toggle
              checked={style.fillEnabled}
              label="Ativar preenchimento"
              onChange={(value) =>
                onChange({ kind: "fillEnabled", value })
              }
            />
          </header>

          {style.fillEnabled ? (
            <ColorChannel
              title="Cor do preenchimento"
              color={style.color}
              field={style.colorField}
              scale={style.colorScale}
              palette={style.colorPalette}
              fields={fields}
              onColorChange={(value) =>
                onChange({ kind: "fillColor", value })
              }
              onFieldChange={(value) =>
                onChange({ kind: "fillField", value })
              }
              onScaleChange={(value) =>
                onChange({ kind: "fillScale", value })
              }
              onPaletteChange={(value) =>
                onChange({ kind: "fillPalette", value })
              }
            />
          ) : null}
        </section>
      ) : null}

      {layer.type === "cluster" ? (
        <section className="maono-style-section">
          <header>
            <strong>Cores do agrupamento</strong>
            <small>Escala aplicada à concentração de pontos</small>
          </header>
          <ColorChannel
            title="Distribuição dos clusters"
            color={style.color}
            field={style.colorField}
            scale={style.colorScale}
            palette={style.colorPalette}
            fields={fields}
            fixedColorEnabled={false}
            paletteAlwaysVisible
            onColorChange={(value) =>
              onChange({ kind: "fillColor", value })
            }
            onFieldChange={(value) =>
              onChange({ kind: "fillField", value })
            }
            onScaleChange={(value) =>
              onChange({ kind: "fillScale", value })
            }
            onPaletteChange={(value) =>
              onChange({ kind: "fillPalette", value })
            }
          />
        </section>
      ) : null}

      {layer.type === "heatmap" ? (
        <section className="maono-style-section">
          <header>
            <strong>Gradiente do mapa de calor</strong>
            <small>Paleta aplicada à densidade</small>
          </header>
          <PalettePicker
            value={
              style.colorPalette.length >= 2
                ? style.colorPalette
                : (DEFAULT_MAONO_PALETTE?.colors ?? [])
            }
            onChange={(value) =>
              onChange({ kind: "fillPalette", value })
            }
          />
        </section>
      ) : null}

      {supportsStroke ? (
        <section className="maono-style-section">
          <header>
            <div>
              <strong>Contorno</strong>
              <small>Cor e espessura das bordas</small>
            </div>
            <Toggle
              checked={style.strokeEnabled}
              label="Ativar contorno"
              onChange={(value) =>
                onChange({ kind: "strokeEnabled", value })
              }
            />
          </header>

          {style.strokeEnabled ? (
            <>
              <ColorChannel
                title="Cor do contorno"
                color={style.strokeColor}
                field={style.strokeColorField}
                scale={style.strokeColorScale}
                palette={style.strokeColorPalette}
                fields={fields}
                onColorChange={(value) =>
                  onChange({ kind: "strokeColor", value })
                }
                onFieldChange={(value) =>
                  onChange({ kind: "strokeField", value })
                }
                onScaleChange={(value) =>
                  onChange({ kind: "strokeScale", value })
                }
                onPaletteChange={(value) =>
                  onChange({ kind: "strokePalette", value })
                }
              />

              <RangeControl
                label="Espessura"
                value={style.strokeWidth}
                minimum={0}
                maximum={20}
                step={0.1}
                suffix=" px"
                onChange={(value) =>
                  onChange({ kind: "strokeWidth", value })
                }
              />

              {layer.type === "geojson" ? (
                <RangeControl
                  label="Opacidade do contorno"
                  value={style.strokeOpacity}
                  minimum={0}
                  maximum={1}
                  step={0.05}
                  suffix="%"
                  onChange={(value) =>
                    onChange({ kind: "strokeOpacity", value })
                  }
                />
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
