import type { CSSProperties } from "react";

import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
} from "../../integration/keplerBridge.ts";
import FilterValueEditor from "./filters/FilterValueEditor.tsx";
import {
  filterTypeLabel,
  filterValueLabel,
  filterableDatasetFields,
} from "./filters/filter-utils.ts";
import LayerPanelIcon from "./LayerPanelIcon.tsx";
import PanelActionMenu, { type PanelActionMenuItem } from "./PanelActionMenu.tsx";

type Props = {
  filter: MaonoFilterSnapshot;
  datasets: MaonoDatasetSnapshot[];
  editable: boolean;
  accent: string;
  onBack: () => void;
  onBindField: (index: number, datasetId: string, fieldName: string) => void;
  onChangeValue: (index: number, value: unknown) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  onFocusResults: () => void;
  onExportCsv: (datasetId: string, label: string) => void;
};

function firstFilterableField(dataset: MaonoDatasetSnapshot | undefined) {
  return dataset
    ? filterableDatasetFields(dataset.fields)[0]?.name ?? null
    : null;
}

export default function FilterDetailView({
  filter,
  datasets,
  editable,
  accent,
  onBack,
  onBindField,
  onChangeValue,
  onToggle,
  onRemove,
  onFocusResults,
  onExportCsv,
}: Props) {
  const datasetId = filter.dataIds[0] ?? "";
  const dataset = datasets.find((item) => item.id === datasetId) ?? null;
  const fieldName = filter.fieldNames[0] ?? "";
  const fields = dataset ? filterableDatasetFields(dataset.fields) : [];
  const filterableDatasets = datasets.filter(
    (candidate) => firstFilterableField(candidate) !== null,
  );
  const canEdit = editable && filter.compatible;
  const title = fieldName || `Filtro ${filter.index + 1}`;
  const menuItems: PanelActionMenuItem[] = [];

  if (datasetId) {
    menuItems.push({
      label: "Exportar resultados (CSV)",
      icon: "download",
      onSelect: () => onExportCsv(datasetId, dataset?.label ?? title),
    });
  }
  if (editable) {
    menuItems.push({
      label: "Remover filtro",
      icon: "trash",
      danger: true,
      separatorBefore: menuItems.length > 0,
      onSelect: () => onRemove(filter.index),
    });
  }

  function changeDataset(nextDatasetId: string) {
    const nextDataset = datasets.find((candidate) => candidate.id === nextDatasetId);
    const nextField = firstFilterableField(nextDataset);
    if (nextField) onBindField(filter.index, nextDatasetId, nextField);
  }

  return (
    <section
      className="maono-detail-view maono-filter-detail"
      style={{ "--maono-filter-accent": accent } as CSSProperties}
      aria-label={`Configuração de ${title}`}
    >
      <header className="maono-detail-view__header">
        <button
          type="button"
          className="maono-detail-view__back"
          onClick={onBack}
          aria-label="Voltar para a lista de filtros"
          title="Voltar para filtros"
        >
          <LayerPanelIcon name="arrow-left" />
        </button>
        <div className="maono-detail-view__identity">
          <strong>{title}</strong>
          <small>{filterTypeLabel(filter.type)} · {filterValueLabel(filter)}</small>
        </div>
        {menuItems.length ? (
          <PanelActionMenu label={`Ações de ${title}`} items={menuItems} />
        ) : null}
      </header>

      <div className="maono-detail-view__scroll">
        <section className="maono-filter-essential">
          <header>
            <div>
              <span>Filtro</span>
              <strong>{filter.enabled ? "Ativo" : "Inativo"}</strong>
            </div>
            <button
              type="button"
              className="maono-style-toggle"
              role="switch"
              aria-checked={filter.enabled}
              disabled={!canEdit}
              onClick={() => onToggle(filter.index, !filter.enabled)}
            >
              <span aria-hidden="true" />
            </button>
          </header>

          {canEdit ? (
            <div className="maono-filter-binding">
              <label className="maono-style-field">
                <span>Base de dados</span>
                <select
                  value={datasetId}
                  onChange={(event) => changeDataset(event.target.value)}
                >
                  {filterableDatasets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="maono-style-field">
                <span>Propriedade</span>
                <select
                  value={fieldName}
                  onChange={(event) =>
                    onBindField(filter.index, datasetId, event.target.value)
                  }
                >
                  {fields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <dl className="maono-filter-facts">
              <div>
                <dt>Base</dt>
                <dd>{dataset?.label ?? (datasetId || "Não encontrada")}</dd>
              </div>
              <div>
                <dt>Propriedade</dt>
                <dd>{fieldName || "Não encontrada"}</dd>
              </div>
            </dl>
          )}
        </section>

        {filter.compatibilityReason ? (
          <p className="maono-filter-compatibility" role="status">
            <LayerPanelIcon name="warning" />
            <span>{filter.compatibilityReason}</span>
          </p>
        ) : null}

        <section className="maono-filter-value-section">
          <header>
            <strong>Valor do filtro</strong>
            <small>O mapa responde à alteração após a confirmação.</small>
          </header>
          <FilterValueEditor
            filter={filter}
            editable={editable}
            onChange={(value) => onChangeValue(filter.index, value)}
          />
        </section>

        <button
          type="button"
          className="maono-filter-focus-results"
          onClick={onFocusResults}
        >
          <LayerPanelIcon name="settings" />
          Centralizar resultados filtrados
        </button>

        {!editable ? (
          <small className="maono-filter-card__readonly">
            Somente leitura · {filterValueLabel(filter)}
          </small>
        ) : null}
      </div>
    </section>
  );
}
