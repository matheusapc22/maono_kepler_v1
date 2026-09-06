import { useMemo } from "react";

import { withViewerMutationPolicy } from "../change-requests/viewer-mutation-policy.ts";
import { useKeplerEngineAdapter as useRawKeplerEngineAdapter } from "./KeplerEngineAdapterProvider.tsx";

export function useViewerAwareKeplerEngineAdapter() {
  const value = useRawKeplerEngineAdapter();
  const commands = useMemo(
    () => withViewerMutationPolicy(value.commands, value.state.mode === "viewer"),
    [value.commands, value.state.mode],
  );

  return useMemo(
    () => ({ ...value, commands }),
    [commands, value],
  );
}
