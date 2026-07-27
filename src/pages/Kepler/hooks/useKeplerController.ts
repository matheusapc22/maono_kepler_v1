import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import {
  addFilter,
  duplicateLayer,
  layerConfigChange,
  layerToggleVisibility,
  layerVisConfigChange,
  removeFilter,
  removeLayer as removeKeplerLayer,
  reorderLayer,
  setFilter,
  toggleModal,
} from "@kepler.gl/actions";

import { useMapPanel } from "../map-panel/MapPanelContext";
import {
  authorizeMapPanelCommand,
  type KeplerCommandResult,
} from "../map-panel/map-panel-capabilities";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry";
import type { MapCapabilities } from "../map-panel/types";
import type {
  MaonoLayerSnapshot,
} from "../integration/keplerBridge";

function emitCommandTelemetry(
  event: string,
  context: any,
  {
    command,
    capability,
    code,
  }: {
    command: string;
    capability: keyof MapCapabilities;
    code?: string;
  },
) {
  emitMapPanelTelemetry(event, {
    mode: context?.mode ?? null,
    projectId: context?.project?.id ?? null,
    organizationId: context?.organization?.id ?? null,
    code: code ?? null,
    policyVersion: context?.policyVersion ?? null,
    command,
    capability,
    source: "maono-layer-panel",
  });
}

export function useKeplerController() {
  const dispatch = useDispatch();
  const { context } = useMapPanel();
  const capabilities = context?.capabilities;

  const run = useCallback(
    (
      command: string,
      capability: keyof MapCapabilities,
      action: () => void,
    ): KeplerCommandResult => {
      const authorization = authorizeMapPanelCommand(
        capabilities,
        command,
        capability,
      );

      if (!authorization.ok) {
        emitCommandTelemetry(
          "map_panel_command_denied",
          context,
          {
            command,
            capability,
            code: authorization.code,
          },
        );
        return authorization;
      }

      action();
      emitCommandTelemetry(
        "map_panel_command_executed",
        context,
        { command, capability },
      );
      return { ok: true };
    },
    [capabilities, context],
  );

  return useMemo(
    () => ({
      inspectLayer() {
        return run("inspectLayer", "inspectLayer", () => {});
      },
      toggleLayerVisibility(
        layer: MaonoLayerSnapshot,
        visible: boolean,
      ) {
        return run(
          "toggleLayerVisibility",
          "toggleLayerVisibility",
          () => dispatch(layerToggleVisibility(layer.id, visible)),
        );
      },
      updateLayerLabel(
        layer: MaonoLayerSnapshot,
        label: string,
      ) {
        return run("updateLayerLabel", "editLayerStyle", () =>
          dispatch(
            layerConfigChange(layer.raw, {
              label: label.trim() || layer.label,
            }),
          ),
        );
      },
      updateLayerOpacity(
        layer: MaonoLayerSnapshot,
        opacity: number,
      ) {
        return run("updateLayerOpacity", "editLayerStyle", () =>
          dispatch(
            layerVisConfigChange(layer.raw, {
              opacity: Math.min(1, Math.max(0, opacity)),
            }),
          ),
        );
      },
      updateLayerColor(
        layer: MaonoLayerSnapshot,
        color: [number, number, number],
      ) {
        return run("updateLayerColor", "editLayerStyle", () =>
          dispatch(layerConfigChange(layer.raw, { color })),
        );
      },
      createLayer() {
        return run("createLayer", "createLayer", () =>
          dispatch(toggleModal("addData")),
        );
      },
      removeLayer(layerId: string) {
        return run("removeLayer", "removeLayer", () =>
          dispatch(removeKeplerLayer(layerId)),
        );
      },
      duplicateLayer(layerId: string) {
        return run("duplicateLayer", "duplicateLayer", () =>
          dispatch(duplicateLayer(layerId)),
        );
      },
      reorderLayers(order: string[]) {
        return run("reorderLayers", "reorderLayers", () =>
          dispatch(reorderLayer(order)),
        );
      },
      addFilter(dataId: string | null) {
        return run("addFilter", "editFilters", () =>
          dispatch(addFilter(dataId)),
        );
      },
      removeFilter(index: number) {
        return run("removeFilter", "editFilters", () =>
          dispatch(removeFilter(index)),
        );
      },
      setFilterValue(index: number, value: unknown) {
        return run("setFilterValue", "editFilters", () =>
          dispatch(setFilter(index, "value", value)),
        );
      },
    }),
    [dispatch, run],
  );
}
