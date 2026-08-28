import * as KeplerSchemas from "@kepler.gl/schemas";

import { prepareSavedConfigForPointClustering } from "../clustering/point-cluster-controller.ts";
import { loadPointClusterState } from "../clustering/point-cluster-store.ts";

export type SavedConfigHydrationError = Error & {
  code: "KEPLER_SCHEMA_LOAD_FAILED";
  category: "MAP_CONFIG";
  retryable: false;
};

const MAONO_ANALYSIS_DATA_ID_PATTERN = /^maono_analysis_(?:buffer|isochrone)_/;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function datasetIdOf(dataset: unknown): string {
  if (!isRecord(dataset)) return "";
  const candidates = [dataset?.info?.id, dataset?.data?.id, dataset?.id];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function layerDataIds(layer: unknown): string[] {
  if (!isRecord(layer)) return [];
  const dataId = layer?.config?.dataId ?? layer?.dataId;
  if (Array.isArray(dataId)) {
    return dataId.map((value) => String(value || "").trim()).filter(Boolean);
  }
  const value = String(dataId || "").trim();
  return value ? [value] : [];
}

function filterDataIds(filter: unknown): string[] {
  if (!isRecord(filter)) return [];
  const dataId = filter.dataId;
  if (Array.isArray(dataId)) {
    return dataId.map((value) => String(value || "").trim()).filter(Boolean);
  }
  const value = String(dataId || "").trim();
  return value ? [value] : [];
}

function isMissingMaonoAnalysisDataId(dataId: string, available: Set<string>) {
  return MAONO_ANALYSIS_DATA_ID_PATTERN.test(dataId) && !available.has(dataId);
}

export function recoverOrphanedMaonoAnalysisReferences(savedConfig: any) {
  if (!isRecord(savedConfig) || !Array.isArray(savedConfig.datasets)) {
    return {
      savedConfig,
      recoveredDatasetIds: [] as string[],
    };
  }

  const available = new Set(
    savedConfig.datasets.map(datasetIdOf).filter(Boolean),
  );
  const config = isRecord(savedConfig.config) ? savedConfig.config : null;
  const visState = isRecord(config?.visState) ? config.visState : null;
  if (!config || !visState) {
    return {
      savedConfig,
      recoveredDatasetIds: [] as string[],
    };
  }

  const recovered = new Set<string>();
  const layers = Array.isArray(visState.layers) ? visState.layers : [];
  const nextLayers = layers.filter((layer) => {
    const missingIds = layerDataIds(layer).filter((dataId) =>
      isMissingMaonoAnalysisDataId(dataId, available),
    );
    missingIds.forEach((dataId) => recovered.add(dataId));
    return missingIds.length === 0;
  });

  const filters = Array.isArray(visState.filters) ? visState.filters : [];
  const nextFilters = filters.filter((filter) => {
    const missingIds = filterDataIds(filter).filter((dataId) =>
      isMissingMaonoAnalysisDataId(dataId, available),
    );
    missingIds.forEach((dataId) => recovered.add(dataId));
    return missingIds.length === 0;
  });

  const interactionConfig = isRecord(visState.interactionConfig)
    ? visState.interactionConfig
    : null;
  const tooltip = isRecord(interactionConfig?.tooltip)
    ? interactionConfig.tooltip
    : null;
  const tooltipConfig = isRecord(tooltip?.config) ? tooltip.config : null;
  const fieldsToShow = isRecord(tooltipConfig?.fieldsToShow)
    ? tooltipConfig.fieldsToShow
    : null;

  let nextInteractionConfig = interactionConfig;
  if (interactionConfig && tooltip && tooltipConfig && fieldsToShow) {
    const nextFieldsToShow = { ...fieldsToShow };
    for (const dataId of Object.keys(nextFieldsToShow)) {
      if (isMissingMaonoAnalysisDataId(dataId, available)) {
        delete nextFieldsToShow[dataId];
        recovered.add(dataId);
      }
    }
    nextInteractionConfig = {
      ...interactionConfig,
      tooltip: {
        ...tooltip,
        config: {
          ...tooltipConfig,
          fieldsToShow: nextFieldsToShow,
        },
      },
    };
  }

  if (!recovered.size) {
    return {
      savedConfig,
      recoveredDatasetIds: [] as string[],
    };
  }

  return {
    savedConfig: {
      ...savedConfig,
      config: {
        ...config,
        visState: {
          ...visState,
          layers: nextLayers,
          filters: nextFilters,
          ...(nextInteractionConfig
            ? { interactionConfig: nextInteractionConfig }
            : {}),
        },
      },
    },
    recoveredDatasetIds: Array.from(recovered),
  };
}

export function validateSavedKeplerConfig(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Configuração do projeto inválida.");
  }

  if (!Array.isArray(value.datasets)) {
    throw new Error("A configuração do projeto não possui datasets válidos.");
  }

  if (!isRecord(value.config)) {
    throw new Error("A configuração do projeto não possui objeto config válido.");
  }
}

function hydrationError(cause: unknown): SavedConfigHydrationError {
  const detail = cause instanceof Error ? cause.message.trim() : "";
  const error = new Error(
    detail
      ? `Não foi possível converter a configuração salva para o formato de execução do mapa. ${detail}`
      : "Não foi possível converter a configuração salva para o formato de execução do mapa.",
    { cause },
  ) as SavedConfigHydrationError;

  error.name = "SavedConfigHydrationError";
  error.code = "KEPLER_SCHEMA_LOAD_FAILED";
  error.category = "MAP_CONFIG";
  error.retryable = false;
  return error;
}

function resolveKeplerSchemaManager() {
  const moduleValue = KeplerSchemas as Record<string, any>;
  const defaultExport = moduleValue.default;
  const candidates = [
    moduleValue,
    moduleValue.KeplerGlSchema,
    defaultExport,
    defaultExport?.KeplerGlSchema,
    defaultExport?.default,
  ];

  const schemaManager = candidates.find(
    (candidate) => candidate && typeof candidate.load === "function",
  );

  if (schemaManager) {
    return schemaManager;
  }

  const SchemaManagerClass =
    moduleValue.KeplerGLSchemaClass ?? defaultExport?.KeplerGLSchemaClass;
  if (typeof SchemaManagerClass === "function") {
    const instance = new SchemaManagerClass();
    if (typeof instance?.load === "function") {
      return instance;
    }
  }

  throw hydrationError(
    new Error(
      "O módulo @kepler.gl/schemas não expôs um schema manager compatível.",
    ),
  );
}

function validateRuntimeDatasets(datasets: unknown, expectedCount: number) {
  if (!Array.isArray(datasets)) {
    throw hydrationError(new Error("O Kepler não retornou uma lista de datasets de runtime."));
  }

  if (datasets.length !== expectedCount) {
    throw hydrationError(
      new Error(
        `O Kepler converteu ${datasets.length} de ${expectedCount} datasets persistidos.`,
      ),
    );
  }

  datasets.forEach((dataset, index) => {
    if (!isRecord(dataset) || !isRecord(dataset.info) || !isRecord(dataset.data)) {
      throw hydrationError(
        new Error(`Dataset ${index + 1} não possui o contrato info/data esperado pelo runtime.`),
      );
    }

    if (!Array.isArray(dataset.data.fields) || !Array.isArray(dataset.data.rows)) {
      throw hydrationError(
        new Error(`Dataset ${index + 1} não foi convertido para fields/rows.`),
      );
    }
  });
}

export function isSavedConfigHydrationError(
  value: unknown,
): value is SavedConfigHydrationError {
  return Boolean(
    value instanceof Error &&
      (value as Partial<SavedConfigHydrationError>).code ===
        "KEPLER_SCHEMA_LOAD_FAILED",
  );
}

export function hydrateSavedKeplerConfig(
  savedConfig: any,
  { featureEnabled = false }: { featureEnabled?: boolean } = {},
) {
  validateSavedKeplerConfig(savedConfig);

  const prepared = prepareSavedConfigForPointClustering(savedConfig, {
    featureEnabled,
  });
  const recovered = recoverOrphanedMaonoAnalysisReferences(
    prepared.savedConfig,
  );
  loadPointClusterState(recovered.savedConfig.maono);

  let loaded: any;
  try {
    const schemaManager = resolveKeplerSchemaManager();
    loaded = schemaManager.load(recovered.savedConfig) as any;
  } catch (error) {
    if (isSavedConfigHydrationError(error)) {
      throw error;
    }
    throw hydrationError(error);
  }

  if (!isRecord(loaded)) {
    throw hydrationError(new Error("O Kepler não retornou um payload de runtime válido."));
  }

  const datasets = loaded.datasets;
  validateRuntimeDatasets(datasets, recovered.savedConfig.datasets.length);

  const config = loaded.config ?? recovered.savedConfig.config;
  if (!isRecord(config)) {
    throw hydrationError(new Error("O Kepler não retornou uma configuração de runtime válida."));
  }

  return {
    datasets,
    config,
  };
}
