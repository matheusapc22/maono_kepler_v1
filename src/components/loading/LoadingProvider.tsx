import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

import { LoadingOverlay } from "./LoadingOverlay";
import {
  LoadingController,
  type LoadingToken,
  type LoadingTokenMetadataInput,
} from "./loading-controller";
import {
  DEFAULT_LOADING_STALE_MS,
  LoadingStaleObserver,
  type LoadingStaleDiagnostic,
} from "./loading-diagnostics";
import { LoadingHandoffController } from "./loading-handoff-controller";
import {
  completeInitialBootLoader,
  hasInitialBootLoader,
} from "./initial-boot-loader";

const DEFAULT_SHOW_AFTER_MS = 120;
const DEFAULT_MIN_VISIBLE_MS = 250;

type LoadingOperation<T> = () => Promise<T> | T;
type BeginLoadingOptions = {
  immediate?: boolean;
  metadata?: LoadingTokenMetadataInput;
};

type LoadingContextValue = {
  isLoading: boolean;
  isVisible: boolean;
  initialBootActive: boolean;
  activeCount: number;
  beginLoading: (options?: BeginLoadingOptions) => LoadingToken;
  endLoading: (token: LoadingToken) => void;
  handoffLoading: (
    key: string,
    token: LoadingToken,
    destination: string,
  ) => void;
  claimLoadingHandoff: (key: string) => boolean;
  completeLoadingHandoff: (key: string) => boolean;
  cancelLoadingHandoff: (key: string) => boolean;
  getLoadingHandoffCount: () => number;
  completeInitialBootLoading: () => boolean;
  withLoading: <T>(
    operation: LoadingOperation<T>,
    options?: BeginLoadingOptions,
  ) => Promise<T>;
};

type LoadingProviderProps = {
  children: ReactNode;
  showAfterMs?: number;
  minVisibleMs?: number;
  staleAfterMs?: number;
};

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function LoadingProvider({
  children,
  showAfterMs = DEFAULT_SHOW_AFTER_MS,
  minVisibleMs = DEFAULT_MIN_VISIBLE_MS,
  staleAfterMs = DEFAULT_LOADING_STALE_MS,
}: LoadingProviderProps) {
  const location = useLocation();
  const controllerRef = useRef<LoadingController | null>(null);
  const handoffControllerRef =
    useRef<LoadingHandoffController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new LoadingController();
  }

  if (!handoffControllerRef.current) {
    handoffControllerRef.current = new LoadingHandoffController();
  }

  const controller = controllerRef.current;
  const handoffController = handoffControllerRef.current;
  const [activeCount, setActiveCount] = useState(controller.activeCount);
  const [isVisible, setIsVisible] = useState(false);
  const [initialBootActive, setInitialBootActive] = useState(() =>
    hasInitialBootLoader(),
  );
  const shownAtRef = useRef(0);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleDiagnosticsRef = useRef<LoadingStaleDiagnostic[]>([]);

  useEffect(() => controller.subscribe(setActiveCount), [controller]);

  useEffect(() => {
    const observer = new LoadingStaleObserver(controller, {
      staleAfterMs,
      onStale(diagnostic) {
        staleDiagnosticsRef.current = [
          ...staleDiagnosticsRef.current.slice(-19),
          diagnostic,
        ];
        console.warn("[Maono loading] token global stale", diagnostic);
      },
    });
    observer.start();

    return () => observer.stop();
  }, [controller, staleAfterMs]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") {
      return;
    }

    const currentWindow = window as any;
    const bridge = {
      activeCount: () => controller.activeCount,
      handoffCount: () => handoffController.activeCount,
      snapshot: () => controller.getActiveSnapshot(),
      staleDiagnostics: () => [...staleDiagnosticsRef.current],
    };

    currentWindow.__MAONO_LOADING_DEBUG__ = bridge;

    return () => {
      if (currentWindow.__MAONO_LOADING_DEBUG__ === bridge) {
        delete currentWindow.__MAONO_LOADING_DEBUG__;
      }
    };
  }, [controller, handoffController]);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    const clearHideTimer = () => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    if (activeCount > 0) {
      clearHideTimer();

      if (isVisible || showTimerRef.current !== null) {
        return () => {
          clearShowTimer();
          clearHideTimer();
        };
      }

      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        shownAtRef.current = Date.now();
        setIsVisible(true);
      }, Math.max(0, showAfterMs));

      return () => {
        clearShowTimer();
        clearHideTimer();
      };
    }

    clearShowTimer();

    if (!isVisible) {
      return () => {
        clearHideTimer();
      };
    }

    const elapsed = Date.now() - shownAtRef.current;
    const remaining = Math.max(0, minVisibleMs - elapsed);

    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setIsVisible(false);
    }, remaining);

    return () => {
      clearHideTimer();
    };
  }, [activeCount, isVisible, minVisibleMs, showAfterMs]);

  useLayoutEffect(() => {
    const currentLocation = `${location.pathname}${location.search}`;
    const cancelled =
      handoffController.cancelOutsideLocation(currentLocation);

    for (const entry of cancelled) {
      controller.end(entry.token);
    }
  }, [
    controller,
    handoffController,
    location.pathname,
    location.search,
  ]);

  useEffect(
    () => () => {
      handoffController.cancelAll();
      controller.clear();
    },
    [controller, handoffController],
  );

  const beginLoading = useCallback(
    (options?: BeginLoadingOptions) => {
      if (options?.immediate) {
        shownAtRef.current = Date.now();
        setIsVisible(true);
      }

      return controller.begin(options?.metadata);
    },
    [controller],
  );
  const endLoading = useCallback(
    (token: LoadingToken) => controller.end(token),
    [controller],
  );
  const handoffLoading = useCallback(
    (
      key: string,
      token: LoadingToken,
      destination: string,
    ) => {
      if (!controller.owns(token)) {
        throw new Error(
          "Loading handoff recebeu token fora do LoadingProvider atual.",
        );
      }

      const previous = handoffController.prime({
        key,
        token,
        destination,
      });

      if (
        previous !== null &&
        previous.token !== token
      ) {
        controller.end(previous.token);
      }
    },
    [controller, handoffController],
  );
  const claimLoadingHandoff = useCallback(
    (key: string) => handoffController.claim(key) !== null,
    [handoffController],
  );
  const completeLoadingHandoff = useCallback(
    (key: string) => {
      const entry = handoffController.complete(key);

      if (!entry) {
        return false;
      }

      controller.end(entry.token);
      return true;
    },
    [controller, handoffController],
  );
  const cancelLoadingHandoff = useCallback(
    (key: string) => {
      const entry = handoffController.cancel(key);

      if (!entry) {
        return false;
      }

      controller.end(entry.token);
      return true;
    },
    [controller, handoffController],
  );
  const getLoadingHandoffCount = useCallback(
    () => handoffController.activeCount,
    [handoffController],
  );
  const completeInitialBootLoading = useCallback(() => {
    if (!initialBootActive) {
      return true;
    }

    setIsVisible(false);
    const removed = completeInitialBootLoader();
    setInitialBootActive(false);
    return removed;
  }, [initialBootActive]);

  const withLoading = useCallback(
    <T,>(
      operation: LoadingOperation<T>,
      options?: BeginLoadingOptions,
    ) => {
      if (options?.immediate) {
        shownAtRef.current = Date.now();
        setIsVisible(true);
      }

      return controller.withLoading(
        operation,
        options?.metadata,
      );
    },
    [controller],
  );

  const value = useMemo<LoadingContextValue>(
    () => ({
      isLoading: activeCount > 0,
      isVisible,
      initialBootActive,
      activeCount,
      beginLoading,
      endLoading,
      handoffLoading,
      claimLoadingHandoff,
      completeLoadingHandoff,
      cancelLoadingHandoff,
      getLoadingHandoffCount,
      completeInitialBootLoading,
      withLoading,
    }),
    [
      activeCount,
      beginLoading,
      cancelLoadingHandoff,
      claimLoadingHandoff,
      completeInitialBootLoading,
      completeLoadingHandoff,
      endLoading,
      getLoadingHandoffCount,
      handoffLoading,
      initialBootActive,
      isVisible,
      withLoading,
    ],
  );

  return (
    <LoadingContext.Provider value={value}>
      {children}
      <LoadingOverlay
        active={isVisible && !initialBootActive}
        scope="viewport"
        accessibleLabel="Carregando conteúdo"
      />
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const context = useContext(LoadingContext);

  if (!context) {
    throw new Error("useLoading precisa estar dentro de LoadingProvider.");
  }

  return context;
}
