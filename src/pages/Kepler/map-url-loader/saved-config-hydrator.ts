import * as KeplerSchemas from "@kepler.gl/schemas";

import { prepareSavedConfigForPointClustering } from "../clustering/point-cluster-controller.ts";
import { loadPointClusterState } from "../clustering/point-cluster-store.ts";

export type SavedConfigHydrationError = Error & {
  code: "KEPLER_SCHEMA_LOAD_FAILED";
  category: "MAP_CONFIG";
  retryable: false;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
  loadPointClusterState(prepared.savedConfig.maono);

  let loaded: any;
  try {
    const schemaManager = resolveKeplerSchemaManager();
    loaded = schemaManager.load(prepared.savedConfig) as any;
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
  validateRuntimeDatasets(datasets, prepared.savedConfig.datasets.length);

  const config = loaded.config ?? prepared.savedConfig.config;
  if (!isRecord(config)) {
    throw hydrationError(new Error("O Kepler não retornou uma configuração de runtime válida."));
  }

  return {
    datasets,
    config,
  };
}
