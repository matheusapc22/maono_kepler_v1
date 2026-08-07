import { useEffect, useMemo, useState } from "react";

import { useKeplerState } from "../../hooks/useKeplerState";
import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
  MaonoLayerSnapshot,
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
  layerId: string | null;
};

const FALLBACK_ACCENTS = [
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

function layerAccent(
  layer: MaonoLayerSnapshot | undefined,
  fallbackIndex: number,
) {
  if (layer?.color?.length === 3) {
    const [red, green, blue] = layer.color.map((value) =>
      Math.max(0, Math.min(255, Math.round(Number(value) || 0))),
    );
    return `rgb(${red} ${green} ${blue})`;
  }

  return (
    FALLBACK_ACCENTS[fallbackIndex % FALLBACK_ACCENTS.length] ??
    FALLBACK_ACCENTS[0]
  );
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
  const { layers } = useKeplerState();
  const filterableDatasets = useMemo(
    () => datasets.filter((dataset) => firstFilterableField(dataset) !== null),
    [datasets],
  );
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
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
    if (
      selectedFilterId &&
      !filters.some((filter) => filter.id === selectedFilterId)
    ) {
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
    const byDatasetId = new Map<string, MaonoFilterSnapshot[]>();
    for (const filter of filters) {
      const key =
        filter.dataIds.length === 1
          ? filter.dataIds[0] || "__orphan__"
          : "__incompatible__";
      byDatasetId.set(key, [
        ...(byDatasetId.get(key) ?? []),
        filter,
      ]);
    }

    const ordered: FilterGroup[] = [];
    const representedDatasetIds = new Set<string>();

    layers.forEach((layer, layerIndex) => {
      layer.dataIds.forEach((datasetId) => {
        if (!datasetId || representedDatasetIds.has(datasetId)) return;
        const groupFilters = byDatasetId.get(datasetId);
        if (!groupFilters?.length) return;

        ordered.push({
          key: datasetId,
          label: layer.label,
          dataset: datasets.find((dataset) => dataset.id === datasetId) ?? null,
          filters: groupFilters,
          accent: layerAccent(layer, layerIndex),
          layerId: layer.id,
        });
        representedDatasetIds.add(datasetId);
        byDatasetId.delete(datasetId);
      });
    });

    datasets.forEach((dataset, datasetIndex) => {
      if (representedDatasetIds.has(dataset.id)) return;
      const groupFilters = byDatasetId.get(dataset.id);
      if (!groupFilters?.length) return;

      ordered.push({
        key: dataset.id,
        label: dataset.label,
        dataset,
        filters: groupFilters,
        accent: layerAccent(undefined, datasetIndex),
        layerId: null,
      });
      representedDatasetIds.add(dataset.id);
      byDatasetId.delete(dataset.id);
    });

    for (const [key, remaining] of byDatasetId) {
      ordered.push({
        key,
        label:
          key === "__incompatible__"
            ? "Filtros sincronizados"
            : "Dados sem camada",
        dataset: null,
        filters: remaining,
        accent: "#8C9FBA",
        layerId: null,
      });
    }

    return ordered;
  }, [datasets, filters, layers]);

  useEffect(() => {
    if (
      expandedGroupKey &&
      !groups.some((group) => group.key === expandedGroupKey)
    ) {
      setExpandedGroupKey(null);
    }
  }, [expandedGroupKey, groups]);

  const selectedFilter =
    filters.find((filter) => filter.id === selectedFilterId) ?? null;
  const selectedGroup = selectedFilter
    ? groups.find((group) =>
        group.filters.some((filter) => filter.id === selectedFilter.id),
      )
    : null;

  if (selectedFilter) {
    return (
      <FilterDetailView
        filter={selectedFilter}
        datasets={datasets}
        editable={editable}
        accent={selectedGroup?.accent ?? FALLBACK_ACCENTS[0]}
        onBack={() => {
          if (selectedGroup) setExpandedGroupKey(selectedGroup.key);
          setSelectedFilterId(null);
        }}
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

  const addDataset = filterableDatasets.find(
    (item) => item.id === addDatasetId,
  );
  const addFields = addDataset
    ? filterableDatasetFields(addDataset.fields)
    : [];

  return (
    <section className="maono-filter-panel">
      {!editable ? <span hidden>consulta em somente leitura</span> : null}
      <header className="maono-collection-heading">
        <div>
          <strong>Filtros</strong>
          <small>
            {filters.length} {filters.length === 1 ? "condição" : "condições"}
          </small>
        </div>
        {editable ? (
          <button
            type="button"
            onClick={() => setAddOpen((current) => !current)}
          >
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
                const next = filterableDatasets.find(
                  (item) => item.id === nextId,
                );
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
          <LayerPanelIcon
            name="filter"
            className="maono-layer-panel__empty-icon"
          />
          <strong>Nenhum filtro configurado</strong>
          <span>
            {editable
              ? "Adicione uma condição para restringir os dados exibidos."
              : "Este mapa não possui filtros salvos."}
          </span>
        </div>
      ) : (
        <div className="maono-filter-groups">
          {groups.map((group) => {
            const expanded = expandedGroupKey === group.key;
            const regionId = `maono-filter-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

            return (
              <section
                key={group.key}
                className={`maono-filter-group${expanded ? " is-expanded" : ""}`}
                data-layer-id={group.layerId ?? undefined}
              >
                <button
                  type="button"
                  className="maono-filter-group__toggle"
                  aria-expanded={expanded}
                  aria-controls={regionId}
                  onClick={() =>
                    setExpandedGroupKey((current) =>
                      current === group.key ? null : group.key,
                    )
                  }
                >
                  <span
                    className="maono-filter-group__accent"
                    style={{ background: group.accent }}
                    aria-hidden="true"
                  />
                  <strong title={group.label}>{group.label}</strong>
                  <LayerPanelIcon
                    name={expanded ? "chevron-up" : "chevron-down"}
                  />
                </button>

                {expanded ? (
                  <div
                    id={regionId}
                    className="maono-filter-group__rows"
                    role="region"
                    aria-label={`Filtros da camada ${group.label}`}
                  >
                    {group.filters.map((filter) => (
                      <FilterRow
                        key={filter.id}
                        filter={filter}
                        accent={group.accent}
                        editable={editable}
                        onOpen={(item) => {
                          setExpandedGroupKey(group.key);
                          setSelectedFilterId(item.id);
                        }}
                        onToggle={(item, enabled) =>
                          onToggleEnabled(item.index, enabled)
                        }
                        onRemove={(item) => onRemove(item.index)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
