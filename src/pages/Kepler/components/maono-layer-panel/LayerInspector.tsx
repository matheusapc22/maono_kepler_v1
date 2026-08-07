import { useState } from "react";

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
import LayerPanelIcon from "./LayerPanelIcon";
import LayerStyleEditor, {
  type LayerStyleChange,
} from "./LayerStyleEditor";
import PointSpatialGroupingSection from "./PointSpatialGroupingSection";

type Props = {
  layer: MaonoLayerSnapshot | null;
  datasets: MaonoDatasetSnapshot[];
  canToggle: boolean;
  canEditStructure: boolean;
  canEditStyle: boolean;
  layerBlending: string | null;
  overlayBlending: string | null;
  onToggle: (layer: MaonoLayerSnapshot, visible: boolean) => void;
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
  canToggle,
  canEditStructure,
  canEditStyle,
  layerBlending,
  overlayBlending,
  onToggle,
  onDatasetChange,
  onColumnsChange,
  onStyleChange,
}: Props) {
  const [structureError, setStructureError] = useState<string | null>(null);

  if (!layer) {
    return (
      <div className="maono-layer-inspector is-empty">
        Selecione uma camada para consultar seus detalhes.
      </div>
    );
  }

  const activeLayer = layer;
  const datasetId = activeLayer.dataIds[0] ?? null;
  const dataset =
    datasets.find((candidate) => candidate.id === datasetId) ?? null;
  const structure = activeLayer.structure;
  const structuralColumns = [
    ...structure.requiredColumns,
    ...structure.optionalColumns,
  ];
  const grouping = (
    <PointSpatialGroupingSection
      layerId={activeLayer.id}
      editable={canEditStructure || canEditStyle}
    />
  );

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
      <section className="maono-layer-essential" aria-label="Configurações essenciais">
        <header>
          <div>
            <span>Camada</span>
            <strong>{layerTypeLabel(activeLayer.type)}</strong>
          </div>
          <button
            type="button"
            className="maono-layer-visibility-switch"
            role="switch"
            aria-checked={activeLayer.isVisible}
            disabled={!canToggle}
            onClick={() => onToggle(activeLayer, !activeLayer.isVisible)}
          >
            <LayerPanelIcon name={activeLayer.isVisible ? "eye" : "eye-off"} />
            <span>{activeLayer.isVisible ? "Visível" : "Oculta"}</span>
          </button>
        </header>
        <dl>
          <div>
            <dt>Dataset</dt>
            <dd>{dataset?.label ?? datasetId ?? "Não informado"}</dd>
          </div>
          <div>
            <dt>Registros</dt>
            <dd>{dataset?.filteredRowCount ?? dataset?.rowCount ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {canEditStyle ? (
        <LayerStyleEditor
          layer={activeLayer}
          dataset={dataset}
          layerBlending={layerBlending}
          overlayBlending={overlayBlending}
          dimensionAddon={grouping}
          onChange={(change) => onStyleChange(activeLayer, change)}
        />
      ) : (
        <>
          <p className="maono-layer-inspector__notice">
            Modo de visualização: a aparência permanece somente leitura.
          </p>
          <details className="maono-progressive-section">
            <summary>
              <span>
                <strong>Dimensão e agrupamento</strong>
                <small>Configuração de pontos por zoom</small>
              </span>
              <LayerPanelIcon name="chevron-down" />
            </summary>
            <div className="maono-progressive-section__content">{grouping}</div>
          </details>
        </>
      )}

      <details className="maono-progressive-section maono-layer-data-section">
        <summary>
          <span>
            <strong>Dados</strong>
            <small>Dataset e campos geográficos</small>
          </span>
          <LayerPanelIcon name="chevron-down" />
        </summary>
        <div className="maono-progressive-section__content">
          {structure.supported ? (
            <section className="maono-layer-structure" aria-label="Estrutura da camada">
              <label className="maono-style-field">
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
                      <label key={column} className="maono-style-field">
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
                          aria-invalid={required && !current ? "true" : undefined}
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
              Este tipo continua disponível no Kepler nativo, mas sua estrutura
              não pode ser alterada com segurança no painel Maõno.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
