import { useEffect, useMemo, useState } from "react";

import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
} from "../../integration/keplerBridge.ts";
import FilterDetailView from "./FilterDetailView.tsx";
import FilterRow from "./FilterRow.tsx";
import LayerPanelIcon from "./LayerPanelIcon.tsx";
import { filterableDatasetFields } from "./filters/filter-utils.ts";
import "./filters/advanced-filters.css";

type Props = {
  filters: MaonoFilterSnapshot[];
  datasets: MaonoDatasetSnapshot[];
  editable: boolean;
  onAdd: (dataId: string, fieldName: string) => number | null;
  onBindField: (
    index: number,
    datasetId: string,
    fieldName: string,
  ) => void;
  onRemove: (index: number) => void;
  onChangeValue: (index: number, value: unknown) => void;
  onToggleEnabled: (index: number, enabled: boolean) => void;
  onFocusResults: () => void;
  onExportCsv: (datasetId: string, label: string) => void;
};

type FilterGroup = {
  key: string;
  label: string;
  dataset: MaonoDatasetSnapshot | null;
  filters: MaonoFilterSnapshot[];
  accent: string;
};

const DATASET_ACCENTS = [
  "#C5A059",
  "#D6A63A",
  "#8FA6C6",
  "#B98B76",
  "#8DA399",
];

function firstFilterableField(dataset: MaonoDatasetSnapshot | undefined) {
  return dataset
    ? filterableDatasetFields(dataset.fields)[0]?.name ?? null
    : null;
}

export default function FilterPanel({
  filters,
  datasets,
  editable,
  onAdd,
  onBindField,
  onRemove,
  onChangeValue,
  onToggleEnabled,
  onFocusResults,
  onExportCsv,
}: Props) {
  const filterableDatasets = useMemo(
    () => datasets.filter((dataset) => firstFilterableField(dataset) !== null),
    [datasets],
  );
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDatasetId, setAddDatasetId] = useState(filterableDatasets[0]?.id ?? "");
  const [addFieldName, setAddFieldName] = useState(
    firstFilterableField(filterableDatasets[0]) ?? "",
  );
  const [pendingFilterIndex, setPendingFilterIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!filterableDatasets.some((dataset) => dataset.id === addDatasetId)) {
      const first = filterableDatasets[0];
      setAddDatasetId(first?.id ?? "");
      setAddFieldName(firstFilterableField(first) ?? "");
    }
  }, [addDatasetId, filterableDatasets]);

  useEffect(() => {
    if (selectedFilterId && !filters.some((filter) => filter.id === selectedFilterId)) {
      setSelectedFilterId(null);
    }
  }, [filters, selectedFilterId]);

  useEffect(() => {
    if (pendingFilterIndex === null) return;
    const created = filters.find((filter) => filter.index === pendingFilterIndex);
    if (created) {
      setSelectedFilterId(created.id);
      setPendingFilterIndex(null);
    }
  }, [filters, pendingFilterIndex]);

  const groups = useMemo<FilterGroup[]>(() => {
    const byKey = new Map<string, MaonoFilterSnapshot[]>();
    for (const filter of filters) {
      const key =
        filter.dataIds.length === 1
          ? filter.dataIds[0] || "__orphan__"
          : "__incompatible__";
      byKey.set(key, [...(byKey.get(key) ?? []), filter]);
    }

    const ordered: FilterGroup[] = [];
    datasets.forEach((dataset, index) => {
      const datasetFilters = byKey.get(dataset.id);
      if (!datasetFilters?.length) return;
      ordered.push({
        key: dataset.id,
        label: dataset.label,
        dataset,
        filters: datasetFilters,
        accent: DATASET_ACCENTS[index % DATASET_ACCENTS.length] ?? DATASET_ACCENTS[0],
      });
      byKey.delete(dataset.id);
    });

    for (const [key, remaining] of byKey) {
      ordered.push({
        key,
        label: key === "__incompatible__" ? "Filtros sincronizados" : "Dataset indisponível",
        dataset: null,
        filters: remaining,
        accent: "#8C9FBA",
      });
    }
    return ordered;
  }, [datasets, filters]);

  const selectedFilter =
    filters.find((filter) => filter.id === selectedFilterId) ?? null;
  const selectedGroup = selectedFilter
    ? groups.find((group) => group.filters.some((filter) => filter.id === selectedFilter.id))
    : null;

  if (selectedFilter) {
    return (
      <FilterDetailView
        filter={selectedFilter}
        datasets={datasets}
        editable={editable}
        accent={selectedGroup?.accent ?? DATASET_ACCENTS[0]}
        onBack={() => setSelectedFilterId(null)}
        onBindField={onBindField}
        onChangeValue={onChangeValue}
        onToggle={onToggleEnabled}
        onRemove={(index) => {
          onRemove(index);
          setSelectedFilterId(null);
        }}
        onFocusResults={onFocusResults}
        onExportCsv={onExportCsv}
      />
    );
  }

  const addDataset = filterableDatasets.find((item) => item.id === addDatasetId);
  const addFields = addDataset ? filterableDatasetFields(addDataset.fields) : [];

  return (
    <section className="maono-filter-panel">
      {!editable ? <span hidden>consulta em somente leitura</span> : null}
      <header className="maono-collection-heading">
        <div>
          <strong>Filtros</strong>
          <small>{filters.length} {filters.length === 1 ? "condição" : "condições"}</small>
        </div>
        {editable ? (
          <button type="button" onClick={() => setAddOpen((current) => !current)}>
            <LayerPanelIcon name={addOpen ? "x" : "plus"} />
            {addOpen ? "Fechar" : "Adicionar"}
          </button>
        ) : (
          <span className="maono-readonly-badge">
            <LayerPanelIcon name="lock" /> Somente leitura
          </span>
        )}
      </header>

      {addOpen ? (
        <div className="maono-filter-add-flow">
          <label className="maono-style-field">
            <span>1. Base de dados</span>
            <select
              value={addDatasetId}
              onChange={(event) => {
                const nextId = event.target.value;
                const next = filterableDatasets.find((item) => item.id === nextId);
                setAddDatasetId(nextId);
                setAddFieldName(firstFilterableField(next) ?? "");
              }}
            >
              {filterableDatasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="maono-style-field">
            <span>2. Propriedade</span>
            <select
              value={addFieldName}
              onChange={(event) => setAddFieldName(event.target.value)}
            >
              {addFields.map((field) => (
                <option key={field.name} value={field.name}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!addDatasetId || !addFieldName}
            onClick={() => {
              const index = onAdd(addDatasetId, addFieldName);
              if (index !== null) {
                setPendingFilterIndex(index);
                setAddOpen(false);
              }
            }}
          >
            Criar filtro
          </button>
        </div>
      ) : null}

      {!groups.length ? (
        <div className="maono-layer-panel__empty">
          <LayerPanelIcon name="filter" className="maono-layer-panel__empty-icon" />
          <strong>Nenhum filtro configurado</strong>
          <span>
            {editable
              ? "Adicione uma condição para restringir os dados exibidos."
              : "Este mapa não possui filtros salvos."}
          </span>
        </div>
      ) : (
        <div className="maono-filter-groups">
          {groups.map((group) => (
            <section key={group.key} className="maono-filter-group">
              <header className="maono-filter-group__heading">
                <span style={{ background: group.accent }} aria-hidden="true" />
                <div>
                  <strong>{group.label}</strong>
                  <small>
                    {group.dataset
                      ? `${group.dataset.filteredRowCount ?? "—"} de ${group.dataset.rowCount ?? "—"} registros`
                      : "Configuração preservada"}
                  </small>
                </div>
                <em>{group.filters.length}</em>
              </header>
              <div className="maono-filter-group__rows">
                {group.filters.map((filter) => (
                  <FilterRow
                    key={filter.id}
                    filter={filter}
                    accent={group.accent}
                    editable={editable}
                    onOpen={(item) => setSelectedFilterId(item.id)}
                    onToggle={(item, enabled) => onToggleEnabled(item.index, enabled)}
                    onRemove={(item) => onRemove(item.index)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
