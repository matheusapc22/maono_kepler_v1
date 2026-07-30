import { collectionToArray, readValue } from "./selectors.ts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function serializableValue(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
): JsonValue {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "object" || depth > 24) {
    return String(value);
  }

  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (typeof (value as any).toJS === "function") {
    return serializableValue((value as any).toJS(), seen, depth + 1);
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializableValue(item, seen, depth + 1));
  }

  const entries =
    value instanceof Map
      ? Array.from(value.entries())
      : Object.entries(value as Record<string, unknown>);

  return Object.fromEntries(
    entries
      .filter(([, item]) => typeof item !== "function")
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, item]) => [
        String(key),
        serializableValue(item, seen, depth + 1),
      ]),
  );
}

export function stableStringify(value: unknown) {
  return JSON.stringify(serializableValue(value, new WeakSet()));
}

function datasetRevision(datasets: unknown) {
  const entries =
    datasets && typeof (datasets as any).entrySeq === "function"
      ? (datasets as any).entrySeq().toArray()
      : datasets instanceof Map
        ? Array.from(datasets.entries())
        : Object.entries(
            (datasets && typeof datasets === "object"
              ? datasets
              : {}) as Record<string, unknown>,
          );

  return entries.map(([key, dataset]: [string, any]) => ({
    id: String(readValue(dataset, "id") ?? key),
    label: String(
      readValue(dataset, "label") ??
        readValue(readValue(dataset, "info"), "label") ??
        key,
    ),
    fields: collectionToArray(readValue(dataset, "fields")).map((field) => ({
      name: readValue(field, "name") ?? null,
      type: readValue(field, "type") ?? readValue(field, "dataType") ?? null,
    })),
  }));
}

export function serializeKeplerRevision(mapState: any) {
  const visState = mapState?.visState;
  const mapStyle = mapState?.mapStyle;

  const revision = {
    layers: collectionToArray(readValue(visState, "layers")).map((layer) => ({
      id: readValue(layer, "id") ?? null,
      type: readValue(layer, "type") ?? null,
      config: readValue(layer, "config") ?? null,
      visualChannels: readValue(layer, "visualChannels") ?? null,
    })),
    layerOrder: collectionToArray(readValue(visState, "layerOrder")),
    filters: collectionToArray(readValue(visState, "filters")),
    interactionConfig: readValue(visState, "interactionConfig") ?? null,
    datasets: datasetRevision(readValue(visState, "datasets")),
    viewport: mapState?.mapState ?? null,
    mapStyle: {
      styleType: readValue(mapStyle, "styleType") ?? null,
      topLayerGroups: readValue(mapStyle, "topLayerGroups") ?? null,
      visibleLayerGroups: readValue(mapStyle, "visibleLayerGroups") ?? null,
      threeDBuildingColor: readValue(mapStyle, "threeDBuildingColor") ?? null,
    },
  };

  return stableStringify(revision);
}

export function hashKeplerRevision(mapState: any) {
  const serialized = serializeKeplerRevision(mapState);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
