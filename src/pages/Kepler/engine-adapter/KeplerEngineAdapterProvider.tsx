import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { updateMap, wrapTo } from "@kepler.gl/actions";

import {
  MAONO_MAP_SAVE_RESULT_EVENT,
  mapSaveResultFromEvent,
} from "../map-panel/map-save-events.ts";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import { EMPTY_MAP_CAPABILITIES } from "../map-panel/types.ts";
import { createKeplerEngineCommands } from "./commands.ts";
import { installKeplerEngineStateDebug } from "./engine-state-debug.ts";
import {
  MapFlightController,
  type MapFlightCancelReason,
  type MapFlightSnapshot,
} from "./map-flight-controller.ts";
import {
  MAP_FLIGHT_DEFAULTS,
  calculateNavigationBounds,
  fitNavigationTarget,
  hasEffectiveFilter,
  viewportNeedsFocus,
} from "./map-navigation.ts";
import {
  KEPLER_MAP_ID,
  createKeplerEngineSelector,
  selectKeplerMapState,
} from "./selectors.ts";
import { hashKeplerRevision } from "./serialization.ts";
import type {
  KeplerCommandResult,
  KeplerEngineAdapterValue,
  KeplerEngineState,
  MapBounds,
  MapSaveStatus,
  MapViewportSummary,
} from "./types.ts";

const KeplerEngineAdapterContext =
  createContext<KeplerEngineAdapterValue | null>(null);

type SaveRuntimeState = {
  status: Exclude<MapSaveStatus, "dirty" | "read-only">;
  lastConfirmedAt: string | null;
  error: string | null;
};

const INITIAL_SAVE_RUNTIME: SaveRuntimeState = {
  status: "clean",
  lastConfirmedAt: null,
  error: null,
};

const INITIAL_FLIGHT: MapFlightSnapshot = {
  active: false,
  startedAt: null,
  progress: 0,
  start: null,
  target: null,
};

function telemetryDetail(event: Event) {
  const detail = (event as CustomEvent<unknown>).detail;
  return detail && typeof detail === "object"
    ? (detail as { event?: unknown; message?: unknown })
    : null;
}

function viewportPatch(viewport: MapViewportSummary) {
  return {
    longitude: viewport.longitude,
    latitude: viewport.latitude,
    zoom: viewport.zoom,
    bearing: viewport.bearing,
    pitch: viewport.pitch,
  };
}

function commandFailure(reason: string): KeplerCommandResult {
  return {
    ok: false,
    code: "MAP_UNAVAILABLE",
    reason,
    command: "fitVisibleData",
    capability: "focusMapData",
  };
}

export function KeplerEngineAdapterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();
  const selector = useMemo(() => createKeplerEngineSelector(), []);
  const [selectedLayerId, setSelectedLayerIdState] = useState<string | null>(
    null,
  );
  const selectedLayerIdRef = useRef<string | null>(null);
  const transientDatasetIdsRef = useRef(new Set<string>());
  const [transientVersion, setTransientVersion] = useState(0);
  const baselineHashRef = useRef<string | null>(null);
  const loadingSeenRef = useRef(false);
  const revisionHashRef = useRef("");
  const hasProjectRef = useRef(false);
  const [baselineVersion, setBaselineVersion] = useState(0);
  const [saveRuntime, setSaveRuntime] =
    useState<SaveRuntimeState>(INITIAL_SAVE_RUNTIME);
  const stateRef = useRef<KeplerEngineState | null>(null);
  const [flight, setFlight] = useState<MapFlightSnapshot>(INITIAL_FLIGHT);
  const [lastFlightCancelReason, setLastFlightCancelReason] =
    useState<string | null>(null);
  const flightControllerRef = useRef<MapFlightController | null>(null);
  const contextRef = useRef(context);
  const focusBoundsRef = useRef<MapBounds | null>(null);
  const focusTargetRef = useRef<MapViewportSummary | null>(null);
  const focusFilteredRef = useRef(false);

  contextRef.current = context;

  const setSelectedLayerId = useCallback((layerId: string | null) => {
    selectedLayerIdRef.current = layerId;
    setSelectedLayerIdState(layerId);
  }, []);
  const getSelectedLayerId = useCallback(
    () => selectedLayerIdRef.current,
    [],
  );
  const selectEngineState = useCallback(
    (rootState: unknown) => selector(rootState, selectedLayerId),
    [selectedLayerId, selector],
  );
  const baseState = useSelector(selectEngineState);
  const rawMapState = useSelector(selectKeplerMapState);
  const revisionHash = useMemo(() => {
    if (flight.active && revisionHashRef.current) {
      return revisionHashRef.current;
    }
    return hashKeplerRevision(rawMapState);
  }, [flight.active, rawMapState]);
  revisionHashRef.current = revisionHash;
  hasProjectRef.current = Boolean(context?.project);

  const capabilities = useMemo(
    () =>
      Object.freeze({
        ...EMPTY_MAP_CAPABILITIES,
        ...(context?.capabilities ?? {}),
      }),
    [context?.capabilities],
  );
  const contextKey = [
    context?.organization?.id ?? "none",
    context?.project?.id ?? "none",
    context?.project?.configRevision ?? context?.version ?? 0,
    context?.mode ?? "none",
  ].join(":");

  const effectiveFilterActive = useMemo(
    () => hasEffectiveFilter(baseState.filters),
    [baseState.filters],
  );
  const focusBounds = useMemo(
    () =>
      calculateNavigationBounds(store.getState(), {
        filteredOnly: effectiveFilterActive,
      }),
    [
      baseState.datasets,
      baseState.filters,
      baseState.layers,
      effectiveFilterActive,
      store,
    ],
  );
  const focusTarget = useMemo(
    () => fitNavigationTarget(baseState.viewport, focusBounds),
    [baseState.viewport, focusBounds],
  );
  const focusNeedsAttention = useMemo(
    () =>
      !flight.active &&
      viewportNeedsFocus(baseState.viewport, focusTarget),
    [baseState.viewport, flight.active, focusTarget],
  );

  focusBoundsRef.current = focusBounds;
  focusTargetRef.current = focusTarget;
  focusFilteredRef.current = effectiveFilterActive;

  const emitFlightTelemetry = useCallback(
    (
      event:
        | "map_focus_flight_started"
        | "map_focus_flight_completed"
        | "map_focus_flight_cancelled"
        | "map_focus_flight_failed",
      detail: Record<string, unknown> = {},
    ) => {
      const current = contextRef.current;
      emitMapPanelTelemetry(event, {
        mode: current?.mode ?? null,
        projectId: current?.project?.id ?? null,
        organizationId: current?.organization?.id ?? null,
        source: "kepler-engine-adapter-flight-v1",
        ...detail,
      });
    },
    [],
  );

  const ensureFlightController = useCallback(() => {
    if (flightControllerRef.current) {
      return flightControllerRef.current;
    }

    const controller = new MapFlightController({
      onFrame(nextViewport) {
        dispatch(
          wrapTo(
            KEPLER_MAP_ID,
            updateMap(viewportPatch(nextViewport)),
          ),
        );
      },
      onStateChange(nextFlight) {
        setFlight(nextFlight);
      },
      onComplete() {
        setLastFlightCancelReason(null);
        emitFlightTelemetry("map_focus_flight_completed", {
          focusMode: focusFilteredRef.current ? "filtered" : "visible",
        });
      },
      onCancel(reason) {
        setLastFlightCancelReason(reason);
        emitFlightTelemetry("map_focus_flight_cancelled", {
          focusMode: focusFilteredRef.current ? "filtered" : "visible",
          reason,
        });
      },
      onError(error) {
        setLastFlightCancelReason("error");
        emitFlightTelemetry("map_focus_flight_failed", {
          focusMode: focusFilteredRef.current ? "filtered" : "visible",
          code:
            error && typeof error === "object" && "name" in error
              ? String(error.name)
              : "MAP_FLIGHT_ERROR",
        });
      },
    });
    flightControllerRef.current = controller;
    return controller;
  }, [dispatch, emitFlightTelemetry]);

  const cancelFlight = useCallback((reason: MapFlightCancelReason) => {
    return flightControllerRef.current?.cancel(reason) ?? false;
  }, []);

  const finishFlight = useCallback(() => {
    return flightControllerRef.current?.finish() ?? false;
  }, []);

  const startFlight = useCallback((): KeplerCommandResult => {
    if (!capabilities.focusMapData) {
      return {
        ok: false,
        code: "CAPABILITY_DENIED",
        reason: "Você não possui acesso para centralizar o mapa.",
        command: "fitVisibleData",
        capability: "focusMapData",
      };
    }

    const start = stateRef.current?.viewport ?? baseState.viewport;
    const target = focusTargetRef.current;
    if (!start || !target || !focusBoundsRef.current) {
      return commandFailure(
        "A extensão geográfica do mapa ainda não está disponível.",
      );
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : MAP_FLIGHT_DEFAULTS.durationMs;
    setLastFlightCancelReason(null);
    emitFlightTelemetry("map_focus_flight_started", {
      focusMode: focusFilteredRef.current ? "filtered" : "visible",
      sampled: focusBoundsRef.current.sampled,
      reducedMotion: Boolean(reduceMotion),
    });
    ensureFlightController().start(start, target, duration);

    return {
      ok: true,
      changed: true,
    };
  }, [
    baseState.viewport,
    capabilities.focusMapData,
    emitFlightTelemetry,
    ensureFlightController,
  ]);

  const markClean = useCallback(() => {
    baselineHashRef.current = revisionHashRef.current;
    setSaveRuntime({
      status: "saved",
      lastConfirmedAt: new Date().toISOString(),
      error: null,
    });
    setBaselineVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    cancelFlight("context-change");
    loadingSeenRef.current = false;
    transientDatasetIdsRef.current.clear();
    selectedLayerIdRef.current = null;
    setSelectedLayerIdState(null);
    setTransientVersion((current) => current + 1);
    setSaveRuntime(INITIAL_SAVE_RUNTIME);

    if (hasProjectRef.current) {
      baselineHashRef.current = null;
    } else {
      baselineHashRef.current = revisionHashRef.current;
    }

    setBaselineVersion((current) => current + 1);
  }, [cancelFlight, contextKey]);

  useEffect(() => {
    if (!context?.project) return;

    if (baseState.isLoading) {
      cancelFlight("loading");
      loadingSeenRef.current = true;
      return;
    }

    if (loadingSeenRef.current && baselineHashRef.current === null) {
      baselineHashRef.current = revisionHash;
      setBaselineVersion((current) => current + 1);
    }
  }, [
    baseState.isLoading,
    cancelFlight,
    context?.project,
    revisionHash,
  ]);

  useEffect(() => {
    if (!flight.active || typeof document === "undefined") {
      return undefined;
    }

    const canvas = document.querySelector(".mapboxgl-canvas");
    if (!(canvas instanceof HTMLElement)) return undefined;

    const interrupt = (event: Event) => {
      if ((event as { isTrusted?: boolean }).isTrusted === false) return;
      cancelFlight("interaction");
    };

    canvas.addEventListener("pointerdown", interrupt, { capture: true });
    canvas.addEventListener("wheel", interrupt, {
      capture: true,
      passive: true,
    });
    canvas.addEventListener("touchstart", interrupt, {
      capture: true,
      passive: true,
    });

    return () => {
      canvas.removeEventListener("pointerdown", interrupt, true);
      canvas.removeEventListener("wheel", interrupt, true);
      canvas.removeEventListener("touchstart", interrupt, true);
    };
  }, [cancelFlight, flight.active]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;
    const focusState = flight.active
      ? "flying"
      : focusNeedsAttention
        ? "attention"
        : "aligned";
    root.dataset.maonoMapFlight = focusState;
    root.dataset.maonoMapFocusMode = effectiveFilterActive
      ? "filtered"
      : "visible";
    root.dataset.maonoMapFocusSampled = focusBounds?.sampled
      ? "true"
      : "false";

    const button = document.querySelector<HTMLButtonElement>(
      '.maono-map-overlay__buttons button[aria-label="Centralizar nos dados visíveis"]',
    );
    if (button) {
      button.dataset.flightState = focusState;
      button.setAttribute("aria-busy", flight.active ? "true" : "false");
      button.setAttribute("aria-disabled", flight.active ? "true" : "false");
    }

    return () => {
      delete root.dataset.maonoMapFlight;
      delete root.dataset.maonoMapFocusMode;
      delete root.dataset.maonoMapFocusSampled;
    };
  }, [
    effectiveFilterActive,
    flight.active,
    focusBounds?.sampled,
    focusNeedsAttention,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleLegacySaved = () => markClean();
    const handleTelemetry = (event: Event) => {
      const detail = telemetryDetail(event);
      const eventName = String(detail?.event ?? "");

      if (eventName === "map_save_requested") {
        finishFlight();
        setSaveRuntime({
          status: "saving",
          lastConfirmedAt: null,
          error: null,
        });
      } else if (eventName === "map_save_succeeded") {
        markClean();
      } else if (eventName === "map_save_conflict") {
        setSaveRuntime({
          status: "conflict",
          lastConfirmedAt: null,
          error: "O projeto foi alterado por outra revisão.",
        });
      }
    };
    const handleSaveResult = (event: Event) => {
      const result = mapSaveResultFromEvent(event);
      if (!result) return;

      if (result.status === "success") {
        markClean();
      } else if (result.status === "error") {
        setSaveRuntime({
          status: "error",
          lastConfirmedAt: null,
          error: result.message || "O salvamento falhou.",
        });
      }
    };

    window.addEventListener("maono:map-saved", handleLegacySaved);
    window.addEventListener("maono:map-save-succeeded", handleLegacySaved);
    window.addEventListener("maono:map-panel-telemetry", handleTelemetry);
    window.addEventListener(MAONO_MAP_SAVE_RESULT_EVENT, handleSaveResult);

    return () => {
      window.removeEventListener("maono:map-saved", handleLegacySaved);
      window.removeEventListener("maono:map-save-succeeded", handleLegacySaved);
      window.removeEventListener("maono:map-panel-telemetry", handleTelemetry);
      window.removeEventListener(MAONO_MAP_SAVE_RESULT_EVENT, handleSaveResult);
    };
  }, [finishFlight, markClean]);

  useEffect(
    () => () => {
      flightControllerRef.current?.dispose("unmount");
      flightControllerRef.current = null;
    },
    [],
  );

  const markTransientDataset = useCallback((dataId: string) => {
    transientDatasetIdsRef.current.add(dataId);
    setTransientVersion((current) => current + 1);
  }, []);
  const markPersistentDataset = useCallback((dataId: string) => {
    transientDatasetIdsRef.current.delete(dataId);
    setTransientVersion((current) => current + 1);
  }, []);
  const isTransientDataset = useCallback(
    (dataId: string) => transientDatasetIdsRef.current.has(dataId),
    [],
  );

  const baseCommands = useMemo(
    () =>
      createKeplerEngineCommands({
        dispatch,
        getState: () => store.getState(),
        capabilities,
        context,
        setSelectedLayerId,
        getSelectedLayerId,
        isTransientDataset,
        markTransientDataset,
        markPersistentDataset,
      }),
    [
      capabilities,
      context,
      dispatch,
      getSelectedLayerId,
      isTransientDataset,
      markPersistentDataset,
      markTransientDataset,
      setSelectedLayerId,
      store,
    ],
  );

  const commands = useMemo(
    () => ({
      ...baseCommands,
      fitVisibleData: startFlight,
      fitFilteredData: startFlight,
    }),
    [baseCommands, startFlight],
  );

  const state = useMemo((): KeplerEngineState => {
    const transientDatasetIds = Array.from(
      transientDatasetIdsRef.current,
    ).sort();
    const transient = new Set(transientDatasetIds);
    const hasUnsavedChanges = Boolean(
      baselineHashRef.current && baselineHashRef.current !== revisionHash,
    );
    const saveStatus: MapSaveStatus = !capabilities.saveMap
      ? "read-only"
      : saveRuntime.status === "saving" ||
          saveRuntime.status === "error" ||
          saveRuntime.status === "conflict"
        ? saveRuntime.status
        : hasUnsavedChanges
          ? "dirty"
          : saveRuntime.status === "saved"
            ? "saved"
            : "clean";
    const datasets = baseState.datasets.map((dataset) => ({
      ...dataset,
      isTransient: transient.has(dataset.id),
    }));

    return {
      ...baseState,
      mode: context?.mode ?? "viewer",
      capabilities,
      datasets,
      transientDatasetIds,
      save: {
        status: saveStatus,
        hasUnsavedChanges,
        revisionHash,
        baselineHash: baselineHashRef.current,
        revision:
          context?.project?.configRevision ?? context?.version ?? null,
        lastConfirmedAt: saveRuntime.lastConfirmedAt,
        error: saveRuntime.error,
      },
      hasUnsavedChanges,
    };
  }, [
    baseState,
    baselineVersion,
    capabilities,
    context?.mode,
    context?.project?.configRevision,
    context?.version,
    lastFlightCancelReason,
    revisionHash,
    saveRuntime,
    transientVersion,
  ]);
  stateRef.current = state;

  useEffect(
    () =>
      installKeplerEngineStateDebug(
        () => store.getState(),
        () => stateRef.current ?? state,
      ),
    [store],
  );

  const value = useMemo(
    () => ({
      state,
      commands,
      markClean,
    }),
    [commands, markClean, state],
  );

  return (
    <KeplerEngineAdapterContext.Provider value={value}>
      {children}
    </KeplerEngineAdapterContext.Provider>
  );
}

export function useKeplerEngineAdapter() {
  const value = useContext(KeplerEngineAdapterContext);

  if (!value) {
    throw new Error(
      "useKeplerEngineAdapter deve ser usado dentro de KeplerEngineAdapterProvider.",
    );
  }

  return value;
}
