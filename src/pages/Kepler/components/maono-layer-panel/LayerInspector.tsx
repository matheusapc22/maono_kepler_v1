import { useEffect, useRef, useState } from "react";

import {
  fieldSupportsLayerColumn,
  layerTypeLabel,
  type MapLayerColumnKey,
  type MapLayerColumns,
} from "../../engine-adapter";
import type {
  MaonoDatasetSnapshot,
  MaonoLayerSnapshot,
} from "../../integration/keplerBridge";
import LayerStyleEditor, {
  type LayerStyleChange,
} from "./LayerStyleEditor";
import PointSpatialGroupingSection from "./PointSpatialGroupingSection";

type Props = {
  layer: MaonoLayerSnapshot | null;
  datasets: MaonoDatasetSnapshot[];
  canRename: boolean;
  canEditStructure: boolean;
  canEditStyle: boolean;
  layerBlending: string | null;
  overlayBlending: string | null;
  onLabelChange: (layer: MaonoLayerSnapshot, label: string) => boolean;
  onDatasetChange: (layer: MaonoLayerSnapshot, datasetId: string) => boolean;
  onColumnsChange: (
    layer: MaonoLayerSnapshot,
    columns: Partial<MapLayerColumns>,
  ) => boolean;
  onStyleChange: (
    layer: MaonoLayerSnapshot,
    change: LayerStyleChange,
  ) => void;
};

const COLUMN_LABELS: Record<MapLayerColumnKey, string> = {
  latitude: "Latitude",
  longitude: "Longitude",
  geojson: "Geometria GeoJSON",
  altitude: "Altitude",
};

export default function LayerInspector({
  layer,
  datasets,
  canRename,
  canEditStructure,
  canEditStyle,
  layerBlending,
  overlayBlending,
  onLabelChange,
  onDatasetChange,
  onColumnsChange,
  onStyleChange,
}: Props) {
  const [label, setLabel] = useState(layer?.label || "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const ignoreNextNameBlurRef = useRef(false);
  const nameCommitRef = useRef(false);

  function guardImmediateNameBlur() {
    ignoreNextNameBlurRef.current = true;
    window.setTimeout(() => {
      ignoreNextNameBlurRef.current = false;
    }, 0);
  }

  useEffect(() => {
    setLabel(layer?.label || "");
    setNameError(null);
    setStructureError(null);
  }, [layer?.id, layer?.label]);

  if (!layer) {
    return (
      <div className="maono-layer-inspector is-empty">
        Selecione uma camada para consultar seus detalhes.
      </div>
    );
  }

  const activeLayer = layer;
  const nameErrorId = `maono-layer-name-error-${encodeURIComponent(
    activeLayer.id,
  )}`;
  const datasetId = activeLayer.dataIds[0] ?? null;
  const dataset =
    datasets.find((candidate) => candidate.id === datasetId) ?? null;
  const structure = activeLayer.structure;
  const structuralColumns = [
    ...structure.requiredColumns,
    ...structure.optionalColumns,
  ];

  function commitName() {
    if (nameCommitRef.current) return;
    const normalized = label.trim();

    if (!normalized) {
      setNameError("Informe um nome para a camada.");
      return;
    }
    if (normalized === activeLayer.label) {
      setNameError(null);
      setLabel(activeLayer.label);
      return;
    }

    nameCommitRef.current = true;
    const changed = onLabelChange(activeLayer, normalized);
    window.setTimeout(() => {
      nameCommitRef.current = false;
    }, 0);

    if (!changed) {
      setNameError("O nome anterior foi preservado.");
      setLabel(activeLayer.label);
      return;
    }

    setNameError(null);
  }

  function changeDataset(nextDatasetId: string) {
    if (!nextDatasetId || nextDatasetId === datasetId) return;

    if (!onDatasetChange(activeLayer, nextDatasetId)) {
      setStructureError(
        "O dataset selecionado não possui uma geometria compatível com esta camada.",
      );
      return;
    }

    setStructureError(null);
  }

  function changeColumn(column: MapLayerColumnKey, fieldName: string) {
    const nextValue = fieldName || null;
    if (activeLayer.columns[column] === nextValue) return;

    if (!onColumnsChange(activeLayer, { [column]: nextValue })) {
      setStructureError(
        `A combinação informada para ${COLUMN_LABELS[column]} é inválida.`,
      );
      return;
    }

    setStructureError(null);
  }

  return (
    <section className="maono-layer-inspector">
      <div className="maono-layer-inspector__heading">
        <span>Configurações da camada</span>
        <strong>{activeLayer.label}</strong>
      </div>

      <dl className="maono-layer-inspector__facts">
        <div>
          <dt>Tipo</dt>
          <dd>{layerTypeLabel(activeLayer.type)}</dd>
        </div>
        <div>
          <dt>Dataset</dt>
          <dd>{dataset?.label ?? datasetId ?? "Não informado"}</dd>
        </div>
        <div>
          <dt>Visibilidade</dt>
          <dd>{activeLayer.isVisible ? "Visível" : "Oculta"}</dd>
        </div>
      </dl>

      <PointSpatialGroupingSection
        layerId={activeLayer.id}
        editable={canEditStructure || canEditStyle}
      />

      {canRename || canEditStructure || canEditStyle ? (
        <div className="maono-layer-inspector__editor">
          {canRename ? (
            <label className="maono-layer-inspector__name">
              Nome
              <input
                value={label}
                maxLength={160}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setNameError(null);
                }}
                onBlur={() => {
                  if (ignoreNextNameBlurRef.current) {
                    ignoreNextNameBlurRef.current = false;
                    return;
                  }
                  commitName();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    guardImmediateNameBlur();
                    commitName();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    guardImmediateNameBlur();
                    setLabel(activeLayer.label);
                    setNameError(null);
                    event.currentTarget.blur();
                  }
                }}
                aria-invalid={nameError ? "true" : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
              />
              {nameError ? (
                <small id={nameErrorId} role="alert">
                  {nameError}
                </small>
              ) : null}
            </label>
          ) : null}

          {structure.supported ? (
            <section className="maono-layer-structure" aria-label="Estrutura da camada">
              <header>
                <div>
                  <strong>Estrutura</strong>
                  <small>Dataset e campos geográficos</small>
                </div>
              </header>

              <label className="maono-layer-structure__field">
                <span>Dataset associado</span>
                <select
                  value={datasetId ?? ""}
                  disabled={!canEditStructure}
                  onChange={(event) => changeDataset(event.target.value)}
                  aria-invalid={structureError ? "true" : undefined}
                >
                  <option value="" disabled>
                    Selecione um dataset
                  </option>
                  {datasets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>

              {dataset ? (
                <div className="maono-layer-structure__columns">
                  {structuralColumns.map((column) => {
                    const required = structure.requiredColumns.includes(column);
                    const compatibleFields = dataset.fields.filter((field) =>
                      fieldSupportsLayerColumn(field, column),
                    );
                    const current = activeLayer.columns[column];
                    const currentIncluded = compatibleFields.some(
                      (field) => field.name === current,
                    );

                    return (
                      <label key={column} className="maono-layer-structure__field">
                        <span>
                          {COLUMN_LABELS[column]}
                          {required ? " *" : ""}
                        </span>
                        <select
                          value={current ?? ""}
                          disabled={!canEditStructure}
                          onChange={(event) =>
                            changeColumn(column, event.target.value)
                          }
                          aria-required={required}
                          aria-invalid={
                            required && !current ? "true" : undefined
                          }
                        >
                          <option value="">
                            {required ? "Selecione um campo" : "Não utilizar"}
                          </option>
                          {!currentIncluded && current ? (
                            <option value={current} disabled>
                              {current} (incompatível)
                            </option>
                          ) : null}
                          {compatibleFields.map((field) => (
                            <option key={field.name} value={field.name}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="maono-layer-inspector__notice">
                  Associe um dataset para configurar os campos geográficos.
                </p>
              )}

              {structureError ? (
                <p className="maono-layer-structure__error" role="alert">
                  {structureError}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="maono-layer-inspector__notice">
              Este tipo de camada continua disponível no Kepler nativo, mas a
              edição estrutural ainda não é segura no painel Maõno.
            </p>
          )}

          {canEditStyle ? (
            <LayerStyleEditor
              layer={layer}
              dataset={dataset}
              layerBlending={layerBlending}
              overlayBlending={overlayBlending}
              onChange={(change) => onStyleChange(activeLayer, change)}
            />
          ) : null}
        </div>
      ) : (
        <p className="maono-layer-inspector__notice">
          Modo de visualização: a estrutura e o estilo permanecem somente leitura.
        </p>
      )}
    </section>
  );
}
