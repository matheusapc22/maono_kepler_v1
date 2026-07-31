import { useMemo } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter/index.ts";
import type { MaonoLayerSnapshot } from "../integration/keplerBridge.ts";

/**
 * Facade compatível com o painel atual. Novos componentes podem consumir
 * commands diretamente por useKeplerEngineAdapter().
 */
export function useKeplerController() {
  const { commands, state } = useKeplerEngineAdapter();

  return useMemo(
    () => ({
      ...commands,
      inspectLayer(layerId?: string) {
        return commands.selectLayer(layerId ?? state.selectedLayerId);
      },
      toggleLayerVisibility(layer: MaonoLayerSnapshot, visible: boolean) {
        return commands.setLayerVisibility(layer.id, visible);
      },
      updateLayerLabel(layer: MaonoLayerSnapshot, label: string) {
        return commands.renameLayer(layer.id, label);
      },
      updateLayerOpacity(layer: MaonoLayerSnapshot, opacity: number) {
        return commands.setLayerOpacity(layer.id, opacity);
      },
      updateLayerColor(
        layer: MaonoLayerSnapshot,
        color: [number, number, number],
      ) {
        return commands.setFixedColor(layer.id, color);
      },
      createLayer() {
        return commands.openAddDataModal();
      },
      reorderLayers(order: string[]) {
        return commands.reorderLayer(order);
      },
    }),
    [commands, state.selectedLayerId],
  );
}
