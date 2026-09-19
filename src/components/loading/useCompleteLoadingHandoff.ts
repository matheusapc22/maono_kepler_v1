import { useEffect } from "react";

import { completeLoadingHandoff } from "./loading-handoff";
import { useLoading } from "./LoadingProvider";

export function useCompleteLoadingHandoff(
  key: string,
  complete: boolean,
) {
  const { endLoading } = useLoading();

  useEffect(() => {
    if (!complete) return;

    const token = completeLoadingHandoff(key);
    if (token !== null) {
      endLoading(token);
    }
  }, [complete, endLoading, key]);
}
