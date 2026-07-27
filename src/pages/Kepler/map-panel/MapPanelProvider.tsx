import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  useLocation,
  useParams,
} from "react-router";

import { useSession } from "../../../auth/session";
import {
  fetchNewMapContext,
  fetchProjectMapNavigation,
} from "./map-panel-api";
import {
  MapPanelContextProvider,
  useMapPanel,
} from "./MapPanelContext";
import { emitMapPanelTelemetry } from "./map-panel-telemetry";
import type {
  MapPanelApiError,
  MapPanelLoadState,
  MapPanelMode,
} from "./types";

function requestedMode(pathname: string): MapPanelMode {
  if (pathname.endsWith("/view")) return "viewer";
  if (pathname.endsWith("/edit")) return "editor";
  return "manage";
}

function isFrontendLayerManagerEnabled() {
  return String(
    import.meta.env.VITE_MAONO_LAYER_MANAGER_V1 ?? "true",
  ).toLowerCase() !== "false";
}

function activeOrganizationKey(
  activeOrganization: any,
  user: any,
) {
  return String(
    activeOrganization?.id ??
      user?.activeOrganizationId ??
      user?.organizationId ??
      user?.organization_id ??
      "none",
  );
}

export function MapPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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
  const organizationKey = activeOrganizationKey(
    activeOrganization,
    user,
  );
  const isNewMap = location.pathname.startsWith("/maps/new/");

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
      ? fetchNewMapContext(controller.signal)
      : projectSlug
        ? fetchProjectMapNavigation(
            projectSlug,
            mode,
            controller.signal,
          )
        : Promise.resolve(null);

    request
      .then((context) => {
        if (controller.signal.aborted) return;

        if (!context) {
          setState({
            status: "ready",
            context: {
              policyVersion: 0,
              mode: "editor",
              requestedMode: "editor",
              defaultPanel: "editor",
              availablePanels: {
                viewer: {
                  allowed: false,
                  route: null,
                  reason: "LEGACY_MAP",
                },
                editor: {
                  allowed: true,
                  route: null,
                  reason: null,
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
                editLayers: true,
                editStyle: true,
                editLayerStyle: true,
                createLayer: true,
                removeLayer: true,
                duplicateLayer: true,
                reorderLayers: true,
                manageFilters: true,
                editFilters: true,
                saveMap: true,
                editMetadata: true,
                editProjectMetadata: true,
                updateThumbnail: true,
              },
              project: null,
              organization: null,
              features: {
                mapManagementHome: false,
                mapPanelModes: false,
                projectMapEditPermission: false,
                projectQuotaReservation: false,
                maonoLayerManager: false,
              },
            },
            error: null,
          });
          return;
        }

        if (context.allowed === false) {
          const error = new Error(
            context.reason === "ORGANIZATION_PROJECT_LIMIT_REACHED"
              ? "A organização atingiu o limite de projetos."
              : "O armazenamento da organização ainda não está pronto.",
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
          status: error?.status === 403 ? "blocked" : "error",
          context: null,
          error,
        });
      });

    return () => controller.abort();
  }, [
    isNewMap,
    mode,
    organizationKey,
    projectSlug,
    refreshToken,
  ]);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);
  const value = useMemo(
    () => ({
      state,
      context: state.context,
      refresh,
      customLayerPanelEnabled: Boolean(
        state.context?.features?.mapPanelModes &&
          state.context?.features?.maonoLayerManager &&
          isFrontendLayerManagerEnabled(),
      ),
    }),
    [refresh, state],
  );

  return (
    <MapPanelContextProvider value={value}>
      {children}
    </MapPanelContextProvider>
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
              <Link
                to={`/projects/${encodeURIComponent(projectSlug)}/view`}
              >
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
