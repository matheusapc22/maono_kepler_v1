import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";

import {
  useLoading,
  type LoadingToken,
} from "../components/loading";
import {
  preloadRouteModule,
  type RouteModuleKey,
} from "../route-modules";
import { PreparedNavigationIntentController } from "../navigation/prepared-navigation-controller";

type PreparedNavigationOptions = {
  route: RouteModuleKey;
  to: string | (() => string);
  replace?: boolean;
  handoffKey?: string | ((destination: string) => string);
  beforeNavigate?: (signal: AbortSignal) => Promise<void> | void;
};

export function usePreparedNavigate() {
  const navigate = useNavigate();
  const {
    beginLoading,
    endLoading,
    handoffLoading,
    cancelLoadingHandoff,
  } = useLoading();
  const controllerRef = useRef<PreparedNavigationIntentController | null>(null);
  const activeLoadingTokenRef = useRef<LoadingToken | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new PreparedNavigationIntentController();
  }

  const cancelPreparedNavigation = useCallback(() => {
    controllerRef.current?.cancel();
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;

    if (activeLoadingTokenRef.current !== null) {
      endLoading(activeLoadingTokenRef.current);
      activeLoadingTokenRef.current = null;
    }
  }, [endLoading]);

  useEffect(
    () => () => {
      cancelPreparedNavigation();
    },
    [cancelPreparedNavigation],
  );

  const prepareNavigate = useCallback(
    async ({
      route,
      to,
      replace = false,
      handoffKey,
      beforeNavigate,
    }: PreparedNavigationOptions) => {
      const controller = controllerRef.current;

      if (!controller) {
        return false;
      }

      const intent = controller.begin();

      activeAbortControllerRef.current?.abort();

      if (activeLoadingTokenRef.current !== null) {
        endLoading(activeLoadingTokenRef.current);
      }

      const loadingToken = beginLoading({
        immediate: true,
        metadata: {
          label: "prepared-navigation",
          scope: "navigation",
          surface: handoffKey ? "handoff" : "viewport",
        },
      });
      const abortController = new AbortController();
      activeLoadingTokenRef.current = loadingToken;
      activeAbortControllerRef.current = abortController;

      let handedOff = false;
      let resolvedHandoffKey: string | null = null;

      try {
        await Promise.all([
          preloadRouteModule(route),
          beforeNavigate
            ? beforeNavigate(abortController.signal)
            : Promise.resolve(),
        ]);

        if (
          abortController.signal.aborted ||
          !controller.isCurrent(intent)
        ) {
          return false;
        }

        const destination =
          typeof to === "function" ? to() : to;

        if (!destination) {
          throw new Error("Destino de navegação não resolvido.");
        }

        if (handoffKey) {
          resolvedHandoffKey =
            typeof handoffKey === "function"
              ? handoffKey(destination)
              : handoffKey;

          handoffLoading(
            resolvedHandoffKey,
            loadingToken,
            destination,
          );

          activeLoadingTokenRef.current = null;
          handedOff = true;
        }

        try {
          navigate(destination, { replace });
        } catch (navigationError) {
          if (handedOff && resolvedHandoffKey) {
            cancelLoadingHandoff(resolvedHandoffKey);
            handedOff = false;
          }
          throw navigationError;
        }

        return true;
      } catch (error) {
        if (abortController.signal.aborted) {
          return false;
        }

        throw error;
      } finally {
        if (activeAbortControllerRef.current === abortController) {
          activeAbortControllerRef.current = null;
        }
        if (!handedOff) {
          if (activeLoadingTokenRef.current === loadingToken) {
            activeLoadingTokenRef.current = null;
          }

          endLoading(loadingToken);
        }
      }
    },
    [
      beginLoading,
      cancelLoadingHandoff,
      endLoading,
      handoffLoading,
      navigate,
    ],
  );

  return {
    prepareNavigate,
    cancelPreparedNavigation,
  };
}
