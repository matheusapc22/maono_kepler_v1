import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { toggleModal, wrapTo } from "@kepler.gl/actions";

import { useSession } from "../../../../auth/session";
import PointFromPinWorkflow from "../../change-requests/PointFromPinWorkflow";
import { useMaonoBasemapController } from "../../engine-adapter/basemap-controller.ts";
import { useKeplerEngineAdapter } from "../../engine-adapter";
import "../../engine-adapter/map-flight.css";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import MaonoLayerPanelErrorBoundary from "../maono-layer-panel/ErrorBoundary";
import MaonoLayerPanel from "../maono-layer-panel/MaonoLayerPanel";
import MaonoGeometryFilterRuntime from "../map-overlay/MaonoGeometryFilterRuntime";
import MapOverlayControls from "../map-overlay/MapOverlayControls";
import MaonoBasemapPanel from "./MaonoBasemapPanel";
import MaonoMapShell from "./MaonoMapShell";
import MapPanelHost from "./MapPanelHost";
import MapSidebar from "./MapSidebar";
import { AddDataDockContext } from "./AddDataDockContext";
import { installMaonoMapLayoutDebug } from "./map-layout-debug";
import {
  MAONO_MAP_PANEL_TAB_CHANGED_EVENT,
  mapPanelTabFromEvent,
  requestMaonoMapPanelTab,
  type MaonoMapPanelTab,
} from "./map-shell-events";
import type { MaonoMapShellPanel } from "./map-shell-panels";

function initiallyOpenPanel() {
  if (typeof window === "undefined") {
    return true;
  }

  // O painel nasce aberto apenas quando há largura suficiente para o modo
  // dockado. Em tablet/mobile ele continua disponível como overlay, mas nasce
  // recolhido para não encobrir o mapa logo na entrada.
  return !window.matchMedia("(max-width: 1020px)").matches;
}

export default function MaonoMapRuntime({
  children,
}: {
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const dataRequested = useSelector((state: {
    demo?: { keplerGl?: { map?: { uiState?: { currentModal?: string | null } } } };
  }) => state.demo?.keplerGl?.map?.uiState?.currentModal === "addData");
  const [dataTarget, setDataTarget] = useState<HTMLDivElement | null>(null);
  const dataSessionOpen = useRef(false);
  const dataSessionKey = useRef<string | null>(null);
  const {
    logout,
  } = useSession();
  const {
    context,
    customLayerPanelEnabled,
    customMapOverlayEnabled,
    customMapShellEnabled,
  } = useMapPanel();
  const {
    commands,
    markClean,
    state: engineState,
  } = useKeplerEngineAdapter();
  const basemapController = useMaonoBasemapController();
  const [activePanel, setActivePanel] =
    useState<MaonoMapShellPanel>("layers");
  const [activePanelTab, setActivePanelTab] =
    useState<MaonoMapPanelTab>("layers");
  const [panelOpen, setPanelOpen] = useState(initiallyOpenPanel);
  const [loggingOut, setLoggingOut] = useState(false);
  const layerPanelAvailable = Boolean(
    customLayerPanelEnabled &&
      context?.capabilities.openLayerPanel,
  );
  const basemapAvailable = Boolean(
    customMapShellEnabled &&
      context?.capabilities.viewMap &&
      basemapController.available,
  );
  const dataContextKey = [context?.organization?.id, context?.project?.slug, context?.version, context?.mode].join(":");
  const validDataSession = dataSessionOpen.current && dataSessionKey.current === dataContextKey;
  const dataAvailable = Boolean(customMapShellEnabled && context?.capabilities.importData);
  const panelAvailable = layerPanelAvailable || basemapAvailable || dataAvailable;
  const loadInteractionBlocked = Boolean(
    context?.project && (!engineState.ready || engineState.isLoading),
  );

  const clearDataRequest = useCallback(() => {
    if (dataRequested) dispatch(wrapTo("map", toggleModal(null)));
  }, [dataRequested, dispatch]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    clearDataRequest();
    if (activePanel === "data") {
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(
        '.maono-map-sidebar button[aria-controls="map-add-data-sidebar"]',
      )?.focus());
    }
  }, [activePanel, clearDataRequest]);

  useEffect(() => {
    if (!customMapShellEnabled || !context) return;
    // A request authorized for one project/session must not survive a route,
    // organization, revision or permission-context change.
    if (dataSessionOpen.current && dataSessionKey.current !== dataContextKey) {
      dataSessionOpen.current = false;
      setPanelOpen(false);
      clearDataRequest();
      return;
    }
    if (dataRequested && dataAvailable && (!loadInteractionBlocked || validDataSession)) {
      dataSessionOpen.current = true;
      dataSessionKey.current = dataContextKey;
      setActivePanel("data");
      setPanelOpen(true);
    } else if (!dataRequested || !dataAvailable) {
      dataSessionOpen.current = false;
      if (activePanel === "data") setPanelOpen(false);
      if (dataRequested && !dataAvailable) clearDataRequest();
    }
  }, [activePanel, clearDataRequest, context, customMapShellEnabled, dataAvailable, dataContextKey, dataRequested, loadInteractionBlocked, validDataSession]);

  useEffect(() => {
    if (!panelAvailable) {
      setPanelOpen(false);
      return;
    }

    if (activePanel === "layers" && !layerPanelAvailable && basemapAvailable) {
      setActivePanel("basemap");
    } else if (
      activePanel === "basemap" &&
      !basemapAvailable &&
      layerPanelAvailable
    ) {
      setActivePanel("layers");
    }
  }, [activePanel, basemapAvailable, layerPanelAvailable, panelAvailable]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleTabChanged(event: Event) {
      const tab = mapPanelTabFromEvent(event);
      if (tab) {
        setActivePanelTab(tab);
      }
    }

    window.addEventListener(
      MAONO_MAP_PANEL_TAB_CHANGED_EVENT,
      handleTabChanged,
    );

    return () => {
      window.removeEventListener(
        MAONO_MAP_PANEL_TAB_CHANGED_EVENT,
        handleTabChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || typeof window === "undefined") {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePanel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePanel, panelOpen]);

  useEffect(() => {
    if (!customMapShellEnabled || !context) {
      return undefined;
    }

    return installMaonoMapLayoutDebug();
  }, [context, customMapShellEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleTelemetry(event: Event) {
      const telemetry = event as CustomEvent<{ event?: string }>;
      if (telemetry.detail?.event === "map_save_succeeded") {
        markClean();
      }
    }

    window.addEventListener("maono:map-panel-telemetry", handleTelemetry);
    return () => {
      window.removeEventListener(
        "maono:map-panel-telemetry",
        handleTelemetry,
      );
    };
  }, [markClean]);

  const selectPanelTab = useCallback(
    (tab: MaonoMapPanelTab) => {
      if (!context || !layerPanelAvailable || (loadInteractionBlocked && !validDataSession)) {
        return;
      }

      const permitted =
        tab === "layers"
          ? context.capabilities.viewLayers
          : context.capabilities.viewFilters;

      if (!permitted) {
        return;
      }

      clearDataRequest();
      setActivePanel("layers");
      setActivePanelTab(tab);
      setPanelOpen(true);
      requestMaonoMapPanelTab(tab);
    },
    [clearDataRequest, context, layerPanelAvailable, loadInteractionBlocked, validDataSession],
  );

  const openBasemapPanel = useCallback(() => {
    if (!basemapAvailable || (loadInteractionBlocked && !validDataSession)) {
      return;
    }

    clearDataRequest();
    setActivePanel("basemap");
    setPanelOpen(true);
  }, [basemapAvailable, clearDataRequest, loadInteractionBlocked, validDataSession]);

  const togglePanel = useCallback(() => {
    if (!panelAvailable || loadInteractionBlocked) {
      return;
    }

    setPanelOpen((current) => {
      const next = !current;
      if (next && activePanel === "layers") {
        requestMaonoMapPanelTab(activePanelTab);
      }
      return next;
    });
  }, [
    activePanel,
    activePanelTab,
    loadInteractionBlocked,
    panelAvailable,
  ]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }, [loggingOut, logout, navigate]);

  const handleOpenData = useCallback(() => {
    if (dataRequested) { closePanel(); return; }
    if (
      loadInteractionBlocked ||
      context?.capabilities.importData !== true
    ) {
      return;
    }

    commands.openAddDataModal();
  }, [closePanel, commands, context?.capabilities.importData, dataRequested, loadInteractionBlocked]);

  if (!customMapShellEnabled || !context) {
    return <>{children}</>;
  }

  const effectivePanelOpen =
    panelAvailable && panelOpen &&
    (!loadInteractionBlocked || (activePanel === "data" && validDataSession));

  return (
    <AddDataDockContext.Provider value={{ close: closePanel, target: dataTarget, enabled: dataAvailable && effectivePanelOpen && activePanel === "data" }}>
    <MaonoMapShell
      mode={context.mode}
      importOpen={activePanel === "data" && effectivePanelOpen && validDataSession}
      panelAvailable={panelAvailable}
      panelOpen={effectivePanelOpen}
      activePanelTab={activePanelTab}
      mapReady={engineState.ready}
      mapLoading={engineState.isLoading}
      basemapStyle={engineState.basemap.styleType}
      basemapVisible={engineState.basemap.visible}
      mapStatePresent={Boolean(engineState.viewport)}
      mapStylePresent={Boolean(engineState.basemap.styleType)}
      mapViewport={
        engineState.viewport
          ? [
              engineState.viewport.longitude,
              engineState.viewport.latitude,
              engineState.viewport.zoom,
              engineState.viewport.width,
              engineState.viewport.height,
            ].join(",")
          : "none"
      }
      engineStateKeys={Object.keys(engineState).sort().join(",")}
      sidebar={
        <MapSidebar
          context={context}
          panelOpen={effectivePanelOpen}
          activePanel={activePanel}
          layerPanelAvailable={layerPanelAvailable}
          basemapAvailable={basemapAvailable}
          mapLoading={loadInteractionBlocked && !validDataSession}
          loggingOut={loggingOut}
          onPanelTabSelect={selectPanelTab}
          onOpenBasemap={openBasemapPanel}
          onOpenData={handleOpenData}
          onLogout={handleLogout}
        />
      }
      topbar={null}
      panelHost={
        <MapPanelHost
          available={panelAvailable}
          open={effectivePanelOpen}
          activePanel={activePanel}
          activeLayerTab={activePanelTab}
          onToggle={togglePanel}
          onClose={closePanel}
        >
          {activePanel === "data" ? (
            <div ref={setDataTarget} className="maono-map-data-outlet" />
          ) : activePanel === "basemap" ? (
            <MaonoBasemapPanel
              controller={basemapController}
              mode={context.mode}
            />
          ) : (
            <MaonoLayerPanelErrorBoundary
              fallback={
                <aside
                  className="maono-map-panel-host__error"
                  role="alert"
                  aria-label="Falha no painel de camadas"
                >
                  <strong>Painel temporariamente indisponível</strong>
                  <span>
                    Feche e abra o painel novamente. O mapa continua disponível.
                  </span>
                </aside>
              }
            >
              <MaonoLayerPanel />
            </MaonoLayerPanelErrorBoundary>
          )}
        </MapPanelHost>
      }
    >
      {children}
      {context.mode === "editor" && context.project?.slug ? (
        <Link
          to={`/projects/${encodeURIComponent(context.project.slug)}/requests`}
          style={{ position: "fixed", right: 24, bottom: 55, zIndex: 10020,
            padding: "12px 16px", borderRadius: 10, background: "#11151b",
            color: "#f1d28a", border: "1px solid #c5a059" }}
        >Solicitações</Link>
      ) : null}
      {customMapOverlayEnabled ? (
        <>
          <MapOverlayControls />
          <PointFromPinWorkflow />
          <MaonoGeometryFilterRuntime />
        </>
      ) : null}
    </MaonoMapShell>
    </AddDataDockContext.Provider>
  );
}
