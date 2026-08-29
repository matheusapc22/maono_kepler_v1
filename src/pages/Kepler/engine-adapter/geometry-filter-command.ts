import {
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

export type GeometryFilterManagerResult = {
  filterId: string;
};

type GeometryFilterDependencies = {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  feature: Feature;
  sourceLayerId?: string | null;
};

type GeometryFilterManagerDependencies = {
  dispatch: (action: unknown) => unknown;
  getState: () => unknown;
  position: { x: number; y: number };
  mapIndex?: number;
};

const COMMAND = "filterByGeometry";
const CAPABILITY = "editFilters" as const;

function failure<T = GeometryFilterResult>(
  code: KeplerCommandErrorCode,
  reason: string,
): KeplerCommandResult<T> {
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

function layerVisible(layer: unknown) {
  const config = readValue(layer, "config");
  return readValue(config, "isVisible") !== false;
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
      // A feição vem de uma layer de dados. Ela deve sempre iniciar um novo
      // filtro, mesmo que o dataset possua acidentalmente uma coluna filterId.
      filterId: null,
      isClosed: true,
    },
  } as Feature;
}

function selectedEditorFeature(rootState: unknown): Feature | null {
  const editor = readValue(selectKeplerVisState(rootState), "editor");
  const selected = readValue(editor, "selectedFeature");
  return selected && typeof selected === "object"
    ? (selected as Feature)
    : null;
}

function featureFilterId(feature: unknown) {
  const properties = readValue(feature, "properties");
  const value = readValue(properties, "filterId");
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function featureId(feature: unknown) {
  const value = readValue(feature, "id");
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function geometryFilterTargetLayers(
  rootState: unknown,
  sourceLayerId?: string | null,
) {
  const sourceId = String(sourceLayerId ?? "").trim();

  return rawLayers(rootState).filter((layer) => {
    const id = layerId(layer);
    const type = layerType(layer);

    if (!id || !type || !layerVisible(layer)) return false;
    if (id === GEOCODER_LAYER_ID) return false;
    if (sourceId && id === sourceId) return false;

    return EDITOR_AVAILABLE_LAYERS.includes(type as any);
  });
}

export function geometryFilterTargetLayerIds(
  rootState: unknown,
  sourceLayerId?: string | null,
) {
  return geometryFilterTargetLayers(rootState, sourceLayerId).map(layerId);
}

/**
 * Retorna o Polygon Filter atualmente selecionado pelo Editor nativo.
 * A seleção continua sendo responsabilidade do picking do Kepler/DeckGL.
 */
export function selectedGeometryFilter(rootState: unknown): {
  filterId: string;
  feature: Feature;
} | null {
  const selectedFeature = selectedEditorFeature(rootState);
  const selectedFeatureId = featureId(selectedFeature);
  if (!selectedFeature || !selectedFeatureId) return null;

  for (const filter of rawFilters(rootState)) {
    if (readValue(filter, "type") !== FILTER_TYPES.polygon) continue;

    const value = readValue(filter, "value");
    if (featureId(value) !== selectedFeatureId) continue;

    const filterId = String(
      readValue(filter, "id") ?? featureFilterId(value) ?? "",
    ).trim();
    if (!filterId) continue;

    return {
      filterId,
      feature:
        value && typeof value === "object"
          ? (value as Feature)
          : selectedFeature,
    };
  }

  return null;
}

/**
 * Abre o FeatureActionPanel oficial do Kepler no ponto clicado. O painel
 * nativo já concentra as ações de associar/desassociar layers, copiar a
 * geometria e remover o Polygon Filter; a Maõno apenas converte o clique
 * esquerdo em um selectionContext de gestão depois que o picking nativo
 * selecionou a geometria.
 */
export function openSelectedGeometryFilterManager({
  dispatch,
  getState,
  position,
  mapIndex = 0,
}: GeometryFilterManagerDependencies): KeplerCommandResult<GeometryFilterManagerResult> {
  try {
    if (!selectKeplerMapState(getState())) {
      return failure<GeometryFilterManagerResult>(
        "MAP_UNAVAILABLE",
        "A instância do mapa ainda não está disponível.",
      );
    }

    if (
      !Number.isFinite(position?.x) ||
      !Number.isFinite(position?.y) ||
      position.x < 0 ||
      position.y < 0
    ) {
      return failure<GeometryFilterManagerResult>(
        "COMMAND_INVALID",
        "A posição usada para abrir o gestor do filtro é inválida.",
      );
    }

    const selected = selectedGeometryFilter(getState());
    if (!selected) {
      return failure<GeometryFilterManagerResult>(
        "COMMAND_INVALID",
        "Nenhum filtro geométrico foi selecionado pelo Kepler neste clique.",
      );
    }

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        setSelectedFeature(selected.feature, {
          mapIndex: Number.isFinite(mapIndex) ? mapIndex : 0,
          rightClick: true,
          position,
        }),
      ),
    );

    return {
      ok: true,
      changed: false,
      value: {
        filterId: selected.filterId,
      },
    };
  } catch (error) {
    return failure<GeometryFilterManagerResult>(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "O Kepler recusou a abertura do gestor do filtro geométrico.",
    );
  }
}

/**
 * Ponte estreita entre a intenção Maõno e o Polygon Filter oficial do Kepler.
 *
 * O primeiro setPolygonFilterLayer cria o filtro. Em seguida recuperamos a
 * selectedFeature produzida pelo reducer (agora contendo filterId) e a
 * reutilizamos nas demais layers. Assim uma geometria gera exatamente um
 * filtro polygon com vários layerIds, sem motor espacial paralelo.
 */
export function applyGeometryFilter({
  dispatch,
  getState,
  feature,
  sourceLayerId = null,
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

    const targets = geometryFilterTargetLayers(getState(), sourceLayerId);
    if (!targets.length) {
      return failure(
        "COMMAND_INVALID",
        "Não há outra camada visível compatível com o filtro por geometria.",
      );
    }

    let activeFeature = normalizedFilterFeature(feature);
    const affectedLayerIds: string[] = [];
    let filterId: string | null = null;

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
      if (!selectedFeature || !isPolygonGeometryFeature(selectedFeature) || !selectedFilterId) {
        return failure(
          "COMMAND_FAILED",
          "O Kepler não confirmou a feição do filtro poligonal.",
        );
      }

      activeFeature = selectedFeature;
      filterId = selectedFilterId;
    }

    if (!filterId) {
      return failure(
        "COMMAND_FAILED",
        "O Kepler não retornou o identificador do filtro poligonal.",
      );
    }

    return {
      ok: true,
      changed: true,
      value: {
        filterId,
        affectedLayerIds,
      },
    };
  } catch (error) {
    return failure(
      "COMMAND_FAILED",
      error instanceof Error
        ? error.message
        : "O Kepler recusou o filtro por geometria.",
    );
  }
}
