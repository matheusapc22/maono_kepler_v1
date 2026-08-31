import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useNavigate } from "react-router";

import { useSession } from "../../../../auth/session";
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
import MapTopbar from "./MapTopbar";
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
  const {
    activeOrganization,
    logout,
    user,
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
  const panelAvailable = layerPanelAvailable || basemapAvailable;

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
        setPanelOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen]);

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
      if (!context || !layerPanelAvailable) {
        return;
      }

      const permitted =
        tab === "layers"
          ? context.capabilities.viewLayers
          : context.capabilities.viewFilters;

      if (!permitted) {
        return;
      }

      setActivePanel("layers");
      setActivePanelTab(tab);
      setPanelOpen(true);
      requestMaonoMapPanelTab(tab);
    },
    [context, layerPanelAvailable],
  );

  const openBasemapPanel = useCallback(() => {
    if (!basemapAvailable) {
      return;
    }

    setActivePanel("basemap");
    setPanelOpen(true);
  }, [basemapAvailable]);

  const togglePanel = useCallback(() => {
    if (!panelAvailable) {
      return;
    }

    setPanelOpen((current) => {
      const next = !current;
      if (next && activePanel === "layers") {
        requestMaonoMapPanelTab(activePanelTab);
      }
      return next;
    });
  }, [activePanel, activePanelTab, panelAvailable]);

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
    if (context?.capabilities.createLayer !== true) {
      return;
    }

    commands.openAddDataModal();
  }, [commands, context?.capabilities.createLayer]);

  if (!customMapShellEnabled || !context) {
    return <>{children}</>;
  }

  const effectivePanelOpen = panelAvailable && panelOpen;

  return (
    <MaonoMapShell
      mode={context.mode}
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
          loggingOut={loggingOut}
          onPanelTabSelect={selectPanelTab}
          onOpenBasemap={openBasemapPanel}
          onOpenData={handleOpenData}
          onLogout={handleLogout}
        />
      }
      topbar={
        <MapTopbar
          context={context}
          activeOrganization={activeOrganization}
          user={user}
          mapReady={engineState.ready}
          mapLoading={engineState.isLoading}
          hasUnsavedChanges={engineState.hasUnsavedChanges}
          loggingOut={loggingOut}
          onLogout={handleLogout}
        />
      }
      panelHost={
        <MapPanelHost
          available={panelAvailable}
          open={effectivePanelOpen}
          activePanel={activePanel}
          activeLayerTab={activePanelTab}
          onToggle={togglePanel}
          onClose={() => setPanelOpen(false)}
        >
          {activePanel === "basemap" ? (
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
      {customMapOverlayEnabled ? (
        <>
          <MapOverlayControls />
          <MaonoGeometryFilterRuntime />
        </>
      ) : null}
    </MaonoMapShell>
  );
}
