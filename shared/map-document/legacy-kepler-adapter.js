import {
  MAP_DOCUMENT_ENGINE_KEPLER,
  MAP_DOCUMENT_KIND,
} from "./constants.js";
import { detectSchema, isPlainMapDocumentObject } from "./detect-schema.js";
import { createMaonoMapDocumentV1 } from "./maono-map-v1.js";
import { validateDocument, validateLegacyKeplerV1 } from "./validate-document.js";

function cloneSmallJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableToken(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function referenceId(prefix, value, index) {
  return `${prefix}:${encodeURIComponent(stableToken(value, String(index)))}`;
}

function datasetRefs(legacy) {
  return legacy.datasets.map((dataset, index) => {
    const data = isPlainMapDocumentObject(dataset?.data) ? dataset.data : dataset;
    const engineDataId = stableToken(data?.id ?? dataset?.id, `dataset-${index}`);
    return {
      id: referenceId("legacy-dataset", engineDataId, index),
      engineDataId,
      label: stableToken(data?.label ?? dataset?.label, engineDataId),
    };
  });
}

function layerRefs(legacy) {
  const layers = legacy.config?.visState?.layers;
  if (!Array.isArray(layers)) return [];
  return layers.map((layer, index) => {
    const engineLayerId = stableToken(layer?.id, `layer-${index}`);
    const dataId = layer?.config?.dataId;
    return {
      id: referenceId("legacy-layer", engineLayerId, index),
      engineLayerId,
      engineDataId: dataId === undefined ? null : cloneSmallJson(dataId),
      type: layer?.type ?? null,
      label: layer?.config?.label ?? engineLayerId,
      visible: layer?.config?.isVisible !== false,
    };
  });
}

function filterRefs(legacy) {
  const filters = legacy.config?.visState?.filters;
  if (!Array.isArray(filters)) return [];
  return filters.map((filter, index) => {
    const engineFilterId = stableToken(filter?.id, `filter-${index}`);
    return {
      id: referenceId("legacy-filter", engineFilterId, index),
      engineFilterId,
      dataId: filter?.dataId === undefined ? null : cloneSmallJson(filter.dataId),
      name: filter?.name === undefined ? null : cloneSmallJson(filter.name),
      type: filter?.type ?? null,
    };
  });
}

function mapMetadata(legacy) {
  return {
    viewport: cloneSmallJson(legacy.config?.mapState ?? {}),
    basemap: cloneSmallJson(legacy.config?.mapStyle ?? {}),
  };
}

function mergeExtensionsIntoLegacyPayload(payload, extensions) {
  if (!isPlainMapDocumentObject(extensions) || Object.keys(extensions).length === 0) {
    return payload;
  }
  const current = isPlainMapDocumentObject(payload.maono) ? payload.maono : {};
  return {
    ...payload,
    maono: {
      ...current,
      ...cloneSmallJson(extensions),
    },
  };
}

export function legacyKeplerToMaonoMapV1(legacyDocument) {
  validateLegacyKeplerV1(legacyDocument);
  const extensions = isPlainMapDocumentObject(legacyDocument.maono)
    ? cloneSmallJson(legacyDocument.maono)
    : {};

  return createMaonoMapDocumentV1({
    map: mapMetadata(legacyDocument),
    datasets: datasetRefs(legacyDocument),
    layers: layerRefs(legacyDocument),
    filters: filterRefs(legacyDocument),
    analyses: [],
    engine: {
      type: MAP_DOCUMENT_ENGINE_KEPLER,
      payload: legacyDocument,
    },
    extensions,
  });
}

export function toLegacyKeplerDocument(document) {
  const detection = detectSchema(document);
  if (detection.kind === MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1) {
    validateDocument(document);
    return document;
  }
  if (detection.kind !== MAP_DOCUMENT_KIND.MAONO_MAP_V1) {
    validateDocument(document);
  }
  validateDocument(document);
  return mergeExtensionsIntoLegacyPayload(document.engine.payload, document.extensions);
}

export function toMaonoMapDocumentV1(document) {
  const detection = detectSchema(document);
  if (detection.kind === MAP_DOCUMENT_KIND.MAONO_MAP_V1) {
    validateDocument(document);
    return document;
  }
  if (detection.kind === MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1) {
    return legacyKeplerToMaonoMapV1(document);
  }
  validateDocument(document);
  return null;
}
