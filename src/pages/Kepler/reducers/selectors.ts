import { path } from "ramda";
import type { RootState } from "../../../store";

export type KeplerMapState = {
  visState?: unknown;
  mapState?: unknown;
  mapStyle?: unknown;
  uiState?: unknown;
};

export const selectIsMapLoading = path(["demo", "app", "isMapLoading"]) as (
  state: RootState,
) => boolean;

export const selectKeplerMapState = path(["demo", "keplerGl", "map"]) as (
  state: RootState,
) => KeplerMapState | null | undefined;