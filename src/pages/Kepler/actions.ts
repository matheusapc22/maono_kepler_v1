// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { push } from "react-router-redux";
import { fetch } from "global";

import { loadFiles, toggleModal } from "@kepler.gl/actions";
import { parseUri } from "@kepler.gl/common-utils";
import { load } from "@loaders.gl/core";
import { CSVLoader } from "@loaders.gl/csv";
import { GeoArrowLoader } from "@loaders.gl/arrow";
import { _GeoJSONLoader as GeoJSONLoader } from "@loaders.gl/json";
import { ParquetLoader } from "@loaders.gl/parquet";

import {
  LOADING_SAMPLE_ERROR_MESSAGE,
  LOADING_SAMPLE_LIST_ERROR_MESSAGE,
  MAP_CONFIG_URL,
} from "./constants/default-settings";


import type { AppDispatch, AppThunk, RootState } from "../../store";
import type { SavedConfigV1, ProtoDataset, ProcessorResult } from "@kepler.gl/types";
import type { SampleMapDescriptor } from "./components/load-data-modal/sample-data-viewer";

export type SampleOptions = Partial<SampleMapDescriptor> & { keplergl?: string; queryType?: string };
export type RemoteDataset = ProtoDataset | { info: { id: string }; data: ProcessorResult };
export type RemoteResourceResult = {
  response: unknown; config: SavedConfigV1 | null; options: SampleOptions;
  remoteDatasetConfig: RemoteDataset | null;
};
export type ProcessedRemoteResourceResult = RemoteResourceResult & { datasets: RemoteDataset | null };
type ResourceError = { status?: number; message?: string };
type ExportProvider = { getShareUrl?: (fullUrl: boolean) => string; getMapUrl?: (fullUrl: boolean) => string };
type LoadProvider = { name: string; getMapUrl: (params: Record<string, string>) => string | null | undefined };

// CONSTANTS
export const INIT = "INIT";
export const LOAD_REMOTE_RESOURCE_SUCCESS = "LOAD_REMOTE_RESOURCE_SUCCESS";
export const LOAD_REMOTE_DATASET_PROCESSED_SUCCESS =
  "LOAD_REMOTE_DATASET_PROCESSED_SUCCESS";
export const LOAD_REMOTE_RESOURCE_ERROR = "LOAD_REMOTE_RESOURCE_ERROR";
export const LOAD_MAP_SAMPLE_FILE = "LOAD_MAP_SAMPLE_FILE";
export const SET_SAMPLE_LOADING_STATUS = "SET_SAMPLE_LOADING_STATUS";

// Sharing
export const PUSHING_FILE = "PUSHING_FILE";
export const CLOUD_LOGIN_SUCCESS = "CLOUD_LOGIN_SUCCESS";

// ACTIONS
export function initApp() {
  return {
    type: INIT as typeof INIT,
  };
}

export function loadRemoteResourceSuccess(
  response: unknown,
  config: SavedConfigV1 | null,
  options: SampleOptions,
  remoteDatasetConfig: RemoteDataset | null
) {
  return {
    type: LOAD_REMOTE_RESOURCE_SUCCESS as typeof LOAD_REMOTE_RESOURCE_SUCCESS,
    response,
    config,
    options,
    remoteDatasetConfig,
  };
}

export function loadRemoteDatasetProcessedSuccessAction(result: ProcessedRemoteResourceResult) {
  return {
    type: LOAD_REMOTE_DATASET_PROCESSED_SUCCESS as typeof LOAD_REMOTE_DATASET_PROCESSED_SUCCESS,
    payload: result,
  };
}

export function loadRemoteResourceError(error: ResourceError, url?: string) {
  return {
    type: LOAD_REMOTE_RESOURCE_ERROR as typeof LOAD_REMOTE_RESOURCE_ERROR,
    error,
    url,
  };
}

export function loadMapSampleFile(samples: SampleMapDescriptor[]) {
  return {
    type: LOAD_MAP_SAMPLE_FILE as typeof LOAD_MAP_SAMPLE_FILE,
    samples,
  };
}

export function setLoadingMapStatus(isMapLoading: boolean) {
  return {
    type: SET_SAMPLE_LOADING_STATUS as typeof SET_SAMPLE_LOADING_STATUS,
    isMapLoading,
  };
}

/**
 * Actions passed to kepler.gl, called
 *
 * Note: exportFile is called on both saving and sharing
 *
 * @param {*} param0
 */
export function onExportFileSuccess({ provider, options }: { provider: ExportProvider; options: { isPublic?: boolean } }) {
  return (dispatch: AppDispatch) => {
    // if isPublic is true, use share Url
    if (options.isPublic && provider.getShareUrl) {
      dispatch(push(provider.getShareUrl(false)));
    } else if (!options.isPublic && provider.getMapUrl) {
      // if save private map to storage, use map url
      dispatch(push(provider.getMapUrl(false)));
    }
  };
}

export function onLoadCloudMapSuccess({ provider, loadParams }: { provider?: LoadProvider; loadParams: Record<string, string> }) {
  return (dispatch: AppDispatch) => {
    const mapUrl = provider?.getMapUrl(loadParams);
    if (mapUrl && provider) {
      const url = `/demo/map/${provider.name}?path=${mapUrl}`;
      dispatch(push(url));
    }
  };
}

// This can be moved into Kepler.gl to provide ability to load data from remote URLs
/**
 * The method is able to load both data and kepler.gl files.
 * It uses loadFile action to dispatch and add new datasets/configs
 * to the kepler.gl instance
 * @param options
 * @param {string} options.dataUrl the URL to fetch data from. Current supported file type json,csv, kepler.json
 * @returns {Function}
 */
export function loadRemoteMap(options: { dataUrl: string }) {
  return (dispatch: AppDispatch) => {
    dispatch(setLoadingMapStatus(true));
    // breakdown url into url+query params
    loadRemoteRawData(options.dataUrl).then(
      // In this part we turn the response into a FileBlob
      // so we can use it to call loadFiles
      (loaded) => {
        if (!loaded) {
          dispatch(loadRemoteResourceError({ message: "Missing remote data URL" }, options.dataUrl));
          return;
        }
        const [file, url] = loaded;
        const { file: filename } = parseUri(url);
        dispatch(loadFiles([new File([file], filename)])).then(() =>
          dispatch(setLoadingMapStatus(false))
        );
      },
      (error) => {
        const { target = {} } = error;
        const { status, responseText } = target;
        dispatch(
          loadRemoteResourceError(
            { status, message: responseText },
            options.dataUrl
          )
        );
      }
    );
  };
}

/**
 * Load a file from a remote URL
 * @param url
 * @returns {Promise<any>}
 */
function loadRemoteRawData(url: string): Promise<[Blob, string] | null> {
  if (!url) {
    // TODO: we should return reject with an appropriate error
    return Promise.resolve(null);
  }
  return fetch(url)
    .then((resp) => {
      if (!resp.ok) {
        return resp.text().then((text) => {
          throw new Error(text);
        });
      }
      return resp.blob();
    })
    .then((data) => {
      return [data, url] as [Blob, string];
    });
}

// The following methods are only used to load SAMPLES
/**
 *
 * @param {Object} options
 * @param {string} [options.dataUrl] the URL to fetch data from, e.g. https://raw.githubusercontent.com/keplergl/kepler.gl-data/master/earthquakes/data.csv
 * @param {string} [options.configUrl] the URL string to fetch kepler config from, e.g. https://raw.githubusercontent.com/keplergl/kepler.gl-data/master/earthquakes/config.json
 * @param {string} [options.id] the id used as dataset unique identifier, e.g. earthquakes
 * @param {string} [options.label] the label used to describe the new dataset, e.g. California Earthquakes
 * @param {string} [options.queryType] the type of query to execute to load data/config, e.g. sample
 * @param {string} [options.imageUrl] the URL to fetch the dataset image to use in sample gallery
 * @param {string} [options.description] the description used in sample galley to define the current example
 * @param {string} [options.size] the number of entries displayed in the current sample
 * @param {string} [keplergl] url to fetch the full data/config generated by kepler
 * @returns {Function}
 */
export function loadSample(options: SampleOptions, pushRoute = true): AppThunk {
  return (dispatch, getState) => {
    const { routing } = getState() as RootState & { routing?: { locationBeforeTransitions?: { search?: string } } };
    if (options.id && pushRoute) {
      dispatch(
        push(
          `/demo/${options.id}${
            routing?.locationBeforeTransitions?.search ?? ""
          }`
        )
      );
    }
    // if the sample has a kepler.gl config file url we load it
    if (options.keplergl) {
      dispatch(loadRemoteMap({ dataUrl: options.keplergl }));
    } else {
      dispatch(loadRemoteSampleMap(options));
    }

    dispatch(setLoadingMapStatus(true));
  };
}

/**
 * Load remote map with config and data
 * @param options {configUrl, dataUrl}
 * @returns {Function}
 */
function loadRemoteSampleMap(options: SampleOptions) {
  return (dispatch: AppDispatch) => {
    // Load configuration first
    const { configUrl, dataUrl, remoteDatasetConfigUrl } = options;
    const toLoad = [
      loadRemoteConfig<SavedConfigV1>(configUrl),
      dataUrl ? loadRemoteData(dataUrl) : null,
      // Load remote dataset config for tiled layers.
      remoteDatasetConfigUrl ? loadRemoteConfig<RemoteDataset>(remoteDatasetConfigUrl) : null,
    ] as const;

    Promise.all(toLoad).then(
      ([config, data, remoteDatasetConfig]) => {
        // TODO: these two actions can be merged
        dispatch(
          loadRemoteResourceSuccess(data, config, options, remoteDatasetConfig)
        );
        // TODO: toggleModal when async dataset task is done, show the spinner until then
        dispatch(toggleModal(null));
      },
      (error) => {
        if (error) {
          const { target = {} } = error;
          const { status, responseText } = target;
          dispatch(
            loadRemoteResourceError(
              {
                status,
                message: `${responseText} - ${LOADING_SAMPLE_ERROR_MESSAGE} ${options.id} (${configUrl})`,
              },
              configUrl
            )
          );
        }
      }
    );
  };
}

/**
 *
 * @param url
 * @returns {Promise<any>}
 */
function loadRemoteConfig<Result>(url?: string): Promise<Result | null> {
  if (!url) {
    // TODO: we should return reject with an appropriate error
    return Promise.resolve(null);
  }

  return fetch(url).then((resp) => {
    if (!resp.ok) {
      return resp.text().then((text) => {
        throw new Error(text);
      });
    }
    return resp.json();
  });
}

/**
 *
 * @param url to fetch data from (csv, json, geojson)
 * @returns {Promise<any>}
 */
function loadRemoteData(url?: string): Promise<unknown> {
  if (!url) {
    // TODO: we should return reject with an appropriate error
    return Promise.resolve(null);
  }

  // Load data
  return new Promise<unknown>((resolve) => {
    const loaders = [
  CSVLoader,
  GeoArrowLoader,
  ParquetLoader,
  GeoJSONLoader,
];
    const loadOptions = {
      csv: {
        shape: "object-row-table" as const,
      },
      arrow: {
        shape: "arrow-table" as const,
      },
      parquet: {
        shape: "arrow-table" as const,
      },
      metadata: true,
    };
    const data = load(url, loaders, loadOptions);
    resolve(data);
  });
}

/**
 *
 * @param sampleMapId optional if we pass the sampleMapId, after fetching
 * map sample configurations we are going to load the actual map data if it exists
 * @returns {function(*)}
 */
export function loadSampleConfigurations(sampleMapId: string | null = null) {
  return (dispatch: AppDispatch) => {
    fetch(MAP_CONFIG_URL)
      .then((response) => {
        if (!response.ok) {
          return response.text().then((text) => {
            throw new Error(text);
          });
        } else {
          return response.json();
        }
      })
      .then((samples: SampleMapDescriptor[]) => {
        dispatch(loadMapSampleFile(samples));
        // Load the specified map
        const map = sampleMapId && samples.find((s) => s.id === sampleMapId);
        if (map) {
          dispatch(loadSample(map, false));
        }
      })
      .catch((error) => {
        dispatch(
          loadRemoteResourceError(
            { message: `${error} - ${LOADING_SAMPLE_LIST_ERROR_MESSAGE}` },
            MAP_CONFIG_URL
          )
        );
      });
  };
}
