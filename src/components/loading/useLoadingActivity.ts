import { useLayoutEffect, useRef } from "react";

import { useLoading } from "./LoadingProvider";
import type { LoadingToken } from "./loading-controller";

export function useLoadingActivity(active: boolean) {
  const { beginLoading, endLoading } = useLoading();
  const tokenRef = useRef<LoadingToken | null>(null);

  useLayoutEffect(() => {
    if (active && tokenRef.current === null) {
      tokenRef.current = beginLoading({ immediate: true });
      return;
    }

    if (!active && tokenRef.current !== null) {
      endLoading(tokenRef.current);
      tokenRef.current = null;
    }
  }, [active, beginLoading, endLoading]);

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
