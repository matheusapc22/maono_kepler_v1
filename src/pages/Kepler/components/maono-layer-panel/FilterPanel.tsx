import {
  useEffect,
  useState,
} from "react";

import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
} from "../../integration/keplerBridge";

type Props = {
  filters: MaonoFilterSnapshot[];
  datasets: MaonoDatasetSnapshot[];
  editable: boolean;
  onAdd: (dataId: string | null) => void;
  onRemove: (index: number) => void;
  onChangeValue: (index: number, value: unknown) => void;
};

function filterName(filter: MaonoFilterSnapshot) {
  if (Array.isArray(filter.name)) {
    return filter.name.filter(Boolean).join(", ");
  }
  return filter.name || `Filtro ${filter.index + 1}`;
}

function serializeFilterValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";

  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function parseFilterValue(value: string): unknown {
  const normalized = value.trim();
  if (!normalized) return "";

  try {
    return JSON.parse(normalized);
  } catch {
    return value;
  }
}

function FilterValueEditor({
  filter,
  onChange,
}: {
  filter: MaonoFilterSnapshot;
  onChange: (index: number, value: unknown) => void;
}) {
  const serializedValue = serializeFilterValue(filter.value);
  const [draft, setDraft] = useState(serializedValue);

  useEffect(() => {
    setDraft(serializedValue);
  }, [serializedValue]);

  function commit() {
    if (draft !== serializedValue) {
      onChange(filter.index, parseFilterValue(draft));
    }
  }

  return (
    <label className="maono-filter-list__value">
      <span>Valor</span>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.blur();
          }
        }}
        aria-label={`Valor de ${filterName(filter)}`}
      />
    </label>
  );
}

export default function FilterPanel({
  filters,
  datasets,
  editable,
  onAdd,
  onRemove,
  onChangeValue,
}: Props) {
  return (
    <section className="maono-filter-panel">
      <header>
        <div>
          <strong>Filtros</strong>
          <small>
            {editable
              ? "Alterações serão incluídas ao salvar."
              : "Consulta em somente leitura."}
          </small>
        </div>
        {editable ? (
          <button
            type="button"
            disabled={!datasets.length}
            onClick={() => onAdd(datasets[0]?.id ?? null)}
          >
            Adicionar
          </button>
        ) : null}
      </header>

      {!filters.length ? (
        <p className="maono-layer-panel__empty">
          Nenhum filtro configurado.
        </p>
      ) : (
        <ol className="maono-filter-list">
          {filters.map((filter) => (
            <li key={filter.id}>
              <div className="maono-filter-list__summary">
                <strong>{filterName(filter)}</strong>
                <small>
                  {filter.type} · {filter.enabled ? "ativo" : "inativo"}
                </small>
              </div>
              {editable ? (
                <FilterValueEditor
                  filter={filter}
                  onChange={onChangeValue}
                />
              ) : (
                <span className="maono-filter-list__readonly-value">
                  {serializeFilterValue(filter.value) || "Sem valor"}
                </span>
              )}
              {editable ? (
                <button
                  type="button"
                  onClick={() => onRemove(filter.index)}
                  aria-label={`Remover ${filterName(filter)}`}
                >
                  Remover
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
