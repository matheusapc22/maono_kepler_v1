import { useLayoutEffect, useRef } from "react";

import { useLoading } from "./LoadingProvider";
import type { LoadingToken } from "./loading-controller";

type LoadingActivityOptions = {
  immediate?: boolean;
};

export function useLoadingActivity(
  active: boolean,
  { immediate = true }: LoadingActivityOptions = {},
) {
  const { beginLoading, endLoading } = useLoading();
  const tokenRef = useRef<LoadingToken | null>(null);

  useLayoutEffect(() => {
    if (active && tokenRef.current === null) {
      tokenRef.current = beginLoading({ immediate });
      return;
    }

    if (!active && tokenRef.current !== null) {
      endLoading(tokenRef.current);
      tokenRef.current = null;
    }
  }, [active, beginLoading, endLoading, immediate]);

  useLayoutEffect(
    () => () => {
      if (tokenRef.current !== null) {
        endLoading(tokenRef.current);
        tokenRef.current = null;
      }
    },
    [endLoading],
  );
}
