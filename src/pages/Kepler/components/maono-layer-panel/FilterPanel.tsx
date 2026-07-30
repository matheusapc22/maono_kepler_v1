import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
} from "../../integration/keplerBridge.ts";
import LayerPanelIcon from "./LayerPanelIcon.tsx";
import FilterValueEditor from "./filters/FilterValueEditor.tsx";
import {
  filterTypeLabel,
  filterValueLabel,
  filterableDatasetFields,
} from "./filters/filter-utils.ts";
import "./filters/advanced-filters.css";

type Props = {
  filters: MaonoFilterSnapshot[];
  datasets: MaonoDatasetSnapshot[];
  editable: boolean;
  onAdd: (dataId: string) => void;
  onBindField: (
    index: number,
    datasetId: string,
    fieldName: string,
  ) => void;
  onRemove: (index: number) => void;
  onChangeValue: (index: number, value: unknown) => void;
};

type FilterGroup = {
  key: string;
  label: string;
  dataset: MaonoDatasetSnapshot | null;
  filters: MaonoFilterSnapshot[];
};

const DATASET_ACCENTS = [
  "#C5A059",
  "#D6A63A",
  "#8FA6C6",
  "#B98B76",
  "#8DA399",
];

function formatCount(value: number | null) {
  return value === null ? "—" : value.toLocaleString("pt-BR");
}

function firstFilterableField(dataset: MaonoDatasetSnapshot | undefined) {
  return dataset
    ? filterableDatasetFields(dataset.fields)[0]?.name ?? null
    : null;
}

function FilterCard({
  filter,
  datasets,
  editable,
  accent,
  onBindField,
  onRemove,
  onChangeValue,
}: {
  filter: MaonoFilterSnapshot;
  datasets: MaonoDatasetSnapshot[];
  editable: boolean;
  accent: string;
  onBindField: Props["onBindField"];
  onRemove: Props["onRemove"];
  onChangeValue: Props["onChangeValue"];
}) {
  const datasetId = filter.dataIds[0] ?? "";
  const dataset =
    datasets.find((candidate) => candidate.id === datasetId) ?? null;
  const fieldName = filter.fieldNames[0] ?? "";
  const filterableDatasets = datasets.filter(
    (candidate) => firstFilterableField(candidate) !== null,
  );
  const fields = dataset ? filterableDatasetFields(dataset.fields) : [];
  const canEditConfiguration = editable && filter.compatible;

  function changeDataset(nextDatasetId: string) {
    const nextDataset = datasets.find(
      (candidate) => candidate.id === nextDatasetId,
    );
    const nextField = firstFilterableField(nextDataset);

    if (nextField) onBindField(filter.index, nextDatasetId, nextField);
  }

  return (
    <article
      className={`maono-filter-card${filter.enabled ? "" : " is-disabled"}`}
      style={{ "--maono-filter-accent": accent } as CSSProperties}
    >
      <header className="maono-filter-card__header">
        <div>
          <span>{filterTypeLabel(filter.type)}</span>
          <strong>{fieldName || `Filtro ${filter.index + 1}`}</strong>
        </div>
        <div className="maono-filter-card__header-actions">
          {!filter.enabled ? <small>Inativo</small> : null}
          {editable ? (
            <button
              type="button"
              onClick={() => onRemove(filter.index)}
              aria-label={`Remover filtro ${fieldName || filter.index + 1}`}
              title="Remover filtro"
            >
              <LayerPanelIcon name="trash" />
            </button>
          ) : null}
        </div>
      </header>

      {canEditConfiguration ? (
        <div className="maono-filter-card__binding">
          <label>
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
          <label>
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
        <dl className="maono-filter-card__facts">
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

      {filter.compatibilityReason ? (
        <p className="maono-filter-card__compatibility" role="status">
          <LayerPanelIcon name="warning" />
          <span>{filter.compatibilityReason}</span>
        </p>
      ) : null}

      <FilterValueEditor
        filter={filter}
        editable={editable}
        onChange={(value) => onChangeValue(filter.index, value)}
      />

      {!editable ? (
        <small className="maono-filter-card__readonly">
          Somente leitura · {filterValueLabel(filter)}
        </small>
      ) : null}
    </article>
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
}: Props) {
  const filterableDatasets = useMemo(
    () =>
      datasets.filter(
        (dataset) => firstFilterableField(dataset) !== null,
      ),
    [datasets],
  );
  const [addDatasetId, setAddDatasetId] = useState(
    filterableDatasets[0]?.id ?? "",
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (
      !filterableDatasets.some((dataset) => dataset.id === addDatasetId)
    ) {
      setAddDatasetId(filterableDatasets[0]?.id ?? "");
    }
  }, [addDatasetId, filterableDatasets]);

  const groups = useMemo<FilterGroup[]>(() => {
    const byKey = new Map<string, MaonoFilterSnapshot[]>();

    for (const filter of filters) {
      const key =
        filter.dataIds.length === 1
          ? filter.dataIds[0] || "__orphan__"
          : "__incompatible__";
      const current = byKey.get(key) ?? [];
      current.push(filter);
      byKey.set(key, current);
    }

    const ordered: FilterGroup[] = [];
    for (const dataset of datasets) {
      const datasetFilters = byKey.get(dataset.id);
      if (!datasetFilters?.length) continue;

      ordered.push({
        key: dataset.id,
        label: dataset.label,
        dataset,
        filters: datasetFilters,
      });
      byKey.delete(dataset.id);
    }

    for (const [key, remainingFilters] of byKey) {
      ordered.push({
        key,
        label:
          key === "__incompatible__"
            ? "Filtros sincronizados"
            : "Dataset indisponível",
        dataset: null,
        filters: remainingFilters,
      });
    }

    return ordered;
  }, [datasets, filters]);

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="maono-filter-panel">
      <header className="maono-filter-panel__heading">
        <div>
          <strong>Filtros</strong>
          <small>
            {editable
              ? "Combine condições; as alterações serão incluídas ao salvar."
              : "Consulta em somente leitura."}
          </small>
        </div>
        <span>{filters.length}</span>
      </header>

      {editable ? (
        <div className="maono-filter-panel__add">
          <label>
            <span>Adicionar filtro à base</span>
            <select
              value={addDatasetId}
              disabled={!filterableDatasets.length}
              onChange={(event) => setAddDatasetId(event.target.value)}
            >
              {!filterableDatasets.length ? (
                <option value="">Nenhuma base filtrável</option>
              ) : null}
              {filterableDatasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!addDatasetId}
            onClick={() => onAdd(addDatasetId)}
          >
            <LayerPanelIcon name="plus" />
            Adicionar
          </button>
        </div>
      ) : null}

      {!groups.length ? (
        <div className="maono-filter-panel__empty">
          <LayerPanelIcon name="filter" />
          <strong>Nenhum filtro configurado</strong>
          <span>
            {editable
              ? "Escolha uma base de dados para criar a primeira condição."
              : "Este mapa não possui filtros salvos."}
          </span>
        </div>
      ) : (
        <div className="maono-filter-groups">
          {groups.map((group, groupIndex) => {
            const collapsed = collapsedGroups.has(group.key);
            const accent =
              DATASET_ACCENTS[groupIndex % DATASET_ACCENTS.length] ??
              DATASET_ACCENTS[0];

            return (
              <section
                key={group.key}
                className="maono-filter-group"
                style={
                  {
                    "--maono-filter-accent": accent,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  className="maono-filter-group__heading"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className="maono-filter-group__accent" />
                  <span>
                    <strong>{group.label}</strong>
                    <small>
                      {group.dataset
                        ? `${formatCount(group.dataset.filteredRowCount)} de ${formatCount(
                            group.dataset.rowCount,
                          )} registros`
                        : "Configuração preservada em somente leitura"}
                    </small>
                  </span>
                  <em>{group.filters.length}</em>
                  <LayerPanelIcon
                    name={collapsed ? "chevron-down" : "chevron-up"}
                  />
                </button>

                {!collapsed ? (
                  <div className="maono-filter-group__content">
                    {group.filters.map((filter) => (
                      <FilterCard
                        key={filter.id}
                        filter={filter}
                        datasets={datasets}
                        editable={editable}
                        accent={accent}
                        onBindField={onBindField}
                        onRemove={onRemove}
                        onChangeValue={onChangeValue}
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
