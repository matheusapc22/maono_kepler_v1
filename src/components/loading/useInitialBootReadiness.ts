import { useLayoutEffect } from "react";

import { useLoading } from "./LoadingProvider.ts";

export function useInitialBootReadiness(ready: boolean) {
  const { completeInitialBootLoading } = useLoading();

  useLayoutEffect(() => {
    if (ready) {
      completeInitialBootLoading();
    }
  }, [completeInitialBootLoading, ready]);
}
