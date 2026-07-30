import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useNavigate } from "react-router";

import { useSession } from "../../../../auth/session";
import { useKeplerEngineAdapter } from "../../engine-adapter";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import MapOverlayControls from "../map-overlay/MapOverlayControls";
import MaonoMapShell from "./MaonoMapShell";
import MapPanelHost from "./MapPanelHost";
import MapSidebar from "./MapSidebar";
import MapTopbar from "./MapTopbar";
import {
  MAONO_MAP_PANEL_TAB_CHANGED_EVENT,
  mapPanelTabFromEvent,
  requestMaonoMapPanelTab,
  type MaonoMapPanelTab,
} from "./map-shell-events";

function initiallyOpenPanel() {
  if (typeof window === "undefined") {
    return true;
  }

  return !window.matchMedia("(max-width: 820px)").matches;
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
  const [activePanelTab, setActivePanelTab] =
    useState<MaonoMapPanelTab>("layers");
  const [panelOpen, setPanelOpen] = useState(initiallyOpenPanel);
  const [loggingOut, setLoggingOut] = useState(false);
  const layerPanelAvailable = Boolean(
    customLayerPanelEnabled &&
      context?.capabilities.openLayerPanel,
  );

  useEffect(() => {
    if (!layerPanelAvailable) {
      setPanelOpen(false);
    }
  }, [layerPanelAvailable]);

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

      setActivePanelTab(tab);
      setPanelOpen(true);
      requestMaonoMapPanelTab(tab);
    },
    [context, layerPanelAvailable],
  );

  const togglePanel = useCallback(() => {
    if (!layerPanelAvailable) {
      return;
    }

    setPanelOpen((current) => {
      const next = !current;
      if (next) {
        requestMaonoMapPanelTab(activePanelTab);
      }
      return next;
    });
  }, [activePanelTab, layerPanelAvailable]);

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

  const effectivePanelOpen = layerPanelAvailable && panelOpen;

  return (
    <MaonoMapShell
      mode={context.mode}
      panelAvailable={layerPanelAvailable}
      panelOpen={effectivePanelOpen}
      activePanelTab={activePanelTab}
      sidebar={
        <MapSidebar
          context={context}
          activePanelTab={activePanelTab}
          panelOpen={effectivePanelOpen}
          layerPanelAvailable={layerPanelAvailable}
          loggingOut={loggingOut}
          onPanelTabSelect={selectPanelTab}
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
          available={layerPanelAvailable}
          open={effectivePanelOpen}
          activeTab={activePanelTab}
          onToggle={togglePanel}
          onClose={() => setPanelOpen(false)}
        />
      }
    >
      {children}
      {customMapOverlayEnabled ? <MapOverlayControls /> : null}
    </MaonoMapShell>
  );
}
