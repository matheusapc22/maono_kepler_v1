import type { MapCapabilities } from "../map-panel/types.ts";

export type MapRgbColor = [number, number, number];

export type MapPointLayerType = "point" | "cluster" | "heatmap";

export type MapColorScale = "quantile" | "quantize" | "linear" | "ordinal";

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

export type MapLayerStyle = {
  fillEnabled: boolean;
  opacity: number;
  color: MapRgbColor;
  colorField: string | null;
  colorScale: MapColorScale | null;
  colorPalette: string[];
  strokeEnabled: boolean;
  strokeColor: MapRgbColor;
  strokeColorField: string | null;
  strokeColorScale: MapColorScale | null;
  strokeColorPalette: string[];
  strokeOpacity: number;
  strokeWidth: number;
  pointRadius: number | null;
  clusterRadius: number | null;
  heatmapRadius: number | null;
};

export type MapLayerSummary = {
  id: string;
  type: string;
  label: string;
  isVisible: boolean;
  dataIds: string[];
  style: MapLayerStyle;
};

export type MapDatasetField = {
  name: string;
  type: string | null;
  format: string | null;
  filterType: Exclude<MapFilterType, "polygon" | "unknown"> | null;
};

export type MapDatasetSummary = {
  id: string;
  label: string;
  fields: MapDatasetField[];
  rowCount: number | null;
  filteredRowCount: number | null;
  isVisible: boolean;
};

export type MapFilterSummary = {
  id: string;
  index: number;
  dataIds: string[];
  fieldNames: string[];
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

export type KeplerEngineState = {
  mapId: string;
  ready: boolean;
  isLoading: boolean;
  error: string | null;
  selectedLayerId: string | null;
  layers: MapLayerSummary[];
  filters: MapFilterSummary[];
  datasets: MapDatasetSummary[];
  tooltip: MapTooltipConfig;
  legendVisible: boolean;
  viewport: MapViewportSummary | null;
  visibleLayerIds: string[];
  visibleDatasetIds: string[];
  transientDatasetIds: string[];
  bounds: MapBounds | null;
  filteredBounds: MapBounds | null;
  hasData: boolean;
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
  | "COMMAND_FAILED";

export type KeplerCommandResult<T = void> =
  | {
      ok: true;
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

export type AddGeoJsonLayerInput = {
  dataId?: string;
  label: string;
  geoJson: unknown;
  color?: MapRgbColor;
  strokeColor?: MapRgbColor;
  opacity?: number;
  transient?: boolean;
  centerMap?: boolean;
};

export type KeplerEngineCommands = {
  selectLayer(layerId: string | null): KeplerCommandResult;
  setLayerVisibility(layerId: string, visible: boolean): KeplerCommandResult;
  renameLayer(layerId: string, label: string): KeplerCommandResult;
  duplicateLayer(
    layerId: string,
  ): KeplerCommandResult<{ layerId: string | null }>;
  removeLayer(layerId: string): KeplerCommandResult;
  reorderLayer(layerIds: string[]): KeplerCommandResult;
  openAddDataModal(): KeplerCommandResult;
  createLayerFromDataset(
    input: CreateLayerFromDatasetInput,
  ): KeplerCommandResult<{ layerId: string }>;
  setLayerType(layerId: string, type: string): KeplerCommandResult;
  setLayerOpacity(layerId: string, opacity: number): KeplerCommandResult;
  setFixedColor(layerId: string, color: MapRgbColor): KeplerCommandResult;
  setColorField(layerId: string, fieldName: string | null): KeplerCommandResult;
  setColorScale(layerId: string, scale: string): KeplerCommandResult;
  setColorPalette(layerId: string, colors: string[]): KeplerCommandResult;
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
    colors: string[],
  ): KeplerCommandResult;
  setStrokeOpacity(layerId: string, opacity: number): KeplerCommandResult;
  setStrokeWidth(layerId: string, width: number): KeplerCommandResult;
  setPointRadius(layerId: string, radius: number): KeplerCommandResult;
  setClusterOptions(
    layerId: string,
    options: ClusterStyleOptions,
  ): KeplerCommandResult;
  setHeatmapOptions(
    layerId: string,
    options: HeatmapStyleOptions,
  ): KeplerCommandResult;
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
  setFilterValue(index: number, value: unknown): KeplerCommandResult;
  removeFilter(index: number): KeplerCommandResult;
  setTooltipFields(
    fieldsByDataset: Record<string, string[]>,
  ): KeplerCommandResult;
  fitVisibleData(): KeplerCommandResult;
  fitFilteredData(): KeplerCommandResult;
  toggleLegend(): KeplerCommandResult;
  addGeoJsonLayer(
    input: AddGeoJsonLayerInput,
  ): KeplerCommandResult<{ dataId: string }>;
  removeTransientLayer(dataId: string): KeplerCommandResult;
  markLayerPersistent(dataId: string): KeplerCommandResult;
  markLayerTransient(dataId: string): KeplerCommandResult;
};

export type KeplerEngineAdapterValue = {
  state: KeplerEngineState;
  commands: KeplerEngineCommands;
  markClean: () => void;
};
