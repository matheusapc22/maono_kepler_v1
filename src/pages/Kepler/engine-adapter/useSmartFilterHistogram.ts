import { useMemo } from "react";
import { useSelector } from "react-redux";

import type { MaonoFilterSnapshot } from "../integration/keplerBridge.ts";
import { buildSmartFilterHistogram } from "./filter-histogram-engine.ts";
import { selectKeplerVisState } from "./selectors.ts";

export function useSmartFilterHistogram(filter: MaonoFilterSnapshot) {
  const visState = useSelector(selectKeplerVisState);

  return useMemo(() => {
    const isolatedRootState = {
      demo: {
        keplerGl: {
          map: { visState },
        },
      },
    };

    return buildSmartFilterHistogram(isolatedRootState, filter.index);
  }, [filter.index, visState]);
}
