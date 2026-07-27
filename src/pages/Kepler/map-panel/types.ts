export type MapPanelMode = "manage" | "viewer" | "editor";

export type MapCapabilities = {
  viewMap: boolean;
  viewLayers: boolean;
  openLayerPanel: boolean;
  inspectLayer: boolean;
  toggleLayerVisibility: boolean;
  viewFilters: boolean;
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
  editMetadata: boolean;
  editProjectMetadata: boolean;
  updateThumbnail: boolean;
};

export type MapPanelFeatures = {
  mapManagementHome: boolean;
  mapPanelModes: boolean;
  projectMapEditPermission: boolean;
  projectQuotaReservation: boolean;
  maonoLayerManager: boolean;
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
  mode: MapPanelMode;
  requestedMode: MapPanelMode;
  defaultPanel: MapPanelMode | null;
  availablePanels: {
    viewer: MapPanelAvailability;
    editor: MapPanelAvailability;
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
    requestedMode?: MapPanelMode;
    fallbackPanel?: MapPanelMode | null;
    availablePanels?: {
      viewer: boolean | MapPanelAvailability;
      editor: boolean | MapPanelAvailability;
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
  editMetadata: false,
  editProjectMetadata: false,
  updateThumbnail: false,
});

export const EMPTY_MAP_PANEL_FEATURES: MapPanelFeatures = Object.freeze({
  mapManagementHome: false,
  mapPanelModes: false,
  projectMapEditPermission: false,
  projectQuotaReservation: false,
  maonoLayerManager: false,
});
