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
} from "./loading-controller";
import { LoadingHandoffController } from "./loading-handoff-controller";

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
  handoffLoading: (
    key: string,
    token: LoadingToken,
    destination: string,
  ) => void;
  claimLoadingHandoff: (key: string) => boolean;
  completeLoadingHandoff: (key: string) => boolean;
  cancelLoadingHandoff: (key: string) => boolean;
  getLoadingHandoffCount: () => number;
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

      return controller.begin();
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
      handoffLoading,
      claimLoadingHandoff,
      completeLoadingHandoff,
      cancelLoadingHandoff,
      getLoadingHandoffCount,
      withLoading,
    }),
    [
      activeCount,
      beginLoading,
      cancelLoadingHandoff,
      claimLoadingHandoff,
      completeLoadingHandoff,
      endLoading,
      getLoadingHandoffCount,
      handoffLoading,
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
