// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { combineReducers } from "redux";
import { handleActions } from "redux-actions";
import Task, { withTask } from "react-palm/tasks";

import { aiAssistantReducer } from "@kepler.gl/ai-assistant";
import { EXPORT_MAP_FORMATS } from "@kepler.gl/constants";
import {
  processGeojson,
  processRowObject,
  processArrowTable,
} from "@kepler.gl/processors";
import keplerGlReducer, {
  combinedUpdaters,
  uiStateUpdaters,
} from "@kepler.gl/reducers";
import KeplerGlSchema from "@kepler.gl/schemas";
import { KeplerTable } from "@kepler.gl/table";
import { LayerClasses } from "@kepler.gl/layers";
import { getApplicationConfig } from "@kepler.gl/utils";
import { LOCALE_CODES } from "@kepler.gl/localization";

// import {getApplicationConfig, initApplicationConfig} from '@kepler.gl/utils';
// import keplerGlDuckdbPlugin, {KeplerGlDuckDbTable, DuckDBWasmAdapter} from '@kepler.gl/duckdb';

import {
  INIT,
  LOAD_MAP_SAMPLE_FILE,
  LOAD_REMOTE_RESOURCE_SUCCESS,
  LOAD_REMOTE_DATASET_PROCESSED_SUCCESS,
  LOAD_REMOTE_RESOURCE_ERROR,
  SET_SAMPLE_LOADING_STATUS,
  loadRemoteDatasetProcessedSuccessAction,
} from "../actions";

import { CLOUD_PROVIDERS_CONFIGURATION } from "../constants/default-settings";
import {
  MaonoAdaptiveGeoJsonLayer,
  MaonoAdaptivePointLayer,
} from "../clustering/point-cluster-adaptive-layer.ts";
import { generateHashId } from "../utils/strings";
import { reconcileFilterEnabledState } from "./filter-enabled-compatibility.ts";

// initialize kepler demo-app with DuckDB plugin
/*
initApplicationConfig({
  // Custom UI for DuckDB
  plugins: [keplerGlDuckDbPlugin],
  // async data ingestion to DuckDb
  table: KeplerGlDuckDbTable,
  // setup database for DuckDB plugin
  database: new DuckDBWasmAdapter({
    config: {
      query: {
        castBigIntToDouble: true
      }
    }
  }),
  // progressive loading is sync, doesn't wait properly for a dataset to be created in DuckDB
  useArrowProgressiveLoading: false
});
*/
const { DEFAULT_MAP_CONTROLS } = uiStateUpdaters;

function buildInitialMapControls() {
  return {
    ...DEFAULT_MAP_CONTROLS,
    mapLegend: {
      ...DEFAULT_MAP_CONTROLS.mapLegend,
      show: true,
      active: false,
      disableClose: false,
      activeMapIndex: 0,
      disableEdit: false,
    },
    // TODO find a better way not to add extra controls optionally - from plugin?
    ...((getApplicationConfig().plugins || []).some(
      (plugin) => plugin.name === "duckdb",
    )
      ? {
          sqlPanel: {
            active: false,
            activeMapIndex: 0,
            disableClose: false,
            show: true,
          },
        }
      : {}),
  };
}


import type { AnyAction } from "redux";
import type { KeplerGlState } from "@kepler.gl/reducers";
import type { ProcessorResult, AddDataToMapPayload, ParsedConfig } from "@kepler.gl/types";
import type { ArrowTable, ObjectRowTable } from "@loaders.gl/schema";
import type { SampleMapDescriptor } from "../components/load-data-modal/sample-data-viewer";
import type { RemoteDataset, SampleOptions } from "../actions";
import { loadMapSampleFile, setLoadingMapStatus,
  loadRemoteResourceSuccess as remoteResourceSuccessAction,
  loadRemoteResourceError as remoteResourceErrorAction } from "../actions";

type AppState = {
  appName: string; loaded: boolean; sampleMaps: SampleMapDescriptor[];
  isMapLoading: boolean; error: unknown; currentSample?: SampleOptions;
};
type RemoteProcessor = (input: unknown) => ProcessorResult | Promise<ProcessorResult>;

// INITIAL_APP_STATE
const initialAppState: AppState = {
  appName: "example",
  loaded: false,
  sampleMaps: [], // this is used to store sample maps fetch from a remote json file
  isMapLoading: false, // determine whether we are loading a sample map,
  error: null, // contains error when loading/retrieving data/configuration
  // {
  //   status: null,
  //   message: null
  // }
};

// App reducer
export const appReducer = handleActions<AppState, unknown>(
  {
    [INIT]: (state) => ({
      ...state,
      loaded: true,
    }),
    [LOAD_MAP_SAMPLE_FILE]: (state, action) => ({
      ...state,
      sampleMaps: (action as unknown as ReturnType<typeof loadMapSampleFile>).samples,
    }),
    [SET_SAMPLE_LOADING_STATUS]: (state, action) => ({
      ...state,
      isMapLoading: (action as unknown as ReturnType<typeof setLoadingMapStatus>).isMapLoading,
    }),
  },
  initialAppState,
);

const { DEFAULT_EXPORT_MAP } = uiStateUpdaters;

// combine app reducer and keplerGl reducer
// to mimic kepler.gl website
const demoReducer = combineReducers({
  // mount keplerGl reducer
  keplerGl: keplerGlReducer.initialState({
    // In order to provide single file export functionality
    // we are going to set the mapbox access token to be used
    // in the exported file
    uiState: {
      // Import opens explicitly through the map rail or layer menu.
      currentModal: null,
      locale: LOCALE_CODES.pt,
      exportMap: {
        ...DEFAULT_EXPORT_MAP,
        [EXPORT_MAP_FORMATS.HTML]: {
          ...DEFAULT_EXPORT_MAP[EXPORT_MAP_FORMATS.HTML],
          exportMapboxAccessToken:
            CLOUD_PROVIDERS_CONFIGURATION.EXPORT_MAPBOX_TOKEN,
        },
      },
      mapControls: buildInitialMapControls(),
    },
    visState: {
      layerClasses: {
        ...LayerClasses,
        point: MaonoAdaptivePointLayer,
        geojson: MaonoAdaptiveGeoJsonLayer,
      },
      loaders: [], // Add additional loaders.gl loaders here
      loadOptions: {}, // Add additional loaders.gl loader options here
    },
  }).plugin(reconcileFilterEnabledState) as import("redux").Reducer<Record<string, KeplerGlState>, AnyAction>,
  app: appReducer,
  aiAssistant: aiAssistantReducer,
});

type DemoState = Omit<ReturnType<typeof demoReducer>, "keplerGl"> & { keplerGl: Record<string, KeplerGlState> };
// The native updater handles absent config and nullable processor results.
// Keep those values unchanged at this legacy ingestion boundary.
type RemoteDataPayload = Omit<AddDataToMapPayload, "datasets" | "config"> & {
  datasets: RemoteDataset | null; config: ParsedConfig | null;
};
const addRemoteDataToMapUpdater = combinedUpdaters.addDataToMapUpdater as unknown as
  (state: KeplerGlState, action: { payload: RemoteDataPayload }) => KeplerGlState;

async function loadRemoteResourceSuccessTask({
  dataUrl,
  datasetId,
  processorMethod,
  remoteDatasetConfig,
  unprocessedData,
}: {
  dataUrl?: string; datasetId: string; processorMethod: RemoteProcessor;
  remoteDatasetConfig: RemoteDataset | null; unprocessedData: unknown;
}) {
  if (dataUrl) {
    const data = await processorMethod(unprocessedData);
    return {
      info: {
        id: datasetId,
      },
      data,
    };
  }

  // remote datasets like vector tile datasets
  return remoteDatasetConfig;
}

const LOAD_REMOTE_RESOURCE_SUCCESS_TASK = Task.fromPromise(
  loadRemoteResourceSuccessTask,
  "LOAD_REMOTE_RESOURCE_SUCCESS_TASK",
);

// this can be moved into a action and call kepler.gl action
/**
 * Used to load Kepler.gl demo examples
 * @param state
 * @param action {map: resultset, config, map}
 * @returns {{app: {isMapLoading: boolean}, keplerGl: {map: (state|*)}}}
 */
export const loadRemoteResourceSuccess = (state: DemoState, action: ReturnType<typeof remoteResourceSuccessAction>) => {
  // TODO: replace generate with a different function
  const datasetId = action.options.id || generateHashId(6);
  const { dataUrl } = action.options;

  const { shape } = dataUrl ? action.response as { shape?: string } : {};
  let processorMethod: RemoteProcessor = (data) => processRowObject(data as unknown[]);
  let unprocessedData = action.response;
  unprocessedData =
    shape === "object-row-table" ? (action.response as ObjectRowTable).data : unprocessedData;

  if (dataUrl) {
    const table = getApplicationConfig().table ?? KeplerTable;
    if (typeof table.getFileProcessor === "function") {
      if (shape === "arrow-table") {
        // arrow processor from table plugin expects batches
        unprocessedData = (action.response as ArrowTable).data.batches;
      }
      // use custom processors from table class
      const processorResult = table.getFileProcessor(unprocessedData);
      // TODO save processorResult.format here with the dataset
      processorMethod = processorResult.processor;
    } else {
      if (shape === "arrow-table") {
        processorMethod = (data) => processArrowTable(data as ArrowTable);
      } else if (shape === "object-row-table") {
        processorMethod = (data) => processRowObject(data as unknown[]);
      } else if (dataUrl.includes(".json") || dataUrl.includes(".geojson")) {
        processorMethod = processGeojson;
      } else {
        throw new Error("Failed to select data processor");
      }
    }
  }

  // processorMethod can be async so create a task
  const task = LOAD_REMOTE_RESOURCE_SUCCESS_TASK({
    dataUrl,
    datasetId,
    processorMethod,
    remoteDatasetConfig: action.remoteDatasetConfig,
    unprocessedData,
  }).bimap(
    (datasets) =>
      loadRemoteDatasetProcessedSuccessAction({ ...action, datasets }),
    () => {
      throw new Error("loadRemoteResource data processor failed");
    },
  );

  return withTask(state, task);
};

const loadRemoteDatasetProcessedSuccess = (state: DemoState, action: ReturnType<typeof loadRemoteDatasetProcessedSuccessAction>) => {
  const { config, datasets, options } = action.payload;

  const parsedConfig = config ? KeplerGlSchema.parseSavedConfig(config) : null;

  // Legacy sample configs may contain bounds omitted from SavedMapState's schema type.
  const bounds = config?.config?.mapState as { maxZoom?: number; minZoom?: number } | undefined;
  if (parsedConfig?.mapState) {
    if (typeof bounds?.maxZoom === "number") {
      Object.assign(parsedConfig.mapState, { maxZoom: bounds.maxZoom });
    }
    if (typeof bounds?.minZoom === "number") {
      Object.assign(parsedConfig.mapState, { minZoom: bounds.minZoom });
    }
  }

  const keplerGlInstance = addRemoteDataToMapUpdater(
    state.keplerGl.map, // "map" is the id of your kepler.gl instance
    {
      payload: {
        datasets,
        config: parsedConfig,
        options: {
          centerMap: Boolean(!config),
        },
      },
    },
  );

  return {
    ...state,
    app: {
      ...state.app,
      currentSample: options,
      isMapLoading: false, // we turn off the spinner
    },
    keplerGl: {
      ...state.keplerGl, // in case you keep multiple instances
      map: reconcileFilterEnabledState(keplerGlInstance),
    },
  };
};

export const loadRemoteResourceError = (state: DemoState, action: ReturnType<typeof remoteResourceErrorAction>) => {
  const { error, url } = action;

  const errorNote = {
    type: "error" as const,
    message: error.message || `Error loading ${url}`,
  };

  return {
    ...state,
    app: {
      ...state.app,
      isMapLoading: false, // we turn of the spinner
    },
    keplerGl: {
      ...state.keplerGl, // in case you keep multiple instances
      map: {
        ...state.keplerGl.map,
        uiState: uiStateUpdaters.addNotificationUpdater(
          state.keplerGl.map.uiState,
          {
            payload: errorNote,
          },
        ),
      },
    },
  };
};

const composedUpdaters: Partial<Record<string, (state: DemoState, action: AnyAction) => DemoState>> = {
  [LOAD_REMOTE_RESOURCE_SUCCESS]: (state, action) => loadRemoteResourceSuccess(state, action as ReturnType<typeof remoteResourceSuccessAction>),
  [LOAD_REMOTE_DATASET_PROCESSED_SUCCESS]: (state, action) => loadRemoteDatasetProcessedSuccess(state, action as ReturnType<typeof loadRemoteDatasetProcessedSuccessAction>),
  [LOAD_REMOTE_RESOURCE_ERROR]: (state, action) => loadRemoteResourceError(state, action as ReturnType<typeof remoteResourceErrorAction>),
};

const composedReducer = (state: DemoState | undefined, action: AnyAction): DemoState => {
  const updater = composedUpdaters[action.type];
  if (updater) {
    // Redux initializes the state before dispatching these application actions.
    return updater(state!, action);
  }
  return demoReducer(state, action);
};

// export demoReducer to be combined in website app
export default composedReducer;
