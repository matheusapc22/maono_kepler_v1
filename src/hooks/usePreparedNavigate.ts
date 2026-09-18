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
  to: string;
  replace?: boolean;
  beforeNavigate?: () => Promise<void> | void;
};

export function usePreparedNavigate() {
  const navigate = useNavigate();
  const { beginLoading, endLoading } = useLoading();
  const controllerRef = useRef<PreparedNavigationIntentController | null>(null);
  const activeLoadingTokenRef = useRef<LoadingToken | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new PreparedNavigationIntentController();
  }

  const cancelPreparedNavigation = useCallback(() => {
    controllerRef.current?.cancel();

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
      beforeNavigate,
    }: PreparedNavigationOptions) => {
      const controller = controllerRef.current;

      if (!controller) {
        return false;
      }

      const intent = controller.begin();

      if (activeLoadingTokenRef.current !== null) {
        endLoading(activeLoadingTokenRef.current);
      }

      const loadingToken = beginLoading();
      activeLoadingTokenRef.current = loadingToken;

      try {
        await preloadRouteModule(route);

        if (!controller.isCurrent(intent)) {
          return false;
        }

        if (beforeNavigate) {
          await beforeNavigate();
        }

        if (!controller.isCurrent(intent)) {
          return false;
        }

        navigate(to, { replace });
        return true;
      } finally {
        if (activeLoadingTokenRef.current === loadingToken) {
          activeLoadingTokenRef.current = null;
        }

        endLoading(loadingToken);
      }
    },
    [beginLoading, endLoading, navigate],
  );

  return {
    prepareNavigate,
    cancelPreparedNavigation,
  };
}
