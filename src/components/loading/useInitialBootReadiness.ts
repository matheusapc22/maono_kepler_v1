import { useLayoutEffect } from "react";

import { useLoading } from "./LoadingProvider";

export function useInitialBootReadiness(ready: boolean) {
  const { completeInitialBootLoading } = useLoading();

  useLayoutEffect(() => {
    if (ready) {
      completeInitialBootLoading();
    }
  }, [completeInitialBootLoading, ready]);
}
