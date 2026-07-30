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

import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import { createKeplerEngineCommands } from "./commands.ts";
import {
  createKeplerEngineSelector,
  selectKeplerMapState,
} from "./selectors.ts";
import { hashKeplerRevision } from "./serialization.ts";
import type { KeplerEngineAdapterValue } from "./types.ts";

const KeplerEngineAdapterContext =
  createContext<KeplerEngineAdapterValue | null>(null);

export function KeplerEngineAdapterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();
  const selector = useMemo(() => createKeplerEngineSelector(), []);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const transientDatasetIdsRef = useRef(new Set<string>());
  const [transientVersion, setTransientVersion] = useState(0);
  const baselineHashRef = useRef<string | null>(null);
  const loadingSeenRef = useRef(false);
  const revisionHashRef = useRef("");
  const hasProjectRef = useRef(false);
  const [baselineVersion, setBaselineVersion] = useState(0);
  const selectEngineState = useCallback(
    (rootState: any) => selector(rootState, selectedLayerId),
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
  const contextKey = [
    context?.organization?.id ?? "none",
    context?.project?.id ?? "none",
    context?.project?.configRevision ?? context?.version ?? 0,
    context?.mode ?? "none",
  ].join(":");

  const markClean = useCallback(() => {
    baselineHashRef.current = revisionHash;
    setBaselineVersion((current) => current + 1);
  }, [revisionHash]);

  useEffect(() => {
    loadingSeenRef.current = false;
    transientDatasetIdsRef.current.clear();
    setTransientVersion((current) => current + 1);

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

    const handleSaved = () => markClean();
    window.addEventListener("maono:map-saved", handleSaved);
    window.addEventListener("maono:map-save-succeeded", handleSaved);

    return () => {
      window.removeEventListener("maono:map-saved", handleSaved);
      window.removeEventListener("maono:map-save-succeeded", handleSaved);
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
        capabilities: context?.capabilities,
        context,
        setSelectedLayerId,
        isTransientDataset,
        markTransientDataset,
        markPersistentDataset,
      }),
    [
      context,
      dispatch,
      isTransientDataset,
      markPersistentDataset,
      markTransientDataset,
      store,
    ],
  );
  const state = useMemo(
    () => ({
      ...baseState,
      transientDatasetIds: Array.from(transientDatasetIdsRef.current),
      hasUnsavedChanges: Boolean(
        baselineHashRef.current && baselineHashRef.current !== revisionHash,
      ),
    }),
    [baseState, baselineVersion, revisionHash, transientVersion],
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
