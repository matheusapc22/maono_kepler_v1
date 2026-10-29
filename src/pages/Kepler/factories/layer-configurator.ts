import { LayerConfiguratorFactory } from "@kepler.gl/components";
import { CustomLayerConfiguratorFactory } from "./layer-configurator.tsx";

export { CustomLayerConfiguratorFactory };

export function replaceLayerConfigurator() {
  return [LayerConfiguratorFactory, CustomLayerConfiguratorFactory];
}
