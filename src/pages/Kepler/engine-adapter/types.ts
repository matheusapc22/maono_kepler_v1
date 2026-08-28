import type {
  MapCapabilities,
  MapRuntimeMode,
} from "../map-panel/types.ts";

export type MapRgbColor = [number, number, number];
export type MapAnalysisKind = "isochrone" | "buffer";

export type MapPointLayerType = "point" | "cluster" | "heatmap";

export type MapManagedLayerType = MapPointLayerType | "geojson";

export type MapLayerColumnKey =
  | "latitude"
  | "longitude"
  | "geojson"
  | "altitude";

export type MapColorScale =
  | "quantile"
  | "quantize"
  | "linear"
  | "sqrt"
  | "log"
  | "ordinal";

export type MapLayerBlendingMode = "normal" | "additive" | "subtractive";
export type MapPaletteKind = "sequential" | "divergent" | "categorical";
export type MapPaletteSelection = {
  id: string;
  label: string;
  kind: MapPaletteKind;
  colors: string[];
};
export type MapOverlayBlendingMode = "normal" | "screen" | "darken";

export type MapFilterType =
  | "range"
  | "timeRange"
  | "multiSelect"
  | "select"
  | "polygon"
  | "unknown";

export type MapFilterDomainValue = string | number | boolean | null;

export type MapFilterHistogramBin = {
  start: number;
  end: number;
  count: number;
};

export type MapBounds = {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
  sampled: boolean;
};

export type MapLayerColumns = {
  latitude: string | null;
  longitude: string | null;
  geojson: string | null;
  altitude: string | null;
};

export type MapLayerStructureSnapshot = {
  supported: boolean;
  managedType: MapManagedLayerType | null;
  availableTypeChanges: MapManagedLayerType[];
  requiredColumns: MapLayerColumnKey[];
  optionalColumns: MapLayerColumnKey[];
};

export type MapLayerStructureIssue = {
  code:
    | "UNSUPPORTED_LAYER_TYPE"
    | "TYPE_CHANGE_NOT_ALLOWED"
    | "DATASET_NOT_FOUND"
    | "REQUIRED_COLUMN_MISSING"
    | "FIELD_NOT_FOUND"
    | "FIELD_TYPE_INCOMPATIBLE"
    | "DUPLICATE_COLUMN";
  message: string;
  column?: MapLayerColumnKey;
  fieldName: string | null;
};

export type MapLayerStructurePlan = {
  valid: boolean;
  changed: boolean;
  sourceType: MapManagedLayerType | null;
  targetType: MapManagedLayerType | null;
  datasetId: string | null;
  columns: MapLayerColumns;
  preservedColumns: MapLayerColumnKey[];
  removedColumns: MapLayerColumnKey[];
  preservedChannels: string[];
  removedChannels: string[];
  issues: MapLayerStructureIssue[];
};

export type MapVisualChannelSnapshot = {
  field: string | null;
  scale: MapColorScale | null;
};

export type MapLayerStyleCompatibility = {
  supported: boolean;
  fixedColor: boolean;
  colorField: boolean;
  colorScale: boolean;
  palette: boolean;
  opacity: boolean;
  fill: boolean;
  stroke: boolean;
  strokeField: boolean;
  radius: boolean;
  radiusField: boolean;
  radiusRange: boolean;
  clusterRadius: boolean;
  heatmapRadius: boolean;
};

export type MapLayerStyle = {
  fillEnabled: boolean;
  opacity: number;
  color: MapRgbColor;
  colorField: string | null;
  colorScale: MapColorScale | null;
  colorPalette: string[];
  colorPaletteId: string | null;
  strokeEnabled: boolean;
  strokeColor: MapRgbColor;
  strokeColorField: string | null;
  strokeColorScale: MapColorScale | null;
  strokeColorPalette: string[];
  strokeColorPaletteId: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  pointRadius: number | null;
  radiusField: string | null;
  radiusScale: string | null;
  radiusRange: [number, number] | null;
  clusterRadius: number | null;
  heatmapRadius: number | null;
  compatibility: MapLayerStyleCompatibility;
};

export type MapLayerCompatibility = {
  supportsColumns: boolean;
  supportsFill: boolean;
  supportsStroke: boolean;
  supportsRadius: boolean;
  supportsClustering: boolean;
  supportsHeatmap: boolean;
};

export type MapLayerSummary = {
  id: string;
  type: string;
  label: string;
  order: number;
  selected: boolean;
  isVisible: boolean;
  dataIds: string[];
  columns: MapLayerColumns;
  style: MapLayerStyle;
  visualChannels: {
    color: MapVisualChannelSnapshot;
    strokeColor: MapVisualChannelSnapshot;
    size: MapVisualChannelSnapshot;
    height: MapVisualChannelSnapshot;
  };
  compatibility: MapLayerCompatibility;
  structure: MapLayerStructureSnapshot;
};

export type MapDatasetField = {
  name: string;
  type: string | null;
  format: string | null;
  filterType: Exclude<MapFilterType, "polygon" | "unknown"> | null;
};

export type MapDatasetStatus = "ready" | "loading" | "error" | "unknown";

export type MapDatasetSummary = {
  id: string;
  label: string;
  fields: MapDatasetField[];
  rowCount: number | null;
  filteredRowCount: number | null;
  source: string | null;
  status: MapDatasetStatus;
  error: string | null;
  isVisible: boolean;
  isTransient: boolean;
  dependentLayerIds: string[];
};

export type MapFilterSummary = {
  id: string;
  index: number;
  label: string;
  dataIds: string[];
  fieldNames: string[];
  dataId: string | null;
  fieldName: string | null;
  type: MapFilterType;
  fieldType: string | null;
  domain: MapFilterDomainValue[];
  domainSize: number;
  domainTruncated: boolean;
  step: number | null;
  histogram: MapFilterHistogramBin[];
  value: unknown;
  enabled: boolean;
  compatible: boolean;
  compatibilityReason: string | null;
};

export type MapTooltipField = {
  name: string;
  format: string | null;
};

export type MapTooltipConfig = {
  enabled: boolean;
  fieldsByDataset: Record<string, MapTooltipField[]>;
};

export type MapViewportSummary = {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
  width: number;
  height: number;
};

export type MapInteractionSnapshot = {
  tooltip: MapTooltipConfig;
  legendVisible: boolean;
  hoverEnabled: boolean | null;
  clickEnabled: boolean | null;
  highlightEnabled: boolean | null;
  availableControls: string[];
};

export type MapBlendingSnapshot = {
  layers: string | null;
  overlays: string | null;
};

export type MapBasemapSnapshot = {
  styleType: string | null;
  visible: boolean;
  labelsVisible: boolean | null;
  roadsVisible: boolean | null;
  bordersVisible: boolean | null;
  buildingsVisible: boolean | null;
  threeDBuildingsVisible: boolean | null;
  blending: MapBlendingSnapshot;
};

export type MapSaveStatus =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "read-only";

export type MapSaveSnapshot = {
  status: MapSaveStatus;
  hasUnsavedChanges: boolean;
  revisionHash: string;
  baselineHash: string | null;
  revision: number | null;
  lastConfirmedAt: string | null;
  error: string | null;
};

export type EngineCapabilitiesSnapshot = Readonly<MapCapabilities>;

export type KeplerEngineState = {
  mapId: string;
  mode: MapRuntimeMode;
  ready: boolean;
  isLoading: boolean;
  error: string | null;
  selectedLayerId: string | null;
  layers: MapLayerSummary[];
  filters: MapFilterSummary[];
  datasets: MapDatasetSummary[];
  viewport: MapViewportSummary | null;
  bounds: MapBounds | null;
  filteredBounds: MapBounds | null;
  interaction: MapInteractionSnapshot;
  basemap: MapBasemapSnapshot;
  save: MapSaveSnapshot;
  capabilities: EngineCapabilitiesSnapshot;
  transientDatasetIds: string[];
  visibleLayerIds: string[];
  visibleDatasetIds: string[];
  hasData: boolean;

  /** Aliases preservados para consumidores anteriores à Etapa 02. */
  tooltip: MapTooltipConfig;
  legendVisible: boolean;
  hasUnsavedChanges: boolean;
};

export type KeplerCommandErrorCode =
  | "CAPABILITY_DENIED"
  | "COMMAND_INVALID"
  | "MAP_UNAVAILABLE"
  | "LAYER_NOT_FOUND"
  | "DATASET_NOT_FOUND"
  | "FIELD_NOT_FOUND"
  | "FILTER_NOT_FOUND"
  | "TRANSIENT_LAYER_REQUIRED"
  | "KEPLER_ACTION_UNAVAILABLE"
  | "UNSUPPORTED"
  | "CONFLICT"
  | "COMMAND_FAILED";

export type KeplerCommandResult<T = void> =
  | {
      ok: true;
      changed: boolean;
      value?: T;
    }
  | {
      ok: false;
      code: KeplerCommandErrorCode;
      reason: string;
      command: string;
      capability?: keyof MapCapabilities;
    };

export type CreateLayerFromDatasetInput = {
  datasetId: string;
  type?: string;
  label?: string;
  columns?: Record<string, unknown>;
};

export type ClusterStyleOptions = {
  radius?: number;
  opacity?: number;
  colorPalette?: string[];
};

export type HeatmapStyleOptions = {
  radius?: number;
  opacity?: number;
  colorPalette?: string[];
};

export type AnalysisLayerPresentation = {
  tooltipFields?: string[];
  legendField?: string | null;
  legendPalette?: string[];
};

export type AddGeoJsonLayerInput = {
  dataId?: string;
  label: string;
  geoJson: unknown;
  color?: MapRgbColor;
  strokeColor?: MapRgbColor;
  opacity?: number;
  transient?: boolean;
  analysisKind?: MapAnalysisKind;
  presentation?: AnalysisLayerPresentation;
  centerMap?: boolean;
};

export type DuplicateLayerResult = {
  layerId: string | null;
  order: string[] | null;
};

export type RemoveLayerResult = {
  selectedLayerId: string | null;
};

export type SetLayerColumnsInput = Partial<{
  latitude: string | null;
  longitude: string | null;
  geojson: string | null;
  altitude: string | null;
}>;

export type RemoveDatasetOptions = {
  removeDependentLayers?: boolean;
};

export type MapViewportUpdate = Partial<
  Pick<
    MapViewportSummary,
    "longitude" | "latitude" | "zoom" | "bearing" | "pitch"
  >
>;

export type KeplerEngineCommands = {
  selectLayer(layerId: string | null): KeplerCommandResult;
  setLayerVisibility(layerId: string, visible: boolean): KeplerCommandResult;
  renameLayer(layerId: string, label: string): KeplerCommandResult;
  duplicateLayer(layerId: string): KeplerCommandResult<DuplicateLayerResult>;
  removeLayer(layerId: string): KeplerCommandResult<RemoveLayerResult>;
  reorderLayer(layerIds: string[]): KeplerCommandResult;
  openAddDataModal(): KeplerCommandResult;
  createLayerFromDataset(
    input: CreateLayerFromDatasetInput,
  ): KeplerCommandResult<{ layerId: string }>;
  setLayerType(
    layerId: string,
    type: string,
  ): KeplerCommandResult<MapLayerStructurePlan>;
  associateLayerDataset(
    layerId: string,
    datasetId: string,
  ): KeplerCommandResult<MapLayerStructurePlan>;
  setLayerColumns(
    layerId: string,
    columns: SetLayerColumnsInput,
  ): KeplerCommandResult<MapLayerStructurePlan>;
  setLayerOpacity(layerId: string, opacity: number): KeplerCommandResult;
  setFixedColor(layerId: string, color: MapRgbColor): KeplerCommandResult;
  setColorField(layerId: string, fieldName: string | null): KeplerCommandResult;
  setColorScale(layerId: string, scale: string): KeplerCommandResult;
  setColorPalette(
    layerId: string,
    palette: string[] | MapPaletteSelection,
  ): KeplerCommandResult;
  setFillEnabled(layerId: string, enabled: boolean): KeplerCommandResult;
  setStrokeEnabled(layerId: string, enabled: boolean): KeplerCommandResult;
  setStrokeColor(layerId: string, color: MapRgbColor): KeplerCommandResult;
  setStrokeColorField(
    layerId: string,
    fieldName: string | null,
  ): KeplerCommandResult;
  setStrokeColorScale(layerId: string, scale: string): KeplerCommandResult;
  setStrokeColorPalette(
    layerId: string,
    palette: string[] | MapPaletteSelection,
  ): KeplerCommandResult;
  setStrokeOpacity(layerId: string, opacity: number): KeplerCommandResult;
  setStrokeWidth(layerId: string, width: number): KeplerCommandResult;
  setPointRadius(layerId: string, radius: number): KeplerCommandResult;
  setRadiusField(layerId: string, fieldName: string | null): KeplerCommandResult;
  setLayerRadiusRange(
    layerId: string,
    range: [number, number],
  ): KeplerCommandResult;
  setClusterOptions(
    layerId: string,
    options: ClusterStyleOptions,
  ): KeplerCommandResult;
  setHeatmapOptions(
    layerId: string,
    options: HeatmapStyleOptions,
  ): KeplerCommandResult;

  removeDataset(
    datasetId: string,
    options?: RemoveDatasetOptions,
  ): KeplerCommandResult;
  renameDataset(datasetId: string, label: string): KeplerCommandResult;
  replaceDataset(datasetId: string, data: unknown): KeplerCommandResult;

  addFilter(
    datasetId?: string | null,
  ): KeplerCommandResult<{
    index: number;
    datasetId: string;
    fieldName: string;
  }>;
  bindFilterField(
    index: number,
    datasetId: string,
    fieldName?: string | null,
  ): KeplerCommandResult;
  setFilterField(index: number, fieldName: string): KeplerCommandResult;
  setFilterType(index: number, type: MapFilterType): KeplerCommandResult;
  setFilterValue(index: number, value: unknown): KeplerCommandResult;
  setFilterEnabled(index: number, enabled: boolean): KeplerCommandResult;
  removeFilter(index: number): KeplerCommandResult;

  setTooltipEnabled(enabled: boolean): KeplerCommandResult;
  setTooltipFields(
    fieldsByDataset: Record<string, string[]>,
  ): KeplerCommandResult;
  fitVisibleData(): KeplerCommandResult;
  fitFilteredData(): KeplerCommandResult;
  updateViewport(viewport: MapViewportUpdate): KeplerCommandResult;
  fitBounds(bounds: MapBounds): KeplerCommandResult;
  setLegendVisible(visible: boolean): KeplerCommandResult;
  toggleLegend(): KeplerCommandResult;

  setBasemapStyle(styleType: string): KeplerCommandResult;
  updateBasemapOptions(options: Record<string, boolean>): KeplerCommandResult;
  setLayerBlending(mode: MapLayerBlendingMode | string): KeplerCommandResult;
  setOverlayBlending(mode: MapOverlayBlendingMode | string): KeplerCommandResult;

  addGeoJsonLayer(
    input: AddGeoJsonLayerInput,
  ): KeplerCommandResult<{ dataId: string }>;
  removeTransientLayer(
    dataId: string,
    analysisKind: MapAnalysisKind,
  ): KeplerCommandResult;
  markLayerPersistent(
    dataId: string,
    analysisKind: MapAnalysisKind,
  ): KeplerCommandResult;
  markLayerTransient(
    dataId: string,
    analysisKind: MapAnalysisKind,
  ): KeplerCommandResult;
};

export type KeplerEngineAdapterValue = {
  state: KeplerEngineState;
  commands: KeplerEngineCommands;
  markClean: () => void;
};
