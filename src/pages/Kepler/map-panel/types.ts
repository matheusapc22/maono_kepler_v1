export type MapRuntimeMode = "viewer" | "editor" | "create";
export type MapNavigationMode = "manage" | MapRuntimeMode;
export type MapPanelMode = MapNavigationMode;

export type MapCapabilities = {
  viewMap: boolean;
  viewLayers: boolean;
  openLayerPanel: boolean;
  inspectLayer: boolean;
  toggleLayerVisibility: boolean;
  viewFilters: boolean;
  focusMapData: boolean;
  configureTooltips: boolean;
  toggleLegend: boolean;
  previewIsochrone: boolean;
  persistIsochrone: boolean;
  removeIsochrone: boolean;
  editLayers: boolean;
  editStyle: boolean;
  editLayerStyle: boolean;
  createLayer: boolean;
  removeLayer: boolean;
  duplicateLayer: boolean;
  reorderLayers: boolean;
  manageFilters: boolean;
  editFilters: boolean;
  saveMap: boolean;
  openCreateWorkspace: boolean;
  createProject: boolean;
  initializeMap: boolean;
  editMetadata: boolean;
  editProjectMetadata: boolean;
  updateThumbnail: boolean;
};

export type IsochroneFeatureReason =
  | "ENABLED"
  | "OVERLAY_DISABLED"
  | "KILL_SWITCH_ACTIVE"
  | "PROVIDER_NOT_CONFIGURED";

export type IsochroneFeatureState = {
  enabled: boolean;
  reason: IsochroneFeatureReason;
};

export type MapPanelFeatures = {
  mapManagementHome: boolean;
  mapPanelModes: boolean;
  projectMapEditPermission: boolean;
  projectQuotaReservation: boolean;
  mapCreateRoute: boolean;
  maonoLayerManager: boolean;
  maonoMapShell: boolean;
  maonoMapOverlay: boolean;
  maonoIsochrone: boolean;
  maonoIsochroneState?: IsochroneFeatureState;
};

export type SafeMapProject = {
  id: number | string;
  slug: string;
  name: string;
  description?: string | null;
  accessLevel?: string | null;
  configRevision?: number;
};

export type SafeMapOrganization = {
  id: number | string;
  name?: string;
  slug?: string;
};

export type ResourceLimit = {
  used: number;
  reserved?: number;
  limit: number;
  remaining: number;
  ready?: boolean;
  status?: string;
};

export type MapPanelAvailability = {
  allowed: boolean;
  route: string | null;
  reason: string | null;
};

export type MapPanelContextValue = {
  policyVersion: number;
  mode: MapRuntimeMode;
  requestedMode: MapNavigationMode;
  defaultPanel: MapRuntimeMode | null;
  availablePanels: {
    viewer: MapPanelAvailability;
    editor: MapPanelAvailability;
    create: MapPanelAvailability;
  };
  allowed: boolean;
  reason: string | null;
  capabilities: MapCapabilities;
  project: SafeMapProject | null;
  organization: SafeMapOrganization | null;
  version?: number;
  limits?: {
    projects: ResourceLimit;
    storageMb: ResourceLimit;
  };
  constraints?: {
    maxConfigBytes: number;
    maxThumbnailBytes: number;
    acceptedConfigContentTypes?: string[];
    acceptedThumbnailContentTypes?: string[];
  };
  features: MapPanelFeatures;
};

export type MapPanelLoadState =
  | { status: "loading"; context: null; error: null }
  | { status: "ready"; context: MapPanelContextValue; error: null }
  | {
      status: "blocked" | "error";
      context: null;
      error: MapPanelApiError;
    };

export type MapPanelApiError = Error & {
  status?: number;
  code?: string;
  details?: {
    requestedMode?: MapNavigationMode;
    fallbackPanel?: MapRuntimeMode | null;
    availablePanels?: {
      viewer: boolean | MapPanelAvailability;
      editor: boolean | MapPanelAvailability;
      create?: boolean | MapPanelAvailability;
    };
  } | null;
};

export const EMPTY_MAP_CAPABILITIES: MapCapabilities = Object.freeze({
  viewMap: false,
  viewLayers: false,
  openLayerPanel: false,
  inspectLayer: false,
  toggleLayerVisibility: false,
  viewFilters: false,
  focusMapData: false,
  configureTooltips: false,
  toggleLegend: false,
  previewIsochrone: false,
  persistIsochrone: false,
  removeIsochrone: false,
  editLayers: false,
  editStyle: false,
  editLayerStyle: false,
  createLayer: false,
  removeLayer: false,
  duplicateLayer: false,
  reorderLayers: false,
  manageFilters: false,
  editFilters: false,
  saveMap: false,
  openCreateWorkspace: false,
  createProject: false,
  initializeMap: false,
  editMetadata: false,
  editProjectMetadata: false,
  updateThumbnail: false,
});

export const EMPTY_MAP_PANEL_FEATURES: MapPanelFeatures = Object.freeze({
  mapManagementHome: false,
  mapPanelModes: false,
  projectMapEditPermission: false,
  projectQuotaReservation: false,
  mapCreateRoute: false,
  maonoLayerManager: false,
  maonoMapShell: false,
  maonoMapOverlay: false,
  maonoIsochrone: false,
});
