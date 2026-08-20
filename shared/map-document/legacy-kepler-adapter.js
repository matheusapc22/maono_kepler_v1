import {
  MAP_DOCUMENT_ENGINE_KEPLER,
  MAP_DOCUMENT_KIND,
} from "./constants.js";
import { detectSchema, isPlainMapDocumentObject } from "./detect-schema.js";
import { createMaonoMapDocumentV1 } from "./maono-map-v1.js";
import { validateDocument, validateLegacyKeplerV1 } from "./validate-document.js";

function cloneJson(value) {
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
      engineDataId: dataId === undefined ? null : cloneJson(dataId),
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
      dataId: filter?.dataId === undefined ? null : cloneJson(filter.dataId),
      name: filter?.name === undefined ? null : cloneJson(filter.name),
      type: filter?.type ?? null,
      enabled: filter?.enlarged !== true,
    };
  });
}

function mapMetadata(legacy) {
  return {
    viewport: cloneJson(legacy.config?.mapState ?? {}),
    basemap: cloneJson(legacy.config?.mapStyle ?? {}),
  };
}

function mergeExtensionsIntoLegacyPayload(payload, extensions) {
  if (!isPlainMapDocumentObject(extensions) || Object.keys(extensions).length === 0) {
    return payload;
  }
  const current = isPlainMapDocumentObject(payload.maono) ? payload.maono : {};
  payload.maono = { ...current, ...cloneJson(extensions) };
  return payload;
}

export function legacyKeplerToMaonoMapV1(legacyDocument) {
  validateLegacyKeplerV1(legacyDocument);
  const payload = cloneJson(legacyDocument);
  const extensions = isPlainMapDocumentObject(legacyDocument.maono)
    ? cloneJson(legacyDocument.maono)
    : {};

  return createMaonoMapDocumentV1({
    map: mapMetadata(legacyDocument),
    datasets: datasetRefs(legacyDocument),
    layers: layerRefs(legacyDocument),
    filters: filterRefs(legacyDocument),
    analyses: [],
    engine: {
      type: MAP_DOCUMENT_ENGINE_KEPLER,
      payload,
    },
    extensions,
  });
}

export function toLegacyKeplerDocument(document) {
  const detection = detectSchema(document);
  if (detection.kind === MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1) {
    validateDocument(document);
    return cloneJson(document);
  }
  if (detection.kind !== MAP_DOCUMENT_KIND.MAONO_MAP_V1) {
    validateDocument(document);
  }
  validateDocument(document);
  const payload = cloneJson(document.engine.payload);
  return mergeExtensionsIntoLegacyPayload(payload, document.extensions);
}

export function toMaonoMapDocumentV1(document) {
  const detection = detectSchema(document);
  if (detection.kind === MAP_DOCUMENT_KIND.MAONO_MAP_V1) {
    validateDocument(document);
    return cloneJson(document);
  }
  if (detection.kind === MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1) {
    return legacyKeplerToMaonoMapV1(document);
  }
  validateDocument(document);
  return null;
}
