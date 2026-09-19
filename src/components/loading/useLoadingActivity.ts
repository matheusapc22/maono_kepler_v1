import { useLayoutEffect, useRef } from "react";

import { useLoading } from "./LoadingProvider";
import type {
  LoadingToken,
  LoadingTokenMetadataInput,
} from "./loading-controller";

type LoadingActivityOptions = {
  immediate?: boolean;
  metadata?: LoadingTokenMetadataInput;
};

export function useLoadingActivity(
  active: boolean,
  {
    immediate = true,
    metadata,
  }: LoadingActivityOptions = {},
) {
  const { beginLoading, endLoading } = useLoading();
  const tokenRef = useRef<LoadingToken | null>(null);
  const label = metadata?.label ?? "unclassified";
  const scope = metadata?.scope ?? "system";
  const surface = metadata?.surface ?? "viewport";

  useLayoutEffect(() => {
    if (active && tokenRef.current === null) {
      tokenRef.current = beginLoading({
        immediate,
        metadata: {
          label,
          scope,
          surface,
        },
      });
      return;
    }

    if (!active && tokenRef.current !== null) {
      endLoading(tokenRef.current);
      tokenRef.current = null;
    }
  }, [
    active,
    beginLoading,
    endLoading,
    immediate,
    label,
    scope,
    surface,
  ]);

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
