import type {
  MapDatasetField,
  MapFilterDomainValue,
  MapFilterType,
} from "../../../engine-adapter/types.ts";

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 4,
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function filterTypeLabel(type: MapFilterType) {
  switch (type) {
    case "range":
      return "Intervalo numérico";
    case "timeRange":
      return "Intervalo temporal";
    case "multiSelect":
      return "Categorias";
    case "select":
      return "Verdadeiro ou falso";
    case "polygon":
      return "Filtro espacial";
    default:
      return "Tipo não reconhecido";
  }
}

export function filterableDatasetFields(fields: MapDatasetField[]) {
  return fields.filter((field) => field.filterType !== null);
}

export function filterDomainValueLabel(value: MapFilterDomainValue) {
  if (value === null) return "Sem valor";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return numberFormatter.format(value);
  return value || "Valor vazio";
}

export function numberPair(
  value: unknown,
  fallback: MapFilterDomainValue[],
): [number, number] | null {
  const source =
    Array.isArray(value) && value.length >= 2 ? value : fallback;
  const minimum = Number(source[0]);
  const maximum = Number(source[1]);

  return Number.isFinite(minimum) &&
    Number.isFinite(maximum) &&
    minimum <= maximum
    ? [minimum, maximum]
    : null;
}

export function selectedFilterValues(
  value: unknown,
): MapFilterDomainValue[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (candidate): candidate is MapFilterDomainValue =>
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean",
  );
}

export type FilterValueLabelInput = {
  type: MapFilterType;
  value: unknown;
  domain: MapFilterDomainValue[];
};

export function filterValueLabel(filter: FilterValueLabelInput) {
  if (filter.type === "range") {
    const pair = numberPair(filter.value, filter.domain);
    return pair
      ? `${numberFormatter.format(pair[0])} a ${numberFormatter.format(pair[1])}`
      : "Intervalo indisponível";
  }

  if (filter.type === "timeRange") {
    const pair = numberPair(filter.value, filter.domain);
    return pair
      ? `${dateFormatter.format(pair[0])} a ${dateFormatter.format(pair[1])}`
      : "Período indisponível";
  }

  if (filter.type === "multiSelect") {
    const selected = selectedFilterValues(filter.value);
    if (!selected.length) return "Todas as categorias";

    const preview = selected
      .slice(0, 3)
      .map(filterDomainValueLabel)
      .join(", ");
    return selected.length > 3
      ? `${preview} e mais ${selected.length - 3}`
      : preview;
  }

  if (filter.type === "select") {
    return typeof filter.value === "boolean"
      ? filter.value
        ? "Sim"
        : "Não"
      : "Sem valor";
  }

  return "Edição disponível no Kepler nativo";
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function timestampToInputValue(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
      date.getDate(),
    )}`,
    `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`,
  ].join("T");
}

export function inputValueToTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sameFilterValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  return left.every((value, index) => Object.is(value, right[index]));
}
