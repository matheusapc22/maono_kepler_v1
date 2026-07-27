// @ts-nocheck
import React from "react";
import { LayerConfiguratorFactory } from "@kepler.gl/components";
import { useMapPanel } from "../map-panel/MapPanelContext";

const POINT_STYLE_LAYER_TYPES = new Set(["point", "cluster", "heatmap"]);

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function isPointStyleOption(option: any) {
  return POINT_STYLE_LAYER_TYPES.has(normalize(option?.id));
}

function getCurrentLayerOption(options: any[], layer: any) {
  const currentLayerType = normalize(layer?.type);
  return options.find((option) => normalize(option?.id) === currentLayerType);
}

function getSafeLayerTypeConfig(props: any, restrict: boolean) {
  const options = Array.isArray(props?.layerTypeOptions) ? props.layerTypeOptions : [];

  if (!restrict) {
    return {
      layerTypeOptions: options,
      disableTypeSelect: props?.disableTypeSelect,
    };
  }

  const pointStyleOptions = options.filter(isPointStyleOption);
  const hasEnabledPointStyleOption = pointStyleOptions.some((option) => !option?.disabled);

  // Se o arquivo/dataset é compatível com ponto, a troca fica limitada a:
  // Ponto, Grupo/Cluster e Mapa de Calor.
  if (hasEnabledPointStyleOption) {
    return {
      layerTypeOptions: pointStyleOptions,
      disableTypeSelect: props?.disableTypeSelect,
    };
  }

  // Se não for arquivo/dataset de ponto, não exibe a tela de troca de estilo.
  // Mantém apenas o tipo atual, travado, para evitar mudança indevida de geometria.
  const currentOption = getCurrentLayerOption(options, props?.layer);

  return {
    layerTypeOptions: currentOption ? [currentOption] : [],
    disableTypeSelect: true,
  };
}

export function CustomLayerConfiguratorFactory(...deps: any[]) {
  const DefaultLayerConfigurator = LayerConfiguratorFactory(...deps);

  const Wrapped = (props: any) => {
    const { context } = useMapPanel();
    const safeLayerTypeConfig = getSafeLayerTypeConfig(
      props,
      !context?.capabilities?.editLayerStyle,
    );

    return <DefaultLayerConfigurator {...props} {...safeLayerTypeConfig} />;
  };

  (Wrapped as any).deps = (DefaultLayerConfigurator as any).deps;
  return Wrapped;
}

CustomLayerConfiguratorFactory.deps = LayerConfiguratorFactory.deps;

export function replaceLayerConfigurator() {
  return [LayerConfiguratorFactory, CustomLayerConfiguratorFactory];
}
