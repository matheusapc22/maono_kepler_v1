import { path } from "ramda";
import type { RootState } from "../../../store";

export const selectIsMapLoading = path(["demo", "app", "isMapLoading"]) as (
  state: RootState
) => boolean;
