import {
  addFilter,
  removeFilter,
  setFilter,
  wrapTo,
} from "@kepler.gl/actions";
import {
  EDITOR_AVAILABLE_LAYERS,
  FILTER_TYPES,
  GEOCODER_LAYER_ID,
} from "@kepler.gl/constants";
import type { Feature } from "@kepler.gl/types";
import { generatePolygonFilter } from "@kepler.gl/utils";

import {
  KEPLER_MAP_ID,
  collectionToArray,
  readValue,
  selectKeplerMapState,
  selectKeplerVisState,
} from "./selectors.ts";
import type {
  KeplerCommandErrorCode,
  KeplerCommandResult,
} from "./types.ts";

export type GeometryFilterResult = {
  filterId: string;
  affectedLayerIds: string[];
};

export type GeometryFilterLayerOption = {
  id: string;
  label: string;
  type: string;
  visible: boolean;
  filterable: boolean;
  source: boolean;
};

export type GeometryFilterSnapshot = {
  id: string;
  feature: Feature;
  layerIds: string[];
  enabled: boolean;
  maonoManaged: boolean;
  sourceLayerId: string | null;
};

type GeometryFilterDependencies = {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  feature: Feature;
  sourceLayerId?: string | null;
  targetLayerIds?: string[] | null;
};

type GeometryFilterUpdateDependencies = {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  filterId: string;
  targetLayerIds: string[];
};

type GeometryFilterRemoveDependencies = {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  filterId: string;
};

const COMMAND = "filterByGeometry";
const CAPABILITY = "editFilters" as const;
const MAONO_GEOMETRY_FILTER_VERSION = 3;

function failure(
  code: KeplerCommandErrorCode,
  reason: string,
): KeplerCommandResult<GeometryFilterResult> {
  return {
    ok: false,
    code,
    reason,
    command: COMMAND,
    capability: CAPABILITY,
  };
}

function rawLayers(rootState: unknown) {
  return collectionToArray<any>(
    readValue(selectKeplerVisState(rootState), "layers"),
  );
}

function rawFilters(rootState: unknown) {
  return collectionToArray<any>(
    readValue(selectKeplerVisState(rootState), "filters"),
  );
}

function layerId(layer: unknown) {
  return String(readValue(layer, "id") ?? "").trim();
}

function layerType(layer: unknown) {
  return String(readValue(layer, "type") ?? "").trim();
}

function layerConfig(layer: unknown) {
  return readValue(layer, "config");
}

function layerDataId(layer: unknown) {
  return String(readValue(layerConfig(layer), "dataId") ?? "").trim();
}

function layerLabel(layer: unknown) {
  const config = layerConfig(layer);
  return String(
    readValue(config, "label") ??
      readValue(config, "id") ??
      layerId(layer) ??
      "Camada",
  ).trim();
}

function layerVisible(layer: unknown) {
  return readValue(layerConfig(layer), "isVisible") !== false;
}

function layerFilterable(layer: unknown) {
  const type = layerType(layer);
  return Boolean(type && EDITOR_AVAILABLE_LAYERS.includes(type as any));
}

function filterId(filter: unknown) {
  return String(readValue(filter, "id") ?? "").trim();
}

function filterLayerIds(filter: unknown) {
  return collectionToArray<unknown>(readValue(filter, "layerId"))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function featureProperties(feature: unknown) {
  const properties = readValue(feature, "properties");
  if (!properties || typeof properties !== "object") return {};

  return typeof (properties as any).toJS === "function"
    ? (properties as any).toJS()
    : (properties as Record<string, unknown>);
}

export function geometryFilterById(rootState: unknown, id: string) {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;

  return (
    rawFilters(rootState).find(
      (filter) =>
        filterId(filter) === normalized &&
        readValue(filter, "type") === FILTER_TYPES.polygon,
    ) ?? null
  );
}

function geometryFilterIndexById(rootState: unknown, id: string) {
  const normalized = String(id ?? "").trim();
  if (!normalized) return -1;

  return rawFilters(rootState).findIndex(
    (filter) =>
      filterId(filter) === normalized &&
      readValue(filter, "type") === FILTER_TYPES.polygon,
  );
}

function normalizedTargetIds(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export function isPolygonGeometryFeature(
  feature: unknown,
): feature is Feature {
  const geometry = readValue(feature, "geometry");
  const type = String(readValue(geometry, "type") ?? "");
  return type === "Polygon" || type === "MultiPolygon";
}

function normalizedFilterFeature(
  feature: Feature,
  sourceLayerId?: string | null,
): Feature {
  const plainProperties = featureProperties(feature);
  const sourceId = String(sourceLayerId ?? "").trim() || null;

  return {
    ...feature,
    properties: {
      ...plainProperties,
      // Um `filterId` vindo dos dados nunca pode ser confundido com o id do
      // filtro interno que será gerado abaixo.
      filterId: null,
      isClosed: true,
      maonoGeometryFilter: true,
      maonoGeometryFilterVersion: MAONO_GEOMETRY_FILTER_VERSION,
      maonoSourceLayerId: sourceId,
    },
  } as Feature;
}

/**
 * Snapshot somente-leitura dos Polygon Filters existentes. A UI Maõno usa
 * esta projeção para renderizar e gerenciar as áreas sem selecionar features
 * no Editor do Kepler. Filtros legados também são expostos para que possam ser
 * absorvidos pela experiência Maõno.
 */
export function geometryFilterSnapshots(
  rootState: unknown,
): GeometryFilterSnapshot[] {
  return rawFilters(rootState).flatMap((filter) => {
    if (readValue(filter, "type") !== FILTER_TYPES.polygon) return [];

    const id = filterId(filter);
    const feature = readValue(filter, "value") as Feature | null;
    if (!id || !feature || !isPolygonGeometryFeature(feature)) return [];

    const properties = featureProperties(feature);
    const sourceLayerId = String(
      properties.maonoSourceLayerId ?? "",
    ).trim() || null;

    return [
      {
        id,
        feature,
        layerIds: filterLayerIds(filter),
        enabled: readValue(filter, "enabled") !== false,
        maonoManaged: properties.maonoGeometryFilter === true,
        sourceLayerId,
      },
    ];
  });
}

export function geometryFilterSnapshotById(
  rootState: unknown,
  id: string,
): GeometryFilterSnapshot | null {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;
  return geometryFilterSnapshots(rootState).find((filter) => filter.id === normalized) ?? null;
}

/**
 * Catálogo que alimenta exclusivamente o gestor Maõno.
 * Todas as layers aparecem na UI; as que o Polygon Filter não consegue
 * avaliar permanecem visíveis, porém identificadas como incompatíveis.
 */
export function geometryFilterLayerOptions(
  rootState: unknown,
  sourceLayerId?: string | null,
): GeometryFilterLayerOption[] {
  const sourceId = String(sourceLayerId ?? "").trim();

  return rawLayers(rootState)
    .map((layer) => ({
      id: layerId(layer),
      label: layerLabel(layer),
      type: layerType(layer),
      visible: layerVisible(layer),
      filterable: layerFilterable(layer),
      source: Boolean(sourceId && layerId(layer) === sourceId),
    }))
    .filter((layer) => layer.id && layer.id !== GEOCODER_LAYER_ID);
}

export function geometryFilterTargetLayerIds(
  rootState: unknown,
  sourceLayerId?: string | null,
) {
  return geometryFilterLayerOptions(rootState, sourceLayerId)
    .filter((layer) => layer.filterable)
    .map((layer) => layer.id);
}

function resolveTargetLayers(rootState: unknown, requestedIds: string[]) {
  const byId = new Map(
    rawLayers(rootState)
      .filter((layer) => layerId(layer) !== GEOCODER_LAYER_ID)
      .map((layer) => [layerId(layer), layer]),
  );

  const targets: any[] = [];
  const rejected: string[] = [];

  for (const id of requestedIds) {
    const layer = byId.get(id);
    if (!layer || !layerFilterable(layer) || !layerDataId(layer)) {
      rejected.push(id);
      continue;
    }
    targets.push(layer);
  }

  return { targets, rejected };
}

/**
 * Cria o filtro espacial sem acionar `setPolygonFilterLayer`, que é a ação
 * interativa do Kepler responsável por também selecionar a feature no Editor.
 *
 * `generatePolygonFilter` é usado somente para obter a estrutura de filtro e
 * o predicado compatível com o engine; a inserção é feita por `addFilter` +
 * `setFilter`, de modo que nenhum estado de desenho/seleção seja tocado.
 */
export function applyGeometryFilter({
  dispatch,
  getState,
  feature,
  sourceLayerId = null,
  targetLayerIds = null,
}: GeometryFilterDependencies): KeplerCommandResult<GeometryFilterResult> {
  try {
    if (!selectKeplerMapState(getState())) {
      return failure(
        "MAP_UNAVAILABLE",
        "A instância do mapa ainda não está disponível.",
      );
    }

    if (!isPolygonGeometryFeature(feature)) {
      return failure(
        "COMMAND_INVALID",
        "Filtrar por geometria exige uma feição Polygon ou MultiPolygon.",
      );
    }

    const requestedIds = targetLayerIds
      ? normalizedTargetIds(targetLayerIds)
      : geometryFilterTargetLayerIds(getState(), sourceLayerId);

    if (!requestedIds.length) {
      return failure(
        "COMMAND_INVALID",
        "Selecione ao menos uma camada compatível para aplicar o filtro.",
      );
    }

    const { targets, rejected } = resolveTargetLayers(getState(), requestedIds);
    if (rejected.length || !targets.length) {
      return failure(
        "COMMAND_INVALID",
        rejected.length
          ? `Camadas incompatíveis com o filtro geométrico: ${rejected.join(", ")}.`
          : "Nenhuma camada compatível está disponível para aplicar o filtro.",
      );
    }

    const sourceFeature = normalizedFilterFeature(feature, sourceLayerId);
    const generatedFilter = generatePolygonFilter(targets, sourceFeature);
    const createdFilterId = String(generatedFilter.id ?? "").trim();
    const firstDataId = String(generatedFilter.dataId?.[0] ?? "").trim();

    if (!createdFilterId || !firstDataId) {
      return failure(
        "COMMAND_FAILED",
        "O engine não conseguiu preparar o filtro poligonal.",
      );
    }

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        addFilter(firstDataId, createdFilterId),
      ),
    );

    const filterIndex = rawFilters(getState()).findIndex(
      (filter) => filterId(filter) === createdFilterId,
    );
    if (filterIndex < 0) {
      return failure(
        "COMMAND_FAILED",
        "O estado do filtro poligonal não foi criado.",
      );
    }

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        setFilter(
          filterIndex,
          ["type", "fixedDomain", "layerId", "value"],
          [
            FILTER_TYPES.polygon,
            true,
            generatedFilter.layerId,
            generatedFilter.value,
          ],
        ),
      ),
    );

    const snapshot = geometryFilterSnapshotById(getState(), createdFilterId);
    if (!snapshot) {
      return failure(
        "COMMAND_FAILED",
        "O estado final do filtro geométrico não pôde ser confirmado.",
      );
    }

    return {
      ok: true,
      changed: true,
      value: {
        filterId: snapshot.id,
        affectedLayerIds: snapshot.layerIds,
      },
    };
  } catch (error) {
    return failure(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "Não foi possível aplicar o filtro geométrico.",
    );
  }
}

/**
 * Atualiza as associações do Polygon Filter pela propriedade `layerId` do
 * filtro, sem usar a ação interativa `setPolygonFilterLayer`. O próprio reducer
 * do Kepler deriva os dataIds afetados e recalcula os registros filtrados.
 */
export function updateGeometryFilterLayers({
  dispatch,
  getState,
  filterId: requestedFilterId,
  targetLayerIds,
}: GeometryFilterUpdateDependencies): KeplerCommandResult<GeometryFilterResult> {
  try {
    if (!selectKeplerMapState(getState())) {
      return failure(
        "MAP_UNAVAILABLE",
        "A instância do mapa ainda não está disponível.",
      );
    }

    const normalizedId = String(requestedFilterId ?? "").trim();
    if (!normalizedId) {
      return failure("COMMAND_INVALID", "O identificador do filtro é inválido.");
    }

    const desiredIds = normalizedTargetIds(targetLayerIds);
    if (!desiredIds.length) {
      return failure(
        "COMMAND_INVALID",
        "Selecione ao menos uma camada compatível para manter o filtro.",
      );
    }

    const filter = geometryFilterById(getState(), normalizedId);
    if (!filter) {
      return failure(
        "COMMAND_INVALID",
        "O filtro geométrico não está mais disponível no mapa.",
      );
    }

    const feature = readValue(filter, "value") as Feature | null;
    if (!feature || !isPolygonGeometryFeature(feature)) {
      return failure(
        "COMMAND_FAILED",
        "A geometria associada ao filtro não é válida.",
      );
    }

    const { rejected } = resolveTargetLayers(getState(), desiredIds);
    if (rejected.length) {
      return failure(
        "COMMAND_INVALID",
        `Camadas incompatíveis com o filtro geométrico: ${rejected.join(", ")}.`,
      );
    }

    const currentIds = filterLayerIds(filter);
    const currentSet = new Set(currentIds);
    const desiredSet = new Set(desiredIds);
    const unchanged =
      currentSet.size === desiredSet.size &&
      desiredIds.every((id) => currentSet.has(id));

    if (unchanged) {
      return {
        ok: true,
        changed: false,
        value: {
          filterId: normalizedId,
          affectedLayerIds: currentIds,
        },
      };
    }

    const filterIndex = geometryFilterIndexById(getState(), normalizedId);
    if (filterIndex < 0) {
      return failure(
        "COMMAND_FAILED",
        "O filtro geométrico não pôde ser localizado para atualização.",
      );
    }

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        setFilter(filterIndex, "layerId", desiredIds),
      ),
    );

    const snapshot = geometryFilterSnapshotById(getState(), normalizedId);
    if (!snapshot) {
      return failure(
        "COMMAND_FAILED",
        "O estado final do filtro geométrico não pôde ser confirmado.",
      );
    }

    return {
      ok: true,
      changed: true,
      value: {
        filterId: snapshot.id,
        affectedLayerIds: snapshot.layerIds,
      },
    };
  } catch (error) {
    return failure(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "Não foi possível atualizar o filtro geométrico.",
    );
  }
}

/**
 * Remove definitivamente um Polygon Filter. "Sair do filtro por geometria"
 * fecha somente o modo de gestão; remoção é uma ação explícita e separada.
 */
export function removeGeometryFilter({
  dispatch,
  getState,
  filterId: requestedFilterId,
}: GeometryFilterRemoveDependencies): KeplerCommandResult<GeometryFilterResult> {
  try {
    if (!selectKeplerMapState(getState())) {
      return failure(
        "MAP_UNAVAILABLE",
        "A instância do mapa ainda não está disponível.",
      );
    }

    const normalizedId = String(requestedFilterId ?? "").trim();
    const filters = rawFilters(getState());
    const index = filters.findIndex(
      (filter) =>
        filterId(filter) === normalizedId &&
        readValue(filter, "type") === FILTER_TYPES.polygon,
    );

    if (!normalizedId || index < 0) {
      return failure(
        "COMMAND_INVALID",
        "O filtro geométrico não está mais disponível no mapa.",
      );
    }

    const affectedLayerIds = filterLayerIds(filters[index]);
    dispatch(wrapTo(KEPLER_MAP_ID, removeFilter(index)));

    return {
      ok: true,
      changed: true,
      value: {
        filterId: normalizedId,
        affectedLayerIds,
      },
    };
  } catch (error) {
    return failure(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "Não foi possível remover o filtro geométrico.",
    );
  }
}
