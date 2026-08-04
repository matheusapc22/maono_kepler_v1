import type {
  MapDatasetField,
  MapDatasetSummary,
  MapLayerColumnKey,
  MapLayerColumns,
  MapLayerStructureIssue,
  MapLayerStructurePlan,
  MapLayerStructureSnapshot,
  MapLayerSummary,
  MapManagedLayerType,
  MapPointLayerType,
} from "./types.ts";

const POINT_FAMILY = new Set<MapManagedLayerType>([
  "point",
  "cluster",
  "heatmap",
]);

const NUMERIC_TYPE_MARKERS = [
  "number",
  "integer",
  "int",
  "float",
  "double",
  "decimal",
  "real",
  "long",
  "short",
];
const GEOMETRY_TYPE_MARKERS = ["geojson", "geometry", "geography", "geom"];

const EMPTY_COLUMNS: MapLayerColumns = Object.freeze({
  latitude: null,
  longitude: null,
  geojson: null,
  altitude: null,
});

const TYPE_LABELS: Record<MapManagedLayerType, string> = {
  point: "Pontos",
  cluster: "Agrupamentos",
  heatmap: "Mapa de calor",
  geojson: "GeoJSON",
};

const COLUMN_LABELS: Record<MapLayerColumnKey, string> = {
  latitude: "Latitude",
  longitude: "Longitude",
  geojson: "Geometria GeoJSON",
  altitude: "Altitude",
};

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function normalizedColumnValue(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function managedLayerType(value: unknown): MapManagedLayerType | null {
  const normalized = normalizedText(value);
  return normalized === "point" ||
    normalized === "cluster" ||
    normalized === "heatmap" ||
    normalized === "geojson"
    ? normalized
    : null;
}

export function isPointFamilyLayerType(
  value: unknown,
): value is MapPointLayerType {
  const normalized = managedLayerType(value);
  return normalized !== null && POINT_FAMILY.has(normalized);
}

export function layerTypeLabel(value: unknown) {
  const type = managedLayerType(value);
  return type ? TYPE_LABELS[type] : String(value || "Camada");
}

export function layerStructureForType(value: unknown): MapLayerStructureSnapshot {
  const type = managedLayerType(value);

  if (!type) {
    return {
      supported: false,
      managedType: null,
      availableTypeChanges: [],
      requiredColumns: [],
      optionalColumns: [],
    };
  }

  if (POINT_FAMILY.has(type)) {
    return {
      supported: true,
      managedType: type,
      availableTypeChanges: ["point", "cluster", "heatmap"],
      requiredColumns: ["latitude", "longitude"],
      optionalColumns: ["altitude"],
    };
  }

  return {
    supported: true,
    managedType: "geojson",
    availableTypeChanges: ["geojson"],
    requiredColumns: ["geojson"],
    optionalColumns: [],
  };
}

export type MapDatasetFieldKind =
  | "number"
  | "geometry"
  | "string"
  | "boolean"
  | "time"
  | "unknown";

export function datasetFieldKind(field: MapDatasetField): MapDatasetFieldKind {
  const type = normalizedText(field.type);
  const format = normalizedText(field.format);
  const combined = `${type} ${format}`;

  if (GEOMETRY_TYPE_MARKERS.some((marker) => combined.includes(marker))) {
    return "geometry";
  }
  if (NUMERIC_TYPE_MARKERS.some((marker) => type.includes(marker))) {
    return "number";
  }
  if (type.includes("bool")) return "boolean";
  if (
    type.includes("time") ||
    type.includes("date") ||
    type.includes("timestamp")
  ) {
    return "time";
  }
  if (
    type.includes("string") ||
    type.includes("text") ||
    type.includes("varchar") ||
    type.includes("category")
  ) {
    return "string";
  }

  return "unknown";
}

export function fieldSupportsLayerColumn(
  field: MapDatasetField,
  column: MapLayerColumnKey,
) {
  const kind = datasetFieldKind(field);

  if (column === "latitude" || column === "longitude" || column === "altitude") {
    return kind === "number";
  }

  return kind === "geometry" || kind === "string" || kind === "unknown";
}

function fieldByName(dataset: MapDatasetSummary, name: string | null) {
  if (!name) return null;
  return dataset.fields.find((field) => field.name === name) ?? null;
}

function firstFieldByNames(
  dataset: MapDatasetSummary,
  patterns: RegExp[],
  column: MapLayerColumnKey,
) {
  return (
    dataset.fields.find(
      (field) =>
        patterns.some((pattern) => pattern.test(field.name)) &&
        fieldSupportsLayerColumn(field, column),
    ) ?? null
  );
}

export function inferLayerColumns(
  typeValue: unknown,
  dataset: MapDatasetSummary,
): MapLayerColumns {
  const type = managedLayerType(typeValue);

  if (!type) return { ...EMPTY_COLUMNS };

  if (type === "geojson") {
    const geometry = firstFieldByNames(
      dataset,
      [/^_?geojson$/i, /^geometry$/i, /^geom$/i, /^the_geom$/i],
      "geojson",
    ) ?? dataset.fields.find((field) => datasetFieldKind(field) === "geometry") ?? null;

    return {
      ...EMPTY_COLUMNS,
      geojson: geometry?.name ?? null,
    };
  }

  const latitude = firstFieldByNames(
    dataset,
    [/^_?lat$/i, /^_?latitude$/i, /^y$/i],
    "latitude",
  );
  const longitude = firstFieldByNames(
    dataset,
    [/^_?lng$/i, /^_?lon$/i, /^_?long$/i, /^_?longitude$/i, /^x$/i],
    "longitude",
  );
  const altitude = firstFieldByNames(
    dataset,
    [/^_?alt$/i, /^_?altitude$/i, /^elevation$/i, /^height$/i, /^z$/i],
    "altitude",
  );

  return {
    ...EMPTY_COLUMNS,
    latitude: latitude?.name ?? null,
    longitude: longitude?.name ?? null,
    altitude: altitude?.name ?? null,
  };
}

function issue(
  code: MapLayerStructureIssue["code"],
  message: string,
  column?: MapLayerColumnKey,
  fieldName?: string | null,
): MapLayerStructureIssue {
  return { code, message, column, fieldName: fieldName ?? null };
}

export function validateLayerColumns(
  typeValue: unknown,
  columns: MapLayerColumns,
  dataset: MapDatasetSummary,
): MapLayerStructureIssue[] {
  const structure = layerStructureForType(typeValue);

  if (!structure.supported || !structure.managedType) {
    return [
      issue(
        "UNSUPPORTED_LAYER_TYPE",
        "Este tipo de camada permanece disponível no Kepler nativo, mas não possui edição estrutural segura no painel Maõno.",
      ),
    ];
  }

  const errors: MapLayerStructureIssue[] = [];
  const relevantColumns = [
    ...structure.requiredColumns,
    ...structure.optionalColumns,
  ];

  for (const column of structure.requiredColumns) {
    if (!columns[column]) {
      errors.push(
        issue(
          "REQUIRED_COLUMN_MISSING",
          `${COLUMN_LABELS[column]} é obrigatória para ${TYPE_LABELS[structure.managedType]}.`,
          column,
        ),
      );
    }
  }

  for (const column of relevantColumns) {
    const fieldName = columns[column];
    if (!fieldName) continue;
    const field = fieldByName(dataset, fieldName);

    if (!field) {
      errors.push(
        issue(
          "FIELD_NOT_FOUND",
          `O campo ${fieldName} não existe no dataset ${dataset.label}.`,
          column,
          fieldName,
        ),
      );
      continue;
    }

    if (!fieldSupportsLayerColumn(field, column)) {
      errors.push(
        issue(
          "FIELD_TYPE_INCOMPATIBLE",
          `${fieldName} não possui tipo compatível com ${COLUMN_LABELS[column]}.`,
          column,
          fieldName,
        ),
      );
    }
  }

  if (
    columns.latitude &&
    columns.longitude &&
    columns.latitude === columns.longitude
  ) {
    errors.push(
      issue(
        "DUPLICATE_COLUMN",
        "Latitude e longitude devem usar campos diferentes.",
        "longitude",
        columns.longitude,
      ),
    );
  }

  return errors;
}

function columnsEqual(left: MapLayerColumns, right: MapLayerColumns) {
  return (
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.geojson === right.geojson &&
    left.altitude === right.altitude
  );
}

function compatibleExistingColumns(
  typeValue: unknown,
  columns: MapLayerColumns,
  dataset: MapDatasetSummary,
) {
  const structure = layerStructureForType(typeValue);
  const next: MapLayerColumns = { ...EMPTY_COLUMNS };

  for (const column of [
    ...structure.requiredColumns,
    ...structure.optionalColumns,
  ]) {
    const fieldName = columns[column];
    const field = fieldByName(dataset, fieldName);
    if (fieldName && field && fieldSupportsLayerColumn(field, column)) {
      next[column] = fieldName;
    }
  }

  return next;
}

function mergeInferredColumns(
  typeValue: unknown,
  preserved: MapLayerColumns,
  dataset: MapDatasetSummary,
) {
  const inferred = inferLayerColumns(typeValue, dataset);
  const structure = layerStructureForType(typeValue);
  const next = { ...preserved };

  for (const column of [
    ...structure.requiredColumns,
    ...structure.optionalColumns,
  ]) {
    if (!next[column] && inferred[column]) next[column] = inferred[column];
  }

  return next;
}

function preservedVisualChannels(
  layer: MapLayerSummary,
  targetType: MapManagedLayerType,
) {
  const preserved: string[] = [];
  const removed: string[] = [];

  for (const [channel, snapshot] of Object.entries(layer.visualChannels)) {
    if (!snapshot.field) continue;
    const compatible =
      channel === "color" ||
      (targetType === "point" &&
        (channel === "strokeColor" || channel === "size" || channel === "height"));
    (compatible ? preserved : removed).push(channel);
  }

  return {
    preserved: unique(preserved),
    removed: unique(removed),
  };
}

export function migrateLayerConfigurationForTypeChange(
  layer: MapLayerSummary,
  targetTypeValue: unknown,
  dataset: MapDatasetSummary | null,
): MapLayerStructurePlan {
  const sourceType = managedLayerType(layer.type);
  const targetType = managedLayerType(targetTypeValue);

  if (!sourceType || !targetType) {
    return {
      valid: false,
      changed: false,
      sourceType,
      targetType,
      datasetId: layer.dataIds[0] ?? null,
      columns: { ...layer.columns },
      preservedColumns: [],
      removedColumns: [],
      preservedChannels: [],
      removedChannels: [],
      issues: [
        issue(
          "UNSUPPORTED_LAYER_TYPE",
          "A troca de tipo só é suportada para os tipos gerenciados pelo painel Maõno.",
        ),
      ],
    };
  }

  if (!POINT_FAMILY.has(sourceType) || !POINT_FAMILY.has(targetType)) {
    return {
      valid: sourceType === targetType,
      changed: false,
      sourceType,
      targetType,
      datasetId: layer.dataIds[0] ?? null,
      columns: { ...layer.columns },
      preservedColumns: [],
      removedColumns: [],
      preservedChannels: [],
      removedChannels: [],
      issues:
        sourceType === targetType
          ? []
          : [
              issue(
                "TYPE_CHANGE_NOT_ALLOWED",
                "A troca estrutural é permitida somente entre ponto, cluster e heatmap.",
              ),
            ],
    };
  }

  const channelPlan = preservedVisualChannels(layer, targetType);
  const issues = dataset
    ? validateLayerColumns(targetType, layer.columns, dataset)
    : [
        issue(
          "DATASET_NOT_FOUND",
          "A camada precisa de um dataset válido antes da troca de tipo.",
        ),
      ];

  return {
    valid: issues.length === 0,
    changed: sourceType !== targetType,
    sourceType,
    targetType,
    datasetId: layer.dataIds[0] ?? null,
    columns: { ...layer.columns },
    preservedColumns: ["latitude", "longitude", "altitude"].filter(
      (column) => Boolean(layer.columns[column as MapLayerColumnKey]),
    ) as MapLayerColumnKey[],
    removedColumns: [],
    preservedChannels: channelPlan.preserved,
    removedChannels: channelPlan.removed,
    issues,
  };
}

export function planLayerDatasetAssociation(
  layer: MapLayerSummary,
  dataset: MapDatasetSummary,
): MapLayerStructurePlan {
  const type = managedLayerType(layer.type);
  const preserved = compatibleExistingColumns(type, layer.columns, dataset);
  const columns = mergeInferredColumns(type, preserved, dataset);
  const issues = validateLayerColumns(type, columns, dataset);
  const preservedColumns = (Object.keys(columns) as MapLayerColumnKey[]).filter(
    (column) =>
      Boolean(columns[column]) && columns[column] === layer.columns[column],
  );
  const removedColumns = (Object.keys(layer.columns) as MapLayerColumnKey[]).filter(
    (column) => Boolean(layer.columns[column]) && !preservedColumns.includes(column),
  );

  return {
    valid: issues.length === 0,
    changed:
      layer.dataIds.length !== 1 ||
      layer.dataIds[0] !== dataset.id ||
      !columnsEqual(columns, layer.columns),
    sourceType: type,
    targetType: type,
    datasetId: dataset.id,
    columns,
    preservedColumns,
    removedColumns,
    preservedChannels: [],
    removedChannels: [],
    issues,
  };
}

export function planLayerColumnUpdate(
  layer: MapLayerSummary,
  dataset: MapDatasetSummary,
  patch: Partial<MapLayerColumns>,
): MapLayerStructurePlan {
  const next: MapLayerColumns = {
    ...layer.columns,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [
        key,
        normalizedColumnValue(value),
      ]),
    ),
  };
  const type = managedLayerType(layer.type);

  if (type === "geojson") {
    next.latitude = null;
    next.longitude = null;
    next.altitude = null;
  } else if (type && POINT_FAMILY.has(type)) {
    next.geojson = null;
  }

  const issues = validateLayerColumns(type, next, dataset);

  return {
    valid: issues.length === 0,
    changed: !columnsEqual(next, layer.columns),
    sourceType: type,
    targetType: type,
    datasetId: dataset.id,
    columns: next,
    preservedColumns: (Object.keys(next) as MapLayerColumnKey[]).filter(
      (column) => next[column] === layer.columns[column] && Boolean(next[column]),
    ),
    removedColumns: (Object.keys(layer.columns) as MapLayerColumnKey[]).filter(
      (column) => Boolean(layer.columns[column]) && !next[column],
    ),
    preservedChannels: [],
    removedChannels: [],
    issues,
  };
}

export type KeplerLayerColumnConfig = {
  value: string | null;
  fieldIdx: number;
  optional?: boolean;
};

export type KeplerLayerColumnsConfig = Record<string, KeplerLayerColumnConfig>;

export function keplerColumnsFromSnapshot(
  columns: MapLayerColumns,
  dataset: MapDatasetSummary,
): KeplerLayerColumnsConfig {
  const result: KeplerLayerColumnsConfig = {};
  const mappings: Array<{
    keplerKey: string;
    snapshotKey: MapLayerColumnKey;
    optional?: boolean;
  }> = [
    { keplerKey: "lat", snapshotKey: "latitude" },
    { keplerKey: "lng", snapshotKey: "longitude" },
    { keplerKey: "geojson", snapshotKey: "geojson" },
    { keplerKey: "altitude", snapshotKey: "altitude", optional: true },
  ];

  for (const mapping of mappings) {
    const fieldName = columns[mapping.snapshotKey];
    if (!fieldName) continue;

    const fieldIdx = dataset.fields.findIndex(
      (field) => field.name === fieldName,
    );
    if (fieldIdx < 0) continue;

    result[mapping.keplerKey] = {
      value: fieldName,
      fieldIdx,
      ...(mapping.optional ? { optional: true } : {}),
    };
  }

  return result;
}

export function replacementLayerIdAfterRemoval(
  orderedLayerIds: readonly string[],
  removedLayerId: string,
  selectedLayerId: string | null,
) {
  if (selectedLayerId !== removedLayerId) return selectedLayerId;
  const index = orderedLayerIds.indexOf(removedLayerId);
  if (index < 0) return selectedLayerId;
  return orderedLayerIds[index + 1] ?? orderedLayerIds[index - 1] ?? null;
}

export function moveLayerId(
  orderedLayerIds: readonly string[],
  layerId: string,
  targetIndex: number,
) {
  const sourceIndex = orderedLayerIds.indexOf(layerId);
  if (sourceIndex < 0) return [...orderedLayerIds];
  const boundedTarget = Math.max(0, Math.min(targetIndex, orderedLayerIds.length - 1));
  if (sourceIndex === boundedTarget) return [...orderedLayerIds];

  const next = [...orderedLayerIds];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(boundedTarget, 0, moved);
  return next;
}
