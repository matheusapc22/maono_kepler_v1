import { useLayoutEffect } from "react";

import { useLoading } from "./LoadingProvider";

export function useCompleteLoadingHandoff(
  key: string,
  complete: boolean,
) {
  const {
    claimLoadingHandoff,
    completeLoadingHandoff,
  } = useLoading();

  useLayoutEffect(() => {
    const claimed = claimLoadingHandoff(key);

    if (complete && claimed) {
      completeLoadingHandoff(key);
    }
  }, [
    claimLoadingHandoff,
    complete,
    completeLoadingHandoff,
    key,
  ]);
}
