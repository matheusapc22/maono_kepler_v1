import { collectionToArray, readValue } from "./selectors.ts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type SerializableOptions = {
  depth?: number;
  ancestors?: ReadonlySet<object>;
};

function serializableValue(
  value: unknown,
  options: SerializableOptions = {},
): JsonValue {
  const depth = options.depth ?? 0;
  const ancestors = options.ancestors ?? new Set<object>();

  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || depth > 24) return String(value);

  if (ancestors.has(value)) return "[Circular]";
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  const immutable = value as { toJS?: () => unknown };
  if (typeof immutable.toJS === "function") {
    return serializableValue(immutable.toJS(), {
      depth: depth + 1,
      ancestors: nextAncestors,
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      serializableValue(item, {
        depth: depth + 1,
        ancestors: nextAncestors,
      }),
    );
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
        serializableValue(item, {
          depth: depth + 1,
          ancestors: nextAncestors,
        }),
      ]),
  );
}

export function stableStringify(value: unknown) {
  return JSON.stringify(serializableValue(value));
}

function datasetEntries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== "object") return [];
  const immutable = value as {
    entrySeq?: () => { toArray(): Array<[string, unknown]> };
  };
  if (typeof immutable.entrySeq === "function") {
    return immutable.entrySeq().toArray();
  }
  if (value instanceof Map) return Array.from(value.entries());
  return Object.entries(value as Record<string, unknown>);
}

function datasetRevision(datasets: unknown) {
  return datasetEntries(datasets)
    .map(([key, dataset]) => {
      const info = readValue(dataset, "info");
      const fields = collectionToArray<unknown>(
        readValue(dataset, "fields") ??
          readValue(readValue(dataset, "data"), "fields"),
      );

      return {
        id: String(readValue(dataset, "id") ?? key),
        label: String(
          readValue(dataset, "label") ?? readValue(info, "label") ?? key,
        ),
        source:
          readValue(info, "source") ??
          readValue(info, "format") ??
          readValue(dataset, "source") ??
          null,
        fields: fields.map((field) => ({
          name: readValue(field, "name") ?? null,
          type:
            readValue(field, "type") ??
            readValue(field, "dataType") ??
            null,
          format: readValue(field, "format") ?? null,
        })),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function createKeplerRevisionPayload(mapState: unknown) {
  const visState = readValue(mapState, "visState");
  const mapStyle = readValue(mapState, "mapStyle");
  const viewport = readValue(mapState, "mapState");

  return {
    layers: collectionToArray<unknown>(readValue(visState, "layers")).map(
      (layer) => ({
        id: readValue(layer, "id") ?? null,
        type: readValue(layer, "type") ?? null,
        config: readValue(layer, "config") ?? null,
        visualChannels: readValue(layer, "visualChannels") ?? null,
      }),
    ),
    layerOrder: collectionToArray(readValue(visState, "layerOrder")),
    filters: collectionToArray(readValue(visState, "filters")),
    interactionConfig: readValue(visState, "interactionConfig") ?? null,
    layerBlending: readValue(visState, "layerBlending") ?? null,
    overlayBlending: readValue(visState, "overlayBlending") ?? null,
    datasets: datasetRevision(readValue(visState, "datasets")),
    viewport: {
      longitude: readValue(viewport, "longitude") ?? null,
      latitude: readValue(viewport, "latitude") ?? null,
      zoom: readValue(viewport, "zoom") ?? null,
      bearing: readValue(viewport, "bearing") ?? null,
      pitch: readValue(viewport, "pitch") ?? null,
    },
    mapStyle: {
      styleType: readValue(mapStyle, "styleType") ?? null,
      topLayerGroups: readValue(mapStyle, "topLayerGroups") ?? null,
      visibleLayerGroups: readValue(mapStyle, "visibleLayerGroups") ?? null,
      threeDBuildingColor:
        readValue(mapStyle, "threeDBuildingColor") ?? null,
      threeDBuildingsVisible:
        readValue(mapStyle, "threeDBuildingsVisible") ??
        readValue(mapStyle, "enable3dBuilding") ??
        null,
    },
  };
}

export function serializeKeplerRevision(mapState: unknown) {
  return stableStringify(createKeplerRevisionPayload(mapState));
}

export function hashKeplerRevision(mapState: unknown) {
  const serialized = serializeKeplerRevision(mapState);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
