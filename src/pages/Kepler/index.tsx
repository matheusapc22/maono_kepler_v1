// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styled, { ThemeProvider, StyleSheetManager } from "styled-components";
import Window from "global/window";
import { connect, useDispatch } from "react-redux";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import { useSelector } from "react-redux";
import isPropValid from "@emotion/is-prop-valid";
import { WebMercatorViewport } from "@deck.gl/core";
import { ScreenshotWrapper } from "@openassistant/ui";
import {
  setStartScreenCapture,
  setScreenCaptured,
  AiAssistantPanel,
  setMapBoundary,
} from "@kepler.gl/ai-assistant";
import { panelBorderColor, theme } from "@kepler.gl/styles";
import { getApplicationConfig } from "@kepler.gl/utils";
import { SqlPanel } from "@kepler.gl/duckdb";
import Banner from "./components/banner";
import Announcement, { FormLink } from "./components/announcement";
import MaonoSaveButton from "./components/maono-save-button";
import BackToProjectsButton from "./components/back-to-projects-button";
import PointClusterSettingsPanel from "./components/point-cluster-settings-panel";
import { usePointClustering } from "./hooks/use-point-clustering";
import { replaceLoadDataModal } from "./factories/load-data-modal";
import { replaceMapControl } from "./factories/map-control";
import { replacePanelHeader } from "./factories/panel-header";
import { replaceLayerConfigurator } from "./factories/layer-configurator";
import { replaceSidePanel } from "./factories/side-panel";
import {
  CLOUD_PROVIDERS_CONFIGURATION,
  DEFAULT_FEATURE_FLAGS,
} from "./constants/default-settings";
import { messages } from "./constants/localization";

import {
  loadRemoteMap,
  loadSampleConfigurations,
  onExportFileSuccess,
  onLoadCloudMapSuccess,
} from "./actions";

import {
  loadCloudMap,
  addDataToMap,
  replaceDataInMap,
  toggleMapControl,
  toggleModal,
} from "@kepler.gl/actions";
import { CLOUD_PROVIDERS } from "./cloud-providers";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
/* eslint-disable no-unused-vars */
import sampleTripData, {
  testCsvData,
  sampleTripDataConfig,
} from "./data/sample-trip-data";
import sampleGeojsonConfig from "./data/sample-geojson-config";
import sampleH3Data, { config as h3MapConfig } from "./data/sample-hex-id-csv";
import sampleS2Data, {
  config as s2MapConfig,
  dataId as s2DataId,
} from "./data/sample-s2-data";
import sampleAnimateTrip, {
  pointData,
  pointDataId,
  animateTripDataId,
  replacePointData,
  config as syncedTripConfig,
} from "./data/sample-animate-trip-data";
import sampleIconCsv from "./data/sample-icon-csv";
import sampleGpsData from "./data/sample-gps-data";
import sampleRowData, { config as rowDataConfig } from "./data/sample-row-data";
import {
  processCsvData,
  processGeojson,
  processRowObject,
} from "@kepler.gl/processors";
import { injectComponents } from "@kepler.gl/components";
import { replaceDatasetSection } from "./factories/dataset-section";
import { useParams, useSearchParams } from "react-router";
import MapUrlLoader from "./map-url-loader";
import { useHideMapAttribution } from "../../hooks/useHideMapAttrition";
import {
  MapPanelAccessGate,
  MapPanelProvider,
} from "./map-panel/MapPanelProvider";
import { KeplerEngineAdapterProvider } from "./engine-adapter/index.ts";
import MaonoMapRuntime from "./components/maono-map-shell/MaonoMapRuntime";
import "./map-panel/map-panel.css";

const KeplerGl = injectComponents([
  replaceLoadDataModal(),
  replaceMapControl(),
  replacePanelHeader(),
  replaceDatasetSection(),
  replaceLayerConfigurator(),
  replaceSidePanel(),
]);

function shouldForwardProp(propName, target) {
  if (typeof target === "string") {
    return isPropValid(propName);
  }
  return true;
}

const BannerHeight = 48;
const BannerKey = `banner-${FormLink}`;
const keplerGlGetState = (state) => state.demo.keplerGl;
const MAONO_SCREENSHOT_TIMEOUT_MS = 6000;

const observedMapInstances = new WeakSet<object>();

function emitMaonoMapRuntimeEvent(
  phase:
    | "kepler-initialized"
    | "deck-initialized"
    | "map-ref"
    | "style-loaded"
    | "map-render"
    | "map-error",
  detail: Record<string, unknown> = {},
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("maono:map-runtime", {
      detail: { phase, ...detail },
    }),
  );
}

function safeMapErrorMessage(value: unknown) {
  return String(value ?? "Falha de carregamento do mapa")
    .replace(/https?:\/\/\S+/gi, "[url omitida]")
    .replace(/(access[_-]?token|token|api[_-]?key)=([^&\s]+)/gi, "$1=[redigido]")
    .slice(0, 320);
}

function observeMaonoMapRef(mapRef: unknown) {
  const ref = mapRef as {getMap?: () => unknown} | null;
  const map = ref?.getMap?.() as {
    isStyleLoaded?: () => boolean;
    getStyle?: () => {layers?: unknown[]};
    on?: (event: string, handler: (event?: unknown) => void) => void;
  } | null;

  emitMaonoMapRuntimeEvent("map-ref", {
    attached: Boolean(map),
    styleLoaded: Boolean(map?.isStyleLoaded?.()),
  });

  if (!map || observedMapInstances.has(map)) return;
  observedMapInstances.add(map);

  let firstRenderObserved = false;
  map.on?.("style.load", () => {
    const layerCount = map.getStyle?.()?.layers?.length ?? 0;
    emitMaonoMapRuntimeEvent("style-loaded", {layerCount});
  });
  map.on?.("render", () => {
    if (firstRenderObserved) return;
    firstRenderObserved = true;
    emitMaonoMapRuntimeEvent("map-render", {
      styleLoaded: Boolean(map.isStyleLoaded?.()),
    });
  });
  map.on?.("error", (event) => {
    const error = (event as {error?: {message?: unknown}} | null)?.error;
    emitMaonoMapRuntimeEvent("map-error", {
      message: safeMapErrorMessage(error?.message),
    });
  });
}

function normalizeScreenshotPayload(screenshot) {
  if (!screenshot) return null;
  if (typeof screenshot === "string") return screenshot;
  if (typeof screenshot === "object") {
    return (
      screenshot.dataUrl ||
      screenshot.dataURL ||
      screenshot.image ||
      screenshot.screenshot ||
      screenshot.src ||
      null
    );
  }
  return null;
}

const GlobalStyle = styled.div`
  position: absolute;
  inset: 0;
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  font-family: ff-clan-web-pro, "Helvetica Neue", Helvetica, sans-serif;
  font-weight: 400;
  font-size: 0.875em;
  line-height: 1.71429;

  *,
  *:before,
  *:after {
    -webkit-box-sizing: border-box;
    -moz-box-sizing: border-box;
    box-sizing: border-box;
  }

  ul {
    margin: 0;
    padding: 0;
  }

  li {
    margin: 0;
  }

  a {
    text-decoration: none;
    color: ${(props) => props.theme.labelColor};
  }
`;

const EMPTY_MAP_SIZE = Object.freeze({ width: 0, height: 0 });

function normalizeMapSize(rect) {
  return {
    width: Math.max(0, Math.round(Number(rect?.width) || 0)),
    height: Math.max(0, Math.round(Number(rect?.height) || 0)),
  };
}

function useParentElementSize() {
  const elementRef = useRef(null);
  const [size, setSize] = useState(EMPTY_MAP_SIZE);

  useLayoutEffect(() => {
    const element = elementRef.current;
    const parent = element?.parentElement;
    if (!element || !parent) return undefined;

    let frameId = 0;

    const measure = () => {
      frameId = 0;
      const next = normalizeMapSize(parent.getBoundingClientRect());
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };

    const scheduleMeasure = () => {
      if (frameId) Window.cancelAnimationFrame(frameId);
      frameId = Window.requestAnimationFrame(measure);
    };

    measure();

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    observer?.observe(parent);
    Window.addEventListener("resize", scheduleMeasure);

    return () => {
      observer?.disconnect();
      Window.removeEventListener("resize", scheduleMeasure);
      if (frameId) Window.cancelAnimationFrame(frameId);
    };
  }, []);

  return [elementRef, size];
}

function useSynchronizedKeplerFrame(rootRef, size) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || size.width <= 0 || size.height <= 0) return;

    const width = `${size.width}px`;
    const height = `${size.height}px`;

    Object.assign(root.style, {
      position: "absolute",
      top: "0px",
      left: "0px",
      right: "auto",
      bottom: "auto",
      width,
      height,
      minWidth: "0px",
      minHeight: "0px",
      overflow: "hidden",
    });

    for (const selector of [
      ".maono-kepler-screenshot-root",
      ".maono-kepler-container",
      ".maono-kepler-panel-group--horizontal",
    ]) {
      const node = root.querySelector(selector);
      if (!(node instanceof HTMLElement)) continue;
      Object.assign(node.style, {
        position: "absolute",
        top: "0px",
        left: "0px",
        right: "auto",
        bottom: "auto",
        width,
        height,
        minWidth: "0px",
        minHeight: "0px",
        overflow: "hidden",
      });
    }
  }, [rootRef, size.height, size.width]);
}

const CONTAINER_STYLE = {
  position: "absolute",
  inset: 0,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backgroundColor: "#333",
};

function MeasuredKeplerViewport({ fallbackSize, renderMap }) {
  const [viewportRef, measuredSize] = useParentElementSize();
  const width = measuredSize.width || fallbackSize.width;
  const height = measuredSize.height || fallbackSize.height;

  return (
    <div
      ref={viewportRef}
      className="maono-kepler-viewport"
      data-maono-layout-node="kepler-viewport"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: width > 0 ? `${width}px` : "100%",
        height: height > 0 ? `${height}px` : "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {width > 0 && height > 0 ? renderMap({ width, height }) : null}
    </div>
  );
}

const StyledResizeHandle = styled(PanelResizeHandle)`
  background-color: ${panelBorderColor};
  &:hover {
    background-color: #555;
  }
  width: 100%;
  height: 5px;
  cursor: row-resize;
`;

const StyledVerticalResizeHandle = styled(PanelResizeHandle)`
  background-color: ${panelBorderColor};
  width: 4px;
  height: 100%;
  cursor: row-resize;

  &:hover {
    background-color: #555;
  }
`;

const App = (props) => {
  const [showBanner, toggleShowBanner] = useState(false);

  const { id, provider } = useParams();
  const [searchParams] = useSearchParams();
  const query = Object.fromEntries(searchParams.entries());
  const dispatch = useDispatch();
  const screenshotRequestRef = useRef(null);
  const pointClustering = usePointClustering();
  const [mapRootRef, mapRootSize] = useParentElementSize();
  useSynchronizedKeplerFrame(mapRootRef, mapRootSize);

  const duckDbPluginEnabled = (getApplicationConfig().plugins || []).some(
    (p) => p.name === "duckdb"
  );

  const isSqlPanelOpen = useSelector(
    (state) =>
      duckDbPluginEnabled &&
      state?.demo?.keplerGl?.map?.uiState.mapControls.sqlPanel?.active
  );

  const isAiAssistantPanelOpen = useSelector(
    (state) =>
      state?.demo?.keplerGl?.map?.uiState.mapControls.aiAssistant?.active
  );

  const prevQueryRef = useRef<number>(null);

  useEffect(() => {
    const cloudProvider = CLOUD_PROVIDERS.find((c) => c.name === provider);
    if (cloudProvider) {
      if (isEqual(prevQueryRef.current, { provider, id, query })) {
        return;
      }

      dispatch(
        loadCloudMap({
          loadParams: query,
          provider: cloudProvider,
          onSuccess: onLoadCloudMapSuccess,
        })
      );
      prevQueryRef.current = { provider, id, query };
      return;
    }

    if (id) {
      dispatch(loadSampleConfigurations(id));
    }

    if (query.mapUrl) {
      dispatch(loadRemoteMap({ dataUrl: query.mapUrl }));
    }

    if (duckDbPluginEnabled && query.sql) {
      dispatch(toggleMapControl("sqlPanel", 0));
      dispatch(toggleModal(null));
    }

    _loadSampleData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onViewStateChange = useCallback(
    (viewState) => {
      const viewport = new WebMercatorViewport(viewState);
      const nw = viewport.unproject([0, 0]);
      const se = viewport.unproject([viewport.width, viewport.height]);
      dispatch(setMapBoundary(nw, se));
    },
    [dispatch]
  );

  const _setStartScreenCapture = useCallback(
    (flag) => {
      dispatch(setStartScreenCapture(flag));
    }, [dispatch]);

  const _setScreenCaptured = useCallback(
    (screenshot) => {
      dispatch(setScreenCaptured(screenshot));

      const pending = screenshotRequestRef.current;
      if (!pending) return;

      const dataUrl = normalizeScreenshotPayload(screenshot);
      Window.clearTimeout(pending.timeoutId);
      screenshotRequestRef.current = null;
      dispatch(setStartScreenCapture(false));

      if (dataUrl) {
        pending.resolve(dataUrl);
      } else {
        pending.reject(new Error("ScreenshotWrapper retornou captura vazia."));
      }
    }, [dispatch]);

  useEffect(() => {
    Window.__MAONO_CAPTURE_SCREENSHOT__ = () => {
      if (screenshotRequestRef.current) {
        return screenshotRequestRef.current.promise;
      }

      let resolveRequest;
      let rejectRequest;

      const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });

      const timeoutId = Window.setTimeout(() => {
        if (screenshotRequestRef.current) {
          screenshotRequestRef.current = null;
          dispatch(setStartScreenCapture(false));
          rejectRequest(new Error("Tempo limite ao capturar preview do mapa."));
        }
      }, MAONO_SCREENSHOT_TIMEOUT_MS);

      screenshotRequestRef.current = {
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
        timeoutId,
      };

      dispatch(setStartScreenCapture(true));
      return promise;
    };

    return () => {
      if (Window.__MAONO_CAPTURE_SCREENSHOT__) {
        delete Window.__MAONO_CAPTURE_SCREENSHOT__;
      }
      if (screenshotRequestRef.current?.timeoutId) {
        Window.clearTimeout(screenshotRequestRef.current.timeoutId);
      }
      screenshotRequestRef.current = null;
    };
  }, [dispatch]);

  const hideBanner = useCallback(() => {
    toggleShowBanner(false);
  }, []);

  const _disableBanner = useCallback(() => {
    hideBanner();
    Window.localStorage.setItem(BannerKey, "true");
  }, [hideBanner]);

  const _loadRowData = useCallback(() => {
    dispatch(addDataToMap({ datasets: [{ info: { label: "Sample Visit Data", id: "sample_visit_data" }, data: processRowObject(sampleRowData) }], config: rowDataConfig }));
  }, [dispatch]);

  const _loadVectorTileData = useCallback(() => {}, [dispatch]);
  const _loadPointData = useCallback(() => {}, [dispatch]);
  const _loadScenegraphLayer = useCallback(() => {}, [dispatch]);
  const _loadIconData = useCallback(() => {}, [dispatch]);
  const _loadTripGeoJson = useCallback(() => {}, [dispatch]);
  const _loadGeojsonData = useCallback(() => {}, [dispatch]);
  const _loadSyncedFilterWTripLayer = useCallback(() => {}, [dispatch]);
  const _replaceSyncedFilterWTripLayer = useCallback(() => {}, [dispatch]);
  const _replaceData = useCallback(() => {}, [dispatch]);
  const _loadH3HexagonData = useCallback(() => {}, [dispatch]);
  const _loadS2Data = useCallback(() => {}, [dispatch]);
  const _loadGpsData = useCallback(() => {}, [dispatch]);

  const _loadSampleData = useCallback(() => {}, []);

  useEffect(() => {
    dispatch(toggleModal(null));
  }, [dispatch]);

  useHideMapAttribution();

  return (
    <>
      <MapUrlLoader />
      <BackToProjectsButton />
      <MaonoSaveButton />
      <PointClusterSettingsPanel controller={pointClustering} />
      <StyleSheetManager shouldForwardProp={shouldForwardProp}>
        <ThemeProvider theme={theme}>
          <GlobalStyle
            ref={mapRootRef}
            className="maono-kepler-root"
            style={{
              width: mapRootSize.width > 0 ? `${mapRootSize.width}px` : "100%",
              height: mapRootSize.height > 0 ? `${mapRootSize.height}px` : "100%",
            }}
          >
            <ScreenshotWrapper
              startScreenCapture={
                props.demo.aiAssistant.screenshotToAsk.startScreenCapture
              }
              setScreenCaptured={_setScreenCaptured}
              setStartScreenCapture={_setStartScreenCapture}
              className="maono-kepler-screenshot-root"
            >
                <Banner
                  show={showBanner}
                  height={BannerHeight}
                  bgColor="#2E7CF6"
                  onClose={hideBanner}
                >
                  <Announcement onDisable={_disableBanner} />
                </Banner>
                <div
                  className="maono-kepler-container"
                  data-maono-layout-node="kepler-container"
                  style={CONTAINER_STYLE}
                >
                  <PanelGroup
                    className="maono-kepler-panel-group maono-kepler-panel-group--horizontal"
                    direction="horizontal"
                  >
                    <Panel
                      className="maono-kepler-main-panel"
                      defaultSize={isAiAssistantPanelOpen ? 70 : 100}
                    >
                      <PanelGroup
                        className="maono-kepler-panel-group maono-kepler-panel-group--vertical"
                        direction="vertical"
                      >
                        <Panel
                          className="maono-kepler-map-panel"
                          defaultSize={isSqlPanelOpen ? 60 : 100}
                        >
                          <MeasuredKeplerViewport
                            fallbackSize={mapRootSize}
                            renderMap={({ height, width }) => (
                              <KeplerGl
                                mapboxApiAccessToken={
                                  CLOUD_PROVIDERS_CONFIGURATION.MAPBOX_TOKEN
                                }
                                id="map"
                                getState={keplerGlGetState}
                                width={width}
                                height={height}
                                cloudProviders={CLOUD_PROVIDERS}
                                localeMessages={messages}
                                onExportToCloudSuccess={onExportFileSuccess}
                                onLoadCloudMapSuccess={onLoadCloudMapSuccess}
                                featureFlags={DEFAULT_FEATURE_FLAGS}
                                onKeplerGlInitialized={() =>
                                  emitMaonoMapRuntimeEvent("kepler-initialized", {
                                    width,
                                    height,
                                  })
                                }
                                onDeckInitialized={() =>
                                  emitMaonoMapRuntimeEvent("deck-initialized")
                                }
                                getMapboxRef={(mapRef) =>
                                  observeMaonoMapRef(mapRef)
                                }
                                onViewStateChange={onViewStateChange}
                              />
                            )}
                          />
                        </Panel>

                        {isSqlPanelOpen && (
                          <>
                            <StyledResizeHandle />
                            <Panel
                              className="maono-kepler-sql-panel"
                              defaultSize={40}
                              minSize={20}
                            >
                              <SqlPanel initialSql={query.sql || ""} />
                            </Panel>
                          </>
                        )}
                      </PanelGroup>
                    </Panel>
                    {isAiAssistantPanelOpen && (
                      <>
                        <StyledVerticalResizeHandle />
                        <Panel
                          className="maono-kepler-ai-panel"
                          defaultSize={30}
                          minSize={20}
                        >
                          <AiAssistantPanel />
                        </Panel>
                      </>
                    )}
                  </PanelGroup>
                </div>
            </ScreenshotWrapper>
          </GlobalStyle>
        </ThemeProvider>
      </StyleSheetManager>
    </>
  );
};

const mapStateToProps = (state) => state;
const dispatchToProps = (dispatch) => ({ dispatch });

const ConnectedApp = connect(mapStateToProps, dispatchToProps)(App);

const KeplerMapPanelRoot = () => (
  <MapPanelProvider>
    <MapPanelAccessGate>
      <KeplerEngineAdapterProvider>
        <MaonoMapRuntime>
          <ConnectedApp />
        </MaonoMapRuntime>
      </KeplerEngineAdapterProvider>
    </MapPanelAccessGate>
  </MapPanelProvider>
);

export default KeplerMapPanelRoot;
