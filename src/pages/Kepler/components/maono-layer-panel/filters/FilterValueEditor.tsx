import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { MapFilterDomainValue } from "../../../engine-adapter/types.ts";
import { useSmartFilterHistogram } from "../../../engine-adapter/useSmartFilterHistogram.ts";
import type { MaonoFilterSnapshot } from "../../../integration/keplerBridge.ts";
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

function NumericRangeEditor({
  filter,
  onChange,
}: {
  filter: MaonoFilterSnapshot;
  onChange: (value: [number, number]) => void;
}) {
  const histogram = useSmartFilterHistogram(filter);
  const domain = numberPair(filter.domain, filter.domain);
  const value = numberPair(filter.value, filter.domain) ?? domain;
  const [draft, setDraft] = useState<[number, number] | null>(value);

  useEffect(() => {
    setDraft(value);
  }, [value?.[0], value?.[1]]);

  if (!domain || !draft) {
    return (
      <p className="maono-filter-editor__empty">
        O Kepler não calculou um domínio numérico válido para este campo.
      </p>
    );
  }

  const currentDomain = domain;
  const currentDraft = draft;
  const span = Math.max(0, currentDomain[1] - currentDomain[0]);
  const inputStep = filter.step ?? Math.max(span / 100, 0.0001);
  const brushStep = filter.step ?? Math.max(span / 1000, 0.0001);

  function commit(next: [number, number] = currentDraft) {
    if (!sameFilterValue(next, value)) onChange(next);
  }

  function updateMinimum(next: number) {
    setDraft([
      Math.min(clamp(next, currentDomain[0], currentDomain[1]), currentDraft[1]),
      currentDraft[1],
    ]);
  }

  function updateMaximum(next: number) {
    setDraft([
      currentDraft[0],
      Math.max(
        clamp(next, currentDomain[0], currentDomain[1]),
        currentDraft[0],
      ),
    ]);
  }

  return (
    <div className="maono-filter-editor is-range">
      <FilterHistogram
        histogram={histogram}
        selectedRange={currentDraft}
        editable
        step={brushStep}
        onRangeChange={setDraft}
        onRangeCommit={commit}
      />

      <div className="maono-filter-range__numbers">
        <label>
          <span>Mínimo</span>
          <input
            type="number"
            min={currentDomain[0]}
            max={currentDraft[1]}
            step={inputStep}
            value={currentDraft[0]}
            onChange={(event) => updateMinimum(Number(event.target.value))}
            onBlur={() => commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label>
          <span>Máximo</span>
          <input
            type="number"
            min={currentDraft[0]}
            max={currentDomain[1]}
            step={inputStep}
            value={currentDraft[1]}
            onChange={(event) => updateMaximum(Number(event.target.value))}
            onBlur={() => commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </div>

      <button
        type="button"
        className="maono-filter-editor__reset"
        disabled={sameFilterValue(value, currentDomain)}
        onClick={() => {
          setDraft(currentDomain);
          onChange(currentDomain);
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
  const domain = numberPair(filter.domain, filter.domain);
  const value = numberPair(filter.value, filter.domain) ?? domain;
  const [minimum, setMinimum] = useState(
    value ? timestampToInputValue(value[0]) : "",
  );
  const [maximum, setMaximum] = useState(
    value ? timestampToInputValue(value[1]) : "",
  );

  useEffect(() => {
    setMinimum(value ? timestampToInputValue(value[0]) : "");
    setMaximum(value ? timestampToInputValue(value[1]) : "");
  }, [value?.[0], value?.[1]]);

  if (!domain || !value) {
    return (
      <p className="maono-filter-editor__empty">
        O Kepler não calculou um período válido para este campo.
      </p>
    );
  }

  const currentDomain = domain;
  const currentValue = value;
  const minimumDomain = timestampToInputValue(currentDomain[0]);
  const maximumDomain = timestampToInputValue(currentDomain[1]);
  const parsedMinimum = inputValueToTimestamp(minimum);
  const parsedMaximum = inputValueToTimestamp(maximum);
  const brushRange: [number, number] = [
    parsedMinimum ?? currentValue[0],
    parsedMaximum ?? currentValue[1],
  ];
  const brushStep = Math.max((currentDomain[1] - currentDomain[0]) / 1000, 1);

  function commit() {
    const nextMinimum = inputValueToTimestamp(minimum);
    const nextMaximum = inputValueToTimestamp(maximum);

    if (
      nextMinimum === null ||
      nextMaximum === null ||
      nextMinimum > nextMaximum
    ) {
      setMinimum(timestampToInputValue(currentValue[0]));
      setMaximum(timestampToInputValue(currentValue[1]));
      return;
    }

    const next: [number, number] = [
      clamp(nextMinimum, currentDomain[0], currentDomain[1]),
      clamp(nextMaximum, currentDomain[0], currentDomain[1]),
    ];

    if (!sameFilterValue(next, currentValue)) onChange(next);
  }

  function previewBrush(next: [number, number]) {
    setMinimum(timestampToInputValue(next[0]));
    setMaximum(timestampToInputValue(next[1]));
  }

  function commitBrush(next: [number, number]) {
    previewBrush(next);
    if (!sameFilterValue(next, currentValue)) onChange(next);
  }

  return (
    <div className="maono-filter-editor is-time">
      <FilterHistogram
        histogram={histogram}
        selectedRange={brushRange}
        editable
        step={brushStep}
        onRangeChange={previewBrush}
        onRangeCommit={commitBrush}
      />

      <div className="maono-filter-time__inputs">
        <label>
          <span>De</span>
          <input
            type="datetime-local"
            min={minimumDomain}
            max={maximum || maximumDomain}
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
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
            onChange={(event) => setMaximum(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </div>

      <button
        type="button"
        className="maono-filter-editor__reset"
        disabled={sameFilterValue(currentValue, currentDomain)}
        onClick={() => {
          setMinimum(minimumDomain);
          setMaximum(maximumDomain);
          onChange(currentDomain);
        }}
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
  const [visibleLimit, setVisibleLimit] = useState(100);
  const selected = selectedFilterValues(filter.value);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();

  useEffect(() => {
    setVisibleLimit(100);
  }, [normalizedSearch, filter.domainSize]);

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

  const visible = matching.slice(0, visibleLimit);

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
          Exibindo os primeiros {filter.domain.length.toLocaleString("pt-BR")}{" "}
          de {filter.domainSize.toLocaleString("pt-BR")} valores para proteger
          o desempenho.
        </p>
      ) : null}

      <div className="maono-filter-category__options">
        {visible.length ? (
          visible.map((value, index) => {
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

      {matching.length > visible.length ? (
        <button
          type="button"
          className="maono-filter-category__more"
          onClick={() => setVisibleLimit((current) => current + 100)}
        >
          Mostrar mais {Math.min(100, matching.length - visible.length)}
        </button>
      ) : null}
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
    return <NumericRangeEditor filter={filter} onChange={onChange} />;
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
      A edição deste filtro permanece disponível no painel nativo do Kepler.
    </p>
  );
}
