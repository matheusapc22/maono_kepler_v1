import {
  removeFilter,
  setPolygonFilterLayer,
  setSelectedFeature,
  wrapTo,
} from "@kepler.gl/actions";
import {
  EDITOR_AVAILABLE_LAYERS,
  FILTER_TYPES,
  GEOCODER_LAYER_ID,
} from "@kepler.gl/constants";
import type { Feature } from "@kepler.gl/types";

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
      // O identificador do Polygon Filter pertence ao engine e nunca deve ser
      // herdado por acidente de uma coluna homônima do dataset.
      filterId: null,
      isClosed: true,
      // Metadados próprios permitem que a Maõno reconheça filtros novos sem
      // depender do estado visual do Editor do Kepler.
      maonoGeometryFilter: true,
      maonoGeometryFilterVersion: MAONO_GEOMETRY_FILTER_VERSION,
      maonoSourceLayerId: sourceId,
    },
  } as Feature;
}

function clearNativeEditorSelection(dispatch: (action: unknown) => unknown) {
  dispatch(wrapTo(KEPLER_MAP_ID, setSelectedFeature(null)));
}

function newlyCreatedPolygonFilter(
  rootState: unknown,
  idsBeforeCreation: Set<string>,
) {
  return (
    rawFilters(rootState).find((filter) => {
      const id = filterId(filter);
      return (
        id &&
        !idsBeforeCreation.has(id) &&
        readValue(filter, "type") === FILTER_TYPES.polygon
      );
    }) ?? null
  );
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
    if (!layer || !layerFilterable(layer)) {
      rejected.push(id);
      continue;
    }
    targets.push(layer);
  }

  return { targets, rejected };
}

/**
 * Cria o Polygon Filter como um detalhe headless do engine. A identificação
 * do filtro criado é feita pelo delta da coleção de filtros antes/depois da
 * primeira ação, e não mais por editor.selectedFeature. Isso elimina a
 * dependência de estado visual/editável do Kepler.
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
    if (rejected.length) {
      return failure(
        "COMMAND_INVALID",
        `Camadas incompatíveis com o filtro geométrico: ${rejected.join(", ")}.`,
      );
    }

    const idsBeforeCreation = new Set(
      rawFilters(getState())
        .filter((filter) => readValue(filter, "type") === FILTER_TYPES.polygon)
        .map(filterId)
        .filter(Boolean),
    );
    const firstLayer = targets[0];
    const sourceFeature = normalizedFilterFeature(feature, sourceLayerId);

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        setPolygonFilterLayer(firstLayer, sourceFeature),
      ),
    );

    const createdFilter = newlyCreatedPolygonFilter(
      getState(),
      idsBeforeCreation,
    );
    const createdFilterId = filterId(createdFilter);
    const activeFeature = readValue(createdFilter, "value") as Feature | null;

    // setPolygonFilterLayer seleciona a feature internamente. A Maõno não usa
    // essa seleção e a remove na mesma transação de comando antes de retornar.
    clearNativeEditorSelection(dispatch);

    if (
      !createdFilter ||
      !createdFilterId ||
      !activeFeature ||
      !isPolygonGeometryFeature(activeFeature)
    ) {
      return failure(
        "COMMAND_FAILED",
        "O engine não confirmou a criação do filtro poligonal.",
      );
    }

    for (const layer of targets.slice(1)) {
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          setPolygonFilterLayer(layer, activeFeature),
        ),
      );
      clearNativeEditorSelection(dispatch);
    }

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
    clearNativeEditorSelection(dispatch);
    return failure(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "Não foi possível aplicar o filtro geométrico.",
    );
  }
}

/**
 * Sincroniza somente as associações de layer do Polygon Filter headless.
 * A UI não seleciona, move nem edita a geometria pelo Editor do Kepler.
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

    const { targets, rejected } = resolveTargetLayers(getState(), desiredIds);
    if (rejected.length) {
      return failure(
        "COMMAND_INVALID",
        `Camadas incompatíveis com o filtro geométrico: ${rejected.join(", ")}.`,
      );
    }

    const currentIds = new Set(filterLayerIds(filter));
    const desiredSet = new Set(desiredIds);
    const changedIds = new Set<string>();

    for (const id of currentIds) {
      if (!desiredSet.has(id)) changedIds.add(id);
    }
    for (const id of desiredSet) {
      if (!currentIds.has(id)) changedIds.add(id);
    }

    if (!changedIds.size) {
      clearNativeEditorSelection(dispatch);
      return {
        ok: true,
        changed: false,
        value: {
          filterId: normalizedId,
          affectedLayerIds: desiredIds,
        },
      };
    }

    const targetById = new Map(targets.map((layer) => [layerId(layer), layer]));
    for (const id of currentIds) {
      if (changedIds.has(id) && !targetById.has(id)) {
        const layer = rawLayers(getState()).find((candidate) => layerId(candidate) === id);
        if (layer && layerFilterable(layer)) targetById.set(id, layer);
      }
    }

    for (const id of changedIds) {
      const layer = targetById.get(id);
      if (!layer) {
        return failure(
          "COMMAND_FAILED",
          `A camada ${id} não está disponível para atualizar o filtro.`,
        );
      }

      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          setPolygonFilterLayer(layer, feature),
        ),
      );
      clearNativeEditorSelection(dispatch);
    }

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
    clearNativeEditorSelection(dispatch);
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
    clearNativeEditorSelection(dispatch);

    return {
      ok: true,
      changed: true,
      value: {
        filterId: normalizedId,
        affectedLayerIds,
      },
    };
  } catch (error) {
    clearNativeEditorSelection(dispatch);
    return failure(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "Não foi possível remover o filtro geométrico.",
    );
  }
}
