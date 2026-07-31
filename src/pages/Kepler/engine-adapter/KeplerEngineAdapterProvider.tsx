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

import {
  MAONO_MAP_SAVE_RESULT_EVENT,
  mapSaveResultFromEvent,
} from "../map-panel/map-save-events.ts";
import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import { EMPTY_MAP_CAPABILITIES } from "../map-panel/types.ts";
import { createKeplerEngineCommands } from "./commands.ts";
import { installKeplerEngineStateDebug } from "./engine-state-debug.ts";
import {
  createKeplerEngineSelector,
  selectKeplerMapState,
} from "./selectors.ts";
import { hashKeplerRevision } from "./serialization.ts";
import type {
  KeplerEngineAdapterValue,
  KeplerEngineState,
  MapSaveStatus,
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

function telemetryDetail(event: Event) {
  const detail = (event as CustomEvent<unknown>).detail;
  return detail && typeof detail === "object"
    ? (detail as { event?: unknown; message?: unknown })
    : null;
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
  const revisionHash = useMemo(
    () => hashKeplerRevision(rawMapState),
    [rawMapState],
  );
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
  }, [contextKey]);

  useEffect(() => {
    if (!context?.project) return;

    if (baseState.isLoading) {
      loadingSeenRef.current = true;
      return;
    }

    if (loadingSeenRef.current && baselineHashRef.current === null) {
      baselineHashRef.current = revisionHash;
      setBaselineVersion((current) => current + 1);
    }
  }, [baseState.isLoading, context?.project, revisionHash]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleLegacySaved = () => markClean();
    const handleTelemetry = (event: Event) => {
      const detail = telemetryDetail(event);
      const eventName = String(detail?.event ?? "");

      if (eventName === "map_save_requested") {
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
  }, [markClean]);

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

  const commands = useMemo(
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
