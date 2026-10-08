import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MapFilterDomainValue } from "../../../engine-adapter/types.ts";
import { useSmartFilterHistogram } from "../../../engine-adapter/useSmartFilterHistogram.ts";
import type { MaonoFilterSnapshot } from "../../../integration/keplerBridge.ts";
import NumericInput from "../NumericInput";
import FilterHistogram from "./FilterHistogram.tsx";
import {
  filterDomainValueLabel,
  filterValueLabel,
  inputValueToTimestamp,
  numberPair,
  sameFilterValue,
  selectedFilterValues,
  timestampToInputValue,
} from "./filter-utils.ts";

type Props = {
  filter: MaonoFilterSnapshot;
  editable: boolean;
  onChange: (value: unknown) => void;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function useStableRange(range: [number, number] | null) {
  const minimum = range?.[0] ?? null;
  const maximum = range?.[1] ?? null;
  return useMemo<[number, number] | null>(
    () => minimum === null || maximum === null ? null : [minimum, maximum],
    [minimum, maximum],
  );
}

function NumericRangeEditor({
  filter,
  onChange,
}: {
  filter: MaonoFilterSnapshot;
  onChange: (value: [number, number]) => void;
}) {
  const histogram = useSmartFilterHistogram(filter);
  const domain = useStableRange(numberPair(filter.domain, filter.domain));
  const value = useStableRange(numberPair(filter.value, filter.domain) ?? domain);
  const [draft, setDraft] = useState<[number, number] | null>(value);
  const appliedRangeRef = useRef(value);

  useEffect(() => {
    setDraft(value);
    appliedRangeRef.current = value;
  }, [value]);

  if (!domain || !draft) {
    return (
      <p className="maono-filter-editor__empty">
        Não foi possível calcular um domínio numérico válido para este campo.
      </p>
    );
  }

  const currentDomain = domain;
  const currentDraft = draft;
  const span = Math.max(0, currentDomain[1] - currentDomain[0]);
  const inputStep = filter.step ?? Math.max(span / 100, 0.0001);
  const brushStep = filter.step ?? Math.max(span / 1000, 0.0001);

  function commit(next: [number, number] = currentDraft) {
    if (!sameFilterValue(next, appliedRangeRef.current)) {
      appliedRangeRef.current = next;
      onChange(next);
    }
  }

  function updateBrush(next: [number, number]) {
    setDraft(next);
    // This updates the working filter on every move, without saving the map.
    commit(next);
  }

  return (
    <div className="maono-filter-editor is-range">
      <FilterHistogram
        histogram={histogram}
        selectedRange={currentDraft}
        editable={currentDomain[1] > currentDomain[0]}
        step={brushStep}
        onRangeChange={updateBrush}
        onRangeCommit={commit}
      />

      <div className="maono-filter-range__numbers">
        <label>
          <span>Mínimo</span>
          <NumericInput
            label="Mínimo"
            minimum={currentDomain[0]}
            maximum={currentDraft[1]}
            step={inputStep}
            value={currentDraft[0]}
            onPreview={(next) => setDraft([next, currentDraft[1]])}
            onCommit={(next) => commit([next, currentDraft[1]])}
          />
        </label>
        <label>
          <span>Máximo</span>
          <NumericInput
            label="Máximo"
            minimum={currentDraft[0]}
            maximum={currentDomain[1]}
            step={inputStep}
            value={currentDraft[1]}
            onPreview={(next) => setDraft([currentDraft[0], next])}
            onCommit={(next) => commit([currentDraft[0], next])}
          />
        </label>
      </div>

      <button
        type="button"
        className="maono-filter-editor__reset"
        disabled={sameFilterValue(value, currentDomain)}
        onClick={() => {
          updateBrush(currentDomain);
        }}
      >
        Restaurar domínio completo
      </button>
    </div>
  );
}

function TimeRangeEditor({
  filter,
  onChange,
}: {
  filter: MaonoFilterSnapshot;
  onChange: (value: [number, number]) => void;
}) {
  const histogram = useSmartFilterHistogram(filter);
  const domain = useStableRange(numberPair(filter.domain, filter.domain));
  const value = useStableRange(numberPair(filter.value, filter.domain) ?? domain);
  // Keep exact timestamps separate from minute-formatted date inputs. Otherwise
  // a live pointer update would round the band and change its visual width.
  const [draft, setDraft] = useState<[number, number] | null>(value);
  const appliedRangeRef = useRef(value);
  const [minimum, setMinimum] = useState(
    value ? timestampToInputValue(value[0]) : "",
  );
  const [maximum, setMaximum] = useState(
    value ? timestampToInputValue(value[1]) : "",
  );

  useEffect(() => {
    setDraft(value);
    appliedRangeRef.current = value;
    setMinimum(value ? timestampToInputValue(value[0]) : "");
    setMaximum(value ? timestampToInputValue(value[1]) : "");
  }, [value]);

  if (!domain || !value || !draft) {
    return (
      <p className="maono-filter-editor__empty">
        Não foi possível calcular um período válido para este campo.
      </p>
    );
  }

  const currentDomain = domain;
  const currentValue = value;
  const currentDraft = draft;
  const minimumDomain = timestampToInputValue(currentDomain[0]);
  const maximumDomain = timestampToInputValue(currentDomain[1]);
  const brushStep = Math.max((currentDomain[1] - currentDomain[0]) / 1000, 1);

  function updateBrush(next: [number, number]) {
    setDraft(next);
    setMinimum(timestampToInputValue(next[0]));
    setMaximum(timestampToInputValue(next[1]));
    if (!sameFilterValue(next, appliedRangeRef.current)) {
      appliedRangeRef.current = next;
      onChange(next);
    }
  }

  function commit() {
    const nextMinimum = inputValueToTimestamp(minimum);
    const nextMaximum = inputValueToTimestamp(maximum);
    if (nextMinimum === null || nextMaximum === null || nextMinimum > nextMaximum) {
      setDraft(currentValue);
      setMinimum(timestampToInputValue(currentValue[0]));
      setMaximum(timestampToInputValue(currentValue[1]));
      return;
    }
    // An untouched input must not truncate seconds/milliseconds from a brush.
    const next: [number, number] = [
      minimum === timestampToInputValue(currentDraft[0]) ? currentDraft[0]
        : clamp(nextMinimum, currentDomain[0], currentDomain[1]),
      maximum === timestampToInputValue(currentDraft[1]) ? currentDraft[1]
        : clamp(nextMaximum, currentDomain[0], currentDomain[1]),
    ];
    // Rounded input strings can appear ordered while an untouched endpoint
    // still has seconds. Validate the actual tuple before applying it.
    if (next[0] > next[1]) {
      setDraft(currentValue);
      setMinimum(timestampToInputValue(currentValue[0]));
      setMaximum(timestampToInputValue(currentValue[1]));
      return;
    }
    updateBrush(next);
  }

  function previewInput(text: string, index: 0 | 1) {
    if (index === 0) setMinimum(text);
    else setMaximum(text);
    const parsed = inputValueToTimestamp(text);
    if (parsed === null) return;
    const next: [number, number] = [...currentDraft];
    next[index] = clamp(parsed, currentDomain[0], currentDomain[1]);
    if (next[0] <= next[1]) setDraft(next);
  }

  return (
    <div className="maono-filter-editor is-time">
      <FilterHistogram
        histogram={histogram}
        selectedRange={currentDraft}
        editable={currentDomain[1] > currentDomain[0]}
        step={brushStep}
        onRangeChange={updateBrush}
        onRangeCommit={updateBrush}
      />

      <div className="maono-filter-time__inputs">
        <label>
          <span>De</span>
          <input
            type="datetime-local"
            min={minimumDomain}
            max={maximum || maximumDomain}
            value={minimum}
            onChange={(event) => previewInput(event.target.value, 0)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label>
          <span>Até</span>
          <input
            type="datetime-local"
            min={minimum || minimumDomain}
            max={maximumDomain}
            value={maximum}
            onChange={(event) => previewInput(event.target.value, 1)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      </div>

      <button
        type="button"
        className="maono-filter-editor__reset"
        disabled={sameFilterValue(currentValue, currentDomain)}
        onClick={() => updateBrush(currentDomain)}
      >
        Restaurar período completo
      </button>
    </div>
  );
}

function CategoryEditor({
  filter,
  onChange,
}: {
  filter: MaonoFilterSnapshot;
  onChange: (value: MapFilterDomainValue[]) => void;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const selected = selectedFilterValues(filter.value);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();

  const matching = useMemo(() => {
    const values = normalizedSearch
      ? filter.domain.filter((value) =>
          filterDomainValueLabel(value)
            .toLocaleLowerCase()
            .includes(normalizedSearch),
        )
      : [...filter.domain];

    return values.sort((left, right) => {
      const selectedDifference =
        Number(selectedSet.has(right)) - Number(selectedSet.has(left));

      return (
        selectedDifference ||
        filterDomainValueLabel(left).localeCompare(
          filterDomainValueLabel(right),
          "pt-BR",
        )
      );
    });
  }, [filter.domain, normalizedSearch, selectedSet]);

  function toggle(value: MapFilterDomainValue) {
    const next = selectedSet.has(value)
      ? selected.filter((candidate) => !Object.is(candidate, value))
      : [...selected, value];

    onChange(next);
  }

  return (
    <div className="maono-filter-editor is-category">
      <div className="maono-filter-category__summary">
        <span>
          {selected.length
            ? `${selected.length} selecionada${selected.length === 1 ? "" : "s"}`
            : "Todas as categorias"}
        </span>
        {selected.length ? (
          <button type="button" onClick={() => onChange([])}>
            Limpar seleção
          </button>
        ) : null}
      </div>

      <label className="maono-filter-category__search">
        <span>Pesquisar categoria</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Digite para localizar"
        />
      </label>

      {filter.domainTruncated ? (
        <p className="maono-filter-editor__warning">
          A lista de valores desta propriedade está incompleta na origem do filtro.
        </p>
      ) : null}

      <div className="maono-filter-category__options">
        {matching.length ? (
          matching.map((value, index) => {
            const checked = selectedSet.has(value);

            return (
              <label key={`${typeof value}-${String(value)}-${index}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(value)}
                />
                <span aria-hidden="true" />
                <strong>{filterDomainValueLabel(value)}</strong>
              </label>
            );
          })
        ) : (
          <p>Nenhuma categoria encontrada.</p>
        )}
      </div>
    </div>
  );
}

function BooleanEditor({
  filterId,
  value,
  onChange,
}: {
  filterId: string;
  value: unknown;
  onChange: (value: boolean) => void;
}) {
  return (
    <fieldset className="maono-filter-editor is-boolean">
      <legend>Valor aceito</legend>
      {[true, false].map((candidate) => (
        <label key={String(candidate)}>
          <input
            type="radio"
            name={`maono-filter-boolean-${filterId}`}
            checked={value === candidate}
            onChange={() => onChange(candidate)}
          />
          <span>{candidate ? "Sim / verdadeiro" : "Não / falso"}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function FilterValueEditor({
  filter,
  editable,
  onChange,
}: Props) {
  if (!editable || !filter.compatible) {
    return (
      <span className="maono-filter-list__readonly-value">
        {filterValueLabel(filter)}
      </span>
    );
  }

  if (filter.type === "range") {
    return <NumericRangeEditor key={filter.id} filter={filter} onChange={onChange} />;
  }
  if (filter.type === "timeRange") {
    return <TimeRangeEditor filter={filter} onChange={onChange} />;
  }
  if (filter.type === "multiSelect") {
    return <CategoryEditor filter={filter} onChange={onChange} />;
  }
  if (filter.type === "select") {
    return (
      <BooleanEditor
        filterId={filter.id}
        value={filter.value}
        onChange={onChange}
      />
    );
  }

  return (
    <p className="maono-filter-editor__empty">
      A edição deste filtro permanece disponível no painel nativo.
    </p>
  );
}
