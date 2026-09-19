import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LoadingOverlay } from "./LoadingOverlay";
import {
  LoadingController,
  type LoadingToken,
} from "./loading-controller";

const DEFAULT_SHOW_AFTER_MS = 120;
const DEFAULT_MIN_VISIBLE_MS = 250;

type LoadingOperation<T> = () => Promise<T> | T;
type BeginLoadingOptions = {
  immediate?: boolean;
};

type LoadingContextValue = {
  isLoading: boolean;
  isVisible: boolean;
  activeCount: number;
  beginLoading: (options?: BeginLoadingOptions) => LoadingToken;
  endLoading: (token: LoadingToken) => void;
  withLoading: <T>(operation: LoadingOperation<T>) => Promise<T>;
};

type LoadingProviderProps = {
  children: ReactNode;
  showAfterMs?: number;
  minVisibleMs?: number;
};

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function LoadingProvider({
  children,
  showAfterMs = DEFAULT_SHOW_AFTER_MS,
  minVisibleMs = DEFAULT_MIN_VISIBLE_MS,
}: LoadingProviderProps) {
  const controllerRef = useRef<LoadingController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new LoadingController();
  }

  const controller = controllerRef.current;
  const [activeCount, setActiveCount] = useState(controller.activeCount);
  const [isVisible, setIsVisible] = useState(false);
  const shownAtRef = useRef(0);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => controller.subscribe(setActiveCount), [controller]);

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

  useEffect(
    () => () => {
      controller.clear();
    },
    [controller],
  );

  const beginLoading = useCallback(
    (options?: BeginLoadingOptions) => {
      if (options?.immediate) {
        shownAtRef.current = Date.now();
        setIsVisible(true);
      }

      return controller.begin();
    },
    [controller],
  );
  const endLoading = useCallback(
    (token: LoadingToken) => controller.end(token),
    [controller],
  );
  const withLoading = useCallback(
    <T,>(operation: LoadingOperation<T>) => controller.withLoading(operation),
    [controller],
  );

  const value = useMemo<LoadingContextValue>(
    () => ({
      isLoading: activeCount > 0,
      isVisible,
      activeCount,
      beginLoading,
      endLoading,
      withLoading,
    }),
    [
      activeCount,
      beginLoading,
      endLoading,
      isVisible,
      withLoading,
    ],
  );

  return (
    <LoadingContext.Provider value={value}>
      {children}
      <LoadingOverlay
        active={isVisible}
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
