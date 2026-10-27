// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";

import {
  type CSSProperties,
  type RefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styled, { ThemeProvider, StyleSheetManager } from "styled-components";
import Window from "global/window";
import { connect, useDispatch } from "react-redux";

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
import { SqlPanel } from "@kepler.gl/duckdb/components";
import type { RootState, AppDispatch } from "../../store";
import Banner from "./components/banner";
import Announcement, { FormLink } from "./components/announcement";
import MaonoSaveButton from "./components/maono-save-button";
import BackToProjectsButton from "./components/back-to-projects-button";
import PointClusterSettingsPanel from "./components/point-cluster-settings-panel";
import { usePointClustering } from "./hooks/use-point-clustering";
import { replaceDataImportNotifications } from "./factories/data-import-notifications";
import { replaceAddDataDialog } from "./factories/add-data-dialog";
import { replaceFileUpload } from "./factories/file-upload";
import { replaceExportHtmlMap, replaceExportJsonMap } from "./factories/export-map-help";
import { replaceLoadDataModal } from "./factories/load-data-modal";
import { replaceMapControl } from "./factories/map-control";
import { replaceCaptureMapContainer } from "./factories/capture-render-generation";
import { replaceMapLegendPanel } from "./factories/maono-map-legend-panel";
import { replaceLegendRow } from "./factories/maono-legend-row";
import { replaceMapPopover } from "./factories/maono-map-popover";
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

import { loadCloudMap, toggleMapControl, toggleModal } from "@kepler.gl/actions";
import { CLOUD_PROVIDERS } from "./cloud-providers";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { injectComponents } from "@kepler.gl/components";
import { replaceDatasetSection } from "./factories/dataset-section";
import { useParams, useSearchParams } from "react-router";
import MapUrlLoader from "./map-url-loader";
import {
  isMaonoMapVisualReadinessPending,
  notifyMaonoMapRender,
  registerMaonoDeckRuntime,
  registerMaonoMapRuntime,
  resetMaonoMapVisualReadinessRuntime,
} from "./map-url-loader/map-visual-readiness.ts";
import { useHideMapAttribution } from "../../hooks/useHideMapAttrition";
import {
  MapPanelAccessGate,
  MapPanelProvider,
} from "./map-panel/MapPanelProvider";
import { KeplerEngineAdapterProvider } from "./engine-adapter/index.ts";
import MaonoMapRuntime from "./components/maono-map-shell/MaonoMapRuntime";
import "./map-panel/map-panel.css";

// The SDK infers never[] from its default empty array, but its injector
// accepts recipe arrays of original/replacement factory functions.
type ComponentRecipe = ReadonlyArray<(...dependencies: never[]) => unknown>;
const injectKeplerComponents = injectComponents as (recipes: readonly ComponentRecipe[]) => ReturnType<typeof injectComponents>;
const KeplerGl = injectKeplerComponents([
  replaceCaptureMapContainer(),
  replaceLoadDataModal(),
  replaceFileUpload(),
  replaceExportHtmlMap(),
  replaceExportJsonMap(),
  replaceAddDataDialog(),
  replaceMapControl(),
  replaceMapLegendPanel(),
  replaceLegendRow(),
  replaceMapPopover(),
  replaceDatasetSection(),
  replaceLayerConfigurator(),
  replaceSidePanel(),
  // Parent injection registers its dependencies; apply this child override last.
  replacePanelHeader(),
  replaceDataImportNotifications(),
]);

function shouldForwardProp(propName: string, target: unknown) {
  if (typeof target === "string") {
    return isPropValid(propName);
  }
  return true;
}

const BannerHeight = 48;
const BannerKey = `banner-${FormLink}`;
const keplerGlGetState = (state: RootState) => state.demo.keplerGl;
const MAONO_SCREENSHOT_TIMEOUT_MS = 6000;

type ObservedMap = {
  isStyleLoaded?: () => boolean;
  getStyle?: () => {layers?: unknown[]};
  triggerRepaint?: () => void;
  on?: (event: string, handler: (event?: unknown) => void) => void;
  off?: (event: string, handler: (event?: unknown) => void) => void;
};
let observedMaonoMap: ObservedMap | null = null;
let releaseObservedMaonoMapListeners: (() => void) | null = null;

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

function releaseObservedMaonoMapRef() {
  releaseObservedMaonoMapListeners?.();
  releaseObservedMaonoMapListeners = null;
  observedMaonoMap = null;
  registerMaonoMapRuntime(null);
}

function releaseMaonoRuntimeObservers() {
  releaseObservedMaonoMapRef();
  registerMaonoDeckRuntime(null);
  resetMaonoMapVisualReadinessRuntime();
}

function observeMaonoMapRef(mapRef: unknown) {
  const ref = mapRef as {getMap?: () => unknown} | null;
  const map = ref?.getMap?.() as {
    isStyleLoaded?: () => boolean;
    getStyle?: () => {layers?: unknown[]};
    triggerRepaint?: () => void;
    on?: (event: string, handler: (event?: unknown) => void) => void;
    off?: (event: string, handler: (event?: unknown) => void) => void;
  } | null;

  if (!map) {
    releaseObservedMaonoMapRef();
    emitMaonoMapRuntimeEvent("map-ref", { attached: false, styleLoaded: false });
    return;
  }

  registerMaonoMapRuntime(map);
  emitMaonoMapRuntimeEvent("map-ref", {
    attached: true,
    styleLoaded: Boolean(map.isStyleLoaded?.()),
  });

  if (observedMaonoMap === map) return;
  releaseObservedMaonoMapRef();
  observedMaonoMap = map;
  registerMaonoMapRuntime(map);

  let firstRenderObserved = false;
  const handleStyleLoad = () => {
    const layerCount = map.getStyle?.()?.layers?.length ?? 0;
    emitMaonoMapRuntimeEvent("style-loaded", {layerCount});
    if (isMaonoMapVisualReadinessPending()) {
      map.triggerRepaint?.();
    }
  };
  const handleRender = () => {
    const readinessPending = isMaonoMapVisualReadinessPending();
    if (firstRenderObserved && !readinessPending) return;

    firstRenderObserved = true;
    const styleLoaded = Boolean(map.isStyleLoaded?.());
    notifyMaonoMapRender({ styleLoaded });
    emitMaonoMapRuntimeEvent("map-render", { styleLoaded });
  };
  const handleError = (event: unknown) => {
    const error = (event as {error?: {message?: unknown}} | null)?.error;
    emitMaonoMapRuntimeEvent("map-error", {
      message: safeMapErrorMessage(error?.message),
    });
  };

  map.on?.("style.load", handleStyleLoad);
  map.on?.("render", handleRender);
  map.on?.("error", handleError);

  releaseObservedMaonoMapListeners = () => {
    map.off?.("style.load", handleStyleLoad);
    map.off?.("render", handleRender);
    map.off?.("error", handleError);
  };
}

type ScreenshotPayload = string | null | undefined | {
  dataUrl?: string; dataURL?: string; image?: string; screenshot?: string; src?: string;
};
function normalizeScreenshotPayload(screenshot: ScreenshotPayload) {
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

type MapSize = { width: number; height: number };
const EMPTY_MAP_SIZE: Readonly<MapSize> = Object.freeze({ width: 0, height: 0 });

function normalizeMapSize(rect: Partial<MapSize> | null | undefined) {
  return {
    width: Math.max(0, Math.round(Number(rect?.width) || 0)),
    height: Math.max(0, Math.round(Number(rect?.height) || 0)),
  };
}

function useParentElementSize() {
  const elementRef = useRef<HTMLDivElement>(null);
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

  return [elementRef, size] as const;
}

function useSynchronizedKeplerFrame(rootRef: RefObject<HTMLDivElement | null>, size: MapSize) {
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

const CONTAINER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backgroundColor: "#333",
};

function MeasuredKeplerViewport({ fallbackSize, renderMap }: { fallbackSize: MapSize; renderMap: (size: MapSize) => ReactNode }) {
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

type ScreenshotRequest = {
  promise: Promise<string>; resolve: (value: string) => void;
  reject: (reason: Error) => void; timeoutId: number;
};
declare global {
  interface Window { __MAONO_CAPTURE_SCREENSHOT__?: () => Promise<string>; }
}

type NativeCloudPayload = Parameters<typeof loadCloudMap>[0];
type RuntimeCloudPayload = Omit<NativeCloudPayload, "provider"> & { provider: (typeof CLOUD_PROVIDERS)[number] };
// LOAD_CLOUD_MAP's updater calls provider.downloadMap; its public declaration
// incorrectly says string. Keep the same action creator and object payload.
const loadCloudMapWithProvider = loadCloudMap as unknown as
  (payload: RuntimeCloudPayload) => Omit<ReturnType<typeof loadCloudMap>, "payload"> & { payload: RuntimeCloudPayload };

const App = (props: RootState) => {
  const [showBanner, toggleShowBanner] = useState(false);

  const { id, provider } = useParams();
  const [searchParams] = useSearchParams();
  const query = Object.fromEntries(searchParams.entries());
  const dispatch = useDispatch<AppDispatch>();
  const screenshotRequestRef = useRef<ScreenshotRequest | null>(null);
  const pointClustering = usePointClustering();
  const [mapRootRef, mapRootSize] = useParentElementSize();
  useSynchronizedKeplerFrame(mapRootRef, mapRootSize);

  useEffect(() => {
    return () => {
      releaseMaonoRuntimeObservers();
    };
  }, []);

  const duckDbPluginEnabled = (getApplicationConfig().plugins || []).some(
    (p) => p.name === "duckdb"
  );

  const isSqlPanelOpen = useSelector(
    (state: RootState) =>
      duckDbPluginEnabled &&
      (state?.demo?.keplerGl?.map?.uiState.mapControls as
        typeof state.demo.keplerGl.map.uiState.mapControls & { sqlPanel?: { active: boolean } })?.sqlPanel?.active
  );

  const isAiAssistantPanelOpen = useSelector(
    (state: RootState) =>
      state?.demo?.keplerGl?.map?.uiState.mapControls.aiAssistant?.active
  );

  const prevQueryRef = useRef<{ provider?: string; id?: string; query: Record<string, string> } | null>(null);

  useEffect(() => {
    const cloudProvider = CLOUD_PROVIDERS.find((c) => c.name === provider);
    if (cloudProvider) {
      if (isEqual(prevQueryRef.current, { provider, id, query })) {
        return;
      }

      dispatch(
        loadCloudMapWithProvider({
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
    (viewState: ConstructorParameters<typeof WebMercatorViewport>[0]) => {
      const viewport = new WebMercatorViewport(viewState);
      const nw = viewport.unproject([0, 0]);
      const se = viewport.unproject([viewport.width, viewport.height]);
      dispatch(setMapBoundary(nw as [number, number], se as [number, number]));
    },
    [dispatch]
  );

  const _setStartScreenCapture = useCallback(
    (flag: Parameters<typeof setStartScreenCapture>[0]) => {
      dispatch(setStartScreenCapture(flag));
    }, [dispatch]);

  const _setScreenCaptured = useCallback(
    (screenshot: Parameters<typeof setScreenCaptured>[0]) => {
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

      let resolveRequest!: ScreenshotRequest["resolve"];
      let rejectRequest!: ScreenshotRequest["reject"];

      const promise = new Promise<string>((resolve, reject) => {
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
                                onDeckInitialized={(deck: Parameters<typeof registerMaonoDeckRuntime>[0]) => {
                                  registerMaonoDeckRuntime(deck);
                                  emitMaonoMapRuntimeEvent("deck-initialized");
                                }}
                                getMapboxRef={(mapRef: unknown) =>
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

const mapStateToProps = (state: RootState) => state;
const dispatchToProps = (dispatch: AppDispatch) => ({ dispatch });

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
