import { MaonoSelect } from "../../../../components/selection/MaonoSelect";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useKeplerState } from "../../hooks/useKeplerState";
import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
} from "../../integration/keplerBridge.ts";
import FilterDetailView from "./FilterDetailView.tsx";
import FilterRow from "./FilterRow.tsx";
import LayerPanelIcon from "./LayerPanelIcon.tsx";
import { filterableDatasetFields } from "./filters/filter-utils.ts";
import { buildFilterGroups } from "./filters/filter-groups.ts";
import type { LayerSidebarAccents } from "./layer-sidebar-accents.ts";
import "./filters/advanced-filters.css";

type Props = {
  filters: MaonoFilterSnapshot[];
  datasets: MaonoDatasetSnapshot[];
  sidebarAccents: LayerSidebarAccents;
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

function firstFilterableField(dataset: MaonoDatasetSnapshot | undefined) {
  return dataset
    ? filterableDatasetFields(dataset.fields)[0]?.name ?? null
    : null;
}

export default function FilterPanel({
  filters,
  datasets,
  sidebarAccents,
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
  const groupIdPrefix = useId();
  const previousSelectedGroupKey = useRef<string | null>(null);
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

  const groups = useMemo(
    () => buildFilterGroups(filters, datasets, layers, sidebarAccents),
    [datasets, filters, layers, sidebarAccents],
  );

  // Keep the newly-created condition inside its dataset's expanded group.
  useEffect(() => {
    if (pendingFilterIndex === null) return;
    const group = groups.find((item) =>
      item.filters.some((filter) => filter.index === pendingFilterIndex),
    );
    const created = group?.filters.find((filter) => filter.index === pendingFilterIndex);
    if (group && created) {
      setExpandedGroupKey(group.key);
      setSelectedFilterId(created.id);
      setPendingFilterIndex(null);
    }
  }, [groups, pendingFilterIndex]);

  const selectedGroupKey = groups.find((group) =>
    group.filters.some((filter) => filter.id === selectedFilterId),
  )?.key ?? null;

  useEffect(() => {
    const previous = previousSelectedGroupKey.current;
    previousSelectedGroupKey.current = selectedGroupKey;
    // Rebinding a condition moves it between native dataset groups. Follow that
    // move, but never reopen a group merely because the user collapsed it.
    if (previous && selectedGroupKey && previous !== selectedGroupKey) {
      setExpandedGroupKey(selectedGroupKey);
    }
  }, [selectedGroupKey]);

  useEffect(() => {
    setExpandedGroupKey((current) =>
      current && !groups.some((group) => group.key === current) ? null : current,
    );
  }, [groups]);

  const addDataset = filterableDatasets.find(
    (item) => item.id === addDatasetId,
  );
  const addFields = addDataset
    ? filterableDatasetFields(addDataset.fields)
    : [];

  return (
    <section className="maono-filter-panel">
      {!editable ? <span hidden>consulta em somente leitura</span> : null}
      <header className="maono-layer-panel__toolbar maono-filter-panel__toolbar">
        {editable ? (
          <button
            type="button"
            className="maono-filter-add-button"
            aria-expanded={addOpen}
            aria-controls={`${groupIdPrefix}-add-filter`}
            onClick={() => setAddOpen((current) => !current)}
          >
            <LayerPanelIcon name="plus" />
            Adicionar Filtro
          </button>
        ) : (
          <span className="maono-readonly-badge">
            <LayerPanelIcon name="lock" /> Somente leitura
          </span>
        )}
      </header>

      <div className="maono-filter-list-region">
        {addOpen ? (
          <div id={`${groupIdPrefix}-add-filter`} className="maono-filter-add-flow">
            <label className="maono-style-field">
              <span>1. Base de dados</span>
              <MaonoSelect
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
              </MaonoSelect>
            </label>
            <label className="maono-style-field">
              <span>2. Propriedade</span>
              <MaonoSelect
                value={addFieldName}
                onChange={(event) => setAddFieldName(event.target.value)}
              >
                {addFields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.name}
                  </option>
                ))}
              </MaonoSelect>
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
              const regionId = `${groupIdPrefix}-${groups.indexOf(group)}`;

              return (
                <section
                  key={group.key}
                  className={`maono-filter-group maono-map-panel-row${expanded ? " is-expanded" : ""}`}
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
                    <LayerPanelIcon name="chevron-right" className="maono-filter-group__chevron" />
                  </button>

                  {expanded ? (
                    <div
                      id={regionId}
                      className="maono-filter-group__rows"
                      role="region"
                      aria-label={`Filtros de ${group.label}`}
                    >
                      {group.filters.map((filter) => selectedFilterId === filter.id ? (
                        <FilterDetailView
                          key={filter.id}
                          inline
                          filter={filter}
                          datasets={datasets}
                          editable={editable}
                          accent={group.accent}
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
                      ) : (
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
      </div>
    </section>
  );
}
