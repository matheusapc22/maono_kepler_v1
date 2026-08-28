import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useParams } from "react-router";

import { useSession } from "../../../auth/session";
import {
  fetchNewMapCreateContext,
  fetchProjectMapNavigation,
} from "./map-panel-api";
import { MapPanelContextProvider, useMapPanel } from "./MapPanelContext";
import { normalizeIsochroneFeatureState } from "./isochrone-feature-diagnostic";
import { emitMapPanelTelemetry } from "./map-panel-telemetry";
import type {
  MapPanelApiError,
  MapPanelContextValue,
  MapPanelLoadState,
  MapNavigationMode,
} from "./types";

function requestedMode(pathname: string): MapNavigationMode {
  if (pathname === "/maps/new/create") return "create";
  if (pathname.endsWith("/create")) return "create";
  if (pathname.endsWith("/view")) return "viewer";
  if (pathname.endsWith("/edit")) return "editor";
  return "manage";
}

function isFrontendLayerManagerEnabled() {
  return (
    String(
      import.meta.env.VITE_MAONO_LAYER_MANAGER_V1 ?? "false",
    ).toLowerCase() === "true"
  );
}

function isFrontendMapShellEnabled() {
  return (
    String(import.meta.env.VITE_MAONO_MAP_SHELL_V1 ?? "false").toLowerCase() ===
    "true"
  );
}

function isFrontendMapOverlayEnabled() {
  return (
    String(
      import.meta.env.VITE_MAONO_MAP_OVERLAY_V1 ?? "false",
    ).toLowerCase() === "true"
  );
}

function activeOrganizationKey(activeOrganization: any, user: any) {
  return String(
    activeOrganization?.id ??
      user?.activeOrganizationId ??
      user?.organizationId ??
      user?.organization_id ??
      "none",
  );
}

const BLOCKED_MESSAGES: Record<string, string> = {
  ACTIVE_ORGANIZATION_REQUIRED:
    "Selecione uma organização ativa para continuar.",
  MAP_CREATE_ROUTE_DISABLED:
    "A área de criação de mapas ainda não está habilitada.",
  MAP_EDITOR_FORBIDDEN: "Você não possui permissão para editar este mapa.",
  MAP_VIEW_FORBIDDEN: "Você não possui permissão para visualizar este mapa.",
  ORGANIZATION_PROJECT_LIMIT_REACHED:
    "A organização atingiu o limite de projetos.",
  ORGANIZATION_STORAGE_NOT_CONFIGURED:
    "O armazenamento da organização ainda não está pronto.",
  PROJECT_CREATE_FORBIDDEN: "Você não possui permissão para criar projetos.",
  PROJECT_NOT_FOUND: "O projeto não foi encontrado neste contexto.",
};

function blockedMessage(code: string | null | undefined) {
  return (
    (code ? BLOCKED_MESSAGES[code] : null) ||
    "Este painel não está disponível no contexto atual."
  );
}

function isBlockedError(error: MapPanelApiError) {
  const status = Number(error?.status || 0);

  return status >= 400 && status < 500;
}

function legacyReadOnlyContext(): MapPanelContextValue {
  return {
    policyVersion: 0,
    mode: "viewer",
    requestedMode: "manage",
    defaultPanel: "viewer",
    availablePanels: {
      viewer: {
        allowed: true,
        route: null,
        reason: null,
      },
      editor: {
        allowed: false,
        route: null,
        reason: "LEGACY_READ_ONLY",
      },
      create: {
        allowed: false,
        route: null,
        reason: "LEGACY_READ_ONLY",
      },
    },
    allowed: true,
    reason: null,
    capabilities: {
      viewMap: true,
      viewLayers: true,
      openLayerPanel: true,
      inspectLayer: true,
      toggleLayerVisibility: true,
      viewFilters: true,
      focusMapData: true,
      configureTooltips: false,
      toggleLegend: true,
      placeAnalysisMarker: false,
      previewIsochrone: false,
      previewBuffer: false,
      persistIsochrone: false,
      persistBuffer: false,
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
    },
    project: null,
    organization: null,
    features: {
      mapManagementHome: false,
      mapPanelModes: false,
      projectMapEditPermission: false,
      projectQuotaReservation: false,
      mapCreateRoute: false,
      maonoLayerManager: false,
      maonoMapShell: false,
      maonoMapOverlay: false,
      maonoIsochrone: false,
      maonoBuffer: false,
    },
    // Fail-closed: o fallback legado não recebeu diagnóstico do backend.
    isochroneFeatureState: normalizeIsochroneFeatureState(undefined, false),
  };
}

export function MapPanelProvider({ children }: { children: React.ReactNode }) {
  const { projectSlug } = useParams();
  const location = useLocation();
  const { activeOrganization, user } = useSession();
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<MapPanelLoadState>({
    status: "loading",
    context: null,
    error: null,
  });
  const previousRequestRef = useRef<{
    organizationKey: string;
    projectSlug?: string;
    refreshToken: number;
  } | null>(null);
  const mode = requestedMode(location.pathname);
  const organizationKey = activeOrganizationKey(activeOrganization, user);
  const isNewMap = location.pathname === "/maps/new/create";

  useEffect(() => {
    const controller = new AbortController();
    const previousRequest = previousRequestRef.current;

    if (previousRequest) {
      const reason =
        previousRequest.organizationKey !== organizationKey
          ? "organization"
          : previousRequest.projectSlug !== projectSlug
            ? "project"
            : previousRequest.refreshToken !== refreshToken
              ? "revocation"
              : "route";

      emitMapPanelTelemetry("map_context_invalidated", {
        organizationId: organizationKey,
        projectId: projectSlug ?? null,
        reason,
      });
    }

    previousRequestRef.current = {
      organizationKey,
      projectSlug,
      refreshToken,
    };

    setState({
      status: "loading",
      context: null,
      error: null,
    });

    const request = isNewMap
      ? fetchNewMapCreateContext(controller.signal)
      : projectSlug
        ? fetchProjectMapNavigation(projectSlug, mode, controller.signal)
        : Promise.resolve(null);

    request
      .then((context) => {
        if (controller.signal.aborted) return;

        if (!context) {
          if (projectSlug || isNewMap) {
            const error = new Error(
              "O servidor não devolveu um contexto de mapa válido.",
            ) as MapPanelApiError;
            error.code = "MAP_CONTEXT_REQUIRED";
            error.status = 503;
            setState({
              status: "error",
              context: null,
              error,
            });
            return;
          }

          setState({
            status: "ready",
            context: legacyReadOnlyContext(),
            error: null,
          });
          return;
        }

        if (context.allowed === false) {
          const error = new Error(
            blockedMessage(context.reason),
          ) as MapPanelApiError;
          error.code = context.reason || "NEW_MAP_BLOCKED";
          setState({
            status: "blocked",
            context: null,
            error,
          });
          return;
        }

        setState({
          status: "ready",
          context,
          error: null,
        });
        emitMapPanelTelemetry("map_panel_opened", {
          mode: context.mode,
          projectId: context.project?.id ?? null,
          organizationId: context.organization?.id ?? null,
          defaultPanel: context.defaultPanel,
          policyVersion: context.policyVersion,
        });
      })
      .catch((error: MapPanelApiError) => {
        if (controller.signal.aborted) return;
        setState({
          status: isBlockedError(error) ? "blocked" : "error",
          context: null,
          error,
        });
      });

    return () => controller.abort();
  }, [isNewMap, mode, organizationKey, projectSlug, refreshToken]);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);
  const value = useMemo(
    () => ({
      state,
      context: state.context,
      refresh,
      customLayerPanelEnabled: Boolean(
        state.context?.allowed &&
          state.context.capabilities.openLayerPanel &&
          state.context.features.mapPanelModes &&
          state.context?.features?.maonoLayerManager &&
          isFrontendLayerManagerEnabled(),
      ),
      customMapShellEnabled: Boolean(
        state.context?.allowed &&
          (state.context.capabilities.viewMap ||
            state.context.capabilities.openCreateWorkspace) &&
          state.context.features.mapPanelModes &&
          state.context?.features?.maonoMapShell &&
          isFrontendMapShellEnabled(),
      ),
      customMapOverlayEnabled: Boolean(
        state.context?.allowed &&
          state.context.capabilities.viewMap &&
          state.context.features.mapPanelModes &&
          state.context?.features?.maonoMapOverlay &&
          isFrontendMapOverlayEnabled(),
      ),
    }),
    [refresh, state],
  );

  return (
    <MapPanelContextProvider value={value}>{children}</MapPanelContextProvider>
  );
}

export function MapPanelAccessGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { state } = useMapPanel();
  const { projectSlug } = useParams();

  if (state.status === "loading") {
    return (
      <main className="maono-map-gate" aria-busy="true">
        <div className="maono-map-gate__card" role="status">
          <strong>Preparando o mapa</strong>
          <span>Validando contexto e permissões…</span>
        </div>
      </main>
    );
  }

  if (state.status === "blocked" || state.status === "error") {
    const fallback = state.error?.details?.fallbackPanel;

    return (
      <main className="maono-map-gate">
        <div className="maono-map-gate__card" role="alert">
          <strong>
            {state.status === "blocked"
              ? "Acesso não disponível"
              : "Não foi possível abrir o mapa"}
          </strong>
          <span>{state.error?.message}</span>
          <div className="maono-map-gate__actions">
            {fallback === "viewer" && projectSlug ? (
              <Link to={`/projects/${encodeURIComponent(projectSlug)}/view`}>
                Abrir visualizador
              </Link>
            ) : null}
            <Link to="/projects">Voltar aos projetos</Link>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
