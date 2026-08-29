import { setPolygonFilterLayer, wrapTo } from "@kepler.gl/actions";
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

const COMMAND = "filterByGeometry";
const CAPABILITY = "editFilters" as const;

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

function geometryFilterById(rootState: unknown, id: string) {
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

function featureFilterId(feature: unknown) {
  const properties = readValue(feature, "properties");
  const value = readValue(properties, "filterId");
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function selectedEditorFeature(rootState: unknown): Feature | null {
  const editor = readValue(selectKeplerVisState(rootState), "editor");
  const selected = readValue(editor, "selectedFeature");
  return selected && typeof selected === "object"
    ? (selected as Feature)
    : null;
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

function normalizedFilterFeature(feature: Feature): Feature {
  const properties = readValue(feature, "properties");
  const plainProperties =
    properties && typeof properties === "object"
      ? typeof (properties as any).toJS === "function"
        ? (properties as any).toJS()
        : properties
      : {};

  return {
    ...feature,
    properties: {
      ...plainProperties,
      // Uma coluna do dataset chamada filterId nunca deve reaproveitar um
      // Polygon Filter anterior. O primeiro toggle precisa criar um filtro.
      filterId: null,
      isClosed: true,
    },
  } as Feature;
}

/**
 * Catálogo que alimenta exclusivamente o gestor Maõno do tooltip.
 *
 * Todas as layers do projeto são devolvidas para a UI, inclusive ocultas e a
 * layer que originou a geometria. Tipos que o Polygon Filter do Kepler não
 * consegue filtrar continuam visíveis na lista, mas marcados como incompatíveis.
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
 * Cria um único Polygon Filter e associa somente as layers escolhidas no
 * tooltip Maõno. O motor espacial continua sendo o Polygon Filter oficial;
 * a seleção e a gestão de layers deixam de depender do FeatureActionPanel.
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

    let activeFeature = normalizedFilterFeature(feature);
    const affectedLayerIds: string[] = [];
    let createdFilterId: string | null = null;

    for (const layer of targets) {
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          setPolygonFilterLayer(layer, activeFeature),
        ),
      );

      affectedLayerIds.push(layerId(layer));

      const selectedFeature = selectedEditorFeature(getState());
      const selectedFilterId = featureFilterId(selectedFeature);
      if (
        !selectedFeature ||
        !isPolygonGeometryFeature(selectedFeature) ||
        !selectedFilterId
      ) {
        return failure(
          "COMMAND_FAILED",
          "O Kepler não confirmou a criação do filtro poligonal.",
        );
      }

      activeFeature = selectedFeature;
      createdFilterId = selectedFilterId;
    }

    if (!createdFilterId) {
      return failure(
        "COMMAND_FAILED",
        "O Kepler não retornou o identificador do filtro poligonal.",
      );
    }

    return {
      ok: true,
      changed: true,
      value: {
        filterId: createdFilterId,
        affectedLayerIds,
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
 * Sincroniza a lista de layers de um Polygon Filter já criado. O algoritmo
 * calcula apenas o delta e usa setPolygonFilterLayer para ligar/desligar cada
 * associação, sem abrir menus ou selecionar features no Editor do Kepler.
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
    }

    return {
      ok: true,
      changed: true,
      value: {
        filterId: normalizedId,
        affectedLayerIds: desiredIds,
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
